import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { AiProjectDocument } from '../../shared/aiProjectDomain';
import { narrationScriptFromCues, type NarrationPlan, type SubtitleCue } from '../../shared/narrationPlan';
import { checkNarrationFit } from '../../shared/narrationTiming';
import { createNarrationPlan, narrationFromApprovedWriter, narrationPlanMatchesWriter, updateNarrationPlan } from '../../shared/subtitleWorkflow';
import { voiceChoices } from '../../shared/voiceCatalog';
import type { StatusMessage } from './appTypes';
import { DomainModelPicker } from './DomainModelPicker';
import { useAiDomainModel } from './AiDomainModelContext';
import { useProjectResultImport } from './ProjectResultImportContext';
import { Button, StatusCard } from './ui';

export function NarrationPanel({ document, targetSeconds, onSaveAi, onApplyCaptions }: {
  readonly document: AiProjectDocument; readonly targetSeconds: number;
  readonly onSaveAi: (document: AiProjectDocument) => Promise<boolean>;
  readonly onApplyCaptions: (plan: NarrationPlan) => boolean;
}): ReactElement {
  const { selectedModel } = useAiDomainModel();
  const voiceModel = selectedModel('voice-generation');
  const choices = voiceChoices(voiceModel.providerId);
  const projectImport = useProjectResultImport();
  const [voiceId, setVoiceId] = useState(document.narrationPlan?.voiceId ?? choices[0]?.id ?? '');
  const [script, setScript] = useState(document.narrationPlan?.script ?? '');
  const [cues, setCues] = useState<readonly SubtitleCue[]>(document.narrationPlan?.cues ?? []);
  const [savedPlan, setSavedPlan] = useState<NarrationPlan | null>(document.narrationPlan ?? null);
  const [isPersisted, setIsPersisted] = useState(document.narrationPlan !== undefined);
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [completedJobId, setCompletedJobId] = useState<string | null>(null);
  const pollIntervalRef = useRef<number | null>(null);
  const writerSource = narrationFromApprovedWriter(document);
  const effectiveTargetSeconds = Math.max(1, targetSeconds, (writerSource?.cues.at(-1)?.endMs ?? 0) / 1_000);
  const fit = useMemo(() => script.trim() ? checkNarrationFit({ script, targetSeconds: effectiveTargetSeconds }) : null, [script, effectiveTargetSeconds]);
  const dirty = !isPersisted || savedPlan === null || savedPlan.script !== script.trim() || savedPlan.voiceModelId !== voiceModel.id || savedPlan.voiceId !== voiceId || JSON.stringify(savedPlan.cues) !== JSON.stringify(cues);
  const stale = savedPlan !== null && !narrationPlanMatchesWriter(document, savedPlan);
  useEffect(() => {
    const options = voiceChoices(voiceModel.providerId);
    if (!options.some((voice) => voice.id === voiceId)) setVoiceId(options[0]?.id ?? '');
  }, [voiceModel.providerId, voiceId]);
  useEffect(() => () => {
    if (pollIntervalRef.current !== null) window.clearInterval(pollIntervalRef.current);
  }, []);
  const build = (fromWriter: boolean): void => {
    try {
      const plan = createNarrationPlan({ ai: document, ...(fromWriter ? {} : { script }), durationMs: Math.round(effectiveTargetSeconds * 1_000), voiceModelId: voiceModel.id, voiceId });
      setScript(plan.script); setCues(plan.cues); setSavedPlan(plan); setIsPersisted(false); setStatus({ tone: 'neutral', text: `${plan.cues.length} subtitle cues prepared. Review text and timing before approval.` });
    } catch (error) { setStatus({ tone: 'danger', text: error instanceof Error ? error.message : 'Could not prepare narration.' }); }
  };
  const makePlan = (approve: boolean): NarrationPlan => {
    const base = savedPlan ?? createNarrationPlan({ ai: document, script, durationMs: Math.round(effectiveTargetSeconds * 1_000), voiceModelId: voiceModel.id, voiceId });
    return updateNarrationPlan(base, { script, cues, voiceModelId: voiceModel.id, voiceId }, approve);
  };
  const savePlan = async (approve: boolean): Promise<void> => {
    try {
      const plan = makePlan(approve);
      if (!await onSaveAi({ ...document, narrationPlan: plan })) throw new Error('Could not save narration progress.');
      setSavedPlan(plan); setIsPersisted(true); setScript(plan.script); setCues(plan.cues);
      setStatus({ tone: approve ? 'success' : 'neutral', text: approve ? 'Narration and subtitles approved. Applying captions and generating voice remain separate actions.' : 'Narration draft saved locally.' });
    } catch (error) { setStatus({ tone: 'danger', text: error instanceof Error ? error.message : 'Could not save narration.' }); }
  };
  const editCue = (index: number, patch: Partial<SubtitleCue>): void => setCues((current) => {
    const next = current.map((cue, at) => at === index ? { ...cue, ...patch } : cue);
    if (patch.text !== undefined) setScript(narrationScriptFromCues(next));
    return next;
  });
  const generate = async (): Promise<void> => {
    if (savedPlan?.status !== 'approved' || dirty || stale) { setStatus({ tone: 'warning', text: 'Approve the current narration and subtitle timing before paying for speech synthesis.' }); return; }
    setIsGenerating(true); setCompletedJobId(null); setStatus({ tone: 'neutral', text: `Sending the approved script and voice choice to ${voiceModel.providerLabel}…` });
    try {
      if (pollIntervalRef.current !== null) window.clearInterval(pollIntervalRef.current);
      const response = await window.videoTool.aiGenerateSpeech({ script: savedPlan.script, voiceId: savedPlan.voiceId, modelId: voiceModel.id });
      if (!response.ok) throw new Error(response.error.message);
      const deadline = Date.now() + 10 * 60 * 1_000;
      const intervalId = window.setInterval(async () => {
        const stop = (): void => { window.clearInterval(intervalId); pollIntervalRef.current = null; setIsGenerating(false); };
        if (Date.now() >= deadline) { stop(); setStatus({ tone: 'danger', text: 'Speech synthesis did not finish within 10 minutes. Check the terminal log and provider status before retrying.' }); return; }
        const poll = await window.videoTool.aiGetSpeechJob(response.value.id);
        if (!poll.ok) { stop(); setStatus({ tone: 'danger', text: poll.error.message }); return; }
        if (poll.value.status === 'completed') { stop(); setCompletedJobId(poll.value.id); setStatus({ tone: 'success', text: 'Speech ready. Import it, then listen and fine-tune subtitle timing against the actual voice.' }); }
        else if (poll.value.status === 'failed') { stop(); setStatus({ tone: 'danger', text: poll.value.error ?? 'Speech synthesis failed.' }); }
      }, 1_000);
      pollIntervalRef.current = intervalId;
    } catch (error) { if (pollIntervalRef.current !== null) window.clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; setIsGenerating(false); setStatus({ tone: 'danger', text: error instanceof Error ? error.message : 'Speech synthesis failed.' }); }
  };
  const apply = (): void => {
    if (!savedPlan || savedPlan.status !== 'approved' || dirty || stale) { setStatus({ tone: 'warning', text: 'Save and approve current, non-stale subtitles first.' }); return; }
    setStatus(onApplyCaptions(savedPlan) ? { tone: 'success', text: `${savedPlan.cues.length} captions added to the unsaved timeline. Review them in Editing, then save the project.` } : { tone: 'danger', text: 'Captions could not be applied to the timeline.' });
  };
  return <section className="studio-surface narration-workflow" aria-labelledby="narration-title">
    <header className="studio-surface__header"><div className="studio-surface__title"><h2 className="studio-surface__title-label" id="narration-title">Narration & Subtitles</h2><span className="studio-surface__title-meta">Review before voice or timeline</span></div><DomainModelPicker domain="voice-generation" ariaLabel="Voice model" /></header>
    <div className="studio-surface__body">
      <label className="studio-field"><span className="studio-field__label">Voice</span><select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>{choices.length ? choices.map((voice) => <option key={voice.id} value={voice.id}>{voice.label} — {voice.description}</option>) : <option value="">Provider default voice</option>}</select></label>
      {writerSource && <Button onClick={() => build(true)}>Load dialogue from approved Writer ({writerSource.cues.length} cues)</Button>}
      <label className="studio-field"><span className="studio-field__label">Narration script</span><textarea rows={7} value={script} onChange={(e) => setScript(e.target.value)} /></label>
      <Button disabled={!script.trim()} onClick={() => build(false)}>Auto-split subtitles from this script</Button>
      {fit && <StatusCard tone={fit.verdict === 'fits' ? 'success' : 'warning'}>{fit.advice}</StatusCard>}
      {stale && <StatusCard tone="warning">The approved Writer dialogue changed. Reload it or detach by rebuilding subtitles from the edited script.</StatusCard>}
      <div className="subtitle-cue-list">{cues.map((cue, index) => <fieldset key={cue.id} className="subtitle-cue"><legend>Cue {index + 1}</legend>
        <div className="writer-workspace__row"><label className="studio-field"><span className="studio-field__label">Start ms</span><input type="number" value={cue.startMs} onChange={(e) => editCue(index, { startMs: Number(e.target.value) })} /></label><label className="studio-field"><span className="studio-field__label">End ms</span><input type="number" value={cue.endMs} onChange={(e) => editCue(index, { endMs: Number(e.target.value) })} /></label></div>
        <label className="studio-field"><span className="studio-field__label">Caption text</span><textarea rows={2} value={cue.text} onChange={(e) => editCue(index, { text: e.target.value })} /></label>
      </fieldset>)}</div>
      <p className="studio-reference__empty">Subtitle timing is derived from approved shot timing or distributed across the script. It is not word-level audio alignment; listen after synthesis and adjust before final export.</p>
      <div className="writer-preview__actions"><Button disabled={!script.trim() || !cues.length} onClick={() => void savePlan(false)}>Save draft</Button><Button variant="primary" disabled={!script.trim() || !cues.length || (!dirty && savedPlan?.status === 'approved')} onClick={() => void savePlan(true)}>Approve narration & subtitles</Button><Button disabled={savedPlan?.status !== 'approved' || dirty || stale} onClick={apply}>Apply captions to timeline</Button></div>
      {status && <StatusCard tone={status.tone}>{status.text}</StatusCard>}
      {completedJobId && <Button variant="primary" disabled={projectImport.activeProject === null || projectImport.isImporting} onClick={() => void projectImport.importAiResult(completedJobId).then(setStatus)}>Import voice to project</Button>}
    </div>
    <div className="studio-composer"><div className="studio-composer__toolbar"><span className="studio-composer__hint">{voiceModel.providerLabel} · approved script only</span><Button variant="primary" disabled={isGenerating || savedPlan?.status !== 'approved' || dirty || stale} onClick={() => void generate()}>{isGenerating ? 'Synthesizing…' : 'Generate approved voice'}</Button></div></div>
  </section>;
}
