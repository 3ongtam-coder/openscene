import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { StartVoiceProfileSampleInput, VoiceProfile } from '../shared/models';
import { NARRATION_SAMPLE_LIMITS, isNarrationSampleDurationValid } from '../shared/narrationLogic';
import {
  assertOpaqueId,
  closeStream,
  isInsideDirectory,
  MAX_VOICE_PROFILE_SAMPLE_BYTES,
  METADATA_FILE,
  parsePersistedMetadata,
  PENDING_DIR,
  PROFILE_DIR,
  sampleExtensionForMimeType,
  toVoiceProfile,
  waitForDrain,
  waitForStreamReady,
  type ActiveVoiceProfileSample,
  type PersistedVoiceProfileMetadata
} from './voiceProfileStoreSupport';

export interface BeginVoiceProfileSampleResult {
  readonly voiceProfileId: string;
  readonly sampleId: string;
  readonly stagingProfilePath: string;
  readonly stagingSamplePath: string;
  readonly createdAt: string;
}

export interface FinalizeVoiceProfileSampleResult {
  readonly profile: VoiceProfile;
  readonly profilePath: string;
  readonly samplePath: string;
  readonly metadataPath: string;
}

export interface VoiceProfileRunnerSample {
  readonly samplePath: string;
}

export class VoiceProfileStore {
  private readonly rootDirectory: string;
  private readonly profilesDirectory: string;
  private readonly pendingDirectory: string;
  private readonly activeSamples = new Map<string, ActiveVoiceProfileSample>();
  private readonly activeProfiles = new Map<string, string>();

  constructor(rootDirectory: string) {
    this.rootDirectory = resolve(rootDirectory);
    this.profilesDirectory = join(this.rootDirectory, PROFILE_DIR);
    this.pendingDirectory = join(this.rootDirectory, PENDING_DIR);
  }

  get directory(): string {
    return this.rootDirectory;
  }

  async begin(input: StartVoiceProfileSampleInput, now = new Date()): Promise<BeginVoiceProfileSampleResult> {
    await mkdir(this.pendingDirectory, { recursive: true });

    const createdAt = now.toISOString();
    const voiceProfileId = randomUUID();
    const sampleId = randomUUID();
    const stagingProfilePath = join(this.pendingDirectory, voiceProfileId);
    const sampleFileName = `sample-${sampleId}${sampleExtensionForMimeType(input.mimeType)}`;
    const stagingSamplePath = join(stagingProfilePath, sampleFileName);

    if (!isInsideDirectory(this.rootDirectory, stagingProfilePath) || !isInsideDirectory(this.rootDirectory, stagingSamplePath)) {
      throw new Error('Resolved voice profile path escaped the configured root directory.');
    }

    await mkdir(stagingProfilePath, { recursive: true });

    const stream = createWriteStream(stagingSamplePath, { flags: 'wx' });
    try {
      await waitForStreamReady(stream);
    } catch (error: unknown) {
      await rm(stagingProfilePath, { force: true, recursive: true });
      throw error;
    }

    this.activeSamples.set(sampleId, {
      voiceProfileId,
      sampleId,
      displayName: input.displayName,
      language: input.language,
      narrationScript: input.narrationScript,
      mimeType: input.mimeType,
      consentTextVersion: input.consentTextVersion,
      consentedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
      stagingProfilePath,
      stagingSamplePath,
      sampleFileName,
      stream,
      nextSequence: 0,
      byteLength: 0
    });
    this.activeProfiles.set(voiceProfileId, sampleId);

    return { voiceProfileId, sampleId, stagingProfilePath, stagingSamplePath, createdAt };
  }

  async append(sampleId: string, sequence: number, chunk: ArrayBuffer): Promise<{ sequence: number; totalBytes: number }> {
    assertOpaqueId(sampleId, 'sample id');

    const activeSample = this.activeSamples.get(sampleId);
    if (activeSample === undefined) {
      throw new Error('Voice profile sample is not active.');
    }

    if (sequence !== activeSample.nextSequence) {
      throw new Error(`Unexpected voice profile chunk sequence ${sequence}; expected ${activeSample.nextSequence}.`);
    }

    const bytes = Buffer.from(new Uint8Array(chunk));
    const nextByteLength = activeSample.byteLength + bytes.byteLength;
    if (nextByteLength > MAX_VOICE_PROFILE_SAMPLE_BYTES) {
      throw new Error(`Voice profile sample exceeds the ${MAX_VOICE_PROFILE_SAMPLE_BYTES} byte limit.`);
    }
    if (bytes.byteLength > 0) {
      const canContinue = activeSample.stream.write(bytes);
      if (!canContinue) {
        await waitForDrain(activeSample.stream);
      }

      activeSample.byteLength = nextByteLength;
    }

    activeSample.nextSequence += 1;
    return { sequence, totalBytes: activeSample.byteLength };
  }

