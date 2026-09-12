import { IPC_CHANNELS } from '../shared/ipc';
import type { ApiResponse } from '../shared/models';
import { requestGeminiWriter } from '../shared/writerGeneration';
import {
  parseWriterGenerationInput,
  type WriterDraft,
  type WriterGenerationInput
} from '../shared/writerWorkflow';
import type { CredentialStore } from './credentialStore';
import { fail, ok } from './ipcResponses';

type WriterIpcHandler = (payload?: unknown) => Promise<ApiResponse<WriterDraft>>;

export function registerWriterIpcHandler(dependencies: {
  readonly credentialStore: Pick<CredentialStore, 'getCredentialValue'>;
  readonly registerHandler: (channel: string, handler: WriterIpcHandler) => void;
  readonly generate?: (input: WriterGenerationInput & { readonly apiKey: string }) => Promise<WriterDraft>;
}): void {
  dependencies.registerHandler(IPC_CHANNELS.writerGenerate, async (payload) => {
    const input = parseWriterGenerationInput(payload);
    if (input === null) return fail('INVALID_INPUT', 'The Writer request was not valid.');
    const apiKey = (await dependencies.credentialStore.getCredentialValue('geminiApiKey'))?.trim();
    if (!apiKey) return fail('INVALID_INPUT', 'Gemini API key is missing. Connect Google Gemini in Settings first.');
    try {
      const draft = dependencies.generate === undefined
        ? await requestGeminiWriter({ apiKey, modelId: input.modelId, request: input.request })
        : await dependencies.generate({ ...input, apiKey });
      return ok(draft);
    } catch (error) {
      return fail('UNKNOWN_ERROR', error instanceof Error ? error.message : 'Gemini Writer failed.');
    }
  });
}
