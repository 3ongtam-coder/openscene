import { describe, expect, it } from 'vitest';

import { createEmptyAiProjectDocument } from '../src/shared/aiProjectDomain';
import { createDeliveryProvenance, timelineRevisionFingerprint } from '../src/shared/exportProvenance';
import { metadataPrivacyPlan, PERSONAL_CONTAINER_METADATA_FIELDS } from '../src/shared/metadataPrivacy';
import { DEFAULT_CLIP_EFFECTS, PROJECT_SCHEMA_VERSION, TIMELINE_SCHEMA_VERSION, type LocalProjectSnapshot } from '../src/shared/timelineTypes';

const project: LocalProjectSnapshot = {
  schemaVersion: PROJECT_SCHEMA_VERSION,
  id: 'project_01',
  name: 'Private project name',
  createdAt: '2026-09-10T00:00:00.000Z',
  updatedAt: '2026-09-10T01:00:00.000Z',
  assets: [{
    id: 'asset_01', displayName: 'C:\\Users\\Creator\\secret.mov', projectRelativePath: 'assets/asset_01/original.mov',
    kind: 'video', mimeType: 'video/quicktime', byteLength: 10, metadata: { durationMs: 1_000, width: 640, height: 360 },
    createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z'
  }],
  timeline: {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    tracks: [{ kind: 'video', id: 'track_01', name: 'Video', clips: [{
      id: 'clip_01', assetId: 'asset_01', timelineStartMs: 0, sourceStartMs: 0, sourceEndMs: 1_000,
      sourceDurationMs: 1_000, effects: DEFAULT_CLIP_EFFECTS, keyframes: []
    }] }],
    transitions: []
  },
  ai: {
    ...createEmptyAiProjectDocument(),
    provenance: [{
      id: 'provenance_01', source: 'provider', createdAt: '2026-09-10T00:30:00.000Z',
      inputAssetIds: ['asset_01'], outputAssetIds: ['asset_01'],
      providerId: 'google_gemini', modelId: 'veo-3.1',
      transformHistory: ['Downloaded from C:\\Users\\Creator\\private with key AIza-secret'],
      rightsNote: 'Creator legal name and C:\\private\\contract.pdf'
    }, {
      id: 'provenance_unrelated', source: 'provider', createdAt: '2026-09-10T00:31:00.000Z',
      inputAssetIds: [], outputAssetIds: ['asset_unrelated'], providerId: 'private_provider',
      transformHistory: ['Unrelated experiment must not leave the project'], rightsNote: 'Unrelated rights'
    }]
  }
};

describe('metadata privacy and delivery provenance', () => {
  it('uses a closed personal-field allowlist and never targets mandatory provenance classes', () => {
    const clean = metadataPrivacyPlan('privacy_clean');
    const preserve = metadataPrivacyPlan('preserve_provenance');
    expect(clean.removedFields).toBe(PERSONAL_CONTAINER_METADATA_FIELDS);
    expect(clean.removedFields.map((field) => field.key)).toContain('location');
    expect(clean.removedFields.map((field) => field.key)).not.toContain('copyright');
    expect(clean.untargetedSignals.join(' ')).toMatch(/C2PA.*SynthID/);
    expect(preserve.removedFields).toEqual([]);
  });

  it('fingerprints the exact timeline deterministically and changes when the cut changes', () => {
    const first = timelineRevisionFingerprint(project.timeline);
    const same = timelineRevisionFingerprint({ ...project.timeline });
    const changed = timelineRevisionFingerprint({ ...project.timeline, tracks: [] });
    expect(first).toBe(same);
    expect(changed).not.toBe(first);
  });

  it('exports lineage without prompts, rights text, credentials, display names or local paths', () => {
    const provenance = createDeliveryProvenance({
      project,
      exportedAt: '2026-09-10T02:00:00.000Z', width: 640, height: 360, frameRate: 30, durationMs: 1_000,
      subtitleDelivery: { burnAutomaticCaptions: true, sidecarFormat: 'none' }, metadataPrivacyMode: 'privacy_clean',
      output: { fileName: 'export_01.mp4', fileSizeBytes: 100, sha256: 'a'.repeat(64) }
    });
    const serialized = JSON.stringify(provenance);
    expect(provenance.projectRevision.timelineFingerprint).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(provenance.lineage[0]).toMatchObject({ providerId: 'google_gemini', modelId: 'veo-3.1', rightsRecorded: true });
    expect(provenance.lineage).toHaveLength(1);
    expect(serialized).not.toMatch(/Private project name|Creator|secret|contract|AIza|C:\\|original\.mov/i);
    expect(serialized).not.toMatch(/private_provider|Unrelated/);
    expect(provenance.lineage[0]?.transformHistoryFingerprints[0]).toMatch(/^fnv1a32:/);
    expect(provenance.delivery.output.sha256).toHaveLength(64);
  });

  it('drops credential-shaped values even when corrupt project data placed them in public identifier fields', () => {
    const credentialProject: LocalProjectSnapshot = {
      ...project,
      ai: {
        ...project.ai,
        provenance: [{
          ...project.ai.provenance[0]!,
          providerId: 'AIzaSyDefinitelyNotAProvider',
          modelId: 'sk-proj-definitely-not-a-model'
        }]
      }
    };
    const provenance = createDeliveryProvenance({
      project: credentialProject,
      exportedAt: '2026-09-10T02:00:00.000Z', width: 640, height: 360, frameRate: 30, durationMs: 1_000,
      subtitleDelivery: { burnAutomaticCaptions: true, sidecarFormat: 'none' }, metadataPrivacyMode: 'preserve_provenance',
      output: { fileName: 'export_01.mp4', fileSizeBytes: 100, sha256: 'a'.repeat(64) }
    });
    expect(provenance.lineage[0]).not.toHaveProperty('providerId');
    expect(provenance.lineage[0]).not.toHaveProperty('modelId');
  });
});
