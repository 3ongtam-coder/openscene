# Window Loom

Window Loom is an Electron + TypeScript + React + Vite MVP for recording one selected desktop window to a local WebM file and arranging local media in a project timeline. It follows the product contract in `docs/planning.md`: selected-window capture, local project and asset storage, timeline editing, and future Gemini Veo, OpenAI Sora, and ElevenLabs support left as provider seams.

## What Works Now

- Lists capturable desktop windows through Electron `desktopCapturer` in the main process.
- Treats source lists as generations, so a refresh invalidates old selections.
- Uses a secure main/preload/renderer split with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
- Exposes only a narrow typed `window.videoTool` API from preload; raw `ipcRenderer` is not exposed.
- Lets the renderer request `getDisplayMedia`, while the main process grants only the currently selected source through `setDisplayMediaRequestHandler`.
- Streams `MediaRecorder` chunks to the main process every second and writes them incrementally to disk.
- Saves WebM files under Electron user data: `recordings/`.
- Shows source selection, preview, record/pause/resume/stop, elapsed time, state, result metadata, open, and reveal actions.
- Creates local projects with imported local assets.
- Stores project data locally, including assets, tracks, clips, and timeline metadata.
- Supports timeline tracks and clips for local editing.
- Supports clip trim, split, and delete actions in the timeline.
- Stores clip opacity, scale, position, rotation, volume, keyframes, transitions, and audio track mix settings locally.
- Shows playhead movement and a local preview surface for timeline review, including best-effort keyframe, transition, and audio mix evaluation.
- Exports saved local project timelines to MP4 with H.264 video and AAC audio through a local FFmpeg runtime.
- Stores local voice reference samples only after explicit consent and supports deleting the saved local voice profile.
- Can start local `local_qwen` TTS jobs when a local wrapper is configured through `VIDEO_TOOL_TTS_CONFIG_PATH`.

## Prerequisites

- Node.js 22 or newer.
- npm 10 or newer.
- macOS Screen Recording permission for the terminal or packaged app that launches Electron.
- FFmpeg for MP4 export. Set `VIDEO_TOOL_FFMPEG_PATH` to an absolute executable path, or make `ffmpeg` discoverable from an absolute directory on `PATH`.

## Install

```bash
npm install
```

## Development

```bash
npm run dev
```

On first capture attempt, macOS may block the preview until permission is granted.

## macOS Screen Recording Permission

1. Open System Settings.
2. Go to Privacy & Security.
3. Open Screen & System Audio Recording.
4. Enable the terminal app you use for `npm run dev`, or enable the packaged Window Loom app.
5. Quit and relaunch the terminal or app after changing permission.
6. Press Refresh in Window Loom and select the target window again.

Automated tests cannot grant this permission, so real capture must be manually verified on macOS.

## Verify

```bash
npm run typecheck
npm test
npm run build
```

## Build Output

```bash
npm run build
```

The command compiles the Electron main process, preload, and React renderer into `out/`. It does not package an installer or auto-updater.

## Recording Storage

By default, recordings are written to:

```text
<Electron userData>/recordings
```

For development, you can override this with:

```bash
VIDEO_TOOL_RECORDINGS_DIR=/absolute/path/to/recordings npm run dev
```

## Local Project And Timeline Storage

Timeline editing is local-only in this MVP. Projects keep imported assets, tracks, clips, trim ranges, split results, deletes, clip effects, keyframes, transitions, audio track mix settings, playhead position, and preview state in the local app storage path. Clip effects cover opacity, scale, position, rotation, and volume. They persist through timeline undo/redo, save, and reopen. The app does not upload projects or assets to a cloud service.

Implemented local editing covers project creation, asset import, track and clip arrangement, trim, split, delete, clip effects, keyframes, transitions, audio track mix settings, playhead movement, and the single active Program Monitor preview. Program Monitor is a best-effort renderer evaluation surface for review; the FFmpeg export path is the authoritative local output for supported saved timeline state.

## Local MP4 Export

Window Loom can export the currently saved local project timeline to an app-owned MP4 result. Export uses a local FFmpeg executable only and renders H.264 video with AAC audio in an MP4 container. The renderer starts, polls, cancels, opens, and reveals exports through typed `window.videoTool` job actions; it does not receive output paths, FFmpeg executable paths, or FFmpeg argv.

FFmpeg discovery is explicit and local. Set `VIDEO_TOOL_FFMPEG_PATH=/absolute/path/to/ffmpeg` to pin an executable, or ensure `ffmpeg` is available from an absolute directory listed in `PATH`. Relative configured paths are rejected. If FFmpeg is unavailable, export controls report the local runtime problem and do not start a job.

Export boundaries are intentionally narrow: MP4 H.264/AAC is the only implemented final export format, exports run locally, partial outputs are discarded on failure or cancel, and no cloud render/export path exists.

## 로컬 Qwen 음성 프로필과 TTS 설정

