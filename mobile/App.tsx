import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { timelineDurationMs } from '@openvideo/shared/timelineLogic';
import { AgentScreen } from './src/screens/AgentScreen';
import { EditScreen } from './src/screens/EditScreen';
import { ImageScreen } from './src/screens/ImageScreen';
import { PlanScreen } from './src/screens/PlanScreen';
import { ProjectsScreen } from './src/screens/ProjectsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { VoiceScreen } from './src/screens/VoiceScreen';
import { assetUri, readProject } from './src/lib/projectStore';
import { deliverExport, exportTimeline } from './src/lib/exportComposition';
import { isExportAvailable } from './modules/video-export';
import { theme } from './src/lib/theme';

/**
 * Two levels. The project list is the root; opening a project enters a container
 * that owns its own tabs.
 *
 * The tabs live inside the project rather than beside it. A flat bar would put
 * Projects at the same level as Voice, which is not true — but hiding the same
 * entries behind a sheet made the user open something to find out what was in
 * it. Inside the project they are all visible and one tap away, and the
 * hierarchy still holds.
 */
const PROJECT_TABS = [
  { id: 'edit', label: 'Edit', glyph: '▤' },
  { id: 'video', label: 'Video', glyph: '◫' },
  { id: 'voice', label: 'Voice', glyph: '◍' },
  { id: 'image', label: 'Image', glyph: '◈' },
  { id: 'agent', label: 'AI', glyph: '✦' }
] as const;

type ProjectTab = (typeof PROJECT_TABS)[number]['id'];
type Route = { readonly name: 'projects' } | { readonly name: 'project'; readonly projectId: string };
type ExportState = { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; where: string } | { kind: 'failed'; message: string };

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
  const [tab, setTab] = useState<ProjectTab>('edit');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportState, setExportState] = useState<ExportState>({ kind: 'idle' });

  if (route.name === 'projects') {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <ProjectsScreen
          topInset={insets.top}
          activeProjectId={null}
          onOpen={(id) => {
            setRoute({ name: 'project', projectId: id });
            setTab('edit');
            setExportState({ kind: 'idle' });
          }}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} topInset={insets.top} bottomInset={insets.bottom} />
      </View>
    );
  }

  const project = readProject(route.projectId);
  const pictureSeconds = project === null ? 0 : timelineDurationMs(project.timeline) / 1000;

  /**
   * Reads the project from disk rather than from the editor's state. Every
   * accepted edit already writes, so the stored copy is current — and it keeps
   * export out of the editing toolbar, where it sat among tools that change a
   * clip rather than produce the whole video.
   */
  const runExport = async (): Promise<void> => {
    const current = readProject(route.projectId);
    if (current === null) return;
    setExportState({ kind: 'running' });
    const rendered = await exportTimeline({
      timeline: current.timeline,
      assets: current.assets.map((asset) => ({
        id: asset.id,
        uri: assetUri(current.id, asset),
        displayName: asset.displayName,
        kind: asset.kind,
        mimeType: asset.mimeType,
        byteLength: 0,
        projectRelativePath: asset.relativePath,
        createdAt: current.createdAt,
        updatedAt: current.updatedAt,
        metadata: { durationMs: asset.durationMs, width: asset.width, height: asset.height }
      }))
    });
    if (!rendered.ok) {
      setExportState({ kind: 'failed', message: rendered.message });
      return;
    }
    const delivery = await deliverExport(rendered.uri);
    setExportState(
      delivery.ok
        ? { kind: 'done', where: delivery.how === 'photos' ? 'your photo library' : 'the app you chose' }
        : { kind: 'failed', message: delivery.message }
    );
  };

  const canExport = isExportAvailable && pictureSeconds > 0 && exportState.kind !== 'running';

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <View style={[styles.bar, { paddingTop: insets.top + 8 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to projects" onPress={() => setRoute({ name: 'projects' })} style={styles.barButton}>
          <Text style={styles.barIcon}>‹</Text>
        </Pressable>
        <Text style={styles.barTitle} numberOfLines={1}>{project?.name ?? 'Project'}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Export video"
          disabled={!canExport}
          onPress={() => void runExport()}
          style={[styles.export, !canExport && styles.exportOff]}
        >
          <Text style={styles.exportText}>{exportState.kind === 'running' ? '…' : 'Export'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={() => setSettingsOpen(true)} style={styles.barButton}>
          <Text style={styles.barIcon}>⚙</Text>
        </Pressable>
      </View>

      {exportState.kind === 'failed' && <Text style={styles.exportFail}>{exportState.message}</Text>}
      {exportState.kind === 'done' && <Text style={styles.exportOk}>Saved to {exportState.where}.</Text>}

      <View style={styles.body}>
        {tab === 'edit' && <EditScreen topInset={0} projectId={route.projectId} />}
        {tab === 'video' && <PlanScreen topInset={0} projectId={route.projectId} />}
        {tab === 'voice' && <VoiceScreen topInset={0} targetSeconds={pictureSeconds} />}
        {tab === 'image' && <ImageScreen topInset={0} />}
        {tab === 'agent' && <AgentScreen topInset={0} projectId={route.projectId} />}
      </View>

      <View style={[styles.tabBar, { paddingBottom: insets.bottom, height: 54 + insets.bottom }]}>
        {PROJECT_TABS.map(({ id, label, glyph }) => {
          const selected = id === tab;
          return (
            <Pressable
              key={id}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={label}
              onPress={() => setTab(id)}
              style={styles.tab}
            >
              <Text style={[styles.tabGlyph, selected && styles.tabOn]}>{glyph}</Text>
              <Text style={[styles.tabLabel, selected && styles.tabOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} topInset={insets.top} bottomInset={insets.bottom} />
    </View>
  );
}

function SettingsModal({ open, onClose, topInset, bottomInset }: { open: boolean; onClose: () => void; topInset: number; bottomInset: number }) {
  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <SettingsScreen topInset={topInset} />
        <Pressable accessibilityRole="button" onPress={onClose} style={[styles.done, { bottom: bottomInset + 16 }]}>
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: theme.line },
  barButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  barIcon: { color: theme.text, fontSize: 22 },
  barTitle: { flex: 1, color: theme.text, fontSize: 16, fontWeight: '700' },
  export: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: theme.accent },
  exportOff: { opacity: 0.3 },
  exportText: { color: theme.bg, fontSize: 13, fontWeight: '700' },
  exportFail: { color: theme.danger, fontSize: 12, paddingHorizontal: 20, paddingTop: 8 },
  exportOk: { color: theme.mint, fontSize: 12, paddingHorizontal: 20, paddingTop: 8 },
  body: { flex: 1 },
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: theme.line, backgroundColor: theme.surface },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tabGlyph: { color: theme.textWeaker, fontSize: 17, lineHeight: 21 },
  tabLabel: { color: theme.textWeaker, fontSize: 10, fontWeight: '600' },
  tabOn: { color: theme.accent },
  done: { position: 'absolute', right: 20, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 10, backgroundColor: theme.accent },
  doneText: { color: theme.bg, fontSize: 14, fontWeight: '700' },
});
