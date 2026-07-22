import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const FFMPEG_PATH = 'ffmpeg';
const execFileAsync = promisify(execFile);

export type Mp4MediaFixture = {
  readonly directory: string;
  readonly filePath: string;
  readonly cleanup: () => Promise<void>;
};

export async function createMp4MediaFixture(): Promise<Mp4MediaFixture> {
  const directory = await mkdtemp(join(tmpdir(), 'video-media-fixture-'));
  const filePath = join(directory, 'fixture.mp4');
  try {
    await execFileAsync(FFMPEG_PATH, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=16x16:r=24:d=1',
      '-an',
      '-c:v',
      'mpeg4',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-y',
      filePath
    ]);
  } catch (error: unknown) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    directory,
    filePath,
    cleanup: () => rm(directory, { recursive: true, force: true })
  };
}
