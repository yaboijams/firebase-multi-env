# Isolation model (one Firebase project)

This package provides **request-local environment routing** (Origin + claims) and a
**pinned production path** aimed at project-parity isolation (shared Auth, separate
data plane per env).

## Two layers

| Layer | What it answers | Who owns it |
|---|---|---|
| **Logical routing** (`pinned: false`) | Which env should *this request* use? | `firebase-multi-env` (local/dev only) |
| **Pinned deploy** (`pinned: true`) | Can *this process* only serve one env? | This package + your deploy |
| **IAM / service accounts** | Can compromised code open another DB? | Your GCP project |
| **Secrets / Storage / CI** | Can one env read another’s keys or ship to prod? | Your GCP + CI |
| **Separate projects** | Strongest blast-radius boundary | Optional upgrade |

## Recommended ladder (one project)

1. **Pinned deploys + per-env service accounts** — production default (see `PROJECT_PARITY.md`)
2. **Per-env secrets + Storage buckets** — close shared-credential gaps
3. **Deploy isolation (WIF / CI)** — stop humans and bots from cross-wiring envs
4. **Org policy + deny policies** — stop re-attaching broad roles
5. **Separate Firebase/GCP projects** — when blast radius must be small

Logical (unpinned) Origin→DB selection is for **emulators and local multi-env convenience**.
Deployed Cloud Functions refuse unpinned config unless `allowUnpinnedCloudDeploy: true`.

## Pinned mode (required for production)

Each environment gets its own Functions deploy (or codebase target) running as its own service account.

```ts
export const appEnvRuntime = createEnvRuntime({
  pinned: true,
  pinnedEnvironment: process.env.APP_ENV, // e.g. "qual"
  environments: {
    production: {
      database: '(default)',
      origins: ['https://myapp.web.app'],
    },
    qual: {
      database: 'qual-env',
      origins: ['https://myapp-qual.web.app'],
      requireClaim: true,
    },
  },
});
```

Effects:

- Origin must map to the pinned env (or localhost/emulator hint must match it)
- Unknown / missing hosted Origin **rejects** by default
- Referer fallback is **off** by default (`allowRefererFallback: false`)
- Emulator host env vars on a real Cloud deploy are **refused**
- `getDb()` / `getRuntimeEnv()` **throw** outside a `withAppEnv*` wrapper
- Scripts/jobs should use `getDbForEnv('qual')` instead of bare `getDb()`
- This process cannot resolve another environment’s database through the runtime
- Unpinned config **throws at startup** on a real Cloud deploy

Pair with IAM so `sa-qual` can only access `qual-env`. See:

- `iam-sa-per-env.md`
- `secrets-per-env.md`
- `deploy-isolation.md`
- `PROJECT_PARITY.md`
- `THREAT_MODEL.md`

## Logical mode (local / emulator)

One Functions process may serve many environments; Origin selects the DB.

```ts
createEnvRuntime({
  pinned: false, // local only — blocked on Cloud deploy by default
  // optional hardening if you must share a runtime:
  rejectUnknownOrigin: true,
  requireRequestContext: true,
  allowRefererFallback: false,
  environments: { /* ... */ },
});
```

Escape hatch for intentional shared cloud runtimes:

```ts
createEnvRuntime({
  pinned: false,
  allowUnpinnedCloudDeploy: true,
  environments: { /* ... */ },
});
```

## Default service account

Keep the project’s default App Engine / Compute SA, but **do not run env-scoped Functions as it**.

| Identity | Use |
|---|---|
| `sa-prod` / `sa-qual` / … | Function runtime per env |
| Default SA | Platform leftover — minimize roles; avoid app runtimes |
| Deployer SA / WIF | CI only |

## Honest residual risk

Even with pinned deploys + per-env SAs, one project still shares Auth, billing, and the IAM admin plane. That is usually enough for SaaS staging. Separate projects remain the cleaner hard boundary.
