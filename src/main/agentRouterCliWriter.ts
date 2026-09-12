import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, extname, join, resolve } from 'node:path';

import {
  AGENT_ROUTER_BASE_URL,
  agentRouterNativeModelId,
  isAgentRouterModelId
} from '../shared/agentRouter';
import {
  WRITER_RESPONSE_JSON_SCHEMA,
  WRITER_SYSTEM_PROMPT,
  compileWriterPrompt,
  parseWriterRequest,
  validateWriterDraft,
  type WriterDraft,
  type WriterGenerationInput
} from '../shared/writerWorkflow';

const AGENT_ROUTER_CLI_TIMEOUT_MS = 180_000;
const AGENT_ROUTER_API_TIMEOUT_MS = 120_000;
const AGENT_ROUTER_HEARTBEAT_MS = 10_000;
const MAX_CLI_OUTPUT_BYTES = 12 * 1024 * 1024;
const TEMP_DIRECTORY_PREFIX = 'openscene-agentrouter-';

export type AgentRouterCliProgressEvent =
  | { readonly type: 'started'; readonly pid?: number }
  | { readonly type: 'initialized' }
  | {
      readonly type: 'retry';
      readonly attempt?: number;
      readonly maxRetries?: number;
      readonly retryDelayMs?: number;
      readonly errorStatus?: number | null;
      readonly error?: string;
    }
  | { readonly type: 'heartbeat'; readonly elapsedMs: number; readonly stdoutBytes: number; readonly stderrBytes: number }
  | { readonly type: 'timeout'; readonly elapsedMs: number }
  | { readonly type: 'output_limit'; readonly outputBytes: number }
  | { readonly type: 'closed'; readonly exitCode: number | null; readonly elapsedMs: number; readonly stdoutBytes: number; readonly stderrBytes: number }
  | { readonly type: 'process_error'; readonly message: string };

type CliRunInput = {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly onProgress?: (event: AgentRouterCliProgressEvent) => void;
};

