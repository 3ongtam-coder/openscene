import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../lib/theme';

export type GenerateTarget = 'video' | 'voice' | 'image' | 'agent';

const ENTRIES: readonly { id: GenerateTarget; label: string; detail: string; glyph: string }[] = [
  { id: 'video', label: 'Video generation', detail: 'Plan shots, price the job, approve the spend', glyph: '◫' },
  { id: 'voice', label: 'Voice generation', detail: 'Narration sized to the cut', glyph: '◍' },
  { id: 'image', label: 'Image generation', detail: 'Stills, and seeds for image-to-video', glyph: '◈' },
  { id: 'agent', label: 'AI assistant', detail: 'Drive the edit by describing it', glyph: '✦' }
];

/**
 * A sheet rather than a tab bar. These are things you reach for while editing a
 * specific project, so they belong inside the editor — a permanent tab for each
 * would put four destinations at the same level as the project itself.
 */
export function GenerateSheet({
  visible,
  onClose,
  onSelect
}: {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onSelect: (target: GenerateTarget) => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close menu" />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <Text style={styles.title}>Generate</Text>
        {ENTRIES.map((entry) => (
          <Pressable
            key={entry.id}
            accessibilityRole="button"
            style={styles.row}
            onPress={() => {
              onClose();
              onSelect(entry.id);
            }}
          >
            <Text style={styles.glyph}>{entry.glyph}</Text>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{entry.label}</Text>
              <Text style={styles.rowDetail}>{entry.detail}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: '#000000aa' },
  sheet: { backgroundColor: theme.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingBottom: 40, paddingTop: 10, paddingHorizontal: 16, gap: 4 },
  grabber: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: theme.line, marginBottom: 12 },
  title: { color: theme.textWeak, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 6, marginLeft: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: theme.line },
  glyph: { color: theme.accent, fontSize: 18, width: 22, textAlign: 'center' },
  rowText: { flex: 1 },
  rowLabel: { color: theme.text, fontSize: 15, fontWeight: '600' },
  rowDetail: { color: theme.textWeaker, fontSize: 12, marginTop: 2 },
  chevron: { color: theme.textWeaker, fontSize: 20 }
});
