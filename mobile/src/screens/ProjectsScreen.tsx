import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { createProject, deleteProject, listProjects, renameProject, type ProjectSummary } from '../lib/projectStore';
import { theme } from '../lib/theme';

export function ProjectsScreen({
  topInset,
  activeProjectId,
  onOpen,
  onOpenSettings
}: {
  readonly topInset: number;
  readonly activeProjectId: string | null;
  readonly onOpen: (projectId: string) => void;
  readonly onOpenSettings?: () => void;
}) {
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [draftName, setDraftName] = useState('');

  const refresh = useCallback(() => setProjects(listProjects()), []);
  useEffect(refresh, [refresh]);

  const confirmDelete = (project: ProjectSummary): void => {
    // Deleting a project removes its media too, so it asks. The desktop asks for
    // the same reason.
    Alert.alert('Delete project', `Delete “${project.name}” and its imported media? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteProject(project.id);
          refresh();
        }
      }
    ]);
  };

  const promptRename = (project: ProjectSummary): void => {
    Alert.prompt?.('Rename project', undefined, (name) => {
      if (renameProject(project.id, name ?? '') !== null) refresh();
    }, 'plain-text', project.name);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingTop: topInset + 16 }]}>
      <View style={styles.headRow}>
        <Text style={styles.h1}>Projects</Text>
        {onOpenSettings !== undefined && (
          <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={onOpenSettings} style={styles.iconButton}>
            <Text style={styles.icon}>⚙</Text>
          </Pressable>
        )}
      </View>
      <Text style={styles.sub}>
        Stored inside the app. Imported clips are copied in, so a project keeps working after the original is deleted
        from your library.
      </Text>

      <View style={styles.newRow}>
        <TextInput
          style={styles.input}
          value={draftName}
          onChangeText={setDraftName}
          placeholder="New project name"
          placeholderTextColor={theme.textWeaker}
          accessibilityLabel="New project name"
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            const project = createProject(draftName);
            setDraftName('');
            refresh();
            onOpen(project.id);
          }}
          style={styles.create}
        >
          <Text style={styles.createText}>Create</Text>
        </Pressable>
      </View>

      {projects.length === 0 ? (
        <Text style={styles.empty}>No projects yet. Create one to start editing.</Text>
      ) : (
        projects.map((project) => (
          <View key={project.id} style={[styles.card, project.id === activeProjectId && styles.cardActive]}>
            <Pressable style={styles.cardMain} accessibilityRole="button" onPress={() => onOpen(project.id)}>
              <Text style={styles.cardTitle}>{project.name}</Text>
              <Text style={styles.cardMeta}>
                {project.id === activeProjectId ? 'open · ' : ''}
                edited {project.updatedAt.slice(0, 16).replace('T', ' ')}
              </Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Rename ${project.name}`} onPress={() => promptRename(project)} style={styles.iconButton}>
              <Text style={styles.icon}>✎</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${project.name}`} onPress={() => confirmDelete(project)} style={styles.iconButton}>
              <Text style={[styles.icon, styles.iconDanger]}>✕</Text>
            </Pressable>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  content: { padding: 20, paddingBottom: 40, gap: 10 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  h1: { color: theme.text, fontSize: 26, fontWeight: '700' },
  sub: { color: theme.textWeak, fontSize: 13, lineHeight: 19, marginBottom: 6 },
  newRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, padding: 11, borderRadius: 8, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.surface, color: theme.text, fontSize: 13 },
  create: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 8, backgroundColor: theme.accent },
  createText: { color: theme.bg, fontSize: 13, fontWeight: '700' },
  empty: { color: theme.textWeak, fontSize: 13, marginTop: 12 },
  card: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.surface },
  cardActive: { borderColor: theme.accent },
  cardMain: { flex: 1 },
  cardTitle: { color: theme.text, fontSize: 14, fontWeight: '600' },
  cardMeta: { color: theme.textWeaker, fontSize: 11, marginTop: 2 },
  iconButton: { paddingHorizontal: 10, paddingVertical: 6 },
  icon: { color: theme.textWeak, fontSize: 14 },
  iconDanger: { color: theme.danger }
});
