import { constants } from 'node:fs';
import { lstat, open, realpath, rename, rm, type FileHandle } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { LocalProjectSnapshot } from '../shared/timelineTypes';
import { TIMELINE_VALIDATION_LIMITS, getRelativePath } from '../shared/timelineValidationPrimitives';
import { PROJECT_ASSETS_DIRECTORY } from './assetLibrarySupport';
import { parsePersistedProjectForRead } from './projectSnapshotCodec';

export const PROJECT_FILE_NAME = 'project.json';
export { PROJECT_ASSETS_DIRECTORY };

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export class ProjectStoreError extends Error {
  override readonly name = 'ProjectStoreError';
}

export function isOpaqueId(value: string): boolean {
  return value.length <= TIMELINE_VALIDATION_LIMITS.opaqueIdLength && OPAQUE_ID_PATTERN.test(value);
}

export function assertOpaqueId(value: string, label: string): void {
  if (!isOpaqueId(value)) {
    throw new ProjectStoreError(`Invalid ${label}.`);
  }
}

export function isInsideDirectory(parentDirectory: string, childPath: string): boolean {
  const childRelativePath = relative(resolve(parentDirectory), resolve(childPath));
  return (
    childRelativePath === '' ||
    (childRelativePath !== '..' && !childRelativePath.startsWith(`..${sep}`) && !isAbsolute(childRelativePath))
  );
}

export function projectDirectory(rootDirectory: string, projectId: string): string {
  assertOpaqueId(projectId, 'project id');
  const directory = resolve(rootDirectory, projectId);
  if (!isInsideDirectory(rootDirectory, directory)) {
    throw new ProjectStoreError('Resolved project path escaped the configured root directory.');
  }
  return directory;
}

export function projectAssetPath(rootDirectory: string, projectId: string, projectRelativePath: string): string {
  const parsedPath = getRelativePath({ path: projectRelativePath }, 'path');
  if (parsedPath === null) {
    throw new ProjectStoreError('Invalid project-relative asset path.');
  }
  const directory = projectDirectory(rootDirectory, projectId);
  const assetPath = resolve(directory, parsedPath);
  if (!isInsideDirectory(directory, assetPath)) {
    throw new ProjectStoreError('Resolved asset path escaped its project directory.');
  }
  return assetPath;
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ELOOP');
}

type DirectoryIdentity = {
  readonly device: number;
  readonly inode: number;
  readonly realPath: string;
};

async function getDirectoryIdentity(rootDirectory: string, directory: string): Promise<DirectoryIdentity | null> {
  const [stats, rootRealPath, directoryRealPath] = await Promise.all([
    lstat(directory),
    realpath(rootDirectory),
    realpath(directory)
  ]);
  if (stats.isSymbolicLink() || !stats.isDirectory() || !isInsideDirectory(rootRealPath, directoryRealPath)) {
    return null;
  }
  return { device: stats.dev, inode: stats.ino, realPath: directoryRealPath };
}

async function directoryMatches(directory: string, identity: DirectoryIdentity): Promise<boolean> {
  const stats = await lstat(directory);
  return !stats.isSymbolicLink() && stats.isDirectory() && stats.dev === identity.device && stats.ino === identity.inode;
}

export async function readProjectSnapshot(rootDirectory: string, projectId: string): Promise<LocalProjectSnapshot | null> {
  const directory = projectDirectory(rootDirectory, projectId);
  const projectFile = join(directory, PROJECT_FILE_NAME);
  try {
    const identity = await getDirectoryIdentity(rootDirectory, directory);
    if (identity === null) {
      return null;
    }
    const file = await open(projectFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const fileStats = await file.stat();
      if (!fileStats.isFile() || !(await directoryMatches(directory, identity))) {
        return null;
      }
      const raw: unknown = JSON.parse(await file.readFile('utf8'));
      return parsePersistedProjectForRead(raw, projectId);
    } finally {
      await file.close();
    }
  } catch (error) {
    if (isMissingPathError(error) || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

export async function writeProjectSnapshot(rootDirectory: string, snapshot: LocalProjectSnapshot): Promise<void> {
  const directory = projectDirectory(rootDirectory, snapshot.id);
  const projectFile = join(directory, PROJECT_FILE_NAME);
  const temporaryFile = join(directory, `.${PROJECT_FILE_NAME}.${randomUUID()}.tmp`);
  const identity = await getDirectoryIdentity(rootDirectory, directory);
  if (identity === null || !isInsideDirectory(directory, temporaryFile)) {
    throw new ProjectStoreError('Resolved temporary project path escaped its project directory.');
  }
  let temporaryFileHandle: FileHandle | undefined;
  try {
    temporaryFileHandle = await open(
      temporaryFile,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );
    await temporaryFileHandle.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    await temporaryFileHandle.sync();
    const [temporaryStats, temporaryRealPath, parentMatches] = await Promise.all([
      temporaryFileHandle.stat(),
      realpath(temporaryFile),
      directoryMatches(directory, identity)
    ]);
    if (!temporaryStats.isFile() || !isInsideDirectory(identity.realPath, temporaryRealPath) || !parentMatches) {
      throw new ProjectStoreError('Project directory changed while its snapshot was being written.');
    }
    await temporaryFileHandle.close();
    temporaryFileHandle = undefined;
    const pathStats = await lstat(temporaryFile);
    if (
      pathStats.isSymbolicLink() ||
      pathStats.dev !== temporaryStats.dev ||
      pathStats.ino !== temporaryStats.ino ||
      !(await directoryMatches(directory, identity))
    ) {
      throw new ProjectStoreError('Project snapshot changed before it could be published.');
    }
    await rename(temporaryFile, projectFile);
  } catch (error) {
    await temporaryFileHandle?.close();
    await rm(temporaryFile, { force: true });
    throw error;
  }
}
