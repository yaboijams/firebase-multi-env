import { afterEach, describe, expect, it } from 'vitest';
import { normalizeEnvConfig } from '../../src/core/config.js';
import { multiEnvConfig } from '../helpers.js';

describe('normalizeEnvConfig', () => {
  afterEach(() => {
    delete process.env.HOST_ORIGINS_QUAL;
    delete process.env.HOST_ORIGINS_PRODUCTION;
    delete process.env.APP_ENV;
  });

  it('normalizes origins and defaults claim settings', () => {
    const normalized = normalizeEnvConfig(multiEnvConfig);

    expect(normalized.publicEnvironment).toBe('production');
    expect(normalized.claimKey).toBe('allowedEnvs');
    expect(normalized.allowEmulatorWithoutClaim).toBe(true);
    expect(normalized.environments.production?.requireClaim).toBe(false);
    expect(normalized.environments.qual?.requireClaim).toBe(true);
    expect(normalized.environments.cert?.requireClaim).toBe(true);
    expect(normalized.originToEnv.get('https://myapp.web.app')).toBe('production');
    expect(normalized.originToEnv.get('https://myapp-qual.web.app')).toBe('qual');
  });

  it('strips trailing slashes and lowercases origins', () => {
    const normalized = normalizeEnvConfig({
      environments: {
        production: {
          database: '(default)',
          origins: ['HTTPS://MyApp.Web.App/'],
        },
      },
    });

    expect(normalized.originToEnv.get('https://myapp.web.app')).toBe('production');
  });

  it('merges HOST_ORIGINS_<ENV> overrides', () => {
    process.env.HOST_ORIGINS_QUAL = 'https://qual.example.com, https://qual.example.com/';
    const normalized = normalizeEnvConfig(multiEnvConfig);

    expect(normalized.originToEnv.get('https://qual.example.com')).toBe('qual');
    expect(normalized.environments.qual?.origins).toEqual(
      expect.arrayContaining([
        'https://myapp-qual.web.app',
        'https://qual.example.com',
      ]),
    );
  });

  it('rejects duplicate origins across environments', () => {
    expect(() =>
      normalizeEnvConfig({
        environments: {
          production: {
            database: '(default)',
            origins: ['https://shared.web.app'],
          },
          qual: {
            database: 'qual-env',
            origins: ['https://shared.web.app'],
            requireClaim: true,
          },
        },
      }),
    ).toThrow(/mapped to both/);
  });

  it('requires at least one environment', () => {
    expect(() => normalizeEnvConfig({ environments: {} })).toThrow(
      /at least one environment/,
    );
  });

  it('honors explicit publicEnvironment', () => {
    const normalized = normalizeEnvConfig({
      ...multiEnvConfig,
      publicEnvironment: 'production',
      claimKey: 'envs',
      accessDeniedMessage: 'Nope',
    });

    expect(normalized.publicEnvironment).toBe('production');
    expect(normalized.claimKey).toBe('envs');
    expect(normalized.accessDeniedMessage).toBe('Nope');
  });

  it('throws when publicEnvironment is unknown', () => {
    expect(() =>
      normalizeEnvConfig({
        ...multiEnvConfig,
        publicEnvironment: 'missing',
      }),
    ).toThrow(/not defined/);
  });

  it('gates non-public envs by default even without requireClaim', () => {
    const normalized = normalizeEnvConfig({
      environments: {
        production: {
          database: '(default)',
          origins: ['https://prod.web.app'],
        },
        staging: {
          database: 'staging-env',
          origins: ['https://staging.web.app'],
        },
      },
    });

    expect(normalized.environments.staging?.requireClaim).toBe(true);
  });

  it('defaults isolation to unpinned with accept unknown origins', () => {
    const normalized = normalizeEnvConfig(multiEnvConfig);
    expect(normalized.pinned).toBe(false);
    expect(normalized.pinnedEnvironment).toBeNull();
    expect(normalized.rejectUnknownOrigin).toBe(false);
    expect(normalized.requireRequestContext).toBe(false);
  });

  it('defaults pinned mode to reject unknown origins and require request context', () => {
    const normalized = normalizeEnvConfig({
      ...multiEnvConfig,
      pinned: true,
      pinnedEnvironment: 'qual',
    });

    expect(normalized.pinned).toBe(true);
    expect(normalized.pinnedEnvironment).toBe('qual');
    expect(normalized.rejectUnknownOrigin).toBe(true);
    expect(normalized.requireRequestContext).toBe(true);
  });

  it('reads pinnedEnvironment from APP_ENV when pinned is true', () => {
    process.env.APP_ENV = 'cert';
    const normalized = normalizeEnvConfig({
      ...multiEnvConfig,
      pinned: true,
    });
    expect(normalized.pinnedEnvironment).toBe('cert');
    delete process.env.APP_ENV;
  });

  it('throws when pinned environment is unknown', () => {
    expect(() =>
      normalizeEnvConfig({
        ...multiEnvConfig,
        pinned: true,
        pinnedEnvironment: 'missing',
      }),
    ).toThrow(/pinnedEnvironment "missing"/);
  });

  it('allows overriding pinned defaults for rejectUnknownOrigin and requireRequestContext', () => {
    const normalized = normalizeEnvConfig({
      ...multiEnvConfig,
      pinned: true,
      pinnedEnvironment: 'qual',
      rejectUnknownOrigin: false,
      requireRequestContext: false,
    });

    expect(normalized.rejectUnknownOrigin).toBe(false);
    expect(normalized.requireRequestContext).toBe(false);
  });
});
