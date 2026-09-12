import type { WebContents } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { automateGeminiImageGeneration, detectDownloadedImageMime } from '../src/main/geminiBrowserImageAutomation';

afterEach(() => {
  vi.useRealTimers();
});

describe('Gemini browser image download validation', () => {
  it('recognizes supported image signatures rather than trusting a filename', () => {
    expect(detectDownloadedImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(detectDownloadedImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectDownloadedImageMime(Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50
    ]))).toBe('image/webp');
  });

  it('rejects HTML and other non-image downloads', () => {
    expect(detectDownloadedImageMime(new TextEncoder().encode('<html>sign in</html>'))).toBeNull();
  });

  it('fills, submits, waits for a new result, and clicks its download control', async () => {
    vi.useFakeTimers();
    const input = { x: 10, y: 20, width: 100, height: 40 };
    const download = { x: 200, y: 300, width: 30, height: 30 };
    const executeJavaScript = vi.fn()
      .mockResolvedValueOnce({ url: 'https://gemini.google.com/app', input, downloadButtons: [] })
      .mockResolvedValueOnce({ url: 'https://gemini.google.com/app', input, downloadButtons: [download] });
    const insertText = vi.fn(async () => undefined);
    const sendInputEvent = vi.fn();
    const operation = automateGeminiImageGeneration({
      executeJavaScript,
      insertText,
      sendInputEvent
    } as unknown as WebContents, { prompt: 'Create a fox', timeoutMs: 10_000 });

    await vi.runAllTimersAsync();
    await operation;

    expect(insertText).toHaveBeenCalledWith('Create a fox');
    expect(sendInputEvent).toHaveBeenCalledWith({ type: 'keyDown', keyCode: 'ENTER' });
    expect(sendInputEvent).toHaveBeenCalledWith({
      type: 'mouseDown', x: 215, y: 315, button: 'left', clickCount: 1
    });
  });
});
