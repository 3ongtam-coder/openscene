import { randomUUID } from 'node:crypto';

import type { ApiResponse } from '../shared/models';
import type { ImportProjectAssetsResult, ImportRecordingResultAssetInput, ImportTtsResultAssetInput, MediaKind } from '../shared/timelineTypes';
import { parseImportRecordingResultAssetInput, parseImportTtsResultAssetInput } from '../shared/timelineValidators';
import { AssetImportValidationError } from './assetImportPolicy';
import type { AssetLibraryStore } from './assetLibraryStore';
import { fail, ok } from './ipcResponses';
import { ProjectStoreError } from './projectStoreSupport';

export type CompletedResultAssetSource = {
  readonly sourcePath: string;
  readonly displayName: string;
  readonly kind: MediaKind;
  readonly mimeType: string;
};

export type ResultAssetImportDependencies = {
  readonly assets: AssetLibraryStore;
  readonly resolveRecordingSource: (sessionId: string) => CompletedResultAssetSource | null;
  /** Completed cloud voice/video generation jobs. */
  readonly resolveAiSource: (jobId: string) => CompletedResultAssetSource | null;
};

function inputFromSource(projectId: string, source: CompletedResultAssetSource) {
  return {
    projectId,
    sourcePath: source.sourcePath,
    displayName: source.displayName,
    kind: source.kind,
    mimeType: source.mimeType
  };
}

function importErrorDetails(error: unknown): Readonly<Record<string, unknown>> {
  if (!(error instanceof Error)) return { error: 'Unknown import failure.' };
  const systemError = error as Error & { code?: unknown; syscall?: unknown; errno?: unknown; path?: unknown; dest?: unknown };
  const containsFilePath = typeof systemError.path === 'string' || typeof systemError.dest === 'string';
  return {
    error: containsFilePath
      ? `${typeof systemError.code === 'string' ? systemError.code : error.name}: ${typeof systemError.syscall === 'string' ? systemError.syscall : 'filesystem operation'}`
      : error.message,
    errorName: error.name,
    ...(typeof systemError.code === 'string' ? { code: systemError.code } : {}),
    ...(typeof systemError.syscall === 'string' ? { syscall: systemError.syscall } : {}),
    ...(typeof systemError.errno === 'number' ? { errno: systemError.errno } : {})
  };
}

export class ResultAssetImportService {
  constructor(private readonly dependencies: ResultAssetImportDependencies) {}

  async importRecordingResult(payload: unknown): Promise<ApiResponse<ImportProjectAssetsResult>> {
    const input = parseImportRecordingResultAssetInput(payload);
    if (input === null) {
      return fail('INVALID_INPUT', 'The recording result import payload was not valid.');
    }
    const source = this.dependencies.resolveRecordingSource(input.sessionId);
    if (source === null) {
      return fail('SESSION_NOT_FOUND', 'The completed recording result is not available.');
    }
    return this.importResult(input, source, 'recording', 'The completed recording result could not be imported.');
  }

  async importAiResult(payload: unknown): Promise<ApiResponse<ImportProjectAssetsResult>> {
    const input = parseImportTtsResultAssetInput(payload);
    if (input === null) {
      return fail('INVALID_INPUT', 'The AI result import payload was not valid.');
    }
    const source = this.dependencies.resolveAiSource(input.jobId);
    if (source === null) {
      return fail('TTS_RESULT_UNAVAILABLE', 'The completed AI generation result is not available.');
    }
    return this.importResult(input, source, 'ai-generation', 'The completed AI generation result could not be imported.');
  }

  private async importResult(
    input: ImportRecordingResultAssetInput | ImportTtsResultAssetInput,
    source: CompletedResultAssetSource,
    resultKind: 'recording' | 'ai-generation',
    failureMessage: string
  ): Promise<ApiResponse<ImportProjectAssetsResult>> {
    const requestId = randomUUID().slice(0, 8);
    const startedAt = Date.now();
    console.info(`[OpenScene][Result Import][${requestId}] request.start ${JSON.stringify({ resultKind, projectId: input.projectId, mediaKind: source.kind, mimeType: source.mimeType })}`);
    try {
      const assets = await this.dependencies.assets.importMany([inputFromSource(input.projectId, source)]);
      console.info(`[OpenScene][Result Import][${requestId}] request.completed ${JSON.stringify({ elapsedMs: Date.now() - startedAt, assets: assets.length })}`);
      return ok({ assets });
    } catch (error: unknown) {
      console.error(`[OpenScene][Result Import][${requestId}] request.failed ${JSON.stringify({ elapsedMs: Date.now() - startedAt, ...importErrorDetails(error) })}`);
      if (error instanceof ProjectStoreError && error.message.startsWith('Project ')) {
        return fail('PROJECT_NOT_FOUND', error.message);
      }
      if (error instanceof AssetImportValidationError) {
        return fail('INVALID_INPUT', error.message);
      }
      return fail('FILE_WRITE_FAILED', failureMessage);
    }
  }
}
