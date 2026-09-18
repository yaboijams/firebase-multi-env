#!/usr/bin/env node
/**
 * firebase-multi-env CLI
 *
 *   npx firebase-multi-env grant-env qual you@example.com
 *   npx firebase-multi-env init [--mode databases|projects]
 *   npx firebase-multi-env doctor [--strict]
 *   npx firebase-multi-env provision --project my-app --envs production,qual
 *   npx firebase-multi-env provision --mode projects --envs production:proj-p,qual:proj-q
 *   npx firebase-multi-env parity iam --envs production:proj-p,qual:proj-q
 *   npx firebase-multi-env sync-users --emails you@email.com --envs qual:proj-q
 */

import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { printDoctorResult, runDoctor } from './lib/doctor.mjs';
import {
  buildProvisionFiles,
  buildProjectProvisionFiles,
  parseProvisionArgs,
} from './lib/provision.mjs';
import {
  buildParityFiles,
  parseParityArgs,
  parseSyncUsersArgs,
  syncUsersAcrossProjects,
} from './lib/parity.mjs';
import { defaultProjectSkeleton } from './lib/skeleton.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, '..');
const templatesDir = join(packageRoot, 'templates');

function printHelp() {
  console.log(`Usage:
  firebase-multi-env grant-env <env> [--revoke] [--claim allowedEnvs] [--project <id>] <email>
  firebase-multi-env init [--dir <path>] [--mode databases|projects] [--force]
  firebase-multi-env doctor [--dir <path>] [--strict]
  firebase-multi-env provision --project <id> --envs <list> [options]
  firebase-multi-env provision --mode projects --envs name:projectId,... [--billing-account <id>]
  firebase-multi-env parity [iam|auth-config|all] --envs name:projectId,... [options]
  firebase-multi-env sync-users --emails a@x,b@y --envs name:projectId,... [--no-create]

Examples:
  firebase-multi-env grant-env qual you@example.com
  firebase-multi-env init
  firebase-multi-env init --mode projects
  firebase-multi-env doctor --strict
  firebase-multi-env provision --project my-app --envs production,qual
  firebase-multi-env provision --mode projects --envs production:my-app-prod,qual:my-app-qual \\
    --billing-account 01ABCD-EFGH12-IJKL34
  firebase-multi-env parity all --envs production:my-app-prod,qual:my-app-qual
  firebase-multi-env sync-users --emails you@email.com --envs qual:my-app-qual

Provision options:
  --mode databases|projects   Default databases (single project)
  --project <id>              Required for databases mode
  --envs <list>               databases: name or name:db-id; projects: name:projectId
  --billing-account <id>      projects mode: link this billing account after create
  --skip-create-project       projects mode: do not create projects (must already exist)
  --secrets <list>            databases mode secret bases (projects: from skeleton)
  --skeleton <path>           projects mode skeleton (default multi-env/skeleton.json)
  --location <region>         Default us-central1
  --dir <path>                Output directory
  --print                     Print scripts to stdout; do not write files
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

function copyTemplate(file, to, { force = false } = {}) {
  const from = join(templatesDir, file);
  if (!existsSync(from)) {
    throw new Error(`Missing template: ${from}`);
  }
  if (existsSync(to) && !force) {
    console.log(`Skip existing ${to} (use --force to overwrite)`);
    return false;
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`Wrote ${to}`);
  return true;
}

function initProject(args) {
  const dirIdx = args.indexOf('--dir');
  const modeIdx = args.indexOf('--mode');
  const force = args.includes('--force');
  const targetRoot = dirIdx >= 0 ? args[dirIdx + 1] : process.cwd();
  const mode = modeIdx >= 0 && args[modeIdx + 1] === 'projects' ? 'projects' : 'databases';
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

  if (mode === 'projects') {
    files.push(
      { file: 'PROJECTS_ISOLATION.md', to: join(isolationDir, 'PROJECTS_ISOLATION.md') },
      { file: 'github-actions.deploy.projects.example.yml', to: join(isolationDir, 'github-actions.deploy.projects.example.yml') },
      { file: 'skeleton.projects.example.json', to: join(isolationDir, 'skeleton.projects.example.json') },
    );
  }

  for (const { file, to } of files) {
    copyTemplate(file, to, { force });
  }

  if (mode === 'projects') {
    const skeletonTo = join(isolationDir, 'skeleton.json');
    if (existsSync(skeletonTo) && !force) {
      console.log(`Skip existing ${skeletonTo} (use --force to overwrite)`);
    } else {
      writeFileSync(skeletonTo, `${JSON.stringify(defaultProjectSkeleton(), null, 2)}\n`);
      console.log(`Wrote ${skeletonTo}`);
    }
  }

  console.log(`\nDone (mode: ${mode}).`);
  if (mode === 'projects') {
    console.log('Edit multi-env/skeleton.json, then:');
    console.log('  npx firebase-multi-env provision --mode projects --envs production:PROJ_PROD,qual:PROJ_QUAL');
    console.log('Bootstrap users: npx firebase-multi-env sync-users --emails you@email.com --envs qual:PROJ_QUAL');
    console.log('See multi-env/PROJECTS_ISOLATION.md');
  } else {
    console.log('See MULTI_ENV_SETUP.md and multi-env/PROJECT_PARITY.md.');
    console.log('Generate IAM scripts: npx firebase-multi-env provision --project <id> --envs production,qual');
  }
  console.log('Run: npx firebase-multi-env doctor --strict');
}

function provision(args) {
  const opts = parseProvisionArgs(args);

  if (opts.mode === 'projects') {
    const result = buildProjectProvisionFiles({
      envsRaw: opts.envsRaw,
      location: opts.location,
      outDir: opts.outDir,
      printOnly: opts.printOnly,
      targetRoot: process.cwd(),
      skeletonPath: opts.skeletonPath,
      billingAccount: opts.billingAccount,
      createProject: opts.createProject,
    });

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
    console.log(`\nGenerated multi-project scripts for ${result.envs.map((e) => e.name).join(', ')}.`);
    console.log(`  bash ${join(result.outDir, 'provision.all.sh')}`);
    console.log('Auth is per-project — use sync-users, not grant-env.');
    return;
  }

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

function parity(args) {
  const opts = parseParityArgs(args);
  const result = buildParityFiles(opts);

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
  console.log(`\nParity (${result.target}) refreshed from skeleton for ${result.envs.map((e) => e.name).join(', ')}.`);
}

async function syncUsers(args) {
  const opts = parseSyncUsersArgs(args);
  const admin = loadFirebaseAdmin();
  const results = await syncUsersAcrossProjects({
    admin,
    emails: opts.emails,
    targets: opts.targets,
    create: opts.create,
  });

  for (const row of results) {
    console.log(
      `${row.created ? 'Created' : 'Found'} ${row.email} in ${row.env} (${row.projectId}) uid=${row.uid}`,
    );
  }
  console.log('\nNote: same email ⇒ different UIDs per project. Sign in separately per env Hosting site.');
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
} else if (command === 'parity') {
  try {
    parity(rest);
  } catch (error) {
    console.error('Parity failed.', error instanceof Error ? error.message : error);
    process.exit(1);
  }
} else if (command === 'sync-users') {
  try {
    await syncUsers(rest);
  } catch (error) {
    console.error('sync-users failed.', error);
    console.error('Tip: gcloud auth application-default login');
    process.exit(1);
  }
} else {
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}
