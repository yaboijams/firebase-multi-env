#!/usr/bin/env node
/**
 * firebase-multi-env CLI
 *
 *   npx firebase-multi-env grant-env qual you@example.com
 *   npx firebase-multi-env grant-env qual --revoke you@example.com
 *   npx firebase-multi-env init
 *   npx firebase-multi-env doctor
 *   npx firebase-multi-env doctor --strict
 *   npx firebase-multi-env provision --project my-app --envs production,qual
 *
 * grant-env requires Application Default Credentials:
 *   gcloud auth application-default login
 */

import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { printDoctorResult, runDoctor } from './lib/doctor.mjs';
import { buildProvisionFiles, parseProvisionArgs } from './lib/provision.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, '..');
const templatesDir = join(packageRoot, 'templates');

function printHelp() {
  console.log(`Usage:
  firebase-multi-env grant-env <env> [--revoke] [--claim allowedEnvs] [--project <id>] <email>
  firebase-multi-env init [--dir <path>]
  firebase-multi-env doctor [--dir <path>] [--strict]
  firebase-multi-env provision --project <id> --envs <list> [options]

Examples:
  firebase-multi-env grant-env qual you@example.com
  firebase-multi-env grant-env cert --revoke you@example.com
  firebase-multi-env init
  firebase-multi-env doctor
  firebase-multi-env doctor --strict
  firebase-multi-env provision --project my-app --envs production,qual
  firebase-multi-env provision --project my-app --envs production:(default),qual:qual-env --secrets STRIPE_SECRET,SENDGRID --print

Provision options:
  --project <id>       GCP / Firebase project (or GCLOUD_PROJECT)
  --envs <list>        Comma-separated envs; optional db id via name:db-id
  --secrets <list>     Secret base names (default: STRIPE_SECRET) → BASE_<ENV>
  --location <region>  Default us-central1 (buckets / Firestore create hints)
  --dir <path>         Output directory (default: multi-env/provision)
  --print              Print scripts to stdout; do not write files
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
  const isolationDir = join(targetRoot, 'multi-env');
  mkdirSync(snippetsDir, { recursive: true });
  mkdirSync(isolationDir, { recursive: true });

  const files = [
    { file: 'firestore.gated.rules.snippet', to: join(snippetsDir, 'firestore.gated.rules.snippet') },
    { file: 'firestore.public.rules.snippet', to: join(snippetsDir, 'firestore.public.rules.snippet') },
    { file: 'storage.gated.rules.snippet', to: join(snippetsDir, 'storage.gated.rules.snippet') },
    { file: 'storage.public.rules.snippet', to: join(snippetsDir, 'storage.public.rules.snippet') },
    { file: 'MULTI_ENV_SETUP.md', to: join(targetRoot, 'MULTI_ENV_SETUP.md') },
    { file: 'ISOLATION.md', to: join(isolationDir, 'ISOLATION.md') },
    { file: 'THREAT_MODEL.md', to: join(isolationDir, 'THREAT_MODEL.md') },
    { file: 'PROJECT_PARITY.md', to: join(isolationDir, 'PROJECT_PARITY.md') },
    { file: 'iam-sa-per-env.md', to: join(isolationDir, 'iam-sa-per-env.md') },
    { file: 'secrets-per-env.md', to: join(isolationDir, 'secrets-per-env.md') },
    { file: 'deploy-isolation.md', to: join(isolationDir, 'deploy-isolation.md') },
    { file: 'PROVISION.md', to: join(isolationDir, 'PROVISION.md') },
    { file: 'functions.pinned.qual.example.ts', to: join(isolationDir, 'functions.pinned.qual.example.ts') },
    { file: 'firebase.codebases.example.json', to: join(isolationDir, 'firebase.codebases.example.json') },
    { file: 'github-actions.deploy.example.yml', to: join(isolationDir, 'github-actions.deploy.example.yml') },
    { file: 'storage.gated.rules.snippet', to: join(isolationDir, 'storage.gated.rules.snippet') },
    { file: 'storage.public.rules.snippet', to: join(isolationDir, 'storage.public.rules.snippet') },
  ];

  for (const { file, to } of files) {
    const from = join(templatesDir, file);
    if (!existsSync(from)) {
      throw new Error(`Missing template: ${from}`);
    }
    copyFileSync(from, to);
    console.log(`Wrote ${to}`);
  }

  console.log('\nDone. Production path is pinned + per-env SA + secrets.');
  console.log('See MULTI_ENV_SETUP.md and multi-env/PROJECT_PARITY.md.');
  console.log('Generate IAM scripts: npx firebase-multi-env provision --project <id> --envs production,qual');
  console.log('Run: npx firebase-multi-env doctor --strict');
}

function provision(args) {
  const opts = parseProvisionArgs(args);
  const result = buildProvisionFiles(opts);

  if (opts.printOnly) {
    for (const file of result.files) {
      console.log(`\n===== ${file.path} =====\n`);
      console.log(file.content);
    }
    return;
  }

  for (const file of result.files) {
    console.log(`Wrote ${file.path}`);
  }

  console.log(`\nGenerated provision scripts for ${result.envs.map((e) => e.name).join(', ')}.`);
  console.log('Review, then run e.g.:');
  console.log(`  bash ${join(result.outDir, 'provision.all.sh')}`);
  console.log('Auth stays shared — gate with: npx firebase-multi-env grant-env <env> --project ... you@email.com');
  console.log('See multi-env/PROVISION.md');
}

function doctor(args) {
  const dirIdx = args.indexOf('--dir');
  const targetRoot = dirIdx >= 0 ? args[dirIdx + 1] : process.cwd();
  if (!targetRoot) {
    console.error('Missing path after --dir');
    process.exit(1);
  }

  const strict = args.includes('--strict');
  const result = runDoctor({ targetRoot, strict, cwd: process.cwd() });
  printDoctorResult(result);
  process.exit(result.exitCode);
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
} else if (command === 'doctor') {
  try {
    doctor(rest);
  } catch (error) {
    console.error('Doctor failed.', error);
    process.exit(1);
  }
} else if (command === 'provision') {
  try {
    provision(rest);
  } catch (error) {
    console.error('Provision failed.', error instanceof Error ? error.message : error);
    process.exit(1);
  }
} else {
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}
