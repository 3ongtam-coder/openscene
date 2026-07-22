import { describe, expect, it } from 'vitest';

import { FfmpegProgressParser } from '../src/main/ffmpegProgress';

describe('FFmpeg progress parser', () => {
  it('parses split progress records and clamps processed time to the timeline duration', () => {
    const updates: number[] = [];
    const parser = new FfmpegProgressParser(2_000, (progress) => updates.push(progress.processedMs));

    parser.append('frame=12\nout_time_us=750');
    parser.append('000\nprogress=continue\nout_time_ms=3000000\nprogress=end\n');
    parser.finish();

    expect(updates).toEqual([750, 2_000]);
  });

  it('ignores malformed and regressing progress values', () => {
    const updates: number[] = [];
    const parser = new FfmpegProgressParser(2_000, (progress) => updates.push(progress.processedMs));

    parser.append('out_time_us=nope\nprogress=continue\nout_time_us=1000000\nprogress=continue\nout_time_us=500000\nprogress=continue\n');
    parser.finish();

    expect(updates).toEqual([1_000]);
  });
});
