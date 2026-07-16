/**
 * ESLint plugin: firebase-multi-env
 *
 * Usage (flat config):
 *   import multiEnv from 'firebase-multi-env/eslint';
 *   export default [
 *     { plugins: { 'firebase-multi-env': multiEnv },
 *       rules: {
 *         'firebase-multi-env/no-bare-admin-firestore': 'error',
 *         'firebase-multi-env/require-pinned-runtime': 'error',
 *       },
 *     },
 *   ];
 */

import noBareAdminFirestore from './rules/no-bare-admin-firestore.js';
import requirePinnedRuntime from './rules/require-pinned-runtime.js';

const plugin = {
  meta: {
    name: 'firebase-multi-env',
    version: '1.0.0',
  },
  rules: {
    'no-bare-admin-firestore': noBareAdminFirestore,
    'require-pinned-runtime': requirePinnedRuntime,
  },
  configs: {
    recommended: {
      plugins: ['firebase-multi-env'],
      rules: {
        'firebase-multi-env/no-bare-admin-firestore': 'error',
        'firebase-multi-env/require-pinned-runtime': 'error',
      },
    },
  },
};

export default plugin;
