#!/usr/bin/env node
/**
 * firebase-multi-env CLI
 *
 *   npx firebase-multi-env grant-env qual you@example.com
 *   npx firebase-multi-env grant-env qual --revoke you@example.com
 *   npx firebase-multi-env init
 *
 * grant-env requires Application Default Credentials:
 *   gcloud auth application-default login
 */

import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, '..');
const templatesDir = join(packageRoot, 'templates');

function printHelp() {
  console.log(`Usage:
  firebase-multi-env grant-env <env> [--revoke] [--claim allowedEnvs] [--project <id>] <email>
  firebase-multi-env init [--dir <path>]

Examples:
  firebase-multi-env grant-env qual you@example.com
  firebase-multi-env grant-env cert --revoke you@example.com
  firebase-multi-env init
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

function initProject(args) {
  const dirIdx = args.indexOf('--dir');
  const targetRoot = dirIdx >= 0 ? args[dirIdx + 1] : process.cwd();
  if (!targetRoot) {
    console.error('Missing path after --dir');
    process.exit(1);
  }

  const snippetsDir = join(targetRoot, 'firestore.rules.snippets');
  mkdirSync(snippetsDir, { recursive: true });

  const files = [
    'firestore.gated.rules.snippet',
    'firestore.public.rules.snippet',
    'MULTI_ENV_SETUP.md',
  ];

  for (const file of files) {
    const from = join(templatesDir, file);
    const to = file === 'MULTI_ENV_SETUP.md'
      ? join(targetRoot, 'MULTI_ENV_SETUP.md')
      : join(snippetsDir, file);

    if (!existsSync(from)) {
      throw new Error(`Missing template: ${from}`);
    }
    copyFileSync(from, to);
    console.log(`Wrote ${to}`);
  }

  console.log('\nDone. See MULTI_ENV_SETUP.md for next steps.');
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
} else if (command === 'init') {
  try {
    initProject(rest);
  } catch (error) {
    console.error('Failed to initialize multi-env files.', error);
    process.exit(1);
  }
} else {
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}
