import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../lib/theme';
import type { Decision, SpendFeature } from '../lib/permissions';

const LABEL: Record<SpendFeature, string> = {
  'image-generation': 'image generation',
  'video-generation': 'video generation',
  'voice-generation': 'voice generation'
};

/**
 * The desktop's once / always / reject, asked before the charge rather than
 * after it. The cost line is the point of the prompt: the tool name and its
 * arguments say nothing about what the tap will cost.
 */
export function SpendPrompt({
  feature,
  cost,
  visible,
  onDecide
}: {
  readonly feature: SpendFeature;
  readonly cost: string;
  readonly visible: boolean;
  readonly onDecide: (decision: Decision) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => onDecide('reject')}>
      <View style={styles.scrim}>
        <View style={styles.card}>
          <Text style={styles.title}>Charge your {LABEL[feature].split(' ')[0]} provider?</Text>
          <Text style={styles.cost}>{cost}</Text>
          <Text style={styles.body}>
            This runs against your own account. “Always” applies to {LABEL[feature]} only, and can be cleared in
            Settings.
          </Text>
          <Pressable accessibilityRole="button" style={styles.primary} onPress={() => onDecide('once')}>
            <Text style={styles.primaryText}>Allow once</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => onDecide('always')}>
            <Text style={styles.secondaryText}>Always allow {LABEL[feature]}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => onDecide('reject')}>
            <Text style={styles.rejectText}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: '#000000cc', justifyContent: 'center', padding: 26 },
  card: { backgroundColor: theme.surface, borderRadius: 16, padding: 20, gap: 10, borderWidth: 1, borderColor: theme.line },
  title: { color: theme.text, fontSize: 17, fontWeight: '700' },
  cost: { color: theme.mint, fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  body: { color: theme.textWeak, fontSize: 12, lineHeight: 18, marginBottom: 4 },
  primary: { paddingVertical: 13, borderRadius: 10, alignItems: 'center', backgroundColor: theme.accent },
  primaryText: { color: theme.bg, fontSize: 14, fontWeight: '700' },
  secondary: { paddingVertical: 12, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: theme.line },
  secondaryText: { color: theme.text, fontSize: 13, fontWeight: '600' },
  rejectText: { color: theme.textWeak, fontSize: 13, fontWeight: '600' }
});
