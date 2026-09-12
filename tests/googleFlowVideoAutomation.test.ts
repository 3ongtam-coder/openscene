import type { WebContents } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  automateGoogleFlowVideoGeneration,
  detectDownloadedMp4,
  validateGoogleFlowVideoAutomationInput
} from '../src/main/googleFlowVideoAutomation';

const FIRST_FRAME = { displayName: 'first.png', mimeType: 'image/png', base64: 'FIRST' } as const;
const LAST_FRAME = { displayName: 'last.png', mimeType: 'image/png', base64: 'LAST' } as const;

afterEach(() => vi.useRealTimers());

describe('Google Flow browser video automation', () => {
  it('recognizes MP4 family signatures instead of trusting a filename or MIME header', () => {
    expect(detectDownloadedMp4(Uint8Array.from([
      0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d
    ]))).toBe(true);
    expect(detectDownloadedMp4(Uint8Array.from([
      0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32
    ]))).toBe(true);
    expect(detectDownloadedMp4(new TextEncoder().encode('<html>sign in</html>'))).toBe(false);
  });

  it('accepts current Omni and Veo Flow controls', () => {
    expect(() => validateGoogleFlowVideoAutomationInput({
      model: 'omni-1.1-flash', operation: 'text_to_video', aspectRatio: '9:16', durationSeconds: 10
    })).not.toThrow();
    expect(() => validateGoogleFlowVideoAutomationInput({
      model: 'veo-3.1-quality', operation: 'start_end', aspectRatio: '16:9', durationSeconds: 8,
      referenceImage: FIRST_FRAME, lastFrame: LAST_FRAME
    })).not.toThrow();
  });

  it('rejects controls the visible Flow video product cannot faithfully execute', () => {
    expect(() => validateGoogleFlowVideoAutomationInput({
      model: 'veo-3.1-fast', operation: 'text_to_video', aspectRatio: '16:9', durationSeconds: 6
    })).toThrow(/exposes 8 second/);
    expect(() => validateGoogleFlowVideoAutomationInput({
      model: 'omni-1.1-flash', operation: 'text_to_video', aspectRatio: '1:1', durationSeconds: 4
    })).toThrow(/only 16:9 or 9:16/);
    expect(() => validateGoogleFlowVideoAutomationInput({
      model: 'omni-1.1-flash', operation: 'video_extend', aspectRatio: '16:9', durationSeconds: 4
    })).toThrow(/does not support video_extend/);
    expect(() => validateGoogleFlowVideoAutomationInput({
      model: 'veo-3.1-quality', operation: 'start_end', aspectRatio: '16:9', durationSeconds: 8,
      referenceImage: FIRST_FRAME
    })).toThrow(/requires a last frame/);
    expect(() => validateGoogleFlowVideoAutomationInput({
      model: 'veo-3.1-quality', operation: 'reference_to_video', aspectRatio: '16:9', durationSeconds: 8,
      referenceImages: []
    })).toThrow(/at least one component image/);
  });

  it('configures an exact Veo model, fills the prompt, submits, and returns only a new video URL', async () => {
    vi.useFakeTimers();
    const input = { x: 10, y: 700, width: 300, height: 50 };
    const config = { x: 20, y: 800, width: 300, height: 40 };
    const agentToggle = { x: 860, y: 805, width: 90, height: 32 };
    const submit = { x: 1100, y: 800, width: 40, height: 40 };
    const oldVideo = { rectangle: { x: 10, y: 10, width: 400, height: 225 }, src: 'blob:https://flow.google.com/old' };
    const newVideo = { rectangle: { x: 420, y: 10, width: 400, height: 225 }, src: 'blob:https://flow.google.com/new' };
    const selectedTabs = [
      { rectangle: { x: 1, y: 1, width: 20, height: 20 }, text: 'Video', selected: true },
      { rectangle: { x: 2, y: 2, width: 20, height: 20 }, text: 'Frames', selected: true },
      { rectangle: { x: 3, y: 3, width: 20, height: 20 }, text: '16:9', selected: true },
      { rectangle: { x: 4, y: 4, width: 20, height: 20 }, text: 'x1', selected: true }
    ];
    const state = {
      url: 'https://flow.google.com/project/example', input,
      configButton: { rectangle: config, text: 'Veo 3.1 - Quality Video 720p 8 seconds x1' },
      tabs: selectedTabs, menuItems: [], videos: [oldVideo]
    };
    const executeJavaScript = vi.fn()
      .mockResolvedValueOnce({
        ...state,
        agentToggle: { rectangle: agentToggle, text: 'Tác nhân', selected: true }
      })
      .mockResolvedValueOnce(state)
      .mockResolvedValueOnce(state)
      .mockResolvedValueOnce(state)
      .mockResolvedValueOnce(state)
      .mockResolvedValueOnce(state)
      .mockResolvedValueOnce(state)
      .mockResolvedValueOnce(state)
      .mockResolvedValueOnce({ ...state, submit })
      .mockResolvedValueOnce({ ...state, submit, videos: [oldVideo, newVideo] });
    const insertText = vi.fn(async () => undefined);
    const sendInputEvent = vi.fn();
    const operation = automateGoogleFlowVideoGeneration({
      executeJavaScript, insertText, sendInputEvent
    } as unknown as WebContents, {
      prompt: 'Create a dawn aerial shot', model: 'veo-3.1-quality', operation: 'text_to_video',
      aspectRatio: '16:9', durationSeconds: 8, timeoutMs: 10_000
    });

    await vi.runAllTimersAsync();
    await expect(operation).resolves.toBe(newVideo.src);
    expect(insertText).toHaveBeenCalledWith('Create a dawn aerial shot');
    expect(sendInputEvent).toHaveBeenCalledWith({
      type: 'mouseDown', x: 905, y: 821, button: 'left', clickCount: 1
    });
    expect(sendInputEvent).toHaveBeenCalledWith({
      type: 'mouseDown', x: 1120, y: 820, button: 'left', clickCount: 1
    });
  });
});
