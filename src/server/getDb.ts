import { getApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { EnvRuntime } from '../core/runtime.js';

/**
 * Create a getDb() bound to an EnvRuntime.
 * Emulator mode always uses the default database.
 *
 * When `requireRequestContext` is enabled (default for pinned isolation),
 * calling getDb() outside a withAppEnv* wrapper throws.
 */
export function createGetDb(runtime: EnvRuntime): () => Firestore {
  const dbByDatabaseId = new Map<string, Firestore>();

  return function getDb(): Firestore {
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      // Still require request context when configured, so jobs cannot silently
      // skip the wrapper even under the emulator.
      if (runtime.config.requireRequestContext) {
        runtime.getRuntimeEnv();
      }
      return getFirestore();
    }

    const { firestoreDatabaseId, appEnv } = runtime.getRuntimeEnv();

    if (
      runtime.config.pinned
      && runtime.config.pinnedEnvironment
      && appEnv !== runtime.config.pinnedEnvironment
    ) {
      throw new Error(
        `getDb() refused database for "${appEnv}"; deploy is pinned to "${runtime.config.pinnedEnvironment}".`,
      );
    }

    const allowed = runtime.config.environments[appEnv];
    if (allowed && firestoreDatabaseId !== '(default)' && firestoreDatabaseId !== allowed.database) {
      throw new Error(
        `getDb() refused unexpected database id "${firestoreDatabaseId}" for env "${appEnv}".`,
      );
    }

    let db = dbByDatabaseId.get(firestoreDatabaseId);
    if (!db) {
      db = firestoreDatabaseId === '(default)'
        ? getFirestore()
        : getFirestore(getApp(), firestoreDatabaseId);
      try {
        db.settings({ ignoreUndefinedProperties: true });
      } catch {
        // settings may already be applied on this instance
      }
      dbByDatabaseId.set(firestoreDatabaseId, db);
    }
    return db;
  };
}
