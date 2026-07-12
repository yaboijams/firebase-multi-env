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
};

/**
 * Convenience client kit: callable helper + Firestore getter for one build env.
 */
export function createMultiEnvClient(options: CreateMultiEnvClientOptions) {
  const { app, functions, appEnv, databases } = options;

  return {
    appEnv,
    callable: createCallable(functions, { appEnv }),
    getDb: createGetClientFirestore(app, { appEnv, databases }),
  };
}
