import { describe, expect, it, vi } from 'vitest';
import { createEnvRuntime } from '../../src/core/runtime.js';
import { createWithAppEnvHttp } from '../../src/functions/http.js';
import { multiEnvConfig } from '../helpers.js';

describe('createWithAppEnvHttp', () => {
  it('resolves gated origin and runs handler in ALS', async () => {
    const runtime = createEnvRuntime(multiEnvConfig);
    const withHttp = createWithAppEnvHttp(runtime);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

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
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

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

  it('maps auth errors to HTTP status codes', async () => {
    const runtime = createEnvRuntime(multiEnvConfig);
    const withHttp = createWithAppEnvHttp(runtime);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

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
});
