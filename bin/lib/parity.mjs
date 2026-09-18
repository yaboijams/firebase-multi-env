/**
 * Parity / sync helpers for isolationMode: 'projects'.
 * Re-emits IAM / auth-config scripts from the editable skeleton.
 */

import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { loadProjectSkeleton, resolveSaId, summarizeSkeleton } from './skeleton.mjs';
import { parseProjectEnvs, renderProjectEnvScript } from './provision.mjs';

/**
 * @param {string[]} args
 */
export function parseParityArgs(args) {
  const envsIdx = args.indexOf('--envs');
  const dirIdx = args.indexOf('--dir');
  const skeletonIdx = args.indexOf('--skeleton');
  const targetIdx = args.indexOf('--target-root');
  const printOnly = args.includes('--print');
  const what = args.find((a) => !a.startsWith('--') && a !== args[0])
    || args[0]
    || 'iam';

  // First positional after command is the parity target: iam | auth-config | all
  const positionals = args.filter((a, i) => {
    if (a.startsWith('--')) return false;
    if (envsIdx >= 0 && i === envsIdx + 1) return false;
    if (dirIdx >= 0 && i === dirIdx + 1) return false;
    if (skeletonIdx >= 0 && i === skeletonIdx + 1) return false;
    if (targetIdx >= 0 && i === targetIdx + 1) return false;
    return true;
  });
  const target = positionals[0] || 'all';

  const envsRaw = envsIdx >= 0 ? args[envsIdx + 1] : null;
  if (!envsRaw) {
    throw new Error(
      'Missing --envs. Example:\n'
      + '  firebase-multi-env parity iam --envs production:my-app-prod,qual:my-app-qual',
    );
  }

  return {
    target,
    envsRaw,
    outDir: (dirIdx >= 0 ? args[dirIdx + 1] : null) || 'multi-env/provision/projects',
    skeletonPath: (skeletonIdx >= 0 ? args[skeletonIdx + 1] : null) || 'multi-env/skeleton.json',
    targetRoot: (targetIdx >= 0 ? args[targetIdx + 1] : null) || process.cwd(),
    printOnly,
  };
}

/**
 * Re-apply skeleton to per-env provision scripts (IAM + secrets + auth notes).
 */
export function buildParityFiles(options) {
  const {
    envsRaw,
    outDir = 'multi-env/provision/projects',
    printOnly = false,
    targetRoot = process.cwd(),
    skeletonPath = 'multi-env/skeleton.json',
    skeleton: skeletonOverride,
    target = 'all',
  } = options;

  const skeleton = skeletonOverride
    ?? loadProjectSkeleton(targetRoot, skeletonPath);
  const envs = parseProjectEnvs(envsRaw);
  for (const env of envs) {
    env.saId = resolveSaId(skeleton.runtimeSa.idPattern, env.name);
  }

  /** @type {Array<{ path: string, content: string }>} */
  const files = [];

  if (target === 'iam' || target === 'all') {
    for (const env of envs) {
      files.push({
        path: join(outDir, `parity.iam.${env.name}.sh`),
        content: renderProjectEnvScript({ skeleton, env }),
      });
    }
  }

  if (target === 'auth-config' || target === 'all') {
    files.push({
      path: join(outDir, 'parity.auth-config.md'),
      content: renderAuthConfigParity({ envs, skeleton }),
    });
  }

  files.push({
    path: join(outDir, 'parity.SUMMARY.md'),
    content: `# Parity summary\n\nTarget: \`${target}\`\n\n\`\`\`json\n${JSON.stringify(summarizeSkeleton(skeleton), null, 2)}\n\`\`\`\n`,
  });

  if (!printOnly) {
    mkdirSync(outDir, { recursive: true });
    for (const file of files) {
      const mode = file.path.endsWith('.sh') ? 0o755 : 0o644;
      writeFileSync(file.path, file.content, { mode });
      if (file.path.endsWith('.sh')) {
        try {
          chmodSync(file.path, 0o755);
        } catch {
          // ignore
        }
      }
    }
  }

  return { files, envs, skeleton, outDir, target };
}

