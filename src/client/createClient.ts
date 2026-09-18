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
  /**
   * When using `isolationMode: 'projects'`, map env → Firebase projectId.
   * If set, the initialized app's projectId must match `projectIds[appEnv]`.
   */
  projectIds?: Record<string, string>;
};

/**
 * Assert the client Firebase app is bound to the expected project for this build env.
 */
export function assertClientProjectId(
  app: FirebaseApp,
  appEnv: AppEnvironment,
  projectIds: Record<string, string>,
): void {
  const expected = projectIds[appEnv]?.trim();
  if (!expected) {
    throw new Error(
      `projectIds["${appEnv}"] is missing — required when validating client project binding.`,
    );
  }
  const actual = (app.options?.projectId ?? '').trim();
  if (!actual) {
    throw new Error(
      `Firebase app has no projectId; expected "${expected}" for env "${appEnv}".`,
    );
  }
  if (actual !== expected) {
    throw new Error(
      `Firebase app projectId is "${actual}" but env "${appEnv}" expects "${expected}".`,
    );
  }
}

/**
 * Convenience client kit: callable helper + Firestore getter for one build env.
 */
export function createMultiEnvClient(options: CreateMultiEnvClientOptions) {
  const {
    app,
    functions,
    appEnv,
    databases,
    functionPrefix,
    prefixes,
    projectIds,
  } = options;

  if (projectIds) {
    assertClientProjectId(app, appEnv, projectIds);
  }

  return {
    appEnv,
    callable: createCallable(functions, { appEnv, functionPrefix, prefixes }),
    getDb: createGetClientFirestore(app, { appEnv, databases }),
  };
}
