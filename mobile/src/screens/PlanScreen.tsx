import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { estimateVideoPlanCost, PRICING_AS_OF } from '@openvideo/shared/mediaGenerationPricing';
import { planVideoStoryboard, supportedShotSeconds, CONTINUITY_KEYS } from '@openvideo/shared/videoStoryboardPlan';
import { getDomainModels } from '@openvideo/shared/aiDomainModels';
import { ModelPicker } from '../components/ModelPicker';
import type { VideoAspectRatio, VideoProgressStage } from '@openvideo/shared/videoGeneration';
import { readProviderConnections } from '../lib/mediaProviders';
import { useSpendPermissions, type Decision } from '../lib/permissions';
import { generateShot } from '../lib/videoGeneration';
import { appendAssetToTimeline, readProject } from '../lib/projectStore';
import { SpendPrompt } from '../components/SpendPrompt';
import { theme } from '../lib/theme';

const RATIOS: readonly VideoAspectRatio[] = ['16:9', '9:16', '1:1'];

/** Per-shot state, so a failure names the shot that failed. */
type ShotState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly stage: VideoProgressStage }
  | { readonly kind: 'done' }
  | { readonly kind: 'failed'; readonly message: string };

const LENGTHS = [8, 16, 30, 45, 60] as const;

