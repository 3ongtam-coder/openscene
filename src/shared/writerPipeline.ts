import type { AiProjectDocument } from './aiProjectDomain';
import { isPlainRecord } from './timelineValidationPrimitives';
import {
  applyWriterDraft, parseWriterRequest, validateWriterDraft, validateWriterResponse,
  writerDraftDurationSeconds, type WriterDraft, type WriterDraftShot, type WriterRequest
} from './writerWorkflow';
import {
  WRITER_STAGES, canOpenWriterStage, parseWriterPipelineState, putWriterArtifact,
  type WriterPipelineState, type WriterStage, type WriterStageArtifact
} from './writerStages';

export function pipelineBaseRequest(state: WriterPipelineState | undefined): WriterRequest | null {
  if (!state) return null;
  try {
    const request = parseWriterRequest(JSON.parse(state.requestJson));
    return request?.stage === undefined ? request : null;
  } catch { return null; }
}

export function startWriterPipeline(request: WriterRequest): WriterPipelineState {
  const parsed = parseWriterRequest(request);
  if (!parsed || parsed.stage !== undefined) throw new Error('Complete the brief; duration must be a whole number from 4 to 7200 seconds.');
  return { requestJson: JSON.stringify(parsed), artifacts: [] };
}

export function pipelineMatchesBrief(state: WriterPipelineState | undefined, request: WriterRequest): boolean {
  const parsed = parseWriterRequest(request);
  return parsed !== null && state?.requestJson === JSON.stringify(parsed);
}

export function buildWriterStageRequest(state: WriterPipelineState, stage: WriterStage, revisionInstructions = '', includeCurrentDraft = false): WriterRequest {
  const base = pipelineBaseRequest(state);
  if (!base || !canOpenWriterStage(state, stage)) throw new Error('Save and approve every preceding stage before continuing.');
  const request = parseWriterRequest({
    ...base, stage, revisionInstructions,
    ...(includeCurrentDraft && state.artifacts.find((a) => a.stage === stage) ? { currentStageText: state.artifacts.find((a) => a.stage === stage)!.content } : {}),
    approvedContext: WRITER_STAGES.slice(0, WRITER_STAGES.indexOf(stage)).map((previous) => ({
      stage: previous, content: state.artifacts.find((a) => a.stage === previous)!.content
    }))
  });
  if (!request) throw new Error('The approved stage documents exceed Writer limits or are invalid.');
  return request;
}

export function artifactFromWriterDraft(stage: WriterStage, draft: WriterDraft, modelId: string): WriterStageArtifact {
  return { stage, title: draft.title, content: stage === 'prompts' ? JSON.stringify(draft, null, 2) : draft.screenplay, modelId, approved: false };
}

export function parseWriterPromptText(content: string): WriterDraft | null {
  try {
    const raw: unknown = JSON.parse(content);
    if (!isPlainRecord(raw) || !Array.isArray(raw.scenes)) return null;
    const scenes: unknown[] = [];
    for (const scene of raw.scenes) {
      if (!isPlainRecord(scene) || !Array.isArray(scene.shots)) return null;
      const shots: unknown[] = [];
      for (const shot of scene.shots) {
        if (!isPlainRecord(shot)) return null;
        // While typing, an action may temporarily be empty. Approval remains strict.
        shots.push({ ...shot, action: typeof shot.action === 'string' && shot.action.length <= 20_000 && !shot.action.trim() ? '.' : shot.action });
      }
      scenes.push({ ...scene, shots });
    }
    if (!validateWriterDraft({ ...raw, scenes }).ok) return null;
    // Preserve whitespace and partially typed action text; do not normalize each keystroke.
    return raw as WriterDraft;
  }
  catch { return null; }
}

/** Both UIs edit the exact JSON that is validated, approved and finally imported. */
export function editWriterPromptShot(content: string, sceneIndex: number, shotIndex: number, patch: Partial<WriterDraftShot>): string {
  const draft = parseWriterPromptText(content);
  if (!draft?.scenes[sceneIndex]?.shots[shotIndex]) throw new Error('The selected shot is not in a valid production draft.');
  const next = { ...draft, scenes: draft.scenes.map((scene, si) => si === sceneIndex ? {
    ...scene, shots: scene.shots.map((shot, sh) => sh === shotIndex ? { ...shot, ...patch } : shot)
  } : scene) };
  return JSON.stringify(next, null, 2);
}

export function validateWriterArtifact(state: WriterPipelineState, artifact: WriterStageArtifact): WriterDraft {
  const request = buildWriterStageRequest(state, artifact.stage);
  let decoded: unknown;
  if (artifact.stage === 'prompts') {
    try { decoded = JSON.parse(artifact.content); } catch { throw new Error('Video prompt JSON is invalid. Fix the syntax before saving.'); }
  } else decoded = { title: artifact.title, screenplay: artifact.content };
  const result = validateWriterResponse(decoded, request);
  if (!result.ok) throw new Error(`${result.issue.path}: ${result.issue.message}`);
  return { ...result.value, title: artifact.title.trim() };
}

