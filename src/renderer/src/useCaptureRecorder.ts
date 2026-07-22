import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AppSettings, CaptureSource, RecordingResult, RecordingSession } from '../../shared/models';
import { errorMessage, type StatusMessage } from './appTypes';
import { supportedCaptureConstraints, type CaptureWorkflowState } from './captureConstraints';
import { chooseRecorderMimeType, stopMediaStream } from './recorder';

export function useCaptureRecorder() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [selectedSource, setSelectedSource] = useState<CaptureSource | null>(null);
  const [workflowState, setWorkflowState] = useState<CaptureWorkflowState>('idle');
  const [statusMessage, setStatusMessage] = useState<StatusMessage>({
    tone: 'neutral',
    text: 'Refresh windows, choose one source, then approve macOS Screen Recording if prompted.'
  });
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [session, setSession] = useState<RecordingSession | null>(null);
  const [result, setResult] = useState<RecordingResult | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const appendQueueRef = useRef<Promise<void>>(Promise.resolve());
  const chunkSequenceRef = useRef(0);
  const elapsedTimerRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);

  const canStop = workflowState === 'recording' || workflowState === 'paused';
  const canRecord = selectedSource !== null && streamRef.current !== null && (workflowState === 'source_selected' || workflowState === 'completed');

  const selectedSourceSubtitle = useMemo(() => {
    return selectedSource === null ? 'No source locked' : `${selectedSource.appName} · generation ${selectedSource.generation}`;
  }, [selectedSource]);

  const clearPreview = useCallback(() => {
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current !== null) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const stopElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current !== null) {
      window.clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    lastTickRef.current = null;
  }, []);

  const startElapsedTimer = useCallback(() => {
    stopElapsedTimer();
    lastTickRef.current = performance.now();
    elapsedTimerRef.current = window.setInterval(() => {
      const previousTick = lastTickRef.current;
      const now = performance.now();
      lastTickRef.current = now;
      if (previousTick !== null) {
        setElapsedMs((current) => current + now - previousTick);
      }
    }, 100);
  }, [stopElapsedTimer]);

  const loadSettings = useCallback(async () => {
    const response = await window.videoTool.getSettings();
    if (response.ok) {
      setSettings(response.value);
      return;
    }
    setStatusMessage({ tone: 'warning', text: errorMessage(response.error) });
  }, []);

  const refreshSources = useCallback(async () => {
    setIsLoadingSources(true);
    setSelectedSource(null);
    setWorkflowState('idle');
    setResult(null);
    clearPreview();
    const response = await window.videoTool.listSources();
    setIsLoadingSources(false);
    if (response.ok) {
      setSources(response.value);
      setStatusMessage({
        tone: response.value.length > 0 ? 'neutral' : 'warning',
        text: response.value.length > 0 ? `Found ${response.value.length} capturable window${response.value.length === 1 ? '' : 's'}. Pick one to arm preview.` : 'No capturable windows were returned. Check Screen Recording permission and keep target apps visible.'
      });
      return;
    }
    setSources([]);
    setStatusMessage({ tone: 'danger', text: errorMessage(response.error) });
  }, [clearPreview]);

  useEffect(() => {
    void loadSettings();
    void refreshSources();
    return () => {
      clearPreview();
      stopElapsedTimer();
    };
  }, [clearPreview, loadSettings, refreshSources, stopElapsedTimer]);

  const selectSource = useCallback(async (source: CaptureSource) => {
    if (workflowState === 'recording' || workflowState === 'paused' || workflowState === 'finalizing') {
      setStatusMessage({ tone: 'warning', text: 'Stop the active recording before changing sources.' });
      return;
    }
    clearPreview();
    setResult(null);
    const selection = await window.videoTool.selectSource({ sourceId: source.id, generation: source.generation });
    if (!selection.ok) {
      setSelectedSource(null);
      setWorkflowState('error');
      setStatusMessage({ tone: 'danger', text: errorMessage(selection.error) });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia(supportedCaptureConstraints());
      streamRef.current = stream;
      setSelectedSource(selection.value);
      setWorkflowState('source_selected');
      setElapsedMs(0);
      setStatusMessage({ tone: 'success', text: 'Preview is locked to the selected Electron desktopCapturer source.' });
      stream.getVideoTracks()[0]?.addEventListener('ended', () => recorderRef.current?.stop());
      if (videoRef.current !== null) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (error: unknown) {
      clearPreview();
      setSelectedSource(selection.value);
      setWorkflowState('error');
      setStatusMessage({ tone: 'danger', text: error instanceof Error ? error.message : 'Preview could not start. Check macOS Screen Recording permission.' });
    }
  }, [clearPreview, workflowState]);

  const finalizeRecording = useCallback(async (sessionId: string) => {
    setWorkflowState('finalizing');
    stopElapsedTimer();
    await appendQueueRef.current;
    const response = await window.videoTool.finishRecording({ sessionId, durationMs: Math.round(elapsedMs) });
    activeSessionIdRef.current = null;
    recorderRef.current = null;
    setSession(null);
    if (response.ok) {
      setResult(response.value);
      setWorkflowState('completed');
      setStatusMessage({ tone: 'success', text: 'Recording saved as a local WebM file.' });
      return;
    }
    setWorkflowState('error');
    setStatusMessage({ tone: 'danger', text: errorMessage(response.error) });
  }, [elapsedMs, stopElapsedTimer]);

  const startRecording = useCallback(async () => {
    if (selectedSource === null || streamRef.current === null) {
      setStatusMessage({ tone: 'warning', text: 'Select a source and wait for preview before recording.' });
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      setStatusMessage({ tone: 'danger', text: 'MediaRecorder is unavailable in this renderer.' });
      return;
    }
    const startResponse = await window.videoTool.startRecording({ sourceId: selectedSource.id, generation: selectedSource.generation });
    if (!startResponse.ok) {
      setWorkflowState('error');
      setStatusMessage({ tone: 'danger', text: errorMessage(startResponse.error) });
      return;
    }
    const mimeType = chooseRecorderMimeType();
    const recorder = mimeType.length > 0 ? new MediaRecorder(streamRef.current, { mimeType }) : new MediaRecorder(streamRef.current);
    chunkSequenceRef.current = 0;
    appendQueueRef.current = Promise.resolve();
    activeSessionIdRef.current = startResponse.value.id;
    recorderRef.current = recorder;
    setSession(startResponse.value);
    setResult(null);
    setElapsedMs(0);
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size === 0) {
        return;
      }
      const sequence = chunkSequenceRef.current;
      chunkSequenceRef.current += 1;
      appendQueueRef.current = appendQueueRef.current.then(async () => {
        const chunk = await event.data.arrayBuffer();
        const response = await window.videoTool.appendRecordingChunk({ sessionId: startResponse.value.id, sequence, chunk });
        if (!response.ok) {
          throw new Error(errorMessage(response.error));
        }
      });
    });
    recorder.addEventListener('stop', () => void finalizeRecording(startResponse.value.id));
    recorder.start(1000);
    setWorkflowState('recording');
    startElapsedTimer();
    setStatusMessage({ tone: 'neutral', text: 'Recording selected window only. Chunks are streaming to disk every second.' });
  }, [finalizeRecording, selectedSource, startElapsedTimer]);

  const pauseRecording = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.pause();
      setWorkflowState('paused');
      stopElapsedTimer();
      setStatusMessage({ tone: 'warning', text: 'Recording is paused. Preview remains live.' });
    }
  }, [stopElapsedTimer]);

  const resumeRecording = useCallback(() => {
    if (recorderRef.current?.state === 'paused') {
      recorderRef.current.resume();
      setWorkflowState('recording');
      startElapsedTimer();
      setStatusMessage({ tone: 'neutral', text: 'Recording resumed.' });
    }
  }, [startElapsedTimer]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current !== null && recorderRef.current.state !== 'inactive') {
      setWorkflowState('finalizing');
      stopElapsedTimer();
      recorderRef.current.stop();
      setStatusMessage({ tone: 'neutral', text: 'Finalizing WebM file on disk.' });
    }
  }, [stopElapsedTimer]);

  useEffect(() => {
    if ((workflowState !== 'recording' && workflowState !== 'paused') || session === null) {
      return;
    }
    const checkTimer = window.setInterval(() => {
      void window.videoTool.checkSelectedSource({ sessionId: session.id }).then((response) => {
        if (response.ok && !response.value.available) {
          setStatusMessage({ tone: 'danger', text: response.value.reason ?? 'The selected source is no longer available. Stopping safely.' });
          recorderRef.current?.stop();
        }
      });
    }, 2000);
    return () => window.clearInterval(checkTimer);
  }, [session, workflowState]);

  const abortActiveRecording = useCallback(async () => {
    if (session !== null) {
      await window.videoTool.abortRecording({ sessionId: session.id, reason: 'User discarded active recording.' });
      activeSessionIdRef.current = null;
      recorderRef.current = null;
      setSession(null);
      setWorkflowState(selectedSource === null ? 'idle' : 'source_selected');
      setStatusMessage({ tone: 'warning', text: 'Active recording was discarded.' });
    }
  }, [selectedSource, session]);

  const openResult = useCallback(async () => {
    if (result !== null) {
      const response = await window.videoTool.openResult({ sessionId: result.sessionId });
      if (!response.ok) setStatusMessage({ tone: 'danger', text: errorMessage(response.error) });
    }
  }, [result]);

  const revealResult = useCallback(async () => {
    if (result !== null) {
      const response = await window.videoTool.revealResult({ sessionId: result.sessionId });
      if (!response.ok) setStatusMessage({ tone: 'danger', text: errorMessage(response.error) });
    }
  }, [result]);

  return { settings, sources, selectedSource, workflowState, statusMessage, isLoadingSources, elapsedMs, session, result, canRecord, canPause: workflowState === 'recording', canResume: workflowState === 'paused', canStop, selectedSourceSubtitle, videoRef, loadSettings, refreshSources, selectSource, startRecording, pauseRecording, resumeRecording, stopRecording, abortActiveRecording, openResult, revealResult };
}
