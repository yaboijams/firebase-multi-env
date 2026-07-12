import { getFirestore, type Firestore } from 'firebase/firestore';
import type { FirebaseApp } from 'firebase/app';
import type { AppEnvironment } from '../core/types.js';

export type CreateGetClientFirestoreOptions = {
  /** Current client build environment name. */
  appEnv: AppEnvironment;
  /** Firestore database IDs keyed by environment name. */
  databases: Record<string, string>;
};

/**
 * Return a Firestore instance for the current client env.
 * Emulator mode always uses the default database.
 */
export function createGetClientFirestore(
  app: FirebaseApp,
  options: CreateGetClientFirestoreOptions,
): () => Firestore {
  const { appEnv, databases } = options;
  const databaseId = databases[appEnv];

  if (!databaseId) {
    throw new Error(
      `No Firestore database configured for environment "${appEnv}".`,
    );
  }

  let cached: Firestore | undefined;

  return function getClientFirestore(): Firestore {
    // Prefer default DB under emulator (Node tests / SSR with FIRESTORE_EMULATOR_HOST).
    if (typeof process !== 'undefined' && process.env.FIRESTORE_EMULATOR_HOST) {
      return getFirestore(app);
    }

    if (!cached) {
      cached = databaseId === '(default)'
        ? getFirestore(app)
        : getFirestore(app, databaseId);
    }
    return cached;
  };
}
