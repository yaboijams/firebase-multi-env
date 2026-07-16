# Per-env service accounts (one GCP project)

Goal: a compromised qual Function cannot open the production Firestore database,
because its runtime identity has no permission to do so.

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

## 2. Grant least privilege

Firestore multi-database IAM is not as fine-grained as Cloud Storage bucket ACLs
in every setup. Prefer the narrowest role that still lets Admin SDK access
**only** that database. If your org can only grant project-level Datastore
roles, treat pinned deploys as defense-in-depth and prioritize separate
projects for high-sensitivity data.

Example pattern (adjust roles to what your org supports):

```bash
# Prefer database-scoped bindings / conditions when available in your org.
# At minimum, avoid granting every runtime SA Editor / Owner.

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:fn-qual@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user"
# Then restrict via org policy, deny policies, or separate projects if
# project-level datastore.user still reaches all databases.
```

Also grant only the secrets, Storage buckets, and APIs that env needs.

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

## 5. Checklist

- [ ] One SA per environment that serves gated or production data
- [ ] Each Functions deploy sets `serviceAccount` + `APP_ENV` / `pinnedEnvironment`
- [ ] `createEnvRuntime({ pinned: true, ... })` on those deploys
- [ ] Hosting site for env N rewrites only to env N’s functions
- [ ] Default SA not used by those runtimes
- [ ] CI deployer ≠ runtime SA
