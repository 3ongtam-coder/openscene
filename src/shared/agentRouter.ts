export const AGENT_ROUTER_PROVIDER_ID = 'agentrouter';
export const AGENT_ROUTER_CREDENTIAL_KEY = 'agentRouterApiKey';
export const AGENT_ROUTER_BASE_URL = 'https://co.agentrouter.org/v1';

/**
 * Account model aliases supplied by the user. AgentRouter pools can expose a
 * different set per key, so these are candidates to test rather than a claim
 * that every AgentRouter account has every model.
 */
export const AGENT_ROUTER_MODELS = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', reasoning: true },
  { id: 'claude-opus-5', label: 'Claude Opus 5', reasoning: true },
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', reasoning: true },
  { id: 'glm-5.3', label: 'GLM 5.3', reasoning: true },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', reasoning: true }
] as const;

export type AgentRouterNativeModelId = (typeof AGENT_ROUTER_MODELS)[number]['id'];
export type AgentRouterModelId = `agentrouter/${AgentRouterNativeModelId}`;

export const AGENT_ROUTER_MODEL_IDS: readonly AgentRouterModelId[] = AGENT_ROUTER_MODELS.map(
  (model) => `${AGENT_ROUTER_PROVIDER_ID}/${model.id}` as AgentRouterModelId
);

export function isAgentRouterModelId(modelId: string): modelId is AgentRouterModelId {
  return (AGENT_ROUTER_MODEL_IDS as readonly string[]).includes(modelId);
}

export function agentRouterNativeModelId(modelId: AgentRouterModelId): AgentRouterNativeModelId {
  return modelId.slice(`${AGENT_ROUTER_PROVIDER_ID}/`.length) as AgentRouterNativeModelId;
}

/** AgentRouter accepts the bearer form and its legacy apiKey compatibility header. */
export function agentRouterHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    apiKey,
    'User-Agent': 'OpenScene'
  };
}

/** OpenAI-compatible responses may encode text as a string or multipart array. */
export function agentRouterMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (typeof part !== 'object' || part === null) return '';
      const value = part as { text?: unknown; content?: unknown };
      if (typeof value.text === 'string') return value.text;
      return typeof value.content === 'string' ? value.content : '';
    })
    .join('');
}
