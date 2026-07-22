import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, realpath, rm } from 'node:fs/promises';
import { basename, isAbsolute, resolve } from 'node:path';

import { isInsideDirectory, isOpaqueId } from './projectStoreSupport';

export class ExportOutputError extends Error {
  override readonly name = 'ExportOutputError';
}

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function secureRootPath(rootDirectory: string): Promise<string> {
  const before = await lstat(rootDirectory);
  if (before.isSymbolicLink() || !before.isDirectory()) {
    throw new ExportOutputError('Configured export root must be a real directory.');
  }
  const rootRealPath = await realpath(rootDirectory);
  const after = await lstat(rootDirectory);
  if (after.isSymbolicLink() || !after.isDirectory() || after.dev !== before.dev || after.ino !== before.ino) {
    throw new ExportOutputError('Configured export root changed during access.');
  }
  return rootRealPath;
}

export async function prepareExportOutputPath(rootDirectory: string, jobId: string): Promise<string> {
  if (!isAbsolute(rootDirectory) || !isOpaqueId(jobId)) {
    throw new ExportOutputError('Export output configuration was not safe.');
  }
  await mkdir(rootDirectory, { recursive: true, mode: 0o700 });
  const rootRealPath = await secureRootPath(rootDirectory);
  await chmod(rootDirectory, 0o700);
  const outputPath = resolve(rootRealPath, `${jobId}.mp4`);
  if (!isInsideDirectory(rootRealPath, outputPath)) {
    throw new ExportOutputError('Export output path escaped its configured root.');
  }
  try {
    await lstat(outputPath);
    throw new ExportOutputError('Export output path already exists.');
  } catch (error: unknown) {
    if (!isMissingPath(error)) {
      throw error;
    }
  }
  return outputPath;
}

export async function validateExportOutput(rootDirectory: string, outputPath: string): Promise<{ readonly fileName: string; readonly fileSizeBytes: number }> {
  const rootRealPath = await secureRootPath(rootDirectory);
  const file = await open(outputPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const [outputRealPath, outputStats, pathStats] = await Promise.all([
      realpath(outputPath),
      file.stat(),
      lstat(outputPath)
    ]);
    if (
      !isInsideDirectory(rootRealPath, outputRealPath) ||
      pathStats.isSymbolicLink() ||
      !pathStats.isFile() ||
      !outputStats.isFile() ||
      pathStats.dev !== outputStats.dev ||
      pathStats.ino !== outputStats.ino ||
      outputStats.size <= 0
    ) {
      throw new ExportOutputError('FFmpeg did not create a valid contained MP4 output.');
    }
    return { fileName: basename(outputPath), fileSizeBytes: outputStats.size };
  } finally {
    await file.close();
  }
}

export async function removeExportOutput(outputPath: string): Promise<void> {
  await rm(outputPath, { force: true });
}
