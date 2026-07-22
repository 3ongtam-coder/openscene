import { chmod, mkdir, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { createInitialTimeline } from '../shared/timelineLogic';
import { PROJECT_SCHEMA_VERSION } from '../shared/timelineTypes';
import type {
  CreateProjectInput,
  LocalProjectSnapshot,
  LocalProjectSummary,
  MediaAsset,
  TimelineDocument,
  UpdateAssetMetadataInput
} from '../shared/timelineTypes';
import { parseCreateProjectInput, parseTimelineDocument, parseUpdateAssetMetadataInput } from '../shared/timelineValidators';
import { assertAssetImportQuota, DEFAULT_ASSET_IMPORT_LIMITS, type AssetImportLimits } from './assetImportPolicy';
import {
  ProjectStoreError,
  isOpaqueId,
  projectDirectory,
  readProjectSnapshot,
  writeProjectSnapshot
} from './projectStoreSupport';
import { findInvalidAssetRelation, parsePersistedProject, type InvalidAssetRelation } from './projectSnapshotCodec';

const projectMutationGates = new Map<string, Promise<void>>();

type RegisterAssetsInput = {
  readonly projectId: string;
  readonly assets: readonly MediaAsset[];
  readonly limits: AssetImportLimits;
};

function invalidAssetRelationMessage(relation: InvalidAssetRelation): string {
  switch (relation.reason) {
    case 'unavailable':
      return `Timeline clip ${relation.clipId} references an unavailable ${relation.trackKind} asset.`;
    case 'metadata_missing':
      return `Timeline clip ${relation.clipId} requires known asset metadata.`;
    case 'duration_mismatch':
      return `Timeline clip ${relation.clipId} has inconsistent asset duration.`;
    case 'bounds_exceeded':
      return `Timeline clip ${relation.clipId} exceeds its asset duration.`;
  }
}

export class ProjectStore {
  private readonly rootDirectory: string;

  constructor(rootDirectory: string) {
    this.rootDirectory = resolve(rootDirectory);
  }

  async create(input: CreateProjectInput, now = new Date()): Promise<LocalProjectSnapshot> {
    const parsedInput = parseCreateProjectInput(input);
    if (parsedInput === null) {
      throw new ProjectStoreError('Invalid project creation input.');
    }
    await this.ensureRoot();
    const id = randomUUID();
    const directory = projectDirectory(this.rootDirectory, id);
    const timestamp = now.toISOString();
    const snapshot: LocalProjectSnapshot = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id,
      name: parsedInput.name,
      createdAt: timestamp,
      updatedAt: timestamp,
      assets: [],
      timeline: createInitialTimeline()
    };
    await mkdir(directory, { mode: 0o700 });
    try {
      await writeProjectSnapshot(this.rootDirectory, snapshot);
      return snapshot;
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  async list(): Promise<readonly LocalProjectSummary[]> {
    await this.ensureRoot();
    const entries = await readdir(this.rootDirectory, { withFileTypes: true });
    const snapshots = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && isOpaqueId(entry.name))
        .map((entry) => this.open(entry.name))
    );
    return snapshots
      .filter((snapshot): snapshot is LocalProjectSnapshot => snapshot !== null)
      .map(({ id, name, createdAt, updatedAt }) => ({ id, name, createdAt, updatedAt }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
  }

  async open(projectId: string): Promise<LocalProjectSnapshot | null> {
    return readProjectSnapshot(this.rootDirectory, projectId);
  }

  async saveTimeline(projectId: string, timeline: TimelineDocument, now = new Date()): Promise<LocalProjectSnapshot> {
    const parsedTimeline = parseTimelineDocument(timeline);
    if (parsedTimeline === null) {
      throw new ProjectStoreError('Invalid timeline document.');
    }
    return this.mutateProject(projectId, async () => {
      const current = await this.requireProject(projectId);
      const invalidRelation = findInvalidAssetRelation(parsedTimeline, current.assets);
      if (invalidRelation !== null) {
        throw new ProjectStoreError(invalidAssetRelationMessage(invalidRelation));
      }
      return this.persist({ ...current, updatedAt: now.toISOString(), timeline: parsedTimeline });
    });
  }

  async registerAsset(projectId: string, asset: MediaAsset, now = new Date()): Promise<MediaAsset> {
    const registered = await this.registerAssets(
      { projectId, assets: [asset], limits: DEFAULT_ASSET_IMPORT_LIMITS },
      now
    );
    const firstAsset = registered[0];
    if (firstAsset === undefined) {
      throw new ProjectStoreError('Asset registration produced no asset.');
    }
    return firstAsset;
  }

  async registerAssets(input: RegisterAssetsInput, now = new Date()): Promise<readonly MediaAsset[]> {
    return this.mutateProject(input.projectId, async () => {
      const current = await this.requireProject(input.projectId);
      const incomingIds = new Set(input.assets.map((asset) => asset.id));
      if (incomingIds.size !== input.assets.length || current.assets.some((asset) => incomingIds.has(asset.id))) {
        throw new ProjectStoreError('Asset registration contains a duplicate asset id.');
      }
      assertAssetImportQuota(
        {
          selectedFileBytes: input.assets.map((asset) => asset.byteLength),
          existingProjectBytes: current.assets.reduce((total, asset) => total + asset.byteLength, 0)
        },
        input.limits
      );
      await this.persist({ ...current, updatedAt: now.toISOString(), assets: [...current.assets, ...input.assets] });
      return input.assets;
    });
  }

  async updateAssetMetadata(input: UpdateAssetMetadataInput, now = new Date()): Promise<MediaAsset> {
    const parsedInput = parseUpdateAssetMetadataInput(input);
    if (parsedInput === null) {
      throw new ProjectStoreError('Invalid asset metadata input.');
    }
    return this.mutateProject(parsedInput.projectId, async () => {
      const current = await this.requireProject(parsedInput.projectId);
      const asset = current.assets.find((candidate) => candidate.id === parsedInput.assetId);
      if (asset === undefined) {
        throw new ProjectStoreError(`Asset ${parsedInput.assetId} was not found.`);
      }
      const timestamp = now.toISOString();
      const updatedAsset: MediaAsset = {
        ...asset,
        metadata: {
          durationMs: parsedInput.durationMs,
          ...('width' in parsedInput ? { width: parsedInput.width } : {}),
          ...('height' in parsedInput ? { height: parsedInput.height } : {})
        },
        updatedAt: timestamp
      };
      const assets = current.assets.map((candidate) => candidate.id === updatedAsset.id ? updatedAsset : candidate);
      await this.persist({ ...current, updatedAt: timestamp, assets });
      return updatedAsset;
    });
  }

  async getAsset(projectId: string, assetId: string): Promise<MediaAsset | null> {
    const project = await this.open(projectId);
    return project?.assets.find((asset) => asset.id === assetId) ?? null;
  }

  async delete(projectId: string): Promise<boolean> {
    return this.mutateProject(projectId, async () => {
      const current = await this.open(projectId);
      if (current === null) {
        return false;
      }
      await rm(projectDirectory(this.rootDirectory, current.id), { recursive: true });
      return true;
    });
  }

  private async requireProject(projectId: string): Promise<LocalProjectSnapshot> {
    const project = await this.open(projectId);
    if (project === null) {
      throw new ProjectStoreError(`Project ${projectId} was not found.`);
    }
    return project;
  }

  private async persist(snapshot: LocalProjectSnapshot): Promise<LocalProjectSnapshot> {
    const parsed = parsePersistedProject(snapshot, snapshot.id);
    if (parsed === null) {
      throw new ProjectStoreError('Invalid project snapshot.');
    }
    await writeProjectSnapshot(this.rootDirectory, parsed);
    return parsed;
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.rootDirectory, 0o700);
  }

  private async mutateProject<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const mutationKey = projectDirectory(this.rootDirectory, projectId);
    const previousMutation = projectMutationGates.get(mutationKey) ?? Promise.resolve();
    let releaseMutation = (): void => undefined;
    const currentMutation = new Promise<void>((resolveMutation) => {
      releaseMutation = resolveMutation;
    });
    projectMutationGates.set(mutationKey, currentMutation);
    await previousMutation;
    try {
      return await operation();
    } finally {
      releaseMutation();
      if (projectMutationGates.get(mutationKey) === currentMutation) {
        projectMutationGates.delete(mutationKey);
      }
    }
  }
}
