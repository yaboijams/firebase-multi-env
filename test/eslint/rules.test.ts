import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import noBareAdminFirestore from '../../eslint/rules/no-bare-admin-firestore.js';
import requirePinnedRuntime from '../../eslint/rules/require-pinned-runtime.js';

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

describe('eslint rules', () => {
  it('no-bare-admin-firestore', () => {
    tester.run('no-bare-admin-firestore', noBareAdminFirestore, {
      valid: [
        {
          code: 'const getDb = createGetDb(runtime); const db = getDb();',
        },
      ],
      invalid: [
        {
          code: 'const db = admin.firestore();',
          errors: [{ messageId: 'bareAdmin' }],
        },
        {
          code: 'import { getFirestore } from "firebase-admin/firestore"; const db = getFirestore();',
          errors: [{ messageId: 'bareGetFirestore' }],
        },
      ],
    });
  });

  it('require-pinned-runtime', () => {
    tester.run('require-pinned-runtime', requirePinnedRuntime, {
      valid: [
        {
          code: 'createEnvRuntime({ pinned: true, environments: {} });',
        },
        {
          code: 'createEnvRuntime({ allowUnpinnedCloudDeploy: true, environments: {} });',
        },
        {
          code: 'createEnvRuntime(sharedConfig);',
        },
      ],
      invalid: [
        {
          code: 'createEnvRuntime({ environments: {} });',
          errors: [{ messageId: 'requirePinned' }],
        },
        {
          code: 'createEnvRuntime({ pinned: false, environments: {} });',
          errors: [{ messageId: 'requirePinned' }],
        },
      ],
    });
  });
});
