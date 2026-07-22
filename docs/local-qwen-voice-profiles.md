# 로컬 Qwen 음성 프로필 설정

이 문서는 Window Loom의 로컬 voice profile과 local Qwen TTS 설정 방법을 설명합니다. 현재 앱은 선택 창 녹화와 로컬 project timeline editing을 유지하면서, 명시적 동의 기반 voice sample 저장과 `local_qwen` TTS job 실행을 로컬 audio asset 확장으로 다룹니다.

## 현재 범위

- 사용자가 동의한 reference sample을 로컬 voice profile로 저장합니다.
- 저장된 sample과 metadata는 Electron `userData` 아래 voice profile 저장소에 보관됩니다.
- 사용자는 진행 중인 sample을 discard할 수 있고, 저장된 profile을 delete할 수 있습니다.
- local TTS는 `VIDEO_TOOL_TTS_CONFIG_PATH`가 지정한 JSON 설정을 읽을 때만 사용할 수 있습니다.
- 앱은 local wrapper를 실행하고, 생성된 audio output이 비어 있지 않은지 확인합니다.

현재 범위에 없는 것들도 명확합니다.

- 앱은 Qwen model이나 runtime을 다운로드하지 않습니다.
- 앱은 cloud TTS API를 호출하지 않습니다.
- CustomVoice 같은 preset voice 경로는 이 범위가 아닙니다.
- Local Qwen TTS 자체는 FFmpeg export, 최종 multitrack render, effects, transitions, OpenCut media editor 의존성을 포함하지 않습니다. Timeline MP4 export는 별도의 local FFmpeg 기능이며 local TTS runtime 설정과 독립적입니다.

## 동의와 reference sample 보관

Voice profile sample은 `explicitConsent: true`가 있어야 시작됩니다. reference sample은 본인 음성 또는 사용할 권한을 받은 음성만 저장해야 합니다. Qwen3-TTS Base zero-shot cloning 연구 기준으로는 10초에서 30초 정도의 선명한 reference가 적합하지만, 실제 품질은 모델, wrapper, 녹음 환경에 따라 달라집니다.

저장 구조는 로컬 전용입니다.

- 진행 중인 sample은 `pending` 영역에 임시 저장됩니다.
- finalize가 끝나면 `profiles/<voiceProfileId>/metadata.json`와 sample 파일이 저장됩니다.
- discard는 진행 중인 sample 디렉터리를 삭제합니다.
- delete는 저장된 profile 디렉터리를 삭제합니다.

삭제는 앱의 로컬 저장소에서 해당 파일을 제거하는 동작입니다. 운영체제 백업, 외부 복사본, 별도 동기화 도구가 만든 사본까지 지우지는 않습니다.

## Local Qwen TTS runtime 설정

`VIDEO_TOOL_TTS_CONFIG_PATH`는 local TTS 설정 JSON의 절대 경로입니다. 이 값이 없거나 상대 경로이면 runtime status는 unavailable입니다.

설정 파일은 다음 필드를 사용합니다.

| 필드 | 필수 | 설명 |
|------|------|------|
| `executablePath` | 예 | 사용자가 준비한 local Qwen wrapper의 절대 경로 |
| `modelPath` | 예 | 사용자가 직접 내려받아 둔 model directory 또는 file의 절대 경로 |
| `argsTemplate` | 예 | wrapper에 전달할 인자 배열 |
| `outputExtension` | 예 | `.wav`, `.mp3`, `.webm` 중 하나 |
| `outputMimeType` | 예 | `audio/wav`, `audio/mpeg`, `audio/webm`, `audio/webm;codecs=opus` 중 하나 |
| `timeoutMs` | 예 | 1 이상 1800000 이하의 정수 |
| `workingDirectory` | 아니오 | wrapper 실행 working directory의 절대 경로 |
| `modelId` | 아니오 | 생략하면 `Qwen/Qwen3-TTS-12Hz-1.7B-Base`를 사용합니다 |

`argsTemplate`는 최소한 다음 토큰을 포함해야 합니다.

- `{modelPath}`
- `{voiceSamplePath}`
- `{textPath}`
- `{outputPath}`

필요하면 `{language}`도 사용할 수 있습니다. 앱은 narration script를 private temporary text file로 쓰고, wrapper에는 그 파일 경로를 넘깁니다.

안전한 placeholder 예시는 [`local-qwen-tts-config.example.json`](local-qwen-tts-config.example.json)에 있습니다. 이 예시는 실제 실행 가능한 명령이 아니며, secret이나 실제 사용자 경로를 포함하지 않습니다.

## Qwen 모델과 하드웨어 전제조건

예상 model id는 `Qwen/Qwen3-TTS-12Hz-1.7B-Base`입니다. 앱은 이 문자열을 metadata와 runtime status에 사용하지만, 모델 호환성을 보장하지 않습니다. wrapper가 어떤 inference stack을 쓰는지에 따라 GPU VRAM, system memory, disk, latency 요구사항이 달라집니다.

운영 전에는 다음을 runtime dependent prerequisite로 확인해야 합니다.

- 1.7B급 TTS 모델을 실행할 수 있는 GPU 또는 CPU inference 환경
- 모델 파일을 보관할 충분한 디스크 공간
- wrapper가 reference sample, text file, output path 인자를 받아 audio file을 생성하는지 여부
- 긴 script에서 timeout 안에 작업이 끝나는지 여부

## Reference 경계

- Voicebox는 local voice profile workflow와 동의 기반 sample 관리 방식을 생각할 때 참고한 architecture reference입니다.
- OpenCut은 local-first asset과 timeline UX 방향을 참고한 inspiration입니다. 현재 rewrite는 OpenCut 코드나 dependency를 사용하지 않습니다.
- Qwen은 local TTS 모델과 wrapper configuration의 대상입니다.
- 이 저장소는 Voicebox나 OpenCut 코드를 복사했다고 주장하지 않습니다.

## 수동 검증

자동 테스트는 OS 권한, 실제 voice sample 품질, local wrapper 성능을 대신 확인할 수 없습니다. release 전에는 다음을 수동으로 확인합니다.

1. `VIDEO_TOOL_TTS_CONFIG_PATH`를 비워 둔 상태에서 앱이 local TTS를 unavailable로 표시하는지 확인합니다.
2. 절대 경로만 사용하는 실제 local wrapper 설정을 준비합니다.
3. 본인 음성 또는 권한이 있는 음성으로 10초에서 30초 reference sample을 녹음하고 explicit consent 흐름을 확인합니다.
4. 저장된 profile이 목록에 보이고 sample metadata가 로컬 저장소에 생성되는지 확인합니다.
5. local Qwen TTS job을 실행해 audio output이 생성되는지 확인합니다.
6. 생성 결과의 open과 reveal 동작을 확인합니다.
7. profile delete 후 profile 디렉터리와 sample metadata가 제거되는지 확인합니다.
8. 실패하는 wrapper 설정에서 오류가 사용자에게 안전하게 표시되는지 확인합니다.
