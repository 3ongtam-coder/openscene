import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';

import { getDomainModels, type AiDomain, type AiDomainModelConfig } from '@openvideo/shared/aiDomainModels';
import { theme } from '../lib/theme';

/**
 * Every model the shared catalog knows for a domain, not a hand-picked few.
 *
 * Unavailable ones are shown but not selectable, with the reason the catalog
 * gives. Hiding them would make the app look like it supports less than it
 * knows about; offering them would turn a tap into a failure the user cannot
 * act on.
 */
export function ModelPicker({
  domain,
  selectedId,
  connectedSlots,
  onSelect
}: {
  readonly domain: AiDomain;
  readonly selectedId: string;
  readonly connectedSlots?: Readonly<Record<string, boolean>>;
  readonly onSelect: (model: AiDomainModelConfig) => void;
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
      <ModelNote model={models.find((entry) => entry.id === selectedId)} connectedSlots={connectedSlots} />
    </View>
  );
}

function ModelNote({
  model,
  connectedSlots
}: {
  readonly model: AiDomainModelConfig | undefined;
  readonly connectedSlots?: Readonly<Record<string, boolean>>;
}) {
  if (model === undefined) return null;
  if (!model.available) return <Text style={styles.warn}>{model.unavailableReason}</Text>;
  const connected = connectedSlots?.[model.providerId];
  return (
    <Text style={connected === false ? styles.warn : styles.note}>
      {connected === false ? `${model.providerLabel} has no key stored — add one in Settings.` : model.description}
    </Text>
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
  warn: { color: theme.warn, fontSize: 11, lineHeight: 16 }
});
