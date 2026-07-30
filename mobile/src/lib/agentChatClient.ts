import { getLlmProvider, type LlmProviderInfo } from '@openvideo/shared/llmProviders';
import { readSlot } from './credentials';

/**
 * A tool-calling chat turn, spoken directly from the device.
 *
 * The desktop runs its agent in the main process because that is where the
 * filesystem and FFmpeg live. Neither exists here, and a phone has no privileged
 * process to route through — so the request goes straight to the provider. The
 * part that matters is unchanged: the model may *propose* a tool call, and this
 * module never runs one. It returns the proposal and the screen decides, which
 * is what makes per-feature permission possible at all.
 *
 * Anthropic and Gemini speak their own wire formats; only the OpenAI-compatible
 * shape is implemented, which is what the large majority of the catalog's
 * providers use. Anything else is reported as unsupported rather than attempted
 * and silently mangled.
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export type ChatMessage = {
  readonly role: ChatRole;
  readonly content: string;
  /** Set on assistant turns that proposed calls, and on the tool replies. */
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly proposals?: readonly ToolCallProposal[];
};

export type ToolCallProposal = {
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
};

export type ToolSchema = {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
};

export type ChatTurn =
  | { readonly ok: true; readonly text: string; readonly proposals: readonly ToolCallProposal[] }
  | { readonly ok: false; readonly message: string };

function endpointFor(provider: LlmProviderInfo): string | null {
  if (provider.adapter === 'ollama') {
    return `${provider.baseUrl ?? 'http://localhost:11434'}/v1/chat/completions`;
  }
  if (provider.adapter !== 'openai-compatible' || provider.baseUrl === undefined) return null;
  return `${provider.baseUrl.replace(/\/$/, '')}/chat/completions`;
}

/** Our message shape mapped onto the OpenAI wire shape. */
function toWire(message: ChatMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId ?? '', content: message.content };
  }
  if (message.role === 'assistant' && message.proposals !== undefined && message.proposals.length > 0) {
    return {
      role: 'assistant',
      content: message.content.length > 0 ? message.content : null,
      tool_calls: message.proposals.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.args) }
      }))
    };
  }
  return { role: message.role, content: message.content };
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    // A model that emits malformed arguments should surface as an empty call the
    // user can reject, not as a crash mid-conversation.
    return {};
  }
}

export async function sendChatTurn(input: {
  readonly providerId: string;
  readonly modelId: string;
  readonly messages: readonly ChatMessage[];
  readonly tools: readonly ToolSchema[];
}): Promise<ChatTurn> {
  const provider = getLlmProvider(input.providerId);
  if (provider === undefined) return { ok: false, message: `Unknown provider ${input.providerId}.` };

  const endpoint = endpointFor(provider);
  if (endpoint === null) {
    return {
      ok: false,
      message: `${provider.label} speaks the ${provider.adapter} API, which the mobile client does not implement yet. Pick an OpenAI-compatible provider.`
    };
  }

  const apiKey = provider.credentialKey === undefined ? null : await readSlot(provider.credentialKey);
  if (provider.auth === 'api-key' && apiKey === null) {
    return { ok: false, message: `${provider.label} has no key stored — add one in Settings.` };
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey === null ? {} : { authorization: `Bearer ${apiKey}` })
      },
      body: JSON.stringify({
        model: input.modelId,
        messages: input.messages.map(toWire),
        ...(input.tools.length === 0
          ? {}
          : {
              tools: input.tools.map((tool) => ({
                type: 'function',
                function: { name: tool.name, description: tool.description, parameters: tool.parameters }
              }))
            })
      })
    });

    if (!response.ok) {
      const body = await response.text();
      // The provider's own message is more useful than a generic failure, but it
      // can be an entire HTML error page, so it is clipped.
      return { ok: false, message: `${provider.label} returned ${response.status}: ${body.slice(0, 300)}` };
    }

    const payload: unknown = await response.json();
    const message = (payload as { choices?: { message?: Record<string, unknown> }[] }).choices?.[0]?.message;
    if (message === undefined) return { ok: false, message: 'The provider returned no message.' };

    const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    return {
      ok: true,
      text: typeof message.content === 'string' ? message.content : '',
      proposals: rawCalls.map((call: Record<string, unknown>, index: number) => {
        const fn = (call.function ?? {}) as Record<string, unknown>;
        return {
          id: typeof call.id === 'string' ? call.id : `call-${index}`,
          name: typeof fn.name === 'string' ? fn.name : 'unknown',
          args: parseArgs(fn.arguments)
        };
      })
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'The request failed.' };
  }
}
