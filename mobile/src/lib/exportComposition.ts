import { buildCompositionPlan, CompositionPlanError } from '@openvideo/shared/videoCompositionPlan';
import type { TimelineDocument } from '@openvideo/shared/timelineTypes';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
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

export type DeliveryOutcome =
  | { readonly ok: true; readonly how: 'photos' | 'share' }
  | { readonly ok: false; readonly message: string };

/**
 * Hands the finished file to the user.
 *
 * An export that stops at a temporary path is not an export on a phone — there
 * is no file manager to go and find it in. Saving to the photo library is the
 * outcome people expect; the share sheet is the fallback when they decline that
 * permission, since refusing photo access should not mean losing the render.
 */
export async function deliverExport(uri: string): Promise<DeliveryOutcome> {
  try {
    const permission = await MediaLibrary.requestPermissionsAsync();
    if (permission.granted) {
      await MediaLibrary.saveToLibraryAsync(uri);
      return { ok: true, how: 'photos' };
    }
  } catch {
    // Fall through to sharing rather than failing: the render exists either way.
  }

  try {
    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, message: 'The video was rendered but this device offers no way to save or share it.' };
    }
    await Sharing.shareAsync(uri, { mimeType: 'video/mp4', UTI: 'public.mpeg-4' });
    return { ok: true, how: 'share' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'The video could not be shared.' };
  }
}
