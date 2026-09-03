import {
  GEMINI_WRITER_MODEL_IDS,
  WRITER_RESPONSE_JSON_SCHEMA,
  WRITER_SYSTEM_PROMPT,
  compileWriterPrompt,
  parseWriterRequest,
  validateWriterDraft,
  type WriterDraft,
  type WriterModelId,
  type WriterRequest
} from './writerWorkflow';
import {
  AGENT_ROUTER_BASE_URL,
  agentRouterHeaders,
  agentRouterMessageText,
  agentRouterNativeModelId,
  isAgentRouterModelId
} from './agentRouter';

type FetchLike = typeof fetch;
const WRITER_REQUEST_TIMEOUT_MS = 120_000;

export type GeminiWriterInput = {
  readonly apiKey: string;
  readonly modelId: Extract<WriterModelId, `gemini-${string}`>;
  readonly request: WriterRequest;
  readonly fetchImpl?: FetchLike;
};

export type WriterProviderInput = {
  readonly apiKey: string;
  readonly modelId: WriterModelId;
  readonly request: WriterRequest;
  readonly fetchImpl?: FetchLike;
};

async function providerError(response: Response, secret: string): Promise<string> {
  const text = await response.text().catch(() => '');
  let detail: string;
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    detail = parsed.error?.message ?? text;
  } catch {
    detail = text;
  }
  return detail.replaceAll(secret, '[REDACTED]').slice(0, 300);
}

export async function requestGeminiWriter(input: GeminiWriterInput): Promise<WriterDraft> {
  const request = parseWriterRequest(input.request);
  if (request === null) throw new Error('Writer request is invalid.');
  if (!(GEMINI_WRITER_MODEL_IDS as readonly string[]).includes(input.modelId)) throw new Error('Gemini Writer model is not allowed.');
  if (input.apiKey.trim().length === 0) throw new Error('Gemini API key is required.');
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.modelId)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': input.apiKey.trim() },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: WRITER_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: compileWriterPrompt(request) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: WRITER_RESPONSE_JSON_SCHEMA
        }
      })
    }
  );
  if (!response.ok) {
    const detail = await providerError(response, input.apiKey.trim());
    throw new Error(`Gemini Writer failed with status ${response.status}${detail.length > 0 ? `: ${detail}` : ''}.`);
  }
  const payload = await response.json() as {
    candidates?: readonly { content?: { parts?: readonly { text?: string }[] } }[];
  };
  const json = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim();
  if (!json) throw new Error('Gemini Writer returned an empty response.');
  let decoded: unknown;
  try {
    decoded = JSON.parse(json);
  } catch {
    throw new Error('Gemini Writer returned invalid JSON.');
  }
  const validation = validateWriterDraft(decoded);
  if (!validation.ok) {
    throw new Error(`Gemini Writer returned an invalid project draft at ${validation.issue.path}: ${validation.issue.message}`);
  }
  return validation.value;
}

function decodeWriterJson(raw: string, providerLabel: string): unknown {
  const trimmed = raw.trim();
  const candidates = [
    trimmed,
    trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''),
    trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1)
  ];
  for (const candidate of candidates) {
    if (candidate.length === 0) continue;
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Try the next safe extraction form. The parsed value is still checked
      // against the complete Writer contract below.
    }
  }
  throw new Error(`${providerLabel} Writer returned invalid JSON.`);
}

export async function requestAgentRouterWriter(input: WriterProviderInput): Promise<WriterDraft> {
  const request = parseWriterRequest(input.request);
  if (request === null) throw new Error('Writer request is invalid.');
  if (!isAgentRouterModelId(input.modelId)) throw new Error('AgentRouter Writer model is not allowed.');
  const apiKey = input.apiKey.trim();
  if (apiKey.length === 0) throw new Error('AgentRouter API key is required.');

  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WRITER_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${AGENT_ROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: agentRouterHeaders(apiKey),
      signal: controller.signal,
      body: JSON.stringify({
        model: agentRouterNativeModelId(input.modelId),
        messages: [
          { role: 'system', content: WRITER_SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              compileWriterPrompt(request),
              'Return one JSON object that validates against this exact JSON Schema:',
              JSON.stringify(WRITER_RESPONSE_JSON_SCHEMA)
            ].join('\n\n')
          }
        ],
        temperature: 0.4
      })
    });
    if (!response.ok) {
      const detail = await providerError(response, apiKey);
      throw new Error(`AgentRouter Writer failed with status ${response.status}${detail.length > 0 ? `: ${detail}` : ''}.`);
    }
    const payload = await response.json() as {
      choices?: readonly { message?: { content?: unknown } }[];
    };
    const content = agentRouterMessageText(payload.choices?.[0]?.message?.content).trim();
    if (content.length === 0) throw new Error('AgentRouter Writer returned an empty response.');
    const validation = validateWriterDraft(decodeWriterJson(content, 'AgentRouter'));
    if (!validation.ok) {
      throw new Error(`AgentRouter Writer returned an invalid project draft at ${validation.issue.path}: ${validation.issue.message}`);
    }
    return validation.value;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`AgentRouter Writer did not respond within ${WRITER_REQUEST_TIMEOUT_MS / 1000}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function requestWriter(input: WriterProviderInput): Promise<WriterDraft> {
  if (isAgentRouterModelId(input.modelId)) return requestAgentRouterWriter(input);
  if ((GEMINI_WRITER_MODEL_IDS as readonly string[]).includes(input.modelId)) {
    return requestGeminiWriter(input as GeminiWriterInput);
  }
  return Promise.reject(new Error('Writer model is not allowed.'));
}
