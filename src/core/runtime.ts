/**
 * Per-request app environment resolution for multi-environment Firestore databases.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import * as functions from 'firebase-functions';
import { normalizeEnvConfig, type NormalizedEnvConfig } from './config.js';
import type {
  AppEnvironment,
  EnvRequestContext,
  EnvRuntimeConfig,
  RuntimeEnv,
} from './types.js';

export type EnvRuntime = {
  config: NormalizedEnvConfig;
  resolveRequestEnv: (clientEnv: unknown, context: EnvRequestContext) => RuntimeEnv;
  resolveProcessEnv: (clientEnv?: unknown) => RuntimeEnv;
  runWithEnv: <T>(env: RuntimeEnv, fn: () => Promise<T> | T) => Promise<T>;
  getRuntimeEnv: () => RuntimeEnv;
  getEnvTag: () => AppEnvironment;
};

function originFromContext(context: EnvRequestContext): string | null {
  const headers = context.rawRequest?.headers;
  if (!headers) {
    return null;
  }

  const originHeader = headers.origin;
  if (typeof originHeader === 'string' && originHeader.trim()) {
    return originHeader.trim().replace(/\/$/, '').toLowerCase();
  }

  const referer = headers.referer || headers.referrer;
  if (typeof referer === 'string' && referer.trim()) {
    try {
      return new URL(referer).origin.replace(/\/$/, '').toLowerCase();
    } catch {
      return null;
    }
  }

  return null;
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
 */
export function createEnvRuntime(config: EnvRuntimeConfig): EnvRuntime {
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

  function throwForUnknownOrigin(reason: string): never {
    throw new functions.https.HttpsError('failed-precondition', reason);
  }

  function resolveHintedEnv(hint: AppEnvironment | null): AppEnvironment {
    if (normalized.pinned && normalized.pinnedEnvironment) {
      if (hint && hint !== normalized.pinnedEnvironment) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `This deploy is pinned to "${normalized.pinnedEnvironment}" and cannot serve hint "${hint}".`,
        );
      }
      return normalized.pinnedEnvironment;
    }

    if (hint) {
      return hint;
    }
    const fromProcess = process.env.APP_ENV?.trim();
    if (fromProcess && knownEnv(fromProcess)) {
      return fromProcess;
    }
    return normalized.publicEnvironment;
  }

  function resolveRequestEnv(clientEnv: unknown, context: EnvRequestContext): RuntimeEnv {
    const origin = originFromContext(context);
    const hint = parseClientHint(clientEnv);
    const emulator = isEmulatorRuntime();
    const local = isLocalOrigin(origin);

    if (origin) {
      const mapped = normalized.originToEnv.get(origin);
      if (mapped) {
        requireEnvAccess(mapped, context);
        return buildEnv(mapped);
      }
    }

    // Localhost / emulator / missing Origin → client hint / pinned / public.
    if (emulator || local || !origin) {
      if (!origin && !emulator && !local && normalized.rejectUnknownOrigin) {
        throwForUnknownOrigin('Missing Origin header for hosted request.');
      }

      const appEnv = resolveHintedEnv(hint);
      if (!(emulator && normalized.allowEmulatorWithoutClaim)) {
        requireEnvAccess(appEnv, context);
      }
      return buildEnv(appEnv);
    }

    // Unknown hosted Origin.
    if (normalized.rejectUnknownOrigin) {
      throwForUnknownOrigin(`Unrecognized Origin "${origin}".`);
    }

    // Do not trust client to pick a gated env on unknown hosted origins.
    const appEnv = hint && !normalized.environments[hint]?.requireClaim
      ? hint
      : normalized.publicEnvironment;
    requireEnvAccess(appEnv, context);
    return buildEnv(appEnv);
  }

  function resolveProcessEnv(clientEnv?: unknown): RuntimeEnv {
    return buildEnv(resolveHintedEnv(parseClientHint(clientEnv)));
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
        'No active request environment. Call getDb()/getRuntimeEnv() inside a withAppEnv* wrapper, or pass an explicit env via runWithEnv().',
      );
    }
    return resolveProcessEnv();
  }

  function getEnvTag(): AppEnvironment {
    return getRuntimeEnv().firestoreEnvTag;
  }

  return {
    config: normalized,
    resolveRequestEnv,
    resolveProcessEnv,
    runWithEnv,
    getRuntimeEnv,
    getEnvTag,
  };
}
