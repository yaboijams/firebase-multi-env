import { httpsCallable, type Functions, type HttpsCallableResult } from 'firebase/functions';
import type { AppEnvironment } from '../core/types.js';
import {
  resolveFunctionId,
  type FunctionPrefixOptions,
} from './functionId.js';

export type CreateCallableOptions = FunctionPrefixOptions & {
  /**
   * Current client build environment name (must match a configured env key).
   * Used as a hint on localhost / emulators; hosted Origin always wins.
   */
  appEnv: AppEnvironment;
};

/**
 * Build a callable invoker that always attaches `appEnv` for server-side resolution
 * and resolves the deployed function ID via firebase.json `prefix` when configured.
 */
export function createCallable(functions: Functions, options: CreateCallableOptions) {
  const { appEnv } = options;

  return function callable<TData = Record<string, unknown>, TResult = unknown>(name: string) {
    const functionId = resolveFunctionId(name, options);
    const fn = httpsCallable(functions, functionId);
    return (data?: TData): Promise<HttpsCallableResult<TResult>> => {
      const payload =
        data && typeof data === 'object' && !Array.isArray(data)
          ? { ...(data as Record<string, unknown>), appEnv }
          : { appEnv };
      return fn(payload) as Promise<HttpsCallableResult<TResult>>;
    };
  };
}
