export type {
  AppEnvironment,
  EnvironmentDefinition,
  EnvRuntimeConfig,
  EnvResolveEvent,
  EnvResolveSource,
  IsolationMode,
  RuntimeEnv,
  EnvRequestContext,
  AuthLike,
} from './core/types.js';
export { createEnvRuntime, type EnvRuntime, parseOriginHeader } from './core/runtime.js';
export { createGetDb, createGetDbForEnv } from './server/getDb.js';
export { requireAuth, requireOwner, requireClaim } from './server/guards.js';
export { createWithAppEnvV1 } from './functions/v1.js';
export { createWithAppEnvV2 } from './functions/v2.js';
export {
  createWithAppEnvHttp,
  type WithAppEnvHttpOptions,
} from './functions/http.js';
export {
  createCallable,
  createGetClientFirestore,
  createMultiEnvClient,
  resolveFunctionId,
  isValidFunctionPrefix,
  assertClientProjectId,
} from './client/index.js';
export type {
  CreateCallableOptions,
  CreateMultiEnvClientOptions,
  FunctionPrefixOptions,
} from './client/index.js';
