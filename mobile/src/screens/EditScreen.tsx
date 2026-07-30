import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { theme } from '../lib/theme';
import { useMobileEditor, type EditorAsset } from '../lib/editorState';
import { exportTimeline } from '../lib/exportComposition';

const TRACK_HEIGHT = { video: 56, audio: 40 } as const;
const RAIL = 92;

function formatMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 100) / 10);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${(total - minutes * 60).toFixed(1).padStart(4, '0')}`;
}

export function EditScreen({ topInset }: { readonly topInset: number }) {
  const editor = useMobileEditor();
  const [pxPerSecond, setPxPerSecond] = useState(28);
  const [exportState, setExportState] = useState<
    { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; uri: string } | { kind: 'failed'; message: string }
  >({ kind: 'idle' });
  const laneWidth = useRef(0);

  const timelineWidth = useMemo(
    () => Math.max(240, (editor.durationMs / 1000) * pxPerSecond + 80),
    [editor.durationMs, pxPerSecond]
  );

  const importMedia = async (): Promise<void> => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsMultipleSelection: false,
      quality: 1
    });
    const file = picked.assets?.[0];
    if (picked.canceled || file === undefined) return;

    const asset: EditorAsset = {
      id: `asset-${Date.now().toString(36)}`,
      // The library gives a local URI. It stays in the app, never crossing into
      // the shared model, which knows only asset ids.
      uri: file.uri,
      displayName: file.fileName ?? 'Clip',
      kind: 'video',
      mimeType: file.mimeType ?? 'video/mp4',
      byteLength: file.fileSize ?? 0,
      projectRelativePath: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        durationMs: Math.round(file.duration ?? 5_000),
        width: file.width ?? 1920,
        height: file.height ?? 1080
      }
    };
    editor.addAsset(asset);
  };

  const runExport = async (): Promise<void> => {
    setExportState({ kind: 'running' });
    const outcome = await exportTimeline({ timeline: editor.timeline, assets: editor.assets });
    setExportState(outcome.ok ? { kind: 'done', uri: outcome.uri } : { kind: 'failed', message: outcome.message });
  };

  return (
    <View style={[styles.root, { paddingTop: topInset + 12 }]}>
      <View style={styles.head}>
        <Text style={styles.h1}>Edit</Text>
        <Text style={styles.clock}>{formatMs(editor.playheadMs)} / {formatMs(editor.durationMs)}</Text>
      </View>

      {/* Tap a clip, then act on it. A phone has no hover and no right-click, so
          the desktop's tool-then-target model does not transfer. */}
      {/* A horizontal ScrollView stretches its children to the content height
          by default, which made every tool a full-screen column. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.toolbarScroll}
        contentContainerStyle={styles.toolbar}
      >
        <Tool label="Import" onPress={() => void importMedia()} />
        <Tool label="Split" onPress={editor.splitAtPlayhead} disabled={editor.selectedClipId === null} />
        <Tool label="−1s" onPress={() => editor.nudgeSelected(-1000)} disabled={editor.selectedClipId === null} />
        <Tool label="+1s" onPress={() => editor.nudgeSelected(1000)} disabled={editor.selectedClipId === null} />
        <Tool label="Trim ⟩" onPress={() => editor.trimSelected('left', 500)} disabled={editor.selectedClipId === null} />
        <Tool label="⟨ Trim" onPress={() => editor.trimSelected('right', -500)} disabled={editor.selectedClipId === null} />
        <Tool label="Delete" tone="danger" onPress={editor.deleteSelected} disabled={editor.selectedClipId === null} />
        <Tool label="Undo" onPress={editor.undo} disabled={!editor.canUndo} />
        <Tool label="Redo" onPress={editor.redo} disabled={!editor.canRedo} />
        <Tool label="Zoom +" onPress={() => setPxPerSecond((value) => Math.min(120, value * 1.5))} />
        <Tool label="Zoom −" onPress={() => setPxPerSecond((value) => Math.max(6, value / 1.5))} />
        <Tool
          label={exportState.kind === 'running' ? 'Exporting…' : 'Export'}
          onPress={() => void runExport()}
          disabled={exportState.kind === 'running' || editor.durationMs <= 0}
        />
      </ScrollView>

      {editor.message !== null && <Text style={styles.message}>{editor.message}</Text>}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        style={styles.timelineScroll}
        contentContainerStyle={{ width: timelineWidth }}
      >
        <View style={styles.tracks}>
          {editor.timeline.tracks.map((track) => (
            <View key={track.id} style={[styles.track, { minHeight: TRACK_HEIGHT[track.kind] }]}>
              <View style={styles.rail}>
                <Text style={styles.railName} numberOfLines={1}>{track.name}</Text>
                <Text style={styles.railKind}>{track.kind}</Text>
              </View>
              <Pressable
                style={styles.lane}
                onLayout={(event) => {
                  laneWidth.current = event.nativeEvent.layout.width;
                }}
                onPress={(event) => {
                  // Tapping empty lane scrubs, which is the only way to move the
                  // playhead without a separate scrub bar stealing vertical space.
                  editor.setPlayheadMs(Math.max(0, (event.nativeEvent.locationX / pxPerSecond) * 1000));
                  editor.setSelectedClipId(null);
                }}
              >
                {track.clips.map((clip) => {
                  const lengthMs = clip.sourceEndMs - clip.sourceStartMs;
                  const selected = clip.id === editor.selectedClipId;
                  return (
                    <Pressable
                      key={clip.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${editor.assetFor(clip.assetId)?.displayName ?? 'Clip'}, ${formatMs(lengthMs)}`}
                      onPress={() => editor.setSelectedClipId(clip.id)}
                      style={[
                        styles.clip,
                        {
                          left: (clip.timelineStartMs / 1000) * pxPerSecond,
                          width: Math.max(18, (lengthMs / 1000) * pxPerSecond)
                        },
                        track.kind === 'audio' && styles.clipAudio,
                        selected && styles.clipOn
                      ]}
                    >
                      <Text style={styles.clipText} numberOfLines={1}>
                        {editor.assetFor(clip.assetId)?.displayName ?? clip.assetId}
                      </Text>
                    </Pressable>
                  );
                })}
              </Pressable>
            </View>
          ))}
          <View
            pointerEvents="none"
            style={[styles.playhead, { left: RAIL + (editor.playheadMs / 1000) * pxPerSecond }]}
          />
        </View>
      </ScrollView>

      {editor.timeline.tracks.every((track) => track.clips.length === 0) && (
        <Text style={styles.empty}>Import a clip to start. Tap a clip to select it, then use the tools above.</Text>
      )}

      {exportState.kind === 'failed' && <Text style={styles.message}>{exportState.message}</Text>}
      {exportState.kind === 'done' && <Text style={styles.exported}>Exported to {exportState.uri}</Text>}
      <Text style={styles.exportNote}>
        Export renders with AVFoundation on iOS. Android is not implemented yet and says so rather than producing a
        file that is not there.
      </Text>
    </View>
  );
}

