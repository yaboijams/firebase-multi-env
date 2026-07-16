import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEnvRuntime } from '../../src/core/runtime.js';
import { multiEnvConfig, pinnedConfig } from '../helpers.js';

const getFirestore = vi.fn((...args: unknown[]) => {
  const databaseId = args.length > 1 ? args[1] : '(default)';
  return {
    databaseId,
    settings: vi.fn(),
  };
});

const getApp = vi.fn(() => ({ name: '[DEFAULT]' }));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: (...args: unknown[]) => getFirestore(...args),
}));

vi.mock('firebase-admin/app', () => ({
  getApp: () => getApp(),
}));

describe('createGetDb', () => {
  afterEach(() => {
    delete process.env.FIRESTORE_EMULATOR_HOST;
    getFirestore.mockClear();
    getApp.mockClear();
  });

  it('opens the request-scoped database inside ALS', async () => {
    const { createGetDb } = await import('../../src/server/getDb.js');
    const runtime = createEnvRuntime(multiEnvConfig);
    const getDb = createGetDb(runtime);

    await runtime.runWithEnv(runtime.resolveProcessEnv('qual'), () => {
      const db = getDb() as { databaseId: string };
      expect(db.databaseId).toBe('qual-env');
      expect(getFirestore).toHaveBeenCalledWith(expect.anything(), 'qual-env');
    });
  });

  it('reuses cached Firestore instances per database id', async () => {
    const { createGetDb } = await import('../../src/server/getDb.js');
    const runtime = createEnvRuntime(multiEnvConfig);
    const getDb = createGetDb(runtime);

    await runtime.runWithEnv(runtime.resolveProcessEnv('qual'), () => {
      const first = getDb();
      const second = getDb();
      expect(first).toBe(second);
      expect(getFirestore).toHaveBeenCalledTimes(1);
    });
  });

  it('throws outside ALS when requireRequestContext is enabled', async () => {
    const { createGetDb } = await import('../../src/server/getDb.js');
    const runtime = createEnvRuntime(pinnedConfig('qual'));
    const getDb = createGetDb(runtime);

    expect(() => getDb()).toThrow(/No active request environment/);
    expect(getFirestore).not.toHaveBeenCalled();
  });

  it('defaults to public env outside ALS in logical mode', async () => {
    const { createGetDb } = await import('../../src/server/getDb.js');
    const runtime = createEnvRuntime(multiEnvConfig);
    const getDb = createGetDb(runtime);

    const db = getDb() as { databaseId: string };
    expect(db.databaseId).toBe('(default)');
    expect(getFirestore).toHaveBeenCalledWith();
  });

  it('uses default emulator database but still requires request context when pinned', async () => {
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
    const { createGetDb } = await import('../../src/server/getDb.js');
    const runtime = createEnvRuntime(pinnedConfig('qual'));
    const getDb = createGetDb(runtime);

    expect(() => getDb()).toThrow(/No active request environment/);

    await runtime.runWithEnv(runtime.resolveProcessEnv(), () => {
      getDb();
      expect(getFirestore).toHaveBeenCalledWith();
    });
  });

  it('opens (default) without a named database argument', async () => {
    const { createGetDb } = await import('../../src/server/getDb.js');
    const runtime = createEnvRuntime(multiEnvConfig);
    const getDb = createGetDb(runtime);

    await runtime.runWithEnv(runtime.resolveProcessEnv('production'), () => {
      getDb();
      expect(getFirestore).toHaveBeenCalledWith();
      expect(getFirestore).not.toHaveBeenCalledWith(expect.anything(), '(default)');
    });
  });
});
