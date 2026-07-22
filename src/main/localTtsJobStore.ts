import { randomUUID } from 'node:crypto';

import type { LocalTtsJob, LocalTtsRuntimeStatus, StartTtsJobInput, TtsJobState } from '../shared/models';
import type { LocalTtsConfigLoadResult } from './localTtsConfig';

type LocalTtsJobStoreDependencies = {
  readonly createId?: () => string;
  readonly now?: () => Date;
};

type JobTransition = 'running' | 'completed' | 'failed';

export class LocalTtsJobStoreError extends Error {
  override readonly name = 'LocalTtsJobStoreError';
}

function assertNever(value: never): never {
  throw new LocalTtsJobStoreError(`Unexpected local TTS variant: ${JSON.stringify(value)}`);
}

function canTransition(state: TtsJobState, transition: JobTransition): boolean {
  switch (state.kind) {
    case 'queued':
      return transition === 'running' || transition === 'failed';
    case 'running':
      return transition === 'completed' || transition === 'failed';
    case 'completed':
    case 'failed':
      return false;
    default:
      return assertNever(state);
  }
}

export class LocalTtsJobStore {
  private readonly jobs = new Map<string, LocalTtsJob>();
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(dependencies: LocalTtsJobStoreDependencies = {}) {
    this.createId = dependencies.createId ?? randomUUID;
    this.now = dependencies.now ?? (() => new Date());
  }

  create(input: StartTtsJobInput, configuredModelId: string): LocalTtsJob {
    const now = this.now().toISOString();
    const id = this.createId();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) {
      throw new LocalTtsJobStoreError('Generated local TTS job ID was not safe.');
    }
    const job: LocalTtsJob = {
      id,
      provider: 'local_qwen',
      voiceProfileId: input.voiceProfileId,
      script: input.script,
      language: input.language,
      mimeType: input.mimeType,
      modelId: input.modelId ?? configuredModelId,
      state: { kind: 'queued', queuedAt: now },
      createdAt: now,
      updatedAt: now
    };
    this.jobs.set(id, job);
    return job;
  }

  get(jobId: string): LocalTtsJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  markRunning(jobId: string): LocalTtsJob {
    const job = this.requireTransition(jobId, 'running');
    return this.replace(job, { kind: 'running', startedAt: this.now().toISOString() });
  }

  markCompleted(jobId: string, outputAssetId: string): LocalTtsJob {
    const job = this.requireTransition(jobId, 'completed');
    return this.replace(job, {
      kind: 'completed',
      completedAt: this.now().toISOString(),
      outputAssetId
    });
  }

  markFailed(jobId: string, reason: string): LocalTtsJob {
    const job = this.requireTransition(jobId, 'failed');
    return this.replace(job, {
      kind: 'failed',
      failedAt: this.now().toISOString(),
      reason
    });
  }

  getRuntimeStatus(configuration: LocalTtsConfigLoadResult, language: string): LocalTtsRuntimeStatus {
    switch (configuration.kind) {
      case 'unavailable':
        return { kind: 'unavailable', provider: 'local_qwen', reason: configuration.reason };
      case 'configured': {
        let queuedJobs = 0;
        let runningJobs = 0;
        for (const job of this.jobs.values()) {
          switch (job.state.kind) {
            case 'queued':
              queuedJobs += 1;
              break;
            case 'running':
              runningJobs += 1;
              break;
            case 'completed':
            case 'failed':
              break;
            default:
              assertNever(job.state);
          }
        }
        if (runningJobs > 0) {
          return {
            kind: 'busy',
            provider: 'local_qwen',
            modelId: configuration.config.modelId,
            queuedJobs
          };
        }
        return {
          kind: 'ready',
          provider: 'local_qwen',
          modelId: configuration.config.modelId,
          language,
          queuedJobs
        };
      }
      default:
        return assertNever(configuration);
    }
  }

  private requireTransition(jobId: string, transition: JobTransition): LocalTtsJob {
    const job = this.jobs.get(jobId);
    if (job === undefined) {
      throw new LocalTtsJobStoreError('Local TTS job was not found.');
    }
    if (!canTransition(job.state, transition)) {
      throw new LocalTtsJobStoreError(`Local TTS job in state "${job.state.kind}" cannot transition to "${transition}".`);
    }
    return job;
  }

  private replace(job: LocalTtsJob, state: TtsJobState): LocalTtsJob {
    const updated: LocalTtsJob = {
      ...job,
      state,
      updatedAt: this.now().toISOString()
    };
    this.jobs.set(job.id, updated);
    return updated;
  }
}
