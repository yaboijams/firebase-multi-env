import type { EnvRuntime } from '../core/runtime.js';

/**
 * Wrap a Firebase Functions v2 onCall handler.
 * Strips client `appEnv`, resolves the real env from Origin + allowlist claims, runs in ALS.
 *
 * Request is typed loosely so peer `firebase-functions` versions do not conflict.
 */
export function createWithAppEnvV2(runtime: EnvRuntime) {
  return function withAppEnv<TData = unknown, TResult = unknown>(
    handler: (request: any) => Promise<TResult> | TResult,
  ): (request: any) => Promise<TResult> {
    return async (request: any) => {
      const data = request?.data;
      const record =
        data && typeof data === 'object' && !Array.isArray(data)
          ? { ...(data as Record<string, unknown>) }
          : {};

      const clientEnv = record.appEnv;
      delete record.appEnv;

      const env = runtime.resolveRequestEnv(clientEnv, {
        auth: request?.auth
          ? { uid: request.auth.uid, token: request.auth.token as Record<string, unknown> }
          : null,
        rawRequest: request?.rawRequest
          ? { headers: request.rawRequest.headers as Record<string, string | string[] | undefined> }
          : undefined,
      });

      const payload = Object.keys(record).length > 0 ? record : undefined;
      const nextRequest = {
        ...request,
        data: payload as TData,
      };

      return runtime.runWithEnv(env, () => handler(nextRequest));
    };
  };
}
