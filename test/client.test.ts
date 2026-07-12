import { beforeEach, describe, expect, it, vi } from 'vitest';

const httpsCallable = vi.fn();

vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: unknown[]) => httpsCallable(...args),
}));

import { createCallable } from '../src/client.js';

describe('createCallable', () => {
  beforeEach(() => {
    httpsCallable.mockReset();
  });

  it('attaches appEnv to object payloads', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: 'ok' });
    httpsCallable.mockReturnValue(invoke);

    const callable = createCallable({} as never, { appEnv: 'qual' });
    await callable('syncData')({ foo: 1 });

    expect(httpsCallable).toHaveBeenCalledWith({}, 'syncData');
    expect(invoke).toHaveBeenCalledWith({ foo: 1, appEnv: 'qual' });
  });

  it('sends appEnv-only payload when data is missing or non-object', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null });
    httpsCallable.mockReturnValue(invoke);

    const callable = createCallable({} as never, { appEnv: 'cert' });
    await callable('ping')();
    await callable('ping')('raw' as never);

    expect(invoke).toHaveBeenNthCalledWith(1, { appEnv: 'cert' });
    expect(invoke).toHaveBeenNthCalledWith(2, { appEnv: 'cert' });
  });
});
