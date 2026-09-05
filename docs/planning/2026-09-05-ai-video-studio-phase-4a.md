# AI Video Studio Phase 4A — reviewed narration and automatic subtitles

**Issue:** #319

**Branch:** `feat/319-narration-subtitles`

**Status:** Implemented and verified

## Scope

- turn dialogue from the fully approved and applied Writer pipeline into a narration source;
- preserve Writer shot boundaries when deriving subtitle timing;
- support manually pasted narration and deterministic automatic caption splitting;
- let the user edit every cue's text, start, and end before approval;
- persist a versioned narration plan with model, voice, source fingerprint, approval status, and cues;
- require a current approved plan before speech synthesis or timeline mutation;
- replace only prior automatic captions while preserving manually authored titles;
- expose provider-aware OpenAI and ElevenLabs voice choices;
- use one shared narration/subtitle contract on desktop and mobile;
- log the desktop speech lifecycle to the terminal without logging API keys or narration text.

## Manual quality gate

The feature deliberately keeps each transition explicit:

1. approve and apply all four Writer stages;
2. load Writer dialogue or paste a separate narration script;
3. auto-split, then review caption text and timing;
4. save and approve the narration plan;
5. apply captions to the timeline and review them in Editing;
6. generate the approved voice, import it, listen, and fine-tune timing;
7. save and export only after the timeline review.

Changing Writer dialogue makes a linked narration plan stale. Editing the narration script directly detaches it from the Writer source. Neither condition can silently generate paid speech or overwrite captions.

## Platform boundary

Desktop can call the existing OpenAI or ElevenLabs speech adapters and import the resulting audio. Mobile can select the same model and voice, edit and approve the same plan, and apply captions with the shared core. Mobile speech synthesis remains visibly disabled because its binary result transport is not implemented; it cannot charge a provider from this screen.

## Timing accuracy

Writer-derived captions use approved shot timing. Manual narration is distributed by text length. This is deterministic script timing, not word-level ASR alignment. The UI states that the generated audio must be listened to and the cues fine-tuned before export.

## Deferred

- word-level forced alignment or ASR from generated/imported audio;
- per-character voice casting and dialogue tracks;
- subtitle style presets, safe-area controls, karaoke highlighting, and SRT/VTT import/export;
- mobile speech-result binary transport;
- Gemini/Groq TTS adapters that are still marked unavailable in the model catalog.

## Verification result

- focused narration, project-domain, timeline-title, TTS adapter/job, spend-wiring, and desktop-domain tests: 48/48 passed;
- root TypeScript check and Electron production build passed;
- mobile TypeScript check passed against the same shared core;
- `git diff --check` passed apart from the repository's existing LF-to-CRLF notices;
- full root suite: 1,172 passed and 40 failed. The 40 failures remain in the recorded Windows/upstream baseline families (`fsync`/symlink permissions, FFmpeg/path behavior, and CRLF-sensitive source assertions); no Phase 4A test failed;
- Electron development startup passed after clearing this runner's inherited `ELECTRON_RUN_AS_NODE=1`; Chromium reported its existing disk-cache warning but the app stayed running;
- interactive desktop and mobile visual QA remains pending because no in-app Browser session or mobile development client was connected.
