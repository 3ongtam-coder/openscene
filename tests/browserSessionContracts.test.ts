import { describe, expect, it } from 'vitest';

import {
  buildGeminiBrowserImagePrompt,
  getBrowserSessionProviderPolicy,
  isBrowserSessionCookieDomainAllowed,
  isBrowserSessionNavigationAllowed,
  parseBrowserSessionProviderId
} from '../src/shared/browserSession';

describe('browser session shared boundary', () => {
  it('accepts only known provider identifiers', () => {
    expect(parseBrowserSessionProviderId('gemini')).toBe('gemini');
    expect(parseBrowserSessionProviderId('grok')).toBe('grok');
    expect(parseBrowserSessionProviderId('google')).toBeNull();
    expect(parseBrowserSessionProviderId({ providerId: 'gemini' })).toBeNull();
  });

  it('uses exact HTTPS origins instead of wildcard navigation', () => {
    expect(isBrowserSessionNavigationAllowed('gemini', 'https://gemini.google.com/app')).toBe(true);
    expect(isBrowserSessionNavigationAllowed('gemini', 'https://accounts.google.com/v3/signin')).toBe(true);
    expect(isBrowserSessionNavigationAllowed('gemini', 'http://gemini.google.com/app')).toBe(false);
    expect(isBrowserSessionNavigationAllowed('gemini', 'https://evil.google.com')).toBe(false);
    expect(isBrowserSessionNavigationAllowed('grok', 'https://grok.com')).toBe(true);
    expect(isBrowserSessionNavigationAllowed('grok', 'https://grok.com.evil.example')).toBe(false);
  });

  it('accepts only cookie domains applicable to an allowed origin', () => {
    expect(isBrowserSessionCookieDomainAllowed('gemini', '.google.com')).toBe(true);
    expect(isBrowserSessionCookieDomainAllowed('gemini', 'gemini.google.com')).toBe(true);
    expect(isBrowserSessionCookieDomainAllowed('gemini', 'youtube.com')).toBe(false);
    expect(isBrowserSessionCookieDomainAllowed('grok', '.x.com')).toBe(true);
    expect(isBrowserSessionCookieDomainAllowed('grok', 'ads.x.com')).toBe(false);
  });

  it('keeps the official application origin separate from login redirect origins', () => {
    expect(getBrowserSessionProviderPolicy('gemini').applicationOrigin).toBe('https://gemini.google.com');
    expect(getBrowserSessionProviderPolicy('grok').applicationOrigin).toBe('https://grok.com');
  });

  it('builds a complete image request for the browser UI without dropping controls', () => {
    expect(buildGeminiBrowserImagePrompt({
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
});
