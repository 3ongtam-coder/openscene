import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { AiProjectDocument } from '../../shared/aiProjectDomain';
import { approvedWriterShots } from '../../shared/writerPipeline';

import { originalOf, refineShotPrompt, revisionsOf } from '../../shared/shotPrompt';
import type { ReferenceImageSelection, VideoGenerationJob } from '../../shared/providerSeams';
import { DomainModelPicker } from './DomainModelPicker';
import { useAiDomainModel } from './AiDomainModelContext';
import { useProjectResultImport } from './ProjectResultImportContext';
import { getVideoOperationConstraints, isVideoOperationImplemented, type VideoOperation } from '../../shared/mediaCapabilityRegistry';
import { Button, StatusCard } from './ui';

const STYLE_PRESETS = ['Cinematic', 'Anime', '3D Render', 'Photorealistic', 'Cyberpunk', 'Film Noir'] as const;
const VIDEO_JOB_UI_TIMEOUT_MS = 12 * 60_000;
const INPUT_MODES: readonly { readonly id: VideoOperation; readonly label: string }[] = [
  { id: 'text_to_video', label: 'Text' },
  { id: 'image_to_video', label: 'First frame' },
  { id: 'start_end', label: 'Start-End' },
  { id: 'reference_to_video', label: 'References' }
];

type VideoInputSnapshot = {
  readonly operation: VideoOperation;
  readonly referenceImage?: ReferenceImageSelection;
  readonly lastFrame?: ReferenceImageSelection;
  readonly referenceImages?: readonly ReferenceImageSelection[];
};
type VideoGenerationWorkspaceProps = {
  readonly writerDocument?: AiProjectDocument | null;
  /**
   * Controlled from App so the image studio's "Use for video" can hand a
   * generated still straight into this form. Keeping it local meant the handoff
   * could only ever be a suggestion to go and re-pick the file.
   */
  readonly referenceImage: ReferenceImageSelection | null;
  readonly onReferenceImageChange: (reference: ReferenceImageSelection | null) => void;
};

