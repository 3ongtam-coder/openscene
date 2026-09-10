import type { WebContents } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  automateGoogleFlowImageGeneration,
  buildGoogleFlowStateProbeScript,
  detectDownloadedImageMime,
  flowOrientationForAspectRatio
} from '../src/main/googleFlowImageAutomation';

afterEach(() => {
  vi.useRealTimers();
});

describe('Google Flow browser image automation', () => {
  it('emits syntactically valid JavaScript for the live Flow DOM probe', () => {
    expect(() => new Function(buildGoogleFlowStateProbeScript())).not.toThrow();
  });

  it('recognizes supported image signatures rather than trusting a filename', () => {
    expect(detectDownloadedImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(detectDownloadedImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectDownloadedImageMime(Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50
    ]))).toBe('image/webp');
    expect(detectDownloadedImageMime(new TextEncoder().encode('<html>sign in</html>'))).toBeNull();
  });

  it('maps exact ratios onto the coarse orientation available in Flow', () => {
    expect(flowOrientationForAspectRatio('16:9')).toBe('Landscape');
    expect(flowOrientationForAspectRatio('1:1')).toBe('Square');
    expect(flowOrientationForAspectRatio('9:16')).toBe('Portrait');
    expect(flowOrientationForAspectRatio('3:4')).toBe('Portrait');
  });

  it('configures Image x1, fills the prompt, submits, and returns only a new result URL', async () => {
    vi.useFakeTimers();
    const input = { x: 10, y: 700, width: 300, height: 50 };
    const config = { x: 20, y: 800, width: 260, height: 40 };
    const submit = { x: 1100, y: 800, width: 40, height: 40 };
    const oldImage = { rectangle: { x: 10, y: 10, width: 400, height: 300 }, src: 'https://labs.google/fx/api/old' };
    const newImage = { rectangle: { x: 420, y: 10, width: 400, height: 300 }, src: 'https://labs.google/fx/api/new' };
    const selectedTabs = [
      { rectangle: { x: 1, y: 1, width: 20, height: 20 }, text: 'Image', selected: true },
      { rectangle: { x: 2, y: 2, width: 20, height: 20 }, text: 'Landscape', selected: true },
      { rectangle: { x: 3, y: 3, width: 20, height: 20 }, text: 'x1', selected: true }
    ];
    const editorState = {
      url: 'https://labs.google/fx/tools/flow/project/example', input,
      configButton: { rectangle: config, text: 'Video 720p 8s x2' },
      tabs: [], menuItems: [], submit, images: [oldImage]
    };
    const panelState = {
      ...editorState,
      configButton: { rectangle: config, text: 'Nano Banana 2 Landscape x1' },
      tabs: selectedTabs
    };
    const executeJavaScript = vi.fn()
      .mockResolvedValueOnce(editorState)
      .mockResolvedValueOnce(panelState)
      .mockResolvedValueOnce(panelState)
      .mockResolvedValueOnce(panelState)
      .mockResolvedValueOnce(panelState)
      .mockResolvedValueOnce(editorState)
      .mockResolvedValueOnce({ ...editorState, images: [oldImage, newImage] });
    const insertText = vi.fn(async () => undefined);
    const sendInputEvent = vi.fn();
    const operation = automateGoogleFlowImageGeneration({
      executeJavaScript,
      insertText,
      sendInputEvent
    } as unknown as WebContents, {
      prompt: 'Create a fox', model: 'nano-banana-2', aspectRatio: '16:9', timeoutMs: 10_000
    });

    await vi.runAllTimersAsync();
    await expect(operation).resolves.toBe(newImage.src);
    expect(insertText).toHaveBeenCalledWith('Create a fox');
    expect(sendInputEvent).toHaveBeenCalledWith({
      type: 'mouseDown', x: 1120, y: 820, button: 'left', clickCount: 1
    });
  });
});