export function PlanScreen({
  topInset,
  projectId,
  connectionsVersion
}: {
  readonly topInset: number;
  readonly projectId: string | null;
  /** Changes when Settings closes, so stored keys are picked up. */
  readonly connectionsVersion: number;
}) {
  const catalog = getDomainModels('video-generation');
  const [totalSeconds, setTotalSeconds] = useState<number>(30);
  const [modelId, setModelId] = useState<string>(() => catalog.find((entry) => entry.available)?.id ?? '');
  const [connected, setConnected] = useState<Readonly<Record<string, boolean>>>({});
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>('16:9');
  const [shotStates, setShotStates] = useState<readonly ShotState[]>([]);
  const [running, setRunning] = useState(false);
  const [asking, setAsking] = useState(false);
  const permissions = useSpendPermissions();

  // Connection is reported by provider id, which is what the picker keys on.
  const refreshConnections = useCallback((): void => {
    void readProviderConnections().then(setConnected);
  }, []);

  useEffect(refreshConnections, [refreshConnections, connectionsVersion]);

  const model = catalog.find((entry) => entry.id === modelId) ?? catalog[0];
  const plan = useMemo(
    () => planVideoStoryboard({ totalSeconds, providerId: model.providerId }),
    [totalSeconds, model.providerId]
  );
  const cost = useMemo(
    () => estimateVideoPlanCost(plan.shots.map((shot) => ({ modelId: model.id, durationSeconds: shot.durationSeconds }))),
    [plan, model.id]
  );

  // Changing anything about the plan clears the last run's results. Leaving them
  // on screen next to a different plan and a different price would misreport
  // what was actually generated.
  const setPlan = (next: () => void): void => {
    setShotStates([]);
    next();
  };

  /**
   * Shots run one at a time. In parallel they would multiply the spend before
   * the first failure could stop it, and every one of these providers rate-limits
   * concurrent jobs anyway.
   */
  const runGeneration = async (): Promise<void> => {
    if (projectId === null || model === undefined) return;
    setRunning(true);
    setShotStates(plan.shots.map(() => ({ kind: 'idle' })));

    for (const [index, shot] of plan.shots.entries()) {
      const mark = (state: ShotState): void =>
        setShotStates((current) => current.map((entry, position) => (position === index ? state : entry)));
      mark({ kind: 'running', stage: 'submitting' });

      const result = await generateShot({
        projectId,
        modelId: model.id,
        // Each shot is rendered blind, so the continuity keys are restated in
        // every prompt rather than referenced across shots.
        prompt: `${prompt.trim()} — shot ${shot.index} of ${plan.shots.length}, ${shot.durationSeconds}s. Keep consistent: ${CONTINUITY_KEYS.join(', ')}.`,
        aspectRatio,
        durationSeconds: shot.durationSeconds,
        onProgress: (stage) => mark({ kind: 'running', stage })
      });

      if (!result.ok) {
        mark({ kind: 'failed', message: result.message });
        // Stopping on the first failure: the remaining shots would charge for a
        // sequence the user can no longer assemble as planned.
        break;
      }

      const project = readProject(projectId);
      if (project === null) {
        mark({ kind: 'failed', message: 'The project could not be read to save this shot.' });
        break;
      }
      mark(appendAssetToTimeline(project, result.asset) === null
        ? { kind: 'failed', message: 'The clip was generated but no video track would take it.' }
        : { kind: 'done' });
    }

    setRunning(false);
  };

  const start = (): void => {
    const standing = permissions.standingFor('video-generation');
    if (standing === 'reject') {
      setShotStates([{ kind: 'failed', message: 'Video generation is set to never charge. Change it in Settings.' }]);
      return;
    }
    if (standing === 'always') {
      void runGeneration();
      return;
    }
    setAsking(true);
  };

  const decide = (decision: Decision): void => {
    setAsking(false);
    permissions.remember('video-generation', decision);
    if (decision !== 'reject') void runGeneration();
  };

  const costLine =
    cost.fullyPriced && cost.totalUsd !== undefined ? `~$${cost.totalUsd.toFixed(2)}` : 'Cost unknown';
  const canGenerate =
    projectId !== null && !running && prompt.trim().length > 0 && connected[model?.providerId ?? ''] === true;

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingTop: topInset + 16 }]}>
      <Text style={styles.h1}>Plan a video</Text>
      <Text style={styles.sub}>Shot lengths and prices come from the same modules the desktop app uses.</Text>

      <Text style={styles.label}>Model</Text>
      <ModelPicker
        domain="video-generation"
        selectedId={modelId}
        connectedSlots={connected}
        onSelect={(next) => setPlan(() => setModelId(next.id))}
        onConnectionChange={refreshConnections}
      />

      <Text style={styles.label}>Length</Text>
      <View style={styles.row}>
        {LENGTHS.map((seconds) => (
          <Chip
            key={seconds}
            label={`${seconds}s`}
            selected={seconds === totalSeconds}
            onPress={() => setPlan(() => setTotalSeconds(seconds))}
          />
        ))}
      </View>

      <Text style={styles.label}>Aspect ratio</Text>
      <View style={styles.row}>
        {RATIOS.map((ratio) => (
          <Chip key={ratio} label={ratio} selected={ratio === aspectRatio} onPress={() => setPlan(() => setAspectRatio(ratio))} />
        ))}
      </View>

      <Text style={styles.label}>Prompt · used for every shot</Text>
      <TextInput
        style={styles.input}
        value={prompt}
        onChangeText={(value) => setPlan(() => setPrompt(value))}
        placeholder="Describe the video…"
        placeholderTextColor={theme.textWeaker}
        multiline
        accessibilityLabel="Video prompt"
      />

      <Text style={styles.label}>
        {plan.shots.length} shot{plan.shots.length === 1 ? '' : 's'} · accepts{' '}
        {supportedShotSeconds(model.providerId).join('/')}s
      </Text>
      {plan.shots.map((shot) => (
        <View key={shot.index} style={styles.shot}>
          <Text style={styles.shotIndex}>{String(shot.index).padStart(2, '0')}</Text>
          <Text style={styles.shotBody}>
            {shot.startSeconds}s → {shot.startSeconds + shot.durationSeconds}s
          </Text>
          <Text style={styles.shotLen}>{shot.durationSeconds}s</Text>
          <ShotStatus state={shotStates[shot.index - 1] ?? { kind: 'idle' }} />
        </View>
      ))}
      {shotStates.map((state, index) =>
        state.kind === 'failed' ? (
          <Text key={`failed-${index}`} style={styles.warn}>
            Shot {index + 1}: {state.message}
          </Text>
        ) : null
      )}

      {plan.roundedFrom !== undefined && (
        <Text style={styles.warn}>
          {plan.roundedFrom}s is not reachable from this model&apos;s shot lengths — the plan runs{' '}
          {plan.totalSeconds}s.
        </Text>
      )}

      <Text style={styles.label}>Repeat in every shot prompt</Text>
      <Text style={styles.body}>
        {CONTINUITY_KEYS.join(' · ')} — each shot is rendered blind, so anything that must stay the same has to be
        restated rather than referenced.
      </Text>

      <View style={styles.costCard}>
        <Text style={styles.costLabel}>Estimated cost</Text>
        {cost.fullyPriced && cost.totalUsd !== undefined ? (
          <>
            <Text style={styles.total}>~${cost.totalUsd.toFixed(2)}</Text>
            {cost.shots.map((estimate, index) => (
              <Text key={index} style={styles.estimate}>
                {String(index + 1).padStart(2, '0')} · ${(estimate.amountUsd ?? 0).toFixed(2)} · {estimate.basis}
              </Text>
            ))}
          </>
        ) : (
          <Text style={styles.warn}>
            At least one shot could not be priced, so no total is shown — a partial sum reads as the whole bill.
            Confirm you accept an unknown charge before generating.
          </Text>
        )}
        <Text style={styles.footnote}>List price recorded {PRICING_AS_OF}. An estimate, not a quote.</Text>

        <Pressable
          accessibilityRole="button"
          disabled={!canGenerate}
          onPress={start}
          style={[styles.approve, !canGenerate && styles.approveOff]}
        >
          <Text style={styles.approveText}>
            {running ? 'Generating…' : `Generate ${plan.shots.length} shot${plan.shots.length === 1 ? '' : 's'}`}
          </Text>
        </Pressable>
        {projectId === null && <Text style={styles.footnote}>Open a project first — generated shots are saved into it.</Text>}
        {projectId !== null && connected[model?.providerId ?? ''] !== true && (
          <Text style={styles.footnote}>{model?.providerLabel} is not connected. Add its key in Settings.</Text>
        )}
        {shotStates.some((state) => state.kind === 'done') && (
          <Text style={styles.footnote}>
            Finished shots are appended to the project&apos;s video track — open Edit to see them.
          </Text>
        )}
      </View>

      <SpendPrompt feature="video-generation" cost={costLine} visible={asking} onDecide={decide} />
    </ScrollView>
  );
}

