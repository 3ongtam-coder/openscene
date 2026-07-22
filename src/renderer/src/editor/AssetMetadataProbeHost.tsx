import { useEffect, useRef, useState, type ReactElement, type SyntheticEvent } from 'react';

import type { MediaAsset, LocalProjectSnapshot } from '../../../shared/timelineTypes';
import { assetsNeedingMetadata } from './dockTabs';
import { mediaDurationMsFromSeconds } from './mediaLoadFailures';
import type { TimelineEditorController } from './useTimelineEditor';

type AssetMetadataProbeHostProps = {
  readonly failuresByAssetId: TimelineEditorController['metadataProbeFailuresByAssetId'];
  readonly onMetadata: TimelineEditorController['updateAssetMetadata'];
  readonly onProbeFailure: TimelineEditorController['reportMetadataProbeFailure'];
  readonly project: LocalProjectSnapshot | null;
  readonly retryRevisionsByAssetId: TimelineEditorController['metadataProbeRetryRevisionsByAssetId'];
};

type AssetMetadataProbeProps = {
  readonly asset: MediaAsset;
  readonly failureMessage: string | undefined;
  readonly onMetadata: TimelineEditorController['updateAssetMetadata'];
  readonly onProbeFailure: TimelineEditorController['reportMetadataProbeFailure'];
  readonly projectId: string;
  readonly retryRevision: number;
};

type MetadataProbeAttempt = {
  completed: boolean;
  readonly id: number;
  timeoutId: number | null;
};

type MetadataProbeSource = {
  readonly attemptId: number;
  readonly url: string;
};

const METADATA_PROBE_TIMEOUT_MS = 10_000;

function clearProbeTimeout(attempt: MetadataProbeAttempt): void {
  if (attempt.timeoutId === null) return;
  window.clearTimeout(attempt.timeoutId);
  attempt.timeoutId = null;
}

function AssetMetadataProbe({ asset, failureMessage, onMetadata, onProbeFailure, projectId, retryRevision }: AssetMetadataProbeProps): ReactElement | null {
  const [source, setSource] = useState<MetadataProbeSource | null>(null);
  const currentAttemptRef = useRef<MetadataProbeAttempt | null>(null);
  const nextAttemptIdRef = useRef(0);

  useEffect(() => {
    setSource(null);
    if (asset.metadata !== null || failureMessage !== undefined) return;

    const attempt: MetadataProbeAttempt = {
      completed: false,
      id: nextAttemptIdRef.current + 1,
      timeoutId: null
    };
    nextAttemptIdRef.current = attempt.id;
    currentAttemptRef.current = attempt;

    const reportFailure = (): void => {
      if (currentAttemptRef.current !== attempt || attempt.completed) return;
      attempt.completed = true;
      clearProbeTimeout(attempt);
      currentAttemptRef.current = null;
      setSource(null);
      onProbeFailure(asset.id);
    };

    attempt.timeoutId = window.setTimeout(reportFailure, METADATA_PROBE_TIMEOUT_MS);
    void window.videoTool.getAssetPlaybackUrl({ projectId, assetId: asset.id }).then((response) => {
      if (currentAttemptRef.current !== attempt || attempt.completed) return;
      if (!response.ok) {
        reportFailure();
        return;
      }
      setSource({ attemptId: attempt.id, url: response.value.url });
    }, reportFailure);

    return () => {
      attempt.completed = true;
      clearProbeTimeout(attempt);
      if (currentAttemptRef.current === attempt) currentAttemptRef.current = null;
    };
  }, [asset.id, asset.metadata, failureMessage, onProbeFailure, projectId, retryRevision]);

  const finishAttempt = (attemptId: number): MetadataProbeAttempt | null => {
    const attempt = currentAttemptRef.current;
    if (attempt === null || attempt.id !== attemptId || attempt.completed) return null;
    attempt.completed = true;
    clearProbeTimeout(attempt);
    setSource(null);
    return attempt;
  };

  const reportCurrentFailure = (attemptId: number): void => {
    if (finishAttempt(attemptId) === null) return;
    currentAttemptRef.current = null;
    onProbeFailure(asset.id);
  };

  const onLoadedMetadata = (event: SyntheticEvent<HTMLMediaElement>): void => {
    if (source === null) return;
    const media = event.currentTarget;
    const durationMs = mediaDurationMsFromSeconds(media.duration);
    if (durationMs === null) {
      reportCurrentFailure(source.attemptId);
      return;
    }
    const attempt = finishAttempt(source.attemptId);
    if (attempt === null) return;

    const handleMetadataUpdate = (updated: boolean): void => {
      if (currentAttemptRef.current !== attempt) return;
      currentAttemptRef.current = null;
      if (!updated) onProbeFailure(asset.id);
    };
    const metadata = media instanceof HTMLVideoElement && media.videoWidth > 0 && media.videoHeight > 0
      ? { durationMs, width: media.videoWidth, height: media.videoHeight }
      : { durationMs };
    void onMetadata(asset.id, metadata).then(handleMetadataUpdate, () => handleMetadataUpdate(false));
  };

  if (asset.metadata !== null || failureMessage !== undefined || source === null) return null;
  const onMediaFailure = (): void => reportCurrentFailure(source.attemptId);

  return asset.kind === 'video'
    ? <video className="asset-probe" key={source.attemptId} src={source.url} preload="metadata" muted onAbort={onMediaFailure} onError={onMediaFailure} onLoadedMetadata={onLoadedMetadata} />
    : <audio className="asset-probe" key={source.attemptId} src={source.url} preload="metadata" onAbort={onMediaFailure} onError={onMediaFailure} onLoadedMetadata={onLoadedMetadata} />;
}

export function AssetMetadataProbeHost({ failuresByAssetId, onMetadata, onProbeFailure, project, retryRevisionsByAssetId }: AssetMetadataProbeHostProps): ReactElement | null {
  if (project === null) return null;

  return (
    <>
      {assetsNeedingMetadata(project.assets).map((asset) => (
        <AssetMetadataProbe
          asset={asset}
          failureMessage={failuresByAssetId[asset.id]}
          key={asset.id}
          onMetadata={onMetadata}
          onProbeFailure={onProbeFailure}
          projectId={project.id}
          retryRevision={retryRevisionsByAssetId[asset.id] ?? 0}
        />
      ))}
    </>
  );
}