function Tool({
  label,
  onPress,
  disabled,
  tone
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'danger';
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled === true}
      onPress={onPress}
      style={[styles.tool, disabled === true && styles.toolOff, tone === 'danger' && styles.toolDanger]}
    >
      <Text style={[styles.toolText, tone === 'danger' && styles.toolDangerText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 0 },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 20 },
  h1: { color: theme.text, fontSize: 26, fontWeight: '700' },
  clock: { color: theme.textWeak, fontSize: 13, fontVariant: ['tabular-nums'] },
  toolbarScroll: { flexGrow: 0 },
  toolbar: { gap: 8, paddingHorizontal: 20, paddingVertical: 14, alignItems: 'center' },
  tool: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.surface },
  toolOff: { opacity: 0.3 },
  toolDanger: { borderColor: theme.danger },
  toolText: { color: theme.text, fontSize: 13, fontWeight: '600' },
  toolDangerText: { color: theme.danger },
  message: { color: theme.warn, fontSize: 12, paddingHorizontal: 20, paddingBottom: 8 },
  timelineScroll: { flexGrow: 0 },
  tracks: { position: 'relative', paddingBottom: 8 },
  track: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.line },
  rail: { width: RAIL, paddingHorizontal: 10, justifyContent: 'center', borderRightWidth: 1, borderRightColor: theme.line },
  railName: { color: theme.text, fontSize: 11, fontWeight: '600' },
  railKind: { color: theme.textWeaker, fontSize: 10 },
  lane: { flex: 1, position: 'relative', backgroundColor: theme.surface },
  clip: { position: 'absolute', top: 6, bottom: 6, borderRadius: 6, backgroundColor: theme.accent, paddingHorizontal: 6, justifyContent: 'center', overflow: 'hidden' },
  clipAudio: { backgroundColor: theme.mint },
  clipOn: { borderWidth: 2, borderColor: theme.text },
  clipText: { color: theme.bg, fontSize: 10, fontWeight: '700' },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: theme.text },
  empty: { color: theme.textWeak, fontSize: 13, lineHeight: 19, paddingHorizontal: 20, paddingTop: 20 },
  exported: { color: theme.mint, fontSize: 11, paddingHorizontal: 20, paddingTop: 12 },
  exportNote: { color: theme.textWeaker, fontSize: 11, lineHeight: 16, paddingHorizontal: 20, paddingTop: 16 }
});
