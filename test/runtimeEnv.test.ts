import { afterEach, describe, expect, it } from 'vitest';
import { HttpsError } from 'firebase-functions/v1/https';
import { createEnvRuntime } from '../src/runtimeEnv.js';
import { authContext, multiEnvConfig } from './helpers.js';

describe('createEnvRuntime', () => {
  afterEach(() => {
    delete process.env.APP_ENV;
    delete process.env.FUNCTIONS_EMULATOR;
    delete process.env.FIRESTORE_EMULATOR_HOST;
  });

  it('maps production origin without a claim', () => {
    const runtime = createEnvRuntime(multiEnvConfig);
    const env = runtime.resolveRequestEnv('qual', authContext({
      origin: 'https://myapp.web.app',
    }));

    expect(env).toEqual({
      appEnv: 'production',
      firestoreDatabaseId: '(default)',
      firestoreEnvTag: 'production',
    });
  });

  it('maps gated origin when allowlist includes the env', () => {
    const runtime = createEnvRuntime(multiEnvConfig);
    const env = runtime.resolveRequestEnv('production', authContext({
      origin: 'https://myapp-qual.web.app',
      uid: 'user-1',
      allowedEnvs: ['qual'],
    }));

    expect(env.appEnv).toBe('qual');
    expect(env.firestoreDatabaseId).toBe('qual-env');
  });

  it('ignores client hint when hosted origin maps to another env', () => {
    const runtime = createEnvRuntime(multiEnvConfig);
    const env = runtime.resolveRequestEnv('cert', authContext({
      origin: 'https://myapp.web.app',
    }));

    expect(env.appEnv).toBe('production');
  });

  it('denies gated origin without allowlist membership', () => {
    const runtime = createEnvRuntime(multiEnvConfig);

    expect(() =>
      runtime.resolveRequestEnv(undefined, authContext({
        origin: 'https://myapp-qual.web.app',
        uid: 'user-1',
        allowedEnvs: ['cert'],
      })),
    ).toThrow(HttpsError);

    try {
      runtime.resolveRequestEnv(undefined, authContext({
        origin: 'https://myapp-qual.web.app',
        uid: 'user-1',
        allowedEnvs: ['cert'],
      }));
    } catch (error) {
      expect(error).toMatchObject({ code: 'permission-denied' });
    }
  });

  it('requires sign-in for gated origins', () => {
    const runtime = createEnvRuntime(multiEnvConfig);

    try {
      runtime.resolveRequestEnv(undefined, authContext({
        origin: 'https://myapp-cert.web.app',
      }));
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'unauthenticated' });
    }
  });

  it('uses client hint on localhost for gated envs when claimed', () => {
    const runtime = createEnvRuntime(multiEnvConfig);
    const env = runtime.resolveRequestEnv('qual', authContext({
      origin: 'http://localhost:5173',
      uid: 'user-1',
      allowedEnvs: ['qual'],
    }));

    expect(env.appEnv).toBe('qual');
    expect(env.firestoreDatabaseId).toBe('qual-env');
  });

  it('falls back to APP_ENV then public env on localhost', () => {
    const runtime = createEnvRuntime(multiEnvConfig);

    process.env.APP_ENV = 'cert';
    const fromProcess = runtime.resolveRequestEnv(undefined, authContext({
      origin: 'http://127.0.0.1:3000',
      uid: 'user-1',
      allowedEnvs: ['cert'],
    }));
    expect(fromProcess.appEnv).toBe('cert');

    delete process.env.APP_ENV;
    const fromDefault = runtime.resolveRequestEnv(undefined, authContext({
      origin: 'http://localhost:3000',
    }));
    expect(fromDefault.appEnv).toBe('production');
  });

  it('skips claim checks in emulator when allowed', () => {
    process.env.FUNCTIONS_EMULATOR = 'true';
    const runtime = createEnvRuntime(multiEnvConfig);
    const env = runtime.resolveRequestEnv('qual', authContext({
      origin: 'http://localhost:5001',
    }));

    expect(env.appEnv).toBe('qual');
  });

  it('forces emulator firestore database to (default)', () => {
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    const runtime = createEnvRuntime(multiEnvConfig);
    const env = runtime.resolveRequestEnv('qual', authContext({
      origin: 'http://localhost:5173',
    }));

    expect(env.firestoreDatabaseId).toBe('(default)');
  });

  it('does not trust client gated hint on unknown hosted origins', () => {
    const runtime = createEnvRuntime(multiEnvConfig);
    const env = runtime.resolveRequestEnv('qual', authContext({
      origin: 'https://evil.example.com',
      uid: 'user-1',
      allowedEnvs: ['qual'],
    }));

    expect(env.appEnv).toBe('production');
  });

  it('resolves env from referer when origin header is missing', () => {
    const runtime = createEnvRuntime(multiEnvConfig);
    const env = runtime.resolveRequestEnv(undefined, authContext({
      referer: 'https://myapp-qual.web.app/dashboard?x=1',
      uid: 'user-1',
      allowedEnvs: ['qual'],
    }));

    expect(env.appEnv).toBe('qual');
  });

  it('exposes runtime env through AsyncLocalStorage', async () => {
    const runtime = createEnvRuntime(multiEnvConfig);
    const env = runtime.resolveProcessEnv('cert');

    await runtime.runWithEnv(env, async () => {
      expect(runtime.getEnvTag()).toBe('cert');
      expect(runtime.getRuntimeEnv().firestoreDatabaseId).toBe('cert-env');
    });
  });
});
