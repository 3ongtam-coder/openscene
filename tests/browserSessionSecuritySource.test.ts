import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const readRepo = (path: string): Promise<string> => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

describe('browser session security wiring', () => {
  it('keeps cookie payload types in main and exposes only status/actions through preload', async () => {
    const [preload, handler, service] = await Promise.all([
      readRepo('src/preload/index.ts'),
      readRepo('src/main/registerBrowserSessionIpcHandlers.ts'),
      readRepo('src/main/browserSessionService.ts')
    ]);

    const publicLines = preload.split('\n').filter((line) => line.includes('BrowserSession')).join('\n');
    expect(publicLines).toContain('BrowserSessionStatus');
    expect(publicLines).toContain('BrowserSessionProviderId');
    expect(publicLines).not.toMatch(/Cookie|domain|profilePath/);
    expect(handler).toContain('parseBrowserSessionProviderId(payload)');
    expect(handler).not.toContain('cookies.set');
    expect(service).toContain('No `persist:` prefix');
    expect(service).toContain('contextIsolation: true');
    expect(service).toContain('sandbox: true');
    expect(service).toContain('nodeIntegration: false');
    expect(service).toContain('devTools: false');
    expect(service).toContain("clearStorageData({ storages: ['cookies'] })");
  });

  it('shows desktop controls while mobile clearly disables the unsupported lane', async () => {
    const [desktop, mobile] = await Promise.all([
      readRepo('src/renderer/src/BrowserSessionSettings.tsx'),
      readRepo('mobile/src/screens/SettingsScreen.tsx')
    ]);
    expect(desktop).toContain('window.videoTool.startBrowserSession(providerId)');
    expect(desktop).toContain('window.videoTool.clearBrowserSession(providerId)');
    expect(desktop).toContain("does not read another browser's profile");
    expect(desktop).toContain('Show Google Flow while generating');
    expect(mobile).toContain('browser-session sign-in is desktop-only');
    expect(mobile).toContain('Keychain or Keystore');
  });

  it('runs Google Flow image automation inside the isolated browser without replaying cookies over HTTP', async () => {
    const [service, automation, studio, mobile] = await Promise.all([
      readRepo('src/main/browserSessionService.ts'),
      readRepo('src/main/googleFlowImageAutomation.ts'),
      readRepo('src/renderer/src/ImageGenerationWorkspace.tsx'),
      readRepo('mobile/src/screens/ImageScreen.tsx')
    ]);
    expect(service).toContain('show: showBrowserWindow');
    expect(service).toContain("The Google Flow window was closed before image generation completed.");
    expect(service).toContain("partition: partitionFor(providerId)");
    expect(service).toContain("isolatedSession!.on('will-download'");
    expect(service).not.toMatch(/fetch\(|batchexecute|StreamGenerate/);
    expect(automation).toContain("a[href*=\"/fx/tools/flow/project/\"]");
    expect(automation).toContain("button, [role=\"button\"], a, [tabindex=\"0\"]");
    expect(automation).toContain('projectCandidates');
    expect(automation).toContain('flowNewProject');
    expect(automation).toContain("'[contenteditable]:not([contenteditable=\"false\"]), textarea, [role=\"textbox\"]'");
    expect(automation).toContain("regular button (for example \"Video 720p 8s x2\")");
    expect(automation).toContain("'[role=\"tab\"], [role=\"radio\"], button'");
    expect(automation).toContain('inputFound: state.input !== undefined');
    expect(automation).toContain('configFound: state.configButton !== undefined');
    expect(automation).toContain('/generate|create|submit|send/i.test(aria)');
    expect(automation).toContain('projectTitleMenu');
    expect(automation).toContain('renameProjectEntry');
    expect(automation).toContain("'iframe[src*=\"recaptcha\"]'");
    expect(automation).toContain('const challengeElement = visible([');
    expect(automation).toContain("style.opacity !== '0'");
    expect(automation).not.toContain("'[data-sitekey]'");
    expect(automation).not.toContain("/captcha|verify it");
    expect(service).toContain("navigationError.code === 'ERR_ABORTED'");
    expect(service).toContain('isBrowserSessionNavigationAllowed(providerId, currentUrl)');
    expect(automation).toContain('webContents.insertText(prompt)');
    expect(automation).toContain("'Nano Banana 2'");
    expect(service).toContain('webContents.downloadURL(generatedImageUrl)');
    expect(studio).toContain("mode: generationMode");
    expect(studio).toContain('Opening the signed-in Google Flow window');
    expect(studio).toContain('showBrowserWindow: flowWindowVisible');
    expect(studio).toContain('flowProjectName');
    expect(mobile).toContain('Signed-in Google Flow automation is desktop-only');
  });
});
