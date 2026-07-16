# Per-env secrets (Secret Manager)

Do **not** mount the same Stripe / SendGrid / partner secrets into every environment’s Functions.

## Pattern

| Env | Runtime SA | Secrets |
|---|---|---|
| production | `fn-prod@...` | `STRIPE_SECRET_PROD`, `SENDGRID_PROD`, … |
| qual | `fn-qual@...` | `STRIPE_SECRET_QUAL`, `SENDGRID_QUAL`, … |

Each secret’s IAM grants **accessor** only to that env’s SA.

## Create secrets

```bash
PROJECT_ID=your-project-id

# Production
printf '%s' "$STRIPE_LIVE" | gcloud secrets create STRIPE_SECRET_PROD \
  --project="$PROJECT_ID" --data-file=-

# Qual (test keys)
printf '%s' "$STRIPE_TEST" | gcloud secrets create STRIPE_SECRET_QUAL \
  --project="$PROJECT_ID" --data-file=-

gcloud secrets add-iam-policy-binding STRIPE_SECRET_PROD \
  --project="$PROJECT_ID" \
  --member="serviceAccount:fn-prod@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding STRIPE_SECRET_QUAL \
  --project="$PROJECT_ID" \
  --member="serviceAccount:fn-qual@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

Never grant `fn-qual` access to `*_PROD` secrets.

## Wire in Functions (v2)

```ts
import { defineSecret } from 'firebase-functions/params';
import { onCall } from 'firebase-functions/v2/https';

// Deploy-specific: qual codebase only references QUAL secrets
const stripeSecret = defineSecret('STRIPE_SECRET_QUAL');

export const checkout = onCall(
  {
    serviceAccount: `fn-qual@${process.env.GCLOUD_PROJECT}.iam.gserviceaccount.com`,
    secrets: [stripeSecret],
  },
  withAppEnv(async () => {
    const key = stripeSecret.value();
    // ...
  }),
);
```

Production codebase uses `STRIPE_SECRET_PROD` the same way.

## Checklist

- [ ] Secret names are env-suffixed (or entirely separate)
- [ ] IAM bindings are per SA — no project-wide secretAccessor for runtime SAs
- [ ] CI deployer can create/update secrets; runtime SAs only accessor
- [ ] Local `.env` files are never copied into the wrong codebase
