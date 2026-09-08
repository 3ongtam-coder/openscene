import { useEffect, useRef, useState, type ReactElement } from 'react';

import {
  DEFAULT_GOOGLE_FLOW_PREFERENCES,
  GOOGLE_FLOW_PREFERENCES_STORAGE_KEY,
  parseGoogleFlowPreferences,
  type BrowserSessionStatus
} from '../../shared/browserSession';
import type { ImageAspectRatio, ImageGenerationJob, ReferenceImageSelection } from '../../shared/providerSeams';
import { useAiDomainModel } from './AiDomainModelContext';
import { DomainModelPicker } from './DomainModelPicker';
import { Button, StatusCard } from './ui';

const STYLE_PRESETS = ['Photographic', 'Illustration', 'Anime', '3D Render', 'Cinematic', 'Flat Vector'] as const;
const ASPECT_RATIOS: readonly ImageAspectRatio[] = ['1:1', '16:9', '9:16', '4:3', '3:4'];
const IMAGE_JOB_UI_TIMEOUT_MS = 12 * 60_000;

type StatusMessage = { readonly text: string; readonly tone: 'neutral' | 'success' | 'warning' | 'danger' };
type ImageGenerationMode = 'api' | 'browser_session';

type ImageGenerationWorkspaceProps = {
  /** Hands a finished still to the video studio and switches to it. */
  readonly onUseForVideo: (reference: ReferenceImageSelection) => void;
  /** Local project folder/name mirrored to the signed-in Flow workspace. */
  readonly projectName?: string | undefined;
};

function showGoogleFlowWindow(): boolean {
  try {
    return parseGoogleFlowPreferences(
      window.localStorage.getItem(GOOGLE_FLOW_PREFERENCES_STORAGE_KEY)
    ).showWindowDuringGeneration;
  } catch {
    return DEFAULT_GOOGLE_FLOW_PREFERENCES.showWindowDuringGeneration;
  }
}

