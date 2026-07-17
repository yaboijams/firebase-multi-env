import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bucketForEnv,
  buildProvisionFiles,
  databaseForEnv,
  parseEnvs,
  parseProvisionArgs,
  parseSecrets,
  saIdForEnv,
  secretSuffixForEnv,
} from '../../bin/lib/provision.mjs';

describe('provision helpers', () => {
  it('maps production to fn-prod and (default) database', () => {
    expect(saIdForEnv('production')).toBe('fn-prod');
    expect(saIdForEnv('prod')).toBe('fn-prod');
    expect(databaseForEnv('production', 'my-app')).toBe('(default)');
    expect(bucketForEnv('production', 'my-app')).toBe('my-app-prod');
    expect(secretSuffixForEnv('production')).toBe('PROD');
  });

  it('maps gated envs to slug SA / db / bucket', () => {
    expect(saIdForEnv('qual')).toBe('fn-qual');
    expect(databaseForEnv('qual', 'my-app')).toBe('qual-env');
    expect(bucketForEnv('qual', 'my-app')).toBe('my-app-qual');
    expect(secretSuffixForEnv('qual')).toBe('QUAL');
  });

  it('parses env list with optional database overrides', () => {
    const envs = parseEnvs('production:(default),qual:qual-env', 'my-app');
    expect(envs).toHaveLength(2);
    expect(envs[0]).toMatchObject({
      name: 'production',
      saId: 'fn-prod',
      database: '(default)',
      bucket: 'my-app-prod',
    });
    expect(envs[1]).toMatchObject({
      name: 'qual',
      saId: 'fn-qual',
      database: 'qual-env',
      bucket: 'my-app-qual',
    });
  });

  it('rejects duplicate envs', () => {
    expect(() => parseEnvs('qual,qual', 'my-app')).toThrow(/Duplicate/);
  });

  it('parses secret base names', () => {
    expect(parseSecrets(undefined)).toEqual(['STRIPE_SECRET']);
    expect(parseSecrets('stripe-secret, SendGrid')).toEqual([
      'STRIPE_SECRET',
      'SENDGRID',
    ]);
  });

  it('parses CLI args', () => {
    const opts = parseProvisionArgs([
      '--project',
      'my-app',
      '--envs',
      'production,qual',
      '--secrets',
      'STRIPE_SECRET',
      '--print',
    ]);
    expect(opts.projectId).toBe('my-app');
    expect(opts.envsRaw).toBe('production,qual');
    expect(opts.printOnly).toBe(true);
  });
});

describe('buildProvisionFiles', () => {
  let root = '';

  afterEach(() => {
    if (root) {
      rmSync(root, { recursive: true, force: true });
      root = '';
    }
  });

  it('writes per-env scripts, all script, and README', () => {
    root = mkdtempSync(join(tmpdir(), 'fme-provision-'));
    const outDir = join(root, 'multi-env', 'provision');

    const result = buildProvisionFiles({
      projectId: 'my-app',
      envsRaw: 'production,qual',
      secretsRaw: 'STRIPE_SECRET,SENDGRID',
      outDir,
    });

    expect(result.envs.map((e) => e.name)).toEqual(['production', 'qual']);
    expect(result.files.map((f) => f.path)).toEqual([
      join(outDir, 'provision.production.sh'),
      join(outDir, 'provision.qual.sh'),
      join(outDir, 'provision.all.sh'),
      join(outDir, 'README.md'),
    ]);

    const qual = readFileSync(join(outDir, 'provision.qual.sh'), 'utf8');
    expect(qual).toContain('fn-qual@my-app.iam.gserviceaccount.com');
    expect(qual).toContain('gcloud iam service-accounts create');
    expect(qual).toContain('BUCKET="my-app-qual"');
    expect(qual).toContain('gs://${BUCKET}');
    expect(qual).toContain('STRIPE_SECRET_QUAL');
    expect(qual).toContain('SENDGRID_QUAL');
    expect(qual).toContain('roles/datastore.user');
    expect(qual).toContain('roles/storage.objectAdmin');
    expect(qual).toContain('Do NOT grant');
    expect(qual).toContain('STRIPE_SECRET_PROD');
    expect(qual).toContain('gs://my-app-prod');

    const prod = readFileSync(join(outDir, 'provision.production.sh'), 'utf8');
    expect(prod).toContain('(default)');
    expect(prod).toContain('fn-prod@');
    expect(prod).toContain('STRIPE_SECRET_PROD');

    const all = readFileSync(join(outDir, 'provision.all.sh'), 'utf8');
    expect(all).toContain('provision.production.sh');
    expect(all).toContain('provision.qual.sh');
    expect(all).toContain('grant-env');

    const readme = readFileSync(join(outDir, 'README.md'), 'utf8');
    expect(readme).toContain('my-app');
    expect(readme).toContain('shared');
  });

  it('printOnly does not write files', () => {
    root = mkdtempSync(join(tmpdir(), 'fme-provision-print-'));
    const outDir = join(root, 'out');
    mkdirSync(outDir, { recursive: true });

    const result = buildProvisionFiles({
      projectId: 'my-app',
      envsRaw: 'qual',
      outDir,
      printOnly: true,
    });

    expect(result.files).toHaveLength(3);
    expect(() => readFileSync(join(outDir, 'provision.qual.sh'), 'utf8')).toThrow();
  });

  it('requires project and envs', () => {
    expect(() =>
      buildProvisionFiles({ projectId: '', envsRaw: 'qual' }),
    ).toThrow(/project id/i);
    expect(() =>
      parseProvisionArgs(['--project', 'x']),
    ).toThrow(/--envs/);
  });
});
