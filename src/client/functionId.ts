import type { AppEnvironment } from '../core/types.js';

/**
 * Options for resolving a deployed Cloud Function ID when using firebase.json
 * `functions[].prefix` (Firebase joins as `${prefix}-${exportName}`).
 */
export type FunctionPrefixOptions = {
  appEnv: AppEnvironment;
  /**
   * Prefix for this build only (firebase.json `prefix` value, without a trailing dash).
   * Example: `"qual"` → `syncData` becomes `qual-syncData`.
   */
  functionPrefix?: string;
  /**
   * Per-env prefixes matching each codebase's firebase.json `prefix`.
   * When set, `prefixes[appEnv]` wins over `functionPrefix`.
   */
  prefixes?: Record<string, string>;
};

/** Firebase CLI prefix: lowercase letter start; letters, numbers, dashes; no leading/trailing dash; ≤30. */
const FIREBASE_PREFIX_RE = /^[a-z](?:[a-z0-9-]{0,28}[a-z0-9])?$/;

/**
 * Validate a firebase.json-style function prefix (the value before Firebase inserts `-`).
 */
export function isValidFunctionPrefix(prefix: string): boolean {
  if (!prefix) {
    return true;
  }
  if (prefix.length > 30) {
    return false;
  }
  return FIREBASE_PREFIX_RE.test(prefix);
}

/**
 * Resolve the callable / HTTP function ID the client must invoke.
 *
 * Matches Firebase CLI `applyPrefix`: `${prefix}-${name}` when a prefix is set.
 * If `name` is already prefixed, it is returned unchanged.
 */
export function resolveFunctionId(name: string, options: FunctionPrefixOptions): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Function name must be a non-empty string.');
  }

  const prefix = (
    options.prefixes?.[options.appEnv]
    ?? options.functionPrefix
    ?? ''
  ).trim();

  if (!prefix) {
    return trimmed;
  }

  if (!isValidFunctionPrefix(prefix)) {
    throw new Error(
      `Invalid functionPrefix "${prefix}". Use a firebase.json prefix `
      + '(lowercase letter start; letters, numbers, dashes; no leading/trailing dash; max 30).',
    );
  }

  const deployed = `${prefix}-${trimmed}`;
  if (trimmed === deployed || trimmed.startsWith(`${prefix}-`)) {
    return trimmed;
  }

  return deployed;
}
