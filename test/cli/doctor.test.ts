import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  hasBareAdminFirestore,
  fileHasUnpinnedRuntime,
  runDoctor,
} from '../../bin/lib/doctor.mjs';

describe('doctor helpers', () => {
  it('detects bare admin.firestore', () => {
    expect(hasBareAdminFirestore('const db = admin.firestore();')).toBe(true);
    expect(
      hasBareAdminFirestore(`
        import { getFirestore } from 'firebase-admin/firestore';
        const db = getFirestore();
      `),
    ).toBe(true);
    expect(
      hasBareAdminFirestore(`
        import { createGetDb } from 'firebase-multi-env/server';
        const getDb = createGetDb(runtime);
      `),
    ).toBe(false);
  });

  it('detects unpinned createEnvRuntime files', () => {
    expect(
      fileHasUnpinnedRuntime(`
        createEnvRuntime({ environments: {} });
      `),
    ).toBe(true);
    expect(
      fileHasUnpinnedRuntime(`
        createEnvRuntime({ pinned: true, environments: {} });
      `),
    ).toBe(false);
  });
});

describe('runDoctor', () => {
  let root = '';

  afterEach(() => {
    if (root) {
      rmSync(root, { recursive: true, force: true });
      root = '';
    }
  });

  function fixture(files: Record<string, string>) {
    root = mkdtempSync(join(tmpdir(), 'fme-doctor-'));
    for (const [rel, body] of Object.entries(files)) {
      const full = join(root, rel);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, body);
    }
    return root;
  }

  it('warns on unpinned runtime in default mode', () => {
    const dir = fixture({
      'functions/index.ts': `
        import { createEnvRuntime, createGetDb } from 'firebase-multi-env/server';
        export const appEnvRuntime = createEnvRuntime({
          environments: { production: { database: '(default)', origins: ['https://x.web.app'] } },
        });
        export const getDb = createGetDb(appEnvRuntime);
      `,
    });

    const result = runDoctor({ targetRoot: dir, strict: false });
    expect(result.findings.some((f) => f.code === 'unpinned')).toBe(true);
    expect(result.exitCode).toBe(1);
  });

  it('passes strict when project-parity signals are present', () => {
    const dir = fixture({
      'functions/index.ts': `
        import { createEnvRuntime, createGetDb, createGetDbForEnv } from 'firebase-multi-env/server';
        import { createWithAppEnvHttp } from 'firebase-multi-env/http';
        export const appEnvRuntime = createEnvRuntime({
          pinned: true,
          pinnedEnvironment: process.env.APP_ENV,
          onResolveEnv: () => {},
          environments: {
            production: { database: '(default)', origins: ['https://x.web.app'] },
            qual: { database: 'qual-env', origins: ['https://q.web.app'], requireClaim: true },
          },
        });
        export const getDb = createGetDb(appEnvRuntime);
        export const getDbForEnv = createGetDbForEnv(appEnvRuntime);
        export const withHttp = createWithAppEnvHttp(appEnvRuntime, { verifyIdToken: true });
        export const opts = { serviceAccount: 'fn-qual@x.iam.gserviceaccount.com' };
      `,
      'multi-env/PROJECT_PARITY.md': '# parity',
      'multi-env/secrets-per-env.md': '# secrets Secret Manager',
      'multi-env/deploy-isolation.md': '# WIF deploy',
      'multi-env/storage.gated.rules.snippet': 'match /b/{bucket}/o {}',
      '.github/workflows/deploy.yml': 'APP_ENV=qual\nfirebase deploy',
    });

    const result = runDoctor({ targetRoot: dir, strict: true });
    const failures = result.findings.filter(
      (f) => f.level === 'error' || f.level === 'warn',
    );
    expect(failures).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  it('fails strict on bare admin firestore', () => {
    const dir = fixture({
      'functions/index.ts': `
        import * as admin from 'firebase-admin';
        import { createEnvRuntime } from 'firebase-multi-env/server';
        export const appEnvRuntime = createEnvRuntime({
          pinned: true,
          pinnedEnvironment: 'qual',
          environments: {
            qual: { database: 'qual-env', origins: ['https://q.web.app'], requireClaim: true },
          },
        });
        const db = admin.firestore();
        export const opts = { serviceAccount: 'fn-qual@x.iam.gserviceaccount.com' };
      `,
      'multi-env/PROJECT_PARITY.md': '# parity',
      'multi-env/secrets-per-env.md': 'Secret Manager',
      'multi-env/deploy-isolation.md': 'WIF',
      '.github/workflows/deploy.yml': 'APP_ENV=qual firebase deploy',
    });

    const result = runDoctor({ targetRoot: dir, strict: true });
    expect(result.findings.some((f) => f.code === 'bare-admin-firestore' && f.level === 'error')).toBe(
      true,
    );
    expect(result.exitCode).toBe(1);
  });
});
