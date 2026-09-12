import type { KeyboardInputEvent, Rectangle, WebContents } from 'electron';
import type { GoogleFlowImageModel } from '../shared/browserSession';

const POLL_INTERVAL_MS = 1_000;

type RectangleWithText = {
  readonly rectangle: Rectangle;
  readonly text: string;
  readonly selected?: boolean;
};

type FlowImage = {
  readonly rectangle: Rectangle;
  readonly src: string;
};

type AutomationState = {
  readonly url: string;
  readonly input?: Rectangle;
  readonly existingProject?: Rectangle;
  readonly newProject?: Rectangle;
  readonly dismiss?: Rectangle;
  readonly configButton?: RectangleWithText;
  readonly modelDropdown?: RectangleWithText;
  readonly tabs: readonly RectangleWithText[];
  readonly menuItems: readonly RectangleWithText[];
  readonly submit?: Rectangle;
  readonly images: readonly FlowImage[];
  readonly actionRequired?: 'sign_in' | 'verification' | 'rate_limit' | 'unavailable';
};

export type GoogleFlowAutomationProgress =
  | 'loading'
  | 'project'
  | 'ready'
  | 'configuring'
  | 'submitted'
  | 'generating'
  | 'downloading';

export type GoogleFlowAutomationInput = {
  readonly prompt: string;
  readonly model: GoogleFlowImageModel;
  readonly aspectRatio: string;
  readonly timeoutMs: number;
  readonly onProgress?: (stage: GoogleFlowAutomationProgress, elapsedMs: number) => void;
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
 * Return only geometry, labels, and generated-media URLs needed to operate
 * Flow. Account text, prompts, cookie values, and project content never leave
 * the isolated renderer.
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
    const label = (element) => (element.textContent || element.getAttribute('aria-label') || '').trim();
    const visible = (selector) => [...document.querySelectorAll(selector)]
      .map((element) => ({ element, rectangle: visibleRect(element) }))
      .filter((entry) => entry.rectangle);
    const viewH = window.innerHeight;

    const inputs = visible('[contenteditable="true"], textarea');
      const promptEntry = inputs.find(({ rectangle }) => rectangle.width > 100 && rectangle.y > viewH * 0.45);
    const input = promptEntry?.rectangle;

    const projectLink = visible('a[href*="/fx/tools/flow/project/"], a[href*="/project/"]')
      .find(({ rectangle }) => rectangle.width > 50 && rectangle.height > 50);
    const buttons = visible('button');
    const newProjectEntry = buttons.find(({ element }) => /new project|dự án mới/i.test(label(element)));
    const dismissEntry = buttons.find(({ element }) => /^(close|đóng)$/i.test(label(element)));

    const configCandidates = visible('button[aria-haspopup="menu"]')
      .filter(({ element, rectangle }) => {
        const text = label(element);
        return rectangle.y > viewH * 0.65 && /crop_|image|video|banana|imagen|veo/i.test(text);
      });
    const configEntry = configCandidates.find(({ element }) => /crop_|(?:^|\\s)x[1-4](?:\\s|$)|landscape|portrait/i.test(label(element)))
      || configCandidates[0];
    const configButton = configEntry
      ? { rectangle: configEntry.rectangle, text: label(configEntry.element) }
      : undefined;

    const tabs = visible('[role="tab"]').map(({ element, rectangle }) => ({
      rectangle,
      text: label(element),
      selected: element.getAttribute('aria-selected') === 'true'
    }));
    const menuItems = visible('[role="menuitem"], [role="option"]').map(({ element, rectangle }) => ({
      rectangle,
      text: label(element),
      selected: element.getAttribute('aria-selected') === 'true' || element.getAttribute('aria-checked') === 'true'
    }));
    const modelEntry = buttons.find(({ element, rectangle }) => {
      const text = label(element);
      return rectangle.width > 100 && /nano banana|imagen/i.test(text)
        && (/arrow_drop_down/i.test(text) || element.getAttribute('aria-haspopup') !== null)
        && (!configEntry || element !== configEntry.element);
    });
    const modelDropdown = modelEntry
      ? { rectangle: modelEntry.rectangle, text: label(modelEntry.element) }
      : undefined;

    const submitEntry = buttons.find(({ element, rectangle }) => {
      const text = label(element);
      const aria = element.getAttribute('aria-label') || '';
      return rectangle.y > viewH * 0.65 && !element.disabled
        && (/arrow_forward/i.test(text) || /^(generate|create)$/i.test(aria));
    });

    const images = visible('img').flatMap(({ element, rectangle }) => {
      if (!(element instanceof HTMLImageElement)) return [];
      const src = element.currentSrc || element.src || '';
      const providerMedia = src.includes('labs.google/fx/api/')
        || src.includes('googleusercontent.com')
        || src.includes('lh3.google')
        || src.includes('gstatic.com')
        || src.includes('storage.googleapis.com');
      return providerMedia && rectangle.width > 100 && rectangle.height > 100 && element.naturalWidth > 100
        ? [{ rectangle, src }]
        : [];
    });

    const body = (document.body?.innerText || '').toLowerCase();
    let actionRequired;
    if (location.hostname === 'accounts.google.com' || (/sign in|đăng nhập/.test(body) && !input && !projectLink)) {
      actionRequired = 'sign_in';
    } else if (/captcha|verify it'?s you|verify your identity|unusual traffic|xác minh/.test(body)) {
      actionRequired = 'verification';
    } else if (/rate limit|usage limit|not enough credits|insufficient credits|hết tín dụng|đã đạt giới hạn/.test(body)) {
      actionRequired = 'rate_limit';
    } else if (/flow is not available|isn't available in your country|not available in your country/.test(body)) {
      actionRequired = 'unavailable';
    }

    return {
      url: location.href,
      ...(input ? { input } : {}),
      ...(projectLink ? { existingProject: projectLink.rectangle } : {}),
      ...(newProjectEntry ? { newProject: newProjectEntry.rectangle } : {}),
      ...(dismissEntry ? { dismiss: dismissEntry.rectangle } : {}),
      ...(configButton ? { configButton } : {}),
      ...(modelDropdown ? { modelDropdown } : {}),
      tabs,
      menuItems,
      ...(submitEntry ? { submit: submitEntry.rectangle } : {}),
      images,
      ...(actionRequired ? { actionRequired } : {})
    };
  })()`, true) as Promise<AutomationState>;
}

function normalizedLabel(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function actionRequiredError(kind: NonNullable<AutomationState['actionRequired']>): Error {
  if (kind === 'sign_in') {
    return new Error('The Google Flow session has expired. Open Settings, sign in to Google Flow again, then retry.');
  }
  if (kind === 'verification') {
    return new Error('Google requires a CAPTCHA or account verification. Open the Flow session in Settings and complete it manually, then retry.');
  }
  if (kind === 'unavailable') {
    return new Error('Google Flow is not available for this account or region. Open the Flow session in Settings to check access.');
  }
  return new Error('Google Flow has reached the account usage or credit limit. Wait for it to reset or check the Google plan, then retry.');
}

function throwForAction(state: AutomationState): void {
  if (state.actionRequired !== undefined) throw actionRequiredError(state.actionRequired);
}

function pressKey(webContents: WebContents, keyCode: string, modifiers?: KeyboardInputEvent['modifiers']): void {
  const down: KeyboardInputEvent = { type: 'keyDown', keyCode, ...(modifiers ? { modifiers } : {}) };
  const up: KeyboardInputEvent = { type: 'keyUp', keyCode, ...(modifiers ? { modifiers } : {}) };
  webContents.sendInputEvent(down);
  webContents.sendInputEvent(up);
}

async function waitForProjectEditor(
  webContents: WebContents,
  deadline: number,
  onProject: () => void
): Promise<AutomationState> {
  let enteredProject = false;
  while (Date.now() < deadline) {
    const state = await readState(webContents);
    throwForAction(state);
    if (state.input !== undefined && state.configButton !== undefined) return state;
    if (!enteredProject && state.dismiss !== undefined) {
      clickAt(webContents, state.dismiss);
      await delay(500);
      continue;
    }
    const projectTarget = state.existingProject ?? state.newProject;
    if (!enteredProject && projectTarget !== undefined) {
      enteredProject = true;
      onProject();
      clickAt(webContents, projectTarget);
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error('Google Flow loaded, but its project editor did not become ready before the timeout. Open the Flow session in Settings and check the page.');
}

function targetModelLabel(model: GoogleFlowImageModel): string {
  return model === 'nano-banana-pro' ? 'Nano Banana Pro' : 'Nano Banana 2';
}

export function flowOrientationForAspectRatio(aspectRatio: string): 'Landscape' | 'Portrait' {
  const [width, height] = aspectRatio.split(':').map(Number);
  return Number.isFinite(width) && Number.isFinite(height) && height! > width! ? 'Portrait' : 'Landscape';
}

function findTab(state: AutomationState, expected: string): RectangleWithText | undefined {
  const target = normalizedLabel(expected);
  return state.tabs.find((tab) => normalizedLabel(tab.text).includes(target));
}

async function selectTab(webContents: WebContents, expected: string): Promise<void> {
  const state = await readState(webContents);
  throwForAction(state);
  const tab = findTab(state, expected);
  if (tab === undefined) throw new Error(`Google Flow configuration did not expose the ${expected} option.`);
  if (!tab.selected) {
    clickAt(webContents, tab.rectangle);
    await delay(500);
  }
}

async function configureGeneration(
  webContents: WebContents,
  ready: AutomationState,
  model: GoogleFlowImageModel,
  aspectRatio: string
): Promise<void> {
  clickAt(webContents, ready.configButton!.rectangle);
  await delay(800);
  await selectTab(webContents, 'Image');
  await selectTab(webContents, flowOrientationForAspectRatio(aspectRatio));
  await selectTab(webContents, 'x1');

  let state = await readState(webContents);
  throwForAction(state);
  const expectedModel = targetModelLabel(model);
  const currentConfiguration = `${ready.configButton?.text ?? ''} ${state.modelDropdown?.text ?? ''}`;
  if (!normalizedLabel(currentConfiguration).includes(normalizedLabel(expectedModel))) {
    if (state.modelDropdown === undefined) {
      throw new Error(`Google Flow loaded, but the image model selector was not found. OpenScene cannot guarantee ${expectedModel}.`);
    }
    clickAt(webContents, state.modelDropdown.rectangle);
    await delay(600);
    state = await readState(webContents);
    throwForAction(state);
    const option = state.menuItems.find((entry) => normalizedLabel(entry.text).includes(normalizedLabel(expectedModel)));
    if (option === undefined) {
      pressKey(webContents, 'ESCAPE');
      throw new Error(`This Google Flow account does not expose ${expectedModel}. Choose another Nano Banana model or check the account plan.`);
    }
    clickAt(webContents, option.rectangle);
    await delay(500);
  }
  pressKey(webContents, 'ESCAPE');
  await delay(500);
}

async function fillPrompt(webContents: WebContents, prompt: string, deadline: number): Promise<AutomationState> {
  while (Date.now() < deadline) {
    const state = await readState(webContents);
    throwForAction(state);
    if (state.input !== undefined && state.submit !== undefined) {
      clickAt(webContents, state.input);
      await delay(150);
      pressKey(webContents, 'A', ['control']);
      await delay(100);
      await webContents.insertText(prompt);
      await delay(300);
      return state;
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error('Google Flow loaded, but OpenScene could not find its prompt and Create controls. The Flow UI may have changed.');
}

/**
 * Drive the normal Google Labs Flow UI inside an isolated Electron Chromium
 * renderer. No private generation endpoint is called and no cookie is copied
 * into application code. The returned URL is a media element Flow rendered for
 * the newly generated image and is downloaded by the same browser session.
 */
export async function automateGoogleFlowImageGeneration(
  webContents: WebContents,
  input: GoogleFlowAutomationInput
): Promise<string> {
  const startedAt = Date.now();
  const deadline = startedAt + input.timeoutMs;
  input.onProgress?.('loading', 0);

  let ready = await waitForProjectEditor(webContents, deadline, () => {
    input.onProgress?.('project', Date.now() - startedAt);
  });
  input.onProgress?.('ready', Date.now() - startedAt);
  input.onProgress?.('configuring', Date.now() - startedAt);
  await configureGeneration(webContents, ready, input.model, input.aspectRatio);

  ready = await fillPrompt(webContents, input.prompt, deadline);
  const existingImages = new Set(ready.images.map((image) => image.src));
  clickAt(webContents, ready.submit!);
  input.onProgress?.('submitted', Date.now() - startedAt);

  let lastHeartbeat = 0;
  while (Date.now() < deadline) {
    await delay(POLL_INTERVAL_MS);
    const state = await readState(webContents);
    throwForAction(state);
    const elapsed = Date.now() - startedAt;
    if (elapsed - lastHeartbeat >= 10_000) {
      lastHeartbeat = elapsed;
      input.onProgress?.('generating', elapsed);
    }
    const generated = state.images.find((image) => !existingImages.has(image.src));
    if (generated !== undefined) {
      input.onProgress?.('downloading', elapsed);
      return generated.src;
    }
  }
  throw new Error('Google Flow did not produce an image before the timeout. Check the prompt, account credits, and Flow access, then retry.');
}

export function detectDownloadedImageMime(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
