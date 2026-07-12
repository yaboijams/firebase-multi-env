import type { EnvRuntimeConfig } from './types.js';

export type NormalizedEnvConfig = Required<
  Pick<
    EnvRuntimeConfig,
    | 'databases'
    | 'qaOrigins'
    | 'prodOrigins'
    | 'qaClaim'
    | 'allowEmulatorWithoutClaim'
    | 'qaAccessDeniedMessage'
  >
>;

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

export function normalizeEnvConfig(config: EnvRuntimeConfig): NormalizedEnvConfig {
  const qaFromEnv = splitOrigins(process.env.QA_HOST_ORIGINS);
  const prodFromEnv = splitOrigins(process.env.PROD_HOST_ORIGINS);

  return {
    databases: {
      qa: config.databases.qa,
      production: config.databases.production,
    },
    qaOrigins: [...new Set([...config.qaOrigins.map(normalizeOrigin), ...qaFromEnv])],
    prodOrigins: [...new Set([...config.prodOrigins.map(normalizeOrigin), ...prodFromEnv])],
    qaClaim: config.qaClaim ?? 'qaAccess',
    allowEmulatorWithoutClaim: config.allowEmulatorWithoutClaim ?? true,
    qaAccessDeniedMessage:
      config.qaAccessDeniedMessage
      ?? 'QA access required. Ask an admin to run: npx firebase-app-env grant-qa -- you@email.com (then sign out and back in).',
  };
}
