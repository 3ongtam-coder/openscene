import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { PROVIDER_KEYS, readSlot, writeSlot } from '../lib/credentials';
import { SPEND_FEATURES, useSpendPermissions } from '../lib/permissions';
import { getDomainModels } from '@openvideo/shared/aiDomainModels';
import { LLM_PROVIDERS, POPULAR_LLM_PROVIDER_IDS, getLlmCatalogProvider } from '@openvideo/shared/llmProviders';
import { theme } from '../lib/theme';

type Row = { readonly slot: string; readonly label: string; readonly hint: string; readonly meta: string };

/**
 * One row per credential, media and chat together.
 *
 * A provider that serves both — OpenAI generates images and answers chat — has
 * one key and appears once. The catalog names the slot (`credentialKey`) and the
 * media table names the same slot, so storing it in either place connects both.
 */
function credentialRows(mediaModels: (providerId: string) => { readonly runnable: number; readonly listed: number }): readonly Row[] {
  const rows: Row[] = PROVIDER_KEYS.map(({ slot, label, hint, providerId }) => {
    const { runnable, listed } = mediaModels(providerId);
    return {
      slot,
      label,
      hint,
      // A provider whose models are listed but unported must not read as
      // "chat only" — the key is still the right key, the adapter is what is
      // missing, and conflating the two sends the user looking for the wrong fix.
      meta:
        listed === 0
          ? 'chat models only'
          : runnable === 0
            ? `${listed} media models, none runnable yet`
            : `${runnable} of ${listed} media models run here`
    };
  });
  const taken = new Set(rows.map((row) => row.slot));
  for (const id of POPULAR_LLM_PROVIDER_IDS) {
    const provider = LLM_PROVIDERS.find((entry) => entry.id === id);
    if (provider?.credentialKey === undefined || taken.has(provider.credentialKey)) continue;
    taken.add(provider.credentialKey);
    rows.push({
      slot: provider.credentialKey,
      label: provider.label,
      hint: provider.keyPlaceholder ?? 'API key',
      meta: `${getLlmCatalogProvider(provider.id)?.models.length ?? 0} chat models`
    });
  }
  return rows;
}

