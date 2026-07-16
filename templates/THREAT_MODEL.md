# Threat model

`firebase-multi-env` is a **hardened single-project environment isolation framework**.
With **pinned mode + per-env IAM/secrets/CI**, it aims for **project-parity** isolation
(shared Auth, AWS-style role→env separation). It is still **not** a cryptographic
substitute for separate Firebase/GCP projects when blast radius must be absolute.

## Positioning

| Approach | Best for |
|---|---|
| Separate Firebase projects | Highest blast-radius isolation (billing, IAM admin, Auth) |
| **Pinned + per-env SA/secrets/CI** (this package’s production path) | Shared Auth / one project, project-parity staging vs prod |
| Logical (unpinned) mode | Local/dev, emulators only |

For production:

```ts
createEnvRuntime({
  pinned: true,
  pinnedEnvironment: process.env.APP_ENV,
  environments: { /* ... */ },
});
```

Gate CI with:

```bash
npx firebase-multi-env doctor --strict
```

## What this package protects against

| Threat | Handling |
|---|---|
| Client sets `appEnv` / body field to reach another env | **Handled** — hosted Origin wins; client hint only on localhost/emulator |
| QA user hits gated env without `allowedEnvs` claim | **Handled** — claim check on gated envs |
| Prod Origin accidentally selects qual DB on a multi-env runtime | **Handled** — Origin→env map; pinned refuses other envs |
| Wrong Origin hits a pinned runtime | **Handled** — pinned deploy refuses other envs |
| Missing / unknown Origin on hardened deploys | **Handled** — `rejectUnknownOrigin` (default when pinned) |
| `getDb()` outside request context silently using prod | **Handled** when `requireRequestContext` (default when pinned); use `getDbForEnv` for jobs |
| Referer spoofing used as a security signal | **Mitigated** — Referer fallback off by default when pinned |
| Multi-value / `null` / non-http Origin headers | **Handled** — rejected by Origin parser |
| Suffix-domain Origin tricks (`prod.example.com.evil.com`) | **Handled** — exact origin map match after normalize |
| Leaked `FIRESTORE_EMULATOR_HOST` on a deployed function | **Handled** when `refuseEmulatorEnvOutsideEmulator` (default when pinned) |
| Unpinned shared runtime deployed to Cloud Functions | **Handled** — startup assert unless `allowUnpinnedCloudDeploy` |
| Accidental bare `admin.firestore()` in app code | **Mitigated** — ESLint rule + `doctor --strict` |

## What this package does **not** automatically protect against

| Threat | Requires |
|---|---|
| Overly broad / shared service accounts | Per-env SAs + IAM (see `iam-sa-per-env.md`) |
| Direct Admin SDK `getFirestore()` bypassing wrappers | ESLint + discipline; pair with pinned SA that cannot open other DBs |
| Exposed or shared secrets (`STRIPE_SECRET` for all envs) | Secret Manager per-env + SA bindings (`secrets-per-env.md`) |
| Compromised CI/CD or deployer identity | Branch protection, WIF, least-privilege deploy SA (`deploy-isolation.md`) |
| Compromised function runtime with broad IAM | IAM isolation; separate projects for high sensitivity |
| Shared project billing / quota / Auth blast radius | Separate projects |
| Server-to-server calls authenticated only by Origin | IAM-authenticated invokers; do not trust Origin for S2S |
| Bad Firestore / Storage rules on a gated DB | Rules that check `allowedEnvs` (templates in `templates/`) |

## Recommended production checklist

See **`PROJECT_PARITY.md`** for the full gate list. Summary:

- [ ] `pinned: true` with `APP_ENV` / `pinnedEnvironment`
- [ ] Dedicated service account per environment
- [ ] Secrets scoped per environment SA
- [ ] Separate CI / WIF deployer per env
- [ ] Storage bucket + rules per env
- [ ] `doctor --strict` + ESLint plugin in CI
- [ ] HTTP functions use `verifyIdToken: true`
- [ ] Scripts/jobs use `getDbForEnv('qual')`
- [ ] Optional `onResolveEnv` audit logging

## Audit hook

```ts
createEnvRuntime({
  pinned: true,
  pinnedEnvironment: process.env.APP_ENV,
  environments: { /* ... */ },
  onResolveEnv: (event) => {
    logger.info('env_resolved', event);
    // event.resolvedEnv, origin, uid, functionName,
    // pinnedEnvironment, databaseId, source, allowedByClaim, rejectedReason
  },
});
```
