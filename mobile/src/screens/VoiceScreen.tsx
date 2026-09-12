import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { checkNarrationFit } from '@openvideo/shared/narrationTiming';
import { narrationScriptFromCues, type NarrationPlan, type SubtitleCue } from '@openvideo/shared/narrationPlan';
import { applySubtitleCues, createNarrationPlan, narrationFromApprovedWriter, narrationPlanMatchesWriter, updateNarrationPlan } from '@openvideo/shared/subtitleWorkflow';
import { usesRuntimeVoiceCatalog, voiceChoices } from '@openvideo/shared/voiceCatalog';
import { getDomainModels } from '@openvideo/shared/aiDomainModels';
import { ModelSelect } from '../components/ModelSelect';
import { readProviderConnections } from '../lib/mediaProviders';
import { FormScreen } from '../components/FormScreen';
import { useRevealOnFocus } from '../components/KeyboardAwareScroll';
import { readProject, writeProject } from '../lib/projectStore';
import { theme } from '../lib/theme';
import { MIN_TAP, press } from '../lib/touch';

type Props = { readonly topInset: number; readonly keyboardOffset: number; readonly targetSeconds: number; readonly connectionsVersion: number; readonly projectId: string | null };
export function VoiceScreen(props: Props) { return <ProjectVoiceScreen key={props.projectId ?? 'none'} {...props} />; }

