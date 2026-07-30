/**
 * Moved to src/shared: the compiler only builds an argument list, so it is not
 * Node-specific and the mobile app needs the same output. Re-exported here so
 * the main process's existing imports keep resolving.
 */
export {
  compileFfmpegTimeline,
  FfmpegTimelineError,
  type CompileFfmpegTimelineInput,
  type CompiledFfmpegTimeline
} from '../shared/ffmpegTimelineCompiler';
