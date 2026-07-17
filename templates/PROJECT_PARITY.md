# Project parity checklist

Goal: **AWS-style env roles inside one Firebase/GCP project** — shared Auth, hard-enough isolation for QA/staging vs production without separate Firebase projects.

This is the production path for `firebase-multi-env`. Logical (unpinned) mode remains for local/dev only.

## Gate in CI

```bash
npx firebase-multi-env doctor --strict
```

Also enable the ESLint plugin:

```js
// eslint.config.js
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

## Must-have

- [ ] **Pinned Functions** — `createEnvRuntime({ pinned: true, pinnedEnvironment: process.env.APP_ENV, ... })`
- [ ] **One Functions deploy (codebase) per env** — see `firebase.codebases.example.json`
- [ ] **One runtime service account per env** — generate with `npx firebase-multi-env provision` (see `PROVISION.md` / `iam-sa-per-env.md`)
- [ ] **Hosting target per env** rewrites only to that env’s codebase
- [ ] **Per-env secrets** — Secret Manager + SA bindings; no shared `STRIPE_SECRET` — see `secrets-per-env.md` / `provision`
- [ ] **Deploy isolation** — separate CI jobs / WIF identities; prod deployer cannot deploy qual — see `deploy-isolation.md`
- [ ] **Firestore rules per database** — gated DBs check `allowedEnvs`; prod does not
- [ ] **Storage bucket per env** — provision scripts + `storage.gated.rules.snippet`
- [ ] **Shared Auth + claims** — gate non-prod with `grant-env` (`allowedEnvs`); not separate Auth pools
- [ ] **No bare `admin.firestore()`** — only `getDb()` / `getDbForEnv()`
- [ ] **HTTP handlers** use `verifyIdToken: true`
- [ ] **Jobs/scripts** use `getDbForEnv('qual')`, never silent `getDb()` outside request context
- [ ] **`doctor --strict` passes** in CI

## Strongly recommended

- [ ] `onResolveEnv` audit logging
- [ ] Default App Engine SA not used by env-scoped Functions
- [ ] Org policy / deny policies limiting Datastore roles where possible
- [ ] Branch protection: production deploys only from `main`

## Honest residual risk

One project still shares Auth, billing, quotas, and the IAM admin plane. If those must be isolated, use separate Firebase/GCP projects (at least for production data).
