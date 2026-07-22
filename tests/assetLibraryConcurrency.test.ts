import { mkdtemp, open, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AssetLibraryStore } from '../src/main/assetLibraryStore';
import { ProjectStore } from '../src/main/projectStore';
import { DEFAULT_CLIP_EFFECTS } from '../src/shared/timelineTypes';

async function withTempDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'video-asset-concurrency-'));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('asset library concurrency', () => {
  it('given concurrent timeline and metadata updates, when both complete, then neither snapshot mutation is lost', async () => {
    await withTempDirectory(async (directory) => {
      // Given
      const root = join(directory, 'projects');
      const sourcePath = join(directory, 'take.webm');
      await writeFile(sourcePath, Buffer.from([1, 2, 3]));
      const projects = new ProjectStore(root);
      const project = await projects.create({ name: 'Concurrent update' });
      const assets = new AssetLibraryStore(root, projects);
      const asset = await assets.import({
        projectId: project.id,
        sourcePath,
        displayName: 'Take',
        kind: 'video',
        mimeType: 'video/webm'
      });
      await assets.updateMetadata({ projectId: project.id, assetId: asset.id, durationMs: 1_000 });
      const timeline = {
        schemaVersion: 3 as const,
        tracks: [
          {
            id: 'video-track-1',
            name: 'Video 1',
            kind: 'video' as const,
            clips: [
              {
                id: 'clip-1',
                assetId: asset.id,
                timelineStartMs: 0,
                sourceStartMs: 0,
                sourceEndMs: 1_000,
                sourceDurationMs: 1_000,
                effects: DEFAULT_CLIP_EFFECTS,
                keyframes: []
              }
            ]
          }
        ],
        transitions: []
      };

      // When
      await Promise.all([
        projects.saveTimeline(project.id, timeline, new Date('2026-07-20T10:01:00.000Z')),
        assets.updateMetadata(
          { projectId: project.id, assetId: asset.id, durationMs: 1_000, width: 1_920, height: 1_080 },
          new Date('2026-07-20T10:02:00.000Z')
        )
      ]);
      const reopened = await new ProjectStore(root).open(project.id);

      // Then
      expect(reopened?.timeline).toEqual(timeline);
      expect(reopened?.assets[0]?.metadata).toEqual({ durationMs: 1_000, width: 1_920, height: 1_080 });
    });
  });

  it('given a same-size source mutation during import, when copy verification runs, then the unstable asset is rejected', async () => {
    await withTempDirectory(async (directory) => {
      // Given
      const root = join(directory, 'projects');
      const sourcePath = join(directory, 'changing.webm');
      await writeFile(sourcePath, Buffer.alloc(32 * 1_024 * 1_024));
      const projects = new ProjectStore(root);
      const project = await projects.create({ name: 'Changing source' });
      const assets = new AssetLibraryStore(root, projects);
      const source = await open(sourcePath, 'r+');

      // When
      const importPromise = assets.import({
        projectId: project.id,
        sourcePath,
        displayName: 'Changing take',
        kind: 'video',
        mimeType: 'video/webm'
      });
      const mutationPromise = (async (): Promise<void> => {
        const byte = Buffer.alloc(1);
        for (let index = 0; index < 1_000; index += 1) {
          byte[0] = index % 255;
          await source.write(byte, 0, 1, index % 1_024);
          await new Promise<void>((resolveTurn) => setImmediate(resolveTurn));
        }
      })();

      // Then
      await expect(importPromise).rejects.toThrow('Asset source or destination changed while it was being copied.');
      await mutationPromise;
      await source.close();
      expect((await projects.open(project.id))?.assets).toEqual([]);
      await expect(stat(join(root, project.id, 'assets'))).rejects.toThrow();
    });
  });
});
