export function mediaDurationMsFromSeconds(seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;

  const durationMs = Math.round(seconds * 1_000);
  return Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null;
}

export function metadataProbeFailureMessage(..._ignoredValues: unknown[]): string {
  return 'Media metadata is unavailable. Retry to try again.';
}

export function programMonitorFailureMessage(..._ignoredValues: unknown[]): string {
  return 'This media preview is unavailable.';
}

export type ProgramMonitorPreviewLoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly url: string }
  | { readonly status: 'error'; readonly message: string };

type ProgramMonitorPreviewLoadEvent =
  | { readonly type: 'loading' }
  | { readonly type: 'ready'; readonly url: string }
  | { readonly type: 'error' };

export function programMonitorPreviewLoadState(event: ProgramMonitorPreviewLoadEvent): ProgramMonitorPreviewLoadState {
  switch (event.type) {
    case 'loading':
      return { status: 'loading' };
    case 'ready':
      return { status: 'ready', url: event.url };
    case 'error':
      return { status: 'error', message: programMonitorFailureMessage() };
  }
}
