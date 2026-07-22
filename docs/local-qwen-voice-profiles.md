# Local Qwen Voice Profile Setup

This document explains OpenVideo's local voice profile and local Qwen TTS setup. The app keeps selected-window recording and local project timeline editing as the core flow, while explicit-consent voice samples and `local_qwen` TTS jobs are treated as local audio asset extensions.

## Current Scope

- Stores a user-approved reference sample as a local voice profile.
- Stores samples and metadata under Electron `userData` in the voice profile store.
- Lets the user discard an in-progress sample or delete a saved profile.
- Makes local TTS available only when `VIDEO_TOOL_TTS_CONFIG_PATH` points to a valid JSON config.
- Runs the local wrapper and checks that the generated audio output is not empty.

Out of scope:

- OpenVideo does not download Qwen models or runtimes.
- OpenVideo does not call cloud TTS APIs.
- Preset voice paths such as CustomVoice are not part of this local voice profile scope.
- Local Qwen TTS does not include FFmpeg export, final multitrack rendering, effects, transitions, or any OpenCut media editor dependency. Timeline MP4 export is a separate local FFmpeg feature and is independent from local TTS runtime setup.

## Consent And Reference Sample Storage

Voice profile sampling requires `explicitConsent: true`. Store only your own voice or a voice you have permission to use. Qwen3-TTS Base zero-shot cloning research points to clear 10 to 30 second references as a useful target, but quality depends on the model, wrapper, and recording environment.

Storage is local-only:

- In-progress samples are written to a `pending` area.
- Finalized profiles store `profiles/<voiceProfileId>/metadata.json` and the sample file.
- Discard removes the in-progress sample directory.
- Delete removes the saved profile directory.

Delete removes files from OpenVideo's local app storage. It cannot remove operating system backups, external copies, or files created by separate sync tools.

## Local Qwen TTS Runtime Config

`VIDEO_TOOL_TTS_CONFIG_PATH` is the absolute path to the local TTS JSON config. If it is missing or relative, runtime status is unavailable.

The config file uses these fields:

| Field | Required | Description |
|-------|----------|-------------|
| `executablePath` | yes | Absolute path to the user-provided local Qwen wrapper. |
| `modelPath` | yes | Absolute path to the model directory or model file the user downloaded. |
| `argsTemplate` | yes | Argument array passed to the wrapper. |
| `outputExtension` | yes | One of `.wav`, `.mp3`, or `.webm`. |
| `outputMimeType` | yes | One of `audio/wav`, `audio/mpeg`, `audio/webm`, or `audio/webm;codecs=opus`. |
| `timeoutMs` | yes | Integer from 1 through 1800000. |
| `workingDirectory` | no | Absolute working directory for wrapper execution. |
| `modelId` | no | Defaults to `Qwen/Qwen3-TTS-12Hz-1.7B-Base`. |

`argsTemplate` must include these tokens:

- `{modelPath}`
- `{voiceSamplePath}`
- `{textPath}`
- `{outputPath}`

It may also include `{language}`. OpenVideo writes the narration script to a private temporary text file and passes that file path to the wrapper.

A safe placeholder example lives at [`local-qwen-tts-config.example.json`](local-qwen-tts-config.example.json). The example is not an executable command and does not contain secrets or real user paths.

## Qwen Model And Hardware Prerequisites

The expected model id is `Qwen/Qwen3-TTS-12Hz-1.7B-Base`. OpenVideo uses this string in metadata and runtime status, but it does not guarantee model compatibility. GPU VRAM, system memory, disk, and latency requirements depend on the wrapper and inference stack.

Before use, manually verify these runtime-dependent prerequisites:

- A GPU or CPU inference environment that can run a 1.7B-class TTS model.
- Enough disk space for model files.
- A wrapper that accepts reference sample, text file, and output path arguments and creates an audio file.
- Timeout behavior for longer scripts.

## Reference Boundaries

- Voicebox is an architecture reference for local voice profile workflow and consent-based sample management.
- OpenCut is inspiration for local-first asset and timeline UX only. This rewrite does not use OpenCut code or dependencies.
- Qwen is the target for local TTS model and wrapper configuration.
- This repository does not claim to copy Voicebox or OpenCut code.

## Manual Verification

Automated tests cannot replace OS permission checks, real voice sample quality checks, or local wrapper performance checks. Before release, manually verify:

1. With `VIDEO_TOOL_TTS_CONFIG_PATH` unset, OpenVideo reports local TTS as unavailable.
2. A real local wrapper config uses only absolute paths.
3. A 10 to 30 second reference sample from the user or an authorized speaker completes the explicit consent flow.
4. The saved profile appears in the profile list and sample metadata is created in local storage.
5. A local Qwen TTS job creates audio output.
6. Open and Reveal work for the generated output.
7. Profile delete removes the profile directory and sample metadata.
8. A failing wrapper config reports a safe user-facing error.
