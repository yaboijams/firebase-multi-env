import type {
  EnvironmentDefinition,
  EnvRuntimeConfig,
  EnvResolveEvent,
  IsolationMode,
} from './types.js';

export type NormalizedEnvironment = {
  name: string;
  database: string;
  origins: string[];
  requireClaim: boolean;
  projectId: string | null;
};

export type NormalizedEnvConfig = {
  isolationMode: IsolationMode;
  environments: Record<string, NormalizedEnvironment>;
  originToEnv: Map<string, string>;
  claimKey: string;
  publicEnvironment: string;
  allowEmulatorWithoutClaim: boolean;
  accessDeniedMessage: string;
  pinned: boolean;
  pinnedEnvironment: string | null;
  allowUnpinnedCloudDeploy: boolean;
  rejectUnknownOrigin: boolean;
  requireRequestContext: boolean;
  allowRefererFallback: boolean;
  refuseEmulatorEnvOutsideEmulator: boolean;
  onResolveEnv: ((event: EnvResolveEvent) => void | Promise<void>) | null;
};

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/$/, '').toLowerCase();
}

function splitOrigins(value: string | undefined): string[] {
  if (!value?.trim()) {
    return [];
  }
  return value
    .split(',')
    .map((part) => normalizeOrigin(part))
    .filter(Boolean);
}

function envOriginsOverride(envName: string): string[] {
  const key = `HOST_ORIGINS_${envName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`;
  return splitOrigins(process.env[key]);
}

function resolvePublicEnvironment(
  environments: Record<string, EnvironmentDefinition>,
  configured?: string,
): string {
  if (configured) {
    if (!environments[configured]) {
      throw new Error(`publicEnvironment "${configured}" is not defined in environments.`);
    }
    return configured;
  }

  const firstPublic = Object.entries(environments).find(([, def]) => !def.requireClaim);
  if (firstPublic) {
    return firstPublic[0]!;
  }

  const names = Object.keys(environments);
  if (names.length === 0) {
    throw new Error('environments must include at least one environment.');
  }
  return names[0]!;
}

function resolvePinnedEnvironment(
  environments: Record<string, EnvironmentDefinition>,
  pinned: boolean,
  configured?: string,
): string | null {
  if (!pinned) {
    return null;
  }

  const envName = (configured ?? process.env.APP_ENV)?.trim();
  if (!envName) {
    throw new Error(
      'pinned: true requires pinnedEnvironment or process.env.APP_ENV.',
    );
  }
  if (!environments[envName]) {
    throw new Error(`pinnedEnvironment "${envName}" is not defined in environments.`);
  }
  return envName;
}

/** Current GCP / Firebase project from process env (deploy or ADC context). */
export function getCurrentGcpProject(): string | null {
  const id = (
    process.env.GCLOUD_PROJECT
    || process.env.GCP_PROJECT
    || process.env.GOOGLE_CLOUD_PROJECT
    || ''
  ).trim();
  return id || null;
}

/** True when running as a deployed Cloud Function / Cloud Run service (not the Functions emulator). */
export function isCloudDeployedRuntime(): boolean {
  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    return false;
  }
  return Boolean(
    process.env.K_SERVICE
    || process.env.FUNCTION_TARGET
    || process.env.FUNCTION_NAME
    || process.env.X_GOOGLE_FUNCTION_NAME,
  );
}

/**
 * Throw if emulator Firestore/Auth hosts are set on a real deploy.
 * A leaked FIRESTORE_EMULATOR_HOST would otherwise silently force `(default)`.
 */
export function assertNoEmulatorEnvLeak(refuse: boolean): void {
  if (!refuse || !isCloudDeployedRuntime()) {
    return;
  }

  const leaks = [
    'FIRESTORE_EMULATOR_HOST',
    'FIREBASE_AUTH_EMULATOR_HOST',
    'FIREBASE_DATABASE_EMULATOR_HOST',
    'FIREBASE_STORAGE_EMULATOR_HOST',
  ].filter((key) => Boolean(process.env[key]?.trim()));

  if (leaks.length > 0) {
    throw new Error(
      `Emulator env var(s) set on a deployed function: ${leaks.join(', ')}. `
      + 'Unset them, or disable refuseEmulatorEnvOutsideEmulator if intentional.',
    );
  }
}

/**
 * Deployed Cloud Functions must use pinned mode (one env + SA per process).
 * Unpinned Origin→DB selection is for local/dev only.
 */
export function assertPinnedOnCloudDeploy(
  pinned: boolean,
  allowUnpinnedCloudDeploy: boolean,
): void {
  if (pinned || allowUnpinnedCloudDeploy || !isCloudDeployedRuntime()) {
    return;
  }

  throw new Error(
    'Unpinned createEnvRuntime() is not allowed on a deployed Cloud Function. '
    + 'Set pinned: true with pinnedEnvironment / APP_ENV (and a per-env service account), '
    + 'or set allowUnpinnedCloudDeploy: true only for intentional shared-runtime deploys.',
  );
}

/**
 * In projects mode, refuse serving an env whose projectId does not match this process.
 */
export function assertEnvProjectMatch(
  isolationMode: IsolationMode,
  envName: string,
  envProjectId: string | null,
): void {
  if (isolationMode !== 'projects') {
    return;
  }
  if (!envProjectId) {
    throw new Error(
      `Environment "${envName}" is missing projectId (required when isolationMode is "projects").`,
    );
  }

  // Emulator may not set GCLOUD_PROJECT to the target project.
  if (process.env.FUNCTIONS_EMULATOR === 'true' || process.env.FIRESTORE_EMULATOR_HOST) {
    return;
  }

  const current = getCurrentGcpProject();
  if (!current) {
    return;
  }
  if (current !== envProjectId) {
    throw new Error(
      `Environment "${envName}" is bound to project "${envProjectId}" but this process `
      + `is running as "${current}".`,
    );
  }
}

