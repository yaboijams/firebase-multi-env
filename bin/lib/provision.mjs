/**
 * Provision script generator for firebase-multi-env.
 *
 * Emits gcloud / firebase CLI scripts for per-env service accounts,
 * Storage buckets, IAM bindings, and Secret Manager placeholders.
 * Does not call GCP — review and run the scripts yourself.
 */

import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { loadProjectSkeleton, resolveSaId } from './skeleton.mjs';

/** @typedef {{
 *   name: string,
 *   saId: string,
 *   database: string,
 *   bucket: string,
 *   secretSuffix: string,
 * }} EnvSpec */

/**
 * @param {string} envName
 * @returns {string}
 */
export function saIdForEnv(envName) {
  const lower = envName.trim().toLowerCase();
  if (lower === 'production' || lower === 'prod') {
    return 'fn-prod';
  }
  const slug = lower.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  return `fn-${slug}`;
}

/**
 * @param {string} envName
 * @returns {string}
 */
export function secretSuffixForEnv(envName) {
  const lower = envName.trim().toLowerCase();
  if (lower === 'production' || lower === 'prod') {
    return 'PROD';
  }
  return lower.replace(/[^a-z0-9]+/gi, '_').toUpperCase();
}

/**
 * @param {string} envName
 * @param {string} projectId
 * @param {string} [explicitDatabase]
 * @returns {string}
 */
export function databaseForEnv(envName, projectId, explicitDatabase) {
  if (explicitDatabase) {
    return explicitDatabase;
  }
  const lower = envName.trim().toLowerCase();
  if (lower === 'production' || lower === 'prod') {
    return '(default)';
  }
  return `${lower.replace(/[^a-z0-9-]/g, '-')}-env`;
}

/**
 * @param {string} envName
 * @param {string} projectId
 * @param {string} [explicitBucket]
 * @returns {string}
 */
export function bucketForEnv(envName, projectId, explicitBucket) {
  if (explicitBucket) {
    return explicitBucket;
  }
  const lower = envName.trim().toLowerCase();
  const slug = lower === 'production' || lower === 'prod'
    ? 'prod'
    : lower.replace(/[^a-z0-9-]/g, '-');
  return `${projectId}-${slug}`;
}

/**
 * Parse `--envs production,qual` or `production:(default),qual:qual-env`.
 * @param {string} raw
 * @param {string} projectId
 * @returns {EnvSpec[]}
 */
export function parseEnvs(raw, projectId) {
  if (!raw?.trim()) {
    throw new Error('Missing --envs. Example: --envs production,qual,cert');
  }

  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error('Missing --envs. Example: --envs production,qual,cert');
  }

  /** @type {EnvSpec[]} */
  const envs = [];
  const seen = new Set();

  for (const part of parts) {
    const [namePart, dbPart] = part.split(':').map((s) => s?.trim());
    const name = namePart;
    if (!name) {
      throw new Error(`Invalid env entry: "${part}"`);
    }
    if (seen.has(name)) {
      throw new Error(`Duplicate environment: "${name}"`);
    }
    seen.add(name);

    envs.push({
      name,
      saId: saIdForEnv(name),
      database: databaseForEnv(name, projectId, dbPart || undefined),
      bucket: bucketForEnv(name, projectId),
      secretSuffix: secretSuffixForEnv(name),
    });
  }

  return envs;
}

/**
 * @param {string} raw
 * @returns {string[]}
 */
export function parseSecrets(raw) {
  if (!raw?.trim()) {
    return ['STRIPE_SECRET'];
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase());
}

/**
 * @param {object} options
 * @param {string} options.projectId
 * @param {EnvSpec[]} options.envs
 * @param {string[]} [options.secretBases]
 * @param {string} [options.location]
 * @returns {string}
 */
