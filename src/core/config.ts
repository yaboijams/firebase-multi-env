import type { EnvironmentDefinition, EnvRuntimeConfig } from './types.js';

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
  rejectUnknownOrigin: boolean;
  requireRequestContext: boolean;
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
    return firstPublic[0];
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

export function normalizeEnvConfig(config: EnvRuntimeConfig): NormalizedEnvConfig {
  const entries = Object.entries(config.environments);
  if (entries.length === 0) {
    throw new Error('environments must include at least one environment.');
  }

  const pinned = config.pinned ?? false;
  const publicEnvironment = resolvePublicEnvironment(
    config.environments,
    config.publicEnvironment,
  );
  const pinnedEnvironment = resolvePinnedEnvironment(
    config.environments,
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
    rejectUnknownOrigin,
    requireRequestContext,
  };
}