export function saveWriterArtifact(state: WriterPipelineState, artifact: WriterStageArtifact, approve: boolean): WriterPipelineState {
  if (!approve) {
    // Incomplete JSON can be saved locally as a draft. Only approval is a quality/contract gate.
    const next = putWriterArtifact(state, { ...artifact, approved: false });
    const safe = { ...next, artifacts: next.artifacts.map((a) =>
      WRITER_STAGES.indexOf(a.stage) > WRITER_STAGES.indexOf(artifact.stage) ? { ...a, approved: false } : a) };
    if (!parseWriterPipelineState(safe)) throw new Error('Enter a nonempty title and content within Writer limits before saving.');
    return safe;
  }
  const draft = validateWriterArtifact(state, artifact);
  const base = pipelineBaseRequest(state)!;
  if (approve && artifact.stage === 'prompts' && writerDraftDurationSeconds(draft) !== base.targetDurationSeconds) {
    throw new Error(`Shot total is ${writerDraftDurationSeconds(draft)}s; the brief requests ${base.targetDurationSeconds}s. Adjust the shots or revise the breakdown before approval.`);
  }
  const normalized = { ...artifactFromWriterDraft(artifact.stage, draft, artifact.modelId), approved: approve };
  const next = putWriterArtifact(state, normalized);
  // Revoking approval without changing text also revokes dependent approvals.
  const safe = approve ? next : { ...next, artifacts: next.artifacts.map((a) =>
    WRITER_STAGES.indexOf(a.stage) > WRITER_STAGES.indexOf(artifact.stage) ? { ...a, approved: false } : a) };
  if (!parseWriterPipelineState(safe)) throw new Error('Writer stage could not be saved: invalid state.');
  return safe;
}

export function applyWriterPipeline(document: AiProjectDocument, state: WriterPipelineState, createdAt: string, idPrefix: string) {
  if (state.appliedScriptId && document.scripts.some((s) => s.id === state.appliedScriptId)) {
    return { ok: false as const, message: 'These production scenes have already been saved. Revise a stage to create a new version.' };
  }
  if (!WRITER_STAGES.every((stage) => state.artifacts.some((a) => a.stage === stage && a.approved))) {
    return { ok: false as const, message: 'Approve all four Writer stages before creating production scenes.' };
  }
  try {
    const artifact = state.artifacts.find((a) => a.stage === 'prompts')!;
    const draft = validateWriterArtifact(state, artifact);
    if (!validateWriterDraft(draft).ok) throw new Error('The final production draft is invalid.');
    // Re-run duration/approval validation at the actual write boundary.
    saveWriterArtifact(state, artifact, true);
    const result = applyWriterDraft({ document: { ...document, writerPipeline: state }, request: buildWriterStageRequest(state, 'prompts'), draft, createdAt, idPrefix });
    return result.ok ? { ...result, document: { ...result.document, writerPipeline: { ...state, appliedScriptId: result.scriptId } } } : result;
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : 'Invalid Writer pipeline.' };
  }
}

/** A manual handoff only: callers fill a composer, never submit a provider job. */
export function approvedWriterShots(projectData: AiProjectDocument | null | undefined): readonly {
  readonly id: string; readonly label: string; readonly prompt: string; readonly durationSeconds: number;
}[] {
  const state = projectData?.writerPipeline;
  if (!state?.appliedScriptId || !projectData?.scripts.some((s) => s.id === state.appliedScriptId) ||
    !WRITER_STAGES.every((stage) => state.artifacts.some((a) => a.stage === stage && a.approved))) return [];
  try {
    const draft = validateWriterArtifact(state, state.artifacts.find((a) => a.stage === 'prompts')!);
    return draft.scenes.flatMap((scene, si) => scene.shots.map((shot, sh) => ({
      id: `${state.appliedScriptId}:${si}:${sh}`,
      label: `${scene.title} / shot ${sh + 1} (${shot.durationSeconds}s)`,
      durationSeconds: shot.durationSeconds,
      prompt: [
        `Scene: ${scene.title}. Setting: ${scene.setting}. Time: ${scene.timeOfDay}.`,
        ...draft.characters.filter((c) => scene.characterNames.includes(c.name)).map((c) => `Character ${c.name}: ${c.invariantDescription}`),
        `Visual style: ${draft.styleBible.palette.join(', ')}. ${draft.styleBible.lighting}. ${draft.styleBible.cameraGrammar}. ${draft.styleBible.texture}.`,
        `Framing: ${shot.framing}. Camera motion: ${shot.cameraMotion}.`,
        shot.action,
        shot.dialogue ? `Spoken lines: ${shot.dialogue}` : 'No spoken dialogue.',
        `Audio: ${shot.audioCues.join('; ')}`,
        `Continuity: ${scene.continuityNotes}`,
        `Avoid: ${[shot.negativePrompt, ...draft.styleBible.forbiddenChanges].filter(Boolean).join('; ')}`
      ].join('\n')
    })));
  } catch { return []; }
}