function ShotStatus({ state }: { readonly state: ShotState }) {
  if (state.kind === 'idle') return null;
  if (state.kind === 'running') {
    return (
      <View style={styles.status}>
        <ActivityIndicator size="small" color={theme.accent} />
        <Text style={styles.statusText}>{state.stage}</Text>
      </View>
    );
  }
  return (
    <Text style={[styles.statusText, state.kind === 'done' ? styles.statusDone : styles.statusFailed]}>
      {state.kind === 'done' ? 'saved' : 'failed'}
    </Text>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipOn]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 20, paddingBottom: 40, gap: 6 },
  h1: { color: theme.text, fontSize: 26, fontWeight: '700' },
  sub: { color: theme.textWeak, fontSize: 13, lineHeight: 19, marginBottom: 8 },
  label: { color: theme.text, fontSize: 12, fontWeight: '600', marginTop: 20, marginBottom: 8 },
  body: { color: theme.textWeak, fontSize: 12, lineHeight: 18 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: theme.line },
  chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.textWeak, fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: theme.bg },
  shot: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: theme.line },
  shotIndex: { color: theme.mint, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  shotBody: { color: theme.text, fontSize: 13, flex: 1, fontVariant: ['tabular-nums'] },
  shotLen: { color: theme.textWeak, fontSize: 12, fontVariant: ['tabular-nums'] },
  warn: { color: theme.warn, fontSize: 12, lineHeight: 18, marginTop: 6 },
  costCard: { marginTop: 24, padding: 16, borderRadius: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line, gap: 4 },
  costLabel: { color: theme.textWeak, fontSize: 11, fontWeight: '600', letterSpacing: 0.8 },
  total: { color: theme.text, fontSize: 32, fontWeight: '700', fontVariant: ['tabular-nums'], marginBottom: 6 },
  estimate: { color: theme.textWeak, fontSize: 11, fontVariant: ['tabular-nums'] },
  footnote: { color: theme.textWeaker, fontSize: 11, lineHeight: 16, marginTop: 8 },
  input: { minHeight: 84, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.surface, color: theme.text, fontSize: 14, textAlignVertical: 'top' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { color: theme.textWeak, fontSize: 10, fontWeight: '600' },
  statusDone: { color: theme.mint },
  statusFailed: { color: theme.danger },
  approveOff: { opacity: 0.35 },
  approve: { marginTop: 14, paddingVertical: 14, borderRadius: 10, alignItems: 'center', backgroundColor: theme.accent },
  approveText: { color: theme.bg, fontSize: 14, fontWeight: '700' }
});
