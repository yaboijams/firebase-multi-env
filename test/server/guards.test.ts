import { describe, expect, it } from 'vitest';
import { requireAuth, requireClaim, requireOwner } from '../../src/server/guards.js';

describe('server guards', () => {
  it('requireAuth rejects missing auth', () => {
    expect(() => requireAuth(null)).toThrowError(/Sign in required/);
  });

  it('requireAuth returns the user', () => {
    expect(requireAuth({ uid: 'u1', token: {} })).toEqual({ uid: 'u1', token: {} });
  });

  it('requireOwner rejects non-owners', () => {
    expect(() => requireOwner({ uid: 'u1' }, 'u2')).toThrowError(/do not own/);
  });

  it('requireOwner allows matching uid', () => {
    expect(() => requireOwner({ uid: 'u1' }, 'u1')).not.toThrow();
  });

  it('requireClaim checks boolean and allowlist membership', () => {
    expect(() => requireClaim({ uid: 'u1', token: { admin: true } }, 'admin', true)).not.toThrow();
    expect(() =>
      requireClaim({ uid: 'u1', token: { allowedEnvs: ['qual'] } }, 'allowedEnvs', 'qual'),
    ).not.toThrow();
    expect(() =>
      requireClaim({ uid: 'u1', token: { allowedEnvs: ['cert'] } }, 'allowedEnvs', 'qual'),
    ).toThrowError(/Missing required claim/);
  });
});
