import { Directory, File, Paths } from 'expo-file-system';

import { parseTimelineDocument } from '@openvideo/shared/timelineDocumentValidators';
import { createInitialTimeline } from '@openvideo/shared/timelineLogic';
import { PROJECT_SCHEMA_VERSION, type TimelineDocument } from '@openvideo/shared/timelineTypes';

/**
 * Projects live inside the app's own storage.
 *
 * The desktop is folder-backed because a desktop user has a filesystem they
 * think in. A phone user does not, and a document they have to file away
 * themselves is not how a phone app behaves — so the app owns the directory and
 * the user owns the project.
 *
 * Layout, one directory per project:
 *   projects/<id>/project.json   the snapshot
 *   projects/<id>/media/<file>   imported media, copied in
 */

const ROOT = new Directory(Paths.document, 'projects');

export type MobileAsset = {
  readonly id: string;
  readonly displayName: string;
  readonly kind: 'video' | 'audio';
  readonly mimeType: string;
  /** Relative to the project directory, so the record survives a reinstall path change. */
  readonly relativePath: string;
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
};

export type MobileProject = {
  readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly assets: readonly MobileAsset[];
  readonly timeline: TimelineDocument;
};

export type ProjectSummary = { readonly id: string; readonly name: string; readonly updatedAt: string };

function ensureRoot(): void {
  if (!ROOT.exists) ROOT.create({ intermediates: true });
}

function projectDir(id: string): Directory {
  return new Directory(ROOT, id);
}

function projectFile(id: string): File {
  return new File(projectDir(id), 'project.json');
}

/** Absolute URI for a stored asset, resolved at read time rather than persisted. */
export function assetUri(projectId: string, asset: MobileAsset): string {
  return new File(projectDir(projectId), asset.relativePath).uri;
}

export function listProjects(): readonly ProjectSummary[] {
  ensureRoot();
  const summaries: ProjectSummary[] = [];
  for (const entry of ROOT.list()) {
    if (!(entry instanceof Directory)) continue;
    const project = readProject(entry.name);
    if (project !== null) summaries.push({ id: project.id, name: project.name, updatedAt: project.updatedAt });
  }
  // Most recently touched first: the project a user wants is almost always the
  // one they were last in.
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function readProject(id: string): MobileProject | null {
  const file = projectFile(id);
  if (!file.exists) return null;
  try {
    const parsed: unknown = JSON.parse(file.textSync());
    const candidate = parsed as Partial<MobileProject>;
    // The timeline goes through the shared validator rather than being trusted:
    // a file edited or truncated between sessions must not become a document the
    // editing rules then operate on.
    const timeline = parseTimelineDocument(candidate.timeline);
    if (timeline === null || typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return null;
    return {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: candidate.id,
      name: candidate.name,
      createdAt: candidate.createdAt ?? new Date().toISOString(),
      updatedAt: candidate.updatedAt ?? new Date().toISOString(),
      assets: Array.isArray(candidate.assets) ? (candidate.assets as MobileAsset[]) : [],
      timeline
    };
  } catch {
    // An unreadable project is reported as absent rather than crashing the list;
    // one broken file must not hide every other project.
    return null;
  }
}

export function createProject(name: string): MobileProject {
  ensureRoot();
  const id = `project-${Date.now().toString(36)}`;
  const dir = projectDir(id);
  dir.create({ intermediates: true });
  new Directory(dir, 'media').create({ intermediates: true });
  const now = new Date().toISOString();
  const project: MobileProject = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id,
    name: name.trim().length > 0 ? name.trim() : 'Untitled',
    createdAt: now,
    updatedAt: now,
    assets: [],
    timeline: createInitialTimeline()
  };
  writeProject(project);
  return project;
}

export function writeProject(project: MobileProject): void {
  ensureRoot();
  const dir = projectDir(project.id);
  if (!dir.exists) dir.create({ intermediates: true });
  projectFile(project.id).write(JSON.stringify({ ...project, updatedAt: new Date().toISOString() }));
}

export function renameProject(id: string, name: string): MobileProject | null {
  const project = readProject(id);
  if (project === null || name.trim().length === 0) return null;
  const renamed = { ...project, name: name.trim() };
  writeProject(renamed);
  return renamed;
}

export function deleteProject(id: string): void {
  const dir = projectDir(id);
  // Deletes only inside the app's own projects directory — never a path the user
  // chose, which is the rule the desktop follows for the same reason.
  if (dir.exists) dir.delete();
}

/**
 * Copies picked media into the project.
 *
 * A photo-library URI is not a stable reference: the asset can be deleted or the
 * permission revoked, and a project that silently loses a clip between sessions
 * is worse than one that costs a copy.
 */
export function importAsset(
  projectId: string,
  source: { readonly uri: string; readonly displayName: string; readonly mimeType: string; readonly durationMs: number; readonly width: number; readonly height: number; readonly kind: 'video' | 'audio' }
): MobileAsset {
  const dir = new Directory(projectDir(projectId), 'media');
  if (!dir.exists) dir.create({ intermediates: true });
  const id = `asset-${Date.now().toString(36)}`;
  const extension = source.displayName.includes('.') ? source.displayName.split('.').pop() : 'mp4';
  const relativePath = `media/${id}.${extension ?? 'mp4'}`;
  new File(source.uri).copy(new File(projectDir(projectId), relativePath));
  return {
    id,
    displayName: source.displayName,
    kind: source.kind,
    mimeType: source.mimeType,
    relativePath,
    durationMs: source.durationMs,
    width: source.width,
    height: source.height
  };
}
