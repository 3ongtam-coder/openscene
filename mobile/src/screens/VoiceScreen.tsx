import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { checkNarrationFit } from '@openvideo/shared/narrationTiming';
import { getDomainModels } from '@openvideo/shared/aiDomainModels';
import { ModelSelect } from '../components/ModelSelect';
import { readProviderConnections } from '../lib/mediaProviders';
import { theme } from '../lib/theme';

/**
 * Narration sizing works here because it is shared and pure. Synthesis does not:
 * the speech adapters still return a Node Buffer, exactly as the image ones did
 * before that byte handling was lifted into shared. Rather than a dead button,
 * the screen does the part that works and says which part does not.
 */
export function VoiceScreen({
  topInset,
  targetSeconds,
  connectionsVersion
}: {
  readonly topInset: number;
  readonly targetSeconds: number;
  /** Changes when Settings closes, so stored keys are picked up. */
  readonly connectionsVersion: number;
}) {
  const catalog = getDomainModels('voice-generation');
  const [modelId, setModelId] = useState<string>(() => catalog.find((entry) => entry.available)?.id ?? '');
  const [connected, setConnected] = useState<Readonly<Record<string, boolean>>>({});
  const [script, setScript] = useState('');

  const refreshConnections = useCallback((): void => {
    void readProviderConnections().then(setConnected);
  }, []);

  useEffect(refreshConnections, [refreshConnections, connectionsVersion]);
  const fit = useMemo(
    () => (script.trim().length === 0 ? null : checkNarrationFit({ script, targetSeconds })),
    [script, targetSeconds]
  );

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingTop: topInset + 16 }]}>
      <Text style={styles.h1}>Voice</Text>
      <Text style={styles.sub}>
        Write to the length of the cut. Over-running is the failure that costs a re-record, so the check runs before
        anything is paid for.
      </Text>

      <Text style={styles.label}>Voice model</Text>
      <ModelSelect
        domain="voice-generation"
        selectedId={modelId}
        connected={connected}
        onSelect={(next) => setModelId(next.id)}
        onConnectionChange={refreshConnections}
      />

      <Text style={styles.label}>Script · fitting {targetSeconds.toFixed(1)}s of picture</Text>
      <TextInput
        style={styles.input}
        value={script}
        onChangeText={setScript}
        multiline
        placeholder="Write the narration…"
        placeholderTextColor={theme.textWeaker}
        accessibilityLabel="Narration script"
      />

      {fit !== null && (
        <View style={styles.verdict}>
          <Text style={[styles.verdictLabel, fit.verdict === 'fits' ? styles.ok : styles.warn]}>
            {fit.verdict === 'fits' ? 'Fits' : fit.verdict === 'too-long' ? 'Too long' : 'Too short'}
          </Text>
          <Text style={styles.advice}>{fit.advice}</Text>
          <Text style={styles.counted}>
            {fit.estimate.units} {fit.estimate.kind === 'cjk-characters' ? 'characters' : 'words'} ·{' '}
            {fit.estimate.estimatedSeconds}s at a {fit.estimate.pace} pace
          </Text>
        </View>
      )}

      <Text style={styles.note}>
        Choosing the model works; synthesis does not yet. The speech adapters still return Node buffers — the same
        thing that blocked image generation until its byte handling moved into the shared core — so nothing here can
        charge your account, and the picker above only records which model the script is written for.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 20, paddingBottom: 40, gap: 6 },
  h1: { color: theme.text, fontSize: 26, fontWeight: '700' },
  sub: { color: theme.textWeak, fontSize: 13, lineHeight: 19, marginBottom: 8 },
  label: { color: theme.text, fontSize: 12, fontWeight: '600', marginTop: 16, marginBottom: 8 },
  input: { minHeight: 130, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.surface, color: theme.text, fontSize: 14, textAlignVertical: 'top' },
  verdict: { marginTop: 16, padding: 14, borderRadius: 10, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line, gap: 6 },
  verdictLabel: { fontSize: 13, fontWeight: '700' },
  ok: { color: theme.mint },
  warn: { color: theme.warn },
  advice: { color: theme.text, fontSize: 13, lineHeight: 19 },
  counted: { color: theme.textWeaker, fontSize: 11, fontVariant: ['tabular-nums'] },
  note: { color: theme.textWeaker, fontSize: 11, lineHeight: 17, marginTop: 20 }
});