type CliRunResult = {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

export type AgentRouterCliRunner = (input: CliRunInput) => Promise<CliRunResult>;

export type AgentRouterCliWriterInput = WriterGenerationInput & {
  readonly apiKey: string;
  /** Test/advanced override. The API key still travels only in child env. */
  readonly executable?: string;
  readonly runCli?: AgentRouterCliRunner;
  readonly removeTempDirectory?: (path: string) => Promise<void>;
};

function safeDetail(value: string, secret: string, privateText: readonly string[] = []): string {
  let redacted = value.replaceAll(secret, '[REDACTED]');
  for (const text of privateText) {
    if (text.length > 0) redacted = redacted.replaceAll(text, '[REDACTED_INPUT]');
  }
  return redacted
    .replace(/\u001b\[[0-9;]*m/g, '')
    .trim()
    .slice(0, 500);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Resolve the native Claude Code binary without invoking a command shell. */
export async function resolveClaudeCodeExecutable(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): Promise<string> {
  const configured = env.CLAUDE_CODE_EXECUTABLE?.trim();
  if (configured) {
    if (platform === 'win32' && extname(configured).toLowerCase() !== '.exe') {
      throw new Error('CLAUDE_CODE_EXECUTABLE must point to the native claude.exe, not a shell wrapper.');
    }
    if (await fileExists(configured)) return configured;
    throw new Error('CLAUDE_CODE_EXECUTABLE does not point to an installed Claude Code executable.');
  }
  if (platform !== 'win32') return 'claude';

  const appData = env.APPDATA?.trim();
  const userProfile = env.USERPROFILE?.trim();
  const searchPath = env.Path ?? env.PATH ?? '';
  const candidates = [
    ...(appData ? [join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')] : []),
    ...(userProfile ? [join(userProfile, '.local', 'bin', 'claude.exe')] : []),
    ...searchPath.split(delimiter).filter(Boolean).map((directory) => join(directory, 'claude.exe'))
  ];
  for (const candidate of [...new Set(candidates)]) {
    if (await fileExists(candidate)) return candidate;
  }
  throw new Error(
    'Claude Code was not found. Install it with "npm install -g @anthropic-ai/claude-code", restart OpenScene, and try again.'
  );
}

export const runAgentRouterCli: AgentRouterCliRunner = async (input) =>
  new Promise<CliRunResult>((resolveResult, reject) => {
    const startedAt = Date.now();
    const emit = (event: AgentRouterCliProgressEvent): void => {
      try {
        input.onProgress?.(event);
      } catch {
        // Diagnostics must never change the generation result.
      }
    };
    const child = spawn(input.executable, [...input.args], {
      cwd: input.cwd,
      env: input.env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputBytes = 0;
    let settled = false;
    let stdoutLineBuffer = '';

    emit({ type: 'started', ...(child.pid === undefined ? {} : { pid: child.pid }) });

    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(heartbeat);
      child.kill();
      reject(error);
    };
    const append = (current: string, chunk: Buffer, stream: 'stdout' | 'stderr'): string => {
      outputBytes += chunk.byteLength;
      if (stream === 'stdout') stdoutBytes += chunk.byteLength;
      else stderrBytes += chunk.byteLength;
      if (outputBytes > input.maxOutputBytes) {
        emit({ type: 'output_limit', outputBytes });
        rejectOnce(new Error('Claude Code returned more data than OpenScene can safely accept.'));
      }
      return current + chunk.toString('utf8');
    };

    const inspectProgressLine = (line: string): void => {
      try {
        const value = JSON.parse(line) as Record<string, unknown>;
        if (value.type === 'system' && value.subtype === 'init') {
          emit({ type: 'initialized' });
          return;
        }
        if (value.type === 'system' && value.subtype === 'api_retry') {
          emit({
            type: 'retry',
            ...(typeof value.attempt === 'number' ? { attempt: value.attempt } : {}),
            ...(typeof value.max_retries === 'number' ? { maxRetries: value.max_retries } : {}),
            ...(typeof value.retry_delay_ms === 'number' ? { retryDelayMs: value.retry_delay_ms } : {}),
            ...(typeof value.error_status === 'number' || value.error_status === null ? { errorStatus: value.error_status as number | null } : {}),
            ...(typeof value.error === 'string' ? { error: value.error } : {})
          });
        }
      } catch {
        // A partial/non-JSON line is retained for the final parser but is never
        // printed, because it may contain model output.
      }
    };

    const timer = setTimeout(() => {
      emit({ type: 'timeout', elapsedMs: Date.now() - startedAt });
      rejectOnce(new Error(`AgentRouter Writer did not finish within ${Math.round(input.timeoutMs / 1000)}s.`));
    }, input.timeoutMs);

    const heartbeat = setInterval(() => {
      emit({ type: 'heartbeat', elapsedMs: Date.now() - startedAt, stdoutBytes, stderrBytes });
    }, AGENT_ROUTER_HEARTBEAT_MS);
    heartbeat.unref();

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk, 'stdout');
      stdoutLineBuffer += chunk.toString('utf8');
      const lines = stdoutLineBuffer.split(/\r?\n/);
      stdoutLineBuffer = lines.pop() ?? '';
      for (const line of lines) inspectProgressLine(line);
    });
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk, 'stderr'); });
    child.once('error', (error) => {
      emit({ type: 'process_error', message: error.message });
      rejectOnce(error);
    });
    child.once('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(heartbeat);
      if (stdoutLineBuffer.trim().length > 0) inspectProgressLine(stdoutLineBuffer);
      emit({ type: 'closed', exitCode, elapsedMs: Date.now() - startedAt, stdoutBytes, stderrBytes });
      resolveResult({ exitCode, stdout, stderr });
    });
    child.stdin.once('error', (error) => rejectOnce(error));
    child.stdin.end(input.stdin, 'utf8');
  });

function claudeEnvironment(apiKey: string): NodeJS.ProcessEnv {
  // Do not leak unrelated provider tokens or application secrets into the
  // child. These are the OS/network variables the native CLI may need.
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'APPDATA', 'LOCALAPPDATA',
    'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL', 'TERM', 'NO_COLOR',
    'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS'
  ]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return {
    ...env,
    ANTHROPIC_BASE_URL: AGENT_ROUTER_BASE_URL,
    ANTHROPIC_AUTH_TOKEN: apiKey,
    ANTHROPIC_API_KEY: apiKey,
    API_TIMEOUT_MS: String(AGENT_ROUTER_API_TIMEOUT_MS),
    CLAUDE_CODE_MAX_RETRIES: '1',
    MAX_STRUCTURED_OUTPUT_RETRIES: '2',
    CLAUDE_ENABLE_STREAM_WATCHDOG: '1',
    CLAUDE_STREAM_IDLE_TIMEOUT_MS: '90000',
    CLAUDE_CODE_EXIT_AFTER_STOP_DELAY: '1000',
    MCP_CONNECTION_NONBLOCKING: 'true',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_SKIP_PROMPT_HISTORY: '1',
    DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1'
  };
}

