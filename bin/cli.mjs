#!/usr/bin/env node
/**
 * Grant or revoke environment access via Firebase Auth custom claim allowlist
 * (default claim key: allowedEnvs).
 *
 * Usage:
 *   npx firebase-multi-env grant-env qual you@example.com
 *   npx firebase-multi-env grant-env qual --revoke you@example.com
 *   npx firebase-multi-env grant-env cert --claim allowedEnvs --project my-project you@example.com
 *
 * Requires Application Default Credentials with permission to set Auth claims:
 *   gcloud auth application-default login
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

function printHelp() {
  console.log(`Usage:
  firebase-multi-env grant-env <env> [--revoke] [--claim allowedEnvs] [--project <id>] <email>

Examples:
  firebase-multi-env grant-env qual you@example.com
  firebase-multi-env grant-env cert --revoke you@example.com
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

async function grantEnv(args) {
  const revoke = args.includes('--revoke');
  const claimIdx = args.indexOf('--claim');
  const projectIdx = args.indexOf('--project');
  const claim = claimIdx >= 0 ? args[claimIdx + 1] : 'allowedEnvs';
  const projectId =
    (projectIdx >= 0 ? args[projectIdx + 1] : null)
    || process.env.GCLOUD_PROJECT
    || process.env.GCP_PROJECT
    || process.env.GOOGLE_CLOUD_PROJECT;

  const positionals = args.filter((arg, i) => {
    if (arg.startsWith('--')) return false;
    if (claimIdx >= 0 && i === claimIdx + 1) return false;
    if (projectIdx >= 0 && i === projectIdx + 1) return false;
    return true;
  });

  const [envName, email] = positionals;

  if (!envName || !email) {
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
  const current = Array.isArray(existing[claim])
    ? existing[claim].filter((item) => typeof item === 'string')
    : [];

  let next;
  if (revoke) {
    next = current.filter((item) => item !== envName);
  } else if (current.includes(envName)) {
    next = current;
  } else {
    next = [...current, envName];
  }

  if (next.length === 0) {
    delete existing[claim];
  } else {
    existing[claim] = next;
  }

  await auth.setCustomUserClaims(user.uid, existing);

  if (revoke) {
    console.log(
      `Revoked "${envName}" from ${claim} for ${email} (${user.uid}). Current: [${next.join(', ')}]. Sign out/in to refresh the token.`,
    );
  } else {
    console.log(
      `Granted "${envName}" on ${claim} for ${email} (${user.uid}). Current: [${next.join(', ')}]. Sign out/in to refresh the token.`,
    );
  }
}

const [command, ...rest] = process.argv.slice(2);

if (!command || command === '--help' || command === '-h') {
  printHelp();
  process.exit(command ? 0 : 1);
}

if (command === 'grant-env') {
  try {
    await grantEnv(rest);
  } catch (error) {
    console.error('Failed to update environment access claim.', error);
    console.error('Tip: gcloud auth application-default login');
    process.exit(1);
  }
} else {
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}
