import { ALLOWED_AUDIO_MIME_TYPES } from '../../shared/models';
import type { AllowedAudioMimeType } from '../../shared/models';
export {
  CONSENT_TEXT_VERSION,
  DEFAULT_NARRATION_SCRIPT,
  NARRATION_SAMPLE_LIMITS,
  assessNarrationProfileDraft,
  canStartTtsJob,
  isCompletedTtsJob,
  isNarrationSampleDurationValid,
  parseAllowedAudioMimeType,
  publicRuntimeStatusText,
  ttsJobStatusText
} from '../../shared/narrationLogic';

export function chooseAudioRecorderMimeType(): AllowedAudioMimeType {
  for (const candidate of ALLOWED_AUDIO_MIME_TYPES) {
    if (typeof MediaRecorder === 'undefined' || MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }

  return 'audio/webm';
}
