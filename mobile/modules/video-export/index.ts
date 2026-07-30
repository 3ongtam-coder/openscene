import { requireNativeModule } from 'expo-modules-core';

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

export default requireNativeModule<VideoExportModuleType>('VideoExport');
