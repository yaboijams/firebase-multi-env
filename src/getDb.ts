import { getApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { EnvRuntime } from './runtimeEnv.js';

/**
 * Create a getDb() bound to an EnvRuntime.
 * Emulator mode always uses the default database.
 */
export function createGetDb(runtime: EnvRuntime): () => Firestore {
  const dbByDatabaseId = new Map<string, Firestore>();

  return function getDb(): Firestore {
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      return getFirestore();
    }

    const { firestoreDatabaseId } = runtime.getRuntimeEnv();
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
