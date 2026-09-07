# Gemini browser-session images (#334)

Google's Gemini API quota and the consumer Gemini Apps allowance are separate. A user can therefore have a working signed-in image experience while an API key reports a zero free-tier quota. OpenScene now keeps both routes explicit instead of treating browser cookies as an API key.

## Desktop flow

1. The user signs in once under Settings. Cookies remain in the existing encrypted vault and are restored only into an isolated in-memory Electron partition.
2. Image Generation defaults Google models to **Signed-in session**; **API key** remains selectable.
3. Generate starts a hidden real Chromium renderer, loads `gemini.google.com/app`, maps the selected catalog model onto the matching Flash, Flash-Lite, or Pro tier in Gemini Apps, fills the normalized image prompt, submits it, waits for a new generated-image download control, and clicks it. If that account does not expose the requested tier, the job fails instead of silently using a different model.
4. Main intercepts that user-account download inside the isolated session, limits it to 50 MB, and verifies PNG, JPEG, or WebP magic bytes before handing it to the existing image job.
5. The ordinary result preview, save, and Use for video actions continue unchanged.

The worker never sends cookie values over IPC, does not copy another browser profile, does not call a reverse-engineered endpoint, and does not attempt to solve CAPTCHA, account verification, or provider rate limits. Those states fail with an actionable message. Page load, generation, and download each have finite deadlines, with progress written to the terminal under `[OpenScene][Gemini Browser Image]`.

This lane is intentionally marked experimental because a provider UI change can invalidate selectors. It is desktop-only; mobile continues to use the official API adapter and says so on its Image screen.

## Reference implementations reviewed

- `schobiDotDev/geminikit` (MIT) demonstrates the current contenteditable, Enter submission, and `download-generated-image-button` flow.
- `Rabornkraken/browser2api` demonstrates real-browser UI automation with result detection and bounded downloads.
- `lesterppo/hermes-gem-pw` demonstrates layered selectors and explicit challenge handling.

OpenScene reuses its own Electron renderer and encrypted session boundary rather than adding Playwright or extracting Chrome cookies.
