import { describe, expect, it } from 'vitest';
import { createEnvRuntime } from '../../src/core/runtime.js';
import { createWithAppEnvV1 } from '../../src/functions/v1.js';
import { createWithAppEnvV2 } from '../../src/functions/v2.js';
import { multiEnvConfig, pinnedConfig } from '../helpers.js';

describe('function wrappers', () => {
  it('createWithAppEnvV1 strips appEnv and runs with resolved env', async () => {
    const runtime = createEnvRuntime(multiEnvConfig);
    const withAppEnv = createWithAppEnvV1(runtime);

    const handler = withAppEnv(async (data, _context) => {
      expect(data).toEqual({ hello: 'world' });
      expect(runtime.getEnvTag()).toBe('qual');
      return 'ok';
    });

    const result = await handler(
      { hello: 'world', appEnv: 'production' },
      {
        auth: {
          uid: 'user-1',
          token: { allowedEnvs: ['qual'] },
        },
        rawRequest: {
          headers: { origin: 'https://myapp-qual.web.app' },
        },
      },
    );

    expect(result).toBe('ok');
  });

  it('createWithAppEnvV2 strips appEnv and rewrites request.data', async () => {
    const runtime = createEnvRuntime(multiEnvConfig);
    const withAppEnv = createWithAppEnvV2(runtime);

    const handler = withAppEnv(async (request) => {
      expect(request.data).toEqual({ count: 2 });
      expect(runtime.getEnvTag()).toBe('production');
      return request.data.count;
    });

    const result = await handler({
      data: { count: 2, appEnv: 'qual' },
      auth: null,
      rawRequest: {
        headers: { origin: 'https://myapp.web.app' },
      },
    });

    expect(result).toBe(2);
  });

  it('createWithAppEnvV1 rejects cross-env Origin on a pinned deploy', async () => {
    const runtime = createEnvRuntime(pinnedConfig('qual'));
    const withAppEnv = createWithAppEnvV1(runtime);
    const handler = withAppEnv(async () => 'never');

    await expect(
      handler(
        { appEnv: 'production' },
        {
          auth: null,
          rawRequest: {
            headers: { origin: 'https://myapp.web.app' },
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('createWithAppEnvV2 serves pinned Origin and exposes ALS env', async () => {
    const runtime = createEnvRuntime(pinnedConfig('qual'));
    const withAppEnv = createWithAppEnvV2(runtime);

    const handler = withAppEnv(async (request) => {
      expect(request.data).toEqual({ ok: true });
      expect(runtime.getEnvTag()).toBe('qual');
      return 'pinned';
    });

    const result = await handler({
      data: { ok: true, appEnv: 'cert' },
      auth: {
        uid: 'user-1',
        token: { allowedEnvs: ['qual'] },
      },
      rawRequest: {
        headers: { origin: 'https://myapp-qual.web.app' },
      },
    });

    expect(result).toBe('pinned');
  });

  it('createWithAppEnvV2 rejects unknown Origin on pinned deploys', async () => {
    const runtime = createEnvRuntime(pinnedConfig('qual'));
    const withAppEnv = createWithAppEnvV2(runtime);
    const handler = withAppEnv(async () => 'never');

    await expect(
      handler({
        data: {},
        auth: {
          uid: 'user-1',
          token: { allowedEnvs: ['qual'] },
        },
        rawRequest: {
          headers: { origin: 'https://evil.example.com' },
        },
      }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});
