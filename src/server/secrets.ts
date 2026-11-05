import { defineSecret } from 'firebase-functions/params';

/** Return type of `defineSecret` (SecretParam is not a public export). */
type SecretParam = ReturnType<typeof defineSecret>;

export type SecretSpec =
  | string
  | {
      /** Logical name passed to `defineSecret` (and firebase.json `prefix`). */
      name: string;
      /**
       * Extra `process.env` keys to try before the SecretParam value.
       * Useful for local `.env` aliases (`STRIPE_SECRET_KEY`) or legacy names.
       */
      envKeys?: string[];
    };

export type SecretsBundle = {
  /** Logical secret names (defineSecret ids). */
  names: string[];
  /** Mount on `onRequest` / `onCall` via `secrets: bundle.params`. */
  params: SecretParam[];
  /** Look up a mounted `SecretParam` by logical name. */
  param(name: string): SecretParam;
  /** Read a secret; prefers `process.env`, then SecretParam `.value()`. */
  get(name: string): string | undefined;
  /** Like `get`, but throws if missing/empty. */
  require(name: string): string;
};

function normalizeSpec(spec: SecretSpec): { name: string; envKeys: string[] } {
  if (typeof spec === 'string') {
    const name = spec.trim();
    if (!name) {
      throw new Error('createSecrets: secret name must be non-empty');
    }
    return { name, envKeys: [name] };
  }
  const name = spec.name?.trim();
  if (!name) {
    throw new Error('createSecrets: secret name must be non-empty');
  }
  const extras = (spec.envKeys ?? []).map((key) => key.trim()).filter(Boolean);
  const envKeys = [name, ...extras.filter((key) => key !== name)];
  return { name, envKeys };
}

function readEnv(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }
  }
  return undefined;
}

/**
 * Bind skeleton / Secret Manager secrets for Cloud Functions + local `.env`.
 *
 * Cloud: mount `params` on the function; Firebase injects values at runtime.
 * Local: set the same names (or `envKeys` aliases) in `functions/config/<env>/.env`.
 *
 * Secret Manager resource ids must match firebase.json `prefix` + logical name
 * (e.g. prefix `qual` + `STRIPE_SECRET` → `qual-STRIPE_SECRET`). See
 * `templates/secrets-per-env.md`.
 *
 * @example
 * ```ts
 * const secrets = createSecrets([
 *   { name: 'STRIPE_SECRET', envKeys: ['STRIPE_SECRET_KEY'] },
 * ]);
 *
 * export const api = onRequest({ secrets: secrets.params }, handler);
 * const key = secrets.require('STRIPE_SECRET');
 * ```
 */
export function createSecrets(specs: readonly SecretSpec[]): SecretsBundle {
  if (!Array.isArray(specs) || specs.length === 0) {
    throw new Error('createSecrets: pass at least one secret name');
  }

  const normalized = specs.map(normalizeSpec);
  const seen = new Set<string>();
  for (const row of normalized) {
    if (seen.has(row.name)) {
      throw new Error(`createSecrets: duplicate secret "${row.name}"`);
    }
    seen.add(row.name);
  }

  const params = normalized.map((row) => defineSecret(row.name));
  const byName = new Map(normalized.map((row, index) => [row.name, { ...row, param: params[index]! }]));

  return {
    names: normalized.map((row) => row.name),
    params,
    param(name: string) {
      const row = byName.get(name);
      if (!row) {
        throw new Error(`createSecrets: unknown secret "${name}"`);
      }
      return row.param;
    },
    get(name: string) {
      const row = byName.get(name);
      if (!row) {
        throw new Error(`createSecrets: unknown secret "${name}"`);
      }
      const fromEnv = readEnv(row.envKeys);
      if (fromEnv !== undefined) {
        return fromEnv;
      }
      try {
        const value = row.param.value();
        return typeof value === 'string' && value.trim() !== '' ? value : undefined;
      } catch {
        return undefined;
      }
    },
    require(name: string) {
      const value = this.get(name);
      if (value === undefined) {
        throw new Error(
          `Missing secret "${name}". Mount secrets.params on the function, or set ${name} in the local env.`,
        );
      }
      return value;
    },
  };
}

/**
 * Firebase CLI / codebase `prefix` for an app env name.
 * `production` → `prod`; other envs keep a slug (`qual` → `qual`).
 */
export function functionPrefixForEnv(envName: string): string {
  const lower = envName.trim().toLowerCase();
  if (lower === 'production' || lower === 'prod') {
    return 'prod';
  }
  return lower.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-') || 'env';
}

/**
 * Secret Manager resource id when using firebase.json `prefix` + `defineSecret(name)`.
 * Example: `secretResourceId('qual', 'STRIPE_SECRET')` → `qual-STRIPE_SECRET`.
 */
export function secretResourceId(envNameOrPrefix: string, logicalName: string): string {
  const name = logicalName.trim();
  if (!name) {
    throw new Error('secretResourceId: logicalName must be non-empty');
  }
  // If caller already passed a short prefix (prod/qual), don't re-slug as env.
  const prefix =
    envNameOrPrefix === 'prod' || envNameOrPrefix === 'qual' || envNameOrPrefix === 'cert'
      ? envNameOrPrefix
      : functionPrefixForEnv(envNameOrPrefix);
  return `${prefix}-${name}`;
}