export function renderEnvScript({
  projectId,
  env,
  secretBases = ['STRIPE_SECRET'],
  location = 'us-central1',
  allEnvs = [],
}) {
  const saEmail = `${env.saId}@${projectId}.iam.gserviceaccount.com`;
  const dbConditionTitle = `${env.name}_firestore_only`.replace(/[^A-Za-z0-9_]/g, '_');
  // Firestore resource name uses database id; (default) is literal "(default)"
  const dbIdForCondition = env.database;
  const lines = [
    '#!/usr/bin/env bash',
    `# firebase-multi-env provision — ${env.name}`,
    '# Generated script. Review before running. Does not modify GCP by itself.',
    'set -euo pipefail',
    '',
    `PROJECT_ID="${projectId}"`,
    `ENV_NAME="${env.name}"`,
    `SA_ID="${env.saId}"`,
    `SA_EMAIL="${saEmail}"`,
    `DATABASE_ID="${env.database}"`,
    `BUCKET="${env.bucket}"`,
    `LOCATION="${location}"`,
    '',
    'echo "==> Creating runtime service account ${SA_ID}"',
    'if gcloud iam service-accounts describe "${SA_EMAIL}" --project="${PROJECT_ID}" >/dev/null 2>&1; then',
    '  echo "    (exists)"',
    'else',
    '  gcloud iam service-accounts create "${SA_ID}" \\',
    '    --project="${PROJECT_ID}" \\',
    '    --display-name="Functions runtime (${ENV_NAME})"',
    'fi',
    '',
    'echo "==> Firestore database ${DATABASE_ID}"',
    'if [[ "${DATABASE_ID}" == "(default)" ]]; then',
    '  echo "    Using existing (default) database — create via Firebase console if missing."',
    'else',
    '  echo "    Create if missing:"',
    '  echo "    firebase firestore:databases:create ${DATABASE_ID} --location=${LOCATION} --project=${PROJECT_ID}"',
    '  # Uncomment to auto-create (requires firebase CLI + permissions):',
    '  # firebase firestore:databases:create "${DATABASE_ID}" --location="${LOCATION}" --project="${PROJECT_ID}" || true',
    'fi',
    '',
    'echo "==> Storage bucket ${BUCKET}"',
    'if gcloud storage buckets describe "gs://${BUCKET}" --project="${PROJECT_ID}" >/dev/null 2>&1; then',
    '  echo "    (exists)"',
    'else',
    '  gcloud storage buckets create "gs://${BUCKET}" \\',
    '    --project="${PROJECT_ID}" \\',
    '    --location="${LOCATION}" \\',
    '    --uniform-bucket-level-access',
    'fi',
    '',
    'echo "==> IAM: Datastore user (prefer DB-scoped condition)"',
    'echo "    Note: Firestore/Datastore IAM conditions vary by org. Verify before relying on them."',
    `# Attempt database-scoped binding. Falls back to project-level if --condition is rejected.`,
    'if ! gcloud projects add-iam-policy-binding "${PROJECT_ID}" \\',
    '  --member="serviceAccount:${SA_EMAIL}" \\',
    '  --role="roles/datastore.user" \\',
    `  --condition='expression=resource.name.extract("/databases/{database}/") == "${dbIdForCondition}",title=${dbConditionTitle}' \\`,
    '  --quiet 2>/dev/null; then',
    '  echo "    Conditioned binding failed — applying project-level datastore.user (defense-in-depth only)."',
    '  echo "    Prefer deny policies / separate projects if this SA must not touch other DBs."',
    '  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \\',
    '    --member="serviceAccount:${SA_EMAIL}" \\',
    '    --role="roles/datastore.user" \\',
    '    --quiet',
    'fi',
    '',
    'echo "==> IAM: Storage objectAdmin on env bucket only"',
    'gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \\',
    '  --member="serviceAccount:${SA_EMAIL}" \\',
    '  --role="roles/storage.objectAdmin" \\',
    '  --project="${PROJECT_ID}"',
    '',
    'echo "==> IAM: logging + tracing (runtime)"',
    'gcloud projects add-iam-policy-binding "${PROJECT_ID}" \\',
    '  --member="serviceAccount:${SA_EMAIL}" \\',
    '  --role="roles/logging.logWriter" \\',
    '  --quiet || true',
    'gcloud projects add-iam-policy-binding "${PROJECT_ID}" \\',
    '  --member="serviceAccount:${SA_EMAIL}" \\',
    '  --role="roles/cloudtrace.agent" \\',
    '  --quiet || true',
    '',
  ];

  for (const base of secretBases) {
    const secretId = `${base}_${env.secretSuffix}`;
    lines.push(
      `echo "==> Secret Manager placeholder ${secretId}"`,
      `SECRET_ID="${secretId}"`,
      'if gcloud secrets describe "${SECRET_ID}" --project="${PROJECT_ID}" >/dev/null 2>&1; then',
      '  echo "    (exists)"',
      'else',
      '  # Placeholder value — replace with real secret via:',
      '  #   printf \'%s\' "$REAL_VALUE" | gcloud secrets versions add "${SECRET_ID}" --data-file=- --project="${PROJECT_ID}"',
      '  printf \'REPLACE_ME_%s\' "${SECRET_ID}" | gcloud secrets create "${SECRET_ID}" \\',
      '    --project="${PROJECT_ID}" \\',
      '    --data-file=-',
      'fi',
      'gcloud secrets add-iam-policy-binding "${SECRET_ID}" \\',
      '  --project="${PROJECT_ID}" \\',
      '  --member="serviceAccount:${SA_EMAIL}" \\',
      '  --role="roles/secretmanager.secretAccessor" \\',
      '  --quiet',
      '',
    );
  }

  // Explicitly document that this SA must NOT get other envs' secrets
  const otherEnvs = allEnvs.filter((e) => e.name !== env.name);
  if (otherEnvs.length > 0) {
    lines.push('echo "==> Isolation reminder"');
    for (const other of otherEnvs) {
      for (const base of secretBases) {
        lines.push(
          `echo "    Do NOT grant ${saEmail} access to ${base}_${other.secretSuffix}"`,
        );
      }
      lines.push(`echo "    Do NOT grant ${saEmail} objectAdmin on gs://${other.bucket}"`);
    }
    lines.push('');
  }

  lines.push(
    'echo ""',
    'echo "Done for ${ENV_NAME}."',
    'echo "Wire Functions with:"',
    'echo "  APP_ENV=${ENV_NAME}"',
    'echo "  serviceAccount: ${SA_EMAIL}"',
    'echo "  createEnvRuntime({ pinned: true, pinnedEnvironment: process.env.APP_ENV, ... })"',
    '',
  );

  return lines.join('\n');
}

