import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AssetLibraryStore } from '../src/main/assetLibraryStore';
import type { AssetImportLimits } from '../src/main/assetImportPolicy';
import { ProjectStore } from '../src/main/projectStore';
import { ProjectStoreError } from '../src/main/projectStoreSupport';

const SMALL_LIMITS: AssetImportLimits = {
  maximumSelectedFileCount: 5,
  maximumFileBytes: 10,
  maximumRequestBytes: 10,
  maximumProjectBytes: 3
};

const REQUEST_LIMITS: AssetImportLimits = {
  maximumSelectedFileCount: 5,
  maximumFileBytes: 10,
  maximumRequestBytes: 3,
  maximumProjectBytes: 100
};

async function withTempDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'video-asset-transaction-'));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

class RejectingRegistrationStore extends ProjectStore {
  override async registerAssets(
    _input: Parameters<ProjectStore['registerAssets']>[0],
    _now?: Date
  ): Promise<readonly never[]> {
    throw new ProjectStoreError('Forced registration failure.');
  }
}

describe('asset import transaction', () => {
  it('given selected files beyond request quota, when batch import is rejected, then no assets directory is created', async () => {
    await withTempDirectory(async (directory) => {
      // Given
      const root = join(directory, 'projects');
      const firstPath = join(directory, 'first.mp4');
      const secondPath = join(directory, 'second.mp4');
      await writeFile(firstPath, Buffer.from([1, 2]));
      await writeFile(secondPath, Buffer.from([3, 4]));
      const projects = new ProjectStore(root);
      const project = await projects.create({ name: 'Request quota' });
      const assets = new AssetLibraryStore(root, projects, REQUEST_LIMITS);

      // When
      const imported = assets.importMany([
        { projectId: project.id, sourcePath: firstPath, displayName: 'First', kind: 'video', mimeType: 'video/mp4' },
        { projectId: project.id, sourcePath: secondPath, displayName: 'Second', kind: 'video', mimeType: 'video/mp4' }
      ]);

      // Then
      await expect(imported).rejects.toThrow('Selected media exceeds the 3 byte request limit.');
      expect((await projects.open(project.id))?.assets).toEqual([]);
      await expect(stat(join(root, project.id, 'assets'))).rejects.toThrow();
    });
  });

  it('given existing project bytes near quota, when another asset is imported, then no second asset or file is retained', async () => {
    await withTempDirectory(async (directory) => {
      // Given
      const root = join(directory, 'projects');
      const firstPath = join(directory, 'first.mp4');
      const secondPath = join(directory, 'second.mp4');
      await writeFile(firstPath, Buffer.from([1, 2]));
      await writeFile(secondPath, Buffer.from([3, 4]));
      const projects = new ProjectStore(root);
      const project = await projects.create({ name: 'Project quota' });
      const assets = new AssetLibraryStore(root, projects, SMALL_LIMITS);
      await assets.import({ projectId: project.id, sourcePath: firstPath, displayName: 'First', kind: 'video', mimeType: 'video/mp4' });

      // When / Then
      await expect(
        assets.import({ projectId: project.id, sourcePath: secondPath, displayName: 'Second', kind: 'video', mimeType: 'video/mp4' })
      ).rejects.toThrow('The project asset library would exceed the 3 byte limit.');
      expect((await projects.open(project.id))?.assets).toHaveLength(1);
      expect(await readdir(join(root, project.id, 'assets'))).toHaveLength(1);
    });
  });

  it('given successful copies followed by registration failure, when a batch import aborts, then every staged directory is removed', async () => {
    await withTempDirectory(async (directory) => {
      // Given
      const root = join(directory, 'projects');
      const firstPath = join(directory, 'first.mp4');
      const secondPath = join(directory, 'second.mp4');
      await writeFile(firstPath, Buffer.from([1]));
      await writeFile(secondPath, Buffer.from([2]));
      const projects = new RejectingRegistrationStore(root);
      const project = await projects.create({ name: 'Registration rollback' });
      const assets = new AssetLibraryStore(root, projects);

      // When
      const imported = assets.importMany([
        { projectId: project.id, sourcePath: firstPath, displayName: 'First', kind: 'video', mimeType: 'video/mp4' },
        { projectId: project.id, sourcePath: secondPath, displayName: 'Second', kind: 'video', mimeType: 'video/mp4' }
      ]);

      // Then
      await expect(imported).rejects.toThrow('Forced registration failure.');
      expect((await projects.open(project.id))?.assets).toEqual([]);
      await expect(stat(join(root, project.id, 'assets'))).rejects.toThrow();
    });
  });
});
