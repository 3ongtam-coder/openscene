import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * Renders a composition plan to a file.
 *
 * The plan is built by src/shared/videoCompositionPlan; this module only turns
 * it into the platform's own composition object. Nothing about the timeline
 * rules lives on the native side.
 */
export type NativeSegment = {
  uri: string;
  timelineStartMs: number;
  sourceStartMs: number;
  sourceEndMs: number;
};

export type NativeExportRequest = {
  width: number;
  height: number;
  frameRate: number;
  durationMs: number;
  /** Bottom layer first. */
  videoSegments: NativeSegment[];
  audioSegments: (NativeSegment & { gain: number })[];
};

export type NativeExportResult = { uri: string; durationMs: number };

type VideoExportModuleType = {
  readonly isSupported: boolean;
  exportComposition(request: NativeExportRequest): Promise<NativeExportResult>;
};

/**
 * Optional on purpose. This is a local native module, so a client that was not
 * built with it — Expo Go, or any older build — has no way to provide it.
 * Requiring it outright threw at import time and took the whole app down with
 * it, which turned "export is unavailable" into "the editor will not open".
 */
const nativeModule = requireOptionalNativeModule<VideoExportModuleType>('VideoExport');

export const isExportAvailable = nativeModule !== null;

export default {
  isSupported: nativeModule?.isSupported ?? false,
  async exportComposition(request: NativeExportRequest): Promise<NativeExportResult> {
    if (nativeModule === null) {
      throw new Error(
        'This build has no video export module. Run the app from a development build rather than Expo Go.'
      );
    }
    return nativeModule.exportComposition(request);
  }
} satisfies VideoExportModuleType;