function claudeArguments(modelId: string): readonly string[] {
  return [
    '-p',
    'Create the OpenScene Writer draft from the production brief supplied on stdin. Return only the requested structured output.',
    '--output-format', 'stream-json',
    '--verbose',
    '--json-schema', JSON.stringify(WRITER_RESPONSE_JSON_SCHEMA),
    '--model', modelId,
    '--tools', '',
    '--permission-mode', 'dontAsk',
    '--max-turns', '3',
    '--no-session-persistence',
    '--no-chrome',
    '--bare'
  ];
}

function parseCliEnvelope(stdout: string): {
  readonly structured_output?: unknown;
  readonly result?: unknown;
  readonly is_error?: unknown;
} | null {
  const parseObject = (value: string): {
    readonly structured_output?: unknown;
    readonly result?: unknown;
    readonly is_error?: unknown;
  } | null => {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === 'object' && parsed !== null ? parsed : null;
    } catch {
      return null;
    }
  };

  const complete = parseObject(stdout.trim());
  if (complete !== null) return complete;
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const value = parseObject(lines[index] ?? '');
    if (value !== null && (
      value.structured_output !== undefined || value.result !== undefined || value.is_error !== undefined
    )) return value;
  }
  return null;
}

function isSafeTempDirectory(path: string): boolean {
  const resolved = resolve(path);
  return dirname(resolved) === resolve(tmpdir()) && basename(resolved).startsWith(TEMP_DIRECTORY_PREFIX);
}

type DiagnosticFields = Readonly<Record<string, string | number | boolean | null | undefined>>;

function terminalLog(
  runId: string,
  level: 'info' | 'warn' | 'error',
  event: string,
  fields: DiagnosticFields = {}
): void {
  const present = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
  const suffix = Object.keys(present).length === 0 ? '' : ` ${JSON.stringify(present)}`;
  console[level](`[OpenScene][AgentRouter Writer][${runId}] ${event}${suffix}`);
}

function logCliProgress(
  runId: string,
  event: AgentRouterCliProgressEvent,
  apiKey: string,
  privateText: readonly string[]
): void {
  switch (event.type) {
    case 'started':
      terminalLog(runId, 'info', 'process.started', { pid: event.pid });
      break;
    case 'initialized':
      terminalLog(runId, 'info', 'client.initialized');
      break;
    case 'retry':
      terminalLog(runId, 'warn', 'api.retry', {
        attempt: event.attempt,
        maxRetries: event.maxRetries,
        delayMs: event.retryDelayMs,
        status: event.errorStatus,
        error: event.error === undefined ? undefined : safeDetail(event.error, apiKey, privateText)
      });
      break;
    case 'heartbeat':
      terminalLog(runId, 'info', 'process.working', {
        elapsedSeconds: Math.round(event.elapsedMs / 1000),
        stdoutBytes: event.stdoutBytes,
        stderrBytes: event.stderrBytes
      });
      break;
    case 'timeout':
      terminalLog(runId, 'error', 'process.timeout', { elapsedSeconds: Math.round(event.elapsedMs / 1000) });
      break;
    case 'output_limit':
      terminalLog(runId, 'error', 'process.output_limit', { outputBytes: event.outputBytes });
      break;
    case 'closed':
      terminalLog(runId, event.exitCode === 0 ? 'info' : 'warn', 'process.closed', {
        exitCode: event.exitCode,
        elapsedSeconds: Math.round(event.elapsedMs / 1000),
        stdoutBytes: event.stdoutBytes,
        stderrBytes: event.stderrBytes
      });
      break;
    case 'process_error':
      terminalLog(runId, 'error', 'process.error', { message: event.message });
      break;
  }
}