/**
 * @param {object} options
 * @param {string} options.projectId
 * @param {EnvSpec[]} options.envs
 * @param {string[]} [options.secretBases]
 * @param {string} [options.location]
 * @returns {string}
 */
export function renderAllScript(options) {
  const { projectId, envs, location = 'us-central1' } = options;
  const lines = [
    '#!/usr/bin/env bash',
    '# firebase-multi-env provision — all environments',
    '# Generated script. Review before running.',
    'set -euo pipefail',
    '',
    'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    `PROJECT_ID="${projectId}"`,
    `LOCATION="${location}"`,
    '',
    `echo "Provisioning ${envs.length} envs in project \${PROJECT_ID}"`,
    '',
  ];

  for (const env of envs) {
    lines.push(`bash "\${SCRIPT_DIR}/provision.${env.name}.sh"`);
  }

  lines.push(
    '',
    'echo ""',
    'echo "All env scripts finished."',
    'echo "Next:"',
    'echo "  1. Replace placeholder Secret Manager values"',
    'echo "  2. Attach each SA to the matching Functions deploy (serviceAccount + APP_ENV)"',
    'echo "  3. npx firebase-multi-env doctor --strict"',
    `echo "  4. Grant gated Auth access: npx firebase-multi-env grant-env <env> --project ${projectId} you@email.com"`,
    '',
  );

  return lines.join('\n');
}

