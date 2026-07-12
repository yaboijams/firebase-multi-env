import type { EnvRuntime } from '../core/runtime.js';
import type { AuthLike } from '../core/types.js';

type HeaderMap = Record<string, string | string[] | undefined>;

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

/**
 * Wrap a Firebase Functions `onRequest` / Express-style handler.
 * Resolves env from Origin (+ optional localhost `x-app-env` / `?appEnv=` hint).
 */
export function createWithAppEnvHttp(runtime: EnvRuntime) {
  return function withAppEnvHttp<TResult = unknown>(
    handler: (req: any, res: any) => Promise<TResult> | TResult,
  ): (req: any, res: any) => Promise<TResult | void> {
    return async (req: any, res: any) => {
      try {
        const env = runtime.resolveRequestEnv(clientHintFromRequest(req), {
          auth: authFromRequest(req),
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
            : 500;
          res.status(status).json({ error: { code, message } });
          return;
        }

        throw error;
      }
    };
  };
}
