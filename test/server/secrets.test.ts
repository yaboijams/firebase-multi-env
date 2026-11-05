import { afterEach, describe, expect, it } from 'vitest';
import {
  createSecrets,
  functionPrefixForEnv,
  secretResourceId,
} from '../../src/server/secrets.js';

const ENV_KEYS = ['STRIPE_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_SECRET_QUAL'] as const;

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

describe('functionPrefixForEnv / secretResourceId', () => {
  it('maps production to prod prefix', () => {
    expect(functionPrefixForEnv('production')).toBe('prod');
    expect(secretResourceId('production', 'STRIPE_SECRET')).toBe('prod-STRIPE_SECRET');
  });

  it('keeps qual/cert slugs', () => {
    expect(functionPrefixForEnv('qual')).toBe('qual');
    expect(secretResourceId('qual', 'STRIPE_SECRET')).toBe('qual-STRIPE_SECRET');
    expect(secretResourceId('cert', 'SENDGRID')).toBe('cert-SENDGRID');
  });
});

describe('createSecrets', () => {
  it('reads local process.env before SecretParam', () => {
    process.env.STRIPE_SECRET = 'sk_test_from_env';
    const secrets = createSecrets(['STRIPE_SECRET']);
    expect(secrets.names).toEqual(['STRIPE_SECRET']);
    expect(secrets.params).toHaveLength(1);
    expect(secrets.get('STRIPE_SECRET')).toBe('sk_test_from_env');
    expect(secrets.require('STRIPE_SECRET')).toBe('sk_test_from_env');
  });

  it('honors envKeys aliases', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_alias';
    const secrets = createSecrets([
      { name: 'STRIPE_SECRET', envKeys: ['STRIPE_SECRET_KEY'] },
    ]);
    expect(secrets.get('STRIPE_SECRET')).toBe('sk_test_alias');
  });

  it('require throws when missing', () => {
    const secrets = createSecrets(['STRIPE_SECRET']);
    expect(() => secrets.require('STRIPE_SECRET')).toThrow(/Missing secret "STRIPE_SECRET"/);
  });

  it('rejects empty and duplicate specs', () => {
    expect(() => createSecrets([])).toThrow(/at least one/);
    expect(() => createSecrets(['STRIPE_SECRET', 'STRIPE_SECRET'])).toThrow(/duplicate/);
  });

  it('param lookup fails closed for unknown names', () => {
    const secrets = createSecrets(['STRIPE_SECRET']);
    expect(() => secrets.param('NOPE')).toThrow(/unknown secret/);
    expect(() => secrets.get('NOPE')).toThrow(/unknown secret/);
  });
});
