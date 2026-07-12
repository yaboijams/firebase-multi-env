import type { EnvRuntime } from '../core/runtime.js';

/**
 * Wrap a Firebase Functions v1 onCall handler.
 * Strips client `appEnv`, resolves the real env from Origin + allowlist claims, runs in ALS.
 *
 * Context is typed as `any` so peer `firebase-functions` versions do not conflict.
 */
export function createWithAppEnvV1(runtime: EnvRuntime) {
  return function withAppEnv<TData = unknown, TResult = unknown>(
    handler: (data: TData, context: any) => Promise<TResult> | TResult,
  ): (data: any, context: any) => Promise<TResult> {
    return async (data: any, context: any) => {
      const record =
        data && typeof data === 'object' && !Array.isArray(data)
          ? { ...(data as Record<string, unknown>) }
          : {};

      const clientEnv = record.appEnv;
      delete record.appEnv;

      const env = runtime.resolveRequestEnv(clientEnv, {
        auth: context?.auth
          ? { uid: context.auth.uid, token: context.auth.token as Record<string, unknown> }
          : null,
        rawRequest: context?.rawRequest
          ? { headers: context.rawRequest.headers as Record<string, string | string[] | undefined> }
          : undefined,
      });

      const payload = (Object.keys(record).length > 0 ? record : {}) as TData;
      return runtime.runWithEnv(env, () => handler(payload, context));
    };
  };
}
