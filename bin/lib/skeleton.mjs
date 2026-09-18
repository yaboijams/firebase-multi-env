/**
 * Editable project skeleton for isolationMode: 'projects'.
 * Source of truth after `init --mode projects` copies it to multi-env/skeleton.json.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** @typedef {{
 *   version: number,
 *   isolationMode: 'projects',
 *   services: { firestore?: boolean, hosting?: boolean, functions?: boolean, storage?: boolean },
 *   runtimeSa: { idPattern: string, roles: string[] },
 *   deploy?: { roles?: string[] },
 *   secrets: string[],
 *   auth: { providers: string[], authorizedDomainPatterns?: string[] },
 *   syncUsers?: { claimKeys?: string[] },
 * }} ProjectSkeleton */

export const DEFAULT_SKELETON_PATH = 'multi-env/skeleton.json';

/**
 * @returns {ProjectSkeleton}
 */
export function defaultProjectSkeleton() {
  return {
    version: 1,
    isolationMode: 'projects',
    services: {
      firestore: true,
      hosting: true,
      functions: true,
      storage: true,
    },
    runtimeSa: {
      idPattern: 'fn-{env}',
      roles: [
        'roles/datastore.user',
        'roles/secretmanager.secretAccessor',
        'roles/storage.objectAdmin',
      ],
    },
    deploy: {
      roles: ['roles/firebase.admin', 'roles/iam.serviceAccountUser'],
    },
    secrets: ['STRIPE_SECRET'],
    auth: {
      providers: ['password', 'google.com'],
      authorizedDomainPatterns: [
        '{projectId}.web.app',
        '{projectId}.firebaseapp.com',
      ],
    },
    syncUsers: {
      claimKeys: [],
    },
  };
}

/**
 * @param {unknown} raw
 * @returns {ProjectSkeleton}
 */
export function validateProjectSkeleton(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('skeleton must be a JSON object');
  }
  /** @type {Record<string, any>} */
  const obj = raw;

  if (obj.isolationMode !== 'projects') {
    throw new Error('skeleton.isolationMode must be "projects"');
  }
  if (!obj.runtimeSa || typeof obj.runtimeSa !== 'object') {
    throw new Error('skeleton.runtimeSa is required');
  }
  if (!obj.runtimeSa.idPattern || typeof obj.runtimeSa.idPattern !== 'string') {
    throw new Error('skeleton.runtimeSa.idPattern is required');
  }
  if (!Array.isArray(obj.runtimeSa.roles) || obj.runtimeSa.roles.length === 0) {
    throw new Error('skeleton.runtimeSa.roles must be a non-empty array of role IDs');
  }
  for (const role of obj.runtimeSa.roles) {
    if (typeof role !== 'string' || !role.trim()) {
      throw new Error('skeleton.runtimeSa.roles entries must be non-empty strings');
    }
  }
  if (!Array.isArray(obj.secrets)) {
    throw new Error('skeleton.secrets must be an array of secret base names');
  }
  if (!obj.auth || typeof obj.auth !== 'object' || !Array.isArray(obj.auth.providers)) {
    throw new Error('skeleton.auth.providers must be an array');
  }

  return {
    version: typeof obj.version === 'number' ? obj.version : 1,
    isolationMode: 'projects',
    services: {
      firestore: obj.services?.firestore !== false,
      hosting: obj.services?.hosting !== false,
      functions: obj.services?.functions !== false,
      storage: obj.services?.storage !== false,
    },
    runtimeSa: {
      idPattern: obj.runtimeSa.idPattern,
      roles: obj.runtimeSa.roles.map((r) => String(r).trim()),
    },
    deploy: {
      roles: Array.isArray(obj.deploy?.roles)
        ? obj.deploy.roles.map((r) => String(r).trim()).filter(Boolean)
        : [],
    },
    secrets: obj.secrets
      .map((s) => String(s).trim().replace(/[^A-Za-z0-9_]/g, '_').toUpperCase())
      .filter(Boolean),
    auth: {
      providers: obj.auth.providers.map((p) => String(p).trim()).filter(Boolean),
      authorizedDomainPatterns: Array.isArray(obj.auth.authorizedDomainPatterns)
        ? obj.auth.authorizedDomainPatterns.map((p) => String(p).trim()).filter(Boolean)
        : [],
    },
    syncUsers: {
      claimKeys: Array.isArray(obj.syncUsers?.claimKeys)
        ? obj.syncUsers.claimKeys.map((k) => String(k).trim()).filter(Boolean)
        : [],
    },
  };
}

/**
 * @param {string} targetRoot
 * @param {string} [relativePath]
 * @returns {ProjectSkeleton}
 */
export function loadProjectSkeleton(targetRoot, relativePath = DEFAULT_SKELETON_PATH) {
  const full = join(targetRoot, relativePath);
  if (!existsSync(full)) {
    throw new Error(
      `Skeleton not found at ${full}. Run: npx firebase-multi-env init --mode projects`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(full, 'utf8'));
  } catch (error) {
    throw new Error(
      `Failed to parse skeleton at ${full}: ${error instanceof Error ? error.message : error}`,
    );
  }
  return validateProjectSkeleton(parsed);
}

/**
 * @param {string} idPattern
 * @param {string} envName
 * @returns {string}
 */
export function resolveSaId(idPattern, envName) {
  const lower = envName.trim().toLowerCase();
  const slug = lower === 'production' || lower === 'prod'
    ? 'prod'
    : lower.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  return idPattern.replace(/\{env\}/g, slug);
}

/**
 * Summarize skeleton for doctor / parity output.
 * @param {ProjectSkeleton} skeleton
 */
export function summarizeSkeleton(skeleton) {
  return {
    services: Object.entries(skeleton.services)
      .filter(([, on]) => on)
      .map(([name]) => name),
    runtimeRoles: skeleton.runtimeSa.roles,
    secrets: skeleton.secrets,
    authProviders: skeleton.auth.providers,
  };
}
