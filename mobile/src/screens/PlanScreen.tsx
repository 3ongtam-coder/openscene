import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { estimateVideoPlanCost, PRICING_AS_OF } from '@openvideo/shared/mediaGenerationPricing';
import { planVideoStoryboard, supportedShotSeconds, CONTINUITY_KEYS } from '@openvideo/shared/videoStoryboardPlan';
import { getDomainModels } from '@openvideo/shared/aiDomainModels';
import { ModelPicker } from '../components/ModelPicker';
import { readConnectedSlots, PROVIDER_KEYS } from '../lib/credentials';
import { theme } from '../lib/theme';

const LENGTHS = [8, 16, 30, 45, 60] as const;

export function PlanScreen({ topInset }: { readonly topInset: number }) {
  const catalog = getDomainModels('video-generation');
  const [totalSeconds, setTotalSeconds] = useState<number>(30);
  const [modelId, setModelId] = useState<string>(() => catalog.find((entry) => entry.available)?.id ?? '');
  const [connected, setConnected] = useState<Readonly<Record<string, boolean>>>({});
  const [approved, setApproved] = useState(false);

  // Connection is reported by provider id, which is what the picker keys on.
  useEffect(() => {
    let cancelled = false;
    void readConnectedSlots().then((slots) => {
      if (cancelled) return;
      setConnected(
        Object.fromEntries(PROVIDER_KEYS.map(({ slot, providerId }) => [providerId, slots[slot] === true]))
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const model = catalog.find((entry) => entry.id === modelId) ?? catalog[0];
  const plan = useMemo(
    () => planVideoStoryboard({ totalSeconds, providerId: model.providerId }),
    [totalSeconds, model.providerId]
  );
  const cost = useMemo(
    () => estimateVideoPlanCost(plan.shots.map((shot) => ({ modelId: model.id, durationSeconds: shot.durationSeconds }))),
    [plan, model.id]
  );

  // Changing anything about the plan invalidates approval. Carrying it across a
  // change would let the user approve one price and generate another.
  const setPlan = (next: () => void): void => {
    setApproved(false);
    next();
  };

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
        </View>
      ))}

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
          accessibilityState={{ selected: approved }}
          onPress={() => setApproved((value) => !value)}
          style={[styles.approve, approved && styles.approveDone]}
        >
          <Text style={[styles.approveText, approved && styles.approveTextDone]}>
            {approved ? 'Spend approved — generate on the desktop' : 'Approve this spend'}
          </Text>
        </Pressable>
        {approved && (
          <Text style={styles.footnote}>
            Approval covers this plan only. Changing the length or the model clears it.
          </Text>
        )}
      </View>
    </ScrollView>
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
  approve: { marginTop: 14, paddingVertical: 14, borderRadius: 10, alignItems: 'center', backgroundColor: theme.accent },
  approveDone: { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.mint },
  approveText: { color: theme.bg, fontSize: 14, fontWeight: '700' },
  approveTextDone: { color: theme.mint }
});
