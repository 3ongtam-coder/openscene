import { protocol } from 'electron';

import { TimelineIpcService } from './timelineIpcService';
import { createTimelineAssetRequestHandler } from './timelineAssetResponse';

export const PLAYBACK_SCHEME = 'video-tool-asset';

export function registerTimelineAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PLAYBACK_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ]);
}

export function registerTimelineAssetProtocol(service: TimelineIpcService): void {
  protocol.handle(PLAYBACK_SCHEME, createTimelineAssetRequestHandler(service));
}
