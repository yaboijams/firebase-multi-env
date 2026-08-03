import { beforeEach, describe, expect, it, vi } from 'vitest';

const httpsCallable = vi.fn();

vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: unknown[]) => httpsCallable(...args),
}));

import { createCallable } from '../../src/client/callable.js';
import {
  isValidFunctionPrefix,
  resolveFunctionId,
} from '../../src/client/functionId.js';

describe('resolveFunctionId', () => {
  it('joins prefix the same way as Firebase CLI (${prefix}-${name})', () => {
    expect(resolveFunctionId('syncData', { appEnv: 'qual', functionPrefix: 'qual' })).toBe(
      'qual-syncData',
    );
    expect(
      resolveFunctionId('syncData', {
        appEnv: 'qual',
        prefixes: { production: 'prod', qual: 'qual' },
      }),
    ).toBe('qual-syncData');
  });

  it('leaves bare names unchanged when no prefix is configured', () => {
    expect(resolveFunctionId('syncData', { appEnv: 'qual' })).toBe('syncData');
  });

  it('does not double-prefix an already-prefixed name', () => {
    expect(
      resolveFunctionId('qual-syncData', { appEnv: 'qual', functionPrefix: 'qual' }),
    ).toBe('qual-syncData');
  });

  it('rejects invalid firebase.json-style prefixes', () => {
    expect(() =>
      resolveFunctionId('syncData', { appEnv: 'qual', functionPrefix: 'qual-' }),
    ).toThrow(/Invalid functionPrefix/);
  });
});

describe('isValidFunctionPrefix', () => {
  it('accepts Firebase-valid prefixes', () => {
    expect(isValidFunctionPrefix('')).toBe(true);
    expect(isValidFunctionPrefix('q')).toBe(true);
    expect(isValidFunctionPrefix('qual')).toBe(true);
    expect(isValidFunctionPrefix('prod')).toBe(true);
    expect(isValidFunctionPrefix('my-env')).toBe(true);
  });

  it('rejects leading/trailing dashes and uppercase', () => {
    expect(isValidFunctionPrefix('qual-')).toBe(false);
    expect(isValidFunctionPrefix('-qual')).toBe(false);
    expect(isValidFunctionPrefix('Qual')).toBe(false);
  });
});

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

  it('resolves prefixed function ids when prefixes are configured', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: 'ok' });
    httpsCallable.mockReturnValue(invoke);

    const callable = createCallable({} as never, {
      appEnv: 'qual',
      prefixes: { production: 'prod', qual: 'qual' },
    });
    await callable('syncData')({ foo: 1 });

    expect(httpsCallable).toHaveBeenCalledWith({}, 'qual-syncData');
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
