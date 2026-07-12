/**
 * Per-request app environment resolution for dual Firestore databases.
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

function parseClientHint(clientEnv: unknown): AppEnvironment | null {
  if (typeof clientEnv !== 'string') {
    return null;
  }
  const raw = clientEnv.trim().toLowerCase();
  if (raw === 'qa' || raw === 'production') {
    return raw;
  }
  return null;
}

/**
 * Create a configured environment runtime for one Firebase app.
 *
 * Security model:
 * - Hosted QA origin → always QA DB; requires Auth custom claim (default `qaAccess`)
 * - Hosted prod origin → always production DB; no special claims
 * - Localhost / emulator → client `appEnv` is a hint; cloud QA requires the claim
 * - Client `appEnv` alone cannot override hosted Origin
 */
export function createEnvRuntime(config: EnvRuntimeConfig): EnvRuntime {
  const normalized = normalizeEnvConfig(config);
  const storage = new AsyncLocalStorage<RuntimeEnv>();

  function buildEnv(appEnv: AppEnvironment): RuntimeEnv {
    return {
      appEnv,
      firestoreDatabaseId: process.env.FIRESTORE_EMULATOR_HOST
        ? '(default)'
        : normalized.databases[appEnv],
      firestoreEnvTag: appEnv,
    };
  }

  function hasQaAccessClaim(context: EnvRequestContext): boolean {
    const token = context.auth?.token;
    if (!token) {
      return false;
    }
    return token[normalized.qaClaim] === true;
  }

  function requireQaAccess(context: EnvRequestContext): void {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign in required for QA.');
    }
    if (!hasQaAccessClaim(context)) {
      throw new functions.https.HttpsError('permission-denied', normalized.qaAccessDeniedMessage);
    }
  }

  function resolveRequestEnv(clientEnv: unknown, context: EnvRequestContext): RuntimeEnv {
    const origin = originFromContext(context);
    const hint = parseClientHint(clientEnv);

    if (origin && normalized.qaOrigins.includes(origin)) {
      requireQaAccess(context);
      return buildEnv('qa');
    }

    if (origin && normalized.prodOrigins.includes(origin)) {
      return buildEnv('production');
    }

    const emulator = isEmulatorRuntime();
    const local = isLocalOrigin(origin);

    if (emulator || local || !origin) {
      const wantsQa =
        hint === 'qa'
        || (hint !== 'production' && process.env.APP_ENV === 'qa');

      if (wantsQa) {
        if (!(emulator && normalized.allowEmulatorWithoutClaim)) {
          requireQaAccess(context);
        }
        return buildEnv('qa');
      }

      return buildEnv('production');
    }

    if (hint === 'qa') {
      requireQaAccess(context);
      return buildEnv('qa');
    }

    return buildEnv('production');
  }

  function resolveProcessEnv(clientEnv?: unknown): RuntimeEnv {
    const hint = parseClientHint(clientEnv);
    const appEnv = hint ?? (process.env.APP_ENV === 'qa' ? 'qa' : 'production');
    return buildEnv(appEnv);
  }

  function runWithEnv<T>(env: RuntimeEnv, fn: () => Promise<T> | T): Promise<T> {
    return storage.run(env, () => Promise.resolve(fn()));
  }

  function getRuntimeEnv(): RuntimeEnv {
    return storage.getStore() ?? resolveProcessEnv();
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
