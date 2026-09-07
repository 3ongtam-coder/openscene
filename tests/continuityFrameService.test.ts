import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { AssetLibraryStore } from '../src/main/assetLibraryStore';
import { ContinuityFrameService } from '../src/main/continuityFrameService';
import { discoverFfmpeg } from '../src/main/ffmpegDiscovery';
import { ProjectStore } from '../src/main/projectStore';

const execFileAsync = promisify(execFile);

async function withTempDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'continuity-frame-service-'));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
  }
}

async function createFixture(directory: string, withMetadata = true) {
  const root = join(directory, 'projects');
  const projects = new ProjectStore(root);
  const assets = new AssetLibraryStore(root, projects);
  const project = await projects.create({ name: 'Continuity chain' });
  const sourcePath = join(directory, 'source.mp4');
  await writeFile(sourcePath, Buffer.from([1, 2, 3, 4]));
  const imported = await assets.import({
    projectId: project.id,
    sourcePath,
    displayName: 'Approved take.mp4',
    kind: 'video',
    mimeType: 'video/mp4'
  });
  const video = withMetadata
    ? await assets.updateMetadata({ projectId: project.id, assetId: imported.id, durationMs: 8_000, width: 1280, height: 720 })
    : imported;
  return { projects, assets, project, video };
}

describe('continuity frame service', () => {
  const jpegFrame = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
  it('extracts a decodable JPEG from a real video through the discovered FFmpeg binary', async () => {
    await withTempDirectory(async (directory) => {
      const runtime = await discoverFfmpeg();
      if (runtime.kind === 'unavailable') throw new Error(runtime.reason);
      const root = join(directory, 'real-projects');
      const projects = new ProjectStore(root);
      const assets = new AssetLibraryStore(root, projects);
      const project = await projects.create({ name: 'Real continuity frame' });
      const sourcePath = join(directory, 'real-source.mp4');
      await execFileAsync(runtime.executablePath, [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x336699:s=64x48:r=24:d=1',
        '-c:v', 'mpeg4', '-y', sourcePath
      ]);
      const imported = await assets.import({
        projectId: project.id, sourcePath, displayName: 'Real source.mp4', kind: 'video', mimeType: 'video/mp4'
      });
      const video = await assets.updateMetadata({ projectId: project.id, assetId: imported.id, durationMs: 1_000, width: 64, height: 48 });

      const response = await new ContinuityFrameService({ projects, assets, temporaryRoot: directory }).extract({
        projectId: project.id,
        assetId: video.id
      });

      expect(response.ok).toBe(true);
      if (response.ok) {
        const jpeg = Buffer.from(response.value.reference.base64, 'base64');
        expect(jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
        expect(response.value.asset.byteLength).toBeGreaterThan(100);
      }
    });
  }, 20_000);

  it('stages a confined video, extracts near its end, imports a JPEG, and can reload it without exposing a path', async () => {
    await withTempDirectory(async (directory) => {
      const fixture = await createFixture(directory);
      let stagedSourcePath = '';
      const service = new ContinuityFrameService({
        ...fixture,
        temporaryRoot: directory,
        discoverFfmpeg: async () => ({ kind: 'system', executablePath: 'ffmpeg' }),
        runExtraction: async (input) => {
          stagedSourcePath = input.sourcePath;
          expect(input.sourceTimeMs).toBe(7_900);
          expect(await readFile(input.sourcePath)).toEqual(Buffer.from([1, 2, 3, 4]));
          await writeFile(input.outputPath, jpegFrame);
        }
      });

      const response = await service.extract({ projectId: fixture.project.id, assetId: fixture.video.id });

      expect(response.ok).toBe(true);
      if (!response.ok) return;
      expect(stagedSourcePath).not.toBe(join(directory, 'source.mp4'));
      expect(response.value).toMatchObject({
        sourceTimeMs: 7_900,
        asset: {
          displayName: 'Approved take - continuity frame.jpg',
          kind: 'image',
          mimeType: 'image/jpeg',
          metadata: { durationMs: 0, width: 1280, height: 720 }
        },
        reference: { mimeType: 'image/jpeg', base64: jpegFrame.toString('base64') }
      });
      expect(JSON.stringify(response.value)).not.toContain(directory);

      const reopened = await fixture.projects.open(fixture.project.id);
      expect(reopened?.assets.map((asset) => asset.kind)).toEqual(['video', 'image']);
      const restored = await service.getReference({ projectId: fixture.project.id, assetId: response.value.asset.id });
      expect(restored).toEqual({
        ok: true,
        value: {
          displayName: 'Approved take - continuity frame.jpg',
          mimeType: 'image/jpeg',
          base64: jpegFrame.toString('base64')
        }
      });
    });
  });

  it('refuses an unprobed video before opening media or invoking FFmpeg', async () => {
    await withTempDirectory(async (directory) => {
      const fixture = await createFixture(directory, false);
      let invoked = false;
      const service = new ContinuityFrameService({
        ...fixture,
        temporaryRoot: directory,
        discoverFfmpeg: async () => { invoked = true; return { kind: 'system', executablePath: 'ffmpeg' }; },
        runExtraction: async () => { invoked = true; }
      });

      const response = await service.extract({ projectId: fixture.project.id, assetId: fixture.video.id });
      expect(response).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
      expect(invoked).toBe(false);
      expect((await fixture.projects.open(fixture.project.id))?.assets).toHaveLength(1);
    });
  });

  it('returns a terminal timeout failure without importing a partial frame', async () => {
    await withTempDirectory(async (directory) => {
      const fixture = await createFixture(directory);
      const service = new ContinuityFrameService({
        ...fixture,
        temporaryRoot: directory,
        discoverFfmpeg: async () => ({ kind: 'system', executablePath: 'ffmpeg' }),
        runExtraction: async () => { throw new Error('Continuity-frame extraction timed out.'); }
      });

      const response = await service.extract({ projectId: fixture.project.id, assetId: fixture.video.id });
      expect(response).toEqual({
        ok: false,
        error: { code: 'FILE_WRITE_FAILED', message: 'Continuity-frame extraction timed out.' }
      });
      expect((await fixture.projects.open(fixture.project.id))?.assets).toHaveLength(1);
    });
  });

  it('rejects malformed project-scoped input without touching storage', async () => {
    await withTempDirectory(async (directory) => {
      const fixture = await createFixture(directory);
      const service = new ContinuityFrameService({ ...fixture, temporaryRoot: directory });
      expect(await service.extract({ projectId: '../outside', assetId: fixture.video.id })).toMatchObject({
        ok: false,
        error: { code: 'INVALID_INPUT' }
      });
      expect(await service.getReference({ projectId: fixture.project.id, assetId: '../outside' })).toMatchObject({
        ok: false,
        error: { code: 'INVALID_INPUT' }
      });
    });
  });
});
