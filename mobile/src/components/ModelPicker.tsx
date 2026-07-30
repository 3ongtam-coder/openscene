import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';

import { getDomainModels, type AiDomain, type AiDomainModelConfig } from '@openvideo/shared/aiDomainModels';
import { providersForDomain, describeProvider } from '../lib/mediaProviders';
import { ProviderConnect } from './ProviderConnect';
import { theme } from '../lib/theme';

/**
 * Every model the shared catalog knows for a domain, not a hand-picked few.
 *
 * Unavailable ones are shown but not selectable, with the reason the catalog
 * gives. Hiding them would make the app look like it supports less than it
 * knows about; offering them would turn a tap into a failure the user cannot
 * act on.
 *
 * When the selected model's provider has no key, the connect form appears right
 * here. Sending the user to Settings for it made the picker report a problem it
 * could have solved: they had to leave, find one provider among a dozen, and
 * come back to the screen they were already on.
 */
export function ModelPicker({
  domain,
  selectedId,
  connectedSlots,
  onSelect,
  onConnectionChange
}: {
  readonly domain: AiDomain;
  readonly selectedId: string;
  readonly connectedSlots?: Readonly<Record<string, boolean>>;
  readonly onSelect: (model: AiDomainModelConfig) => void;
  /** Called after a key is stored or removed, so the screen can re-read state. */
  readonly onConnectionChange?: () => void;
}) {
  const models = getDomainModels(domain);
  return (
    <View style={styles.root}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.row}>
        {models.map((model) => {
          const selected = model.id === selectedId;
          return (
            <Pressable
              key={model.id}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled: !model.available }}
              disabled={!model.available}
              onPress={() => onSelect(model)}
              style={[styles.chip, selected && styles.chipOn, !model.available && styles.chipOff]}
            >
              <Text style={[styles.provider, selected && styles.textOn]}>{model.providerLabel}</Text>
              <Text style={[styles.label, selected && styles.textOn]}>{model.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <ModelNote
        model={models.find((entry) => entry.id === selectedId)}
        connectedSlots={connectedSlots}
        domain={domain}
        onConnectionChange={onConnectionChange}
      />
    </View>
  );
}

function ModelNote({
  model,
  connectedSlots,
  domain,
  onConnectionChange
}: {
  readonly model: AiDomainModelConfig | undefined;
  readonly connectedSlots?: Readonly<Record<string, boolean>>;
  readonly domain: AiDomain;
  readonly onConnectionChange?: () => void;
}) {
  if (model === undefined) return null;
  if (!model.available) return <Text style={styles.warn}>{model.unavailableReason}</Text>;
  if (connectedSlots?.[model.providerId] !== false) return null;

  const provider = providersForDomain(domain).find((entry) => entry.providerId === model.providerId);
  if (provider === undefined) {
    return <Text style={styles.warn}>{model.providerLabel} cannot be connected from this app yet.</Text>;
  }
  return (
    <View style={styles.connect}>
      <ProviderConnect
        compact
        slot={provider.slot}
        label={`Connect ${provider.label}`}
        hint={provider.hint}
        meta={describeProvider(provider)}
        connected={false}
        onChange={() => onConnectionChange?.()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  scroll: { flexGrow: 0 },
  row: { gap: 8, alignItems: 'center', paddingVertical: 2 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: theme.line, minWidth: 108 },
  chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipOff: { opacity: 0.35 },
  provider: { color: theme.textWeaker, fontSize: 9, fontWeight: '700', letterSpacing: 0.4 },
  label: { color: theme.text, fontSize: 13, fontWeight: '600', marginTop: 1 },
  textOn: { color: theme.bg },
  note: { color: theme.textWeak, fontSize: 11, lineHeight: 16 },
  connect: { marginTop: 10 },
  warn: { color: theme.warn, fontSize: 11, lineHeight: 16 }
});