export function ImageGenerationWorkspace({ onUseForVideo, projectName }: ImageGenerationWorkspaceProps): ReactElement {
  const { selectedModel } = useAiDomainModel();
  const imageModel = selectedModel('image-generation');
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>('1:1');
  const [selectedStyle, setSelectedStyle] = useState<string>('Photographic');
  const [generationMode, setGenerationMode] = useState<ImageGenerationMode>(
    imageModel.providerId === 'google_gemini' ? 'browser_session' : 'api'
  );
  const [flowSession, setFlowSession] = useState<BrowserSessionStatus | null>(null);
  const [jobs, setJobs] = useState<readonly ImageGenerationJob[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMsg, setStatusMsg] = useState<StatusMessage | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollInFlightRef = useRef(false);
  const pollGenerationRef = useRef(0);
  const previousProviderRef = useRef(imageModel.providerId);

  useEffect(() => {
    if (previousProviderRef.current === imageModel.providerId) return;
    previousProviderRef.current = imageModel.providerId;
    setGenerationMode(imageModel.providerId === 'google_gemini' ? 'browser_session' : 'api');
  }, [imageModel.providerId]);

  useEffect(() => {
    void window.videoTool.getBrowserSessionStatuses().then((response) => {
      if (response.ok) setFlowSession(response.value.find((status) => status.providerId === 'gemini') ?? null);
    });
  }, []);

  useEffect(() => () => {
    pollGenerationRef.current += 1;
    if (pollTimerRef.current !== null) clearInterval(pollTimerRef.current);
    pollInFlightRef.current = false;
  }, []);

  const handleGenerate = async (): Promise<void> => {
    if (prompt.trim().length === 0) {
      setStatusMsg({ text: 'Please enter an image generation prompt.', tone: 'warning' });
      return;
    }

    const flowWindowVisible = generationMode === 'browser_session' && showGoogleFlowWindow();
    setIsGenerating(true);
    setStatusMsg({
      text: generationMode === 'browser_session'
        ? flowWindowVisible
          ? 'Opening the signed-in Google Flow window…'
          : 'Starting the hidden signed-in Google Flow image worker…'
        : `Submitting ${imageModel.providerLabel} image job…`,
      tone: 'neutral'
    });

    try {
      const response = await window.videoTool.aiGenerateImage({
        // The style rides along with the prompt because none of these providers
        // take a separate style parameter; inventing one would be a fiction.
        prompt: selectedStyle.length > 0 ? `${prompt.trim()}, ${selectedStyle} style` : prompt.trim(),
        aspectRatio,
        stylePreset: selectedStyle,
        modelId: imageModel.id,
        mode: generationMode,
        ...(generationMode === 'browser_session'
          ? { showBrowserWindow: flowWindowVisible, ...(projectName === undefined ? {} : { flowProjectName: projectName }) }
          : {}),
        ...(negativePrompt.trim().length === 0 ? {} : { negativePrompt: negativePrompt.trim() })
      });

      if (!response.ok) {
        setIsGenerating(false);
        setStatusMsg({ text: response.error.message, tone: 'danger' });
        return;
      }

      const job = response.value;
      setJobs((prev) => [job, ...prev]);
      if (job.mode === 'browser_session') {
        setStatusMsg({
          text: flowWindowVisible
            ? 'Google Flow is generating in the visible window. OpenScene will import the result automatically.'
            : 'Google Flow is generating in the background. OpenScene will download and verify the result automatically.',
          tone: 'neutral'
        });
      }

      const pollingDeadline = Date.now() + IMAGE_JOB_UI_TIMEOUT_MS;
      const pollGeneration = ++pollGenerationRef.current;
      const stopPolling = (): void => {
        clearInterval(intervalId);
        if (pollTimerRef.current === intervalId) pollTimerRef.current = null;
        pollInFlightRef.current = false;
        if (pollGenerationRef.current === pollGeneration) {
          pollGenerationRef.current += 1;
          setIsGenerating(false);
        }
      };
      const intervalId = setInterval(async () => {
        if (pollGenerationRef.current !== pollGeneration) return;
        // Check the wall-clock deadline before the in-flight guard. If an IPC
        // promise itself never settles, later ticks must still release the UI.
        if (Date.now() >= pollingDeadline) {
          stopPolling();
          setStatusMsg({ text: 'Stopped waiting after 12 minutes. Check the terminal log for this image job before retrying.', tone: 'warning' });
          return;
        }
        if (pollInFlightRef.current) return;
        try {
          pollInFlightRef.current = true;
          const pollRes = await window.videoTool.aiGetImageJob(job.id);
          if (pollGenerationRef.current !== pollGeneration) return;
          if (!pollRes.ok) {
            stopPolling();
            setStatusMsg({ text: pollRes.error.message, tone: 'danger' });
            return;
          }
          const updated = pollRes.value;
          setJobs((prev) => prev.map((existing) => (existing.id === updated.id ? updated : existing)));

          if (updated.status === 'completed') {
            stopPolling();
            setStatusMsg({ text: 'Image ready.', tone: 'success' });
          } else if (updated.status === 'failed') {
            stopPolling();
            setStatusMsg({ text: updated.error ?? 'Image generation failed.', tone: 'danger' });
          }
        } catch (error: unknown) {
          stopPolling();
          setStatusMsg({ text: error instanceof Error ? error.message : 'Image job polling failed.', tone: 'danger' });
        } finally {
          pollInFlightRef.current = false;
        }
      }, 800);
      pollTimerRef.current = intervalId;
    } catch (err) {
      setIsGenerating(false);
      setStatusMsg({ text: err instanceof Error ? err.message : 'Unexpected error during generation.', tone: 'danger' });
    }
  };

  const handleSave = async (job: ImageGenerationJob): Promise<void> => {
    const response = await window.videoTool.aiSaveImageResult(job.id);
    if (!response.ok) {
      setStatusMsg({ text: response.error.message, tone: 'danger' });
      return;
    }
    // A cancelled save dialog is a decision, not a failure.
    if (response.value.saved) setStatusMsg({ text: 'Image saved.', tone: 'success' });
  };

  const handleUseForVideo = async (job: ImageGenerationJob): Promise<void> => {
    const response = await window.videoTool.aiUseImageAsVideoReference(job.id);
    if (!response.ok) {
      setStatusMsg({ text: response.error.message, tone: 'danger' });
      return;
    }
    // Puts the still into the video form and moves the user there, rather than
    // telling them to save it and pick it again.
    onUseForVideo(response.value);
  };

  return (
    <section className="studio-surface" aria-labelledby="image-generation-title">
      <header className="studio-surface__header">
        <div className="studio-surface__title">
          <h2 className="studio-surface__title-label" id="image-generation-title">
            Image Generation
          </h2>
          <span className="studio-surface__title-meta">
            {generationMode === 'browser_session' ? 'Signed-in Google Flow worker' : 'Cloud image generation'}
          </span>
        </div>
        <DomainModelPicker
          domain="image-generation"
          ariaLabel="Image model"
          linkedProviderIds={flowSession?.kind === 'stored' ? ['google_gemini'] : []}
        />
      </header>

      <div className="studio-surface__body">
        {imageModel.providerId === 'google_gemini' && (
          <div className="studio-field">
            <span className="studio-field__label">Connection</span>
            <div className="studio-chips" role="group" aria-label="Google Flow connection mode">
              <button
                type="button"
                aria-pressed={generationMode === 'browser_session'}
                className={`studio-chip${generationMode === 'browser_session' ? ' studio-chip--selected' : ''}`}
                onClick={() => setGenerationMode('browser_session')}
              >
                Google Flow session
              </button>
              <button
                type="button"
                aria-pressed={generationMode === 'api'}
                className={`studio-chip${generationMode === 'api' ? ' studio-chip--selected' : ''}`}
                onClick={() => setGenerationMode('api')}
              >
                API key
              </button>
            </div>
            {generationMode === 'browser_session' && (
              <StatusCard tone={flowSession?.kind === 'stored' ? 'success' : 'warning'}>
                {flowSession?.kind === 'stored'
                  ? 'Google Flow session ready. Generate runs in a hidden Flow project and imports the result automatically.'
                  : 'No ready Google Flow session detected. Sign in under Settings → Providers before generating.'}
              </StatusCard>
            )}
          </div>
        )}

        <div className="studio-field">
          <span className="studio-field__label">Style</span>
          <div className="studio-chips" role="group" aria-label="Style preset">
            {STYLE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-pressed={selectedStyle === preset}
                className={`studio-chip${selectedStyle === preset ? ' studio-chip--selected' : ''}`}
                onClick={() => setSelectedStyle(preset)}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        <div className="studio-field">
          <span className="studio-field__label">Aspect ratio</span>
          <div className="studio-chips" role="group" aria-label="Aspect ratio">
            {ASPECT_RATIOS.map((ratio) => (
              <button
                key={ratio}
                type="button"
                aria-pressed={aspectRatio === ratio}
                className={`studio-chip${aspectRatio === ratio ? ' studio-chip--selected' : ''}`}
                onClick={() => setAspectRatio(ratio)}
              >
                {ratio}
              </button>
            ))}
          </div>
        </div>

        <div className="studio-field">
          <label className="studio-field__label" htmlFor="image-negative-prompt">
            Avoid
          </label>
          <input
            id="image-negative-prompt"
            className="studio-input"
            type="text"
            value={negativePrompt}
            placeholder="Optional — what to keep out of the frame"
            onChange={(event) => setNegativePrompt(event.target.value)}
          />
        </div>

        {statusMsg !== null && <StatusCard tone={statusMsg.tone}>{statusMsg.text}</StatusCard>}

        <div className="studio-field">
          <span className="studio-field__label">Results</span>
          {jobs.length === 0 ? (
            <p className="studio-empty">No image jobs yet.</p>
          ) : (
            <ul className="studio-job-list">
              {jobs.map((job) => (
                <li key={job.id} className="studio-job">
                  <div className="studio-job__row">
                    <span className={`studio-job__status studio-job__status--${job.status}`}>{job.status}</span>
                    <span className="studio-job__provider">
                      {job.provider}{job.mode === 'browser_session' ? ' · signed-in session' : ''}
                    </span>
                  </div>
                  {job.previewBase64 !== undefined && (
                    <img
                      className="studio-image-result"
                      src={`data:${job.previewMimeType ?? 'image/png'};base64,${job.previewBase64}`}
                      alt={`Generated image for prompt: ${job.prompt}`}
                    />
                  )}
                  <p className="studio-job__prompt">{job.prompt}</p>
                  {job.status === 'failed' && job.error !== undefined && (
                    <p className="studio-job__error">{job.error}</p>
                  )}
                  {job.status === 'completed' && (
                    <div className="studio-job__actions">
                      <Button variant="primary" onClick={() => void handleUseForVideo(job)}>
                        Use for video
                      </Button>
                      <Button variant="default" onClick={() => void handleSave(job)}>
                        Save image
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="studio-composer">
        <textarea
          className="studio-composer__input"
          rows={3}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Describe the image…"
          aria-label="Image prompt"
        />
        <div className="studio-composer__toolbar">
          <span className="studio-composer__hint">
            {aspectRatio} · {selectedStyle}
            {negativePrompt.trim().length === 0 ? '' : ' · avoid set'}
            {generationMode === 'browser_session' ? ' · Google Flow session' : ''}
          </span>
          <Button
            variant="primary"
            onClick={() => void handleGenerate()}
            disabled={isGenerating || prompt.trim().length === 0}
          >
            {isGenerating ? 'Generating…' : 'Generate'}
          </Button>
        </div>
      </div>
    </section>
  );
}
