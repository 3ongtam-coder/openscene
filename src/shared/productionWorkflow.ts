import type { AiProjectDocument, GenerationRecord, ReferenceAsset } from './aiProjectDomain';
import { approvedWriterShots } from './writerPipeline';
import { DEFAULT_CLIP_EFFECTS, type TimelineDocument } from './timelineTypes';
import { placeClip } from './timelineClipLogic';
import { trackAppendStartMs } from './timelineClipPlacement';

export type ProductionShotState =
  | 'not_started'
  | 'generating'
  | 'needs_import'
  | 'needs_review'
  | 'approved'
  | 'failed';

export type ProductionShotRow = {
  readonly shotId: string;
  readonly label: string;
  readonly durationMs: number;
  readonly sceneTitle: string;
  readonly characterIds: readonly string[];
  readonly storyboardReference?: ReferenceAsset;
  readonly characterReferenceIds: readonly string[];
  readonly candidateCount: number;
  readonly state: ProductionShotState;
  readonly approvedGeneration?: GenerationRecord;
};

export type ProductionAssetSummary = {
  readonly id: string;
  readonly kind: 'video' | 'audio' | 'image';
  readonly durationMs: number | null;
};

export type ProductionAssemblyShot = {
  readonly shotId: string;
  readonly assetId: string;
  readonly durationMs: number;
};

export type ProductionAssemblyPlan =
  | { readonly ok: true; readonly shots: readonly ProductionAssemblyShot[]; readonly totalDurationMs: number }
  | { readonly ok: false; readonly reason: string };

export type ProductionMutationResult =
  | { readonly ok: true; readonly document: AiProjectDocument }
  | { readonly ok: false; readonly reason: string };

function stateFor(generations: readonly GenerationRecord[], approved: GenerationRecord | undefined): ProductionShotState {
  if (approved !== undefined) return 'approved';
  const viable = generations.filter((entry) => entry.review?.decision !== 'rejected');
  if (viable.some((entry) => entry.status === 'queued' || entry.status === 'running' || entry.status === 'needs_user_action')) return 'generating';
  if (viable.some((entry) => entry.status === 'completed' && entry.outputAssetIds.length === 0)) return 'needs_import';
  if (viable.some((entry) => entry.status === 'completed' && entry.outputAssetIds.length > 0)) return 'needs_review';
  if (generations.length > 0 && generations.every((entry) => entry.status === 'failed' || entry.status === 'cancelled' || entry.review?.decision === 'rejected')) return 'failed';
  return 'not_started';
}

/** A read model only: persisted Writer/generation data remains authoritative. */
export function productionShotRows(document: AiProjectDocument | null | undefined): readonly ProductionShotRow[] {
  if (document === null || document === undefined) return [];
  const writerShots = approvedWriterShots(document);
  const references = new Map(document.referenceAssets.map((entry) => [entry.id, entry]));
  return writerShots.flatMap((writerShot) => {
    const shot = document.shots.find((entry) => entry.id === writerShot.id);
    const scene = shot === undefined ? undefined : document.scenes.find((entry) => entry.id === shot.sceneId);
    if (shot === undefined || scene === undefined) return [];
    const generations = document.generations.filter((entry) => entry.shotId === shot.id);
    const approvedGeneration = generations.find((entry) => entry.review?.decision === 'approved');
    const storyboardReference = shot.referenceAssetIds
      .map((id) => references.get(id))
      .find((entry) => entry?.role === 'start_frame');
    const characterReferenceIds = scene.characterIds.flatMap((characterId) =>
      document.characters.find((entry) => entry.id === characterId)?.referenceAssetIds ?? []
    ).filter((id, index, values) => values.indexOf(id) === index);
    return [{
      shotId: shot.id,
      label: writerShot.label,
      durationMs: shot.durationMs,
      sceneTitle: scene.title,
      characterIds: scene.characterIds,
      ...(storyboardReference === undefined ? {} : { storyboardReference }),
      characterReferenceIds,
      candidateCount: generations.length,
      state: stateFor(generations, approvedGeneration),
      ...(approvedGeneration === undefined ? {} : { approvedGeneration })
    }];
  });
}

export function assignStoryboardReference(document: AiProjectDocument, input: {
  readonly shotId: string;
  readonly assetId: string;
  readonly referenceId: string;
  readonly label: string;
}): ProductionMutationResult {
  const shot = document.shots.find((entry) => entry.id === input.shotId);
  if (shot === undefined) return { ok: false, reason: 'The Writer shot no longer exists.' };
  if (document.referenceAssets.some((entry) => entry.id === input.referenceId)) return { ok: false, reason: 'The storyboard reference id is already in use.' };
  const oldStartFrames = new Set(shot.referenceAssetIds.filter((id) => document.referenceAssets.some((entry) => entry.id === id && entry.role === 'start_frame')));
  const reference: ReferenceAsset = { id: input.referenceId, assetId: input.assetId, role: 'start_frame', label: input.label.trim() || 'Storyboard first frame' };
  return {
    ok: true,
    document: {
      ...document,
      referenceAssets: [...document.referenceAssets, reference],
      shots: document.shots.map((entry) => entry.id === shot.id ? {
        ...entry,
        referenceAssetIds: [...entry.referenceAssetIds.filter((id) => !oldStartFrames.has(id)), reference.id]
      } : entry)
    }
  };
}

