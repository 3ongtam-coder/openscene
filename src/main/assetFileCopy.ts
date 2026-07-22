import { createHash, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { isInsideDirectory, ProjectStoreError } from './projectStoreSupport';

type CopyAssetFileInput = {
  readonly sourcePath: string;
  readonly destinationDirectory: string;
  readonly destinationPath: string;
  readonly maximumBytes: number;
};

function isSameFileVersion(
  before: Awaited<ReturnType<FileHandle['stat']>>,
  after: Awaited<ReturnType<FileHandle['stat']>>
): boolean {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs
  );
}

export async function copyAssetFile(input: CopyAssetFileInput): Promise<number> {
  const directoryStats = await lstat(input.destinationDirectory);
  const directoryRealPath = await realpath(input.destinationDirectory);
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
    throw new ProjectStoreError('Asset destination must be an app-owned directory.');
  }
  const source = await open(input.sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let destination: FileHandle | undefined;
  let verificationSource: FileHandle | undefined;
  let verificationDestination: FileHandle | undefined;
  try {
    const beforeCopy = await source.stat();
    if (!beforeCopy.isFile()) {
      throw new ProjectStoreError('Asset source must be a regular file.');
    }
    if (beforeCopy.size > input.maximumBytes) {
      throw new ProjectStoreError(`Asset source exceeds the ${input.maximumBytes} byte limit.`);
    }
    destination = await open(
      input.destinationPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );
    const copiedHash = createHash('sha256');
    const hashingStream = new PassThrough();
    hashingStream.on('data', (chunk: Buffer) => copiedHash.update(chunk));
    await pipeline(
      source.createReadStream(),
      hashingStream,
      destination.createWriteStream()
    );
    verificationSource = await open(input.sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    verificationDestination = await open(input.destinationPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    await verificationDestination.sync();
    const [sourceAfterCopy, copiedStats, destinationRealPath, directoryAfterCopy] = await Promise.all([
      verificationSource.stat(),
      verificationDestination.stat(),
      realpath(input.destinationPath),
      lstat(input.destinationDirectory)
    ]);
    const finalSourceHash = createHash('sha256');
    await pipeline(verificationSource.createReadStream(), finalSourceHash);
    const [sourceAfterHash, destinationAfterHash] = await Promise.all([
      lstat(input.sourcePath),
      lstat(input.destinationPath)
    ]);
    const destinationStayedInside = isInsideDirectory(directoryRealPath, destinationRealPath);
    const directoryStayedStable =
      !directoryAfterCopy.isSymbolicLink() &&
      directoryAfterCopy.isDirectory() &&
      directoryAfterCopy.dev === directoryStats.dev &&
      directoryAfterCopy.ino === directoryStats.ino;
    if (
      !copiedStats.isFile() ||
      copiedStats.size > input.maximumBytes ||
      copiedStats.size !== beforeCopy.size ||
      !isSameFileVersion(beforeCopy, sourceAfterCopy) ||
      !isSameFileVersion(beforeCopy, sourceAfterHash) ||
      !isSameFileVersion(copiedStats, destinationAfterHash) ||
      !timingSafeEqual(copiedHash.digest(), finalSourceHash.digest()) ||
      !destinationStayedInside ||
      !directoryStayedStable
    ) {
      throw new ProjectStoreError('Asset source or destination changed while it was being copied.');
    }
    return copiedStats.size;
  } finally {
    await verificationDestination?.close();
    await verificationSource?.close();
    await destination?.close();
    await source.close();
  }
}