/**
 * @param {object} options
 * @param {string} options.projectId
 * @param {EnvSpec[]} options.envs
 * @param {string[]} [options.secretBases]
 * @returns {string}
 */
export function renderReadme({ projectId, envs, secretBases = ['STRIPE_SECRET'] }) {
  const rows = envs
    .map(
      (e) =>
        `| \`${e.name}\` | \`${e.saId}@${projectId}.iam.gserviceaccount.com\` | \`${e.database}\` | \`gs://${e.bucket}\` | ${
          secretBases.map((b) => `\`${b}_${e.secretSuffix}\``).join(', ')
        } |`,
    )
    .join('\n');

  return `# Provision scripts (generated)

Generated by \`firebase-multi-env provision\` for project **${projectId}**.

These scripts **do not** call GCP until you run them. Review every binding.

## Environments

| Env | Runtime SA | Firestore DB | Storage bucket | Secrets |
|---|---|---|---|---|
${rows}

## Run

\`\`\`bash
# One env
bash provision.qual.sh

# All envs
bash provision.all.sh
\`\`\`

Requires \`gcloud\` authenticated as a **deployer** identity with IAM Admin,
Secret Manager Admin, and Storage Admin (not a runtime SA).

## Auth model

Auth stays **shared** in this Firebase project. Gate non-prod with claims:

\`\`\`bash
npx firebase-multi-env grant-env qual --project ${projectId} you@email.com
\`\`\`

## After provisioning

1. Replace \`REPLACE_ME_*\` secret values with real keys
2. Set \`APP_ENV\` + \`serviceAccount\` on each Functions codebase
3. \`npx firebase-multi-env doctor --strict\`
4. See \`../iam-sa-per-env.md\`, \`../secrets-per-env.md\`, \`../PROJECT_PARITY.md\`

## Residual risk

Project-level \`roles/datastore.user\` (fallback when DB conditions fail) can
still reach other Firestore databases. Prefer conditioned bindings, deny
policies, or separate projects for high-sensitivity data.
`;
}

/**
 * @param {object} options
 * @param {string} options.projectId
 * @param {string} options.envsRaw
 * @param {string} [options.secretsRaw]
 * @param {string} [options.location]
 * @param {string} [options.outDir]
 * @param {boolean} [options.printOnly]
 * @returns {{ files: Array<{ path: string, content: string }>, envs: EnvSpec[] }}
 */
export function buildProvisionFiles({
  projectId,
  envsRaw,
  secretsRaw,
  location = 'us-central1',
  outDir = 'multi-env/provision',
  printOnly = false,
}) {
  if (!projectId?.trim()) {
    throw new Error(
      'Missing project id. Pass --project <id> or set GCLOUD_PROJECT / GOOGLE_CLOUD_PROJECT.',
    );
  }

  const envs = parseEnvs(envsRaw, projectId);
  const secretBases = parseSecrets(secretsRaw);

  /** @type {Array<{ path: string, content: string }>} */
  const files = [];

  for (const env of envs) {
    files.push({
      path: join(outDir, `provision.${env.name}.sh`),
      content: renderEnvScript({
        projectId,
        env,
        secretBases,
        location,
        allEnvs: envs,
      }),
    });
  }

  files.push({
    path: join(outDir, 'provision.all.sh'),
    content: renderAllScript({ projectId, envs, secretBases, location }),
  });

  files.push({
    path: join(outDir, 'README.md'),
    content: renderReadme({ projectId, envs, secretBases }),
  });

  if (!printOnly) {
    mkdirSync(outDir, { recursive: true });
    for (const file of files) {
      writeFileSync(file.path, file.content, { mode: 0o755 });
      try {
        chmodSync(file.path, 0o755);
      } catch {
        // Windows / restricted FS — ignore
      }
    }
  }

  return { files, envs, secretBases, outDir, projectId };
}

