import { describe, expect, it } from 'vitest';

import { createEmptyAiProjectDocument } from '../src/shared/aiProjectDomain';
import { applyWriterPipeline, artifactFromWriterDraft, saveWriterArtifact, startWriterPipeline } from '../src/shared/writerPipeline';
import type { WriterDraft, WriterRequest } from '../src/shared/writerWorkflow';
import type { WriterStageArtifact } from '../src/shared/writerStages';
import {
  addCharacterReference,
  assembleApprovedProductionCut,
  assignStoryboardReference,
  buildApprovedProductionAssemblyPlan,
  clearStoryboardReference,
  productionShotRows,
  removeCharacterReference
} from '../src/shared/productionWorkflow';
import { createInitialTimeline } from '../src/shared/timelineLogic';

const request: WriterRequest = { mode: 'idea_to_script', sourceText: 'Story', language: 'English', audience: 'All', tone: 'Cinematic', targetDurationSeconds: 8, videoStyle: 'cinematic-narrative', emotionalGoal: 'entertain' };
const draft: WriterDraft = {
  title: 'Film', screenplay: 'Full screenplay',
  characters: [{ name: 'Ari', invariantDescription: 'Red coat' }],
  styleBible: { palette: ['blue'], lighting: 'soft', cameraGrammar: 'locked', texture: 'film', forbiddenChanges: [] },
  scenes: [{ title: 'Scene', objective: 'Act', setting: 'Room', timeOfDay: 'Day', characterNames: ['Ari'], continuityNotes: 'Same coat', shots: [
    { durationSeconds: 4, framing: 'Wide', cameraMotion: 'Still', action: 'Ari enters', dialogue: '', audioCues: [], negativePrompt: '' },
    { durationSeconds: 4, framing: 'Close', cameraMotion: 'Push', action: 'Ari smiles', dialogue: '', audioCues: [], negativePrompt: '' }
  ] }]
};
const artifact = (stage: 'concept' | 'screenplay' | 'breakdown', content = stage): WriterStageArtifact => ({ stage, title: 'Film', content, modelId: 'test', approved: false });

function project() {
  let state = startWriterPipeline(request);
  for (const stage of ['concept', 'screenplay', 'breakdown'] as const) state = saveWriterArtifact(state, artifact(stage), true);
  state = saveWriterArtifact(state, artifactFromWriterDraft('prompts', draft, 'test'), true);
  const applied = applyWriterPipeline(createEmptyAiProjectDocument(), state, '2026-09-07T00:00:00.000Z', 'production');
  if (!applied.ok) throw new Error(applied.message);
  return applied.document;
}

function approvedProject() {
  const base = project();
  const generations = base.shots.map((shot, index) => ({
    id: `generation-${index}`, shotId: shot.id, providerId: 'gemini_veo', modelId: 'veo', capability: 'image_to_video' as const,
    status: 'completed' as const, prompt: shot.action, referenceAssetIds: [], outputAssetIds: [`video-${index}`],
    createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:01:00.000Z',
    review: { decision: 'approved' as const, continuity: { identity: 'pass' as const, wardrobeProps: 'pass' as const, settingPalette: 'pass' as const, motionDirection: 'pass' as const, boundaryMatch: 'pass' as const }, notes: '', reviewedAt: '2026-09-07T00:02:00.000Z' }
  }));
  return { ...base, shots: base.shots.map((shot, index) => ({ ...shot, generationIds: [generations[index]!.id] })), generations };
}

