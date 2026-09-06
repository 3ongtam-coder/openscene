import { describe, expect, it } from 'vitest';

import { browserSessionDiagnosticTarget } from '../src/shared/browserSession';

describe('browser session diagnostics', () => {
  it('logs only the origin and strips credentials, paths, queries, and fragments', () => {
    expect(browserSessionDiagnosticTarget('https://accounts.x.ai/sign-in/user@example.com?token=secret#code'))
      .toBe('https://accounts.x.ai');
  });

  it('identifies an opaque callback by protocol without logging its payload', () => {
    expect(browserSessionDiagnosticTarget('grok://callback?token=secret')).toBe('grok://opaque');
  });

  it('does not reflect invalid input into terminal diagnostics', () => {
    expect(browserSessionDiagnosticTarget('not a URL with a secret')).toBe('invalid-url');
  });
});
