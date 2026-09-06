import { BrowserWindow, session, type Cookie, type CookiesSetDetails, type Session, type WebRequestFilter } from 'electron';

import {
  BROWSER_SESSION_PROVIDERS,
  browserSessionDiagnosticTarget,
  getBrowserSessionProviderPolicy,
  isBrowserSessionCookieDomainAllowed,
  isBrowserSessionNavigationAllowed,
  type BrowserSessionProviderId,
  type BrowserSessionStatus
} from '../shared/browserSession';
import { BrowserSessionVault, type BrowserSessionStoredCookie } from './browserSessionVault';

const PARTITION_PREFIX = 'ai-video-studio-browser-session';
const SIGN_IN_PROGRESS_LOG_MS = 45_000;

function logBrowserSession(
  providerId: BrowserSessionProviderId,
  event: string,
  details: Readonly<Record<string, unknown>> = {},
  level: 'info' | 'error' = 'info'
): void {
  const suffix = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : '';
  console[level](`[OpenScene][Browser Session][${providerId}] ${event}${suffix}`);
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
  private readonly instrumentedSessions = new WeakSet<Session>();

  constructor(private readonly vault: BrowserSessionVault) {}

  async getStatuses(): Promise<readonly BrowserSessionStatus[]> {
    return Promise.all(BROWSER_SESSION_PROVIDERS.map(async (providerId) => {
      if (this.activeProviders.has(providerId)) {
        const policy = getBrowserSessionProviderPolicy(providerId);
        return {
          providerId,
          kind: 'needs_user_action',
          origin: policy.applicationOrigin,
          reason: 'Finish signing in in the isolated browser window, then close it.'
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
      const isolatedSession = session.fromPartition(partitionFor(providerId), { cache: false });
      await isolatedSession.clearStorageData();
      this.instrumentSession(providerId, isolatedSession);
      const existing = await this.vault.loadSecret(providerId);
      if (existing !== null) {
        for (const cookie of existing.cookies) {
          await isolatedSession.cookies.set(toElectronCookie(cookie));
        }
      }

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
        const target = browserSessionDiagnosticTarget(url);
        if (!isBrowserSessionNavigationAllowed(providerId, url)) {
          logBrowserSession(providerId, 'navigation.blocked', { target }, 'error');
          event.preventDefault();
          return;
        }
        logBrowserSession(providerId, 'navigation.allowed', { target });
      };
      loginWindow.webContents.on('will-navigate', guardNavigation);
      loginWindow.webContents.on('will-redirect', guardNavigation);
      loginWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (isBrowserSessionNavigationAllowed(providerId, url)) {
          logBrowserSession(providerId, 'popup.redirected', { target: browserSessionDiagnosticTarget(url) });
          void loginWindow.loadURL(url);
        } else {
          logBrowserSession(providerId, 'popup.blocked', { target: browserSessionDiagnosticTarget(url) }, 'error');
        }
        return { action: 'deny' };
      });
      loginWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
        if (!isMainFrame || errorCode === -3) return;
        logBrowserSession(providerId, 'page.failed', {
          errorCode,
          error: errorDescription.slice(0, 300),
          target: browserSessionDiagnosticTarget(validatedUrl)
        }, 'error');
      });
      loginWindow.webContents.on('render-process-gone', (_event, details) => {
        logBrowserSession(providerId, 'renderer.gone', { reason: details.reason, exitCode: details.exitCode }, 'error');
      });
      loginWindow.on('unresponsive', () => logBrowserSession(providerId, 'window.unresponsive', {}, 'error'));

      logBrowserSession(providerId, 'window.opening', { target: browserSessionDiagnosticTarget(policy.loginUrl) });
      await loginWindow.loadURL(policy.loginUrl);
      logBrowserSession(providerId, 'page.loaded', { target: browserSessionDiagnosticTarget(loginWindow.webContents.getURL()) });
      const progressTimer = setTimeout(() => {
        if (!loginWindow.isDestroyed()) {
          logBrowserSession(providerId, 'signin.still-open', {
            target: browserSessionDiagnosticTarget(loginWindow.webContents.getURL()),
            guidance: 'If the provider button is still spinning, close this window and inspect request.failed or navigation.blocked logs.'
          }, 'error');
        }
      }, SIGN_IN_PROGRESS_LOG_MS);
      await new Promise<void>((resolve) => loginWindow.once('closed', resolve));
      clearTimeout(progressTimer);
      logBrowserSession(providerId, 'window.closed');

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

  private instrumentSession(providerId: BrowserSessionProviderId, isolatedSession: Session): void {
    if (this.instrumentedSessions.has(isolatedSession)) return;
    this.instrumentedSessions.add(isolatedSession);
    const policy = getBrowserSessionProviderPolicy(providerId);
    const urls = [
      ...policy.allowedNavigationOrigins.map((origin) => `${origin}/*`),
      ...(providerId === 'grok' ? ['https://api.x.ai/*', 'https://challenges.cloudflare.com/*'] : [])
    ];
    const filter: WebRequestFilter = { urls, types: ['mainFrame', 'subFrame', 'xhr'] };
    isolatedSession.webRequest.onCompleted(filter, (details) => {
      if (details.statusCode < 400) return;
      logBrowserSession(providerId, 'request.failed', {
        method: details.method,
        status: details.statusCode,
        resourceType: details.resourceType,
        target: browserSessionDiagnosticTarget(details.url)
      }, 'error');
    });
    isolatedSession.webRequest.onErrorOccurred(filter, (details) => {
      logBrowserSession(providerId, 'request.error', {
        method: details.method,
        error: details.error.slice(0, 300),
        resourceType: details.resourceType,
        target: browserSessionDiagnosticTarget(details.url)
      }, 'error');
    });
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