function ProjectVoiceScreen({ topInset, keyboardOffset, targetSeconds, connectionsVersion, projectId }: Props) {
  const catalog = getDomainModels('voice-generation');
  const project = projectId === null ? null : readProject(projectId);
  const [modelId, setModelId] = useState(project?.ai.narrationPlan?.voiceModelId ?? catalog.find((entry) => entry.available)?.id ?? '');
  const model = catalog.find((entry) => entry.id === modelId) ?? catalog[0];
  const choices = voiceChoices(model?.providerId ?? '');
  const [connected, setConnected] = useState<Readonly<Record<string, boolean>>>({});
  const [voiceId, setVoiceId] = useState(project?.ai.narrationPlan?.voiceId ?? choices[0]?.id ?? '');
  const [script, setScript] = useState(project?.ai.narrationPlan?.script ?? '');
  const [cues, setCues] = useState<readonly SubtitleCue[]>(project?.ai.narrationPlan?.cues ?? []);
  const [saved, setSaved] = useState<NarrationPlan | null>(project?.ai.narrationPlan ?? null);
  const [isPersisted, setIsPersisted] = useState(project?.ai.narrationPlan !== undefined);
  const [message, setMessage] = useState('');
  const reveal = useRevealOnFocus(); const input = useRef<TextInput>(null);
  const refresh = useCallback((): void => { void readProviderConnections().then(setConnected); }, []);
  useEffect(refresh, [refresh, connectionsVersion]);
  useEffect(() => {
    if (usesRuntimeVoiceCatalog(model?.providerId ?? '')) return;
    if (!choices.some((voice) => voice.id === voiceId)) setVoiceId(choices[0]?.id ?? '');
  }, [choices, model?.providerId, voiceId]);
  const writer = project ? narrationFromApprovedWriter(project.ai) : null;
  const effectiveTargetSeconds = Math.max(1, targetSeconds, (writer?.cues.at(-1)?.endMs ?? 0) / 1_000);
  const fit = useMemo(() => script.trim() ? checkNarrationFit({ script, targetSeconds: effectiveTargetSeconds }) : null, [script, effectiveTargetSeconds]);
  const dirty = !isPersisted || saved === null || saved.script !== script.trim() || saved.voiceModelId !== model?.id || saved.voiceId !== voiceId || JSON.stringify(saved.cues) !== JSON.stringify(cues);
  const stale = saved !== null && project !== null && !narrationPlanMatchesWriter(project.ai, saved);
  const create = (fromWriter: boolean): void => {
    if (!project || !model) return;
    try {
      const plan = createNarrationPlan({ ai: project.ai, ...(fromWriter ? {} : { script }), durationMs: Math.round(effectiveTargetSeconds * 1_000), voiceModelId: model.id, voiceId });
      setScript(plan.script); setCues(plan.cues); setSaved(plan); setIsPersisted(false); setMessage(`${plan.cues.length} subtitle cues ready for review.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not prepare subtitles.'); }
  };
  const save = (approve: boolean): void => {
    if (!projectId || !model) return;
    try {
      const latest = readProject(projectId); if (!latest) throw new Error('Open a project first.');
      const base = saved ?? createNarrationPlan({ ai: latest.ai, script, durationMs: Math.round(effectiveTargetSeconds * 1_000), voiceModelId: model.id, voiceId });
      const plan = updateNarrationPlan(base, { script, cues, voiceModelId: model.id, voiceId }, approve);
      writeProject({ ...latest, ai: { ...latest.ai, narrationPlan: plan } });
      setSaved(plan); setIsPersisted(true); setScript(plan.script); setCues(plan.cues); setMessage(approve ? 'Narration and subtitles approved. Applying them remains a separate action.' : 'Draft saved locally.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save narration.'); }
  };
  const apply = (): void => {
    if (!projectId || !saved || saved.status !== 'approved' || dirty || stale) { setMessage('Approve current, non-stale subtitles first.'); return; }
    const latest = readProject(projectId); if (!latest) return;
    try { writeProject({ ...latest, timeline: applySubtitleCues(latest.timeline, saved) }); setMessage(`${saved.cues.length} captions added. Review them in Edit; mobile save is immediate.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not apply captions.'); }
  };
  const action = (label: string, onPress: () => void, disabled = false) => <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={press([styles.button, disabled && styles.off])}><Text style={styles.buttonText}>{label}</Text></Pressable>;
  return <FormScreen topInset={topInset} keyboardOffset={keyboardOffset}>
    <Text style={styles.h1}>Narration & Subtitles</Text><Text style={styles.sub}>Prepare voice text and timed captions together. Review and approve before either is used.</Text>
    <Text style={styles.label}>Voice model</Text><ModelSelect domain="voice-generation" selectedId={modelId} connected={connected} onSelect={(next) => setModelId(next.id)} onConnectionChange={refresh} />
    <Text style={styles.label}>Voice</Text><View style={styles.row}>{choices.length ? choices.map((voice) => <View key={voice.id}>{action(`${voiceId === voice.id ? '✓ ' : ''}${voice.label}`, () => setVoiceId(voice.id))}</View>) : <Text style={styles.note}>{usesRuntimeVoiceCatalog(model?.providerId ?? '') ? `VieNeu preset voices are discovered by the desktop app from its local server${voiceId ? `; saved voice: ${voiceId}` : ''}.` : 'Provider default voice'}</Text>}</View>
    {writer && action(`Load approved Writer dialogue (${writer.cues.length} cues)`, () => create(true))}
    <Text style={styles.label}>Narration script</Text><TextInput ref={input} onFocus={() => reveal(input.current)} multiline value={script} onChangeText={setScript} style={[styles.input, styles.script]} placeholder="Write or load narration…" placeholderTextColor={theme.textWeaker} />
    {action('Auto-split subtitles from script', () => create(false), !script.trim())}
    {fit && <View style={styles.card}><Text style={fit.verdict === 'fits' ? styles.ok : styles.warn}>{fit.verdict}</Text><Text style={styles.note}>{fit.advice}</Text></View>}
    {stale && <Text style={styles.warn}>Writer dialogue changed. Reload it, or rebuild from your edited script.</Text>}
    {cues.map((cue, index) => <View key={cue.id} style={styles.card}><Text style={styles.label}>Cue {index + 1}</Text><View style={styles.row}>
      <TextInput accessibilityLabel={`Cue ${index + 1} start milliseconds`} keyboardType="number-pad" value={String(cue.startMs)} onChangeText={(text) => setCues((all) => all.map((item, at) => at === index ? { ...item, startMs: Number(text) } : item))} style={[styles.input, styles.time]} />
      <TextInput accessibilityLabel={`Cue ${index + 1} end milliseconds`} keyboardType="number-pad" value={String(cue.endMs)} onChangeText={(text) => setCues((all) => all.map((item, at) => at === index ? { ...item, endMs: Number(text) } : item))} style={[styles.input, styles.time]} />
    </View><TextInput multiline value={cue.text} onChangeText={(text) => setCues((all) => {
      const next = all.map((item, at) => at === index ? { ...item, text } : item);
      setScript(narrationScriptFromCues(next));
      return next;
    })} style={styles.input} /></View>)}
    <Text style={styles.note}>Timing follows Writer shots or is distributed across the script. It is not word-level audio alignment; listen and fine-tune after creating voice on desktop.</Text>
    <View style={styles.row}>{action('Save draft', () => save(false), !cues.length)}{action('Approve', () => save(true), !cues.length)}{action('Apply captions', apply, saved?.status !== 'approved' || dirty || stale)}</View>
    {!!message && <Text style={styles.message}>{message}</Text>}
    <Text style={styles.note}>Mobile can edit, approve, and apply the same narration plan. Speech synthesis stays disabled until its binary result transport is implemented; VieNeu-TTS also requires the desktop-local server. This screen cannot charge any provider.</Text>
  </FormScreen>;
}

const styles = StyleSheet.create({
  h1: { color: theme.text, fontSize: 26, fontWeight: '700' }, sub: { color: theme.textWeak, lineHeight: 19 }, label: { color: theme.text, fontSize: 12, fontWeight: '700', marginTop: 10 },
  input: { minHeight: MIN_TAP, borderWidth: 1, borderColor: theme.line, borderRadius: 10, backgroundColor: theme.surface, color: theme.text, padding: 10 }, script: { minHeight: 150 }, time: { minWidth: 120, flex: 1 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, button: { minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: theme.line, borderRadius: 10 }, buttonText: { color: theme.text, fontWeight: '700' }, off: { opacity: 0.4 },
  card: { padding: 10, gap: 7, borderWidth: 1, borderColor: theme.line, borderRadius: 10, backgroundColor: theme.surface }, note: { color: theme.textWeaker, fontSize: 12, lineHeight: 18 }, message: { color: theme.textWeak, lineHeight: 19 }, ok: { color: theme.mint }, warn: { color: theme.warn }
});
