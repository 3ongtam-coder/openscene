import { describe, expect, it } from 'vitest';

import {
  buildGoogleFlowImagePrompt,
  DEFAULT_GOOGLE_FLOW_PREFERENCES,
  GOOGLE_FLOW_PREFERENCES_STORAGE_KEY,
  googleFlowImageModelFor,
  getBrowserSessionProviderPolicy,
  isBrowserSessionCookieDomainAllowed,
  isBrowserSessionCookieSourceAllowed,
  isBrowserSessionNavigationAllowed,
  normalizeGoogleFlowProjectName,
  parseGoogleFlowPreferences,
  parseBrowserSessionProviderId,
  serializeGoogleFlowPreferences
} from '../src/shared/browserSession';

describe('browser session shared boundary', () => {
  it('accepts only known provider identifiers', () => {
    expect(parseBrowserSessionProviderId('gemini')).toBe('gemini');
    expect(parseBrowserSessionProviderId('grok')).toBe('grok');
    expect(parseBrowserSessionProviderId('google')).toBeNull();
    expect(parseBrowserSessionProviderId({ providerId: 'gemini' })).toBeNull();
  });

  it('uses exact HTTPS origins instead of wildcard navigation', () => {
    expect(isBrowserSessionNavigationAllowed('gemini', 'https://labs.google/fx/tools/flow')).toBe(true);
    expect(isBrowserSessionNavigationAllowed('gemini', 'https://flow.google.com/')).toBe(true);
    expect(isBrowserSessionNavigationAllowed('gemini', 'https://flow.google.com.evil.example/')).toBe(false);
    expect(isBrowserSessionNavigationAllowed('gemini', 'https://gemini.google.com/app')).toBe(false);
    expect(isBrowserSessionNavigationAllowed('gemini', 'https://accounts.google.com/v3/signin')).toBe(true);
    expect(isBrowserSessionNavigationAllowed('gemini', 'http://labs.google/fx/tools/flow')).toBe(false);
    expect(isBrowserSessionNavigationAllowed('gemini', 'https://evil.google.com')).toBe(false);
    expect(isBrowserSessionCookieSourceAllowed('gemini', 'https://gemini.google.com/app')).toBe(true);
    expect(isBrowserSessionCookieSourceAllowed('gemini', 'https://flow.google.com/')).toBe(true);
    expect(isBrowserSessionNavigationAllowed('grok', 'https://grok.com')).toBe(true);
    expect(isBrowserSessionNavigationAllowed('grok', 'https://grok.com.evil.example')).toBe(false);
  });

  it('accepts only cookie domains applicable to an allowed origin', () => {
    expect(isBrowserSessionCookieDomainAllowed('gemini', '.google.com')).toBe(true);
    expect(isBrowserSessionCookieDomainAllowed('gemini', 'gemini.google.com')).toBe(true);
    expect(isBrowserSessionCookieDomainAllowed('gemini', 'flow.google.com')).toBe(true);
    expect(isBrowserSessionCookieDomainAllowed('gemini', 'youtube.com')).toBe(false);
    expect(isBrowserSessionCookieDomainAllowed('grok', '.x.com')).toBe(true);
    expect(isBrowserSessionCookieDomainAllowed('grok', 'ads.x.com')).toBe(false);
  });

  it('keeps the official application origin separate from login redirect origins', () => {
    expect(getBrowserSessionProviderPolicy('gemini').applicationOrigin).toBe('https://labs.google');
    expect(getBrowserSessionProviderPolicy('gemini').loginUrl).toBe('https://labs.google/fx/tools/flow');
    expect(getBrowserSessionProviderPolicy('grok').applicationOrigin).toBe('https://grok.com');
  });

  it('builds a complete image request for the browser UI without dropping controls', () => {
    expect(buildGoogleFlowImagePrompt({
      prompt: 'A red apple on a dark table',
      aspectRatio: '16:9',
      stylePreset: 'Cinematic',
      negativePrompt: 'text, watermark'
    })).toBe([
      'Create one image (do not answer with only text).',
      'A red apple on a dark table',
      'Use a 16:9 aspect ratio.',
      'Visual style: Cinematic.',
      'Do not include: text, watermark.'
    ].join('\n'));
  });

  it('maps API catalog choices onto the image models Google Flow exposes', () => {
    expect(googleFlowImageModelFor('gemini-3.1-flash-image')).toBe('nano-banana-2');
    expect(googleFlowImageModelFor('gemini-3.1-flash-lite-image')).toBe('nano-banana-2');
    expect(googleFlowImageModelFor('gemini-3-pro-image')).toBe('nano-banana-pro');
    expect(googleFlowImageModelFor('gemini-2.5-flash-image')).toBe('nano-banana-2');
  });

  it('keeps the visible Flow worker default safe when its renderer preference is missing or malformed', () => {
    expect(GOOGLE_FLOW_PREFERENCES_STORAGE_KEY).toBe('openvideo-google-flow-preferences-v1');
    expect(parseGoogleFlowPreferences(null)).toEqual(DEFAULT_GOOGLE_FLOW_PREFERENCES);
    expect(parseGoogleFlowPreferences('{')).toEqual(DEFAULT_GOOGLE_FLOW_PREFERENCES);
    const hidden = { schemaVersion: 1 as const, showWindowDuringGeneration: false };
    expect(parseGoogleFlowPreferences(serializeGoogleFlowPreferences(hidden))).toEqual(hidden);
  });

  it('normalizes a local folder label before mirroring it into Flow', () => {
    expect(normalizeGoogleFlowProjectName('  My   Film\u0000  ')).toBe('My Film');
    expect(normalizeGoogleFlowProjectName('   ')).toBeUndefined();
    expect(normalizeGoogleFlowProjectName(undefined)).toBeUndefined();
  });
});
