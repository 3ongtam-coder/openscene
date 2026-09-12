# AgentRouter integration

OpenScene treats AgentRouter as a first-class OpenAI-compatible provider for
Writer and Edit Agent. The implementation adapts the connection pattern already
used in the reference project's `server/ai/provider.js`: bearer
authentication, the AgentRouter `apiKey` compatibility header, bounded provider
errors, multipart assistant text, and request timeouts.

The old project's `https://agentrouter.org/v1` default is intentionally not
copied. OpenScene uses the current OpenAI-compatible base URL documented by
AgentRouter: `https://co.agentrouter.org/v1`.

## Security boundary

- Desktop stores `agentRouterApiKey` in Electron `safeStorage`; renderer code
  receives only a connected/not-connected boolean.
- Mobile stores the same slot in Expo SecureStore (Keychain/Keystore).
- Requests put the key in headers, never URLs, and redact it from provider error
  text before showing an error.
- Project documents and settings never contain the key.

## Model aliases

The built-in aliases are the models shown in the user's AgentRouter account:

- `claude-opus-4-8`
- `claude-opus-5`
- `deepseek-v4-flash`
- `glm-5.3`
- `gpt-5.6-sol`

They use canonical OpenScene IDs such as `agentrouter/gpt-5.6-sol`. AgentRouter
availability is key/resource-pool dependent, so selecting a model and running
the Settings model test is the source of truth for that account.

## Writer contract

AgentRouter Writer requests use the same system prompt, JSON Schema, and local
`WriterDraft` validation as Gemini. A provider response cannot alter a project
until it parses as JSON, satisfies the complete project contract, is reviewed,
and the user explicitly saves it.
