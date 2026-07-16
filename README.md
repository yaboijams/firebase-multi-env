# firebase-multi-env

[![npm](https://img.shields.io/npm/v/firebase-multi-env.svg)](https://www.npmjs.com/package/firebase-multi-env)

**Hardened single-project environment isolation** for Firebase: Origin → environment → Firestore database, with claim-based authorization for gated environments and **pinned** per-env deploys as the production path.

One Firebase project, multiple Firestore databases, multiple Hosting sites. Production users do not need special rights; gated envs (qual/cert/…) require an `allowedEnvs` claim.

> **Production path:** pinned mode + per-env service accounts + secrets + deploy isolation (project-parity). Separate Firebase projects remain the strongest blast-radius boundary for billing/Auth/admin — see [Security model](#security-model) and `templates/PROJECT_PARITY.md`.

## Package layout

```text
src/           # runtime, server, functions, client
eslint/        # no-bare-admin-firestore, require-pinned-runtime
templates/     # rules, IAM, secrets, deploy isolation, project parity
bin/           # grant-env, init, doctor [--strict]
```

Public imports:

| Import | Purpose |
|---|---|
| `firebase-multi-env/server` | `createEnvRuntime`, `createGetDb`, `createGetDbForEnv`, guards |
| `firebase-multi-env/functions-v1` | callable wrapper (v1) |
| `firebase-multi-env/functions-v2` | callable wrapper (v2) |
| `firebase-multi-env/http` | `onRequest` / Express-style wrapper |
| `firebase-multi-env/client` | callable + client Firestore kit |
| `firebase-multi-env/eslint` | ESLint plugin (forbid bare Admin Firestore / require pinned) |

## Install

```bash
npm install firebase-multi-env
npm install firebase firebase-admin firebase-functions
```

Local link:

```bash
npm run build && npm link
# in your app
npm link firebase-multi-env
```

## Security model

| Request from | Database | Needs `allowedEnvs`? |
|---|---|---|
| Public env Hosting origin (e.g. prod) | that env's DB | **No** |
| Gated env Hosting origin (e.g. qual/cert) | that env's DB | **Yes** |
| Localhost → cloud gated env | gated DB | **Yes** |
| Full local emulators | emulator default DB | **No** (optional) |

Client `appEnv` is only a **hint** on localhost. Hosted Origin always wins when recognized.

This is **request routing** plus **pinned deploy isolation**. Pair with IAM, secrets, and CI for project-parity. It is not a cryptographic Hosting lock.

**Protects against:** client `appEnv` overrides, accidental dynamic DB selection, ungated non-prod access, wrong Origin on a pinned runtime, unpinned Cloud deploys (startup assert), silent `getDb()` outside request context (when configured), leaked emulator env vars on pinned deploys, bare Admin Firestore (ESLint + doctor).

**Does not automatically protect against:** overly broad service accounts, shared secrets, bad IAM/CI, or shared-project Auth/billing blast radius — close those with the templates under `multi-env/` after `init`.

Full matrix: [`SECURITY.md`](./SECURITY.md) and [`templates/THREAT_MODEL.md`](./templates/THREAT_MODEL.md).

## Isolation (`pinned`) — required for production

| `pinned` | Deploy shape | What Origin does |
|---|---|---|
| `false` (default) | One process may serve many envs | **Selects** which DB (**local/dev only**) |
| `true` | One deploy (+ SA) per env | **Confirms** the pinned env |

Deployed Cloud Functions **reject unpinned** config at startup unless `allowUnpinnedCloudDeploy: true`.

```ts
export const appEnvRuntime = createEnvRuntime({
  pinned: true,
  pinnedEnvironment: process.env.APP_ENV, // "qual" for the qual deploy
  environments: { /* ... */ },
  onResolveEnv: (event) => logger.info('env_resolved', event), // optional audit
});
```

Pinned defaults:

- Unknown / missing hosted Origin → **reject** (`rejectUnknownOrigin: true`)
- `getDb()` / `getRuntimeEnv()` outside a request wrapper → **throw**
- Referer fallback → **off** (`allowRefererFallback: false`)
- Emulator host env vars on a real deploy → **refuse**
- Runtime refuses to serve any env other than the pinned one

Project-parity stack (via `init`):

- `multi-env/PROJECT_PARITY.md`
- `multi-env/iam-sa-per-env.md`
- `multi-env/secrets-per-env.md`
- `multi-env/deploy-isolation.md`
- `multi-env/github-actions.deploy.example.yml`
- Storage + Firestore rules snippets

Scripts and background jobs should use an explicit DB accessor (never rely on silent defaults):

```ts
import { createGetDb, createGetDbForEnv } from 'firebase-multi-env/server';

export const getDb = createGetDb(appEnvRuntime);
export const getDbForEnv = createGetDbForEnv(appEnvRuntime);

// in a scheduled job / script:
const db = getDbForEnv('qual');
```

Optional local hardening without pinning (not for Cloud deploys):

```ts
createEnvRuntime({
  pinned: false, // local/emulator only — blocked on Cloud unless allowUnpinnedCloudDeploy
  rejectUnknownOrigin: true,
  requireRequestContext: true,
  allowRefererFallback: false,
  environments: { /* ... */ },
});
```

## Quick start scaffolding

```bash
npx firebase-multi-env init
npx firebase-multi-env doctor --strict
```

Writes:

- `firestore.rules.snippets/` (Firestore + Storage, gated + public)
- `MULTI_ENV_SETUP.md`
- `multi-env/` — project parity, IAM, secrets, deploy isolation, pinned examples, CI workflow

### ESLint guardrails

```js
import multiEnv from 'firebase-multi-env/eslint';

export default [
  {
    plugins: { 'firebase-multi-env': multiEnv },
    rules: {
      'firebase-multi-env/no-bare-admin-firestore': 'error',
      'firebase-multi-env/require-pinned-runtime': 'error',
    },
  },
];
```
## One-time Firebase setup

```bash
firebase firestore:databases:create qual-env --location nam5
firebase firestore:databases:create cert-env --location nam5
firebase hosting:sites:create myapp-qual
firebase hosting:sites:create myapp-cert
firebase target:apply hosting qual myapp-qual
firebase target:apply hosting cert myapp-cert
firebase target:apply hosting prod myapp
```

Example `firebase.json`:

```json
{
  "firestore": [
    { "database": "(default)", "rules": "firestore.prod.rules", "indexes": "firestore.indexes.json" },
    { "database": "qual-env", "rules": "firestore.qual.rules", "indexes": "firestore.indexes.json" },
    { "database": "cert-env", "rules": "firestore.cert.rules", "indexes": "firestore.indexes.json" }
  ],
  "hosting": [
    { "target": "qual", "public": "dist" },
    { "target": "cert", "public": "dist" },
    { "target": "prod", "public": "dist" }
  ]
}
```

Rules templates ship in `templates/` (and via `init`). Gated DBs must check `allowedEnvs`; prod should not.

## Cloud Functions (callables)

```ts
import {
  createEnvRuntime,
  createGetDb,
  createGetDbForEnv,
  requireAuth,
  requireOwner,
} from 'firebase-multi-env/server';
import { createWithAppEnvV1 } from 'firebase-multi-env/functions-v1';

export const appEnvRuntime = createEnvRuntime({
  pinned: true,
  pinnedEnvironment: process.env.APP_ENV,
  environments: {
    production: {
      database: '(default)',
      origins: ['https://myapp.web.app', 'https://myapp.firebaseapp.com'],
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
});

export const getDb = createGetDb(appEnvRuntime);
export const getDbForEnv = createGetDbForEnv(appEnvRuntime);
export const withAppEnv = createWithAppEnvV1(appEnvRuntime);

export const syncData = functions.https.onCall(withAppEnv(async (data, context) => {
  const auth = requireAuth(context.auth);
  requireOwner(auth, data.userId);
  const db = getDb();
  // ...
}));
```

Optional overrides: `HOST_ORIGINS_<ENV>` (comma-separated).

## HTTP functions

```ts
import { createWithAppEnvHttp } from 'firebase-multi-env/http';
import { onRequest } from 'firebase-functions/v2/https';

// verifyIdToken is recommended: onRequest does not populate req.auth by default.
const withHttp = createWithAppEnvHttp(appEnvRuntime, { verifyIdToken: true });

export const api = onRequest(withHttp(async (req, res) => {
  const db = getDb();
  res.json({ env: appEnvRuntime.getEnvTag() });
}));
```

Localhost hints: `x-app-env` header or `?appEnv=`.

## Web client

```ts
import { createMultiEnvClient } from 'firebase-multi-env/client';
import { getFunctions } from 'firebase/functions';

const appEnv = import.meta.env.VITE_APP_ENV;
const { callable, getDb } = createMultiEnvClient({
  app,
  functions: getFunctions(app),
  appEnv,
  databases: {
    production: '(default)',
    qual: 'qual-env',
    cert: 'cert-env',
  },
});

await callable('syncData')({ /* payload */ });
const db = getDb();
```

Or use `createCallable` / `createGetClientFirestore` individually.

## Grant environment access

```bash
gcloud auth application-default login
npx firebase-multi-env grant-env qual --project my-project you@email.com
npx firebase-multi-env grant-env cert --project my-project you@email.com
# → { allowedEnvs: ['qual', 'cert'] }
# sign out / sign in

npx firebase-multi-env grant-env qual --revoke --project my-project you@email.com
```

## What this package covers

- Origin → environment → Firestore database routing
- **Pinned production path** (unpinned blocked on Cloud deploys by default)
- Gated-env allowlist claims for Functions (callable + HTTP)
- Hardened Origin parsing (no multi-value / `null` / non-http schemes)
- Optional Referer fallback (off by default when pinned)
- Emulator-env leak refusal on deployed pinned functions
- `getDbForEnv` for scripts/jobs; fail-closed `getDb` when request context is required
- `onResolveEnv` audit hook
- Optional HTTP ID token verification
- Client callable + Firestore helpers
- Server guards (`requireAuth`, `requireOwner`, `requireClaim`)
- Rules templates (Firestore + Storage) + `init` / `doctor --strict`
- ESLint plugin (`no-bare-admin-firestore`, `require-pinned-runtime`)
- CLI grant/revoke for `allowedEnvs`
- Templates for per-env SAs, secrets, deploy isolation, project-parity checklist

Still app-owned: Auth UI/sign-in flows, domain-specific RBAC, live IAM bindings, org policies, and full product security rules beyond the templates.

## Releasing

Releases use [semantic-release](https://semantic-release.org/) on `main`.

1. npm granular token (read/write + bypass 2FA)
2. GitHub Actions secret `NPM_SECRET` (mapped to `NPM_TOKEN` in the workflow)
3. Conventional Commits: `fix:` patch, `feat:` minor, `BREAKING CHANGE` / `feat!:` major

## License

MIT
