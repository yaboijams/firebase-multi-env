# Per-env service accounts (one GCP project)

Goal: a compromised qual Function cannot open the production Firestore database,
because its runtime identity has no permission to do so.

Pair with `pinned: true`, `secrets-per-env.md`, and `deploy-isolation.md`.

## 1. Create service accounts

```bash
PROJECT_ID=your-project-id

gcloud iam service-accounts create fn-prod \
  --project="$PROJECT_ID" \
  --display-name="Functions runtime (production)"

gcloud iam service-accounts create fn-qual \
  --project="$PROJECT_ID" \
  --display-name="Functions runtime (qual)"
```

## 2. Grant least privilege at the DB boundary

Firestore multi-database IAM varies by org. Prefer the narrowest binding that still
lets the Admin SDK open **only** that database.

### Preferred: database-scoped conditions (when available)

```bash
# Example condition pattern — verify against current GCP IAM docs for Firestore.
# Restrict fn-qual so it cannot use the (default) / production database.

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:fn-qual@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user" \
  --condition='expression=resource.name.extract("/databases/{database}/") == "qual-env",title=qual_db_only'
```

If conditions are not supported in your org for Datastore:

1. Still use **separate runtime SAs** (defense in depth with pinned mode)
2. Add **deny policies** / org policy where possible
3. For high-sensitivity production data, use a **separate GCP project**

Also grant each SA only:

- Its Storage bucket(s)
- Its Secret Manager secrets (`secrets-per-env.md`)
- Cloud Logging / Tracing as needed

**Never** grant runtime SAs `roles/editor`, `roles/owner`, or project-wide secret admin.

## 3. Attach SA to each Functions deploy

Firebase Functions v2 example:

```ts
import { onCall } from 'firebase-functions/v2/https';

export const syncData = onCall(
  {
    serviceAccount: `fn-qual@${process.env.GCLOUD_PROJECT}.iam.gserviceaccount.com`,
  },
  withAppEnv(async (request) => {
    const db = getDb();
    // ...
  }),
);
```

Or configure per codebase / CI:

- Prod deploy: `APP_ENV=production`, service account `fn-prod@...`
- Qual deploy: `APP_ENV=qual`, service account `fn-qual@...`

## 4. Stop using the default SA for app runtimes

Leave `PROJECT_ID@appspot.gserviceaccount.com` in the project, but:

- Do not set it as the Functions runtime identity for env-scoped code
- Remove broad roles from it when nothing else needs them
- Use a dedicated deployer identity for CI (`firebase deploy`), not the runtime SAs

## 5. Verify isolation

```bash
# As fn-qual (impersonate), attempt to read production DB — should fail.
gcloud auth application-default login  # or impersonate fn-qual
# Then run a small Admin script that opens database '(default)' — expect PERMISSION_DENIED.
```

`npx firebase-multi-env doctor --strict` checks that sources reference `serviceAccount`
and `pinned: true`; it does not replace a live IAM audit.

## 6. Checklist

- [ ] One SA per environment that serves gated or production data
- [ ] Each Functions deploy sets `serviceAccount` + `APP_ENV` / `pinnedEnvironment`
- [ ] `createEnvRuntime({ pinned: true, ... })` on those deploys
- [ ] Hosting site for env N rewrites only to env N’s functions
- [ ] Default SA not used by those runtimes
- [ ] CI deployer ≠ runtime SA
- [ ] Qual SA cannot open production DB / secrets / bucket
