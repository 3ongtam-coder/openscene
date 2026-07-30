import { useCallback, useMemo, useState } from 'react';

import { deleteClip, moveClip, placeClip, splitClip, trimClipLeft, trimClipRight } from '@openvideo/shared/timelineClipLogic';
import { createInitialTimeline, timelineDurationMs } from '@openvideo/shared/timelineLogic';
import { DEFAULT_CLIP_EFFECTS } from '@openvideo/shared/timelineTypes';
import { resolveTimelineTrackForAsset, trackAppendStartMs } from '@openvideo/shared/timelineClipPlacement';
import type { MediaAsset, TimelineDocument } from '@openvideo/shared/timelineTypes';

/**
 * The editing model is the desktop's, unchanged — every operation below is a
 * pure function from src/shared. Nothing here reimplements a rule; this hook only
 * owns what the desktop's own editor hook owns: which clip is selected, where the
 * playhead is, and the undo stack.
 */

export type EditorAsset = MediaAsset & { readonly uri: string };

type Snapshot = { readonly timeline: TimelineDocument; readonly label: string };

const UNDO_DEPTH = 40;

export function useMobileEditor() {
  const [timeline, setTimeline] = useState<TimelineDocument>(() => createInitialTimeline());
  const [assets, setAssets] = useState<readonly EditorAsset[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [past, setPast] = useState<readonly Snapshot[]>([]);
  const [future, setFuture] = useState<readonly Snapshot[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const durationMs = useMemo(() => timelineDurationMs(timeline), [timeline]);

  /**
   * Every mutation goes through here, so an operation the shared rules reject
   * leaves the document untouched and says why — rather than silently doing
   * nothing, which on a touch screen reads as a missed tap.
   */
  const apply = useCallback(
    (label: string, update: (current: TimelineDocument) => TimelineDocument | null, rejection: string): void => {
      setTimeline((current) => {
        const next = update(current);
        if (next === null) {
          setMessage(rejection);
          return current;
        }
        setPast((stack) => [...stack, { timeline: current, label }].slice(-UNDO_DEPTH));
        setFuture([]);
        setMessage(null);
        return next;
      });
    },
    []
  );

  const undo = useCallback(() => {
    setPast((stack) => {
      const previous = stack[stack.length - 1];
      if (previous === undefined) return stack;
      setTimeline((current) => {
        setFuture((forward) => [{ timeline: current, label: previous.label }, ...forward]);
        return previous.timeline;
      });
      return stack.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((stack) => {
      const next = stack[0];
      if (next === undefined) return stack;
      setTimeline((current) => {
        setPast((back) => [...back, { timeline: current, label: next.label }]);
        return next.timeline;
      });
      return stack.slice(1);
    });
  }, []);

  const addAsset = useCallback(
    (asset: EditorAsset): void => {
      setAssets((current) => [...current, asset]);
      apply(
        `Added ${asset.displayName}`,
        (current) => {
          const target = resolveTimelineTrackForAsset(current, asset);
          if (!target.ok) return null;
          const durationMsForAsset = asset.metadata?.durationMs ?? 5_000;
          // Appended rather than dropped at the playhead: there is no cursor to
          // drop onto on a phone, and appending is never ambiguous.
          return placeClip(current, {
            trackId: target.track.id,
            clip: {
              id: `clip-${asset.id}-${Date.now().toString(36)}`,
              assetId: asset.id,
              timelineStartMs: trackAppendStartMs(target.track),
              sourceStartMs: 0,
              sourceEndMs: durationMsForAsset,
              sourceDurationMs: durationMsForAsset,
              effects: { ...DEFAULT_CLIP_EFFECTS },
              keyframes: []
            }
          });
        },
        'That asset could not be placed on a track.'
      );
    },
    [apply]
  );

  const selectedClip = useMemo(() => {
    for (const track of timeline.tracks) {
      const clip = track.clips.find((candidate) => candidate.id === selectedClipId);
      if (clip !== undefined) return { clip, trackId: track.id };
    }
    return null;
  }, [timeline, selectedClipId]);

  return {
    timeline,
    assets,
    durationMs,
    playheadMs,
    setPlayheadMs,
    selectedClipId,
    setSelectedClipId,
    selectedClip,
    message,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    undo,
    redo,
    addAsset,
    assetFor: (assetId: string) => assets.find((asset) => asset.id === assetId) ?? null,

    splitAtPlayhead: () =>
      apply(
        'Split',
        (current) =>
          selectedClipId === null
            ? null
            : splitClip(current, {
                clipId: selectedClipId,
                atMs: playheadMs,
                rightClipId: `clip-split-${Date.now().toString(36)}`
              }),
        'Move the playhead inside the selected clip to split it.'
      ),

    deleteSelected: () =>
      apply(
        'Delete',
        // deleteClip returns a document rather than null, and no-ops on an
        // unknown id, so the guard is ours to make.
        (current) => (selectedClipId === null ? null : deleteClip(current, selectedClipId)),
        'Select a clip first.'
      ),

    trimSelected: (edge: 'left' | 'right', deltaMs: number) =>
      apply(
        `Trim ${edge}`,
        (current) => {
          if (selectedClip === null) return null;
          const at = edge === 'left'
            ? selectedClip.clip.timelineStartMs + deltaMs
            : selectedClip.clip.timelineStartMs +
              (selectedClip.clip.sourceEndMs - selectedClip.clip.sourceStartMs) +
              deltaMs;
          return edge === 'left'
            ? trimClipLeft(current, { clipId: selectedClip.clip.id, timelineStartMs: at })
            : trimClipRight(current, { clipId: selectedClip.clip.id, timelineEndMs: at });
        },
        'That trim would make the clip shorter than a frame.'
      ),

    nudgeSelected: (deltaMs: number) =>
      apply(
        'Move',
        (current) => {
          if (selectedClip === null) return null;
          return moveClip(current, {
            clipId: selectedClip.clip.id,
            targetTrackId: selectedClip.trackId,
            timelineStartMs: Math.max(0, selectedClip.clip.timelineStartMs + deltaMs)
          });
        },
        'That move would overlap another clip.'
      )
  };
}
