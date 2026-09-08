import { BrowserWindow, session, type Cookie, type CookiesSetDetails, type DownloadItem, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  BROWSER_SESSION_PROVIDERS,
  buildGoogleFlowImagePrompt,
  googleFlowImageModelFor,
  getBrowserSessionProviderPolicy,
  isBrowserSessionCookieDomainAllowed,
  isBrowserSessionNavigationAllowed,
  normalizeGoogleFlowProjectName,
  type BrowserSessionProviderId,
  type BrowserSessionStatus
} from '../shared/browserSession';
import { BrowserSessionVault, type BrowserSessionStoredCookie } from './browserSessionVault';
import { automateGoogleFlowImageGeneration, detectDownloadedImageMime } from './googleFlowImageAutomation';

const PARTITION_PREFIX = 'ai-video-studio-browser-session';
const GOOGLE_FLOW_IMAGE_TIMEOUT_MS = 4 * 60_000;
const GOOGLE_FLOW_PAGE_LOAD_TIMEOUT_MS = 60_000;
const GOOGLE_FLOW_DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_BROWSER_IMAGE_BYTES = 50 * 1024 * 1024;

export type GoogleFlowImageGenerationInput = {
  readonly modelId: string;
  readonly prompt: string;
  readonly aspectRatio: string;
  readonly stylePreset?: string;
  readonly negativePrompt?: string;
  readonly showBrowserWindow?: boolean;
  readonly projectName?: string;
};

