import type { Rectangle, WebContents } from 'electron';

const INPUT_SELECTORS = [
  'rich-textarea div[contenteditable="true"]',
  'div[contenteditable="true"][role="textbox"]',
  '.ql-editor[contenteditable="true"]',
  'textarea'
] as const;

const DOWNLOAD_SELECTORS = [
  '[data-test-id="download-generated-image-button"]',
  'button[aria-label*="Download"]',
  'button[aria-label*="download"]',
  'button[aria-label*="Tải xuống"]'
] as const;

const POLL_INTERVAL_MS = 1_000;

type AutomationState = {
  readonly url: string;
  readonly input?: Rectangle;
  readonly downloadButtons: readonly Rectangle[];
  readonly actionRequired?: 'sign_in' | 'verification' | 'rate_limit';
};

export type GeminiBrowserAutomationProgress =
  | 'loading'
  | 'ready'
  | 'submitted'
  | 'generating'
  | 'downloading';

export type GeminiBrowserAutomationInput = {
  readonly prompt: string;
  readonly timeoutMs: number;
  readonly onProgress?: (stage: GeminiBrowserAutomationProgress, elapsedMs: number) => void;
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function clickAt(webContents: WebContents, rectangle: Rectangle): void {
  const x = Math.round(rectangle.x + rectangle.width / 2);
  const y = Math.round(rectangle.y + rectangle.height / 2);
  webContents.sendInputEvent({ type: 'mouseMove', x, y });
  webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
}

/**
 * Only returns coarse UI state. Page text, account data and cookies never leave
 * the isolated webContents.
 */
async function readState(webContents: WebContents): Promise<AutomationState> {
  return webContents.executeJavaScript(`(() => {
    const visibleRect = (element) => {
      if (!(element instanceof HTMLElement)) return null;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.visibility === 'hidden' || style.display === 'none' || rect.width < 2 || rect.height < 2) return null;
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const inputSelectors = ${JSON.stringify(INPUT_SELECTORS)};
    let input;
    for (const selector of inputSelectors) {
      const candidate = [...document.querySelectorAll(selector)].map(visibleRect).find(Boolean);
      if (candidate) { input = candidate; break; }
    }
    const downloadSelectors = ${JSON.stringify(DOWNLOAD_SELECTORS)};
    const buttons = [];
    const seen = new Set();
    for (const selector of downloadSelectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (seen.has(element)) continue;
        seen.add(element);
        const rect = visibleRect(element);
        if (rect) buttons.push(rect);
      }
    }
    const url = location.href;
    const text = (document.body?.innerText || '').toLowerCase();
    let actionRequired;
    if (location.hostname === 'accounts.google.com' || /sign in|đăng nhập/.test(text) && !input) {
      actionRequired = 'sign_in';
    } else if (/captcha|verify it'?s you|verify your identity|unusual traffic|xác minh/.test(text)) {
      actionRequired = 'verification';
    } else if (/you(?:'|’)ve reached (?:your|the) limit|too many requests|rate limit|đã đạt giới hạn/.test(text)) {
      actionRequired = 'rate_limit';
    }
    return { url, ...(input ? { input } : {}), downloadButtons: buttons, ...(actionRequired ? { actionRequired } : {}) };
  })()`, true) as Promise<AutomationState>;
}

function actionRequiredError(kind: NonNullable<AutomationState['actionRequired']>): Error {
  if (kind === 'sign_in') {
    return new Error('The Gemini browser session has expired. Open Settings, sign in to Gemini again, then retry.');
  }
  if (kind === 'verification') {
    return new Error('Gemini requires a CAPTCHA or account verification. Open the Gemini session in Settings and complete it manually, then retry.');
  }
  return new Error('Gemini web usage limit was reached. Wait for the account limit to reset before retrying.');
}

async function waitForInput(webContents: WebContents, deadline: number): Promise<AutomationState> {
  while (Date.now() < deadline) {
    const state = await readState(webContents);
    if (state.actionRequired !== undefined) throw actionRequiredError(state.actionRequired);
    if (state.input !== undefined) return state;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error('Gemini loaded, but OpenScene could not find its prompt input before the timeout. The Gemini UI may have changed.');
}

/**
 * Drive the public Gemini UI inside a real Electron Chromium renderer. This is
 * intentionally DOM automation rather than a reverse-engineered HTTP call:
 * authentication remains inside the browser partition and normal provider
 * challenges remain in force.
 */
export async function automateGeminiImageGeneration(
  webContents: WebContents,
  input: GeminiBrowserAutomationInput
): Promise<void> {
  const startedAt = Date.now();
  const deadline = startedAt + input.timeoutMs;
  input.onProgress?.('loading', 0);

  const ready = await waitForInput(webContents, deadline);
  input.onProgress?.('ready', Date.now() - startedAt);
  const initialDownloadCount = ready.downloadButtons.length;
  clickAt(webContents, ready.input!);
  await delay(150);
  await webContents.insertText(input.prompt);
  await delay(150);
  webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ENTER' });
  webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ENTER' });
  input.onProgress?.('submitted', Date.now() - startedAt);

  let lastHeartbeat = 0;
  while (Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS);
    const state = await readState(webContents);
    if (state.actionRequired !== undefined) throw actionRequiredError(state.actionRequired);
    const elapsed = Date.now() - startedAt;
    if (elapsed - lastHeartbeat >= 10_000) {
      lastHeartbeat = elapsed;
      input.onProgress?.('generating', elapsed);
    }
    if (state.downloadButtons.length > initialDownloadCount) {
      input.onProgress?.('downloading', elapsed);
      clickAt(webContents, state.downloadButtons[state.downloadButtons.length - 1]!);
      return;
    }
  }
  throw new Error('Gemini did not produce a downloadable image before the timeout. Check the prompt and the account usage limit, then retry.');
}

export function detectDownloadedImageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
