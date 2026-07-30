import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { EditScreen } from './src/screens/EditScreen';
import { GenerateSheet, type GenerateTarget } from './src/screens/GenerateSheet';
import { ImageScreen } from './src/screens/ImageScreen';
import { PlanScreen } from './src/screens/PlanScreen';
import { ProjectsScreen } from './src/screens/ProjectsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { VoiceScreen } from './src/screens/VoiceScreen';
import { readProject } from './src/lib/projectStore';
import { timelineDurationMs } from '@openvideo/shared/timelineLogic';
import { theme } from './src/lib/theme';

/**
 * Two levels, like every editor of this kind: a project list, and the editor you
 * enter from it. The generation surfaces are not peers of the project — they are
 * things you reach for while editing one — so they open over the editor rather
 * than sitting in a tab bar beside it.
 */
type Route = { readonly name: 'projects' } | { readonly name: 'editor'; readonly projectId: string };

export default function App() {
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  );
}

function Shell() {
  const insets = useSafeAreaInsets();
  const [route, setRoute] = useState<Route>({ name: 'projects' });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [modal, setModal] = useState<GenerateTarget | 'settings' | null>(null);

  const projectId = route.name === 'editor' ? route.projectId : null;
  // The voice screen sizes a script against the picture, so it needs the cut's
  // length rather than a number typed twice.
  const pictureSeconds =
    projectId === null ? 0 : timelineDurationMs(readProject(projectId)?.timeline ?? { schemaVersion: 3, tracks: [], transitions: [] }) / 1000;

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {route.name === 'projects' ? (
        <ProjectsScreen
          topInset={insets.top}
          activeProjectId={null}
          onOpen={(id) => setRoute({ name: 'editor', projectId: id })}
          onOpenSettings={() => setModal('settings')}
        />
      ) : (
        <View style={styles.editor}>
          <View style={[styles.bar, { paddingTop: insets.top + 8 }]}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back to projects" onPress={() => setRoute({ name: 'projects' })} style={styles.barButton}>
              <Text style={styles.barIcon}>‹</Text>
            </Pressable>
            <Text style={styles.barTitle} numberOfLines={1}>
              {readProject(route.projectId)?.name ?? 'Project'}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={() => setModal('settings')} style={styles.barButton}>
              <Text style={styles.barIcon}>⚙</Text>
            </Pressable>
          </View>

          <View style={styles.editorBody}>
            <EditScreen topInset={0} projectId={route.projectId} />
          </View>

          <View style={[styles.dock, { paddingBottom: insets.bottom + 10 }]}>
            <Pressable accessibilityRole="button" onPress={() => setSheetOpen(true)} style={styles.generate}>
              <Text style={styles.generateText}>✦  Generate</Text>
            </Pressable>
          </View>
        </View>
      )}

      <GenerateSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} onSelect={setModal} />

      <Modal visible={modal !== null} animationType="slide" onRequestClose={() => setModal(null)}>
        <View style={styles.root}>
          {modal === 'video' && <PlanScreen topInset={insets.top} />}
          {modal === 'image' && <ImageScreen topInset={insets.top} />}
          {modal === 'voice' && <VoiceScreen topInset={insets.top} targetSeconds={pictureSeconds} />}
          {modal === 'agent' && <AgentPlaceholder topInset={insets.top} />}
          {modal === 'settings' && <SettingsScreen topInset={insets.top} />}
          <Pressable accessibilityRole="button" onPress={() => setModal(null)} style={[styles.close, { bottom: insets.bottom + 16 }]}>
            <Text style={styles.closeText}>Done</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

/**
 * Stated rather than stubbed with a chat box that cannot do anything. The
 * agent's tools read and write a project through the filesystem and a long-lived
 * process; neither exists here yet.
 */
function AgentPlaceholder({ topInset }: { readonly topInset: number }) {
  return (
    <View style={[styles.placeholder, { paddingTop: topInset + 40 }]}>
      <Text style={styles.placeholderTitle}>AI assistant</Text>
      <Text style={styles.placeholderBody}>
        Not ported yet. The assistant drives the editor through tools that read and write a project on disk and run in
        a long-lived process — neither of which the app has. The pieces that did cross are already here: shot planning
        and pricing under Video, and narration sizing under Voice.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  editor: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: theme.line },
  barButton: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  barIcon: { color: theme.text, fontSize: 22 },
  barTitle: { flex: 1, color: theme.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  editorBody: { flex: 1 },
  dock: { paddingHorizontal: 20, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.line, backgroundColor: theme.surface },
  generate: { paddingVertical: 14, borderRadius: 10, alignItems: 'center', backgroundColor: theme.accent },
  generateText: { color: theme.bg, fontSize: 15, fontWeight: '700' },
  close: { position: 'absolute', right: 20, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 10, backgroundColor: theme.accent },
  closeText: { color: theme.bg, fontSize: 14, fontWeight: '700' },
  placeholder: { flex: 1, paddingHorizontal: 24, gap: 12 },
  placeholderTitle: { color: theme.text, fontSize: 24, fontWeight: '700' },
  placeholderBody: { color: theme.textWeak, fontSize: 14, lineHeight: 21 }
});
