# Isolation model (one Firebase project)

This package provides **request-local environment routing** (Origin + claims).
Hard isolation between environments is a **deploy / IAM** concern.

## Two layers

| Layer | What it answers | Who owns it |
|---|---|---|
| **Logical routing** (`pinned: false`) | Which env should *this request* use? | `firebase-multi-env` |
| **Pinned deploy** (`pinned: true`) | Can *this process* only serve one env? | This package + your deploy |
| **IAM / service accounts** | Can compromised code open another DB? | Your GCP project |
| **Separate projects** | Strongest blast-radius boundary | Optional upgrade |

## Recommended ladder (one project)

1. **Logical routing** — Origin → env → DB, gated claims. Fine for low-stakes staging.
2. **Pinned deploys + per-env service accounts** — minimum real close of the shared-SA gap.
3. **Org policy + CI controls** — stop humans from re-attaching broad roles.
4. **Separate Firebase/GCP projects** — when blast radius must be small.

## Pinned mode (recommended for production)

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
- `getDb()` / `getRuntimeEnv()` **throw** outside a `withAppEnv*` wrapper
- This process cannot resolve another environment’s database through the runtime

Pair with IAM so `sa-qual` can only access `qual-env`. See `iam-sa-per-env.md`.

## Logical mode (default, backward compatible)

One Functions deploy may serve many environments; Origin selects the DB.

```ts
createEnvRuntime({
  pinned: false, // default
  // optional hardening:
  rejectUnknownOrigin: true,
  requireRequestContext: true,
  environments: { /* ... */ },
});
```

Use when convenience matters more than hard credential separation.

## Default service account

Keep the project’s default App Engine / Compute SA, but **do not run env-scoped Functions as it**.

| Identity | Use |
|---|---|
| `sa-prod` / `sa-qual` / … | Function runtime per env |
| Default SA | Platform leftover — minimize roles; avoid app runtimes |
| Deployer SA / WIF | CI only |

## Honest residual risk

Even with pinned deploys + per-env SAs, one project still shares Auth, billing, and the IAM admin plane. That is usually enough for SaaS staging. Separate projects remain the cleaner hard boundary.