export function VideoGenerationWorkspace({
  writerDocument,
  referenceImage,
  onReferenceImageChange
}: VideoGenerationWorkspaceProps): ReactElement {
  const { selectedModel } = useAiDomainModel();
  const videoModel = selectedModel('video-generation');
  const { importAiResult } = useProjectResultImport();
  const [prompt, setPrompt] = useState('');
  const [writerShotId, setWriterShotId] = useState('');
  const writerShots = approvedWriterShots(writerDocument);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [durationSeconds, setDurationSeconds] = useState<number>(5);
  const [selectedOperation, setSelectedOperation] = useState<VideoOperation>('text_to_video');
  const [lastFrame, setLastFrame] = useState<ReferenceImageSelection | null>(null);
  const [referenceImages, setReferenceImages] = useState<readonly ReferenceImageSelection[]>([]);
  const previousReferenceImage = useRef<ReferenceImageSelection | null>(null);
  const operationAvailable = isVideoOperationImplemented(videoModel.id, selectedOperation);
  const operationConstraints = getVideoOperationConstraints(videoModel.id, selectedOperation)
    ?? getVideoOperationConstraints(videoModel.id, 'text_to_video');
  const durationOptions = operationConstraints?.durationSeconds ?? [4, 8];
  const aspectRatioOptions = operationConstraints?.aspectRatios ?? ['16:9', '9:16'];
  // Switching engines keeps the chosen length when valid, else the closest option.
  const effectiveDuration = durationOptions.includes(durationSeconds)
    ? durationSeconds
    : durationOptions.reduce((best, candidate) =>
        Math.abs(candidate - durationSeconds) < Math.abs(best - durationSeconds) ? candidate : best
      );
  const effectiveAspectRatio = aspectRatioOptions.includes(aspectRatio)
    ? aspectRatio
    : aspectRatioOptions[0] ?? '16:9';
  const [selectedStyle, setSelectedStyle] = useState<string>('Cinematic');
  // Image-to-video seed: the bytes travel inline, so no path reaches here.
  const [jobs, setJobs] = useState<readonly VideoGenerationJob[]>([]);
  const [jobInputs, setJobInputs] = useState<Readonly<Record<string, VideoInputSnapshot>>>({});
  const pollTimers = useRef<Set<ReturnType<typeof setInterval>>>(new Set());

  const [isGenerating, setIsGenerating] = useState(false);
  // Which take is being refined, and what to change about it. A note belongs to
  // one job: applying the last one to a different take would be a change nobody
  // asked for on a shot they were happy with.
  const [refiningJobId, setRefiningJobId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  // Nothing to report until something happens; an idle card is just noise.
  const [statusMsg, setStatusMsg] = useState<{ text: string; tone: 'neutral' | 'success' | 'warning' | 'danger' } | null>(null);

  // A still handed over from Image Generation should open the first-frame path,
  // but must not knock Start-End back to image-to-video while its first frame is picked.
  useEffect(() => {
    const newlyHandedOver = referenceImage !== null && referenceImage !== previousReferenceImage.current;
    previousReferenceImage.current = referenceImage;
    if (newlyHandedOver && selectedOperation === 'text_to_video' && isVideoOperationImplemented(videoModel.id, 'image_to_video')) {
      setSelectedOperation('image_to_video');
    }
  }, [referenceImage, selectedOperation, videoModel.id]);

  useEffect(() => {
    if (!isVideoOperationImplemented(videoModel.id, selectedOperation)) setSelectedOperation('text_to_video');
  }, [selectedOperation, videoModel.id]);

  useEffect(() => () => {
    for (const timer of pollTimers.current) clearInterval(timer);
    pollTimers.current.clear();
  }, []);

  /**
   * `overrides` is how a refined take is run: it carries the previous take's
   * own prompt, length, shape and style, so asking for one change does not
   * silently apply whatever the composer happens to be set to now.
   */
  const handleGenerate = async (overrides?: {
    readonly prompt: string;
    readonly aspectRatio: '16:9' | '9:16' | '1:1';
    readonly durationSeconds: number;
    readonly stylePreset?: string;
    readonly inputs?: VideoInputSnapshot;
    readonly modelId?: string;
  }): Promise<void> => {
    const promptText = overrides?.prompt ?? prompt;
    if (promptText.trim().length === 0) {
      setStatusMsg({ text: 'Please enter a video generation prompt.', tone: 'warning' });
      return;
    }

    const inputs: VideoInputSnapshot = overrides?.inputs ?? {
      operation: selectedOperation,
      ...(selectedOperation === 'image_to_video' || selectedOperation === 'start_end'
        ? referenceImage === null ? {} : { referenceImage }
        : {}),
      ...(selectedOperation === 'start_end' && lastFrame !== null ? { lastFrame } : {}),
      ...(selectedOperation === 'reference_to_video' ? { referenceImages } : {})
    };
    const targetModelId = overrides?.modelId ?? videoModel.id;
    if (!isVideoOperationImplemented(targetModelId, inputs.operation)) {
      setStatusMsg({ text: `${videoModel.label} does not implement ${inputs.operation} in this build.`, tone: 'warning' });
      return;
    }
    if ((inputs.operation === 'image_to_video' || inputs.operation === 'start_end') && inputs.referenceImage === undefined) {
      setStatusMsg({ text: 'Choose the first frame before generating.', tone: 'warning' });
      return;
    }
    if (inputs.operation === 'start_end' && inputs.lastFrame === undefined) {
      setStatusMsg({ text: 'Choose the last frame before generating Start-End motion.', tone: 'warning' });
      return;
    }
    if (inputs.operation === 'reference_to_video' && (inputs.referenceImages?.length ?? 0) === 0) {
      setStatusMsg({ text: 'Choose at least one character or product reference.', tone: 'warning' });
      return;
    }

    setIsGenerating(true);
    setStatusMsg({ text: `Submitting ${videoModel.providerLabel} cloud job...`, tone: 'neutral' });

    try {
      const response = await window.videoTool.aiGenerateVideo({
        prompt: promptText,
        aspectRatio: overrides?.aspectRatio ?? effectiveAspectRatio,
        durationSeconds: overrides?.durationSeconds ?? effectiveDuration,
        stylePreset: overrides?.stylePreset ?? selectedStyle,
        modelId: targetModelId,
        ...inputs
      });

      if (response.ok && response.value) {
        const job = response.value as VideoGenerationJob;
        setJobs((prev) => [job, ...prev]);
        setJobInputs((current) => ({ ...current, [job.id]: inputs }));
        setStatusMsg({ text: `Job started (${job.id}). Synthesizing video frames...`, tone: 'neutral' });

        // Poll for job completion
        const pollingDeadline = Date.now() + VIDEO_JOB_UI_TIMEOUT_MS;
        const stopPolling = (intervalId: ReturnType<typeof setInterval>): void => {
          clearInterval(intervalId);
          pollTimers.current.delete(intervalId);
        };
        const intervalId = setInterval(async () => {
          try {
            if (Date.now() > pollingDeadline) {
              stopPolling(intervalId);
              setIsGenerating(false);
              setStatusMsg({ text: 'Stopped waiting after 12 minutes. Check the terminal log for this job before retrying.', tone: 'warning' });
              return;
            }
            const pollRes = await window.videoTool.aiGetVideoJob(job.id);
            if (!pollRes.ok || !pollRes.value) {
              stopPolling(intervalId);
              setIsGenerating(false);
              setStatusMsg({ text: !pollRes.ok ? pollRes.error.message : 'The video job could not be read.', tone: 'danger' });
              return;
            }
            const updatedJob = pollRes.value as VideoGenerationJob;
            setJobs((prev) => prev.map((j) => (j.id === updatedJob.id ? updatedJob : j)));

            if (updatedJob.status === 'completed') {
              stopPolling(intervalId);
              setIsGenerating(false);
              setStatusMsg({ text: `Video generation completed! Asset ready.`, tone: 'success' });
            } else if (updatedJob.status === 'failed') {
              stopPolling(intervalId);
              setIsGenerating(false);
              setStatusMsg({ text: `Generation failed: ${updatedJob.error ?? 'Unknown error'}`, tone: 'danger' });
            }
          } catch (error) {
            stopPolling(intervalId);
            setIsGenerating(false);
            setStatusMsg({ text: error instanceof Error ? error.message : 'Video job polling failed.', tone: 'danger' });
          }
        }, 1000);
        pollTimers.current.add(intervalId);
      } else {
        setIsGenerating(false);
        setStatusMsg({ text: !response.ok ? response.error.message : 'Failed to start generation job.', tone: 'danger' });
      }
    } catch (err) {
      setIsGenerating(false);
      setStatusMsg({ text: err instanceof Error ? err.message : 'Unexpected error during generation.', tone: 'danger' });
    }
  };

  /**
   * The next take of a job, with a note about what to change.
   *
   * The previous prompt is kept whole and the change added to it by the shared
   * rule — the same one the phone uses — because a rewrite loses the parts
   * nobody mentioned, which are the parts a shot is made of.
   */
  const refineJob = (job: VideoGenerationJob): void => {
    const refined = refineShotPrompt(job.prompt, note);
    if (!refined.ok) {
      setStatusMsg({ text: refined.reason, tone: 'warning' });
      return;
    }
    setRefiningJobId(null);
    setNote('');
    // Shown in the composer as well, so what was asked for is visible rather
    // than only implied by a new job appearing.
    setPrompt(refined.prompt);
    void handleGenerate({
      prompt: refined.prompt,
      aspectRatio: job.aspectRatio,
      durationSeconds: job.durationSeconds,
      ...(job.modelId === undefined ? {} : { modelId: job.modelId }),
      ...(job.stylePreset === undefined ? {} : { stylePreset: job.stylePreset }),
      inputs: jobInputs[job.id] ?? { operation: job.operation ?? 'text_to_video' }
    });
  };

  const pickReferenceImage = async (target: 'first' | 'last' | 'asset'): Promise<void> => {
    const response = await window.videoTool.aiSelectReferenceImage();
    if (!response.ok) {
      setStatusMsg({ text: response.error.message, tone: 'danger' });
      return;
    }
    if (response.value === null) return;
    if (target === 'first') onReferenceImageChange(response.value);
    else if (target === 'last') setLastFrame(response.value);
    else setReferenceImages((current) => current.length >= 3 ? current : [...current, response.value as ReferenceImageSelection]);
  };

  const handleImportToProject = async (job: VideoGenerationJob): Promise<void> => {
    if (!job.outputFilePath) return;
    try {
      const status = await importAiResult(job.id);
      setStatusMsg(status);
    } catch (err) {
      setStatusMsg({ text: `Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`, tone: 'danger' });
    }
  };

  return (
    <section className="studio-surface" aria-labelledby="video-generation-title">
      <header className="studio-surface__header">
        <div className="studio-surface__title">
          <h2 className="studio-surface__title-label" id="video-generation-title">Video Generation</h2>
          {/* The picker beside it already names the model and provider. */}
          <span className="studio-surface__title-meta">Cloud video generation</span>
        </div>
        <DomainModelPicker domain="video-generation" ariaLabel="Video model" />
      </header>

      <div className="studio-surface__body">
        <div className="studio-field">
          <span className="studio-field__label">Input mode</span>
          <div className="studio-chips" role="group" aria-label="Video input mode">
            {INPUT_MODES.map((mode) => {
              const available = isVideoOperationImplemented(videoModel.id, mode.id);
              return <button key={mode.id} type="button" disabled={!available}
                title={available ? undefined : `${videoModel.label} does not implement this mode.`}
                aria-pressed={selectedOperation === mode.id}
                className={`studio-chip${selectedOperation === mode.id ? ' studio-chip--selected' : ''}`}
                onClick={() => setSelectedOperation(mode.id)}>{mode.label}</button>;
            })}
          </div>
          <span className="studio-reference__empty">
            {selectedOperation === 'start_end' ? 'Veo builds the motion between two approved frames.'
              : selectedOperation === 'reference_to_video' ? 'Attach 1-3 character or product images. This mode uses an 8-second clip.'
                : selectedOperation === 'image_to_video' ? 'The supplied image becomes the first frame.'
                  : 'Prompt only, without visual references.'}
          </span>
        </div>

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
            {aspectRatioOptions.map((ratio) => (
              <button
                key={ratio}
                type="button"
                aria-pressed={effectiveAspectRatio === ratio}
                className={`studio-chip${effectiveAspectRatio === ratio ? ' studio-chip--selected' : ''}`}
                onClick={() => setAspectRatio(ratio)}
              >
                {ratio}
              </button>
            ))}
          </div>
        </div>

        <div className="studio-field">
          <span className="studio-field__label">Duration</span>
          <div className="studio-chips" role="group" aria-label="Duration">
            {durationOptions.map((sec) => (
              <button
                key={sec}
                type="button"
                aria-pressed={effectiveDuration === sec}
                className={`studio-chip${effectiveDuration === sec ? ' studio-chip--selected' : ''}`}
                onClick={() => setDurationSeconds(sec)}
              >
                {sec}s
              </button>
            ))}
          </div>
        </div>

        {statusMsg !== null && <StatusCard tone={statusMsg.tone}>{statusMsg.text}</StatusCard>}

        {(selectedOperation === 'image_to_video' || selectedOperation === 'start_end') && <div className="studio-field">
          <span className="studio-field__label">First frame</span>
          {referenceImage === null ? (
            <div className="studio-reference">
              <span className="studio-reference__empty">
                Required. Review this image before generation.
              </span>
              <Button variant="ghost" onClick={() => void pickReferenceImage('first')}>Choose first frame</Button>
            </div>
          ) : (
            <div className="studio-reference">
              <img
                className="studio-reference__thumb"
                src={`data:${referenceImage.mimeType};base64,${referenceImage.base64}`}
                alt={`Reference image ${referenceImage.displayName}`}
              />
              <span className="studio-reference__name">{referenceImage.displayName}</span>
              <Button variant="ghost" onClick={() => onReferenceImageChange(null)} aria-label="Remove first frame">
                Remove
              </Button>
            </div>
          )}
        </div>}

        {selectedOperation === 'start_end' && <div className="studio-field">
          <span className="studio-field__label">Last frame</span>
          {lastFrame === null ? <div className="studio-reference">
            <span className="studio-reference__empty">Required. Veo interpolates motion toward this ending.</span>
            <Button variant="ghost" onClick={() => void pickReferenceImage('last')}>Choose last frame</Button>
          </div> : <div className="studio-reference">
            <img className="studio-reference__thumb" src={`data:${lastFrame.mimeType};base64,${lastFrame.base64}`} alt={`Last frame ${lastFrame.displayName}`} />
            <span className="studio-reference__name">{lastFrame.displayName}</span>
            <Button variant="ghost" onClick={() => setLastFrame(null)} aria-label="Remove last frame">Remove</Button>
          </div>}
        </div>}

        {selectedOperation === 'reference_to_video' && <div className="studio-field">
          <span className="studio-field__label">Character / product references ({referenceImages.length}/3)</span>
          {referenceImages.map((image, index) => <div className="studio-reference" key={`${image.displayName}-${index}`}>
            <img className="studio-reference__thumb" src={`data:${image.mimeType};base64,${image.base64}`} alt={`Asset reference ${image.displayName}`} />
            <span className="studio-reference__name">{image.displayName}</span>
            <Button variant="ghost" onClick={() => setReferenceImages((current) => current.filter((_, position) => position !== index))} aria-label={`Remove asset reference ${index + 1}`}>Remove</Button>
          </div>)}
          <div className="studio-reference">
            <span className="studio-reference__empty">Order references deliberately; nothing is attached automatically.</span>
            <Button variant="ghost" disabled={referenceImages.length >= 3} onClick={() => void pickReferenceImage('asset')}>Add reference</Button>
          </div>
        </div>}

        <div className="studio-field">
          <span className="studio-field__label">Jobs</span>
          {jobs.length === 0 ? (
            <p className="studio-empty">No generation jobs yet.</p>
          ) : (
            <ul className="studio-job-list">
              {jobs.map((job) => (
                <li key={job.id} className="studio-job">
                  <div className="studio-job__row">
                    <span className={`studio-job__status studio-job__status--${job.status}`}>{job.status}</span>
                    <span className="studio-job__provider">{job.provider}</span>
                    <span className="studio-job__provider">{job.operation ?? 'text_to_video'}</span>
                  </div>
                  <p className="studio-job__prompt">{originalOf(job.prompt)}</p>
                  {revisionsOf(job.prompt).length > 0 && (
                    <ol className="studio-job__revisions">
                      {revisionsOf(job.prompt).map((revision) => (
                        <li key={revision}>{revision}</li>
                      ))}
                    </ol>
                  )}
                  {job.status === 'completed' && job.outputFilePath !== undefined && (
                    <Button variant="primary" onClick={() => void handleImportToProject(job)}>
                      Import to project
                    </Button>
                  )}
                  {(job.status === 'completed' || job.status === 'failed') && (
                    <Button
                      variant="ghost"
                      disabled={isGenerating}
                      onClick={() => {
                        setNote('');
                        setRefiningJobId(refiningJobId === job.id ? null : job.id);
                      }}
                    >
                      {refiningJobId === job.id ? 'Cancel' : 'Refine'}
                    </Button>
                  )}
                  {refiningJobId === job.id && (
                    <div className="studio-refine">
                      <textarea
                        className="studio-refine__input"
                        rows={2}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        placeholder="What to change — slower, no text on screen…"
                        aria-label={`What to change about this take`}
                      />
                      <Button variant="primary" disabled={note.trim().length === 0} onClick={() => refineJob(job)}>
                        Generate next take
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Composer mirrors the chat prompt card: write, then act. */}
      <div className="studio-composer">
        {writerShots.length > 0 && <div className="studio-field">
          <label className="studio-field__label" htmlFor="writer-video-shot">Approved Writer shot</label>
          <select id="writer-video-shot" disabled={isGenerating} value={writerShotId} onChange={(e) => setWriterShotId(e.target.value)}>
            <option value="">Choose a shot to load into the composer</option>
            {writerShots.map((shot) => <option key={shot.id} value={shot.id}>{shot.label}</option>)}
          </select>
          <Button disabled={isGenerating || !writerShots.some((s) => s.id === writerShotId)} onClick={() => {
            const shot = writerShots.find((s) => s.id === writerShotId);
            if (!shot) return;
            if (!durationOptions.includes(shot.durationSeconds)) {
              setStatusMsg({ tone: 'warning', text: `This shot needs ${shot.durationSeconds}s; the selected operation accepts ${durationOptions.join('/')}s. Choose a compatible model or revise the Writer shot. Nothing was submitted.` });
              return;
            }
            setPrompt(shot.prompt); setDurationSeconds(shot.durationSeconds);
            setStatusMsg({ tone: 'neutral', text: 'Approved shot loaded, not generated. Review the prompt, visual preset and any reference image before pressing Generate. References are not attached automatically.' });
          }}>Use approved shot (no generation)</Button>
        </div>}
        <textarea
          className="studio-composer__input"
          rows={3}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Describe the shot…"
          aria-label="Video prompt"
        />
        <div className="studio-composer__toolbar">
          <span className="studio-composer__hint">
            {effectiveDuration}s · {effectiveAspectRatio} · {selectedStyle} · {selectedOperation}
          </span>
          <Button variant="primary" onClick={() => void handleGenerate()} disabled={isGenerating || prompt.trim().length === 0 || !operationAvailable
            || ((selectedOperation === 'image_to_video' || selectedOperation === 'start_end') && referenceImage === null)
            || (selectedOperation === 'start_end' && lastFrame === null)
            || (selectedOperation === 'reference_to_video' && referenceImages.length === 0)}>
            {isGenerating ? 'Generating…' : 'Generate'}
          </Button>
        </div>
      </div>
    </section>
  );
}
