import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

import { requestAgentRouterCliWriter, type AgentRouterCliRunner } from '../src/main/agentRouterCliWriter';
import type { WriterDraft, WriterRequest } from '../src/shared/writerWorkflow';

const request: WriterRequest = {
  mode: 'content_to_script',
  sourceText: 'A private short product brief.',
  language: 'Vietnamese',
  audience: 'Creators',
  tone: 'Clear',
  targetDurationSeconds: 30
};

const draft: WriterDraft = {
  title: 'Creator tool',
  screenplay: 'A creator opens the tool.',
  characters: [],
  styleBible: { palette: [], lighting: '', cameraGrammar: '', texture: '', forbiddenChanges: [] },
  scenes: [{
    title: 'Open',
    objective: 'Introduce the tool.',
    setting: 'Studio',
    timeOfDay: 'Day',
    characterNames: [],
    continuityNotes: '',
    shots: [{
      durationSeconds: 8,
      framing: 'Medium',
      cameraMotion: 'Static',
      action: 'The tool opens.',
      dialogue: '',
      audioCues: [],
      negativePrompt: ''
    }]
  }]
};

describe('AgentRouter Claude Code Writer bridge', () => {
  it('keeps the key in child env, pipes the prompt over stdin, disables tools, and validates structured output', async () => {
    let isolatedCwd = '';
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const runCli = vi.fn<AgentRouterCliRunner>(async (input) => {
      isolatedCwd = input.cwd;
      expect(existsSync(input.cwd)).toBe(true);
      expect(input.args).toContain('gpt-5.6-sol');
      expect(input.args).toContain('--json-schema');
      expect(input.args).toContain('--bare');
      expect(input.args).toContain('--no-session-persistence');
      expect(input.args[input.args.indexOf('--output-format') + 1]).toBe('stream-json');
      expect(input.args[input.args.indexOf('--tools') + 1]).toBe('');
      expect(input.args.join(' ')).not.toContain('router-secret');
      expect(input.args.join(' ')).not.toContain(request.sourceText);
      expect(input.stdin).toContain(request.sourceText);
      expect(input.stdin).not.toContain('router-secret');
      expect(input.env.ANTHROPIC_BASE_URL).toBe('https://agentrouter.org');
      expect(input.env.ANTHROPIC_AUTH_TOKEN).toBe('router-secret');
      expect(input.env.ANTHROPIC_API_KEY).toBe('router-secret');
      expect(input.env.API_TIMEOUT_MS).toBe('120000');
      expect(input.env.CLAUDE_CODE_MAX_RETRIES).toBe('1');
      input.onProgress?.({ type: 'started', pid: 123 });
      input.onProgress?.({ type: 'initialized' });
      input.onProgress?.({
        type: 'retry',
        attempt: 1,
        maxRetries: 1,
        errorStatus: 429,
        error: `retry for router-secret after ${request.sourceText}`
      });
      input.onProgress?.({ type: 'heartbeat', elapsedMs: 10_000, stdoutBytes: 80, stderrBytes: 0 });
      return {
        exitCode: 0,
        stdout: [
          JSON.stringify({ type: 'system', subtype: 'init' }),
          JSON.stringify({ type: 'result', structured_output: draft })
        ].join('\n'),
        stderr: ''
      };
    });

    try {
      await expect(requestAgentRouterCliWriter({
        apiKey: 'router-secret',
        modelId: 'agentrouter/gpt-5.6-sol',
        request,
        executable: 'claude-test',
        runCli
      })).resolves.toEqual(draft);
      expect(runCli).toHaveBeenCalledOnce();
      expect(existsSync(isolatedCwd)).toBe(false);
      expect(info.mock.calls.flat().join('\n')).toContain('process.working');
      expect(info.mock.calls.flat().join('\n')).not.toContain('router-secret');
      expect(info.mock.calls.flat().join('\n')).not.toContain(request.sourceText);
    } finally {
      info.mockRestore();
    }
  });

  it('translates the known malformed HTTP 200 gateway response into an actionable error', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runCli: AgentRouterCliRunner = async () => ({
      exitCode: 1,
      stdout: JSON.stringify({
        is_error: true,
        result: 'API Error: API returned an empty or malformed response (HTTP 200)'
      }),
      stderr: ''
    });
    try {
      await expect(requestAgentRouterCliWriter({
        apiKey: 'router-secret', modelId: 'agentrouter/claude-opus-4-8', request, executable: 'claude-test', runCli
      })).rejects.toThrow('Check that this model is enabled in the AgentRouter console');
    } finally {
      errorLog.mockRestore();
    }
  });

  it('redacts credentials from CLI failures', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runCli: AgentRouterCliRunner = async () => ({
      exitCode: 1,
      stdout: JSON.stringify({ is_error: true, result: 'Rejected router-never-echo' }),
      stderr: ''
    });
    try {
      await requestAgentRouterCliWriter({
        apiKey: 'router-never-echo', modelId: 'agentrouter/glm-5.3', request, executable: 'claude-test', runCli
      });
      throw new Error('Expected AgentRouter Writer to fail.');
    } catch (error) {
      expect(String(error)).toContain('[REDACTED]');
      expect(String(error)).not.toContain('router-never-echo');
    } finally {
      errorLog.mockRestore();
    }
  });

  it('does not replace a successful draft when Windows keeps the temp directory busy', async () => {
    let isolatedCwd = '';
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const runCli: AgentRouterCliRunner = async (input) => {
      isolatedCwd = input.cwd;
      return { exitCode: 0, stdout: JSON.stringify({ structured_output: draft }), stderr: '' };
    };
    const busyCleanup = vi.fn(async () => {
      throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' });
    });
    try {
      await expect(requestAgentRouterCliWriter({
        apiKey: 'router-secret',
        modelId: 'agentrouter/gpt-5.6-sol',
        request,
        executable: 'claude-test',
        runCli,
        removeTempDirectory: busyCleanup
      })).resolves.toEqual(draft);
      expect(warning.mock.calls.flat().join('\n')).toContain('cleanup.skipped');
      expect(warning.mock.calls.flat().join('\n')).toContain('EBUSY');
    } finally {
      warning.mockRestore();
      if (isolatedCwd.length > 0) await rm(isolatedCwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});