export function SettingsScreen({ topInset }: { readonly topInset: number }) {
  const [connected, setConnected] = useState<Readonly<Record<string, boolean>>>({});
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const permissions = useSpendPermissions();

  /** What a key unlocks, and what it cannot yet — the reason to add it. */
  const mediaModels = (providerId: string): { readonly runnable: number; readonly listed: number } => {
    const mine = (['video-generation', 'image-generation', 'voice-generation'] as const)
      .flatMap((domain) => getDomainModels(domain))
      .filter((model) => model.providerId === providerId);
    return { runnable: mine.filter((model) => model.available).length, listed: mine.length };
  };

  const rows = credentialRows(mediaModels);

  const refresh = async (): Promise<void> => {
    const entries = await Promise.all(rows.map(async ({ slot }) => [slot, (await readSlot(slot)) !== null] as const));
    setConnected(Object.fromEntries(entries));
  };

  useEffect(() => {
    void refresh();
    // Reading every slot once on mount; the row set is static for a given build.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (slot: string): Promise<void> => {
    await writeSlot(slot, drafts[slot] ?? '');
    // The draft is cleared rather than kept: holding the key in component state
    // after it is in the keystore serves no purpose and widens where it lives.
    setDrafts((current) => ({ ...current, [slot]: '' }));
    await refresh();
    setSaved(slot);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingTop: topInset + 16 }]}>
      <Text style={styles.h1}>Providers</Text>
      <Text style={styles.sub}>
        Keys are held in the device keystore — Keychain on iOS, Keystore on Android — never in the app bundle or in
        plain storage.
      </Text>

      {rows.map(({ slot, label, hint, meta }) => (
        <View key={slot} style={styles.card}>
          <View style={styles.cardHead}>
            <View>
              <Text style={styles.cardTitle}>{label}</Text>
              <Text style={styles.cardMeta}>{meta}</Text>
            </View>
            <Text style={[styles.badge, connected[slot] === true ? styles.badgeOn : styles.badgeOff]}>
              {connected[slot] === true ? 'connected' : 'not connected'}
            </Text>
          </View>
          <TextInput
            style={styles.input}
            value={drafts[slot] ?? ''}
            onChangeText={(value) => setDrafts((current) => ({ ...current, [slot]: value }))}
            placeholder={connected[slot] === true ? 'Replace the stored key' : hint}
            placeholderTextColor={theme.textWeaker}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            accessibilityLabel={`${label} API key`}
          />
          {/* An empty field on a provider with nothing stored has no action to
              offer. Labelling that button "Clear" invited the user to delete a
              key that does not exist. */}
          {(() => {
            const draft = (drafts[slot] ?? '').trim();
            const isConnected = connected[slot] === true;
            const action = draft.length > 0 ? 'save' : isConnected ? 'clear' : 'none';
            return (
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={action === 'none'}
                  onPress={() => void save(slot)}
                  style={[styles.save, action === 'none' && styles.saveOff, action === 'clear' && styles.saveClear]}
                >
                  <Text style={[styles.saveText, action === 'clear' && styles.saveClearText]}>
                    {action === 'clear' ? 'Remove stored key' : 'Save'}
                  </Text>
                </Pressable>
                {saved === slot && <Text style={styles.savedNote}>{isConnected ? 'Stored.' : 'Removed.'}</Text>}
              </View>
            );
          })()}
        </View>
      ))}

      <Text style={styles.section}>Spending permissions</Text>
      <Text style={styles.sub}>
        Generation charges your own provider account, so each kind asks before the first one. “Always” is remembered
        per kind — allowing every image is a different decision from allowing every video, and they do not cost the
        same.
      </Text>
      {SPEND_FEATURES.map((feature) => {
        const standing = permissions.standingFor(feature);
        return (
          <View key={feature} style={styles.permRow}>
            <Text style={styles.permLabel}>{feature.replace('-generation', '')}</Text>
            <Text style={styles.permValue}>{standing === null ? 'asks each time' : standing}</Text>
            {standing !== null && (
              <Pressable accessibilityRole="button" onPress={() => permissions.forget(feature)} style={styles.permReset}>
                <Text style={styles.permResetText}>Reset</Text>
              </Pressable>
            )}
          </View>
        );
      })}

      <Text style={styles.footnote}>
        A stored key is never read back into the app for display — only whether one exists. Saving an empty field
        deletes it.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 20, paddingBottom: 40, gap: 12 },
  h1: { color: theme.text, fontSize: 26, fontWeight: '700' },
  sub: { color: theme.textWeak, fontSize: 13, lineHeight: 19, marginBottom: 4 },
  card: { padding: 14, borderRadius: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.line, gap: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: theme.text, fontSize: 14, fontWeight: '600' },
  badge: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  badgeOn: { color: theme.bg, backgroundColor: theme.mint },
  badgeOff: { color: theme.textWeaker, borderWidth: 1, borderColor: theme.line },
  input: {
    padding: 11,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.bg,
    color: theme.text,
    fontSize: 13
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  save: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 8, backgroundColor: theme.accent },
  saveOff: { opacity: 0.35 },
  saveClear: { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.danger },
  saveText: { color: theme.bg, fontSize: 13, fontWeight: '700' },
  saveClearText: { color: theme.danger },
  savedNote: { color: theme.mint, fontSize: 12 },
  cardMeta: { color: theme.textWeaker, fontSize: 10, marginTop: 2 },
  section: { color: theme.text, fontSize: 15, fontWeight: '700', marginTop: 20 },
  permRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.line },
  permLabel: { flex: 1, color: theme.text, fontSize: 13, textTransform: 'capitalize' },
  permValue: { color: theme.textWeak, fontSize: 12 },
  permReset: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: theme.line },
  permResetText: { color: theme.textWeak, fontSize: 11, fontWeight: '600' },
  footnote: { color: theme.textWeaker, fontSize: 11, lineHeight: 17, marginTop: 4 }
});
