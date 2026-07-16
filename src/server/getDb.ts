import { getApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { assertNoEmulatorEnvLeak } from '../core/config.js';
import type { NormalizedEnvConfig } from '../core/config.js';
import type { EnvRuntime } from '../core/runtime.js';

type DbCache = Map<string, Firestore>;

function openFirestore(
  config: NormalizedEnvConfig,
  firestoreDatabaseId: string,
  appEnv: string,
  cache: DbCache,
): Firestore {
  assertNoEmulatorEnvLeak(config.refuseEmulatorEnvOutsideEmulator);

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return getFirestore();
  }

  if (
    config.pinned
    && config.pinnedEnvironment
    && appEnv !== config.pinnedEnvironment
  ) {
    throw new Error(
      `getDb() refused database for "${appEnv}"; deploy is pinned to "${config.pinnedEnvironment}".`,
    );
  }

  const allowed = config.environments[appEnv];
  if (allowed && firestoreDatabaseId !== '(default)' && firestoreDatabaseId !== allowed.database) {
    throw new Error(
      `getDb() refused unexpected database id "${firestoreDatabaseId}" for env "${appEnv}".`,
    );
  }

  let db = cache.get(firestoreDatabaseId);
  if (!db) {
    db = firestoreDatabaseId === '(default)'
      ? getFirestore()
      : getFirestore(getApp(), firestoreDatabaseId);
    try {
      db.settings({ ignoreUndefinedProperties: true });
    } catch {
      // settings may already be applied on this instance
    }
    cache.set(firestoreDatabaseId, db);
  }
  return db;
}

/**
 * Create a getDb() bound to an EnvRuntime.
 * Emulator mode always uses the default database.
 *
 * When `requireRequestContext` is enabled (default for pinned isolation),
 * calling getDb() outside a withAppEnv* wrapper throws.
 */
export function createGetDb(runtime: EnvRuntime): () => Firestore {
  const dbByDatabaseId: DbCache = new Map();

  return function getDb(): Firestore {
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      // Still require request context when configured, so jobs cannot silently
      // skip the wrapper even under the emulator.
      if (runtime.config.requireRequestContext) {
        runtime.getRuntimeEnv();
      }
      assertNoEmulatorEnvLeak(runtime.config.refuseEmulatorEnvOutsideEmulator);
      return getFirestore();
    }

    const { firestoreDatabaseId, appEnv } = runtime.getRuntimeEnv();
    return openFirestore(runtime.config, firestoreDatabaseId, appEnv, dbByDatabaseId);
  };
}

/**
 * Create an explicit per-environment Firestore accessor for scripts and
 * background jobs (no request ALS required).
 *
 * Prefer this over calling getDb() outside a withAppEnv* wrapper.
 * In pinned mode, only the pinned environment name is allowed.
 */
export function createGetDbForEnv<TEnv extends string = string>(
  runtime: EnvRuntime<TEnv>,
): (env: TEnv) => Firestore {
  const dbByDatabaseId: DbCache = new Map();

  return function getDbForEnv(env: TEnv): Firestore {
    const resolved = runtime.resolveEnvByName(env);
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      assertNoEmulatorEnvLeak(runtime.config.refuseEmulatorEnvOutsideEmulator);
      return getFirestore();
    }
    return openFirestore(
      runtime.config,
      resolved.firestoreDatabaseId,
      resolved.appEnv,
      dbByDatabaseId,
    );
  };
}
