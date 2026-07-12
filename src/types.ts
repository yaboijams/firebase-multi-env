export type AppEnvironment = string;

export type EnvironmentDefinition = {
  /** Firestore database ID for this environment */
  database: string;
  /** Hosting origins that map to this environment (normalized, no trailing slash) */
  origins: string[];
  /**
   * When true, Auth custom claim allowlist must include this env name.
   * Omit or false for public environments (typically production).
   */
  requireClaim?: boolean;
};

export type RuntimeEnv = {
  appEnv: AppEnvironment;
  firestoreDatabaseId: string;
  firestoreEnvTag: AppEnvironment;
};

export type EnvRuntimeConfig = {
  /** Named environments (keys are env names used in claims and client hints) */
  environments: Record<string, EnvironmentDefinition>;
  /**
   * Auth custom claim key holding an array of allowed env names.
   * @default 'allowedEnvs'
   */
  claimKey?: string;
  /**
   * Environment that does not require a claim.
   * Defaults to the first env with `requireClaim !== true`.
   */
  publicEnvironment?: string;
  /**
   * When running under Firebase emulators, skip the allowlist claim check.
   * @default true
   */
  allowEmulatorWithoutClaim?: boolean;
  /**
   * Message shown when gated-env access is denied.
   */
  accessDeniedMessage?: string;
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
