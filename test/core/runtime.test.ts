import { afterEach, describe, expect, it } from 'vitest';
import { HttpsError } from 'firebase-functions/v1/https';
import { createEnvRuntime } from '../../src/core/runtime.js';
import { authContext, multiEnvConfig, pinnedConfig } from '../helpers.js';

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

  it('rejects unknown hosted origins when rejectUnknownOrigin is true', () => {
    const runtime = createEnvRuntime({
      ...multiEnvConfig,
      rejectUnknownOrigin: true,
    });

    try {
      runtime.resolveRequestEnv('qual', authContext({
        origin: 'https://evil.example.com',
        uid: 'user-1',
        allowedEnvs: ['qual'],
      }));
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'failed-precondition' });
    }
  });

  it('rejects missing origin when rejectUnknownOrigin is true', () => {
    const runtime = createEnvRuntime({
      ...multiEnvConfig,
      rejectUnknownOrigin: true,
    });

    try {
      runtime.resolveRequestEnv(undefined, {});
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'failed-precondition' });
    }
  });

  it('silently defaults getRuntimeEnv outside ALS in logical mode', () => {
    const runtime = createEnvRuntime(multiEnvConfig);
    expect(runtime.getRuntimeEnv().appEnv).toBe('production');
  });

  it('throws getRuntimeEnv outside ALS when requireRequestContext is true', () => {
    const runtime = createEnvRuntime({
      ...multiEnvConfig,
      requireRequestContext: true,
    });

    try {
      runtime.getRuntimeEnv();
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'failed-precondition' });
    }
  });

  it('allows non-gated client hint on unknown hosted origins', () => {
    const runtime = createEnvRuntime({
      environments: {
        production: {
          database: '(default)',
          origins: ['https://myapp.web.app'],
        },
        preview: {
          database: 'preview-env',
          origins: ['https://myapp-preview.web.app'],
          requireClaim: false,
        },
        qual: {
          database: 'qual-env',
          origins: ['https://myapp-qual.web.app'],
          requireClaim: true,
        },
      },
      publicEnvironment: 'production',
    });

    const env = runtime.resolveRequestEnv('preview', authContext({
      origin: 'https://evil.example.com',
    }));
    expect(env.appEnv).toBe('preview');
  });

  it('resolves env from referer when origin header is missing (logical mode)', () => {
    const runtime = createEnvRuntime(multiEnvConfig);
    const env = runtime.resolveRequestEnv(undefined, authContext({
      referer: 'https://myapp-qual.web.app/dashboard?x=1',
      uid: 'user-1',
      allowedEnvs: ['qual'],
    }));

    expect(env.appEnv).toBe('qual');
  });

  it('ignores referer by default in pinned mode', () => {
    const runtime = createEnvRuntime(pinnedConfig('qual'));

    try {
      runtime.resolveRequestEnv(undefined, authContext({
        referer: 'https://myapp-qual.web.app/dashboard',
        uid: 'user-1',
        allowedEnvs: ['qual'],
      }));
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        code: 'failed-precondition',
        message: expect.stringMatching(/Missing Origin/i),
      });
    }
  });

  it('fires onResolveEnv for success and rejection', () => {
    const events: Array<{ ok: boolean; resolvedEnv?: string; rejectedReason?: string }> = [];
    const runtime = createEnvRuntime({
      ...multiEnvConfig,
      rejectUnknownOrigin: true,
      onResolveEnv: (event) => {
        events.push({
          ok: event.ok,
          resolvedEnv: event.resolvedEnv,
          rejectedReason: event.rejectedReason,
        });
      },
    });

    runtime.resolveRequestEnv(undefined, authContext({
      origin: 'https://myapp.web.app',
    }));

    try {
      runtime.resolveRequestEnv(undefined, authContext({
        origin: 'https://evil.example.com',
      }));
    } catch {
      // expected
    }

    expect(events).toEqual([
      { ok: true, resolvedEnv: 'production', rejectedReason: undefined },
      {
        ok: false,
        resolvedEnv: undefined,
        rejectedReason: 'Unrecognized Origin "https://evil.example.com".',
      },
    ]);
  });

  it('exposes runtime env through AsyncLocalStorage', async () => {
    const runtime = createEnvRuntime(multiEnvConfig);
    const env = runtime.resolveProcessEnv('cert');

    await runtime.runWithEnv(env, async () => {
      expect(runtime.getEnvTag()).toBe('cert');
      expect(runtime.getRuntimeEnv().firestoreDatabaseId).toBe('cert-env');
    });
  });

  it('isolates parallel AsyncLocalStorage environments', async () => {
    const runtime = createEnvRuntime(multiEnvConfig);
    const qual = runtime.resolveProcessEnv('qual');
    const cert = runtime.resolveProcessEnv('cert');
    const seen: string[] = [];

    await Promise.all([
      runtime.runWithEnv(qual, async () => {
        await new Promise((r) => setTimeout(r, 20));
        seen.push(`qual:${runtime.getEnvTag()}`);
        expect(runtime.getRuntimeEnv().firestoreDatabaseId).toBe('qual-env');
      }),
      runtime.runWithEnv(cert, async () => {
        await new Promise((r) => setTimeout(r, 5));
        seen.push(`cert:${runtime.getEnvTag()}`);
        expect(runtime.getRuntimeEnv().firestoreDatabaseId).toBe('cert-env');
      }),
    ]);

    expect(seen.sort()).toEqual(['cert:cert', 'qual:qual']);
  });
});
