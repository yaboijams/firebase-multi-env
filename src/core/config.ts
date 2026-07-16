import type { EnvironmentDefinition, EnvRuntimeConfig, EnvResolveEvent } from './types.js';

export type NormalizedEnvironment = {
  name: string;
  database: string;
  origins: string[];
  requireClaim: boolean;
};

export type NormalizedEnvConfig = {
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

  for (const [name, def] of entries) {
    const origins = [
      ...new Set([
        ...def.origins.map(normalizeOrigin),
        ...envOriginsOverride(name),
      ]),
    ].filter(Boolean);

    // Public env never requires a claim. All others require it unless explicitly disabled.
    const gated = name === publicEnvironment ? false : def.requireClaim !== false;

    environments[name] = {
      name,
      database: def.database,
      origins,
      requireClaim: gated,
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

  return {
    environments,
    originToEnv,
    claimKey: config.claimKey ?? 'allowedEnvs',
    publicEnvironment,
    allowEmulatorWithoutClaim: config.allowEmulatorWithoutClaim ?? true,
    accessDeniedMessage:
      config.accessDeniedMessage
      ?? `Access denied for this environment. Ask an admin to run: npx firebase-multi-env grant-env <env> -- you@email.com (then sign out and back in).`,
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
