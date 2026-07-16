import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEnvRuntime } from '../../src/core/runtime.js';
import { createWithAppEnvHttp } from '../../src/functions/http.js';
import { mockResponse, multiEnvConfig, pinnedConfig } from '../helpers.js';

vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    verifyIdToken: vi.fn(async (token: string) => {
      if (token === 'bad') {
        const error = new Error('invalid');
        (error as { code?: string }).code = 'auth/argument-error';
        throw error;
      }
      if (token === 'expired') {
        const error = new Error('expired');
        (error as { code?: string }).code = 'auth/id-token-expired';
        throw error;
      }
      return {
        uid: 'verified-user',
        allowedEnvs: ['qual'],
      };
    }),
  }),
}));

describe('createWithAppEnvHttp', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('resolves gated origin and runs handler in ALS', async () => {
    const runtime = createEnvRuntime(multiEnvConfig);
    const withHttp = createWithAppEnvHttp(runtime);
    const res = mockResponse();

    const result = await withHttp(async () => {
      expect(runtime.getEnvTag()).toBe('qual');
      return 'ok';
    })(
      {
        headers: { origin: 'https://myapp-qual.web.app' },
        auth: { uid: 'user-1', token: { allowedEnvs: ['qual'] } },
      },
      res,
    );

    expect(result).toBe('ok');
    expect(res.status).not.toHaveBeenCalled();
  });

  it('uses x-app-env hint on localhost', async () => {
    const runtime = createEnvRuntime(multiEnvConfig);
    const withHttp = createWithAppEnvHttp(runtime);
    const res = mockResponse();

    await withHttp(async () => {
      expect(runtime.getEnvTag()).toBe('cert');
    })(
      {
        headers: {
          origin: 'http://localhost:3000',
          'x-app-env': 'cert',
        },
        auth: { uid: 'user-1', token: { allowedEnvs: ['cert'] } },
      },
      res,
    );
  });

  it('uses ?appEnv= query hint on localhost', async () => {
    const runtime = createEnvRuntime(multiEnvConfig);
    const withHttp = createWithAppEnvHttp(runtime);
    const res = mockResponse();

    await withHttp(async () => {
      expect(runtime.getEnvTag()).toBe('qual');
    })(
      {
        headers: { origin: 'http://localhost:3000' },
        query: { appEnv: 'qual' },
        auth: { uid: 'user-1', token: { allowedEnvs: ['qual'] } },
      },
      res,
    );
  });

  it('maps auth errors to HTTP status codes', async () => {
    const runtime = createEnvRuntime(multiEnvConfig);
    const withHttp = createWithAppEnvHttp(runtime);
    const res = mockResponse();

    await withHttp(async () => 'never')(
      {
        headers: { origin: 'https://myapp-qual.web.app' },
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'unauthenticated' }),
      }),
    );
  });

  it('maps failed-precondition (unknown origin reject) to 400', async () => {
    const runtime = createEnvRuntime({
      ...multiEnvConfig,
      rejectUnknownOrigin: true,
    });
    const withHttp = createWithAppEnvHttp(runtime);
    const res = mockResponse();

    await withHttp(async () => 'never')(
      {
        headers: { origin: 'https://evil.example.com' },
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'failed-precondition' }),
      }),
    );
  });

  it('verifies bearer ID tokens when verifyIdToken is enabled', async () => {
    const runtime = createEnvRuntime(multiEnvConfig);
    const withHttp = createWithAppEnvHttp(runtime, { verifyIdToken: true });
    const res = mockResponse();
    const req: Record<string, unknown> = {
      headers: {
        origin: 'https://myapp-qual.web.app',
        authorization: 'Bearer good-token',
      },
    };

    const result = await withHttp(async (incoming) => {
      expect(runtime.getEnvTag()).toBe('qual');
      expect(incoming.auth?.uid).toBe('verified-user');
      return 'verified';
    })(req, res);

    expect(result).toBe('verified');
    expect(res.status).not.toHaveBeenCalled();
  });

  it('maps invalid ID tokens to 401 when verifyIdToken is enabled', async () => {
    const runtime = createEnvRuntime(multiEnvConfig);
    const withHttp = createWithAppEnvHttp(runtime, { verifyIdToken: true });
    const res = mockResponse();

    await withHttp(async () => 'never')(
      {
        headers: {
          origin: 'https://myapp-qual.web.app',
          authorization: 'Bearer bad',
        },
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('maps expired ID tokens to 401', async () => {
    const runtime = createEnvRuntime(multiEnvConfig);
    const withHttp = createWithAppEnvHttp(runtime, { verifyIdToken: true });
    const res = mockResponse();

    await withHttp(async () => 'never')(
      {
        headers: {
          origin: 'https://myapp-qual.web.app',
          authorization: 'Bearer expired',
        },
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('prefers existing req.auth over bearer verification', async () => {
    const runtime = createEnvRuntime(multiEnvConfig);
    const withHttp = createWithAppEnvHttp(runtime, { verifyIdToken: true });
    const res = mockResponse();

    await withHttp(async (incoming) => {
      expect(incoming.auth?.uid).toBe('pre-set');
      expect(runtime.getEnvTag()).toBe('qual');
    })(
      {
        headers: {
          origin: 'https://myapp-qual.web.app',
          authorization: 'Bearer good-token',
        },
        auth: { uid: 'pre-set', token: { allowedEnvs: ['qual'] } },
      },
      res,
    );
  });

  describe('pinned deploy', () => {
    it('serves the pinned origin', async () => {
      const runtime = createEnvRuntime(pinnedConfig('qual'));
      const withHttp = createWithAppEnvHttp(runtime, { verifyIdToken: true });
      const res = mockResponse();

      const result = await withHttp(async () => {
        expect(runtime.getEnvTag()).toBe('qual');
        return 'pinned-ok';
      })(
        {
          headers: {
            origin: 'https://myapp-qual.web.app',
            authorization: 'Bearer good-token',
          },
        },
        res,
      );

      expect(result).toBe('pinned-ok');
    });

    it('rejects a different environment Origin with 400', async () => {
      const runtime = createEnvRuntime(pinnedConfig('qual'));
      const withHttp = createWithAppEnvHttp(runtime);
      const res = mockResponse();

      await withHttp(async () => 'never')(
        {
          headers: { origin: 'https://myapp.web.app' },
        },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: 'failed-precondition' }),
        }),
      );
    });

    it('rejects unknown Origin with 400', async () => {
      const runtime = createEnvRuntime(pinnedConfig('qual'));
      const withHttp = createWithAppEnvHttp(runtime);
      const res = mockResponse();

      await withHttp(async () => 'never')(
        {
          headers: { origin: 'https://evil.example.com' },
        },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
