import type { FirebaseApp } from 'firebase/app';
import type { Functions } from 'firebase/functions';
import type { AppEnvironment } from '../core/types.js';
import { createCallable } from './callable.js';
import { createGetClientFirestore } from './firestore.js';

export type CreateMultiEnvClientOptions = {
  app: FirebaseApp;
  functions: Functions;
  appEnv: AppEnvironment;
  databases: Record<string, string>;
  /**
   * Prefix for this build (firebase.json `prefix`, no trailing dash).
   * Prefer `prefixes` when the client knows every env's prefix map.
   */
  functionPrefix?: string;
  /**
   * Per-env function ID prefixes matching firebase.json codebase `prefix` values.
   * Example: `{ production: 'prod', qual: 'qual' }` → `qual-syncData`.
   */
  prefixes?: Record<string, string>;
};

/**
 * Convenience client kit: callable helper + Firestore getter for one build env.
 */
export function createMultiEnvClient(options: CreateMultiEnvClientOptions) {
  const { app, functions, appEnv, databases, functionPrefix, prefixes } = options;

  return {
    appEnv,
    callable: createCallable(functions, { appEnv, functionPrefix, prefixes }),
    getDb: createGetClientFirestore(app, { appEnv, databases }),
  };
}
