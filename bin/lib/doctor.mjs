/**
 * Project-parity doctor checks for firebase-multi-env.
 * Used by `firebase-multi-env doctor` and `--strict`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  'coverage',
  '.turbo',
  '.next',
  'build',
]);

/** @typedef {'ok' | 'info' | 'warn' | 'error'} FindingLevel */
/** @typedef {{ level: FindingLevel, message: string, code?: string }} Finding */

/**
 * @param {string} root
 * @param {string[]} [acc]
 * @returns {string[]}
 */
export function walkSourceFiles(root, acc = []) {
  if (!existsSync(root)) {
    return acc;
  }
  for (const name of readdirSync(root)) {
    if (SKIP_DIRS.has(name)) {
      continue;
    }
    const full = join(root, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkSourceFiles(full, acc);
    } else if (/\.(m?[jt]sx?|cjs|mjs)$/.test(name)) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * @param {string} root
 * @param {string[]} [acc]
 * @returns {string[]}
 */
export function walkConfigFiles(root, acc = []) {
  if (!existsSync(root)) {
    return acc;
  }
  for (const name of readdirSync(root)) {
    if (SKIP_DIRS.has(name)) {
      continue;
    }
    const full = join(root, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkConfigFiles(full, acc);
    } else if (/\.(ya?ml|json|md)$/i.test(name) || name === 'Dockerfile') {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Detect bare Admin SDK Firestore access that bypasses getDb / getDbForEnv.
 * @param {string} text
 * @returns {boolean}
 */
export function hasBareAdminFirestore(text) {
  // Strip block and line comments to reduce false positives in docs/examples.
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  if (/\badmin\.firestore\s*\(/.test(stripped)) {
    return true;
  }
  // getFirestore(...) from firebase-admin — allow createGetDb internals via comment markers.
  if (
    /\bgetFirestore\s*\(/.test(stripped)
    && !/from\s+['"]firebase-multi-env/.test(stripped)
    && /firebase-admin/.test(stripped)
  ) {
    return true;
  }
  return false;
}

/**
 * True when a file that calls createEnvRuntime also sets pinned: true.
 * @param {string} text
 */
export function fileHasPinnedRuntime(text) {
  return text.includes('createEnvRuntime') && /pinned\s*:\s*true/.test(text);
}

/**
 * @param {string} text
 */
export function fileHasUnpinnedRuntime(text) {
  if (!text.includes('createEnvRuntime')) {
    return false;
  }
  if (/pinned\s*:\s*true/.test(text)) {
    return false;
  }
  // Explicit false, or omit pinned (defaults unpinned)
  return true;
}

/**
 * @param {object} options
 * @param {string} options.targetRoot
 * @param {boolean} [options.strict]
 * @param {string} [options.cwd]
 * @returns {{ findings: Finding[], exitCode: number, label: string }}
 */
export function runDoctor({ targetRoot, strict = false, cwd = process.cwd() }) {
  /** @type {Finding[]} */
  const findings = [];
  const label = relative(cwd, targetRoot) || '.';

  const sourceFiles = walkSourceFiles(targetRoot);
  const configFiles = walkConfigFiles(targetRoot);
  const contents = sourceFiles.map((file) => {
    try {
      return { file, text: readFileSync(file, 'utf8') };
    } catch {
      return { file, text: '' };
    }
  });
  const configContents = configFiles.map((file) => {
    try {
      return { file, text: readFileSync(file, 'utf8') };
    } catch {
      return { file, text: '' };
    }
  });
  const allText = [...contents, ...configContents];

  const hasCreateEnv = contents.some(({ text }) => text.includes('createEnvRuntime'));
  const hasPinned = contents.some(({ text }) => /pinned\s*:\s*true/.test(text));
  const hasLogicalExplicit = contents.some(({ text }) => /pinned\s*:\s*false/.test(text));
  const hasAllowUnpinned = contents.some(({ text }) =>
    /allowUnpinnedCloudDeploy\s*:\s*true/.test(text),
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
  const hasGetDbForEnv = contents.some(({ text }) => text.includes('createGetDbForEnv'));
  const hasOnResolveEnv = contents.some(({ text }) => text.includes('onResolveEnv'));
  const hasRejectUnknown = contents.some(({ text }) =>
    /rejectUnknownOrigin\s*:\s*true/.test(text) || /pinned\s*:\s*true/.test(text),
  );
  const hasRefuseEmulator = contents.some(({ text }) =>
    /refuseEmulatorEnvOutsideEmulator\s*:\s*true/.test(text)
    || /pinned\s*:\s*true/.test(text),
  );
  const bareFirestoreFiles = contents.filter(({ text }) => hasBareAdminFirestore(text));
  const unpinnedRuntimeFiles = contents.filter(({ text }) => fileHasUnpinnedRuntime(text));

  const hasSecretsDoc = existsSync(join(targetRoot, 'multi-env', 'secrets-per-env.md'))
    || allText.some(({ text }) => /Secret Manager|defineSecret|secrets\s*:/.test(text));
  const hasDeployIsolationDoc = existsSync(join(targetRoot, 'multi-env', 'deploy-isolation.md'))
    || allText.some(({ text }) =>
      /workload.?identity|WIF|github-actions\.deploy|APP_ENV=/.test(text),
    );
  const hasCiWorkflow = allText.some(({ file, text }) =>
    /\/\.github\//.test(file.replace(/\\/g, '/'))
    && /firebase deploy|APP_ENV/.test(text),
  );
  const hasParityDoc = existsSync(join(targetRoot, 'multi-env', 'PROJECT_PARITY.md'));
  const hasIsolationDocs = existsSync(join(targetRoot, 'MULTI_ENV_SETUP.md'))
    || existsSync(join(targetRoot, 'multi-env', 'ISOLATION.md'));
  const hasStorageSnippet = existsSync(
    join(targetRoot, 'firestore.rules.snippets', 'storage.gated.rules.snippet'),
  )
    || existsSync(join(targetRoot, 'multi-env', 'storage.gated.rules.snippet'))
    || allText.some(({ text }) => /match \/b\/\{bucket\}/.test(text));

  // --- Baseline checks ---

  if (!hasCreateEnv) {
    findings.push({
      level: strict ? 'error' : 'warn',
      code: 'no-runtime',
      message: 'No createEnvRuntime() usage found. Run init and wire Functions first.',
    });
  } else {
    findings.push({
      level: 'ok',
      code: 'has-runtime',
      message: 'Found createEnvRuntime() usage.',
    });
  }

  if (hasPinned) {
    findings.push({
      level: 'ok',
      code: 'pinned',
      message: 'Pinned isolation mode detected (required for production / project-parity).',
    });
    if (!mentionsAppEnv) {
      findings.push({
        level: strict ? 'error' : 'warn',
        code: 'pinned-env-source',
        message: 'Pinned mode should set pinnedEnvironment or APP_ENV per deploy.',
      });
    } else {
      findings.push({
        level: 'ok',
        code: 'pinned-env-source',
        message: 'Pinned env source (APP_ENV / pinnedEnvironment) referenced.',
      });
    }
    if (!hasServiceAccount) {
      findings.push({
        level: strict ? 'error' : 'warn',
        code: 'service-account',
        message:
          'No serviceAccount config found in scanned sources. Attach a per-env SA so IAM matches pinned mode.',
      });
    } else {
      findings.push({
        level: 'ok',
        code: 'service-account',
        message: 'serviceAccount referenced in sources.',
      });
    }
  } else if (hasCreateEnv) {
    const level = strict && !hasAllowUnpinned ? 'error' : 'warn';
    findings.push({
      level,
      code: 'unpinned',
      message: hasLogicalExplicit
        ? 'Unpinned mode (pinned: false) — Origin selects DB across envs in one runtime. Not project-parity.'
        : 'No pinned: true found — default is unpinned (shared runtime may open multiple DBs).',
    });
    findings.push({
      level: strict ? 'error' : 'info',
      code: 'prefer-pinned',
      message:
        'Production path: pinned: true + per-env service accounts + secrets. See multi-env/PROJECT_PARITY.md.',
    });
    if (hasAllowUnpinned) {
      findings.push({
        level: 'warn',
        code: 'allow-unpinned',
        message:
          'allowUnpinnedCloudDeploy: true found — intentional shared-runtime escape hatch.',
      });
    }
  }

  if (unpinnedRuntimeFiles.length > 0 && hasCreateEnv) {
    const sample = unpinnedRuntimeFiles
      .slice(0, 3)
      .map(({ file }) => relative(cwd, file) || file)
      .join(', ');
    findings.push({
      level: strict ? 'error' : 'warn',
      code: 'unpinned-files',
      message: `createEnvRuntime without pinned: true in: ${sample}${
        unpinnedRuntimeFiles.length > 3 ? ` (+${unpinnedRuntimeFiles.length - 3} more)` : ''
      }`,
    });
  }

  if (bareFirestoreFiles.length > 0) {
    const sample = bareFirestoreFiles
      .slice(0, 3)
      .map(({ file }) => relative(cwd, file) || file)
      .join(', ');
    findings.push({
      level: strict ? 'error' : 'warn',
      code: 'bare-admin-firestore',
      message:
        `Bare admin.firestore() / getFirestore() may bypass env isolation in: ${sample}. `
        + 'Use createGetDb / createGetDbForEnv (and ESLint plugin firebase-multi-env/eslint).',
    });
  } else if (hasCreateEnv) {
    findings.push({
      level: 'ok',
      code: 'bare-admin-firestore',
      message: 'No bare admin.firestore() / firebase-admin getFirestore() patterns found.',
    });
  }

  if (hasHttpWrapper && !hasVerifyIdToken) {
    findings.push({
      level: strict ? 'error' : 'warn',
      code: 'verify-id-token',
      message:
        'createWithAppEnvHttp found without verifyIdToken: true. Raw onRequest does not populate req.auth by default.',
    });
  } else if (hasHttpWrapper) {
    findings.push({
      level: 'ok',
      code: 'verify-id-token',
      message: 'HTTP wrapper verifies ID tokens.',
    });
  }

  if (hasGetDb) {
    findings.push({
      level: 'ok',
      code: 'get-db',
      message: 'createGetDb() found — call it only inside withAppEnv* wrappers.',
    });
  }

  if (hasGetDbForEnv) {
    findings.push({
      level: 'ok',
      code: 'get-db-for-env',
      message: 'createGetDbForEnv() found — use for scripts / scheduled jobs.',
    });
  } else if (strict && hasCreateEnv) {
    findings.push({
      level: 'warn',
      code: 'get-db-for-env',
      message:
        'No createGetDbForEnv() — background jobs should use an explicit env, not bare getDb().',
    });
  }

  if (strict) {
    if (hasRejectUnknown) {
      findings.push({
        level: 'ok',
        code: 'reject-unknown-origin',
        message: 'Unknown Origin rejection enabled (pinned default or explicit).',
      });
    } else if (hasCreateEnv) {
      findings.push({
        level: 'error',
        code: 'reject-unknown-origin',
        message: 'rejectUnknownOrigin not active — set pinned: true or rejectUnknownOrigin: true.',
      });
    }

    if (hasRefuseEmulator) {
      findings.push({
        level: 'ok',
        code: 'refuse-emulator-leak',
        message: 'Emulator-env leak refusal enabled (pinned default or explicit).',
      });
    } else if (hasCreateEnv) {
      findings.push({
        level: 'error',
        code: 'refuse-emulator-leak',
        message:
          'refuseEmulatorEnvOutsideEmulator not active — set pinned: true or enable explicitly.',
      });
    }

    if (hasOnResolveEnv) {
      findings.push({
        level: 'ok',
        code: 'audit-hook',
        message: 'onResolveEnv audit hook found.',
      });
    } else if (hasCreateEnv) {
      findings.push({
        level: 'warn',
        code: 'audit-hook',
        message: 'No onResolveEnv hook — recommended for production audit trails.',
      });
    }

    if (hasSecretsDoc) {
      findings.push({
        level: 'ok',
        code: 'secrets',
        message: 'Per-env secrets guidance or Secret Manager usage detected.',
      });
    } else {
      findings.push({
        level: 'error',
        code: 'secrets',
        message:
          'No per-env secrets docs/usage found. Run init and bind secrets per SA (multi-env/secrets-per-env.md).',
      });
    }

    if (hasDeployIsolationDoc || hasCiWorkflow) {
      findings.push({
        level: 'ok',
        code: 'deploy-isolation',
        message: hasCiWorkflow
          ? 'CI / deploy workflow with APP_ENV or firebase deploy detected.'
          : 'Deploy isolation docs present.',
      });
    } else {
      findings.push({
        level: 'error',
        code: 'deploy-isolation',
        message:
          'No deploy isolation / CI matrix found. See multi-env/deploy-isolation.md and github-actions.deploy.example.yml.',
      });
    }

    if (hasStorageSnippet) {
      findings.push({
        level: 'ok',
        code: 'storage-rules',
        message: 'Storage rules / bucket isolation snippet detected.',
      });
    } else {
      findings.push({
        level: 'warn',
        code: 'storage-rules',
        message:
          'No Storage gated rules snippet found — use a bucket per env (multi-env/storage.gated.rules.snippet).',
      });
    }

    if (hasParityDoc) {
      findings.push({
        level: 'ok',
        code: 'parity-doc',
        message: 'PROJECT_PARITY.md checklist present.',
      });
    } else {
      findings.push({
        level: 'warn',
        code: 'parity-doc',
        message: 'Run: npx firebase-multi-env init — copies PROJECT_PARITY.md into multi-env/.',
      });
    }
  }

  if (!hasIsolationDocs) {
    findings.push({
      level: 'info',
      code: 'setup-docs',
      message: 'Setup docs not found. Run: npx firebase-multi-env init',
    });
  }

  const failures = findings.filter((f) =>
    f.level === 'error' || f.level === 'warn',
  );
  const exitCode = failures.length > 0 ? 1 : 0;

  return { findings, exitCode, label, strict };
}

/**
 * @param {{ findings: Finding[], exitCode: number, label: string, strict?: boolean }} result
 */
export function printDoctorResult(result) {
  const mode = result.strict ? 'strict' : 'default';
  console.log(`firebase-multi-env doctor (${result.label}) [${mode}]\n`);

  for (const finding of result.findings) {
    const tag = finding.level.toUpperCase().padEnd(5);
    console.log(`[${tag}] ${finding.message}`);
  }

  const errors = result.findings.filter((f) => f.level === 'error').length;
  const warnings = result.findings.filter((f) => f.level === 'warn').length;

  if (errors || warnings) {
    console.log(
      `\nDoctor finished with ${errors} error(s), ${warnings} warning(s).`
      + (result.strict ? '' : ' Re-run with --strict for project-parity gates.'),
    );
  } else {
    console.log(
      result.strict
        ? '\nDoctor --strict passed (project-parity checklist).'
        : '\nDoctor finished with no warnings.',
    );
  }
}
