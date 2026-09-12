# AgentRouter integration

OpenScene connects to the legacy service at `https://agentrouter.org`, following
AgentRouter's Claude Code setup rather than treating the service as an ordinary
OpenAI-compatible endpoint. Although the backend is based on NewAPI, AgentRouter
applies a supported-client gate before the model API: generic Node, OpenAI SDK,
and LangChain requests can receive `401 unauthorized client detected` even when
the token is valid.

Primary references:

- [AgentRouter Claude Code setup](https://agentrouter.org/docs/claude-code.html)
- [AgentRouter docs source](https://github.com/agentrouter-org/docs/blob/main/vi/start.md)
- [NewAPI chat completion contract](https://docs.newapi.ai/en/docs/api/ai-model/chat/openai/createchatcompletion)
- [AgentRouter unsupported-client report](https://github.com/agentrouter-org/docs/issues/21)

## Supported surfaces

- **Desktop Writer:** supported through an installed Claude Code executable in
  non-interactive mode. All five account aliases are passed to AgentRouter as
  model IDs; actual pool availability remains account-dependent.
- **Mobile Writer:** visible but disabled. React Native cannot launch the
  desktop Claude Code client, and direct fetch would be rejected by the client
  gate.
- **Edit Agent:** visible but disabled for AgentRouter. Passing an external CLI
  around OpenScene's LangGraph tool-approval boundary would be unsafe, while the
  existing LangChain transport is rejected by AgentRouter. Other providers and
  local Ollama remain available.

## Security boundary

- Desktop stores `agentRouterApiKey` in Electron `safeStorage`; renderer code
  receives only a connected/not-connected boolean.
- The key is read only in the main process and passed to Claude Code through
  `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_API_KEY` in the child environment. It is
  never placed in process arguments, prompt text, URLs, project files, or logs.
- Writer source is piped over stdin, not placed on the command line.
- Claude Code runs in a fresh temporary directory with `--bare`, no tools, no
  browser, no session persistence, bounded output, and a hard timeout. The
  directory is removed after each run.
- Mobile keeps the credential slot for compatibility but never sends an
  AgentRouter request.

## Model aliases

The built-in aliases mirror the user's AgentRouter account:

- `claude-opus-4-8`
- `claude-opus-5`
- `deepseek-v4-flash`
- `glm-5.3`
- `gpt-5.6-sol`

They use canonical OpenScene IDs such as `agentrouter/gpt-5.6-sol`. The desktop
bridge supplies the native alias to Claude Code with
`ANTHROPIC_BASE_URL=https://agentrouter.org`.

## Writer contract

The CLI receives the same system prompt and production brief as Gemini plus the
same JSON Schema through Claude Code's `--json-schema` option. OpenScene still
validates the returned `structured_output` locally. A response cannot alter a
project until it satisfies the complete `WriterDraft` contract, the user reviews
it, and the user explicitly saves it.

Claude Code is an external runtime dependency for AgentRouter Writer. If it is
missing, OpenScene reports the installation command instead of attempting a
direct API fallback that would fail with 401.
