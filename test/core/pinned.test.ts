import { afterEach, describe, expect, it } from 'vitest';
import { createEnvRuntime } from '../../src/core/runtime.js';
import { authContext, pinnedConfig } from '../helpers.js';

describe('pinned isolation mode', () => {
  afterEach(() => {
    delete process.env.APP_ENV;
    delete process.env.FUNCTIONS_EMULATOR;
    delete process.env.FIRESTORE_EMULATOR_HOST;
  });

  it('requires pinnedEnvironment or APP_ENV at config time', () => {
    expect(() =>
      createEnvRuntime({
        environments: pinnedConfig('qual').environments,
        pinned: true,
      }),
    ).toThrow(/pinned: true requires pinnedEnvironment or process\.env\.APP_ENV/);
  });

  it('serves the pinned origin when claims allow it', () => {
    const runtime = createEnvRuntime(pinnedConfig('qual'));
    const env = runtime.resolveRequestEnv(undefined, authContext({
      origin: 'https://myapp-qual.web.app',
      uid: 'user-1',
      allowedEnvs: ['qual'],
    }));

    expect(env).toEqual({
      appEnv: 'qual',
      firestoreDatabaseId: 'qual-env',
      firestoreEnvTag: 'qual',
    });
  });

  it('refuses Origin mapped to a different environment', () => {
    const runtime = createEnvRuntime(pinnedConfig('qual'));

    try {
      runtime.resolveRequestEnv(undefined, authContext({
        origin: 'https://myapp.web.app',
      }));
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        code: 'failed-precondition',
        message: expect.stringContaining('pinned to "qual"'),
      });
    }
  });

  it('refuses cert Origin on a qual-pinned deploy', () => {
    const runtime = createEnvRuntime(pinnedConfig('qual'));

    try {
      runtime.resolveRequestEnv(undefined, authContext({
        origin: 'https://myapp-cert.web.app',
        uid: 'user-1',
        allowedEnvs: ['cert'],
      }));
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'failed-precondition' });
    }
  });

  it('rejects unknown hosted origins by default', () => {
    const runtime = createEnvRuntime(pinnedConfig('qual'));

    try {
      runtime.resolveRequestEnv(undefined, authContext({
        origin: 'https://evil.example.com',
      }));
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'failed-precondition' });
    }
  });

  it('rejects missing Origin on hosted requests by default', () => {
    const runtime = createEnvRuntime(pinnedConfig('qual'));

    try {
      runtime.resolveRequestEnv(undefined, {});
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        code: 'failed-precondition',
        message: expect.stringMatching(/Missing Origin/i),
      });
    }
  });

  it('uses pinned env on localhost without a client hint', () => {
    const runtime = createEnvRuntime(pinnedConfig('qual'));
    const env = runtime.resolveRequestEnv(undefined, authContext({
      origin: 'http://localhost:5173',
      uid: 'user-1',
      allowedEnvs: ['qual'],
    }));

    expect(env.appEnv).toBe('qual');
  });

  it('allows a matching localhost hint and rejects a different hint', () => {
    const runtime = createEnvRuntime(pinnedConfig('qual'));

    const ok = runtime.resolveRequestEnv('qual', authContext({
      origin: 'http://127.0.0.1:3000',
      uid: 'user-1',
      allowedEnvs: ['qual'],
    }));
    expect(ok.appEnv).toBe('qual');

    try {
      runtime.resolveRequestEnv('cert', authContext({
        origin: 'http://localhost:3000',
        uid: 'user-1',
        allowedEnvs: ['cert'],
      }));
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        code: 'failed-precondition',
        message: expect.stringContaining('hint "cert"'),
      });
    }
  });

  it('still requires claims for gated pinned envs on localhost', () => {
    const runtime = createEnvRuntime(pinnedConfig('qual'));

    try {
      runtime.resolveRequestEnv(undefined, authContext({
        origin: 'http://localhost:5173',
      }));
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'unauthenticated' });
    }
  });

  it('resolveProcessEnv always returns the pinned environment', () => {
    const runtime = createEnvRuntime(pinnedConfig('cert'));
    expect(runtime.resolveProcessEnv()).toEqual({
      appEnv: 'cert',
      firestoreDatabaseId: 'cert-env',
      firestoreEnvTag: 'cert',
    });

    try {
      runtime.resolveProcessEnv('qual');
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        code: 'failed-precondition',
        message: expect.stringContaining('hint "qual"'),
      });
    }
  });

  it('throws getRuntimeEnv outside ALS and works inside runWithEnv', async () => {
    const runtime = createEnvRuntime(pinnedConfig('qual'));

    try {
      runtime.getRuntimeEnv();
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'failed-precondition' });
    }

    await runtime.runWithEnv(runtime.resolveProcessEnv(), () => {
      expect(runtime.getEnvTag()).toBe('qual');
      expect(runtime.getRuntimeEnv().firestoreDatabaseId).toBe('qual-env');
    });
  });

  it('honors explicit rejectUnknownOrigin false override on pinned deploys', () => {
    const runtime = createEnvRuntime(pinnedConfig('production', {
      rejectUnknownOrigin: false,
    }));

    const env = runtime.resolveRequestEnv('qual', authContext({
      origin: 'https://evil.example.com',
      uid: 'user-1',
      allowedEnvs: ['qual'],
    }));

    // Unknown hosted origin must not trust gated client hints.
    expect(env.appEnv).toBe('production');
  });

  it('can disable requireRequestContext on pinned deploys', () => {
    const runtime = createEnvRuntime(pinnedConfig('qual', {
      requireRequestContext: false,
    }));

    expect(runtime.getRuntimeEnv().appEnv).toBe('qual');
  });

  it('skips claims in emulator for pinned env when allowed', () => {
    process.env.FUNCTIONS_EMULATOR = 'true';
    const runtime = createEnvRuntime(pinnedConfig('qual'));

    const env = runtime.resolveRequestEnv(undefined, authContext({
      origin: 'http://localhost:5001',
    }));

    expect(env.appEnv).toBe('qual');
  });

  it('forces emulator database id to (default) while keeping pinned tag', () => {
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    const runtime = createEnvRuntime(pinnedConfig('qual'));

    const env = runtime.resolveRequestEnv(undefined, authContext({
      origin: 'http://localhost:5173',
      uid: 'user-1',
      allowedEnvs: ['qual'],
    }));

    expect(env.appEnv).toBe('qual');
    expect(env.firestoreDatabaseId).toBe('(default)');
  });
});
