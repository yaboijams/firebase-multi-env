import { describe, expect, it } from 'vitest';
import {
  defaultProjectSkeleton,
  resolveSaId,
  validateProjectSkeleton,
} from '../../bin/lib/skeleton.mjs';
import {
  buildProjectProvisionFiles,
  parseProjectEnvs,
  parseProvisionArgs,
} from '../../bin/lib/provision.mjs';
import { parseParityArgs, buildParityFiles } from '../../bin/lib/parity.mjs';
import { assertClientProjectId } from '../../src/client/createClient.js';

describe('skeleton', () => {
  it('validates the default skeleton', () => {
    const skeleton = validateProjectSkeleton(defaultProjectSkeleton());
    expect(skeleton.isolationMode).toBe('projects');
    expect(skeleton.runtimeSa.roles.length).toBeGreaterThan(0);
  });

  it('rejects missing roles', () => {
    expect(() =>
      validateProjectSkeleton({
        ...defaultProjectSkeleton(),
        runtimeSa: { idPattern: 'fn-{env}', roles: [] },
      }),
    ).toThrow(/roles/);
  });

  it('resolves SA id pattern', () => {
    expect(resolveSaId('fn-{env}', 'production')).toBe('fn-prod');
    expect(resolveSaId('runtime-{env}', 'qual')).toBe('runtime-qual');
  });
});

describe('projects provision', () => {
  it('parses name:projectId envs', () => {
    const envs = parseProjectEnvs('production:app-prod,qual:app-qual');
    expect(envs).toHaveLength(2);
    expect(envs[0]).toMatchObject({ name: 'production', projectId: 'app-prod' });
    expect(envs[1]).toMatchObject({ name: 'qual', projectId: 'app-qual' });
  });

  it('rejects duplicate project ids', () => {
    expect(() => parseProjectEnvs('a:same,b:same')).toThrow(/Duplicate projectId/);
  });

  it('parses --mode projects', () => {
    const opts = parseProvisionArgs([
      '--mode',
      'projects',
      '--envs',
      'production:app-prod,qual:app-qual',
      '--print',
    ]);
    expect(opts.mode).toBe('projects');
    expect(opts.printOnly).toBe(true);
  });

  it('builds project provision files from skeleton', () => {
    const skeleton = defaultProjectSkeleton();
    const result = buildProjectProvisionFiles({
      envsRaw: 'production:app-prod,qual:app-qual',
      printOnly: true,
      skeleton,
    });
    expect(result.files.some((f) => f.path.includes('provision.qual.sh'))).toBe(true);
    expect(result.files.some((f) => f.content.includes('app-qual'))).toBe(true);
    expect(result.envs[1]?.saId).toBe('fn-qual');
    const qualScript = result.files.find((f) => f.path.includes('provision.qual.sh'))?.content ?? '';
    expect(qualScript).toContain('firebase projects:create');
    expect(qualScript).toContain('Creating Firebase/GCP project');
  });

  it('includes billing link and can skip project create', () => {
    const skeleton = defaultProjectSkeleton();
    const withBilling = buildProjectProvisionFiles({
      envsRaw: 'qual:app-qual',
      printOnly: true,
      skeleton,
      billingAccount: '01ABCD-EFGH12-IJKL34',
    });
    expect(withBilling.files[0]?.content).toContain('gcloud billing projects link');
    expect(withBilling.files[0]?.content).toContain('01ABCD-EFGH12-IJKL34');

    const skipped = buildProjectProvisionFiles({
      envsRaw: 'qual:app-qual',
      printOnly: true,
      skeleton,
      createProject: false,
    });
    expect(skipped.files[0]?.content).toContain('createProject=false');
    expect(skipped.files[0]?.content).not.toContain('firebase projects:create');
  });
});

describe('parity', () => {
  it('parses parity args and builds iam scripts', () => {
    const opts = parseParityArgs([
      'iam',
      '--envs',
      'qual:app-qual',
      '--print',
    ]);
    expect(opts.target).toBe('iam');
    const result = buildParityFiles({
      ...opts,
      skeleton: defaultProjectSkeleton(),
    });
    expect(result.files.some((f) => f.path.includes('parity.iam.qual.sh'))).toBe(true);
  });
});

describe('assertClientProjectId', () => {
  it('accepts matching projectId', () => {
    expect(() =>
      assertClientProjectId(
        { options: { projectId: 'app-qual' } } as any,
        'qual',
        { qual: 'app-qual' },
      ),
    ).not.toThrow();
  });

  it('rejects mismatch', () => {
    expect(() =>
      assertClientProjectId(
        { options: { projectId: 'wrong' } } as any,
        'qual',
        { qual: 'app-qual' },
      ),
    ).toThrow(/expects "app-qual"/);
  });
});