export function clearStoryboardReference(document: AiProjectDocument, shotId: string): ProductionMutationResult {
  const shot = document.shots.find((entry) => entry.id === shotId);
  if (shot === undefined) return { ok: false, reason: 'The Writer shot no longer exists.' };
  const startFrames = new Set(shot.referenceAssetIds.filter((id) => document.referenceAssets.some((entry) => entry.id === id && entry.role === 'start_frame')));
  return {
    ok: true,
    document: {
      ...document,
      shots: document.shots.map((entry) => entry.id === shot.id
        ? { ...entry, referenceAssetIds: entry.referenceAssetIds.filter((id) => !startFrames.has(id)) }
        : entry)
    }
  };
}

export function addCharacterReference(document: AiProjectDocument, input: {
  readonly characterId: string;
  readonly assetId: string;
  readonly referenceId: string;
  readonly label: string;
}): ProductionMutationResult {
  const character = document.characters.find((entry) => entry.id === input.characterId);
  if (character === undefined) return { ok: false, reason: 'The Writer character no longer exists.' };
  if (character.referenceAssetIds.length >= 3) return { ok: false, reason: 'A character can have at most three active reference images.' };
  if (character.referenceAssetIds.some((id) => document.referenceAssets.find((entry) => entry.id === id)?.assetId === input.assetId)) {
    return { ok: false, reason: 'That image is already assigned to this character.' };
  }
  if (document.referenceAssets.some((entry) => entry.id === input.referenceId)) return { ok: false, reason: 'The character reference id is already in use.' };
  const reference: ReferenceAsset = { id: input.referenceId, assetId: input.assetId, role: 'character', label: input.label.trim() || character.name };
  return {
    ok: true,
    document: {
      ...document,
      referenceAssets: [...document.referenceAssets, reference],
      characters: document.characters.map((entry) => entry.id === character.id
        ? { ...entry, referenceAssetIds: [...entry.referenceAssetIds, reference.id] }
        : entry)
    }
  };
}

export function removeCharacterReference(document: AiProjectDocument, characterId: string, referenceId: string): ProductionMutationResult {
  const character = document.characters.find((entry) => entry.id === characterId);
  if (character === undefined) return { ok: false, reason: 'The Writer character no longer exists.' };
  return {
    ok: true,
    document: {
      ...document,
      characters: document.characters.map((entry) => entry.id === character.id
        ? { ...entry, referenceAssetIds: entry.referenceAssetIds.filter((id) => id !== referenceId) }
        : entry)
    }
  };
}

export function buildApprovedProductionAssemblyPlan(
  document: AiProjectDocument | null | undefined,
  assets: readonly ProductionAssetSummary[]
): ProductionAssemblyPlan {
  const rows = productionShotRows(document);
  if (rows.length === 0) return { ok: false, reason: 'Approve and save the Writer prompt stage before assembling a production cut.' };
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const usedAssetIds = new Set<string>();
  const shots: ProductionAssemblyShot[] = [];
  for (const row of rows) {
    const generation = row.approvedGeneration;
    if (generation === undefined) return { ok: false, reason: `${row.label} does not have an approved candidate.` };
    if (generation.status !== 'completed') return { ok: false, reason: `${row.label} is approved but is not completed.` };
    const assetId = generation.outputAssetIds[0];
    const asset = assetId === undefined ? undefined : byId.get(assetId);
    if (asset === undefined) return { ok: false, reason: `${row.label} has no available approved output asset.` };
    if (asset.kind !== 'video') return { ok: false, reason: `${row.label} approved output is not a video.` };
    if (asset.durationMs === null || asset.durationMs <= 0) return { ok: false, reason: `Analyze ${row.label} video metadata before assembling the cut.` };
    if (usedAssetIds.has(asset.id)) return { ok: false, reason: `${row.label} reuses an approved video from another shot. Review the candidate mapping before assembling.` };
    usedAssetIds.add(asset.id);
    shots.push({ shotId: row.shotId, assetId: asset.id, durationMs: asset.durationMs });
  }
  return { ok: true, shots, totalDurationMs: shots.reduce((total, shot) => total + shot.durationMs, 0) };
}

export function assembleApprovedProductionCut(input: {
  readonly timeline: TimelineDocument;
  readonly plan: Extract<ProductionAssemblyPlan, { readonly ok: true }>;
  readonly targetTrackId: string;
  readonly clipIdForShot: (shotId: string) => string;
}): { readonly ok: true; readonly timeline: TimelineDocument } | { readonly ok: false; readonly reason: string } {
  const track = input.timeline.tracks.find((entry) => entry.id === input.targetTrackId);
  if (track === undefined || track.kind !== 'video') return { ok: false, reason: 'Choose an existing video track for the production cut.' };
  const approvedAssets = new Set(input.plan.shots.map((entry) => entry.assetId));
  if (input.timeline.tracks.some((entry) => entry.clips.some((clip) => approvedAssets.has(clip.assetId)))) {
    return { ok: false, reason: 'At least one approved shot is already on the timeline. Remove or arrange existing production clips manually before assembling again.' };
  }
  let timeline = input.timeline;
  let cursor = trackAppendStartMs(track);
  for (const shot of input.plan.shots) {
    const next = placeClip(timeline, {
      trackId: track.id,
      clip: {
        id: input.clipIdForShot(shot.shotId),
        assetId: shot.assetId,
        timelineStartMs: cursor,
        sourceStartMs: 0,
        sourceEndMs: shot.durationMs,
        sourceDurationMs: shot.durationMs,
        effects: { ...DEFAULT_CLIP_EFFECTS },
        keyframes: []
      }
    });
    if (next === null) return { ok: false, reason: 'The production cut could not be placed without overlapping or duplicating clips.' };
    timeline = next;
    cursor += shot.durationMs;
  }
  return { ok: true, timeline };
}