/**
 * Parse CLI args for provision.
 * @param {string[]} args
 */
export function parseProvisionArgs(args) {
  const projectIdx = args.indexOf('--project');
  const envsIdx = args.indexOf('--envs');
  const secretsIdx = args.indexOf('--secrets');
  const locationIdx = args.indexOf('--location');
  const dirIdx = args.indexOf('--dir');
  const modeIdx = args.indexOf('--mode');
  const skeletonIdx = args.indexOf('--skeleton');
  const billingIdx = args.indexOf('--billing-account');
  const printOnly = args.includes('--print');
  const skipCreateProject = args.includes('--skip-create-project');

  const modeRaw = modeIdx >= 0 ? args[modeIdx + 1] : 'databases';
  const mode = modeRaw === 'projects' ? 'projects' : 'databases';

  const projectId =
    (projectIdx >= 0 ? args[projectIdx + 1] : null)
    || process.env.GCLOUD_PROJECT
    || process.env.GCP_PROJECT
    || process.env.GOOGLE_CLOUD_PROJECT
    || null;

  const envsRaw = envsIdx >= 0 ? args[envsIdx + 1] : null;
  const secretsRaw = secretsIdx >= 0 ? args[secretsIdx + 1] : undefined;
  const location = locationIdx >= 0 ? args[locationIdx + 1] : 'us-central1';
  const outDir = dirIdx >= 0
    ? args[dirIdx + 1]
    : mode === 'projects'
      ? 'multi-env/provision/projects'
      : 'multi-env/provision';
  const skeletonPath = skeletonIdx >= 0 ? args[skeletonIdx + 1] : 'multi-env/skeleton.json';
  const billingAccount = billingIdx >= 0 ? args[billingIdx + 1] : null;

  if (!envsRaw) {
    throw new Error(
      mode === 'projects'
        ? 'Missing --envs. Example:\n'
          + '  firebase-multi-env provision --mode projects --envs production:my-app-prod,qual:my-app-qual'
        : 'Missing --envs. Example:\n'
          + '  firebase-multi-env provision --project my-app --envs production,qual',
    );
  }

  return {
    mode,
    projectId,
    envsRaw,
    secretsRaw,
    location: location || 'us-central1',
    outDir: outDir || (mode === 'projects' ? 'multi-env/provision/projects' : 'multi-env/provision'),
    skeletonPath: skeletonPath || 'multi-env/skeleton.json',
    billingAccount: billingAccount || null,
    createProject: !skipCreateProject,
    printOnly,
  };
}

/**
 * Parse `--envs production:my-app-prod,qual:my-app-qual` for projects mode.
 * @param {string} raw
 * @returns {Array<{ name: string, projectId: string, saId: string, secretSuffix: string, bucket: string, database: string }>}
 */
export function parseProjectEnvs(raw) {
  if (!raw?.trim()) {
    throw new Error(
      'Missing --envs. Example: --envs production:my-app-prod,qual:my-app-qual',
    );
  }

  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  /** @type {Array<{ name: string, projectId: string, saId: string, secretSuffix: string, bucket: string, database: string }>} */
  const envs = [];
  const seenNames = new Set();
  const seenProjects = new Set();

  for (const part of parts) {
    const colon = part.indexOf(':');
    if (colon <= 0 || colon === part.length - 1) {
      throw new Error(
        `Invalid projects env entry "${part}". Use name:projectId (e.g. qual:my-app-qual).`,
      );
    }
    const name = part.slice(0, colon).trim();
    const projectId = part.slice(colon + 1).trim();
    if (!name || !projectId) {
      throw new Error(`Invalid projects env entry "${part}".`);
    }
    if (seenNames.has(name)) {
      throw new Error(`Duplicate environment: "${name}"`);
    }
    if (seenProjects.has(projectId)) {
      throw new Error(`Duplicate projectId: "${projectId}"`);
    }
    seenNames.add(name);
    seenProjects.add(projectId);

    envs.push({
      name,
      projectId,
      saId: saIdForEnv(name),
      secretSuffix: secretSuffixForEnv(name),
      database: '(default)',
      bucket: bucketForEnv(name, projectId),
    });
  }

  return envs;
}

