import { getAuth } from 'firebase-admin/auth';
import type { EnvRuntime } from '../core/runtime.js';
import type { AuthLike } from '../core/types.js';

type HeaderMap = Record<string, string | string[] | undefined>;

export type WithAppEnvHttpOptions = {
  /**
   * Verify `Authorization: Bearer <idToken>` with Admin Auth when `req.auth` is absent.
   * Recommended for raw `onRequest` handlers (Firebase does not populate auth by default).
   * @default false
   */
  verifyIdToken?: boolean;
};

function headerValue(headers: HeaderMap, name: string): string | undefined {
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(direct)) {
    return direct[0];
  }
  return typeof direct === 'string' ? direct : undefined;
}

function clientHintFromRequest(req: any): string | undefined {
  const headerHint = headerValue(req?.headers ?? {}, 'x-app-env');
  if (headerHint?.trim()) {
    return headerHint.trim();
  }

  const query = req?.query;
  if (query && typeof query === 'object') {
    const value = query.appEnv ?? query.app_env;
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function authFromRequest(req: any): AuthLike {
  const auth = req?.auth;
  if (auth?.uid) {
    return {
      uid: auth.uid,
      token: (auth.token ?? auth.decodedIdToken ?? {}) as Record<string, unknown>,
    };
  }
  return null;
}

function bearerToken(headers: HeaderMap): string | null {
  const authorization = headerValue(headers, 'authorization');
  if (!authorization) {
    return null;
  }
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

async function resolveAuth(req: any, verifyIdToken: boolean): Promise<AuthLike> {
  const existing = authFromRequest(req);
  if (existing) {
    return existing;
  }
  if (!verifyIdToken) {
    return null;
  }

  const token = bearerToken((req?.headers ?? {}) as HeaderMap);
  if (!token) {
    return null;
  }

  const decoded = await getAuth().verifyIdToken(token);
  const auth = {
    uid: decoded.uid,
    token: decoded as unknown as Record<string, unknown>,
  };
  // Make verified auth visible to the handler.
  req.auth = auth;
  return auth;
}

/**
 * Wrap a Firebase Functions `onRequest` / Express-style handler.
 * Resolves env from Origin (+ optional localhost `x-app-env` / `?appEnv=` hint).
 *
 * For gated environments on raw HTTP, pass `{ verifyIdToken: true }` so
 * Bearer ID tokens are verified before claim checks run.
 */
export function createWithAppEnvHttp(
  runtime: EnvRuntime,
  options: WithAppEnvHttpOptions = {},
) {
  const verifyIdToken = options.verifyIdToken ?? false;

  return function withAppEnvHttp<TResult = unknown>(
    handler: (req: any, res: any) => Promise<TResult> | TResult,
  ): (req: any, res: any) => Promise<TResult | void> {
    return async (req: any, res: any) => {
      try {
        const auth = await resolveAuth(req, verifyIdToken);
        const env = runtime.resolveRequestEnv(clientHintFromRequest(req), {
          auth,
          rawRequest: {
            headers: (req?.headers ?? {}) as HeaderMap,
          },
        });

        return await runtime.runWithEnv(env, () => handler(req, res));
      } catch (error: any) {
        const code = typeof error?.code === 'string' ? error.code : 'internal';
        const message =
          typeof error?.message === 'string' ? error.message : 'Request failed.';

        if (typeof res?.status === 'function' && typeof res?.json === 'function') {
          const status =
            code === 'unauthenticated' ? 401
            : code === 'permission-denied' ? 403
            : code === 'failed-precondition' ? 400
            : code === 'auth/id-token-expired' || code === 'auth/argument-error' ? 401
            : 500;
          res.status(status).json({ error: { code, message } });
          return;
        }

        throw error;
      }
    };
  };
}
