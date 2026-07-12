# firebase-app-env

Secure **QA vs production** multi-environment support for Firebase apps.

One Firebase project, two Firestore databases, two Hosting sites — with Origin binding and a QA-only Auth claim so **production users never need special rights**.

## Install

```bash
npm install firebase-app-env
```

Peer dependencies (install what you use):

```bash
npm install firebase firebase-admin firebase-functions
```

## Security model

| Request from | Database | Needs `qaAccess`? |
|---|---|---|
| Prod Hosting origin | `(default)` (configurable) | **No** |
| QA Hosting origin | `qa-env` (configurable) | **Yes** |
| Localhost → cloud QA | QA DB | **Yes** |
| Full local emulators | emulator default DB | **No** (optional) |

Client `appEnv` is only a **hint** on localhost. Hosted Origin always wins (QA cannot spoof production).

## One-time Firebase setup

```bash
# Second Firestore database
firebase firestore:databases:create qa-env --location nam5

# Second Hosting site
firebase hosting:sites:create myapp-qa
firebase target:apply hosting qa myapp-qa
firebase target:apply hosting prod myapp
```

Example `firebase.json` hosting + firestore entries:

```json
{
  "firestore": [
    { "database": "(default)", "rules": "firestore.prod.rules", "indexes": "firestore.indexes.json" },
    { "database": "qa-env", "rules": "firestore.qa.rules", "indexes": "firestore.indexes.json" }
  ],
  "hosting": [
    { "target": "qa", "public": "dist" },
    { "target": "prod", "public": "dist" }
  ]
}
```

### QA rules snippet

Require the claim on the QA database only (prod rules stay owner-only):

```
function hasQaAccess() {
  return request.auth != null && request.auth.token.qaAccess == true;
}
function isOwner(userId) {
  return hasQaAccess() && request.auth.uid == userId;
}
```

## Cloud Functions

```ts
import { createEnvRuntime, createGetDb } from 'firebase-app-env/server';
import { createWithAppEnvV1 } from 'firebase-app-env/functions-v1';
// or: import { createWithAppEnvV2 } from 'firebase-app-env/functions-v2';

export const appEnvRuntime = createEnvRuntime({
  databases: { qa: 'qa-env', production: '(default)' },
  qaOrigins: [
    'https://myapp-qa.web.app',
    'https://myapp-qa.firebaseapp.com',
  ],
  prodOrigins: [
    'https://myapp.web.app',
    'https://myapp.firebaseapp.com',
  ],
});

export const getDb = createGetDb(appEnvRuntime);
export const withAppEnv = createWithAppEnvV1(appEnvRuntime);

// v1
export const syncData = functions.https.onCall(withAppEnv(async (data, context) => {
  const db = getDb();
  // ...
}));

// v2
// import { onCall } from 'firebase-functions/v2/https';
// const withAppEnvV2 = createWithAppEnvV2(appEnvRuntime);
// export const syncData = onCall(withAppEnvV2(async (request) => { ... }));
```

Optional process env overrides: `QA_HOST_ORIGINS`, `PROD_HOST_ORIGINS` (comma-separated).

## Web client

Vite modes:

- `.env.development` → local / emulators (`VITE_APP_ENV=qa`)
- `.env.qa` → QA Hosting build
- `.env.production` → prod build

```ts
import { createCallable } from 'firebase-app-env/client';
import { getFunctions } from 'firebase/functions';

const appEnv = import.meta.env.VITE_APP_ENV as 'qa' | 'production';
const callable = createCallable(getFunctions(app), { appEnv });

await callable('syncData')({ /* payload */ });
```

Use `getFirestore(app)` for `(default)` and `getFirestore(app, 'qa-env')` for QA. With emulators, keep the default DB.

## Grant QA access

```bash
gcloud auth application-default login
npx firebase-app-env grant-qa --project my-project you@email.com
# sign out and sign in again

npx firebase-app-env grant-qa --revoke --project my-project you@email.com
```

## License

MIT