/**
 * @param {object} options
 * @param {import('./skeleton.mjs').ProjectSkeleton} options.skeleton
 * @param {{ name: string, projectId: string, saId: string, secretSuffix: string, bucket: string, database: string }} options.env
 * @param {string} [options.location]
 * @param {string | null} [options.billingAccount]
 * @param {boolean} [options.createProject]
 */
export function renderProjectEnvScript({
  skeleton,
  env,
  location = 'us-central1',
  billingAccount = null,
  createProject = true,
}) {
  const saEmail = `${env.saId}@${env.projectId}.iam.gserviceaccount.com`;
  const secretBases = skeleton.secrets.length > 0 ? skeleton.secrets : ['STRIPE_SECRET'];
  const lines = [
    '#!/usr/bin/env bash',
    `# firebase-multi-env provision (projects) — env: ${env.name}`,
    '# Generated from multi-env/skeleton.json. Review before running.',
    'set -euo pipefail',
    '',
    `PROJECT_ID="${env.projectId}"`,
    `ENV_NAME="${env.name}"`,
    `SA_ID="${env.saId}"`,
    `SA_EMAIL="${saEmail}"`,
    `LOCATION="${location}"`,
    `BUCKET="${env.bucket}"`,
    billingAccount ? `BILLING_ACCOUNT="${billingAccount}"` : '# BILLING_ACCOUNT= (pass --billing-account to provision)',
    '',
    'echo "=== Provisioning ${ENV_NAME} in project ${PROJECT_ID} ==="',
    '',
  ];

  if (createProject) {
    lines.push(
      'if gcloud projects describe "${PROJECT_ID}" >/dev/null 2>&1; then',
      '  echo "GCP project ${PROJECT_ID} already exists"',
      '  # Ensure Firebase is enabled on an existing GCP project',
      '  if command -v firebase >/dev/null 2>&1; then',
      '    firebase projects:addfirebase "${PROJECT_ID}" --non-interactive >/dev/null 2>&1 || true',
      '  fi',
      'else',
      '  echo "Creating Firebase/GCP project ${PROJECT_ID}..."',
      '  if command -v firebase >/dev/null 2>&1; then',
      '    firebase projects:create "${PROJECT_ID}" --display-name "${ENV_NAME}" --non-interactive',
      '  else',
      '    gcloud projects create "${PROJECT_ID}" --name="${ENV_NAME}"',
      '    echo "firebase CLI not found — ran gcloud projects create only."',
      '    echo "Install firebase-tools and run: firebase projects:addfirebase ${PROJECT_ID}"',
      '  fi',
      'fi',
      '',
    );

    if (billingAccount) {
      lines.push(
        'echo "Linking billing account ${BILLING_ACCOUNT}..."',
        'gcloud billing projects link "${PROJECT_ID}" --billing-account="${BILLING_ACCOUNT}" >/dev/null',
        '',
      );
    } else {
      lines.push(
        'if gcloud billing projects describe "${PROJECT_ID}" >/dev/null 2>&1; then',
        '  echo "Billing already linked on ${PROJECT_ID}"',
        'else',
        '  echo "WARNING: No billing account linked. Pass --billing-account BILLING_ID when generating"',
        '  echo "  scripts, or run: gcloud billing projects link ${PROJECT_ID} --billing-account=BILLING_ID"',
        'fi',
        '',
      );
    }
  } else {
    lines.push(
      'echo "createProject=false — skipping project create (project must already exist)."',
      'gcloud projects describe "${PROJECT_ID}" >/dev/null',
      '',
    );
  }

  if (skeleton.services.firestore) {
    lines.push(
      'echo "Firestore (default) — create in console or:"',
      'echo "  firebase firestore:databases:create \'(default)\' --location=${LOCATION} --project=${PROJECT_ID}"',
      '',
    );
  }

  if (skeleton.services.storage) {
    lines.push(
      'if gcloud storage buckets describe "gs://${BUCKET}" --project="${PROJECT_ID}" >/dev/null 2>&1; then',
      '  echo "Bucket gs://${BUCKET} already exists"',
      'else',
      '  gcloud storage buckets create "gs://${BUCKET}" \\',
      '    --project="${PROJECT_ID}" \\',
      '    --location="${LOCATION}"',
      'fi',
      '',
    );
  }

  lines.push(
    'if gcloud iam service-accounts describe "${SA_EMAIL}" --project="${PROJECT_ID}" >/dev/null 2>&1; then',
    '  echo "SA ${SA_EMAIL} already exists"',
    'else',
    '  gcloud iam service-accounts create "${SA_ID}" \\',
    '    --project="${PROJECT_ID}" \\',
    `    --display-name="Functions runtime (${env.name})"`,
    'fi',
    '',
  );

  for (const role of skeleton.runtimeSa.roles) {
    lines.push(
      `gcloud projects add-iam-policy-binding "\${PROJECT_ID}" \\`,
      `  --member="serviceAccount:\${SA_EMAIL}" \\`,
      `  --role="${role}" \\`,
      '  --condition=None >/dev/null',
      '',
    );
  }

  for (const base of secretBases) {
    const secretId = `${base}_${env.secretSuffix}`;
    lines.push(
      `SECRET_ID="${secretId}"`,
      'if gcloud secrets describe "${SECRET_ID}" --project="${PROJECT_ID}" >/dev/null 2>&1; then',
      '  echo "Secret ${SECRET_ID} already exists"',
      'else',
      '  printf \'%s\' "REPLACE_ME_${SECRET_ID}" | gcloud secrets create "${SECRET_ID}" \\',
      '    --project="${PROJECT_ID}" \\',
      '    --data-file=-',
      'fi',
      'gcloud secrets add-iam-policy-binding "${SECRET_ID}" \\',
      '  --project="${PROJECT_ID}" \\',
      '  --member="serviceAccount:${SA_EMAIL}" \\',
      '  --role="roles/secretmanager.secretAccessor" >/dev/null',
      '',
    );
  }

  lines.push(
    'echo ""',
    'echo "Auth providers (enable in console or Identity Toolkit API):"',
    ...skeleton.auth.providers.map((p) => `echo "  - ${p}"`),
    'echo "Authorized domains (patterns from skeleton):"',
    ...skeleton.auth.authorizedDomainPatterns.map(
      (p) => `echo "  - ${p.replace(/\{projectId\}/g, env.projectId)}"`,
    ),
    '',
    'echo "Done ${ENV_NAME}. Set APP_ENV=${ENV_NAME} and serviceAccount=${SA_EMAIL} on deploy."',
    '',
  );

  return lines.join('\n');
}