function renderAuthConfigParity({ envs, skeleton }) {
  const blocks = envs.map((env) => {
    const domains = skeleton.auth.authorizedDomainPatterns
      .map((p) => `- ${p.replace(/\{projectId\}/g, env.projectId)}`)
      .join('\n');
    return `## ${env.name} (\`${env.projectId}\`)

Providers: ${skeleton.auth.providers.map((p) => `\`${p}\``).join(', ')}

Authorized domains:
${domains || '- (none in skeleton)'}
`;
  });

  return `# Auth config parity (from skeleton)

Enable these Identity providers and authorized domains in **each** project console
(or via Identity Toolkit / gcloud). This file is documentation only — Auth Admin API
provider toggles vary by product.

${blocks.join('\n')}
`;
}

/**
 * @param {string[]} args
 */
export function parseSyncUsersArgs(args) {
  const emailsIdx = args.indexOf('--emails');
  const envsIdx = args.indexOf('--envs');
  const mapIdx = args.indexOf('--project-map');
  const create = !args.includes('--no-create');

  const emailsRaw = emailsIdx >= 0 ? args[emailsIdx + 1] : null;
  const envsRaw = envsIdx >= 0 ? args[envsIdx + 1] : null;
  const mapRaw = mapIdx >= 0 ? args[mapIdx + 1] : null;

  if (!emailsRaw?.trim()) {
    throw new Error(
      'Missing --emails. Example:\n'
      + '  firebase-multi-env sync-users --emails a@x.com,b@y.com --envs qual:my-app-qual',
    );
  }
  if (!envsRaw?.trim()) {
    throw new Error(
      'Missing --envs. Example:\n'
      + '  firebase-multi-env sync-users --emails you@email.com --envs qual:my-app-qual,cert:my-app-cert',
    );
  }

  const emails = emailsRaw.split(',').map((e) => e.trim()).filter(Boolean);
  /** @type {Array<{ name: string, projectId: string }>} */
  let targets;

  if (envsRaw.includes(':')) {
    targets = parseProjectEnvs(envsRaw).map((e) => ({
      name: e.name,
      projectId: e.projectId,
    }));
  } else if (mapRaw) {
    /** @type {Record<string, string>} */
    const map = {};
    for (const part of mapRaw.split(',')) {
      const [k, v] = part.split(':').map((s) => s?.trim());
      if (k && v) map[k] = v;
    }
    targets = envsRaw.split(',').map((name) => {
      const n = name.trim();
      const projectId = map[n];
      if (!projectId) {
        throw new Error(`No projectId for env "${n}" in --project-map`);
      }
      return { name: n, projectId };
    });
  } else {
    throw new Error(
      'Provide project ids via --envs name:projectId,... or --envs qual,cert --project-map qual:proj-q,cert:proj-c',
    );
  }

  return { emails, targets, create };
}

/**
 * Ensure emails exist in each target project's Auth.
 * @param {object} options
 * @param {typeof import('firebase-admin')} options.admin
 * @param {string[]} options.emails
 * @param {Array<{ name: string, projectId: string }>} options.targets
 * @param {boolean} [options.create]
 */
export async function syncUsersAcrossProjects({
  admin,
  emails,
  targets,
  create = true,
}) {
  /** @type {Array<{ env: string, projectId: string, email: string, uid: string, created: boolean }>} */
  const results = [];

  for (const target of targets) {
    const appName = `sync-${target.projectId}`;
    let app;
    try {
      app = admin.app(appName);
    } catch {
      app = admin.initializeApp({ projectId: target.projectId }, appName);
    }
    const auth = app.auth();

    for (const email of emails) {
      let user;
      let created = false;
      try {
        user = await auth.getUserByEmail(email);
      } catch (error) {
        if (!create || error?.code !== 'auth/user-not-found') {
          throw error;
        }
        user = await auth.createUser({ email, emailVerified: false, disabled: false });
        created = true;
      }
      results.push({
        env: target.name,
        projectId: target.projectId,
        email,
        uid: user.uid,
        created,
      });
    }
  }

  return results;
}
