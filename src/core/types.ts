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

/** How the runtime selected (or tried to select) an environment. */
export type EnvResolveSource =
  | 'origin'
  | 'hint'
  | 'process'
  | 'public'
  | 'pinned';

/**
 * Audit event for environment resolution.
 * Fired for successful resolves and for rejections (when `ok` is false).
 */
export type EnvResolveEvent = {
  ok: boolean;
  resolvedEnv?: AppEnvironment;
  origin: string | null;
  uid: string | null;
  functionName: string | null;
  pinnedEnvironment: string | null;
  databaseId?: string;
  source?: EnvResolveSource;
  allowedByClaim?: boolean;
  rejectedReason?: string;
};

export type EnvRuntimeConfig<
  TEnvs extends Record<string, EnvironmentDefinition> = Record<string, EnvironmentDefinition>,
> = {
  /** Named environments (keys are env names used in claims and client hints) */
  environments: TEnvs;
  /**
   * Auth custom claim key holding an array of allowed env names.
   * @default 'allowedEnvs'
   */
  claimKey?: string;
  /**
   * Environment that does not require a claim.
   * Defaults to the first env with `requireClaim !== true`.
   */
  publicEnvironment?: keyof TEnvs & string;
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
   * Unpinned is for local/dev only — deployed Cloud Functions require `pinned: true`
   * unless `allowUnpinnedCloudDeploy` is set.
   * @default false
   */
  pinned?: boolean;
  /**
   * Environment this deploy is allowed to serve when `pinned` is true.
   * Defaults to `process.env.APP_ENV` when omitted.
   */
  pinnedEnvironment?: keyof TEnvs & string;
  /**
   * Escape hatch: allow `pinned: false` on a real Cloud Functions / Cloud Run deploy.
   * Production isolation expects pinned + per-env service accounts; leave this unset.
   * @default false
   */
  allowUnpinnedCloudDeploy?: boolean;
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
  /**
   * When true, missing Origin may fall back to the Referer header (dev convenience).
   * Defaults to `false` when `pinned` is true, otherwise `true` for backward compatibility.
   * Referer is not a security boundary — keep this off in hardened deploys.
   */
  allowRefererFallback?: boolean;
  /**
   * When true, refuse `FIRESTORE_EMULATOR_HOST` (and friends) on a deployed Cloud Function.
   * Prevents a leaked emulator env var from silently routing all DBs to `(default)`.
   * Defaults to `true` when `pinned` is true, otherwise `false`.
   */
  refuseEmulatorEnvOutsideEmulator?: boolean;
  /**
   * Optional audit hook invoked on every resolve attempt (success or rejection).
   * Errors from the hook are swallowed so they cannot break the request path.
   */
  onResolveEnv?: (event: EnvResolveEvent) => void | Promise<void>;
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
