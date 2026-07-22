export interface TimelineMediaElement {
  currentTime: number;
  pause(): void;
  play(): Promise<void>;
}

export interface TimelineMediaEffectsElement extends TimelineMediaElement {
  volume: number;
}

type TimelineMediaPlaybackSyncInput = {
  readonly media: TimelineMediaElement | null;
  readonly shouldPlay: boolean;
  readonly onPlayRejected: () => void;
};

type TimelineMediaVolumeSyncInput = {
  readonly media: TimelineMediaEffectsElement | null;
  readonly volume: number | null;
};

export const TIMELINE_MEDIA_SYNC_TOLERANCE_SECONDS = 0.08;

export function syncTimelineMediaTime(media: TimelineMediaElement | null, sourceTimeMs: number | null): void {
  if (media === null || sourceTimeMs === null) return;

  const sourceTimeSeconds = sourceTimeMs / 1_000;
  if (Math.abs(media.currentTime - sourceTimeSeconds) > TIMELINE_MEDIA_SYNC_TOLERANCE_SECONDS) {
    media.currentTime = sourceTimeSeconds;
  }
}

export function syncTimelineMediaPlayback({ media, shouldPlay, onPlayRejected }: TimelineMediaPlaybackSyncInput): void {
  if (media === null) return;
  if (!shouldPlay) {
    media.pause();
    return;
  }

  try {
    void media.play().then(undefined, onPlayRejected);
  } catch {
    onPlayRejected();
  }
}

export function syncTimelineMediaVolume({ media, volume }: TimelineMediaVolumeSyncInput): void {
  if (media === null || volume === null || media.volume === volume) return;
  media.volume = volume;
}
