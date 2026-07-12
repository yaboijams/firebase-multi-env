export type AppEnvironment = 'qa' | 'production';

export type RuntimeEnv = {
  appEnv: AppEnvironment;
  firestoreDatabaseId: string;
  firestoreEnvTag: AppEnvironment;
};

export type EnvRuntimeConfig = {
  /** Firestore database IDs per environment */
  databases: Record<AppEnvironment, string>;
  /** Hosting origins that always map to QA (normalized, no trailing slash) */
  qaOrigins: string[];
  /** Hosting origins that always map to production */
  prodOrigins: string[];
  /**
   * Auth custom claim required for QA.
   * Production users never need this claim.
   * @default 'qaAccess'
   */
  qaClaim?: string;
  /**
   * When running under Firebase emulators, skip the QA claim check.
   * @default true
   */
  allowEmulatorWithoutClaim?: boolean;
  /**
   * Message shown when QA claim is missing.
   */
  qaAccessDeniedMessage?: string;
};

export type RequestLike = {
  headers?: Record<string, string | string[] | undefined>;
};

/** Minimal auth shape shared by Functions v1 context and v2 request.auth */
export type AuthLike = {
  uid: string;
  token?: Record<string, unknown>;
} | null | undefined;

export type EnvRequestContext = {
  auth?: AuthLike;
  /** v1: context.rawRequest; v2: request.rawRequest */
  rawRequest?: RequestLike;
};
