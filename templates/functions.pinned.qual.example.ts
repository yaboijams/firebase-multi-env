/**
 * Example: pinned qual Functions deploy.
 *
 * Same source is deployed under firebase.json codebase `qual` with `"prefix": "qual"`.
 * Export names stay unprefixed in code (`syncData`, `api`); the CLI deploys
 * `qual-syncData` / `qual-api`. Production uses codebase `prod` + `"prefix": "prod"`.
 *
 * Deploy with:
 *   APP_ENV=qual
 *   firebase deploy --only functions:qual
 *   serviceAccount: fn-qual@PROJECT_ID.iam.gserviceaccount.com
 */

import { onCall } from 'firebase-functions/v2/https';
import { onRequest } from 'firebase-functions/v2/https';
import {
  createEnvRuntime,
  createGetDb,
  requireAuth,
} from 'firebase-multi-env/server';
import { createWithAppEnvV2 } from 'firebase-multi-env/functions-v2';
import { createWithAppEnvHttp } from 'firebase-multi-env/http';

const projectId = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT;

export const appEnvRuntime = createEnvRuntime({
  pinned: true,
  pinnedEnvironment: process.env.APP_ENV, // must be "qual" for this deploy
  environments: {
    production: {
      database: '(default)',
      origins: ['https://myapp.web.app', 'https://myapp.firebaseapp.com'],
    },
    qual: {
      database: 'qual-env',
      origins: ['https://myapp-qual.web.app'],
      requireClaim: true,
    },
  },
});

export const getDb = createGetDb(appEnvRuntime);
export const withAppEnv = createWithAppEnvV2(appEnvRuntime);
export const withHttp = createWithAppEnvHttp(appEnvRuntime, {
  verifyIdToken: true,
});

const qualSa = projectId
  ? `fn-qual@${projectId}.iam.gserviceaccount.com`
  : undefined;

export const syncData = onCall(
  {
    ...(qualSa ? { serviceAccount: qualSa } : {}),
  },
  withAppEnv(async (request) => {
    const auth = requireAuth(request.auth);
    const db = getDb();
    return {
      uid: auth.uid,
      env: appEnvRuntime.getEnvTag(),
      // db.collection('...')
    };
  }),
);

export const api = onRequest(
  {
    ...(qualSa ? { serviceAccount: qualSa } : {}),
  },
  withHttp(async (req, res) => {
    const db = getDb();
    res.json({
      env: appEnvRuntime.getEnvTag(),
      // use db as needed
    });
  }),
);
