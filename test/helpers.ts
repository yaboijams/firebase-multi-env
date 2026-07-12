import type { EnvRuntimeConfig } from '../src/types.js';

export const multiEnvConfig = {
  environments: {
    production: {
      database: '(default)',
      origins: [
        'https://myapp.web.app',
        'https://myapp.firebaseapp.com',
      ],
    },
    qual: {
      database: 'qual-env',
      origins: ['https://myapp-qual.web.app'],
      requireClaim: true,
    },
    cert: {
      database: 'cert-env',
      origins: ['https://myapp-cert.web.app'],
      requireClaim: true,
    },
  },
} satisfies EnvRuntimeConfig;

export function authContext(options?: {
  uid?: string;
  allowedEnvs?: string[];
  claimKey?: string;
  origin?: string;
  referer?: string;
}) {
  const claimKey = options?.claimKey ?? 'allowedEnvs';
  const token: Record<string, unknown> = {};
  if (options?.allowedEnvs) {
    token[claimKey] = options.allowedEnvs;
  }

  return {
    auth: options?.uid || options?.allowedEnvs
      ? {
          uid: options.uid ?? 'user-1',
          token,
        }
      : null,
    rawRequest: options?.origin || options?.referer
      ? {
          headers: {
            ...(options.origin ? { origin: options.origin } : {}),
            ...(options.referer ? { referer: options.referer } : {}),
          },
        }
      : undefined,
  };
}
