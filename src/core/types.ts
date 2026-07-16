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
  /**
   * When true, this deploy is bound to one env/SA; Origin confirms, never cross-selects.
   * When false/omitted, one runtime may serve many envs and Origin selects the DB.
   * @default false
   */
  pinned?: boolean;
  /**
   * Environment this deploy is allowed to serve when `pinned` is true.
   * Defaults to `process.env.APP_ENV` when omitted.
   */
  pinnedEnvironment?: string;
  /**
   * When true, unknown or missing hosted Origin throws `failed-precondition`.
   * When false, fall back to `publicEnvironment` (legacy logical behavior).
   * Defaults to `true` when `pinned` is true, otherwise `false`.
   */
  rejectUnknownOrigin?: boolean;
  /**
   * When true, `getRuntimeEnv()` / `getDb()` throw outside an active request ALS store
   * instead of silently resolving process/public defaults.
   * Defaults to `true` when `pinned` is true, otherwise `false`.
   */
  requireRequestContext?: boolean;
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
