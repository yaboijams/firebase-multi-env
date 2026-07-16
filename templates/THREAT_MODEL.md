# Threat model

`firebase-multi-env` is a **hardened single-project environment isolation framework**.
It is **not** a drop-in replacement for separate Firebase/GCP projects.

## Positioning

| Approach | Best for |
|---|---|
| Separate Firebase projects | Highest blast-radius isolation (billing, IAM admin, Auth) |
| **Pinned mode + per-env SAs** (this package) | Shared Auth / one project, AWS-style role→env separation |
| Logical (dynamic) mode | Local/dev, emulators, low-risk internal tools |

For production, prefer:

```ts
createEnvRuntime({
  pinned: true,
  pinnedEnvironment: process.env.APP_ENV,
  environments: { /* ... */ },
});
```

## What this package protects against

| Threat | Handling |
|---|---|
| Client sets `appEnv` / body field to reach another env | **Handled** — hosted Origin wins; client hint only on localhost/emulator |
| QA user hits gated env without `allowedEnvs` claim | **Handled** — claim check on gated envs |
| Prod Origin accidentally selects qual DB on a multi-env runtime | **Handled** — Origin→env map |
| Wrong Origin hits a pinned runtime | **Handled** — pinned deploy refuses other envs |
| Missing / unknown Origin on hardened deploys | **Handled** — `rejectUnknownOrigin` (default when pinned) |
| `getDb()` outside request context silently using prod | **Handled** when `requireRequestContext` (default when pinned); use `getDbForEnv` for jobs |
| Referer spoofing used as a security signal | **Mitigated** — Referer fallback off by default when pinned |
| Multi-value / `null` / non-http Origin headers | **Handled** — rejected by Origin parser |
| Suffix-domain Origin tricks (`prod.example.com.evil.com`) | **Handled** — exact origin map match after normalize |
| Leaked `FIRESTORE_EMULATOR_HOST` on a deployed function | **Handled** when `refuseEmulatorEnvOutsideEmulator` (default when pinned) |

## What this package does **not** automatically protect against

| Threat | Requires |
|---|---|
| Overly broad / shared service accounts | Per-env SAs + IAM (see `iam-sa-per-env.md`) |
| Direct Admin SDK `getFirestore()` bypassing wrappers | App discipline / lint; pair with pinned SA that cannot open other DBs |
| Exposed or shared secrets (`STRIPE_SECRET` for all envs) | Secret Manager per-env + SA bindings |
| Compromised CI/CD or deployer identity | Branch protection, WIF, least-privilege deploy SA |
| Compromised function runtime with broad IAM | IAM isolation; separate projects for high sensitivity |
| Shared project billing / quota / Auth blast radius | Separate projects |
| Server-to-server calls authenticated only by Origin | IAM-authenticated invokers; do not trust Origin for S2S |
| Bad Firestore rules on a gated DB | Rules that check `allowedEnvs` (templates in `templates/`) |

## Recommended production checklist

- [ ] `pinned: true` with `APP_ENV` / `pinnedEnvironment`
- [ ] Dedicated service account per environment
- [ ] Secrets scoped per environment SA
- [ ] `rejectUnknownOrigin` left on (pinned default)
- [ ] `requireRequestContext` left on (pinned default)
- [ ] `allowRefererFallback` left off (pinned default)
- [ ] HTTP functions use `verifyIdToken: true`
- [ ] Scripts/jobs use `getDbForEnv('qual')` (never bare `getDb()`)
- [ ] Optional `onResolveEnv` audit logging enabled
- [ ] Firestore rules tested per database
- [ ] CI deploys production only from a protected branch

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
