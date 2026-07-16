import { describe, expect, it } from 'vitest';
import { createEnvRuntime, parseOriginHeader } from '../../src/core/runtime.js';
import { authContext, multiEnvConfig, pinnedConfig } from '../helpers.js';

describe('parseOriginHeader', () => {
  it('normalizes a valid https origin', () => {
    expect(parseOriginHeader('https://MyApp.Web.App')).toEqual({
      ok: true,
      origin: 'https://myapp.web.app',
    });
  });

  it('accepts trailing slash', () => {
    expect(parseOriginHeader('https://myapp.web.app/')).toEqual({
      ok: true,
      origin: 'https://myapp.web.app',
    });
  });

  it('rejects Origin null', () => {
    expect(parseOriginHeader('null')).toMatchObject({ ok: false });
  });

  it('rejects file:// and chrome-extension://', () => {
    expect(parseOriginHeader('file:///tmp/x')).toMatchObject({ ok: false });
    expect(parseOriginHeader('chrome-extension://abcdef')).toMatchObject({ ok: false });
  });

  it('rejects origins with a path or query', () => {
    expect(parseOriginHeader('https://myapp.web.app/dashboard')).toMatchObject({ ok: false });
    expect(parseOriginHeader('https://myapp.web.app?x=1')).toMatchObject({ ok: false });
  });

  it('rejects multiple distinct Origin values', () => {
    expect(
      parseOriginHeader(['https://a.example.com', 'https://b.example.com']),
    ).toMatchObject({ ok: false });
  });

  it('accepts duplicate identical Origin values', () => {
    expect(
      parseOriginHeader(['https://myapp.web.app', 'https://myapp.web.app/']),
    ).toEqual({ ok: true, origin: 'https://myapp.web.app' });
  });
});

describe('adversarial origin resolution', () => {
  it('does not treat suffix domains as a mapped origin', () => {
    const runtime = createEnvRuntime({
      ...multiEnvConfig,
      rejectUnknownOrigin: true,
    });

    try {
      runtime.resolveRequestEnv(undefined, authContext({
        origin: 'https://myapp.web.app.evil.com',
      }));
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        code: 'failed-precondition',
        message: expect.stringContaining('Unrecognized Origin'),
      });
    }
  });

  it('rejects Origin null on a request', () => {
    const runtime = createEnvRuntime({
      ...multiEnvConfig,
      rejectUnknownOrigin: true,
    });

    try {
      runtime.resolveRequestEnv(undefined, {
        rawRequest: { headers: { origin: 'null' } },
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        code: 'failed-precondition',
        message: expect.stringMatching(/null/i),
      });
    }
  });

  it('rejects file:// Origin', () => {
    const runtime = createEnvRuntime(multiEnvConfig);

    try {
      runtime.resolveRequestEnv(undefined, {
        rawRequest: { headers: { origin: 'file:///etc/passwd' } },
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'failed-precondition' });
    }
  });

  it('rejects multiple Origin headers', () => {
    const runtime = createEnvRuntime(multiEnvConfig);

    try {
      runtime.resolveRequestEnv(undefined, {
        rawRequest: {
          headers: {
            origin: ['https://myapp.web.app', 'https://evil.example.com'],
          },
        },
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        code: 'failed-precondition',
        message: expect.stringMatching(/Multiple distinct Origin/i),
      });
    }
  });

  it('matches case-insensitively and ignores trailing slash in config', () => {
    const runtime = createEnvRuntime(multiEnvConfig);
    const env = runtime.resolveRequestEnv(undefined, authContext({
      origin: 'HTTPS://MyApp.Web.App/',
    }));
    expect(env.appEnv).toBe('production');
  });

  it('does not let referer spoofing bypass pinned missing-Origin rejection', () => {
    const runtime = createEnvRuntime(pinnedConfig('production'));

    try {
      runtime.resolveRequestEnv(undefined, {
        rawRequest: {
          headers: {
            referer: 'https://myapp.web.app/admin',
          },
        },
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        code: 'failed-precondition',
        message: expect.stringMatching(/Missing Origin/i),
      });
    }
  });

  it('allows explicit referer fallback when opted in on pinned deploys', () => {
    const runtime = createEnvRuntime(pinnedConfig('qual', {
      allowRefererFallback: true,
    }));

    const env = runtime.resolveRequestEnv(undefined, authContext({
      referer: 'https://myapp-qual.web.app/page',
      uid: 'user-1',
      allowedEnvs: ['qual'],
    }));

    expect(env.appEnv).toBe('qual');
  });

  it('does not map punycode lookalike of a configured ascii origin', () => {
    const runtime = createEnvRuntime({
      ...multiEnvConfig,
      rejectUnknownOrigin: true,
    });

    // xn-- mapping of a different host; must not equal https://myapp.web.app
    try {
      runtime.resolveRequestEnv(undefined, authContext({
        origin: 'https://xn--myapp-web-app.example',
      }));
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'failed-precondition' });
    }
  });
});