로컬 음성 프로필과 Qwen TTS는 현재 로컬 audio asset 확장입니다. 창 선택, WebM 녹화, 로컬 project timeline editing은 MVP의 핵심 범위입니다. TTS는 녹화 기능을 대체하지 않고, 사용자가 명시적으로 저장한 로컬 voice sample을 사용해 별도 audio asset을 만드는 흐름입니다.

자세한 한국어 설정 문서는 [`docs/local-qwen-voice-profiles.md`](docs/local-qwen-voice-profiles.md)에 있습니다. 안전한 placeholder 설정 예시는 [`docs/local-qwen-tts-config.example.json`](docs/local-qwen-tts-config.example.json)을 참고합니다.

핵심 설정은 다음과 같습니다.

- `VIDEO_TOOL_TTS_CONFIG_PATH`는 로컬 TTS JSON 설정 파일의 절대 경로입니다.
- 앱은 Qwen 모델이나 runtime을 다운로드하지 않습니다.
- `Qwen/Qwen3-TTS-12Hz-1.7B-Base`를 대상으로 하는 로컬 wrapper가 먼저 준비돼 있어야 합니다.
- `executablePath`, `modelPath`, `workingDirectory`, `VIDEO_TOOL_TTS_CONFIG_PATH` 값은 절대 경로여야 합니다.
- `argsTemplate`에는 `{modelPath}`, `{voiceSamplePath}`, `{textPath}`, `{outputPath}` 토큰이 반드시 들어가야 하며, `{language}`도 쓸 수 있습니다.
- 참고 음성은 본인 또는 권한을 받은 사람의 10초에서 30초 정도의 선명한 샘플만 사용해야 합니다.
- 저장된 voice profile을 삭제하면 해당 profile 디렉터리와 sample metadata가 로컬에서 제거됩니다. 진행 중인 sample은 discard로 버릴 수 있습니다.
- Qwen runtime의 GPU VRAM, 메모리, 지연 시간 요구사항은 wrapper와 모델 runtime에 따라 달라집니다. 1.7B급 모델 실행이 가능한 로컬 ML 환경을 사전 요구사항으로 보고 수동 검증해야 합니다.

Reference 경계도 명확합니다. Voicebox는 로컬 profile workflow를 설계할 때의 참고 자료입니다. OpenCut은 local-first asset과 timeline UX 방향을 보는 inspiration일 뿐이며, 현재 rewrite는 OpenCut 코드나 dependency를 사용하지 않습니다. 이 저장소는 두 프로젝트의 코드를 복사했다고 주장하지 않습니다.

## Current Limitations

- Window capture only. Full-screen capture is intentionally out of scope.
- No microphone or system-audio capture is mixed into the selected-window recorder. Microphone access is used only in the explicit local voice-profile sample workflow.
- No cloud upload, analytics, account system, auto-update, or crash reporting.
- If the selected window closes, the renderer stops safely when the stream ends or when the main-process availability check reports it missing.
- Recording output is WebM. Final timeline export output is MP4 H.264/AAC only.
- Program Monitor preview is best-effort and not a frame-perfect final render. FFmpeg MP4 export is implemented for supported saved local timelines, but true multitrack/frame-perfect mastering guarantees are not claimed.
- No Gemini Veo, OpenAI Sora, ElevenLabs, or other AI video provider integration yet.
- Local TTS depends on a user-provided wrapper and local model files. Model compatibility is not promised by the app.

## Manual QA Checklist

Use this checklist before claiming the MVP works end to end:

1. Launch the app with `npm run dev` on macOS with Screen Recording permission available.
2. Refresh sources, select one desktop window, confirm the preview shows only that window, then record, pause, resume, and stop.
3. Confirm the WebM result is saved locally, opens from the app, and can be revealed in the file system.
4. Create a local project, import at least one recorded or local media asset, and confirm it appears in the asset list.
5. Add imported assets to timeline tracks as clips.
6. Move the playhead and confirm the preview follows the current timeline position.
7. Trim a clip, split it, delete one resulting segment, change opacity, scale, position, rotation, and volume, and confirm the timeline state stays local through undo/redo, saving, and reopening the project.
8. Confirm keyframes, transitions, and audio mix settings are visible in Program Monitor as best-effort preview evaluation, then save the timeline.
9. With FFmpeg configured through `VIDEO_TOOL_FFMPEG_PATH` or an absolute `PATH` entry, start MP4 export, watch queued/running progress, cancel one job, then complete a second job and verify Open and Reveal work without showing local paths in the renderer.
10. Confirm there is no cloud upload, AI video generation, multiple export formats, or frame-perfect/multitrack mastering guarantee presented as implemented.

## Future Provider Seams

`src/shared/providerSeams.ts` defines interfaces only:

- `VideoGenerationProvider` for future Gemini Veo and OpenAI Sora adapters.
- `TextToSpeechProvider` for future ElevenLabs adapters and the current local `local_qwen` seam.

No external AI SDKs are installed and no provider network calls are made by this app.
