import type { KeyboardInputEvent, Rectangle, WebContents } from 'electron';
import type { GoogleFlowImageModel } from '../shared/browserSession';

const POLL_INTERVAL_MS = 1_000;
const FLOW_PROJECT_MAP_STORAGE_KEY = 'openscene-flow-project-map-v1';
const FLOW_PROJECT_RENAME_TIMEOUT_MS = 5_000;

type RectangleWithText = {
  readonly rectangle: Rectangle;
  readonly text: string;
  readonly selected?: boolean;
};

type FlowProjectCandidate = RectangleWithText & {
  readonly href?: string;
};

type FlowImage = {
  readonly rectangle: Rectangle;
  readonly src: string;
};

type AutomationState = {
  readonly url: string;
  readonly input?: Rectangle;
  readonly existingProject?: Rectangle;
  readonly projectCandidates?: readonly FlowProjectCandidate[];
  readonly newProject?: Rectangle;
  readonly projectTitle?: RectangleWithText;
  readonly projectTitleMenu?: Rectangle;
  readonly renameProject?: Rectangle;
  readonly projectTitleInput?: Rectangle;
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
  readonly projectName?: string;
  readonly onProgress?: (
    stage: GoogleFlowAutomationProgress,
    elapsedMs: number,
    details?: Readonly<Record<string, unknown>>
  ) => void;
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
export function buildGoogleFlowStateProbeScript(): string {
  return `(() => {
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

    const inputs = visible('[contenteditable]:not([contenteditable="false"]), textarea, [role="textbox"]');
    // The unified Flow editor uses a ProseMirror contenteditable while the
    // visible "What do you want to create?" text is only a non-editable span.
    // Prefer that concrete editor so a project title/search textbox cannot win
    // the broad geometry fallback.
    const explicitPromptEntry = visible([
      'flow-rich-text-editor .ProseMirror[contenteditable="true"]',
      '.prompt-input .ProseMirror[contenteditable="true"]'
    ].join(',')).find(({ rectangle }) => rectangle.width > 100 && rectangle.y > viewH * 0.45);
    const promptEntry = explicitPromptEntry
      || inputs.find(({ rectangle }) => rectangle.width > 100 && rectangle.y > viewH * 0.45);
    const input = promptEntry?.rectangle;

    const projectLink = visible('a[href*="/fx/tools/flow/project/"], a[href*="/project/"]')
      .find(({ rectangle }) => rectangle.width > 50 && rectangle.height > 50);
    const normalized = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const interactive = visible('button, [role="button"], a, [tabindex="0"]');
    const projectCandidates = [];
    const seenProjectElements = new Set();
    const addProjectCandidate = (element, rectangle, href) => {
      if (!rectangle || rectangle.width < 120 || rectangle.height < 80 || rectangle.y < 60) return;
      if (seenProjectElements.has(element)) return;
      const text = label(element);
      if (/new project|du an moi/.test(normalized(text))) return;
      seenProjectElements.add(element);
      projectCandidates.push({ rectangle, text, ...(href ? { href } : {}) });
    };
    interactive.forEach(({ element, rectangle }) => {
      const href = element instanceof HTMLAnchorElement ? element.href : undefined;
      addProjectCandidate(element, rectangle, href);
    });
    // Flow renders project cards as clickable divs containing thumbnails in
    // the listing. Include the thumbnail owner when it is not an anchor.
    visible('img').forEach(({ element, rectangle }) => {
      if (!(element instanceof HTMLImageElement) || element.naturalWidth < 100) return;
      let owner = element.closest('a, button, [role="button"], [tabindex="0"]');
      if (!owner) owner = element.parentElement;
      const ownerRectangle = owner ? visibleRect(owner) : rectangle;
      const href = owner instanceof HTMLAnchorElement ? owner.href : undefined;
      addProjectCandidate(owner ?? element, ownerRectangle ?? rectangle, href);
    });
    projectCandidates.sort((left, right) => (right.rectangle.width * right.rectangle.height) - (left.rectangle.width * left.rectangle.height));
    const flowExistingProject = projectCandidates[0];
    const flowNewProject = interactive
      .concat(visible('div, span'))
      .filter(({ element, rectangle }) => {
        if (rectangle.width < 60 || rectangle.height < 30 || rectangle.width > window.innerWidth * 0.8) return false;
        const text = normalized(label(element));
        return /new project|du an moi/.test(text) || /^\\+\\s*(new|du an)/.test(text);
      })
      .sort((left, right) => (left.rectangle.width * left.rectangle.height) - (right.rectangle.width * right.rectangle.height))[0];
    const buttons = visible('button');
    const newProjectEntry = buttons.find(({ element }) => /new project|dự án mới/i.test(label(element)));
    const dismissEntry = buttons.find(({ element }) => /^(close|đóng)$/i.test(label(element)));

    const projectInputs = visible('input, [contenteditable]:not([contenteditable="false"])');
    const topInputs = projectInputs
      .filter(({ rectangle }) => rectangle.y < viewH * 0.35 && rectangle.width > 100);
    const explicitTitleInput = projectInputs.find(({ element }) => {
      const text = [element.getAttribute('aria-label'), element.getAttribute('placeholder'), element.getAttribute('name')]
        .filter(Boolean).join(' ');
      return /project|title|name|untitled/i.test(text);
    });
    const renameProjectEntry = visible('button, [role="menuitem"], [role="option"]')
      .find(({ element }) => /^(rename|doi ten|Ä‘á»•i tÃªn)$/i.test(normalized(label(element))));
    const titleInput = explicitTitleInput || projectInputs.find(({ element, rectangle }) => {
      const value = element instanceof HTMLInputElement ? element.value : label(element);
      const hint = [element.getAttribute('aria-label'), element.getAttribute('placeholder')].filter(Boolean).join(' ');
      return rectangle.y < viewH * 0.65 && value.trim().length > 0 && !/search|prompt/i.test(hint);
    });
    const explicitTitleButton = interactive.find(({ element, rectangle }) => {
      if (rectangle.y > viewH * 0.35 || rectangle.width < 80) return false;
      return /untitled|project name|project title/i.test(label(element));
    });
    const titleButton = explicitTitleButton || interactive.find(({ element, rectangle }) => {
      const text = label(element);
      return rectangle.x > 50 && rectangle.x < window.innerWidth * 0.32
        && rectangle.y < 140 && rectangle.width >= 80 && rectangle.height < 80
        && text.length > 0 && text.length <= 100
        && !/home|all media|character|scene|tool/i.test(normalized(text));
    });
    const titleMenuEntry = buttons.find(({ element, rectangle }) => {
      const text = normalized(label(element));
      const aria = normalized(element.getAttribute('aria-label') || '');
      return rectangle.x > 50 && rectangle.x < window.innerWidth * 0.35
        && rectangle.y < 140 && rectangle.width < 80 && rectangle.height < 80
        && /more|option|menu|more_vert/.test(text + ' ' + aria);
    });

    // The current Flow editor renders the bottom configuration pill as a
    // regular button (for example "Video 720p 8s x2") rather than always
    // exposing aria-haspopup=menu. Search all interactive controls, but keep
    // the geometry and media-setting checks narrow enough to avoid nav items.
    const configCandidates = interactive
      .filter(({ element, rectangle }) => {
        const text = label(element);
        return rectangle.y > viewH * 0.55 && rectangle.width > 100
          && /crop_|image|video|banana|imagen|veo|(?:^|\\s)x[1-4](?:\\s|$)|\\b\\d{3,4}p\\b|\\b\\d{1,3}s\\b/i.test(text);
      });
    const configEntry = configCandidates.find(({ element }) => /crop_|(?:^|\\s)x[1-4](?:\\s|$)|landscape|portrait/i.test(label(element)))
      || configCandidates[0];
    const configButton = configEntry
      ? { rectangle: configEntry.rectangle, text: label(configEntry.element) }
      : undefined;

    // Flow has used tabs, menu items, radio controls, and plain buttons for
    // the same configuration choices across UI revisions. Return the common
    // geometry contract so the driver does not depend on one ARIA role.
    const tabs = visible('[role="tab"], [role="radio"], button').map(({ element, rectangle }) => ({
      rectangle,
      text: label(element),
      selected: element.getAttribute('aria-selected') === 'true'
        || element.getAttribute('aria-checked') === 'true'
        || element.getAttribute('aria-pressed') === 'true'
        || element.getAttribute('data-state') === 'checked'
    }));
    const menuItems = visible('[role="menuitem"], [role="option"]').map(({ element, rectangle }) => ({
      rectangle,
      text: label(element),
      selected: element.getAttribute('aria-selected') === 'true' || element.getAttribute('aria-checked') === 'true'
    }));
    const modelEntries = buttons.filter(({ element, rectangle }) => {
      const text = label(element);
      return rectangle.width > 100 && /nano banana|imagen/i.test(text)
        && (!configEntry || element !== configEntry.element);
    });
    const modelEntry = modelEntries.find(({ element }) => {
      const text = label(element);
      return /arrow_drop_down/i.test(text) || element.getAttribute('aria-haspopup') !== null;
    }) || modelEntries[0];
    const modelDropdown = modelEntry
      ? { rectangle: modelEntry.rectangle, text: label(modelEntry.element) }
      : undefined;

    const submitEntry = buttons.find(({ element, rectangle }) => {
      const text = label(element);
      const aria = element.getAttribute('aria-label') || '';
      return rectangle.y > viewH * 0.65 && !element.disabled
        && (/arrow_forward|send/i.test(text) || /generate|create|submit|send/i.test(aria));
    });

    const images = visible('img').flatMap(({ element, rectangle }) => {
      if (!(element instanceof HTMLImageElement)) return [];
      const src = element.currentSrc || element.src || '';
      const providerMedia = src.includes('labs.google/fx/api/')
        || src.includes('flow-content.google/image/')
        || src.includes('googleusercontent.com')
        || src.includes('lh3.google')
        || src.includes('gstatic.com')
        || src.includes('storage.googleapis.com');
      return providerMedia && rectangle.width > 100 && rectangle.height > 100 && element.naturalWidth > 100
        ? [{ rectangle, src }]
        : [];
    });

    const body = (document.body?.innerText || '').toLowerCase();
    // Google can keep invisible reCAPTCHA/bootstrap elements mounted on an
    // already authenticated Flow page. Only stop for a challenge which is
    // actually visible to the user; otherwise the project list is incorrectly
    // classified as requiring account verification.
    const challengeElement = visible([
      'iframe[src*="recaptcha"]',
      'iframe[src*="hcaptcha"]',
      'iframe[title*="captcha" i]',
      'input[name*="captcha" i]',
      'input[autocomplete="one-time-code"]'
    ].join(',')).find(({ element, rectangle }) => {
      const style = window.getComputedStyle(element);
      return rectangle.width >= 80 && rectangle.height >= 30
        && rectangle.x < window.innerWidth
        && rectangle.y < window.innerHeight
        && rectangle.x + rectangle.width > 0
        && rectangle.y + rectangle.height > 0
        && style.opacity !== '0'
        && element.closest('[aria-hidden="true"]') === null;
    });
    const accountChallengePath = location.hostname === 'accounts.google.com'
      && /\\/challenge(?:\\/|$)|\\/signin\\/v2\\/challenge(?:\\/|$)/i.test(location.pathname);
    let actionRequired;
    if (challengeElement || accountChallengePath) {
      actionRequired = 'verification';
    } else if (location.hostname === 'accounts.google.com' || (/sign in|đăng nhập/.test(body) && !input && !projectLink)) {
      actionRequired = 'sign_in';
    } else if (/rate limit|usage limit|not enough credits|insufficient credits|hết tín dụng|đã đạt giới hạn/.test(body)) {
      actionRequired = 'rate_limit';
    } else if (/flow is not available|isn't available in your country|not available in your country/.test(body)) {
      actionRequired = 'unavailable';
    }

    return {
      url: location.href,
      ...(input ? { input } : {}),
      ...(flowExistingProject ? { existingProject: flowExistingProject.rectangle } : {}),
      projectCandidates,
      ...(flowNewProject ? { newProject: flowNewProject.rectangle } : {}),
      ...(titleButton ? { projectTitle: { rectangle: titleButton.rectangle, text: label(titleButton.element) } } : {}),
      ...(titleMenuEntry ? { projectTitleMenu: titleMenuEntry.rectangle } : {}),
      ...(renameProjectEntry ? { renameProject: renameProjectEntry.rectangle } : {}),
      ...(titleInput ? { projectTitleInput: titleInput.rectangle } : {}),
      ...(dismissEntry ? { dismiss: dismissEntry.rectangle } : {}),
      ...(configButton ? { configButton } : {}),
      ...(modelDropdown ? { modelDropdown } : {}),
      tabs,
      menuItems,
      ...(submitEntry ? { submit: submitEntry.rectangle } : {}),
      images,
      ...(actionRequired ? { actionRequired } : {})
    };
  })()`;
}

async function readState(webContents: WebContents): Promise<AutomationState> {
  return webContents.executeJavaScript(buildGoogleFlowStateProbeScript(), true) as Promise<AutomationState>;
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
  projectName: string | undefined,
  onProject: (details?: Readonly<Record<string, unknown>>) => void
): Promise<{ readonly state: AutomationState; readonly createdProject: boolean }> {
  let enteredProject = false;
  let createdProject = false;
  let rememberedProjectAttempted = false;
  let lastHeartbeat = Date.now();
  const readinessDetails = (state: AutomationState): Readonly<Record<string, unknown>> => ({
    projectCandidates: state.projectCandidates?.length ?? 0,
    requestedProject: projectName ?? '',
    inputFound: state.input !== undefined,
    configFound: state.configButton !== undefined,
    projectPage: isFlowProjectUrl(state.url)
  });
  while (Date.now() < deadline) {
    let state: AutomationState;
    try {
      state = await readState(webContents);
    } catch (error) {
      // Flow replaces its renderer frame while entering a project. A DOM read
      // during that hand-off can reject even though navigation is healthy.
      if (Date.now() - lastHeartbeat >= 10_000) {
        lastHeartbeat = Date.now();
        onProject({
          stateReadError: error instanceof Error ? error.message.slice(0, 240) : 'Unknown DOM state error'
        });
      }
      await delay(POLL_INTERVAL_MS);
      continue;
    }
    throwForAction(state);
    if (state.input !== undefined && state.configButton !== undefined) return { state, createdProject };
    if (!enteredProject && !rememberedProjectAttempted && projectName !== undefined) {
      rememberedProjectAttempted = true;
      const rememberedUrl = await readRememberedProjectUrl(webContents, projectName).catch(() => undefined);
      if (rememberedUrl !== undefined) {
        onProject({ rememberedProject: true, requestedProject: projectName });
        enteredProject = true;
        await webContents.loadURL(rememberedUrl);
        lastHeartbeat = Date.now();
        await delay(500);
        continue;
      }
    }
    if (!enteredProject && state.dismiss !== undefined) {
      clickAt(webContents, state.dismiss);
      await delay(500);
      continue;
    }
    const target = projectName === undefined ? undefined : normalizedLabel(projectName);
    const matchingProject = target === undefined || target.length === 0
      ? undefined
      : (state.projectCandidates ?? []).find((candidate) => normalizedLabel(candidate.text).includes(target));
    // If the requested local project is not visible in Flow, create one rather
    // than silently generating into another project. This is what prevents a
    // project from drifting away from the local folder name.
    const projectTarget = matchingProject?.rectangle
      ?? (target === undefined || target.length === 0 ? state.existingProject ?? state.newProject : state.newProject);
    if (!enteredProject && projectTarget !== undefined) {
      enteredProject = true;
      createdProject = matchingProject === undefined && state.newProject !== undefined && projectTarget === state.newProject;
      onProject({
        ...readinessDetails(state),
        matchingProject: matchingProject?.text ?? '',
        creatingProject: createdProject
      });
      lastHeartbeat = Date.now();
      clickAt(webContents, projectTarget);
    }
    if (Date.now() - lastHeartbeat >= 10_000) {
      lastHeartbeat = Date.now();
      onProject({
        ...readinessDetails(state),
        matchingProject: matchingProject?.text ?? '',
        creatingProject: createdProject
      });
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error('Google Flow loaded, but its project editor did not become ready before the timeout. Open the Flow session in Settings and check the page.');
}

function isFlowProjectUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && (parsed.hostname === 'labs.google' || parsed.hostname === 'flow.google.com')
      && /\/project\//.test(parsed.pathname);
  } catch {
    return false;
  }
}

async function readRememberedProjectUrl(webContents: WebContents, projectName: string): Promise<string | undefined> {
  const encodedName = JSON.stringify(projectName);
  const result = await webContents.executeJavaScript(`(() => {
    try {
      const map = JSON.parse(window.localStorage.getItem(${JSON.stringify(FLOW_PROJECT_MAP_STORAGE_KEY)}) || '{}');
      return map[${encodedName}];
    } catch {
      return undefined;
    }
  })()`, true);
  return typeof result === 'string' && isFlowProjectUrl(result) ? result : undefined;
}

async function rememberProjectUrl(webContents: WebContents, projectName: string, projectUrl: string): Promise<void> {
  if (!isFlowProjectUrl(projectUrl)) return;
  const encodedName = JSON.stringify(projectName);
  const encodedUrl = JSON.stringify(projectUrl);
  await webContents.executeJavaScript(`(() => {
    try {
      const key = ${JSON.stringify(FLOW_PROJECT_MAP_STORAGE_KEY)};
      const current = JSON.parse(window.localStorage.getItem(key) || '{}');
      current[${encodedName}] = ${encodedUrl};
      window.localStorage.setItem(key, JSON.stringify(current));
    } catch {
      // A blocked localStorage only disables the reuse hint; Flow remains usable.
    }
  })()`, true);
}

/**
 * New Flow projects can expose their title as a small top-bar button or an
 * inline input. Rename only through that visible control; no private Flow
 * endpoint or project metadata is touched.
 */
async function renameFlowProject(
  webContents: WebContents,
  projectName: string,
  deadline: number
): Promise<boolean> {
  let menuOpened = false;
  let renameEditingRequested = false;
  while (Date.now() < deadline) {
    const state = await readState(webContents);
    throwForAction(state);
    if (renameEditingRequested && state.projectTitleInput !== undefined) {
      clickAt(webContents, state.projectTitleInput);
      await delay(100);
      pressKey(webContents, 'A', ['control']);
      await webContents.insertText(projectName);
      pressKey(webContents, 'ENTER');
      await delay(500);
      const verified = await readState(webContents);
      return verified.projectTitle !== undefined
        && normalizedLabel(verified.projectTitle.text).includes(normalizedLabel(projectName));
    }
    if (state.renameProject !== undefined) {
      clickAt(webContents, state.renameProject);
      renameEditingRequested = true;
      await delay(300);
      continue;
    }
    if (!menuOpened && state.projectTitleMenu !== undefined) {
      clickAt(webContents, state.projectTitleMenu);
      menuOpened = true;
      await delay(300);
      continue;
    }
    if (state.projectTitle !== undefined) {
      clickAt(webContents, state.projectTitle.rectangle);
      renameEditingRequested = true;
      await delay(300);
      continue;
    }
    await delay(POLL_INTERVAL_MS);
  }
  return false;
}

function targetModelLabel(model: GoogleFlowImageModel): string {
  return model === 'nano-banana-pro' ? 'Nano Banana Pro' : 'Nano Banana 2';
}

export function flowConfigurationHasExactModel(configuration: string, expectedModel: string): boolean {
  const current = normalizedLabel(configuration).replace(/\s+/g, ' ').trim();
  const expected = normalizedLabel(expectedModel).replace(/\s+/g, ' ').trim();
  if (expected === 'nano banana 2') {
    return current.includes(expected) && !current.includes(`${expected} lite`);
  }
  return current.includes(expected);
}

export function flowOrientationForAspectRatio(aspectRatio: string): 'Landscape' | 'Portrait' | 'Square' {
  const [width, height] = aspectRatio.split(':').map(Number);
  if (Number.isFinite(width) && Number.isFinite(height) && width === height) return 'Square';
  return Number.isFinite(width) && Number.isFinite(height) && height! > width! ? 'Portrait' : 'Landscape';
}

function findChoice(state: AutomationState, expected: string): RectangleWithText | undefined {
  const target = normalizedLabel(expected);
  const choices = [...state.tabs, ...state.menuItems];
  return choices.find((choice) => normalizedLabel(choice.text) === target)
    ?? choices.find((choice) => normalizedLabel(choice.text).includes(target));
}

async function selectConfigurationChoice(
  webContents: WebContents,
  configButton: Rectangle,
  expected: string
): Promise<void> {
  let state = await readState(webContents);
  throwForAction(state);
  let choice = findChoice(state, expected);
  if (choice === undefined) {
    // Some Flow revisions close the popover after each selection. Reopen the
    // same bottom configuration pill before declaring the option unavailable.
    clickAt(webContents, configButton);
    await delay(300);
    state = await readState(webContents);
    throwForAction(state);
    choice = findChoice(state, expected);
  }
  if (choice === undefined) throw new Error(`Google Flow configuration did not expose the ${expected} option.`);
  if (!choice.selected) {
    clickAt(webContents, choice.rectangle);
    await delay(500);
  }
}

async function configureGeneration(
  webContents: WebContents,
  ready: AutomationState,
  model: GoogleFlowImageModel,
  aspectRatio: string,
  onConfiguration: (details: Readonly<Record<string, unknown>>) => void
): Promise<void> {
  const configButton = ready.configButton!.rectangle;
  clickAt(webContents, configButton);
  await delay(800);
  onConfiguration({ step: 'panel_opened' });
  await selectConfigurationChoice(webContents, configButton, 'Image');
  onConfiguration({ step: 'media_type', selected: 'Image' });
  await selectConfigurationChoice(webContents, configButton, flowOrientationForAspectRatio(aspectRatio));
  onConfiguration({ step: 'orientation', selected: flowOrientationForAspectRatio(aspectRatio) });
  await selectConfigurationChoice(webContents, configButton, 'x1');
  onConfiguration({ step: 'count', selected: 'x1' });

  let state = await readState(webContents);
  throwForAction(state);
  const expectedModel = targetModelLabel(model);
  // Each choice can close and replace Flow's configuration pill. Always read
  // the current pill; the pre-configuration state still describes Video.
  const currentConfiguration = `${state.configButton?.text ?? ''} ${state.modelDropdown?.text ?? ''}`;
  onConfiguration({
    step: 'model_check',
    expectedModel,
    currentConfigFound: state.configButton !== undefined,
    modelControlFound: state.modelDropdown !== undefined,
    expectedModelSelected: flowConfigurationHasExactModel(currentConfiguration, expectedModel)
  });
  if (!flowConfigurationHasExactModel(currentConfiguration, expectedModel)) {
    if (state.modelDropdown === undefined) {
      throw new Error(`Google Flow loaded, but the image model selector was not found. OpenScene cannot guarantee ${expectedModel}.`);
    }
    clickAt(webContents, state.modelDropdown.rectangle);
    await delay(600);
    state = await readState(webContents);
    throwForAction(state);
    const option = findChoice(state, expectedModel);
    if (option === undefined) {
      pressKey(webContents, 'ESCAPE');
      throw new Error(`This Google Flow account does not expose ${expectedModel}. Choose another Nano Banana model or check the account plan.`);
    }
    clickAt(webContents, option.rectangle);
    await delay(500);
    onConfiguration({ step: 'model', selected: expectedModel });
  }
  pressKey(webContents, 'ESCAPE');
  await delay(500);
  onConfiguration({ step: 'complete' });
}

async function fillPrompt(webContents: WebContents, prompt: string, deadline: number): Promise<AutomationState> {
  let promptInserted = false;
  while (Date.now() < deadline) {
    const state = await readState(webContents);
    throwForAction(state);
    // Flow deliberately disables Create while the prompt is empty. Waiting for
    // both controls before typing therefore deadlocks on the live page. Fill
    // the ProseMirror editor first, then return only after a fresh DOM probe
    // observes the newly enabled Create button.
    if (!promptInserted && state.input !== undefined) {
      clickAt(webContents, state.input);
      await delay(150);
      pressKey(webContents, 'A', ['control']);
      await delay(100);
      await webContents.insertText(prompt);
      await delay(300);
      promptInserted = true;
      continue;
    }
    if (promptInserted && state.submit !== undefined) return state;
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

  const projectResult = await waitForProjectEditor(webContents, deadline, input.projectName, (details) => {
    input.onProgress?.('project', Date.now() - startedAt, details);
  });
  let ready = projectResult.state;
  if (input.projectName !== undefined) {
    await rememberProjectUrl(webContents, input.projectName, ready.url).catch(() => undefined);
  }
  if (projectResult.createdProject && input.projectName !== undefined) {
    const renameDeadline = Math.min(deadline, Date.now() + FLOW_PROJECT_RENAME_TIMEOUT_MS);
    const renamed = await renameFlowProject(webContents, input.projectName, renameDeadline);
    input.onProgress?.('project', Date.now() - startedAt, {
      projectName: input.projectName,
      projectCreated: true,
      projectRenamed: renamed
    });
  }
  input.onProgress?.('ready', Date.now() - startedAt);
  input.onProgress?.('configuring', Date.now() - startedAt);
  await configureGeneration(webContents, ready, input.model, input.aspectRatio, (details) => {
    input.onProgress?.('configuring', Date.now() - startedAt, details);
  });

  ready = await fillPrompt(webContents, input.prompt, deadline);
  input.onProgress?.('configuring', Date.now() - startedAt, { step: 'prompt_filled' });
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
