#!/usr/bin/env node
/**
 * Grant or revoke QA access via Firebase Auth custom claim (default: qaAccess).
 * Production app users do NOT need this claim.
 *
 * Usage:
 *   npx firebase-app-env grant-qa you@example.com
 *   npx firebase-app-env grant-qa --revoke you@example.com
 *   npx firebase-app-env grant-qa --claim qaAccess --project my-project you@example.com
 *
 * Requires Application Default Credentials with permission to set Auth claims:
 *   gcloud auth application-default login
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function printHelp() {
  console.log(`Usage:
  firebase-app-env grant-qa [--revoke] [--claim qaAccess] [--project <id>] <email>

Examples:
  firebase-app-env grant-qa you@example.com
  firebase-app-env grant-qa --revoke you@example.com
`);
}

function loadFirebaseAdmin() {
  const attempts = [
    () => createRequire(pathToFileURL(join(process.cwd(), 'package.json')).href)('firebase-admin'),
    () => createRequire(pathToFileURL(join(process.cwd(), 'apps/functions/package.json')).href)('firebase-admin'),
    () => createRequire(import.meta.url)('firebase-admin'),
  ];

  for (const attempt of attempts) {
    try {
      return attempt();
    } catch {
      // try next
    }
  }

  throw new Error(
    'firebase-admin not found. Install it in your app (npm install firebase-admin) and run from the project root.',
  );
}

async function grantQa(args) {
  const revoke = args.includes('--revoke');
  const claimIdx = args.indexOf('--claim');
  const projectIdx = args.indexOf('--project');
  const claim = claimIdx >= 0 ? args[claimIdx + 1] : 'qaAccess';
  const projectId =
    (projectIdx >= 0 ? args[projectIdx + 1] : null)
    || process.env.GCLOUD_PROJECT
    || process.env.GCP_PROJECT
    || process.env.GOOGLE_CLOUD_PROJECT;

  const email = args.find((arg, i) => {
    if (arg.startsWith('--')) return false;
    if (claimIdx >= 0 && i === claimIdx + 1) return false;
    if (projectIdx >= 0 && i === projectIdx + 1) return false;
    return true;
  });

  if (!email) {
    printHelp();
    process.exit(1);
  }

  if (!projectId) {
    console.error('Missing project id. Pass --project <id> or set GCLOUD_PROJECT.');
    process.exit(1);
  }

  const admin = loadFirebaseAdmin();

  if (!admin.apps.length) {
    admin.initializeApp({ projectId });
  }

  const auth = admin.auth();
  const user = await auth.getUserByEmail(email);
  const existing = { ...(user.customClaims || {}) };

  if (revoke) {
    delete existing[claim];
    await auth.setCustomUserClaims(user.uid, existing);
    console.log(`Revoked ${claim} for ${email} (${user.uid}). Sign out/in to refresh the token.`);
  } else {
    await auth.setCustomUserClaims(user.uid, { ...existing, [claim]: true });
    console.log(`Granted ${claim} for ${email} (${user.uid}). Sign out/in to refresh the token.`);
  }
}

const [command, ...rest] = process.argv.slice(2);

if (!command || command === '--help' || command === '-h') {
  printHelp();
  process.exit(command ? 0 : 1);
}

if (command === 'grant-qa') {
  try {
    await grantQa(rest);
  } catch (error) {
    console.error('Failed to update QA access claim.', error);
    console.error('Tip: gcloud auth application-default login');
    process.exit(1);
  }
} else {
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}
