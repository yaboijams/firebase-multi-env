# firebase-multi-env

Secure **multi-environment** support for Firebase apps.

One Firebase project, multiple Firestore databases, multiple Hosting sites — with Origin binding and an Auth allowlist claim so **production users never need special rights**.

## Local development (npm link)

```bash
cd /path/to/firebase-multi-env
npm run build
npm link

cd /path/to/your-app
npm link firebase-multi-env
```

Rebuild this package after source changes; consumers pick up `dist/` via the link.

Peer dependencies (install what you use):

```bash
npm install firebase firebase-admin firebase-functions
```

## Security model

| Request from | Database | Needs `allowedEnvs`? |
|---|---|---|
| Public env Hosting origin (e.g. prod) | that env's DB | **No** |
| Gated env Hosting origin (e.g. qual/cert) | that env's DB | **Yes** (claim must include the env name) |
| Localhost → cloud gated env | gated DB | **Yes** |
| Full local emulators | emulator default DB | **No** (optional) |

Client `appEnv` is only a **hint** on localhost. Hosted Origin always wins (gated origins cannot spoof production).

## One-time Firebase setup

```bash
# Extra Firestore databases
firebase firestore:databases:create qual-env --location nam5
firebase firestore:databases:create cert-env --location nam5

# Extra Hosting sites
firebase hosting:sites:create myapp-qual
firebase hosting:sites:create myapp-cert
firebase target:apply hosting qual myapp-qual
firebase target:apply hosting cert myapp-cert
firebase target:apply hosting prod myapp
```

Example `firebase.json` hosting + firestore entries:

```json
{
  "firestore": [
    { "database": "(default)", "rules": "firestore.prod.rules", "indexes": "firestore.indexes.json" },
    { "database": "qual-env", "rules": "firestore.qual.rules", "indexes": "firestore.indexes.json" },
    { "database": "cert-env", "rules": "firestore.cert.rules", "indexes": "firestore.indexes.json" }
  ],
  "hosting": [
    { "target": "qual", "public": "dist" },
    { "target": "cert", "public": "dist" },
    { "target": "prod", "public": "dist" }
  ]
}
```

### Gated-env rules snippet

Require the allowlist claim on gated databases only (prod rules stay owner-only):

```
function hasEnvAccess(env) {
  return request.auth != null
    && request.auth.token.allowedEnvs is list
    && env in request.auth.token.allowedEnvs;
}
function isOwner(userId) {
  return hasEnvAccess('qual') && request.auth.uid == userId;
}
```

## Cloud Functions

```ts
import { createEnvRuntime, createGetDb } from 'firebase-multi-env/server';
import { createWithAppEnvV1 } from 'firebase-multi-env/functions-v1';
// or: import { createWithAppEnvV2 } from 'firebase-multi-env/functions-v2';

export const appEnvRuntime = createEnvRuntime({
  environments: {
    production: {
      database: '(default)',
      origins: [
        'https://myapp.web.app',
        'https://myapp.firebaseapp.com',
      ],
    },
    qual: {
      database: 'qual-env',
      origins: [
        'https://myapp-qual.web.app',
        'https://myapp-qual.firebaseapp.com',
      ],
      requireClaim: true,
    },
    cert: {
      database: 'cert-env',
      origins: [
        'https://myapp-cert.web.app',
        'https://myapp-cert.firebaseapp.com',
      ],
      requireClaim: true,
    },
  },
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

Add or change domains anytime by updating an environment's `origins` list. Optional process env overrides: `HOST_ORIGINS_<ENV>` (comma-separated), e.g. `HOST_ORIGINS_QUAL`.

## Web client

Pass any configured env name into `createCallable`. How you load it is up to you (Vite, Next, hardcode, etc.):

```ts
import { createCallable } from 'firebase-multi-env/client';
import { getFunctions } from 'firebase/functions';

const appEnv = import.meta.env.VITE_APP_ENV; // e.g. 'production' | 'qual' | 'cert'
const callable = createCallable(getFunctions(app), { appEnv });

await callable('syncData')({ /* payload */ });
```

Use `getFirestore(app)` for `(default)` and `getFirestore(app, 'qual-env')` / `getFirestore(app, 'cert-env')` for gated DBs. With emulators, keep the default DB.

## Grant environment access

```bash
gcloud auth application-default login
npx firebase-multi-env grant-env qual --project my-project you@email.com
npx firebase-multi-env grant-env cert --project my-project you@email.com
# → { allowedEnvs: ['qual', 'cert'] }
# sign out and sign in again

npx firebase-multi-env grant-env qual --revoke --project my-project you@email.com
```

## Releasing

Releases are automated with [semantic-release](https://semantic-release.org/) on every push to `main` (and via **Actions → Release → Run workflow**).

### One-time GitHub setup

1. Create an npm **granular access token** with **Read and write** + **Bypass 2FA**.
2. In the GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `NPM_SECRET`
   - Value: the npm token
3. Push this workflow to `main`.

`GITHUB_TOKEN` is provided automatically by Actions. The workflow maps `NPM_SECRET` → `NPM_TOKEN` for semantic-release.

### Commit messages (required for version bumps)

Use [Conventional Commits](https://www.conventionalcommits.org/):

| Commit | Release |
|---|---|
| `fix: ...` | patch (`0.0.x`) |
| `feat: ...` | minor (`0.x.0`) |
| `feat!: ...` or `BREAKING CHANGE:` | major (`x.0.0`) |
| `docs:`, `chore:`, `refactor:` (no `!`) | no release |

Examples:

```bash
git commit -m "feat: support custom claim key"
git commit -m "fix: reject duplicate origin mappings"
git commit -m "feat!: rename grant-env CLI flags"
```

### If you already published 0.1.0 manually

Tag that release so the next bump starts from there:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Otherwise the first conventional `feat:` on `main` will publish `1.0.0`.

## License

MIT
