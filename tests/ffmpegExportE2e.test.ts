import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { discoverFfmpeg } from '../src/main/ffmpegDiscovery';
import { startFfmpegExportProcess } from '../src/main/ffmpegExportProcess';
import { compileFfmpegTimeline } from '../src/main/ffmpegTimelineCompiler';
import { DEFAULT_AUDIO_TRACK_MIX, DEFAULT_CLIP_EFFECTS, TIMELINE_SCHEMA_VERSION } from '../src/shared/timelineTypes';
import type { TimelineDocument } from '../src/shared/timelineTypes';

const execFileAsync = promisify(execFile);

describe('FFmpeg export end to end', () => {
  it('renders a v3 timeline to a playable H.264/AAC MP4 through the discovered local binary', async () => {
    const discovery = await discoverFfmpeg();
    if (discovery.kind === 'unavailable') {
      throw new Error(discovery.reason);
    }
    const root = await mkdtemp(join(tmpdir(), 'ffmpeg-export-e2e-'));
    const sourcePath = join(root, 'source clip.mp4');
    const outputPath = join(root, 'output.mp4');
    await execFileAsync(discovery.executablePath, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=24:d=1',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
      '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', sourcePath
    ]);
    const timeline: TimelineDocument = {
      schemaVersion: TIMELINE_SCHEMA_VERSION,
      tracks: [
        {
          id: 'video-track', name: 'Video', kind: 'video', clips: [{
            id: 'video-clip', assetId: 'video-asset', timelineStartMs: 0, sourceStartMs: 0,
            sourceEndMs: 1_000, sourceDurationMs: 1_000, effects: DEFAULT_CLIP_EFFECTS, keyframes: []
          }]
        },
        {
          id: 'audio-track', name: 'Audio', kind: 'audio', mix: DEFAULT_AUDIO_TRACK_MIX, clips: [{
            id: 'audio-clip', assetId: 'audio-asset', timelineStartMs: 0, sourceStartMs: 0,
            sourceEndMs: 1_000, sourceDurationMs: 1_000, effects: DEFAULT_CLIP_EFFECTS, keyframes: []
          }]
        }
      ],
      transitions: []
    };
    const compiled = compileFfmpegTimeline({
      timeline,
      assetPaths: new Map([['video-asset', sourcePath], ['audio-asset', sourcePath]]),
      outputPath,
      width: 64,
      height: 64,
      frameRate: 24
    });

    await startFfmpegExportProcess({
      executablePath: discovery.executablePath,
      args: compiled.args,
      durationMs: compiled.durationMs,
      onProgress: () => undefined
    }).completion;
    const inspected = await execFileAsync(discovery.executablePath, ['-hide_banner', '-i', outputPath, '-f', 'null', '-']);

    expect(inspected.stderr).toContain('Video: h264');
    expect(inspected.stderr).toContain('Audio: aac');
  }, 20_000);
});
