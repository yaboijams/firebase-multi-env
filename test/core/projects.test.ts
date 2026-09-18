import { afterEach, describe, expect, it } from 'vitest';
import { createEnvRuntime } from '../../src/core/runtime.js';
import { authContext } from '../helpers.js';

const projectsConfig = {
  isolationMode: 'projects' as const,
  pinned: true,
  pinnedEnvironment: 'qual' as const,
  environments: {
    production: {
      projectId: 'app-prod',
      origins: ['https://app-prod.web.app'],
    },
    qual: {
      projectId: 'app-qual',
      origins: ['https://app-qual.web.app'],
    },
  },
};

describe('projects isolation mode', () => {
  afterEach(() => {
    delete process.env.GCLOUD_PROJECT;
    delete process.env.GCP_PROJECT;
    delete process.env.K_SERVICE;
  });

  it('resolves pinned project env and sets projectId on RuntimeEnv', () => {
    process.env.GCLOUD_PROJECT = 'app-qual';
    const runtime = createEnvRuntime(projectsConfig);
    const env = runtime.resolveRequestEnv(undefined, authContext({
      origin: 'https://app-qual.web.app',
      uid: 'user-1',
    }));

    expect(env).toEqual({
      appEnv: 'qual',
      firestoreDatabaseId: '(default)',
      firestoreEnvTag: 'qual',
      projectId: 'app-qual',
    });
  });

  it('refuses resolve when process project does not match env projectId', () => {
    process.env.GCLOUD_PROJECT = 'app-prod';
    const runtime = createEnvRuntime({
      ...projectsConfig,
      // avoid cloud assert at normalize — not setting K_SERVICE
    });

    try {
      runtime.resolveRequestEnv(undefined, authContext({
        origin: 'https://app-qual.web.app',
        uid: 'user-1',
      }));
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        code: 'failed-precondition',
        message: expect.stringContaining('app-qual'),
      });
    }
  });
});
