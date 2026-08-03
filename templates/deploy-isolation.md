# Deploy isolation (CI / WIF / Hosting)

Pinned mode only helps if **deployers** cannot cross-wire environments.

## Principles

1. **One Hosting target → one Functions codebase (+ `prefix`) → one runtime SA → one Firestore DB**
2. **Prod CI identity cannot deploy qual** (and vice versa preferred)
3. **Runtime SA ≠ deployer SA**
4. **Function IDs must be unique in the project** — use firebase.json `prefix` so the same source can deploy `qual-api` and `prod-api`

## Function prefixes (required for same-source multi-env)

Firebase rejects duplicate function IDs across codebases. Set a per-codebase `prefix`; the CLI deploys `${prefix}-${exportName}`:

```json
{
  "functions": [
    { "source": "functions", "codebase": "prod", "prefix": "prod", "configDir": "functions/config/prod" },
    { "source": "functions", "codebase": "qual", "prefix": "qual", "configDir": "functions/config/qual" }
  ]
}
```

Export `api` / `syncData` once in source → deployed as `qual-api`, `prod-syncData`, etc.

Client builds must call the prefixed name (or use `createCallable` / `createMultiEnvClient` with `prefixes`).

Secret Manager secret *resource* names used via `defineSecret` are also prefixed by the CLI (`qual-STRIPE_SECRET`). Keep that in sync with `secrets-per-env.md`.

## Hosting rewrites

See `firebase.codebases.example.json`. Each site must rewrite API traffic only to its **prefixed** functionId + codebase:

```json
{
  "hosting": [
    {
      "target": "qual",
      "public": "dist",
      "rewrites": [
        { "source": "/api/**", "function": { "functionId": "qual-api", "codebase": "qual" } }
      ]
    }
  ]
}
```

## Workload Identity Federation (GitHub Actions)

Create **two** WIF-backed deployer service accounts:

| Identity | Can deploy |
|---|---|
| `deploy-prod@...` | Hosting `prod`, Functions codebase `prod`, rules for `(default)` |
| `deploy-qual@...` | Hosting `qual`, Functions codebase `qual`, rules for `qual-env` |

Grant Firebase / Cloud Functions Admin only as narrowly as your org allows. Prefer separate custom roles over `roles/editor`.

## Example workflow matrix

Copy `github-actions.deploy.example.yml` into `.github/workflows/` and fill in project / WIF provider values.

Critical bits:

- `APP_ENV` set per job (`production` / `qual`)
- Separate `workload_identity_provider` + `service_account` per env
- Qual job may run on PRs; prod job only on `main` / tags

## Manual deploys

```bash
# Qual
APP_ENV=qual firebase deploy --only functions:qual,hosting:qual

# Prod (protected branch / break-glass only)
APP_ENV=production firebase deploy --only functions:prod,hosting:prod
```

## Checklist

- [ ] Separate deployer SAs (or at least prod deployer cannot touch qual codebase)
- [ ] Each functions codebase has a unique `prefix` (same source + different prefixes is OK)
- [ ] Hosting rewrites use prefixed `functionId` values (`qual-api`, not `api`)
- [ ] Client `prefixes` / `functionPrefix` match firebase.json
- [ ] Branch protection on production deploy workflow
- [ ] `doctor --strict` runs before deploy
- [ ] Runtime `serviceAccount` on each function matches `APP_ENV`
- [ ] Default compute SA not used for deploys or runtimes