describe('production storyboard workflow', () => {
  it('derives ordered rows and maps storyboard plus character references without a second manifest', () => {
    const base = project();
    const [first] = base.shots;
    const [character] = base.characters;
    if (!first || !character) throw new Error('fixture missing');
    const storyboard = assignStoryboardReference(base, { shotId: first.id, assetId: 'image-board', referenceId: 'ref-board', label: 'Board' });
    expect(storyboard.ok).toBe(true);
    if (!storyboard.ok) return;
    const characterResult = addCharacterReference(storyboard.document, { characterId: character.id, assetId: 'image-character', referenceId: 'ref-character', label: 'Ari' });
    expect(characterResult.ok).toBe(true);
    if (!characterResult.ok) return;
    const rows = productionShotRows(characterResult.document);
    expect(rows.map((row) => row.state)).toEqual(['not_started', 'not_started']);
    expect(rows[0]?.storyboardReference?.assetId).toBe('image-board');
    expect(rows[0]?.characterReferenceIds).toEqual(['ref-character']);

    const cleared = clearStoryboardReference(characterResult.document, first.id);
    const removed = cleared.ok ? removeCharacterReference(cleared.document, character.id, 'ref-character') : cleared;
    expect(removed.ok && productionShotRows(removed.document)[0]?.storyboardReference).toBeUndefined();
    expect(removed.ok && removed.document.characters[0]?.referenceAssetIds).toEqual([]);
  });

  it('blocks partial assembly and appends every approved take exactly once in Writer order', () => {
    const base = approvedProject();
    expect(buildApprovedProductionAssemblyPlan({ ...base, generations: base.generations.slice(0, 1), shots: base.shots.map((shot, index) => ({ ...shot, generationIds: index === 0 ? ['generation-0'] : [] })) }, [
      { id: 'video-0', kind: 'video', durationMs: 4_000 }
    ])).toMatchObject({ ok: false, reason: expect.stringContaining('does not have an approved candidate') });

    const plan = buildApprovedProductionAssemblyPlan(base, [
      { id: 'video-0', kind: 'video', durationMs: 4_100 },
      { id: 'video-1', kind: 'video', durationMs: 3_900 }
    ]);
    expect(plan).toMatchObject({ ok: true, totalDurationMs: 8_000 });
    if (!plan.ok) return;
    const assembled = assembleApprovedProductionCut({
      timeline: createInitialTimeline(), plan, targetTrackId: 'video-track-1', clipIdForShot: (id) => `clip-${id}`
    });
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;
    expect(assembled.timeline.tracks[0]?.clips.map((clip) => [clip.assetId, clip.timelineStartMs])).toEqual([
      ['video-0', 0], ['video-1', 4_100]
    ]);
    expect(assembleApprovedProductionCut({
      timeline: assembled.timeline, plan, targetTrackId: 'video-track-1', clipIdForShot: (id) => `again-${id}`
    })).toMatchObject({ ok: false, reason: expect.stringContaining('already on the timeline') });
  });

  it('rejects reused output assets and leaves the input timeline unchanged after a placement failure', () => {
    const base = approvedProject();
    const reused = {
      ...base,
      generations: base.generations.map((generation) => ({ ...generation, outputAssetIds: ['video-0'] }))
    };
    expect(buildApprovedProductionAssemblyPlan(reused, [
      { id: 'video-0', kind: 'video', durationMs: 4_000 }
    ])).toMatchObject({ ok: false, reason: expect.stringContaining('reuses an approved video') });

    const plan = buildApprovedProductionAssemblyPlan(base, [
      { id: 'video-0', kind: 'video', durationMs: 4_000 },
      { id: 'video-1', kind: 'video', durationMs: 4_000 }
    ]);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const original = createInitialTimeline();
    const result = assembleApprovedProductionCut({
      timeline: original, plan, targetTrackId: 'video-track-1', clipIdForShot: () => 'duplicate-clip-id'
    });
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('overlapping or duplicating') });
    expect(original.tracks[0]?.clips).toEqual([]);
  });

  it('does not present a rejected completed take as still awaiting review', () => {
    const base = approvedProject();
    const rejected = {
      ...base,
      generations: base.generations.map((generation, index) => index === 0 ? {
        ...generation,
        review: { ...generation.review, decision: 'rejected' as const }
      } : generation)
    };
    expect(productionShotRows(rejected).map((row) => row.state)).toEqual(['failed', 'approved']);
  });
});