async function cleanupTempDirectory(
  path: string,
  runId: string,
  removeDirectory: (path: string) => Promise<void> = (target) =>
    rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 })
): Promise<void> {
  if (!isSafeTempDirectory(path)) {
    terminalLog(runId, 'error', 'cleanup.refused', { directory: basename(path) });
    return;
  }
  try {
    // Windows may keep the child cwd locked briefly after process close.
    await removeDirectory(path);
    terminalLog(runId, 'info', 'cleanup.complete');
  } catch (error) {
    // Cleanup is secondary: never replace a valid draft or the real provider
    // error with EBUSY/EPERM from an OS temp directory.
    terminalLog(runId, 'warn', 'cleanup.skipped', {
      code: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN',
      directory: basename(path)
    });
  }
}

/**
 * Run AgentRouter through the officially supported Claude Code client. The
 * prompt is piped over stdin and the credential exists only in the child
 * environment; neither appears in process arguments.
 */
export async function requestAgentRouterCliWriter(input: AgentRouterCliWriterInput): Promise<WriterDraft> {
  const request = parseWriterRequest(input.request);
  if (request === null) throw new Error('Writer request is invalid.');
  if (!isAgentRouterModelId(input.modelId)) throw new Error('AgentRouter Writer model is not allowed.');
  const apiKey = input.apiKey.trim();
  if (apiKey.length === 0) throw new Error('AgentRouter API key is required.');

  const runId = randomUUID().slice(0, 8);
  const startedAt = Date.now();
  const privateText = [request.sourceText, request.currentScreenplay ?? ''];
  let cwd: string | undefined;
  terminalLog(runId, 'info', 'request.start', {
    model: agentRouterNativeModelId(input.modelId),
    mode: request.mode,
    targetSeconds: request.targetDurationSeconds,
    sourceCharacters: request.sourceText.length,
    screenplayCharacters: request.currentScreenplay?.length ?? 0,
    timeoutSeconds: Math.round(AGENT_ROUTER_CLI_TIMEOUT_MS / 1000)
  });
  try {
    const executable = input.executable ?? await resolveClaudeCodeExecutable();
    terminalLog(runId, 'info', 'client.resolved', { executable });
    cwd = await mkdtemp(join(tmpdir(), TEMP_DIRECTORY_PREFIX));
    terminalLog(runId, 'info', 'workspace.created', { directory: basename(cwd) });
    const result = await (input.runCli ?? runAgentRouterCli)({
      executable,
      args: claudeArguments(agentRouterNativeModelId(input.modelId)),
      cwd,
      env: claudeEnvironment(apiKey),
      stdin: [WRITER_SYSTEM_PROMPT, compileWriterPrompt(request)].join('\n\n'),
      timeoutMs: AGENT_ROUTER_CLI_TIMEOUT_MS,
      maxOutputBytes: MAX_CLI_OUTPUT_BYTES,
      onProgress: (event) => logCliProgress(runId, event, apiKey, privateText)
    });
    terminalLog(runId, 'info', 'response.parsing');
    const envelope = parseCliEnvelope(result.stdout);
    const rawResult = typeof envelope?.result === 'string' ? envelope.result : '';
    if (/empty or malformed response\s*\(HTTP 200\)/i.test(rawResult)) {
      throw new Error(
        'AgentRouter accepted Claude Code but returned an empty or malformed HTTP 200 response. Check that this model is enabled in the AgentRouter console, then retry.'
      );
    }
    if (result.exitCode !== 0 || envelope === null || envelope.is_error === true) {
      const detail = safeDetail(rawResult || result.stderr || result.stdout, apiKey);
      throw new Error(`AgentRouter Writer failed${detail.length > 0 ? `: ${detail}` : '.'}`);
    }
    if (envelope.structured_output === undefined) {
      throw new Error('AgentRouter Writer returned no structured output.');
    }
    const validation = validateWriterDraft(envelope.structured_output);
    if (!validation.ok) {
      throw new Error(`AgentRouter Writer returned an invalid project draft at ${validation.issue.path}: ${validation.issue.message}`);
    }
    terminalLog(runId, 'info', 'request.complete', {
      elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
      scenes: validation.value.scenes.length,
      shots: validation.value.scenes.reduce((total, scene) => total + scene.shots.length, 0)
    });
    return validation.value;
  } catch (error) {
    const detail = safeDetail(error instanceof Error ? error.message : String(error), apiKey, privateText);
    terminalLog(runId, 'error', 'request.failed', {
      elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
      error: detail || 'AgentRouter Writer failed.'
    });
    throw new Error(detail || 'AgentRouter Writer failed.');
  } finally {
    if (cwd !== undefined) await cleanupTempDirectory(cwd, runId, input.removeTempDirectory);
  }
}
