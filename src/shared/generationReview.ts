import {
  CONTINUITY_REVIEW_FIELDS,
  type AiGenerationStatus,
  type AiProjectDocument,
  type ContinuityReview,
  type ContinuityReviewField,
  type ContinuityReviewValue,
  type GenerationRecord,
  type GenerationReviewDecision
} from './aiProjectDomain';
import type { VideoOperation } from './mediaCapabilityRegistry';

export function emptyContinuityReview(): ContinuityReview {
  return {
    identity: 'unchecked',
    wardrobeProps: 'unchecked',
    settingPalette: 'unchecked',
    motionDirection: 'unchecked',
    boundaryMatch: 'unchecked'
  };
}

export type AddGenerationCandidateInput = {
  readonly id: string;
  readonly shotId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly capability: VideoOperation;
  readonly prompt: string;
  readonly createdAt: string;
  readonly parentGenerationId?: string;
  readonly referenceAssetIds?: readonly string[];
};

export type GenerationReviewResult =
  | { readonly ok: true; readonly document: AiProjectDocument }
  | { readonly ok: false; readonly reason: string };

export function candidateApprovalBlockReason(candidate: Pick<GenerationRecord, 'status' | 'outputAssetIds' | 'review'>): string | null {
  const review = candidate.review ?? { decision: 'pending' as const, continuity: emptyContinuityReview(), notes: '' };
  if (candidate.status !== 'completed') return 'Only a completed candidate can be approved.';
  if (candidate.outputAssetIds.length === 0) return 'Import the candidate into the project before approving it.';
  const values = CONTINUITY_REVIEW_FIELDS.map((field) => review.continuity[field]);
  if (values.includes('unchecked')) return 'Review every continuity item before approval.';
  if (values.includes('fail')) return 'Fix or rerun every failed continuity item before approval.';
  if (values.includes('warning') && review.notes.trim().length === 0) return 'Add a note explaining any accepted continuity warning.';
  return null;
}

export function addGenerationCandidate(
  document: AiProjectDocument,
  input: AddGenerationCandidateInput
): GenerationReviewResult {
  const shot = document.shots.find((entry) => entry.id === input.shotId);
  if (shot === undefined) return { ok: false, reason: 'The Writer shot no longer exists.' };
  if (document.generations.some((entry) => entry.id === input.id)) return { ok: false, reason: 'This generation attempt is already recorded.' };
  if (input.parentGenerationId !== undefined) {
    const parent = document.generations.find((entry) => entry.id === input.parentGenerationId);
    if (parent === undefined || parent.shotId !== input.shotId) return { ok: false, reason: 'The previous take does not belong to this Writer shot.' };
  }
  const generation: GenerationRecord = {
    id: input.id,
    shotId: input.shotId,
    providerId: input.providerId,
    modelId: input.modelId,
    capability: input.capability,
    status: 'queued',
    prompt: input.prompt,
    referenceAssetIds: input.referenceAssetIds ?? [],
    outputAssetIds: [],
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    ...(input.parentGenerationId === undefined ? {} : { parentGenerationId: input.parentGenerationId }),
    review: { decision: 'pending', continuity: emptyContinuityReview(), notes: '' }
  };
  return {
    ok: true,
    document: {
      ...document,
      shots: document.shots.map((entry) => entry.id === shot.id
        ? { ...entry, generationIds: [...entry.generationIds, generation.id] }
        : entry),
      generations: [...document.generations, generation]
    }
  };
}

export function updateGenerationCandidate(
  document: AiProjectDocument,
  generationId: string,
  update: {
    readonly status?: AiGenerationStatus;
    readonly outputAssetIds?: readonly string[];
    readonly error?: string;
    readonly updatedAt: string;
  }
): GenerationReviewResult {
  const generation = document.generations.find((entry) => entry.id === generationId);
  if (generation === undefined) return { ok: false, reason: 'The generation attempt is no longer in this project.' };
  const outputAssetIds = update.outputAssetIds ?? generation.outputAssetIds;
  const review = generation.review?.decision === 'approved' && outputAssetIds.length === 0
    ? (({ reviewedAt: _reviewedAt, ...current }) => ({ ...current, decision: 'pending' as const }))(generation.review)
    : generation.review;
  return {
    ok: true,
    document: {
      ...document,
      generations: document.generations.map((entry) => entry.id === generationId ? {
        ...entry,
        ...(update.status === undefined ? {} : { status: update.status }),
        ...(update.outputAssetIds === undefined ? {} : { outputAssetIds: update.outputAssetIds }),
        ...(update.error === undefined ? {} : { error: update.error }),
        updatedAt: update.updatedAt,
        ...(review === undefined ? {} : { review })
      } : entry)
    }
  };
}

export function setCandidateContinuity(
  document: AiProjectDocument,
  generationId: string,
  field: ContinuityReviewField,
  value: ContinuityReviewValue,
  notes: string
): GenerationReviewResult {
  const generation = document.generations.find((entry) => entry.id === generationId);
  if (generation === undefined) return { ok: false, reason: 'The generation attempt is no longer in this project.' };
  const review = generation.review ?? { decision: 'pending' as const, continuity: emptyContinuityReview(), notes: '' };
  const { reviewedAt: _reviewedAt, ...pendingReview } = review;
  return {
    ok: true,
    document: {
      ...document,
      generations: document.generations.map((entry) => entry.id === generationId ? {
        ...entry,
        review: { ...pendingReview, decision: 'pending', continuity: { ...review.continuity, [field]: value }, notes }
      } : entry)
    }
  };
}

export function setCandidateReviewNotes(
  document: AiProjectDocument,
  generationId: string,
  notes: string
): GenerationReviewResult {
  const generation = document.generations.find((entry) => entry.id === generationId);
  if (generation === undefined) return { ok: false, reason: 'The generation attempt is no longer in this project.' };
  const review = generation.review ?? { decision: 'pending' as const, continuity: emptyContinuityReview(), notes: '' };
  const { reviewedAt: _reviewedAt, ...pendingReview } = review;
  return {
    ok: true,
    document: {
      ...document,
      generations: document.generations.map((entry) => entry.id === generationId
        ? { ...entry, review: { ...pendingReview, decision: 'pending', notes } }
        : entry)
    }
  };
}

export function decideGenerationCandidate(
  document: AiProjectDocument,
  generationId: string,
  decision: Exclude<GenerationReviewDecision, 'pending'>,
  notes: string,
  reviewedAt: string
): GenerationReviewResult {
  const generation = document.generations.find((entry) => entry.id === generationId);
  if (generation === undefined) return { ok: false, reason: 'The generation attempt is no longer in this project.' };
  const review = generation.review ?? { decision: 'pending' as const, continuity: emptyContinuityReview(), notes: '' };
  if (decision === 'approved') {
    const blocked = candidateApprovalBlockReason({ ...generation, review: { ...review, notes } });
    if (blocked !== null) return { ok: false, reason: blocked };
  }
  return {
    ok: true,
    document: {
      ...document,
      generations: document.generations.map((entry) => {
        if (entry.id === generationId) return { ...entry, review: { ...review, decision, notes: notes.trim(), reviewedAt } };
        if (decision === 'approved' && entry.shotId === generation.shotId && entry.review?.decision === 'approved') {
          return { ...entry, review: { ...entry.review, decision: 'rejected', reviewedAt } };
        }
        return entry;
      })
    }
  };
}