/**
 * @param {object} options
 */
export function renderProjectAllScript({ envs }) {
  const lines = [
    '#!/usr/bin/env bash',
    '# firebase-multi-env provision — all projects',
    'set -euo pipefail',
    'SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    '',
    `echo "Provisioning ${envs.length} separate Firebase projects"`,
    '',
  ];
  for (const env of envs) {
    lines.push(`bash "\${SCRIPT_DIR}/provision.${env.name}.sh"`);
  }
  lines.push(
    '',
    'echo ""',
    'echo "All project scripts finished."',
    'echo "Next:"',
    'echo "  1. Replace REPLACE_ME_* secret values in each project"',
    'echo "  2. Deploy each env to its projectId with APP_ENV set"',
    'echo "  3. Bootstrap testers: npx firebase-multi-env sync-users --emails you@email.com --envs qual"',
    'echo "  4. npx firebase-multi-env doctor --strict"',
    '',
  );
  return lines.join('\n');
}

/**
 * @param {object} options
 */
export function renderProjectReadme({ envs, skeleton }) {
  const rows = envs
    .map(
      (e) =>
        `| \`${e.name}\` | \`${e.projectId}\` | \`${e.saId}@${e.projectId}.iam.gserviceaccount.com\` | \`gs://${e.bucket}\` |`,
    )
    .join('\n');

  return `# Multi-project provision scripts (generated)

Generated by \`firebase-multi-env provision --mode projects\` from **multi-env/skeleton.json**.

Each environment is a **separate Firebase/GCP project** (separate Auth, billing, IAM).

Scripts **create** each project if missing (\`firebase projects:create\`, or \`gcloud projects create\`
fallback), optionally link a billing account, then apply the skeleton (SA / IAM / secrets / buckets).

## Environments

| Env | Project | Runtime SA | Storage bucket |
|---|---|---|---|
${rows}

## Skeleton (editable)

Edit \`multi-env/skeleton.json\` then re-run provision or \`parity\` to refresh scripts.

- Runtime roles: ${skeleton.runtimeSa.roles.map((r) => `\`${r}\``).join(', ')}
- Secrets (names only): ${skeleton.secrets.map((s) => `\`${s}\``).join(', ') || '(none)'}
- Auth providers: ${skeleton.auth.providers.join(', ')}

