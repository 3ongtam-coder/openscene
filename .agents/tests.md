# Test Notes

Core checks:

```bash
npm run typecheck
npm test
npm run build
```

Vitest uses `tests/**/*.test.ts` with a Node environment. Use targeted tests for stores, validators, timeline logic, FFmpeg export boundaries, and local TTS config logic when touching those areas.

Manual QA is still required for OS permission flows, selected-window capture, real FFmpeg export, and real local Qwen wrapper execution. Automated tests cannot grant macOS Screen Recording permission or prove voice sample quality.
