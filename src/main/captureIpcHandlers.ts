import type { IpcMain } from 'electron';

import { IPC_CHANNELS } from '../shared/ipc';
import type { AppSettings, CaptureSource, ChunkAck, RecordingResult, RecordingSession, SourceAvailability } from '../shared/models';
import { SourceCatalog } from '../shared/sourceCatalog';
import {
  parseAbortRecordingInput,
  parseAppendRecordingChunkInput,
  parseFinishRecordingInput,
  parseResultActionInput,
  parseSelectSourceInput,
  parseSourceAvailabilityInput,
  parseStartRecordingInput
} from '../shared/validators';
import { errorFromUnknown, fail, ok } from './ipcResponses';
import { RecordingFileStore } from './recordingStore';

type CaptureIpcShell = {
  readonly openPath: (path: string) => Promise<string>;
  readonly showItemInFolder: (path: string) => void;
};

type CaptureIpcHandlersDependencies = {
  readonly ipcMain: IpcMain;
  readonly shell: CaptureIpcShell;
  readonly sourceCatalog: SourceCatalog;
  readonly recordingStore: RecordingFileStore;
  readonly getSettings: () => AppSettings;
  readonly listWindowSources: () => Promise<CaptureSource[]>;
  readonly isSourceStillAvailable: (sourceId: string) => Promise<boolean>;
};

