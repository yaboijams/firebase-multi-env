# Deploy isolation (CI / WIF / Hosting)

Pinned mode only helps if **deployers** cannot cross-wire environments.

## Principles

1. **One Hosting target → one Functions codebase → one runtime SA → one Firestore DB**
2. **Prod CI identity cannot deploy qual** (and vice versa preferred)
3. **Runtime SA ≠ deployer SA**

## Hosting rewrites

See `firebase.codebases.example.json`. Each site must rewrite API traffic only to its codebase:

```json
{
  "hosting": [
    {
      "target": "qual",
      "public": "dist",
      "rewrites": [
        { "source": "/api/**", "function": { "functionId": "api", "codebase": "qual" } }
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
- [ ] Branch protection on production deploy workflow
- [ ] `doctor --strict` runs before deploy
- [ ] Runtime `serviceAccount` on each function matches `APP_ENV`
- [ ] Default compute SA not used for deploys or runtimes
