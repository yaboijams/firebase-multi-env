/**
 * Per-request app environment resolution for multi-environment Firestore databases.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import * as functions from 'firebase-functions';
import {
  assertNoEmulatorEnvLeak,
  normalizeEnvConfig,
  type NormalizedEnvConfig,
} from './config.js';
import type {
  AppEnvironment,
  EnvironmentDefinition,
  EnvRequestContext,
  EnvResolveEvent,
  EnvResolveSource,
  EnvRuntimeConfig,
  RuntimeEnv,
} from './types.js';

export type EnvRuntime<TEnv extends string = string> = {
  config: NormalizedEnvConfig;
  resolveRequestEnv: (clientEnv: unknown, context: EnvRequestContext) => RuntimeEnv;
  resolveProcessEnv: (clientEnv?: unknown) => RuntimeEnv;
  runWithEnv: <T>(env: RuntimeEnv, fn: () => Promise<T> | T) => Promise<T>;
  getRuntimeEnv: () => RuntimeEnv;
  getEnvTag: () => TEnv;
  /** Resolve a RuntimeEnv for an explicit environment name (scripts / background jobs). */
  resolveEnvByName: (env: TEnv) => RuntimeEnv;
};

function functionNameFromEnv(): string | null {
  return (
    process.env.K_SERVICE
    || process.env.FUNCTION_TARGET
    || process.env.FUNCTION_NAME
    || process.env.X_GOOGLE_FUNCTION_NAME
    || null
  );
}

/**
 * Parse Origin. Rejects multi-value headers, the literal "null", and non-http(s) schemes.
 * Returns `{ ok: false, reason }` when the header is present but unusable.
 */
export function parseOriginHeader(
  value: string | string[] | undefined,
): { ok: true; origin: string | null } | { ok: false; reason: string } {
  if (value === undefined) {
    return { ok: true, origin: null };
  }

  if (Array.isArray(value)) {
    const trimmed = value.map((item) => item.trim()).filter(Boolean);
    if (trimmed.length === 0) {
      return { ok: true, origin: null };
    }
    const unique = [...new Set(trimmed.map((item) => item.replace(/\/$/, '').toLowerCase()))];
    if (unique.length > 1) {
      return { ok: false, reason: 'Multiple distinct Origin headers are not allowed.' };
    }
    value = trimmed[0]!;
  }

  if (typeof value !== 'string') {
    return { ok: false, reason: 'Invalid Origin header type.' };
  }

  const raw = value.trim();
  if (!raw) {
    return { ok: true, origin: null };
  }

  if (raw.toLowerCase() === 'null') {
    return { ok: false, reason: 'Origin "null" is not allowed.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: `Malformed Origin "${raw}".` };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      reason: `Unsupported Origin scheme "${parsed.protocol}" (only http/https).`,
    };
  }

  // Origin must be scheme + host (+ port). Reject if the header included a path/query.
  if (raw.includes('/', raw.indexOf('://') + 3) || raw.includes('?') || raw.includes('#')) {
    // Allow trailing slash only — normalizeOrigin strips it.
    const withoutTrailing = raw.replace(/\/$/, '');
    if (
      withoutTrailing.includes('/', withoutTrailing.indexOf('://') + 3)
      || withoutTrailing.includes('?')
      || withoutTrailing.includes('#')
    ) {
      return { ok: false, reason: `Origin must not include a path or query ("${raw}").` };
    }
  }

  return { ok: true, origin: `${parsed.protocol}//${parsed.host}`.toLowerCase() };
}

function originFromReferer(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const referer = headers.referer || headers.referrer;
  const value = Array.isArray(referer) ? referer[0] : referer;
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return url.origin.replace(/\/$/, '').toLowerCase();
  } catch {
    return null;
  }
}

function originFromContext(
  context: EnvRequestContext,
  allowRefererFallback: boolean,
): { ok: true; origin: string | null } | { ok: false; reason: string } {
  const headers = context.rawRequest?.headers;
  if (!headers) {
    return { ok: true, origin: null };
  }

  const fromOrigin = parseOriginHeader(headers.origin);
  if (!fromOrigin.ok) {
    return fromOrigin;
  }
  if (fromOrigin.origin) {
    return fromOrigin;
  }

  if (allowRefererFallback) {
    return { ok: true, origin: originFromReferer(headers) };
  }

  return { ok: true, origin: null };
}

function isLocalOrigin(origin: string | null): boolean {
  if (!origin) {
    return false;
  }
  return (
    origin.startsWith('http://localhost')
    || origin.startsWith('http://127.0.0.1')
    || origin.startsWith('http://[::1]')
  );
}

function isEmulatorRuntime(): boolean {
  return (
    process.env.FUNCTIONS_EMULATOR === 'true'
    || Boolean(process.env.FIRESTORE_EMULATOR_HOST)
  );
}

function emitResolve(
  hook: NormalizedEnvConfig['onResolveEnv'],
  event: EnvResolveEvent,
): void {
  if (!hook) {
    return;
  }
  try {
    const result = hook(event);
    if (result != null && typeof (result as Promise<void>).then === 'function') {
      void (result as Promise<void>).catch(() => {
        // Never break the request path because of audit logging.
      });
    }
  } catch {
    // Swallow sync hook errors.
  }
}

