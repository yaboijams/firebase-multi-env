#!/usr/bin/env node
/**
 * firebase-multi-env CLI
 *
 *   npx firebase-multi-env grant-env qual you@example.com
 *   npx firebase-multi-env grant-env qual --revoke you@example.com
 *   npx firebase-multi-env init
 *   npx firebase-multi-env doctor
 *
 * grant-env requires Application Default Credentials:
 *   gcloud auth application-default login
 */

import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, '..');
const templatesDir = join(packageRoot, 'templates');

function printHelp() {
  console.log(`Usage:
  firebase-multi-env grant-env <env> [--revoke] [--claim allowedEnvs] [--project <id>] <email>
  firebase-multi-env init [--dir <path>]
  firebase-multi-env doctor [--dir <path>]

Examples:
  firebase-multi-env grant-env qual you@example.com
  firebase-multi-env grant-env cert --revoke you@example.com
  firebase-multi-env init
  firebase-multi-env doctor
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
    { file: 'MULTI_ENV_SETUP.md', to: join(targetRoot, 'MULTI_ENV_SETUP.md') },
    { file: 'ISOLATION.md', to: join(isolationDir, 'ISOLATION.md') },
    { file: 'iam-sa-per-env.md', to: join(isolationDir, 'iam-sa-per-env.md') },
    { file: 'functions.pinned.qual.example.ts', to: join(isolationDir, 'functions.pinned.qual.example.ts') },
    { file: 'firebase.codebases.example.json', to: join(isolationDir, 'firebase.codebases.example.json') },
  ];

  for (const { file, to } of files) {
    const from = join(templatesDir, file);
    if (!existsSync(from)) {
      throw new Error(`Missing template: ${from}`);
    }
    copyFileSync(from, to);
    console.log(`Wrote ${to}`);
  }

  console.log('\nDone. See MULTI_ENV_SETUP.md and multi-env/ISOLATION.md for next steps.');
  console.log('Run: npx firebase-multi-env doctor');
}

function walkFiles(root, acc = []) {
  if (!existsSync(root)) {
    return acc;
  }
  for (const name of readdirSync(root)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git' || name === 'coverage') {
      continue;
    }
    const full = join(root, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkFiles(full, acc);
    } else if (/\.(m?[jt]sx?|cjs|mjs)$/.test(name)) {
      acc.push(full);
    }
  }
  return acc;
}

function doctor(args) {
  const dirIdx = args.indexOf('--dir');
  const targetRoot = dirIdx >= 0 ? args[dirIdx + 1] : process.cwd();
  if (!targetRoot) {
    console.error('Missing path after --dir');
    process.exit(1);
  }

  const findings = [];
  const files = walkFiles(targetRoot);
  const contents = files.map((file) => {
    try {
      return { file, text: readFileSync(file, 'utf8') };
    } catch {
      return { file, text: '' };
    }
  });

  const hasCreateEnv = contents.some(({ text }) => text.includes('createEnvRuntime'));
  const hasPinned = contents.some(({ text }) =>
    /pinned\s*:\s*true/.test(text),
  );
  const hasLogicalExplicit = contents.some(({ text }) =>
    /pinned\s*:\s*false/.test(text),
  );
  const hasVerifyIdToken = contents.some(({ text }) =>
    /verifyIdToken\s*:\s*true/.test(text),
  );
  const hasHttpWrapper = contents.some(({ text }) =>
    text.includes('createWithAppEnvHttp'),
  );
  const hasServiceAccount = contents.some(({ text }) =>
    /serviceAccount\s*:/.test(text),
  );
  const mentionsAppEnv = contents.some(({ text }) =>
    text.includes('APP_ENV') || text.includes('pinnedEnvironment'),
  );
  const hasGetDb = contents.some(({ text }) => text.includes('createGetDb'));

  console.log(`firebase-multi-env doctor (${relative(process.cwd(), targetRoot) || '.'})\n`);

  if (!hasCreateEnv) {
    findings.push({
      level: 'warn',
      message: 'No createEnvRuntime() usage found. Run init and wire Functions first.',
    });
  } else {
    findings.push({
      level: 'ok',
      message: 'Found createEnvRuntime() usage.',
    });
  }

  if (hasPinned) {
    findings.push({
      level: 'ok',
      message: 'Pinned isolation mode detected (recommended for production deploys).',
    });
    if (!mentionsAppEnv) {
      findings.push({
        level: 'warn',
        message: 'Pinned mode should set pinnedEnvironment or APP_ENV per deploy.',
      });
    } else {
      findings.push({
        level: 'ok',
        message: 'Pinned env source (APP_ENV / pinnedEnvironment) referenced.',
      });
    }
    if (!hasServiceAccount) {
      findings.push({
        level: 'warn',
        message:
          'No serviceAccount config found in scanned sources. Attach a per-env SA so IAM matches pinned mode.',
      });
    } else {
      findings.push({
        level: 'ok',
        message: 'serviceAccount referenced in sources.',
      });
    }
  } else if (hasCreateEnv) {
    findings.push({
      level: 'info',
      message: hasLogicalExplicit
        ? 'Unpinned mode (pinned: false) — Origin selects DB across envs in one runtime.'
        : 'No pinned: true found — default is unpinned (shared runtime may open multiple DBs).',
    });
    findings.push({
      level: 'info',
      message:
        'For hard separation in one project, use pinned: true + per-env service accounts. See multi-env/ISOLATION.md.',
    });
  }

  if (hasHttpWrapper && !hasVerifyIdToken) {
    findings.push({
      level: 'warn',
      message:
        'createWithAppEnvHttp found without verifyIdToken: true. Raw onRequest does not populate req.auth by default.',
    });
  } else if (hasHttpWrapper) {
    findings.push({
      level: 'ok',
      message: 'HTTP wrapper verifies ID tokens.',
    });
  }

  if (hasGetDb) {
    findings.push({
      level: 'ok',
      message: 'createGetDb() found — call it only inside withAppEnv* wrappers.',
    });
  }

  if (!existsSync(join(targetRoot, 'MULTI_ENV_SETUP.md'))
    && !existsSync(join(targetRoot, 'multi-env', 'ISOLATION.md'))) {
    findings.push({
      level: 'info',
      message: 'Setup docs not found. Run: npx firebase-multi-env init',
    });
  }

  for (const finding of findings) {
    const tag = finding.level.toUpperCase().padEnd(4);
    console.log(`[${tag}] ${finding.message}`);
  }

  const warnings = findings.filter((f) => f.level === 'warn').length;
  console.log(
    warnings
      ? `\nDoctor finished with ${warnings} warning(s).`
      : '\nDoctor finished with no warnings.',
  );
  process.exit(warnings ? 1 : 0);
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
} else {
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}
