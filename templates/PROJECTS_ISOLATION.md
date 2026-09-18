# Multi-project isolation

**Full project separation:** one Firebase/GCP project per environment → separate Auth, billing, quotas, and IAM admin plane.

This is the strongest isolation option in `firebase-multi-env`. The default remains `isolationMode: 'databases'` (one project, shared Auth, multi-DB + claims).

## When to use

- Separate **billing / quotas** per env
- Separate **Auth** blast radius (prod users never share a pool with qual)
- Compliance expectation of real staging vs production projects

Tradeoff: same email ≠ same UID across envs; testers sign in per Hosting site.

## Setup

```bash
npx firebase-multi-env init --mode projects
# edit multi-env/skeleton.json (services, IAM role IDs, secret names, Auth providers)
npx firebase-multi-env provision --mode projects \
  --envs production:my-app-prod,qual:my-app-qual \
  --billing-account YOUR_BILLING_ACCOUNT_ID
bash multi-env/provision/projects/provision.all.sh
```

Generated scripts **create** each Firebase/GCP project if it does not exist
(`firebase projects:create`, with `gcloud projects create` fallback), link billing when
`--billing-account` is set, then apply the skeleton. Re-runs are idempotent.

Use `--skip-create-project` only when the projects already exist and you want IAM/secrets only.

After changing the skeleton:

```bash
npx firebase-multi-env parity all \
  --envs production:my-app-prod,qual:my-app-qual
```

Bootstrap selected people into non-prod Auth pools:

```bash
npx firebase-multi-env sync-users \
  --emails you@email.com,qa@email.com \
  --envs qual:my-app-qual
```

Do **not** use `grant-env` in this mode (that is for shared-Auth `allowedEnvs` claims).

## Runtime config

```ts
export const appEnvRuntime = createEnvRuntime({
  isolationMode: 'projects',
  pinned: true,
  pinnedEnvironment: process.env.APP_ENV,
  environments: {
    production: {
      projectId: 'my-app-prod',
      origins: ['https://my-app-prod.web.app'],
    },
    qual: {
      projectId: 'my-app-qual',
      origins: ['https://my-app-qual.web.app'],
    },
  },
});
```

On Cloud, `GCLOUD_PROJECT` must match the pinned env’s `projectId`. The process cannot open another env’s project.

## Client

```ts
createMultiEnvClient({
  app,
  functions,
  appEnv: 'qual',
  databases: { qual: '(default)', production: '(default)' },
  projectIds: {
    production: 'my-app-prod',
    qual: 'my-app-qual',
  },
});
```

## Skeleton ownership

| Piece | Owner |
|---|---|
| Starter `skeleton.json` | Package via `init` |
| Edited skeleton in the repo | **You** (source of truth) |
| Predefined IAM role IDs in the recipe | Skeleton (not package-owned custom roles) |
| Secret **values** | Never copied across projects |

## Sync vs non-sync

| Sync | How |
|---|---|
| Project shape / IAM recipe / secret **names** / Auth provider list | `provision` + `parity` from skeleton |
| Selected tester emails | `sync-users` |
| Full prod Auth dump / secret values / live Firestore data | **No** (defeats separation) |

## Residual risk

Sync misuse (cloning prod users/secrets into qual) re-couples blast radius. Keep parity on-demand and allowlisted.
