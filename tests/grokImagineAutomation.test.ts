import { describe, expect, it } from 'vitest';

import { buildGrokImagineStateProbeScript } from '../src/main/grokImagineAutomation';

describe('Grok Imagine browser automation contract', () => {
  it('uses visible public controls and does not contain a private provider endpoint', () => {
    const script = buildGrokImagineStateProbeScript();
    expect(script).toContain('ask grok');
    expect(script).toContain('Hình ảnh');
    expect(script).toContain('Video');
    expect(script).toContain('Gửi');
    expect(script).not.toContain('/api/');
    expect(script).not.toContain('fetch(');
    expect(script).not.toContain('XMLHttpRequest');
  });
});
