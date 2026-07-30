import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { nextVisualBoundaryMs } from '@openvideo/shared/timelinePlayback';
import { theme } from '../lib/theme';
import { useMobileEditor, type EditorAsset } from '../lib/editorState';
import {
  assetUri,
  deleteAsset,
  importAsset,
  readProject,
  writeProject,
  type MobileAsset
} from '../lib/projectStore';
import { PreviewPlayer } from '../components/PreviewPlayer';
import { TimelineClip } from '../components/TimelineClip';
import { MediaLibrary } from '../components/MediaLibrary';

const TRACK_HEIGHT = { video: 56, audio: 40 } as const;
const RAIL = 92;

function formatMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 100) / 10);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${(total - minutes * 60).toFixed(1).padStart(4, '0')}`;
}

export function EditScreen({
  topInset,
  projectId
}: {
  readonly topInset: number;
  readonly projectId: string | null;
}) {
  const editor = useMobileEditor((timeline) => {
    if (projectId === null) return;
    const project = readProject(projectId);
    if (project !== null) writeProject({ ...project, timeline });
  });

  const [pxPerSecond, setPxPerSecond] = useState(28);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [storedAssets, setStoredAssets] = useState<readonly MobileAsset[]>([]);
  const [playing, setPlaying] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [inspecting, setInspecting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const pxPerMs = pxPerSecond / 1000;

  // Opening a project replaces the editor's document and its undo history.
  const { loadProject } = editor;
  useEffect(() => {
    if (projectId === null) return;
    const project = readProject(projectId);
    if (project === null) return;
    setStoredAssets(project.assets);
    loadProject(
      project.timeline,
      project.assets.map((asset) => ({
        id: asset.id,
        uri: assetUri(project.id, asset),
        displayName: asset.displayName,
        kind: asset.kind,
        mimeType: asset.mimeType,
        byteLength: 0,
        projectRelativePath: asset.relativePath,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        metadata: { durationMs: asset.durationMs, width: asset.width, height: asset.height }
      }))
    );
  }, [projectId, loadProject, reloadToken]);

  const timelineWidth = useMemo(
    () => Math.max(240, editor.durationMs * pxPerMs + 80),
    [editor.durationMs, pxPerMs]
  );

  const visible = editor.visible;
  const visibleAsset = visible === null ? null : editor.assetFor(visible.clip.assetId);

  // The player reports source time; the timeline needs where that lands on it.
  const { setPlayheadMs } = editor;
  const onProgress = useCallback(
    (sourceTimeMs: number) => {
      if (!playing || visible === null) return;
      setPlayheadMs(visible.clip.timelineStartMs + (sourceTimeMs - visible.clip.sourceStartMs));
    },
    [playing, visible, setPlayheadMs]
  );

  /**
   * A clip ending is not the sequence ending. Jump to the next clip's start if
   * there is one, so playback runs the cut rather than stopping at every join.
   */
  const onEnded = useCallback(() => {
    const next = nextVisualBoundaryMs(editor.timeline, editor.playheadMs);
    if (next === null) {
      setPlaying(false);
      return;
    }
    setPlayheadMs(next);
  }, [editor.timeline, editor.playheadMs, setPlayheadMs]);

  // Over a gap there is nothing to play from, so time has to be advanced here or
  // playback would stall on an empty stretch of timeline.
  const gapTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (gapTimer.current !== null) {
      clearInterval(gapTimer.current);
      gapTimer.current = null;
    }
    if (!playing || visible !== null) return;
    gapTimer.current = setInterval(() => setPlayheadMs((current) => current + 100), 100);
    return () => {
      if (gapTimer.current !== null) clearInterval(gapTimer.current);
    };
  }, [playing, visible, setPlayheadMs]);

  useEffect(() => {
    if (playing && editor.playheadMs >= editor.durationMs && editor.durationMs > 0) setPlaying(false);
  }, [playing, editor.playheadMs, editor.durationMs]);

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

    if (projectId === null) return;
    const project = readProject(projectId);
    if (project === null) return;

    // Copied into the project, not referenced: a photo-library URI stops
    // resolving when the user deletes the original or revokes access.
    const stored = importAsset(projectId, {
      uri: file.uri,
      displayName: file.fileName ?? 'Clip',
      mimeType: file.mimeType ?? 'video/mp4',
      durationMs: Math.round(file.duration ?? 5_000),
      width: file.width ?? 1920,
      height: file.height ?? 1080,
      kind: 'video'
    });
    writeProject({ ...project, assets: [...project.assets, stored] });

    const asset: EditorAsset = {
      id: stored.id,
      uri: assetUri(projectId, stored),
      displayName: stored.displayName,
      kind: stored.kind,
      mimeType: stored.mimeType,
      byteLength: 0,
      projectRelativePath: stored.relativePath,
      createdAt: project.createdAt,
      updatedAt: new Date().toISOString(),
      metadata: { durationMs: stored.durationMs, width: stored.width, height: stored.height }
    };
    editor.addAsset(asset);
  };

  const selected = editor.selectedClip;

  /** How many clips reference each asset, so the library can say what is in use. */
  const usage = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const track of editor.timeline.tracks) {
      for (const clip of track.clips) counts[clip.assetId] = (counts[clip.assetId] ?? 0) + 1;
    }
    return counts;
  }, [editor.timeline]);

  return (
    <View style={[styles.root, { paddingTop: topInset }]}>
      <PreviewPlayer
        uri={visibleAsset?.uri ?? null}
        sourceTimeMs={visible?.sourceTimeMs ?? 0}
        playing={playing && visible !== null}
        onProgress={onProgress}
        onEnded={onEnded}
      />

      <View style={styles.transport}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause' : 'Play'}
          disabled={editor.durationMs === 0}
          onPress={() => setPlaying((value) => !value)}
          style={[styles.play, editor.durationMs === 0 && styles.disabled]}
        >
          <Text style={styles.playGlyph}>{playing ? '❙❙' : '▶'}</Text>
        </Pressable>
        <Text style={styles.clock}>
          {formatMs(editor.playheadMs)} / {formatMs(editor.durationMs)}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => setPlayheadMs(0)} style={styles.small}>
          <Text style={styles.smallText}>⏮</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setPxPerSecond((value) => Math.max(6, value / 1.5))}
          style={styles.small}
        >
          <Text style={styles.smallText}>−</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setPxPerSecond((value) => Math.min(160, value * 1.5))}
          style={styles.small}
        >
          <Text style={styles.smallText}>+</Text>
        </Pressable>
      </View>

      {/* A horizontal ScrollView stretches its children to the content height
          by default, which made every tool a full-screen column. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.toolbarScroll}
        contentContainerStyle={styles.toolbar}
      >
        <Tool label="Import" onPress={() => void importMedia()} disabled={projectId === null} />
        <Tool label="Split" onPress={editor.splitAtPlayhead} disabled={selected === null} />
        <Tool label="Adjust" onPress={() => setInspecting((open) => !open)} disabled={selected === null} />
        <Tool label="Delete" tone="danger" onPress={editor.deleteSelected} disabled={selected === null} />
        <Tool label="Undo" onPress={editor.undo} disabled={!editor.canUndo} />
        <Tool label="Redo" onPress={editor.redo} disabled={!editor.canRedo} />
        <Tool label="Media" onPress={() => setMediaOpen((open) => !open)} disabled={projectId === null} />
        <Tool label="+ Video" onPress={() => editor.addTrack('video')} />
        <Tool label="+ Audio" onPress={() => editor.addTrack('audio')} />
      </ScrollView>

      {editor.message !== null && <Text style={styles.message}>{editor.message}</Text>}

      {mediaOpen && projectId !== null && (
        <MediaLibrary
          projectId={projectId}
          assets={storedAssets}
          usage={usage}
          onAdd={editor.placeExisting}
          onDelete={(assetId) => {
            deleteAsset(projectId, assetId);
            // Reloaded from disk rather than patched in place: deleting drops
            // clips too, and the editor's undo stack must not offer a step back
            // to a timeline that references a file which no longer exists.
            setReloadToken((token) => token + 1);
          }}
        />
      )}

      {inspecting && selected !== null && (
        <View style={styles.inspector}>
          <Text style={styles.inspectorTitle}>Selected clip</Text>
          <Stepper
            label="Opacity"
            value={`${Math.round(selected.clip.effects.opacity * 100)}%`}
            onDown={() => editor.setSelectedEffects({ opacity: Math.max(0, selected.clip.effects.opacity - 0.1) })}
            onUp={() => editor.setSelectedEffects({ opacity: Math.min(1, selected.clip.effects.opacity + 0.1) })}
          />
          <Stepper
            label="Scale"
            value={`${Math.round(selected.clip.effects.scale * 100)}%`}
            onDown={() => editor.setSelectedEffects({ scale: Math.max(0.1, selected.clip.effects.scale - 0.1) })}
            onUp={() => editor.setSelectedEffects({ scale: Math.min(4, selected.clip.effects.scale + 0.1) })}
          />
          <Stepper
            label="Volume"
            value={`${Math.round(selected.clip.effects.volume * 100)}%`}
            onDown={() => editor.setSelectedEffects({ volume: Math.max(0, selected.clip.effects.volume - 0.1) })}
            onUp={() => editor.setSelectedEffects({ volume: Math.min(2, selected.clip.effects.volume + 0.1) })}
          />
        </View>
      )}

      <ScrollView style={styles.timelineVertical}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          // Frozen while a clip is being dragged, or the scroll view steals the
          // pan the moment the finger moves sideways.
          scrollEnabled={!dragging}
          contentContainerStyle={{ width: timelineWidth + RAIL }}
        >
          <View style={styles.tracks}>
            {editor.timeline.tracks.map((track) => (
              <View key={track.id} style={[styles.track, { minHeight: TRACK_HEIGHT[track.kind] }]}>
                <View style={styles.rail}>
                  <Text style={styles.railName} numberOfLines={1}>
                    {track.name}
                  </Text>
                  <View style={styles.railRow}>
                    {track.kind === 'audio' && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${track.mix.muted ? 'Unmute' : 'Mute'} ${track.name}`}
                        onPress={() => editor.setTrackMuted(track.id, !track.mix.muted)}
                        style={styles.railButton}
                      >
                        <Text style={[styles.railButtonText, track.mix.muted && styles.railMuted]}>
                          {track.mix.muted ? 'muted' : 'live'}
                        </Text>
                      </Pressable>
                    )}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${track.name}`}
                      onPress={() => editor.removeTrack(track.id)}
                      style={styles.railButton}
                    >
                      <Text style={styles.railButtonText}>✕</Text>
                    </Pressable>
                  </View>
                </View>
                <Pressable
                  style={styles.lane}
                  onPress={(event) => {
                    // Tapping empty lane scrubs, which is the only way to move the
                    // playhead without a separate scrub bar stealing vertical space.
                    setPlayheadMs(Math.max(0, event.nativeEvent.locationX / pxPerMs));
                    editor.setSelectedClipId(null);
                  }}
                >
                  {track.clips.map((clip) => (
                    <TimelineClip
                      key={clip.id}
                      clip={clip}
                      kind={track.kind}
                      pxPerMs={pxPerMs}
                      selected={clip.id === editor.selectedClipId}
                      label={editor.assetFor(clip.assetId)?.displayName ?? clip.assetId}
                      onSelect={() => editor.setSelectedClipId(clip.id)}
                      onMove={(startMs) => editor.moveClipTo(clip.id, track.id, startMs)}
                      onTrim={(edge, atMs) => editor.trimClipTo(clip.id, edge, atMs)}
                      onDragStateChange={setDragging}
                    />
                  ))}
                </Pressable>
              </View>
            ))}
            <View pointerEvents="none" style={[styles.playhead, { left: RAIL + editor.playheadMs * pxPerMs }]} />
          </View>
        </ScrollView>

        {projectId === null ? (
          <Text style={styles.empty}>Open a project from the Projects tab to start editing.</Text>
        ) : (
          editor.timeline.tracks.every((track) => track.clips.length === 0) && (
            <Text style={styles.empty}>
              Import a clip, or generate one under Video. Drag a clip to move it; drag its ends to trim.
            </Text>
          )
        )}
      </ScrollView>
    </View>
  );
}

function Stepper({
  label,
  value,
  onDown,
  onUp
}: {
  label: string;
  value: string;
  onDown: () => void;
  onUp: () => void;
}) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Decrease ${label}`} onPress={onDown} style={styles.stepperButton}>
        <Text style={styles.stepperButtonText}>−</Text>
      </Pressable>
      <Text style={styles.stepperValue}>{value}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Increase ${label}`} onPress={onUp} style={styles.stepperButton}>
        <Text style={styles.stepperButtonText}>+</Text>
      </Pressable>
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
  root: { flex: 1, backgroundColor: theme.bg },
  transport: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.line },
  play: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent },
  playGlyph: { color: theme.bg, fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.3 },
  clock: { flex: 1, color: theme.text, fontSize: 13, fontVariant: ['tabular-nums'] },
  small: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, borderColor: theme.line, alignItems: 'center', justifyContent: 'center' },
  smallText: { color: theme.text, fontSize: 14, fontWeight: '700' },
  toolbarScroll: { flexGrow: 0 },
  toolbar: { gap: 8, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center' },
  tool: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: theme.line, backgroundColor: theme.surface },
  toolOff: { opacity: 0.3 },
  toolDanger: { borderColor: theme.danger },
  toolText: { color: theme.text, fontSize: 13, fontWeight: '600' },
  toolDangerText: { color: theme.danger },
  message: { color: theme.warn, fontSize: 12, paddingHorizontal: 16, paddingBottom: 8 },
  inspector: { paddingHorizontal: 16, paddingBottom: 10, gap: 6 },
  inspectorTitle: { color: theme.textWeak, fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepperLabel: { flex: 1, color: theme.text, fontSize: 12 },
  stepperButton: { width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: theme.line, alignItems: 'center', justifyContent: 'center' },
  stepperButtonText: { color: theme.text, fontSize: 14, fontWeight: '700' },
  stepperValue: { width: 48, textAlign: 'center', color: theme.textWeak, fontSize: 12, fontVariant: ['tabular-nums'] },
  timelineVertical: { flex: 1 },
  tracks: { position: 'relative', paddingBottom: 8 },
  track: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.line },
  rail: { width: RAIL, paddingHorizontal: 10, justifyContent: 'center', gap: 3, borderRightWidth: 1, borderRightColor: theme.line },
  railName: { color: theme.text, fontSize: 11, fontWeight: '600' },
  railRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  railButton: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, borderWidth: 1, borderColor: theme.line },
  railButtonText: { color: theme.textWeaker, fontSize: 9, fontWeight: '700' },
  railMuted: { color: theme.warn },
  lane: { flex: 1, position: 'relative', backgroundColor: theme.surface },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: theme.text },
  empty: { color: theme.textWeak, fontSize: 13, lineHeight: 19, paddingHorizontal: 16, paddingTop: 20 }
});
