# firebase-multi-env

[![npm](https://img.shields.io/npm/v/firebase-multi-env.svg)](https://www.npmjs.com/package/firebase-multi-env)

**Hardened single-project environment isolation** for Firebase: Origin → environment → Firestore database, with claim-based authorization for gated environments and optional **pinned** per-env deploys.

One Firebase project, multiple Firestore databases, multiple Hosting sites. Production users do not need special rights; gated envs (qual/cert/…) require an `allowedEnvs` claim.

> This package does **not** replace separate Firebase projects. Prefer **pinned mode + per-env service accounts** when you want shared Auth and AWS-style role/env separation inside one project. Separate projects remain the strongest blast-radius boundary — see [Security model](#security-model) and `templates/THREAT_MODEL.md`.

## Package layout

```text
src/
  core/        # types, config normalization, env runtime
  server/      # getDb, getDbForEnv, auth guards
  functions/   # callable v1/v2 + HTTP wrappers
  client/      # callable, client Firestore, multi-env client kit
templates/     # rules snippets, isolation + threat-model docs, pinned deploy examples
bin/           # grant-env, init, doctor
```

Public imports:

| Import | Purpose |
|---|---|
| `firebase-multi-env/server` | `createEnvRuntime`, `createGetDb`, `createGetDbForEnv`, guards |
| `firebase-multi-env/functions-v1` | callable wrapper (v1) |
| `firebase-multi-env/functions-v2` | callable wrapper (v2) |
| `firebase-multi-env/http` | `onRequest` / Express-style wrapper |
| `firebase-multi-env/client` | callable + client Firestore kit |

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

This is **logical request routing** plus optional **pinned deploy isolation**. It is not a cryptographic Hosting lock and not a substitute for IAM between databases.

**Protects against:** client `appEnv` overrides, accidental dynamic DB selection, ungated non-prod access, wrong Origin on a pinned runtime, silent `getDb()` outside request context (when configured), leaked emulator env vars on pinned deploys.

**Does not automatically protect against:** overly broad service accounts, direct Admin SDK bypasses, shared secrets, bad IAM/CI, or shared-project blast radius.

Full matrix: [`SECURITY.md`](./SECURITY.md) and [`templates/THREAT_MODEL.md`](./templates/THREAT_MODEL.md).

## Isolation (`pinned`) — recommended for production

| `pinned` | Deploy shape | What Origin does |
|---|---|---|
| `false` (default) | One Functions runtime may serve many envs | **Selects** which DB (mainly for local/dev) |
| `true` | One deploy (+ SA) per env | **Confirms** the pinned env |

**Pinned** is the recommended production posture inside one GCP project:

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

Pair with a dedicated service account per env (do **not** run these Functions as the project default SA). Templates:

- `multi-env/ISOLATION.md` (via `init`)
- `multi-env/THREAT_MODEL.md`
- `multi-env/iam-sa-per-env.md`
- `multi-env/functions.pinned.qual.example.ts`

Scripts and background jobs should use an explicit DB accessor (never rely on silent defaults):

```ts
import { createGetDb, createGetDbForEnv } from 'firebase-multi-env/server';

export const getDb = createGetDb(appEnvRuntime);
export const getDbForEnv = createGetDbForEnv(appEnvRuntime);

// in a scheduled job / script:
const db = getDbForEnv('qual');
```

Optional hardening without pinning:

```ts
createEnvRuntime({
  pinned: false, // default — prefer pinned for production
  rejectUnknownOrigin: true,
  requireRequestContext: true,
  allowRefererFallback: false,
  environments: { /* ... */ },
});
```

## Quick start scaffolding

```bash
npx firebase-multi-env init
npx firebase-multi-env doctor
```

Writes:

- `firestore.rules.snippets/` (gated + public templates)
- `MULTI_ENV_SETUP.md`
- `multi-env/` isolation docs + pinned deploy examples

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
- `pinned` / unpinned routing modes (pinned recommended for production)
- Gated-env allowlist claims for Functions (callable + HTTP)
- Hardened Origin parsing (no multi-value / `null` / non-http schemes)
- Optional Referer fallback (off by default when pinned)
- Emulator-env leak refusal on deployed pinned functions
- `getDbForEnv` for scripts/jobs; fail-closed `getDb` when request context is required
- `onResolveEnv` audit hook
- Optional HTTP ID token verification
- Client callable + Firestore helpers
- Server guards (`requireAuth`, `requireOwner`, `requireClaim`)
- Rules templates + `init` / `doctor` scaffolding
- CLI grant/revoke for `allowedEnvs`
- Docs/templates for per-env service accounts and threat model

Still app-owned: Auth UI/sign-in flows, domain-specific RBAC, IAM bindings, org policies, and full product security rules beyond the templates.

## Releasing

Releases use [semantic-release](https://semantic-release.org/) on `main`.

1. npm granular token (read/write + bypass 2FA)
2. GitHub Actions secret `NPM_SECRET` (mapped to `NPM_TOKEN` in the workflow)
3. Conventional Commits: `fix:` patch, `feat:` minor, `BREAKING CHANGE` / `feat!:` major

## License

MIT