## Run

\`\`\`bash
bash provision.all.sh
\`\`\`

## Users

Do **not** use \`grant-env\` (shared-Auth claims). Bootstrap selected emails:

\`\`\`bash
npx firebase-multi-env sync-users --emails you@email.com --envs qual,cert
\`\`\`

Same email ⇒ different UIDs per project.
`;
}

/**
 * @param {object} options
 * @param {string} options.envsRaw
 * @param {string} [options.location]
 * @param {string} [options.outDir]
 * @param {boolean} [options.printOnly]
 * @param {string} [options.targetRoot]
 * @param {string} [options.skeletonPath]
 * @param {import('./skeleton.mjs').ProjectSkeleton} [options.skeleton]
 */
export function buildProjectProvisionFiles({
  envsRaw,
  location = 'us-central1',
  outDir = 'multi-env/provision/projects',
  printOnly = false,
  targetRoot = process.cwd(),
  skeletonPath = 'multi-env/skeleton.json',
  skeleton: skeletonOverride,
  billingAccount = null,
  createProject = true,
}) {
  const skeleton = skeletonOverride
    ?? loadProjectSkeleton(targetRoot, skeletonPath);

  const envs = parseProjectEnvs(envsRaw);
  for (const env of envs) {
    env.saId = resolveSaId(skeleton.runtimeSa.idPattern, env.name);
  }

  /** @type {Array<{ path: string, content: string }>} */
  const files = [];

  for (const env of envs) {
    files.push({
      path: join(outDir, `provision.${env.name}.sh`),
      content: renderProjectEnvScript({
        skeleton,
        env,
        location,
        billingAccount,
        createProject,
      }),
    });
  }

  files.push({
    path: join(outDir, 'provision.all.sh'),
    content: renderProjectAllScript({ envs }),
  });

  files.push({
    path: join(outDir, 'README.md'),
    content: renderProjectReadme({ envs, skeleton }),
  });

  if (!printOnly) {
    mkdirSync(outDir, { recursive: true });
    for (const file of files) {
      writeFileSync(file.path, file.content, { mode: 0o755 });
      try {
        chmodSync(file.path, 0o755);
      } catch {
        // ignore
      }
    }
  }

  return { files, envs, skeleton, outDir, mode: 'projects' };
}