export function registerCaptureIpcHandlers(dependencies: CaptureIpcHandlersDependencies): void {
  dependencies.ipcMain.handle(IPC_CHANNELS.getSettings, () => ok(dependencies.getSettings()));

  dependencies.ipcMain.handle(IPC_CHANNELS.listSources, async () => {
    try {
      return ok(await dependencies.listWindowSources());
    } catch (error: unknown) {
      const appError = errorFromUnknown(error, {
        code: 'PERMISSION_DENIED',
        message: 'Window sources could not be listed. Check macOS Screen Recording permission.'
      });
      return { ok: false, error: appError };
    }
  });

  dependencies.ipcMain.handle(IPC_CHANNELS.selectSource, (_event, payload: unknown) => {
    const input = parseSelectSourceInput(payload);
    if (input === null) {
      return fail<CaptureSource>('INVALID_INPUT', 'The selected source payload was not valid.');
    }
    const selectedSource = dependencies.sourceCatalog.select(input);
    if (selectedSource === null) {
      return fail<CaptureSource>('SOURCE_STALE', 'That window selection is stale. Refresh the window list and choose again.');
    }
    return ok(selectedSource);
  });

  dependencies.ipcMain.handle(IPC_CHANNELS.getSelectedSource, () => ok(dependencies.sourceCatalog.getSelected()));

  dependencies.ipcMain.handle(IPC_CHANNELS.startRecording, async (_event, payload: unknown) => {
    const input = parseStartRecordingInput(payload);
    if (input === null) {
      return fail<RecordingSession>('INVALID_INPUT', 'The recording start payload was not valid.');
    }
    if (!dependencies.sourceCatalog.hasCurrentSource(input)) {
      return fail<RecordingSession>('SOURCE_STALE', 'The selected window is stale. Refresh and select it again.');
    }
    const selectedSource = dependencies.sourceCatalog.getSelected();
    if (selectedSource === null || selectedSource.id !== input.sourceId) {
      return fail<RecordingSession>('SOURCE_NOT_FOUND', 'Select a window before starting a recording.');
    }
    if (!(await dependencies.isSourceStillAvailable(selectedSource.id))) {
      dependencies.sourceCatalog.clearSelected();
      return fail<RecordingSession>('SOURCE_UNAVAILABLE', 'The selected window is no longer capturable.');
    }
    try {
      return ok(await dependencies.recordingStore.begin({ sourceId: selectedSource.id, sourceName: selectedSource.name }));
    } catch (error: unknown) {
      const appError = errorFromUnknown(error, { code: 'FILE_WRITE_FAILED', message: 'The recording file could not be created.' });
      return { ok: false, error: appError };
    }
  });

  dependencies.ipcMain.handle(IPC_CHANNELS.appendRecordingChunk, async (_event, payload: unknown) => {
    const input = parseAppendRecordingChunkInput(payload);
    if (input === null) {
      return fail<ChunkAck>('INVALID_INPUT', 'The recording chunk payload was not valid.');
    }
    try {
      return ok(await dependencies.recordingStore.appendChunk(input.sessionId, input.sequence, input.chunk));
    } catch (error: unknown) {
      const appError = errorFromUnknown(error, { code: 'SESSION_CLOSED', message: 'The recording session is not writable.' });
      return { ok: false, error: appError };
    }
  });

  dependencies.ipcMain.handle(IPC_CHANNELS.finishRecording, async (_event, payload: unknown) => {
    const input = parseFinishRecordingInput(payload);
    if (input === null) {
      return fail<RecordingResult>('INVALID_INPUT', 'The recording finish payload was not valid.');
    }
    try {
      return ok(await dependencies.recordingStore.finalize(input.sessionId, input.durationMs));
    } catch (error: unknown) {
      const appError = errorFromUnknown(error, { code: 'SESSION_NOT_FOUND', message: 'The recording session could not be finalized.' });
      return { ok: false, error: appError };
    }
  });

  dependencies.ipcMain.handle(IPC_CHANNELS.abortRecording, async (_event, payload: unknown) => {
    const input = parseAbortRecordingInput(payload);
    if (input === null) {
      return fail<{ readonly aborted: boolean }>('INVALID_INPUT', 'The recording abort payload was not valid.');
    }
    await dependencies.recordingStore.abort(input.sessionId);
    return ok({ aborted: true });
  });

  dependencies.ipcMain.handle(IPC_CHANNELS.checkSelectedSource, async (_event, payload: unknown) => {
    const input = parseSourceAvailabilityInput(payload);
    if (input === null) {
      return fail<SourceAvailability>('INVALID_INPUT', 'The source check payload was not valid.');
    }
    const sessionToCheck = dependencies.recordingStore.getActiveSession(input.sessionId);
    if (sessionToCheck === null) {
      return ok<SourceAvailability>({ available: false, reason: 'Recording session is no longer active.' });
    }
    const available = await dependencies.isSourceStillAvailable(sessionToCheck.sourceId);
    return ok<SourceAvailability>(available ? { available } : { available, reason: 'The selected window is no longer available.' });
  });

  dependencies.ipcMain.handle(IPC_CHANNELS.openResult, async (_event, payload: unknown) => {
    const input = parseResultActionInput(payload);
    if (input === null) {
      return fail<{ readonly opened: boolean }>('INVALID_INPUT', 'The result action payload was not valid.');
    }
    const result = dependencies.recordingStore.getResult(input.sessionId);
    if (result === null) {
      return fail<{ readonly opened: boolean }>('SESSION_NOT_FOUND', 'The saved recording result is unknown.');
    }
    const openError = await dependencies.shell.openPath(result.outputPath);
    return openError.length > 0 ? fail('UNKNOWN_ERROR', openError) : ok({ opened: true });
  });

  dependencies.ipcMain.handle(IPC_CHANNELS.revealResult, (_event, payload: unknown) => {
    const input = parseResultActionInput(payload);
    if (input === null) {
      return fail<{ readonly revealed: boolean }>('INVALID_INPUT', 'The result action payload was not valid.');
    }
    const result = dependencies.recordingStore.getResult(input.sessionId);
    if (result === null) {
      return fail<{ readonly revealed: boolean }>('SESSION_NOT_FOUND', 'The saved recording result is unknown.');
    }
    dependencies.shell.showItemInFolder(result.outputPath);
    return ok({ revealed: true });
  });
}