/**
 * Create a configured environment runtime for one Firebase app.
 *
 * Security model (`pinned: false`, default):
 * - Hosted Origin → mapped environment DB; gated envs require `allowedEnvs` claim
 * - Public environment (typically production) → no special claims
 * - Localhost / emulator → client `appEnv` is a hint; cloud gated envs require the claim
 * - Client `appEnv` alone cannot override hosted Origin
 *
 * Security model (`pinned: true`):
 * - This deploy serves only `pinnedEnvironment` (usually via APP_ENV + dedicated SA)
 * - Origin must map to that env (or localhost/emulator hint must match it)
 * - Unknown / missing hosted Origin rejects by default
 * - Referer fallback is off by default; emulator env leaks on deploy are refused
 */
export function createEnvRuntime<
  const TEnvs extends Record<string, EnvironmentDefinition>,
>(
  config: EnvRuntimeConfig<TEnvs>,
): EnvRuntime<keyof TEnvs & string> {
  type EnvName = keyof TEnvs & string;

  const normalized = normalizeEnvConfig(config);
  const storage = new AsyncLocalStorage<RuntimeEnv>();

  function knownEnv(name: string): boolean {
    return Boolean(normalized.environments[name]);
  }

  function parseClientHint(clientEnv: unknown): AppEnvironment | null {
    if (typeof clientEnv !== 'string') {
      return null;
    }
    const raw = clientEnv.trim();
    if (!raw || !knownEnv(raw)) {
      return null;
    }
    return raw;
  }

  function buildEnv(appEnv: AppEnvironment): RuntimeEnv {
    assertNoEmulatorEnvLeak(normalized.refuseEmulatorEnvOutsideEmulator);

    const def = normalized.environments[appEnv];
    if (!def) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Unknown environment "${appEnv}".`,
      );
    }

    if (
      normalized.pinned
      && normalized.pinnedEnvironment
      && appEnv !== normalized.pinnedEnvironment
    ) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `This deploy is pinned to "${normalized.pinnedEnvironment}" and cannot serve "${appEnv}".`,
      );
    }

    return {
      appEnv,
      firestoreDatabaseId: process.env.FIRESTORE_EMULATOR_HOST
        ? '(default)'
        : def.database,
      firestoreEnvTag: appEnv,
    };
  }

  function allowedEnvsFromToken(context: EnvRequestContext): string[] {
    const token = context.auth?.token;
    if (!token) {
      return [];
    }
    const value = token[normalized.claimKey];
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((item): item is string => typeof item === 'string');
  }

  function hasEnvAccess(appEnv: AppEnvironment, context: EnvRequestContext): boolean {
    const def = normalized.environments[appEnv];
    if (!def?.requireClaim) {
      return true;
    }
    return allowedEnvsFromToken(context).includes(appEnv);
  }

  function requireEnvAccess(appEnv: AppEnvironment, context: EnvRequestContext): void {
    const def = normalized.environments[appEnv];
    if (!def?.requireClaim) {
      return;
    }
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        `Sign in required for environment "${appEnv}".`,
      );
    }
    if (!hasEnvAccess(appEnv, context)) {
      throw new functions.https.HttpsError(
        'permission-denied',
        normalized.accessDeniedMessage,
      );
    }
  }

  function baseEvent(
    origin: string | null,
    context: EnvRequestContext,
  ): Omit<EnvResolveEvent, 'ok'> {
    return {
      origin,
      uid: context.auth?.uid ?? null,
      functionName: functionNameFromEnv(),
      pinnedEnvironment: normalized.pinnedEnvironment,
    };
  }

  function reject(
    origin: string | null,
    context: EnvRequestContext,
    reason: string,
    code: 'failed-precondition' | 'unauthenticated' | 'permission-denied' = 'failed-precondition',
  ): never {
    emitResolve(normalized.onResolveEnv, {
      ...baseEvent(origin, context),
      ok: false,
      rejectedReason: reason,
    });
    throw new functions.https.HttpsError(code, reason);
  }

  function succeed(
    env: RuntimeEnv,
    origin: string | null,
    context: EnvRequestContext,
    source: EnvResolveSource,
    allowedByClaim: boolean,
  ): RuntimeEnv {
    emitResolve(normalized.onResolveEnv, {
      ...baseEvent(origin, context),
      ok: true,
      resolvedEnv: env.appEnv,
      databaseId: env.firestoreDatabaseId,
      source,
      allowedByClaim,
    });
    return env;
  }

  function resolveHintedEnv(hint: AppEnvironment | null): {
    appEnv: AppEnvironment;
    source: EnvResolveSource;
  } {
    if (normalized.pinned && normalized.pinnedEnvironment) {
      if (hint && hint !== normalized.pinnedEnvironment) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `This deploy is pinned to "${normalized.pinnedEnvironment}" and cannot serve hint "${hint}".`,
        );
      }
      return { appEnv: normalized.pinnedEnvironment, source: hint ? 'hint' : 'pinned' };
    }

    if (hint) {
      return { appEnv: hint, source: 'hint' };
    }
    const fromProcess = process.env.APP_ENV?.trim();
    if (fromProcess && knownEnv(fromProcess)) {
      return { appEnv: fromProcess, source: 'process' };
    }
    return { appEnv: normalized.publicEnvironment, source: 'public' };
  }

  function auditHttpsFailure(
    origin: string | null,
    context: EnvRequestContext,
    error: unknown,
  ): never {
    if (error instanceof functions.https.HttpsError) {
      emitResolve(normalized.onResolveEnv, {
        ...baseEvent(origin, context),
        ok: false,
        rejectedReason: error.message,
      });
    }
    throw error;
  }

  function resolveRequestEnv(clientEnv: unknown, context: EnvRequestContext): RuntimeEnv {
    const originResult = originFromContext(context, normalized.allowRefererFallback);
    if (!originResult.ok) {
      return reject(null, context, originResult.reason);
    }

    const origin = originResult.origin;
    const hint = parseClientHint(clientEnv);
    const emulator = isEmulatorRuntime();
    const local = isLocalOrigin(origin);

    if (origin) {
      const mapped = normalized.originToEnv.get(origin);
      if (mapped) {
        try {
          requireEnvAccess(mapped, context);
          const env = buildEnv(mapped);
          return succeed(
            env,
            origin,
            context,
            'origin',
            Boolean(normalized.environments[mapped]?.requireClaim),
          );
        } catch (error) {
          return auditHttpsFailure(origin, context, error);
        }
      }
    }

    // Localhost / emulator / missing Origin → client hint / pinned / public.
    if (emulator || local || !origin) {
      if (!origin && !emulator && !local && normalized.rejectUnknownOrigin) {
        return reject(origin, context, 'Missing Origin header for hosted request.');
      }

      try {
        const hinted = resolveHintedEnv(hint);
        if (!(emulator && normalized.allowEmulatorWithoutClaim)) {
          requireEnvAccess(hinted.appEnv, context);
        }
        const env = buildEnv(hinted.appEnv);
        return succeed(
          env,
          origin,
          context,
          hinted.source,
          Boolean(normalized.environments[hinted.appEnv]?.requireClaim),
        );
      } catch (error) {
        return auditHttpsFailure(origin, context, error);
      }
    }

    // Unknown hosted Origin.
    if (normalized.rejectUnknownOrigin) {
      return reject(origin, context, `Unrecognized Origin "${origin}".`);
    }

    // Do not trust client to pick a gated env on unknown hosted origins.
    const appEnv = hint && !normalized.environments[hint]?.requireClaim
      ? hint
      : normalized.publicEnvironment;
    try {
      requireEnvAccess(appEnv, context);
      const env = buildEnv(appEnv);
      return succeed(
        env,
        origin,
        context,
        hint && appEnv === hint ? 'hint' : 'public',
        Boolean(normalized.environments[appEnv]?.requireClaim),
      );
    } catch (error) {
      return auditHttpsFailure(origin, context, error);
    }
  }

  function resolveProcessEnv(clientEnv?: unknown): RuntimeEnv {
    const emptyContext: EnvRequestContext = {};
    try {
      const hinted = resolveHintedEnv(parseClientHint(clientEnv));
      const env = buildEnv(hinted.appEnv);
      return succeed(env, null, emptyContext, hinted.source, false);
    } catch (error) {
      return auditHttpsFailure(null, emptyContext, error);
    }
  }

  function resolveEnvByName(envName: EnvName): RuntimeEnv {
    const emptyContext: EnvRequestContext = {};
    if (!knownEnv(envName)) {
      return reject(null, emptyContext, `Unknown environment "${envName}".`);
    }
    if (
      normalized.pinned
      && normalized.pinnedEnvironment
      && envName !== normalized.pinnedEnvironment
    ) {
      return reject(
        null,
        emptyContext,
        `This deploy is pinned to "${normalized.pinnedEnvironment}" and cannot serve "${envName}".`,
      );
    }
    const env = buildEnv(envName);
    return succeed(env, null, emptyContext, 'process', false);
  }

  function runWithEnv<T>(env: RuntimeEnv, fn: () => Promise<T> | T): Promise<T> {
    return storage.run(env, () => Promise.resolve(fn()));
  }

  function getRuntimeEnv(): RuntimeEnv {
    const store = storage.getStore();
    if (store) {
      return store;
    }
    if (normalized.requireRequestContext) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'No active request environment. Call getDb()/getRuntimeEnv() inside a withAppEnv* wrapper, or pass an explicit env via runWithEnv()/getDbForEnv().',
      );
    }
    return resolveProcessEnv();
  }

  function getEnvTag(): EnvName {
    return getRuntimeEnv().firestoreEnvTag as EnvName;
  }

  return {
    config: normalized,
    resolveRequestEnv,
    resolveProcessEnv,
    resolveEnvByName,
    runWithEnv,
    getRuntimeEnv,
    getEnvTag,
  };
}
