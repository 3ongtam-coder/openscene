import { spawn } from 'node:child_process';
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
const MAX_CLI_OUTPUT_BYTES = 12 * 1024 * 1024;
const TEMP_DIRECTORY_PREFIX = 'openscene-agentrouter-';

type CliRunInput = {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdin: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
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
};

function safeDetail(value: string, secret: string): string {
  return value
    .replaceAll(secret, '[REDACTED]')
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
    const child = spawn(input.executable, [...input.args], {
      cwd: input.cwd,
      env: input.env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;

    const rejectOnce = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      reject(error);
    };
    const append = (current: string, chunk: Buffer): string => {
      outputBytes += chunk.byteLength;
      if (outputBytes > input.maxOutputBytes) {
        rejectOnce(new Error('Claude Code returned more data than OpenScene can safely accept.'));
      }
      return current + chunk.toString('utf8');
    };

    const timer = setTimeout(() => {
      rejectOnce(new Error(`AgentRouter Writer did not finish within ${Math.round(input.timeoutMs / 1000)}s.`));
    }, input.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.once('error', (error) => rejectOnce(error));
    child.once('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
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
    '--output-format', 'json',
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
  try {
    const value: unknown = JSON.parse(stdout.trim());
    return typeof value === 'object' && value !== null ? value : null;
  } catch {
    return null;
  }
}

function isSafeTempDirectory(path: string): boolean {
  const resolved = resolve(path);
  return dirname(resolved) === resolve(tmpdir()) && basename(resolved).startsWith(TEMP_DIRECTORY_PREFIX);
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

  const executable = input.executable ?? await resolveClaudeCodeExecutable();
  const cwd = await mkdtemp(join(tmpdir(), TEMP_DIRECTORY_PREFIX));
  try {
    const result = await (input.runCli ?? runAgentRouterCli)({
      executable,
      args: claudeArguments(agentRouterNativeModelId(input.modelId)),
      cwd,
      env: claudeEnvironment(apiKey),
      stdin: [WRITER_SYSTEM_PROMPT, compileWriterPrompt(request)].join('\n\n'),
      timeoutMs: AGENT_ROUTER_CLI_TIMEOUT_MS,
      maxOutputBytes: MAX_CLI_OUTPUT_BYTES
    });
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
    return validation.value;
  } catch (error) {
    const detail = safeDetail(error instanceof Error ? error.message : String(error), apiKey);
    throw new Error(detail || 'AgentRouter Writer failed.');
  } finally {
    if (isSafeTempDirectory(cwd)) await rm(cwd, { recursive: true, force: true });
  }
}
