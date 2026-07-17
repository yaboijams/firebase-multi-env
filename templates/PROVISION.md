# Provision (generate per-env IAM scripts)

`firebase-multi-env provision` writes **reviewable** `gcloud` scripts for:

- Runtime service accounts (`fn-prod`, `fn-qual`, …)
- Storage buckets per env
- Firestore database create hints
- Datastore IAM (DB-scoped condition when possible)
- Secret Manager placeholders + per-SA accessor bindings

It does **not** call GCP. You run the scripts with a deployer identity.

## Auth stays shared

Stock Firebase Auth is one user pool per project. Gate non-prod with claims:

```bash
npx firebase-multi-env grant-env qual --project my-app you@email.com
```

This command does not create Auth tenants. Identity Platform multi-tenancy is a separate upgrade path if you need separate user directories.

## Usage

```bash
npx firebase-multi-env provision \
  --project my-app \
  --envs production,qual,cert

# Explicit Firestore database IDs
npx firebase-multi-env provision \
  --project my-app \
  --envs production:(default),qual:qual-env,cert:cert-env \
  --secrets STRIPE_SECRET,SENDGRID \
  --location nam5 \
  --dir multi-env/provision

# Preview only
npx firebase-multi-env provision --project my-app --envs production,qual --print
```

Defaults:

| Env name | SA | Firestore DB | Bucket | Secret suffix |
|---|---|---|---|---|
| `production` / `prod` | `fn-prod` | `(default)` | `{project}-prod` | `PROD` |
| `qual` | `fn-qual` | `qual-env` | `{project}-qual` | `QUAL` |
| other | `fn-{name}` | `{name}-env` | `{project}-{name}` | uppercased |

## After generation

```bash
bash multi-env/provision/provision.all.sh
# or one env:
bash multi-env/provision/provision.qual.sh
```

Then:

1. Replace `REPLACE_ME_*` secret values
2. Attach each SA on Functions (`serviceAccount` + `APP_ENV`)
3. `npx firebase-multi-env doctor --strict`
4. Grant claims for gated users

## Residual risk

If the DB-scoped IAM condition is rejected, the script falls back to project-level
`roles/datastore.user`. That is weaker isolation — use deny policies or separate
projects for high-sensitivity data. See `iam-sa-per-env.md` and `THREAT_MODEL.md`.
