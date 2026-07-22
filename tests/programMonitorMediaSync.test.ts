import { describe, expect, it, vi } from 'vitest';

import {
  syncTimelineMediaPlayback,
  syncTimelineMediaTime,
  syncTimelineMediaVolume,
  type TimelineMediaEffectsElement,
  type TimelineMediaElement
} from '../src/renderer/src/editor/programMonitorMediaSync';

class FakeTimelineMediaElement implements TimelineMediaElement {
  currentTime: number;
  pauseCalls = 0;
  playCalls = 0;

  constructor(
    currentTime = 0,
    private readonly playImplementation: () => Promise<void> = () => Promise.resolve()
  ) {
    this.currentTime = currentTime;
  }

  pause(): void {
    this.pauseCalls += 1;
  }

  play(): Promise<void> {
    this.playCalls += 1;
    return this.playImplementation();
  }
}

class FakeTimelineMediaEffectsElement extends FakeTimelineMediaElement implements TimelineMediaEffectsElement {
  constructor(
    currentTime = 0,
    readonly initialVolume = 1
  ) {
    super(currentTime);
    this.volume = initialVolume;
  }

  volume: number;
}

describe('program monitor media synchronization', () => {
  it('does nothing when media is null', () => {
    const onPlayRejected = vi.fn();

    expect(() => syncTimelineMediaTime(null, 1_000)).not.toThrow();
    expect(() => syncTimelineMediaPlayback({ media: null, shouldPlay: true, onPlayRejected })).not.toThrow();
    expect(onPlayRejected).not.toHaveBeenCalled();
  });

  it('does not seek when source time is null', () => {
    const media = new FakeTimelineMediaElement(3);

    syncTimelineMediaTime(media, null);

    expect(media.currentTime).toBe(3);
  });

  it('does not seek when drift is exactly 0.08 seconds', () => {
    const media = new FakeTimelineMediaElement();

    syncTimelineMediaTime(media, 80);

    expect(media.currentTime).toBe(0);
  });

  it('seeks when drift is greater than 0.08 seconds', () => {
    const media = new FakeTimelineMediaElement();

    syncTimelineMediaTime(media, 81);

    expect(media.currentTime).toBe(0.081);
  });

  it('plays media when playback should continue', () => {
    const media = new FakeTimelineMediaElement();

    syncTimelineMediaPlayback({ media, shouldPlay: true, onPlayRejected: vi.fn() });

    expect(media.playCalls).toBe(1);
    expect(media.pauseCalls).toBe(0);
  });

  it('pauses media when playback should stop', () => {
    const media = new FakeTimelineMediaElement();

    syncTimelineMediaPlayback({ media, shouldPlay: false, onPlayRejected: vi.fn() });

    expect(media.pauseCalls).toBe(1);
    expect(media.playCalls).toBe(0);
  });

  it('reports an asynchronously rejected play request', async () => {
    const playError = new Error('Playback rejected.');
    const media = new FakeTimelineMediaElement(0, () => Promise.reject(playError));
    const onPlayRejected = vi.fn();

    syncTimelineMediaPlayback({ media, shouldPlay: true, onPlayRejected });
    await Promise.resolve();

    expect(onPlayRejected).toHaveBeenCalledTimes(1);
  });

  it('reports a synchronously thrown play request without rethrowing', () => {
    const media = new FakeTimelineMediaElement(0, () => {
      throw new Error('Playback threw.');
    });
    const onPlayRejected = vi.fn();

    expect(() => syncTimelineMediaPlayback({ media, shouldPlay: true, onPlayRejected })).not.toThrow();
    expect(onPlayRejected).toHaveBeenCalledTimes(1);
  });

  it('syncs clip volume to media elements and ignores null inputs', () => {
    const media = new FakeTimelineMediaEffectsElement(0, 1);

    syncTimelineMediaVolume({ media, volume: 0.25 });
    syncTimelineMediaVolume({ media: null, volume: 0.5 });
    syncTimelineMediaVolume({ media, volume: null });

    expect(media.volume).toBe(0.25);
  });
});
