import { constants } from 'node:fs';
import { chmod, mkdtemp, open, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { LocalProjectSnapshot } from '../shared/timelineTypes';
import type { OpenedAssetPlaybackSource } from './assetLibraryStore';
import { isInsideDirectory, isOpaqueId } from './projectStoreSupport';

type AssetOpener = {
  openPlaybackSource(projectId: string, assetId: string): Promise<OpenedAssetPlaybackSource | null>;
};

export type StageExportAssetsInput = {
  readonly assets: AssetOpener;
  readonly project: LocalProjectSnapshot;
  readonly exportsRoot: string;
  readonly jobId: string;
};

export type StagedExportAssets = {
  readonly assetPaths: ReadonlyMap<string, string>;
  readonly directory: string;
};

export class ExportAssetStagingError extends Error {
  override readonly name = 'ExportAssetStagingError';
}

async function copyOpenedAsset(source: OpenedAssetPlaybackSource, destinationPath: string): Promise<void> {
  const destination = await open(
    destinationPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600
  );
  try {
    const sourceBefore = await source.file.stat();
    const buffer = Buffer.allocUnsafe(64 * 1_024);
    let position = 0;
    while (position < source.byteLength) {
      const { bytesRead } = await source.file.read(buffer, 0, Math.min(buffer.length, source.byteLength - position), position);
      if (bytesRead === 0) {
        break;
      }
      let written = 0;
      while (written < bytesRead) {
        const result = await destination.write(buffer, written, bytesRead - written, position + written);
        written += result.bytesWritten;
      }
      position += bytesRead;
    }
    await destination.sync();
    const [sourceAfter, destinationStats] = await Promise.all([source.file.stat(), destination.stat()]);
    if (
      !sourceBefore.isFile() ||
      sourceBefore.dev !== sourceAfter.dev ||
      sourceBefore.ino !== sourceAfter.ino ||
      sourceBefore.size !== sourceAfter.size ||
      sourceAfter.size !== source.byteLength ||
      !destinationStats.isFile() ||
      destinationStats.size !== source.byteLength
    ) {
      throw new ExportAssetStagingError('A timeline asset changed while it was staged for export.');
    }
  } finally {
    await destination.close();
  }
}

export async function stageExportAssets(input: StageExportAssetsInput): Promise<StagedExportAssets> {
  const rootRealPath = await realpath(input.exportsRoot);
  const directory = await mkdtemp(join(rootRealPath, `.stage-${input.jobId}-`));
  await chmod(directory, 0o700);
  if (!isInsideDirectory(rootRealPath, directory)) {
    await rm(directory, { recursive: true, force: true });
    throw new ExportAssetStagingError('Export staging path escaped its configured root.');
  }
  const assetPaths = new Map<string, string>();
  const assetIds = new Set(input.project.timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.assetId)));
  try {
    for (const assetId of assetIds) {
      if (!isOpaqueId(assetId)) {
        throw new ExportAssetStagingError('Timeline asset ID was not safe for staging.');
      }
      const source = await input.assets.openPlaybackSource(input.project.id, assetId);
      if (source === null) {
        throw new ExportAssetStagingError(`Timeline asset ${assetId} is unavailable.`);
      }
      const destinationPath = join(directory, assetId);
      try {
        await copyOpenedAsset(source, destinationPath);
      } finally {
        await source.file.close();
      }
      assetPaths.set(assetId, destinationPath);
    }
    return { assetPaths, directory };
  } catch (error: unknown) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function removeExportStaging(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}
