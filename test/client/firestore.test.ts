import { beforeEach, describe, expect, it, vi } from 'vitest';

const getFirestore = vi.fn();
const httpsCallable = vi.fn();

vi.mock('firebase/firestore', () => ({
  getFirestore: (...args: unknown[]) => getFirestore(...args),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: unknown[]) => httpsCallable(...args),
}));

import { createGetClientFirestore } from '../../src/client/firestore.js';
import { createMultiEnvClient } from '../../src/client/createClient.js';

describe('client firestore kit', () => {
  beforeEach(() => {
    getFirestore.mockReset();
    httpsCallable.mockReset();
    delete process.env.FIRESTORE_EMULATOR_HOST;
  });

  it('createGetClientFirestore uses named database for gated envs', () => {
    getFirestore.mockReturnValue({ id: 'qual-db' });
    const getDb = createGetClientFirestore({} as never, {
      appEnv: 'qual',
      databases: { production: '(default)', qual: 'qual-env' },
    });

    expect(getDb()).toEqual({ id: 'qual-db' });
    expect(getFirestore).toHaveBeenCalledWith({}, 'qual-env');
  });

  it('createGetClientFirestore uses default database for production', () => {
    getFirestore.mockReturnValue({ id: 'prod-db' });
    const getDb = createGetClientFirestore({} as never, {
      appEnv: 'production',
      databases: { production: '(default)', qual: 'qual-env' },
    });

    expect(getDb()).toEqual({ id: 'prod-db' });
    expect(getFirestore).toHaveBeenCalledWith({});
  });

  it('createMultiEnvClient wires callable and getDb', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: true });
    httpsCallable.mockReturnValue(invoke);
    getFirestore.mockReturnValue({ id: 'qual-db' });

    const client = createMultiEnvClient({
      app: {} as never,
      functions: {} as never,
      appEnv: 'qual',
      databases: { production: '(default)', qual: 'qual-env' },
    });

    expect(client.appEnv).toBe('qual');
    expect(client.getDb()).toEqual({ id: 'qual-db' });
    await client.callable('sync')({ a: 1 });
    expect(invoke).toHaveBeenCalledWith({ a: 1, appEnv: 'qual' });
  });
});
