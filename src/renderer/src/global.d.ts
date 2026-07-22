import type { VideoToolApi } from '../../preload';

declare global {
  interface Window {
    videoTool: VideoToolApi;
  }
}

export {};
