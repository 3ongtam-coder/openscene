import type { IpcMain } from 'electron';

import { IPC_CHANNELS } from '../shared/ipc';
import { VoiceTtsIpcService } from './voiceTtsIpcService';

export function registerVoiceTtsIpcHandlers(ipcMain: IpcMain, service: VoiceTtsIpcService): void {
  ipcMain.handle(IPC_CHANNELS.voiceProfilesList, () => service.listVoiceProfiles());
  ipcMain.handle(IPC_CHANNELS.voiceProfilesStart, (_event, payload: unknown) => service.startVoiceProfile(payload));
  ipcMain.handle(IPC_CHANNELS.voiceProfilesAppend, (_event, payload: unknown) => service.appendVoiceProfile(payload));
  ipcMain.handle(IPC_CHANNELS.voiceProfilesFinalize, (_event, payload: unknown) => service.finalizeVoiceProfile(payload));
  ipcMain.handle(IPC_CHANNELS.voiceProfilesDiscard, (_event, payload: unknown) => service.discardVoiceProfile(payload));
  ipcMain.handle(IPC_CHANNELS.voiceProfilesDelete, (_event, payload: unknown) => service.deleteVoiceProfile(payload));
  ipcMain.handle(IPC_CHANNELS.getTtsRuntimeStatus, () => service.getTtsRuntimeStatus());
  ipcMain.handle(IPC_CHANNELS.startTtsJob, (_event, payload: unknown) => service.startTtsJob(payload));
  ipcMain.handle(IPC_CHANNELS.getTtsJob, (_event, payload: unknown) => service.getTtsJob(payload));
  ipcMain.handle(IPC_CHANNELS.openTtsResult, (_event, payload: unknown) => service.openTtsResult(payload));
  ipcMain.handle(IPC_CHANNELS.revealTtsResult, (_event, payload: unknown) => service.revealTtsResult(payload));
}
