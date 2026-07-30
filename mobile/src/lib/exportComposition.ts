import { buildCompositionPlan, CompositionPlanError } from '@openvideo/shared/videoCompositionPlan';
import type { TimelineDocument } from '@openvideo/shared/timelineTypes';
import VideoExport from '../../modules/video-export';
import type { EditorAsset } from './editorState';

export type ExportOutcome =
  | { readonly ok: true; readonly uri: string }
  | { readonly ok: false; readonly message: string };

/**
 * Turns the timeline into a plan, resolves asset ids to the local URIs the
 * native side needs, and hands it over. The plan is shared with the desktop; the
 * id-to-URI step is the only part that is the app's own, because a URI is a host
 * concern the timeline model deliberately does not carry.
 */
export async function exportTimeline(input: {
  readonly timeline: TimelineDocument;
  readonly assets: readonly EditorAsset[];
  readonly width?: number;
  readonly height?: number;
  readonly frameRate?: number;
}): Promise<ExportOutcome> {
  let plan;
  try {
    plan = buildCompositionPlan({
      timeline: input.timeline,
      width: input.width ?? 1920,
      height: input.height ?? 1080,
      frameRate: input.frameRate ?? 30
    });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof CompositionPlanError ? error.message : 'The timeline could not be prepared for export.'
    };
  }

  const uris = plan.sources.map((assetId) => input.assets.find((asset) => asset.id === assetId)?.uri);
  const missing = plan.sources.filter((_, index) => uris[index] === undefined);
  if (missing.length > 0) {
    // Exporting with a source silently dropped would produce a shorter video
    // than the timeline shows, which is worse than refusing.
    return { ok: false, message: `${missing.length} clip source(s) are no longer available on this device.` };
  }

  type Placed = {
    readonly sourceIndex: number;
    readonly timelineStartMs: number;
    readonly sourceStartMs: number;
    readonly sourceEndMs: number;
  };

  const withUri = (segment: Placed) => ({
    uri: uris[segment.sourceIndex] as string,
    timelineStartMs: segment.timelineStartMs,
    sourceStartMs: segment.sourceStartMs,
    sourceEndMs: segment.sourceEndMs
  });

  try {
    const result = await VideoExport.exportComposition({
      width: plan.width,
      height: plan.height,
      frameRate: plan.frameRate,
      durationMs: plan.durationMs,
      videoSegments: plan.videoSegments.map(withUri),
      audioSegments: plan.audioSegments.map((segment) => ({ ...withUri(segment), gain: segment.gain }))
    });
    return { ok: true, uri: result.uri };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Export failed.' };
  }
}
