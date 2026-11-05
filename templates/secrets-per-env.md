# Per-env secrets (Secret Manager)

Do **not** mount the same Stripe / SendGrid / partner secrets into every environment’s Functions.

## Pattern

Logical name in code: `STRIPE_SECRET` via `defineSecret` / `createSecrets`.

Secret Manager **resource** id (Firebase CLI prefixes with the codebase `prefix`):

| Env | firebase.json `prefix` | Runtime SA | Secret Manager id |
|---|---|---|---|
| production | `prod` | `fn-prod@...` | `prod-STRIPE_SECRET` |
| qual | `qual` | `fn-qual@...` | `qual-STRIPE_SECRET` |
| cert | `cert` | `fn-cert@...` | `cert-STRIPE_SECRET` |

Each secret’s IAM grants **accessor** only to that env’s SA.

`npx firebase-multi-env provision` creates these resource ids. Helper:
`secretResourceId('qual', 'STRIPE_SECRET')` → `qual-STRIPE_SECRET`.

## Create / rotate a value

```bash
PROJECT_ID=your-project-id
SECRET_ID=qual-STRIPE_SECRET

printf '%s' "$STRIPE_TEST" | gcloud secrets versions add "$SECRET_ID" \
  --project="$PROJECT_ID" --data-file=-
# (create first with provision scripts if the secret does not exist yet)
```

Never grant `fn-qual` access to `prod-*` secrets (databases mode).

## Wire in Functions (v2) — recommended

```ts
import { onRequest } from 'firebase-functions/v2/https';
import { createSecrets } from 'firebase-multi-env/server';

const secrets = createSecrets([
  // Local .env may use STRIPE_SECRET_KEY; cloud uses STRIPE_SECRET.
  { name: 'STRIPE_SECRET', envKeys: ['STRIPE_SECRET_KEY'] },
]);

export const api = onRequest(
  {
    serviceAccount: `fn-qual@${process.env.GCLOUD_PROJECT}.iam.gserviceaccount.com`,
    secrets: secrets.params,
  },
  async (req, res) => {
    const key = secrets.require('STRIPE_SECRET');
    res.json({ configured: Boolean(key) });
  },
);
```

Locally, set `STRIPE_SECRET` (or an `envKeys` alias) in `functions/config/<env>/.env`.
On Cloud, mount `secrets.params` so Firebase injects Secret Manager values.

## Checklist

- [ ] Secret Manager ids match `${prefix}-${LOGICAL}` (not legacy `LOGICAL_QUAL`)
- [ ] IAM bindings are per SA — no project-wide secretAccessor for runtime SAs
- [ ] Functions pass `secrets: secrets.params` (or equivalent `defineSecret` list)
- [ ] CI deployer can create/update secrets; runtime SAs only accessor
- [ ] Per-env `configDir` / `.env` files are never copied into the wrong deploy
- [ ] Client `prefixes` match firebase.json `prefix` values