  async finalize(
    sampleId: string,
    durationMs: number,
    now = new Date()
  ): Promise<FinalizeVoiceProfileSampleResult> {
    assertOpaqueId(sampleId, 'sample id');
    if (!isNarrationSampleDurationValid(durationMs)) {
      throw new Error(
        `Voice profile sample duration must be between ${NARRATION_SAMPLE_LIMITS.minimumDurationMs} and ${NARRATION_SAMPLE_LIMITS.maximumDurationMs} milliseconds.`
      );
    }

    const activeSample = this.activeSamples.get(sampleId);
    if (activeSample === undefined) {
      throw new Error('Voice profile sample is not active.');
    }

    this.activeSamples.delete(sampleId);
    this.activeProfiles.delete(activeSample.voiceProfileId);

    await closeStream(activeSample.stream);

    const profilePath = join(this.profilesDirectory, activeSample.voiceProfileId);
    const samplePath = join(profilePath, activeSample.sampleFileName);
    const metadataPath = join(profilePath, METADATA_FILE);
    const updatedAt = now.toISOString();
    const metadata: PersistedVoiceProfileMetadata = {
      voiceProfileId: activeSample.voiceProfileId,
      sampleId: activeSample.sampleId,
      displayName: activeSample.displayName,
      language: activeSample.language,
      narrationScript: activeSample.narrationScript,
      sampleMimeType: activeSample.mimeType,
      samplePath,
      byteLength: activeSample.byteLength,
      durationMs,
      consentTextVersion: activeSample.consentTextVersion,
      consentedAt: activeSample.consentedAt,
      sampleCount: 1,
      totalDurationMs: durationMs,
      createdAt: activeSample.createdAt,
      updatedAt
    };

    await mkdir(this.profilesDirectory, { recursive: true });
    if (!isInsideDirectory(this.rootDirectory, profilePath) || !isInsideDirectory(this.rootDirectory, samplePath)) {
      throw new Error('Resolved voice profile path escaped the configured root directory.');
    }

    await writeFile(join(activeSample.stagingProfilePath, METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    await rename(activeSample.stagingProfilePath, profilePath);

    return {
      profile: toVoiceProfile(metadata),
      profilePath,
      samplePath,
      metadataPath
    };
  }

  async discard(sampleId: string): Promise<void> {
    assertOpaqueId(sampleId, 'sample id');

    const activeSample = this.activeSamples.get(sampleId);
    if (activeSample === undefined) {
      return;
    }

    this.activeSamples.delete(sampleId);
    this.activeProfiles.delete(activeSample.voiceProfileId);
    activeSample.stream.destroy();
    await rm(activeSample.stagingProfilePath, { force: true, recursive: true });
  }

  async list(): Promise<VoiceProfile[]> {
    await mkdir(this.profilesDirectory, { recursive: true });

    const entries = await readdir(this.profilesDirectory, { withFileTypes: true });
    const profiles = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const metadataPath = join(this.profilesDirectory, entry.name, METADATA_FILE);
          const parsed = parsePersistedMetadata(JSON.parse(await readFile(metadataPath, 'utf8')));
          return parsed === null ? null : toVoiceProfile(parsed);
        })
    );

    return profiles
      .filter((profile): profile is VoiceProfile => profile !== null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
  }

  async delete(voiceProfileId: string): Promise<void> {
    assertOpaqueId(voiceProfileId, 'voice profile id');

    const activeSampleId = this.activeProfiles.get(voiceProfileId);
    if (activeSampleId !== undefined) {
      await this.discard(activeSampleId);
      return;
    }

    await rm(join(this.profilesDirectory, voiceProfileId), { force: true, recursive: true });
  }

  async getRunnerSample(voiceProfileId: string): Promise<VoiceProfileRunnerSample | null> {
    assertOpaqueId(voiceProfileId, 'voice profile id');

    const metadataPath = join(this.profilesDirectory, voiceProfileId, METADATA_FILE);
    const parsed = parsePersistedMetadata(JSON.parse(await readFile(metadataPath, 'utf8')));
    if (parsed === null || !isInsideDirectory(this.rootDirectory, parsed.samplePath)) {
      return null;
    }

    return { samplePath: parsed.samplePath };
  }
}