export type BrowserSessionGeneratedImage = {
  readonly bytes: Buffer;
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly providerJobId: string;
};

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function removeTemporaryDownload(filePath: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await unlink(filePath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      if (code !== 'EBUSY' && code !== 'EPERM') return;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

function partitionFor(providerId: BrowserSessionProviderId): string {
  // No `persist:` prefix: Chromium never writes this isolated profile as
  // plaintext browser data. The encrypted vault is the only persistence.
  return `${PARTITION_PREFIX}-${providerId}`;
}

function cookieKey(cookie: Pick<BrowserSessionStoredCookie, 'name' | 'domain' | 'path'>): string {
  return `${cookie.domain}\u0000${cookie.path}\u0000${cookie.name}`;
}

function toStoredCookie(providerId: BrowserSessionProviderId, sourceUrl: string, cookie: Cookie): BrowserSessionStoredCookie | null {
  const domain = cookie.domain ?? new URL(sourceUrl).hostname;
  if (!isBrowserSessionCookieDomainAllowed(providerId, domain)) return null;
  return {
    name: cookie.name ?? '',
    value: cookie.value ?? '',
    domain,
    hostOnly: cookie.hostOnly ?? false,
    path: cookie.path ?? '/',
    secure: cookie.secure ?? sourceUrl.startsWith('https://'),
    httpOnly: cookie.httpOnly ?? false,
    session: cookie.session ?? cookie.expirationDate === undefined,
    ...(cookie.expirationDate === undefined ? {} : { expirationDate: cookie.expirationDate }),
    ...(cookie.sameSite === undefined ? {} : { sameSite: cookie.sameSite }),
    sourceUrl
  };
}

function toElectronCookie(cookie: BrowserSessionStoredCookie): CookiesSetDetails {
  return {
    url: cookie.sourceUrl,
    name: cookie.name,
    value: cookie.value,
    ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    ...(cookie.expirationDate === undefined ? {} : { expirationDate: cookie.expirationDate }),
    ...(cookie.sameSite === undefined ? {} : { sameSite: cookie.sameSite })
  };
}

export class BrowserSessionService {
  private readonly activeProviders = new Set<BrowserSessionProviderId>();

  constructor(
    private readonly vault: BrowserSessionVault,
    private readonly temporaryDirectory: string = tmpdir()
  ) {}

  private async loadIntoPartition(providerId: BrowserSessionProviderId): Promise<Electron.Session> {
    const isolatedSession = session.fromPartition(partitionFor(providerId), { cache: false });
    // Rehydrate authentication from the encrypted vault on every operation,
    // while keeping the non-persistent partition's in-memory Flow project map
    // alive for the rest of this app run. `clear()` still removes all storage.
    await isolatedSession.clearStorageData({ storages: ['cookies'] });
    const existing = await this.vault.loadSecret(providerId);
    if (existing !== null) {
      for (const cookie of existing.cookies) {
        await isolatedSession.cookies.set(toElectronCookie(cookie));
      }
    }
    return isolatedSession;
  }

  private async persistPartition(providerId: BrowserSessionProviderId, isolatedSession: Electron.Session): Promise<void> {
    const policy = getBrowserSessionProviderPolicy(providerId);
    const collected = new Map<string, BrowserSessionStoredCookie>();
    for (const sourceUrl of policy.allowedNavigationOrigins) {
      const cookies = await isolatedSession.cookies.get({ url: sourceUrl });
      for (const cookie of cookies) {
        const stored = toStoredCookie(providerId, sourceUrl, cookie);
        if (stored !== null) collected.set(cookieKey(stored), stored);
      }
    }
    if (collected.size > 0) {
      await this.vault.save({
        version: 1,
        providerId,
        storedAt: new Date().toISOString(),
        cookies: [...collected.values()]
      });
    }
  }

  async getStatuses(): Promise<readonly BrowserSessionStatus[]> {
    return Promise.all(BROWSER_SESSION_PROVIDERS.map(async (providerId) => {
      if (this.activeProviders.has(providerId)) {
        const policy = getBrowserSessionProviderPolicy(providerId);
        return {
          providerId,
          kind: 'needs_user_action',
          origin: policy.applicationOrigin,
          reason: 'A sign-in window or background provider operation is active.'
        } satisfies BrowserSessionStatus;
      }
      return this.vault.getStatus(providerId);
    }));
  }

  async start(providerId: BrowserSessionProviderId): Promise<BrowserSessionStatus> {
    const policy = getBrowserSessionProviderPolicy(providerId);
    if (this.activeProviders.has(providerId)) {
      return {
        providerId,
        kind: 'needs_user_action',
        origin: policy.applicationOrigin,
        reason: 'A sign-in window is already open.'
      };
    }

    this.activeProviders.add(providerId);
    try {
      const isolatedSession = await this.loadIntoPartition(providerId);

      const loginWindow = new BrowserWindow({
        width: 1120,
        height: 820,
        minWidth: 720,
        minHeight: 560,
        title: `Sign in to ${policy.label}`,
        autoHideMenuBar: true,
        webPreferences: {
          partition: partitionFor(providerId),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          webSecurity: true,
          devTools: false
        }
      });

      const guardNavigation = (event: Electron.Event, url: string): void => {
        if (!isBrowserSessionNavigationAllowed(providerId, url)) event.preventDefault();
      };
      loginWindow.webContents.on('will-navigate', guardNavigation);
      loginWindow.webContents.on('will-redirect', guardNavigation);
      loginWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isBrowserSessionNavigationAllowed(providerId, url)) {
          void loginWindow.loadURL(url);
        }
        return { action: 'deny' };
      });

      await loginWindow.loadURL(policy.loginUrl);
      await new Promise<void>((resolve) => loginWindow.once('closed', resolve));

      const collected = new Map<string, BrowserSessionStoredCookie>();
      for (const sourceUrl of policy.allowedNavigationOrigins) {
        const cookies = await isolatedSession.cookies.get({ url: sourceUrl });
        for (const cookie of cookies) {
          const stored = toStoredCookie(providerId, sourceUrl, cookie);
          if (stored !== null) collected.set(cookieKey(stored), stored);
        }
      }

      if (collected.size === 0) {
        await this.vault.clear(providerId);
        return {
          providerId,
          kind: 'needs_user_action',
          origin: policy.applicationOrigin,
          reason: 'No provider session was found. Sign in and close the window only after the provider page has loaded.'
        };
      }

      return this.vault.save({
        version: 1,
        providerId,
        storedAt: new Date().toISOString(),
        cookies: [...collected.values()]
      });
    } finally {
      this.activeProviders.delete(providerId);
    }
  }

  /**
   * Generate through the normal Google Labs Flow application in a real
   * Chromium renderer which can be visible for observability. Cookie material remains inside the isolated Electron
   * session; automation sees only DOM geometry and the downloaded image.
   */
  async generateGoogleFlowImage(input: GoogleFlowImageGenerationInput): Promise<BrowserSessionGeneratedImage> {
    const providerId = 'gemini' as const;
    const policy = getBrowserSessionProviderPolicy(providerId);
    if (this.activeProviders.has(providerId)) {
      throw new Error('Google Flow is already being used by another browser-session operation. Wait for it to finish and retry.');
    }

    const requestId = randomUUID().slice(0, 8);
    const log = (event: string, details: Readonly<Record<string, unknown>> = {}): void => {
      const suffix = Object.keys(details).length === 0 ? '' : ` ${JSON.stringify(details)}`;
      console.info(`[OpenScene][Google Flow Image][${requestId}] ${event}${suffix}`);
    };
    const prompt = buildGoogleFlowImagePrompt(input);
    const projectName = normalizeGoogleFlowProjectName(input.projectName);
    const showBrowserWindow = input.showBrowserWindow !== false;
    const temporaryPath = join(this.temporaryDirectory, `openscene-flow-image-${requestId}.download`);
    let isolatedSession: Electron.Session | undefined;
    let automationWindow: BrowserWindow | undefined;
    let activeDownloadItem: DownloadItem | undefined;
    let downloadListener: ((event: Electron.Event, item: DownloadItem, webContents: WebContents) => void) | undefined;
    let downloadTimer: ReturnType<typeof setTimeout> | undefined;
    let downloadArmed = false;
    let operationSettled = false;
    let windowClosed: Promise<never> | undefined;

    this.activeProviders.add(providerId);
    log('request.start', {
      promptCharacters: prompt.length,
      aspectRatio: input.aspectRatio,
      timeoutSeconds: GOOGLE_FLOW_IMAGE_TIMEOUT_MS / 1_000,
      visible: showBrowserWindow,
      projectName: projectName ?? '',
      projectNameCharacters: projectName?.length ?? 0
    });

    try {
      const stored = await this.vault.loadSecret(providerId);
      if (stored === null || stored.cookies.length === 0) {
        throw new Error('No Google Flow browser session is stored. Open Settings, sign in to Google Flow, close that window, then retry.');
      }
      isolatedSession = await this.loadIntoPartition(providerId);
      automationWindow = new BrowserWindow({
        width: 1280,
        height: 900,
        show: showBrowserWindow,
        skipTaskbar: !showBrowserWindow,
        title: 'OpenScene Google Flow image worker',
        backgroundColor: '#101010',
        autoHideMenuBar: true,
        webPreferences: {
          partition: partitionFor(providerId),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          webSecurity: true,
          devTools: false,
          backgroundThrottling: false
        }
      });
      windowClosed = new Promise<never>((_resolve, reject) => {
        automationWindow!.once('closed', () => {
          if (operationSettled) return;
          log('browser.closed');
          reject(new Error('The Google Flow window was closed before image generation completed.'));
        });
      });
      void windowClosed.catch(() => undefined);

      const guardNavigation = (event: Electron.Event, url: string): void => {
        if (!isBrowserSessionNavigationAllowed(providerId, url)) event.preventDefault();
      };
      automationWindow.webContents.on('will-navigate', guardNavigation);
      automationWindow.webContents.on('will-redirect', guardNavigation);
      automationWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

      const download = new Promise<BrowserSessionGeneratedImage>((resolve, reject) => {
        downloadListener = (event, item, sourceWebContents) => {
          if (automationWindow === undefined || sourceWebContents.id !== automationWindow.webContents.id) return;
          if (!downloadArmed) {
            event.preventDefault();
            reject(new Error('Google Flow attempted an unexpected download before image generation completed.'));
            return;
          }
          downloadArmed = false;
          const declaredMime = item.getMimeType().toLowerCase();
          const filename = item.getFilename().toLowerCase();
          activeDownloadItem = item;
          item.setSavePath(temporaryPath);
          log('download.started', { declaredMime, filenameExtension: filename.split('.').pop() ?? '' });
          item.once('done', (_doneEvent, state) => {
            void (async () => {
              if (state !== 'completed') {
                reject(new Error(`Google Flow image download ${state}.`));
                return;
              }
              const bytes = await readFile(temporaryPath);
              if (bytes.length === 0 || bytes.length > MAX_BROWSER_IMAGE_BYTES) {
                reject(new Error('Google Flow returned an empty or unexpectedly large image download.'));
                return;
              }
              const mimeType = detectDownloadedImageMime(bytes);
              if (mimeType === null) {
                reject(new Error('Google Flow download was not a valid PNG, JPEG, or WebP image.'));
                return;
              }
              log('download.completed', { bytes: bytes.length, mimeType });
              resolve({ bytes, mimeType, providerJobId: `google-flow-browser-${requestId}` });
            })().catch((error: unknown) => {
              reject(error instanceof Error ? error : new Error('Google Flow image download could not be read.'));
            });
          });
        };
        isolatedSession!.on('will-download', downloadListener);
      });
      // Automation can fail before it reaches the download await. Attach a
      // rejection observer now so an early rejected download never becomes an
      // unhandled promise while the browser loop is still running.
      void download.catch(() => undefined);

      log('browser.loading', { origin: policy.applicationOrigin });
      await Promise.race([
        withTimeout(
          automationWindow.loadURL(policy.loginUrl),
          GOOGLE_FLOW_PAGE_LOAD_TIMEOUT_MS,
          'Google Flow did not finish loading within 60 seconds.'
        ),
        windowClosed
      ]);
      const generatedImageUrl = await Promise.race([
        automateGoogleFlowImageGeneration(automationWindow.webContents, {
          prompt,
          model: googleFlowImageModelFor(input.modelId),
          aspectRatio: input.aspectRatio,
          ...(projectName === undefined ? {} : { projectName }),
          timeoutMs: GOOGLE_FLOW_IMAGE_TIMEOUT_MS,
          onProgress: (stage, elapsedMs, details = {}) => log(`browser.${stage}`, {
            elapsedSeconds: Math.round(elapsedMs / 1_000),
            ...details
          })
        }),
        windowClosed
      ]);
      downloadArmed = true;
      automationWindow.webContents.downloadURL(generatedImageUrl);
      const downloadTimeout = new Promise<never>((_resolve, reject) => {
        downloadTimer = setTimeout(
          () => reject(new Error('Google Flow created an image, but its browser download did not finish within 60 seconds.')),
          GOOGLE_FLOW_DOWNLOAD_TIMEOUT_MS
        );
      });
      const result = await Promise.race([download, downloadTimeout, windowClosed]);
      operationSettled = true;
      log('request.completed');
      return result;
    } catch (error) {
      log('request.failed', { error: error instanceof Error ? error.message : 'unknown error' });
      throw error;
    } finally {
      operationSettled = true;
      if (downloadTimer !== undefined) clearTimeout(downloadTimer);
      if (isolatedSession !== undefined && downloadListener !== undefined) {
        isolatedSession.removeListener('will-download', downloadListener);
      }
      if (activeDownloadItem?.getState() === 'progressing') activeDownloadItem.cancel();
      if (isolatedSession !== undefined) {
        await this.persistPartition(providerId, isolatedSession).catch((error: unknown) => {
          log('session.persist.failed', { error: error instanceof Error ? error.message : 'unknown error' });
        });
      }
      if (automationWindow !== undefined && !automationWindow.isDestroyed()) automationWindow.destroy();
      await removeTemporaryDownload(temporaryPath);
      this.activeProviders.delete(providerId);
      log('cleanup.complete');
    }
  }

  async clear(providerId: BrowserSessionProviderId): Promise<BrowserSessionStatus> {
    if (this.activeProviders.has(providerId)) {
      const policy = getBrowserSessionProviderPolicy(providerId);
      return {
        providerId,
        kind: 'needs_user_action',
        origin: policy.applicationOrigin,
        reason: 'Close the active sign-in window before clearing this session.'
      };
    }
    await this.vault.clear(providerId);
    await session.fromPartition(partitionFor(providerId), { cache: false }).clearStorageData();
    return this.vault.getStatus(providerId);
  }
}
