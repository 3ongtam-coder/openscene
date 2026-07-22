import { useState, type ChangeEvent, type ReactElement } from 'react';

import { ALLOWED_AUDIO_MIME_TYPES } from '../../shared/models';
import type { StatusMessage } from './appTypes';
import { formatDuration } from './format';
import { NARRATION_SAMPLE_LIMITS } from './narrationLogic';
import { parseAllowedAudioMimeType } from './narrationLogic';
import { useProjectResultImport } from './ProjectResultImportContext';
import { useNarration } from './useNarration';

export function NarrationPanel(): ReactElement {
  const narration = useNarration();
  const projectImport = useProjectResultImport();
  const [importStatus, setImportStatus] = useState<StatusMessage | null>(null);

  const onProfileChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    narration.setSelectedProfileId(event.target.value);
  };

  const onMimeTypeChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const mimeType = parseAllowedAudioMimeType(event.target.value);
    if (mimeType !== null) {
      narration.setTtsMimeType(mimeType);
    }
  };
  const completedTtsJob = narration.ttsJob?.state.kind === 'completed' ? narration.ttsJob : null;

  const importTtsResult = async (): Promise<void> => {
    if (completedTtsJob === null) return;
    setImportStatus({ tone: 'neutral', text: 'Importing narration into the active project.' });
    setImportStatus(await projectImport.importTtsResult(completedTtsJob.id));
  };

  return (
    <section className="narration-panel" aria-labelledby="narration-title">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Narration</p>
          <h2 id="narration-title">Local voice profiles</h2>
        </div>
        <div className="transport-strip__buttons">
          <button className="button button--ghost" type="button" onClick={() => void narration.refreshProfiles()}>Refresh profiles</button>
          <button className="button button--ghost" type="button" onClick={() => void narration.refreshRuntime()}>Refresh runtime</button>
        </div>
      </div>

      <div className="narration-grid">
        <section className="narration-card" aria-labelledby="voice-profile-title">
          <div>
            <p className="section-kicker">Reference sample</p>
            <h3 id="voice-profile-title">Create profile</h3>
          </div>
          <label className="field-label">
            Display name
            <input value={narration.displayName} onChange={(event) => narration.setDisplayName(event.target.value)} placeholder="My narration voice" />
          </label>
          <label className="field-label">
            Language
            <input value={narration.language} onChange={(event) => narration.setLanguage(event.target.value)} placeholder="en-US" />
          </label>
          <label className="field-label">
            Sample script
            <textarea value={narration.narrationScript} onChange={(event) => narration.setNarrationScript(event.target.value)} rows={4} />
          </label>
          <label className="consent-row">
            <input type="checkbox" checked={narration.explicitConsent} onChange={(event) => narration.setExplicitConsent(event.target.checked)} />
            <span>I have permission to store this voice sample locally and use it for local narration generation.</span>
          </label>
          <div className="sample-meter">
            <span>Sample length</span>
            <strong>{formatDuration(narration.sampleDurationMs)}</strong>
            <small>Save requires {formatDuration(NARRATION_SAMPLE_LIMITS.minimumDurationMs)} to {formatDuration(NARRATION_SAMPLE_LIMITS.maximumDurationMs)}.</small>
          </div>
          <div className="transport-strip__buttons">
            <button className="button button--record" type="button" onClick={() => void narration.startSampleRecording()} disabled={!narration.canStartSample}>Start mic sample</button>
            <button className="button button--stop" type="button" onClick={narration.stopSampleRecording} disabled={narration.sampleState !== 'recording'}>Stop sample</button>
            <button className="button button--primary" type="button" onClick={() => void narration.saveSample()} disabled={!narration.canSaveSample}>Save profile</button>
            <button className="button button--ghost" type="button" onClick={() => void narration.discardSample()} disabled={narration.sampleState === 'idle'}>Discard sample</button>
          </div>
        </section>

        <section className="narration-card" aria-labelledby="tts-title">
          <div>
            <p className="section-kicker">Local Qwen</p>
            <h3 id="tts-title">Generate audio</h3>
          </div>
          <div className={`runtime-card runtime-card--${narration.runtimeStatus?.kind ?? 'checking'}`} role="status">
            {narration.runtimeText}
          </div>
          <label className="field-label">
            Voice profile
            <select value={narration.selectedProfileId} onChange={onProfileChange}>
              <option value="">Select a saved profile</option>
              {narration.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.displayName} ({profile.language})</option>
              ))}
            </select>
          </label>
          {narration.selectedProfile !== null && (
            <dl className="profile-meta">
              <div><dt>Samples</dt><dd>{narration.selectedProfile.sampleCount}</dd></div>
              <div><dt>Total sample</dt><dd>{formatDuration(narration.selectedProfile.totalDurationMs)}</dd></div>
            </dl>
          )}
          <label className="field-label">
            Output format
            <select value={narration.ttsMimeType} onChange={onMimeTypeChange}>
              {ALLOWED_AUDIO_MIME_TYPES.map((mimeType) => <option key={mimeType} value={mimeType}>{mimeType}</option>)}
            </select>
          </label>
          <label className="field-label">
            Narration script
            <textarea value={narration.ttsScript} onChange={(event) => narration.setTtsScript(event.target.value)} rows={5} placeholder="Type the narration to synthesize with the selected voice profile." />
          </label>
          <div className="transport-strip__buttons">
            <button className="button button--primary" type="button" onClick={() => void narration.startTtsJob()} disabled={!narration.canGenerateTts}>Generate TTS</button>
            <button className="button button--ghost" type="button" onClick={() => void narration.deleteSelectedProfile()} disabled={narration.selectedProfile === null}>Delete profile</button>
          </div>
          <div className="runtime-card" role="status">{narration.ttsJobText}</div>
          {completedTtsJob !== null && (
            <>
              <div className="transport-strip__buttons">
                <button className="button button--primary" type="button" onClick={() => void importTtsResult()} disabled={projectImport.activeProject === null || projectImport.isImporting} aria-label="Import completed narration audio into the active timeline project">Import to project</button>
                <button className="button" type="button" onClick={() => void window.videoTool.openTtsResult({ jobId: completedTtsJob.id })}>Open audio</button>
                <button className="button" type="button" onClick={() => void window.videoTool.revealTtsResult({ jobId: completedTtsJob.id })}>Reveal audio</button>
              </div>
              {importStatus !== null && <div className={`status-card status-card--${importStatus.tone}`} role="status" aria-live="polite">{importStatus.text}</div>}
            </>
          )}
        </section>
      </div>

      <div className={`status-card status-card--${narration.statusMessage.tone}`} role="status">
        {narration.statusMessage.text}
      </div>
    </section>
  );
}
