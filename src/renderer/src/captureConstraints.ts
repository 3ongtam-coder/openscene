export type CaptureWorkflowState = 'idle' | 'source_selected' | 'recording' | 'paused' | 'finalizing' | 'completed' | 'error';

export function supportedCaptureConstraints(): DisplayMediaStreamOptions {
  return {
    video: {
      frameRate: { ideal: 30, max: 30 }
    },
    audio: false
  };
}