/**
 * On a real cloud deploy in projects mode, pinned env must match GCLOUD_PROJECT.
 */
export function assertPinnedProjectOnCloudDeploy(
  isolationMode: IsolationMode,
  pinned: boolean,
  pinnedEnvironment: string | null,
  environments: Record<string, NormalizedEnvironment>,
): void {
  if (isolationMode !== 'projects' || !pinned || !pinnedEnvironment || !isCloudDeployedRuntime()) {
    return;
  }

  const def = environments[pinnedEnvironment];
  const current = getCurrentGcpProject();
  if (!def?.projectId || !current) {
    return;
  }
  if (def.projectId !== current) {
    throw new Error(
      `Pinned environment "${pinnedEnvironment}" expects project "${def.projectId}" `
      + `but GCLOUD_PROJECT is "${current}".`,
    );
  }
}

export function normalizeEnvConfig<
  TEnvs extends Record<string, EnvironmentDefinition>,
>(
  config: EnvRuntimeConfig<TEnvs>,
): NormalizedEnvConfig {
  const entries = Object.entries(config.environments) as Array<
    [string, EnvironmentDefinition]
  >;
  if (entries.length === 0) {
    throw new Error('environments must include at least one environment.');
  }

  const isolationMode: IsolationMode = config.isolationMode ?? 'databases';
  if (isolationMode !== 'databases' && isolationMode !== 'projects') {
    throw new Error(
      `isolationMode must be "databases" or "projects" (got "${String(isolationMode)}").`,
    );
  }

  const pinned = config.pinned ?? false;
  const allowUnpinnedCloudDeploy = config.allowUnpinnedCloudDeploy ?? false;
  assertPinnedOnCloudDeploy(pinned, allowUnpinnedCloudDeploy);

  const publicEnvironment = resolvePublicEnvironment(
    config.environments as Record<string, EnvironmentDefinition>,
    config.publicEnvironment,
  );
  const pinnedEnvironment = resolvePinnedEnvironment(
    config.environments as Record<string, EnvironmentDefinition>,
    pinned,
    config.pinnedEnvironment,
  );

  const environments: Record<string, NormalizedEnvironment> = {};
  const originToEnv = new Map<string, string>();
  const seenProjectIds = new Map<string, string>();

  for (const [name, def] of entries) {
    const origins = [
      ...new Set([
        ...(def.origins ?? []).map(normalizeOrigin),
        ...envOriginsOverride(name),
      ]),
    ].filter(Boolean);

    const projectId = def.projectId?.trim() || null;
    if (isolationMode === 'projects') {
      if (!projectId) {
        throw new Error(
          `Environment "${name}" requires projectId when isolationMode is "projects".`,
        );
      }
      const owner = seenProjectIds.get(projectId);
      if (owner && owner !== name) {
        throw new Error(
          `projectId "${projectId}" is mapped to both "${owner}" and "${name}".`,
        );
      }
      seenProjectIds.set(projectId, name);
    }

    const database = (def.database?.trim() || (isolationMode === 'projects' ? '(default)' : ''));
    if (!database) {
      throw new Error(
        `Environment "${name}" requires database when isolationMode is "databases".`,
      );
    }

    // databases mode: public never requires claim; others require unless explicitly false.
    // projects mode: Auth pool is the gate — requireClaim only when explicitly true.
    let requireClaim: boolean;
    if (isolationMode === 'projects') {
      requireClaim = def.requireClaim === true;
    } else {
      requireClaim = name === publicEnvironment ? false : def.requireClaim !== false;
    }

    environments[name] = {
      name,
      database,
      origins,
      requireClaim,
      projectId,
    };

    for (const origin of origins) {
      const existing = originToEnv.get(origin);
      if (existing && existing !== name) {
        throw new Error(
          `Origin "${origin}" is mapped to both "${existing}" and "${name}".`,
        );
      }
      originToEnv.set(origin, name);
    }
  }

  const rejectUnknownOrigin =
    config.rejectUnknownOrigin ?? pinned;

  const requireRequestContext =
    config.requireRequestContext ?? pinned;

  const allowRefererFallback =
    config.allowRefererFallback ?? !pinned;

  const refuseEmulatorEnvOutsideEmulator =
    config.refuseEmulatorEnvOutsideEmulator ?? pinned;

  assertNoEmulatorEnvLeak(refuseEmulatorEnvOutsideEmulator);
  assertPinnedProjectOnCloudDeploy(
    isolationMode,
    pinned,
    pinnedEnvironment,
    environments,
  );

  const defaultAccessDenied = isolationMode === 'projects'
    ? `Access denied for this environment. Ask an admin to run: npx firebase-multi-env sync-users --emails you@email.com --envs <env> (then sign out and back in).`
    : `Access denied for this environment. Ask an admin to run: npx firebase-multi-env grant-env <env> -- you@email.com (then sign out and back in).`;

  return {
    isolationMode,
    environments,
    originToEnv,
    claimKey: config.claimKey ?? 'allowedEnvs',
    publicEnvironment,
    allowEmulatorWithoutClaim: config.allowEmulatorWithoutClaim ?? true,
    accessDeniedMessage: config.accessDeniedMessage ?? defaultAccessDenied,
    pinned,
    pinnedEnvironment,
    allowUnpinnedCloudDeploy,
    rejectUnknownOrigin,
    requireRequestContext,
    allowRefererFallback,
    refuseEmulatorEnvOutsideEmulator,
    onResolveEnv: config.onResolveEnv ?? null,
  };
}
