# Electron video production application 제품 계획

상태: Draft
작성일: 2026-07-20
대상 독자: 제품 의사결정자, 구현 담당자, 보안 검토자

## 1. 제품 목표

이 제품은 데스크톱에서 특정 창을 선택해 녹화하고, 로컬 프로젝트 타임라인에서 녹화본과 가져온 asset을 편집하는 Electron 기반 영상 제작 앱입니다. 초기 구현은 capture/recording에서 시작했고, 현재는 로컬 project, asset, track, clip 기반 timeline editing까지 포함합니다. 사용자는 복잡한 방송 도구를 설정하지 않고도 작업 화면, 데모, 강의, 제품 소개 영상을 빠르게 만들 수 있어야 합니다.

장기적으로는 녹화와 로컬 편집 흐름 위에 AI 영상 생성, 음성 합성, 자막, 편집 자동화를 얹을 수 있는 구조를 목표로 합니다. Gemini Veo, OpenAI Sora, ElevenLabs는 미래 확장 대상으로 문서화하지만, 현재 MVP에서 구현됐다고 주장하지 않습니다.

## 2. 핵심 사용자

| 사용자 | 주요 목적 | 성공 기준 |
|--------|-----------|-----------|
| 제품 데모 제작자 | 특정 앱 창을 녹화해 데모 영상을 만듭니다 | 원하는 창만 녹화되고 결과 파일을 바로 확인합니다 |
| 강의 제작자 | 코드 에디터, 브라우저, 문서 창을 녹화합니다 | 긴 녹화에서도 끊김과 싱크 문제가 없습니다 |
| 마케터 | 기능 소개 영상을 빠르게 만듭니다 | 녹화본을 AI 생성 영상과 음성 합성으로 확장할 수 있습니다 |
| 개발자 | 앱 동작을 재현 가능한 영상으로 기록합니다 | 민감한 다른 창이 녹화되지 않습니다 |

## 3. MVP 범위

MVP는 특정 데스크톱 창을 선택하고 그 창을 녹화한 뒤, 결과물과 가져온 로컬 asset을 project timeline에서 다루는 흐름에 집중합니다. 전체 화면 녹화보다 선택 창 녹화를 먼저 다루는 이유는 개인정보 노출 위험을 줄이고, 사용자가 만든 결과물이 더 명확하기 때문입니다.

현재 구현 상태에서 capture 범위는 그대로 유지하면서 로컬 timeline editing과 저장된 timeline의 로컬 MP4 export가 추가됐습니다. 사용자는 로컬 project를 만들고, recording 또는 imported asset을 asset list에 넣고, track과 clip으로 배치할 수 있습니다. clip trim, split, delete, playhead 이동, preview 확인도 현재 범위에 포함합니다. Clip opacity, scale, position, rotation, volume, keyframes, transitions, audio track mix는 local timeline state로 저장되며, timeline undo/redo, save, reopen 흐름에 참여합니다. Program Monitor는 이 값을 best-effort로 평가하는 preview이고, FFmpeg MP4 export는 지원되는 저장 timeline에 대한 권위 있는 로컬 출력입니다. 로컬 voice profile 저장과 로컬 Qwen TTS runner는 별도 audio asset 확장입니다. 이 기능들은 클라우드 provider 연동, multiple export formats, frame-perfect mastering, 최종 multitrack render, multitrack/frame-perfect mixing 구현으로 해석하지 않습니다.

### 3.1 반드시 포함합니다

1. 앱은 사용 가능한 데스크톱 창 목록을 표시해야 합니다.
2. 사용자는 목록에서 하나의 창을 선택할 수 있어야 합니다.
3. 앱은 선택된 창만 preview로 보여줘야 합니다.
4. 사용자는 record, pause, resume, stop 동작을 수행할 수 있어야 합니다.
5. 앱은 녹화 결과를 로컬 파일로 저장해야 합니다.
6. 앱은 저장 위치, 파일명, 녹화 시간, 파일 크기를 사용자에게 보여줘야 합니다.
7. 앱은 녹화 중 현재 상태와 경과 시간을 명확히 표시해야 합니다.
8. 앱은 선택한 창이 닫히거나 접근 불가 상태가 되면 안전하게 녹화를 중단하고 원인을 알려야 합니다.
9. 앱은 로컬 project를 만들고 저장할 수 있어야 합니다.
10. 앱은 사용자가 가져온 로컬 media asset과 녹화 결과를 project asset으로 관리할 수 있어야 합니다.
11. 앱은 timeline track과 clip을 표시하고 clip을 배치할 수 있어야 합니다.
12. 앱은 clip trim, split, delete 동작을 지원해야 합니다.
13. 앱은 playhead 이동과 timeline preview를 제공해야 합니다.
14. 앱은 clip opacity, scale, position, rotation, volume을 local static effect로 저장해야 합니다.
15. 앱은 static clip effects를 timeline undo/redo, save, reopen 흐름에 포함하고 단일 active Program Monitor preview에만 적용해야 합니다.
16. 앱은 keyframes, transitions, audio track mix settings를 local timeline v3 state로 저장하고 Program Monitor에서 best-effort로 평가해야 합니다.
17. 앱은 저장된 로컬 project timeline을 FFmpeg 기반 MP4 H.264/AAC 파일로 export할 수 있어야 합니다.

### 3.1.1 현재 포함된 로컬 음성 기능

1. 앱은 사용자가 명시적으로 동의한 reference sample만 로컬 voice profile로 저장합니다.
2. 앱은 진행 중인 sample을 discard할 수 있고, 저장된 profile을 삭제할 수 있어야 합니다.
3. 앱은 `VIDEO_TOOL_TTS_CONFIG_PATH`로 지정된 로컬 JSON 설정이 있을 때만 `local_qwen` TTS 상태를 ready로 표시합니다.
4. 앱은 Qwen model이나 runtime을 다운로드하지 않습니다. 사용자가 준비한 local wrapper와 model path만 호출합니다.
5. 로컬 wrapper는 `Qwen/Qwen3-TTS-12Hz-1.7B-Base` 실행을 목표로 하지만, 실제 호환성과 성능은 wrapper와 runtime에 따라 수동 검증합니다.

### 3.2 MVP에서 다루지 않습니다

1. 전체 화면 녹화는 초기 범위가 아닙니다.
2. 다중 창 동시 녹화는 초기 범위가 아닙니다.
3. 클라우드 업로드는 초기 범위가 아닙니다.
4. Gemini Veo, OpenAI Sora, ElevenLabs 연동은 초기 범위가 아닙니다.
5. 최종 multitrack render와 frame-perfect mastering guarantee는 초기 범위가 아닙니다.
6. 계정 시스템과 결제 시스템은 초기 범위가 아닙니다.
7. 자동 배포, auto update, crash reporting은 초기 범위가 아닙니다.
8. CustomVoice 같은 preset voice 경로는 현재 로컬 voice profile 범위가 아닙니다.
9. multiple export formats와 cloud export는 현재 범위가 아닙니다.
10. frame-perfect audio/video mixing과 multitrack/frame-perfect mixing은 현재 범위가 아닙니다.

## 4. 사용자 흐름

### 4.1 첫 실행 흐름

1. 사용자가 앱을 실행합니다.
2. 앱이 화면 및 마이크 권한 필요 여부를 설명합니다.
3. 사용자가 운영체제 권한을 승인합니다.
4. 앱이 현재 녹화 가능한 창 목록을 표시합니다.
5. 사용자가 녹화할 창을 선택합니다.
6. 앱이 선택 창 preview를 표시합니다.
7. 사용자가 녹화를 시작합니다.
8. 사용자가 녹화를 중지합니다.
9. 앱이 결과 파일 정보를 보여줍니다.
10. 사용자가 파일을 열거나 저장 위치를 엽니다.

### 4.2 권한 거부 흐름

1. 사용자가 화면 녹화 권한을 거부합니다.
2. 앱은 녹화를 시작하지 않습니다.
3. 앱은 운영체제 설정에서 권한을 켜는 방법을 안내합니다.
4. 사용자가 권한을 다시 확인하면 앱은 창 목록을 갱신합니다.

### 4.3 창 종료 흐름

1. 사용자가 창을 선택하고 녹화를 시작합니다.
2. 녹화 중 대상 창이 닫힙니다.
3. 앱은 녹화를 안전하게 중지합니다.
4. 앱은 저장 가능한 부분 녹화 파일이 있는지 확인합니다.
5. 앱은 사용자에게 대상 창이 종료됐다는 메시지를 보여줍니다.

## 5. 제품 구조

### 5.1 주요 화면

| 화면 | 목적 | 핵심 요소 |
|------|------|-----------|
| Welcome | 권한과 기본 흐름 안내 | 권한 상태, 시작 버튼 |
| Source Picker | 녹화할 창 선택 | 창 목록, 썸네일, 새로고침 |
| Recorder | preview와 녹화 제어 | preview, record, pause, resume, stop, timer |
| Recording Result | 결과 확인 | 파일명, 저장 위치, 열기 버튼 |
| Project Timeline | 로컬 asset 편집 | asset list, track, clip, trim, split, delete, clip effects, keyframes, transitions, audio mix, playhead, Program Monitor preview, MP4 export |
| Settings | 기본 설정 관리 | 저장 경로, 오디오 입력, 품질 설정 |

### 5.2 상태 모델

| 상태 | 설명 | 허용 동작 |
|------|------|-----------|
| idle | 선택된 소스가 없습니다 | 창 선택 |
| source_selected | 소스가 선택됐고 preview가 준비됐습니다 | 녹화 시작, 소스 변경 |
| recording | 녹화 중입니다 | pause, stop |
| paused | 녹화가 일시정지됐습니다 | resume, stop |
| finalizing | 파일 저장을 마무리합니다 | 대기 |
| completed | 결과 파일이 생성됐습니다 | 파일 열기, 새 녹화 |
| error | 복구 가능한 오류가 있습니다 | 재시도, 소스 변경 |

## 6. 보안 Electron 아키텍처

Electron 앱은 renderer, preload, main process를 명확히 분리합니다. 화면 캡처 권한과 파일 시스템 접근은 main process에서 관리하고, renderer는 직접 Node.js API에 접근하지 않습니다.

### 6.1 원칙

1. `nodeIntegration`은 꺼야 합니다.
2. `contextIsolation`은 켜야 합니다.
3. renderer는 `preload`를 통해 허용된 API만 호출해야 합니다.
4. IPC 채널은 이름, 입력 스키마, 반환 타입을 명확히 정의해야 합니다.
5. 파일 저장 경로는 main process에서 검증해야 합니다.
6. 외부 URL 로드는 기본적으로 막아야 합니다.
7. API key는 renderer에 노출하지 않아야 합니다.
8. future AI provider 호출은 main process 또는 별도 backend adapter에서 처리해야 합니다.

### 6.2 프로세스 책임

| 영역 | 책임 |
|------|------|
| main process | 권한 확인, 창 목록 조회, 파일 저장, 로컬 project 저장, provider adapter 실행 |
| preload | 안전한 IPC wrapper 노출 |
| renderer | 화면 표시, 사용자 입력, 상태 표시 |
| recorder module | MediaStream 처리, 녹화 상태 관리 |
| provider adapter | 미래 AI provider별 요청 생성 및 결과 정규화 |

### 6.3 IPC 계약 초안

| 채널 | 방향 | 목적 | 입력 | 출력 |
|------|------|------|------|------|
| `sources:list` | renderer to main | 녹화 가능한 창 목록 조회 | 없음 | `CaptureSource[]` |
| `recording:start` | renderer to main | 녹화 세션 시작 | `RecordingStartInput` | `RecordingSession` |
| `recording:stop` | renderer to main | 녹화 세션 종료 | `sessionId` | `RecordingResult` |
| `projects:create` | renderer to main | 로컬 project 생성 | `ProjectCreateInput` | `Project` |
| `projects:saveTimeline` | renderer to main | timeline 상태 저장 | `TimelineSaveInput` | `Project` |
| `assets:import` | renderer to main | 로컬 media asset 가져오기 | `AssetImportInput` | `Asset` |
| `export:start-job` | renderer to main | 저장된 로컬 timeline의 MP4 export 시작 | `StartExportJobInput` | `LocalExportJob` |
| `export:get-job` | renderer to main | export 상태 조회 | `ExportJobActionInput` | `LocalExportJob` |
| `export:cancel-job` | renderer to main | 실행 중인 export 취소 | `ExportJobActionInput` | `{ cancelled: boolean }` |
| `export:open-result` | renderer to main | 완료된 export 결과 열기 | `ExportJobActionInput` | `{ opened: boolean }` |
| `export:reveal-result` | renderer to main | 완료된 export 결과 위치 열기 | `ExportJobActionInput` | `{ revealed: boolean }` |
| `settings:get` | renderer to main | 설정 조회 | 없음 | `AppSettings` |
| `settings:update` | renderer to main | 설정 저장 | `Partial<AppSettings>` | `AppSettings` |

## 7. 미래 확장 seam

미래 기능은 MVP 코드에 직접 섞지 않고 provider adapter와 job model로 붙입니다. 이 문서는 확장 지점을 정의하지만, Gemini Veo, OpenAI Sora, ElevenLabs가 현재 구현됐다고 말하지 않습니다.

### 7.1 Gemini Veo

목표는 prompt 기반 영상 생성 job을 만들고, 생성 결과를 프로젝트 asset으로 가져오는 것입니다. MVP 이후에 adapter를 추가합니다.

필요 seam:

1. `VideoGenerationProvider` 인터페이스
2. prompt, aspect ratio, duration, style preset을 담는 request model
3. provider job id와 내부 job id 매핑
4. 생성 상태 polling 또는 webhook 처리 방식
5. 결과 파일을 asset store에 저장하는 import path

### 7.2 OpenAI Sora

목표는 Sora 기반 text to video 또는 image to video 생성을 지원하는 것입니다. 초기 녹화 기능과 독립된 job 기반 확장으로 둡니다.

필요 seam:

1. `VideoGenerationProvider` 공통 인터페이스 재사용
2. provider별 capability 확인
3. prompt safety 결과를 사용자에게 설명하는 error model
4. 생성 결과를 project timeline 또는 asset list에 연결하는 구조. 현재는 provider 결과 import UI가 구현됐다고 주장하지 않습니다.

### 7.3 ElevenLabs TTS

목표는 script를 음성 파일로 변환하고 녹화 영상 또는 AI 생성 영상에 붙이는 것입니다. ElevenLabs cloud TTS는 구현하지 않고, audio asset model만 확장 가능하게 둡니다. 현재 구현된 TTS 경로는 별도 local Qwen phase로 분리합니다.

필요 seam:

1. `TextToSpeechProvider` 인터페이스
2. voice id, model id, script, language를 담는 request model
3. 생성된 audio 파일의 duration, sample rate, format metadata
4. 자막 또는 script segment와 audio segment를 연결하는 model

### 7.4 Local Qwen TTS

목표는 사용자가 명시적으로 동의한 로컬 voice sample을 사용해 local wrapper가 Qwen TTS audio asset을 생성하는 것입니다. 이 기능은 현재 로컬 audio asset 확장으로 포함하며, cloud API나 model download를 포함하지 않습니다.

필요 seam과 현재 경계:

1. provider id는 `local_qwen`입니다.
2. 예상 model id는 `Qwen/Qwen3-TTS-12Hz-1.7B-Base`입니다.
3. runtime 설정은 `VIDEO_TOOL_TTS_CONFIG_PATH`가 가리키는 JSON 파일에서 읽습니다.
4. 모든 실행 파일, model, working directory 경로는 절대 경로여야 합니다.
5. wrapper는 `{modelPath}`, `{voiceSamplePath}`, `{textPath}`, `{outputPath}`, `{language}` 토큰을 전달받을 수 있습니다.
6. 앱은 wrapper 실행과 결과 파일 확인만 담당합니다. 모델 호환성, GPU VRAM, 메모리, latency는 runtime dependent 전제조건으로 둡니다.
7. Voicebox는 local profile workflow 참고 자료입니다. OpenCut은 local-first asset과 timeline UX 방향을 살핀 inspiration입니다. 둘 다 코드 의존성이나 복사 출처가 아닙니다.

## 8. 데이터 모델 초안

초기 구현은 로컬 파일과 로컬 설정 중심입니다. 데이터베이스를 바로 도입하지 않아도 되지만, 모델 이름과 관계는 처음부터 정리합니다.

### 8.1 CaptureSource

| 필드 | 타입 | 설명 |
|------|------|------|
| id | string | 운영체제 또는 Electron이 제공하는 source id |
| name | string | 창 제목 |
| appName | string | 앱 이름 |
| thumbnailPath | string optional | 캐시된 썸네일 경로 |
| displayId | string optional | 연결된 display id |

### 8.2 RecordingSession

| 필드 | 타입 | 설명 |
|------|------|------|
| id | string | 내부 세션 id |
| sourceId | string | 선택된 CaptureSource id |
| status | RecordingStatus | 현재 녹화 상태 |
| startedAt | string | ISO timestamp |
| endedAt | string optional | ISO timestamp |
| outputPath | string optional | 결과 파일 경로 |
| durationMs | number optional | 녹화 길이 |
| errorCode | string optional | 오류 코드 |

### 8.3 RecordingResult

| 필드 | 타입 | 설명 |
|------|------|------|
| sessionId | string | RecordingSession id |
| outputPath | string | 저장된 파일 경로 |
| fileName | string | 파일명 |
| fileSizeBytes | number | 파일 크기 |
| durationMs | number | 녹화 길이 |
| createdAt | string | ISO timestamp |

### 8.4 GenerationJob

| 필드 | 타입 | 설명 |
|------|------|------|
| id | string | 내부 job id |
| provider | `gemini_veo` or `openai_sora` | 미래 영상 생성 provider |
| status | JobStatus | queued, running, completed, failed |
| prompt | string | 생성 prompt |
| providerJobId | string optional | provider에서 받은 job id |
| outputAssetId | string optional | 생성 결과 asset id |
| createdAt | string | ISO timestamp |
| updatedAt | string | ISO timestamp |

### 8.5 AudioJob

| 필드 | 타입 | 설명 |
|------|------|------|
| id | string | 내부 job id |
| provider | `elevenlabs` or `local_qwen` | TTS provider |
| status | JobStatus | queued, running, completed, failed |
| script | string | 음성으로 변환할 텍스트 |
| voiceId | string | provider voice id |
| outputAssetId | string optional | 생성된 audio asset id |
| createdAt | string | ISO timestamp |
| updatedAt | string | ISO timestamp |

### 8.6 VoiceProfile

| 필드 | 타입 | 설명 |
|------|------|------|
| id | string | 내부 voice profile id |
| displayName | string | 사용자가 지정한 표시 이름 |
| language | string | reference sample 언어 |
| sampleCount | number | 현재 구현에서는 1 |
| totalDurationMs | number | 저장된 sample 길이 합계 |
| createdAt | string | ISO timestamp |
| updatedAt | string | ISO timestamp |

### 8.7 VoiceProfileSample

| 필드 | 타입 | 설명 |
|------|------|------|
| id | string | 내부 sample id |
| voiceProfileId | string | 연결된 profile id |
| narrationScript | string | sample 녹음에 사용한 문장 |
| mimeType | audio/webm, audio/wav, audio/mpeg | 저장된 audio 타입 |
| consent | explicitConsent true | 명시적 동의 기록 |
| createdAt | string | ISO timestamp |

### 8.8 Asset

| 필드 | 타입 | 설명 |
|------|------|------|
| id | string | 내부 asset id |
| kind | `recording` or `generated_video` or `tts_audio` | asset 종류 |
| path | string | 로컬 파일 경로 |
| mimeType | string | 파일 타입 |
| durationMs | number optional | media 길이 |
| metadata | object | provider, source, encoding 정보 |

### 8.9 Project

| 필드 | 타입 | 설명 |
|------|------|------|
| id | string | 내부 project id |
| name | string | 사용자가 지정한 project 이름 |
| assets | Asset[] | project에 가져온 로컬 asset 목록 |
| tracks | TimelineTrack[] | timeline track 목록 |
| playheadMs | number | 현재 playhead 위치 |
| updatedAt | string | ISO timestamp |

### 8.10 TimelineTrack

| 필드 | 타입 | 설명 |
|------|------|------|
| id | string | 내부 track id |
| kind | video or audio | track 종류 |
| clips | TimelineClip[] | 이 track에 배치된 clip 목록 |

### 8.11 TimelineClip

| 필드 | 타입 | 설명 |
|------|------|------|
| id | string | 내부 clip id |
| assetId | string | 연결된 Asset id |
| trackId | string | 배치된 TimelineTrack id |
| startMs | number | timeline 위 시작 위치 |
| trimStartMs | number | asset 내부 시작 trim 위치 |
| trimEndMs | number | asset 내부 끝 trim 위치 |
| effects | ClipEffects optional | opacity, scale, position, rotation, volume 정적 local effect |

### 8.12 ClipEffects

| 필드 | 타입 | 설명 |
|------|------|------|
| opacity | number | 단일 active Program Monitor preview에 적용되는 clip 불투명도 |
| scale | number | 단일 active Program Monitor preview에 적용되는 clip 배율 |
| position | object | 단일 active Program Monitor preview에 적용되는 clip 위치 |
| rotation | number | 단일 active Program Monitor preview에 적용되는 clip 회전 |
| volume | number | HTML media volume과 같은 0~1 범위의 clip 볼륨. 1은 0 dB unity이며 positive gain은 지원하지 않음 |

ClipEffects와 v3 timeline metadata는 로컬 편집 값입니다. Timeline undo/redo, save, reopen 흐름에 포함하고 Program Monitor에서 best-effort로 평가됩니다. FFmpeg export는 저장된 timeline을 MP4 H.264/AAC로 렌더링하는 현재 지원 경로이지만, frame-perfect mastering이나 전체 multitrack mastering guarantee를 의미하지 않습니다.

## 9. 단계별 roadmap

### Phase 0: 제품 기반 정리

목표는 계획, 보안 구조, 기본 UX를 확정하는 것입니다.

완료 기준:

1. 이 planning 문서가 승인됩니다.
2. 창 선택 및 녹화 MVP 범위가 고정됩니다.
3. Electron 보안 원칙이 구현 기준으로 채택됩니다.

### Phase 1: 선택 창 캡처와 preview

목표는 선택 가능한 창 목록을 보여주고, 사용자가 고른 창만 preview로 확인하는 것입니다.

완료 기준:

1. 창 목록이 표시됩니다.
2. 목록 refresh가 동작합니다.
3. 사용자가 창 하나를 선택할 수 있습니다.
4. 선택 창 preview가 표시됩니다.
5. 권한 거부 상태가 안내됩니다.

### Phase 2: 녹화 세션

목표는 선택 창을 파일로 녹화하는 것입니다.

완료 기준:

1. record, pause, resume, stop이 동작합니다.
2. 녹화 상태와 경과 시간이 표시됩니다.
3. 결과 파일이 로컬에 저장됩니다.
4. 저장 결과 화면에서 파일 정보가 보입니다.
5. 대상 창이 닫히면 앱이 안전하게 중단합니다.

### Phase 3: 설정과 안정성

목표는 저장 위치, 품질 설정, 오류 처리를 다듬는 것입니다.

완료 기준:

1. 기본 저장 위치를 설정할 수 있습니다.
2. 녹화 품질 preset을 선택할 수 있습니다.
3. 오류 코드와 사용자 메시지가 정리됩니다.
4. 긴 녹화의 메모리 사용량을 확인합니다.

### Phase 3.5: 로컬 project timeline editing

목표는 녹화 결과와 가져온 로컬 asset을 project timeline에서 편집하는 것입니다. 이 단계는 현재 구현 범위에 포함합니다.

완료 기준:

1. 로컬 project를 만들고 저장할 수 있습니다.
2. 녹화 결과와 imported media asset을 project asset list에 추가할 수 있습니다.
3. timeline은 track과 clip을 표시합니다.
4. clip trim, split, delete가 동작합니다.
5. playhead 이동과 preview 확인이 동작합니다.
6. 저장 후 project를 다시 열어도 asset, track, clip, trim, static clip effects 상태가 유지됩니다.
7. Static clip effects는 opacity, scale, position, rotation, volume을 단일 active Program Monitor preview에 적용합니다.
8. Keyframes, transitions, audio mix는 v3 local timeline state와 Program Monitor best-effort preview로 표시합니다.
9. 저장된 timeline을 local FFmpeg MP4 H.264/AAC export로 생성할 수 있습니다.
10. multiple export formats, cloud export, 최종 multitrack render, frame-perfect mastering은 구현된 기능으로 표시하지 않습니다.

### Phase 4: AI 생성 seam 준비

목표는 provider adapter와 job model을 추가할 수 있는 구조를 만듭니다. 이 단계에서도 실제 provider 호출은 별도 결정 후 구현합니다.

완료 기준:

1. `VideoGenerationProvider` 인터페이스 설계가 확정됩니다.
2. `TextToSpeechProvider` 인터페이스 설계가 확정됩니다.
3. GenerationJob, AudioJob, Asset model이 구현 계획에 반영됩니다.
4. API key 보관 방식이 보안 검토를 통과합니다.

### Phase 4.5: 로컬 voice profile과 local Qwen TTS

목표는 cloud provider 없이 로컬 reference sample과 local Qwen wrapper를 이용해 audio asset을 생성하는 것입니다. 이 단계는 현재 구현된 로컬 audio asset 확장입니다.

완료 기준:

1. voice profile sample은 explicit consent 없이는 시작되지 않습니다.
2. sample은 Electron userData 아래 로컬 profile 저장소에 보관됩니다.
3. 사용자는 진행 중인 sample을 discard하거나 저장된 profile을 delete할 수 있습니다.
4. `VIDEO_TOOL_TTS_CONFIG_PATH`가 없으면 local TTS는 unavailable로 표시됩니다.
5. 설정 파일이 있으면 local wrapper, model path, tokenized args, timeout, output format을 검증합니다.
6. Qwen wrapper 실행 결과가 비어 있지 않은 audio file로 생성되는지 확인합니다.
7. 수동 QA에서 10초에서 30초 사이의 동의된 sample로 local TTS job을 실행하고 결과 파일 열기와 reveal을 확인합니다.

### Phase 5: Provider 연동 후보

목표는 Gemini Veo, OpenAI Sora, ElevenLabs 중 어떤 provider를 먼저 붙일지 결정하는 것입니다.

완료 기준:

1. provider별 capability와 비용을 비교합니다.
2. text to video, image to video, TTS 중 첫 확장 기능을 고릅니다.
3. provider별 rate limit, 정책, 실패 처리 방식을 문서화합니다.
4. 사용자가 이해할 수 있는 job 상태 UX를 정의합니다.

## 10. 테스트 계획

### 10.1 단위 테스트

1. 상태 전이가 유효한지 검증합니다.
2. 저장 파일명 생성 규칙을 검증합니다.
3. IPC 입력 검증이 잘못된 값을 거부하는지 확인합니다.
4. provider adapter 인터페이스가 공통 결과 타입을 반환하는지 확인합니다. 이 항목은 provider seam 구현 이후에 적용합니다.

### 10.2 통합 테스트

1. 창 목록 조회 요청이 renderer에서 main process까지 연결되는지 확인합니다.
2. 선택된 source id가 preview 생성에 전달되는지 확인합니다.
3. 녹화 시작과 중지 후 결과 파일 metadata가 생성되는지 확인합니다.
4. 권한 거부 시 녹화 시작이 막히는지 확인합니다.

### 10.3 수동 QA

1. macOS에서 화면 녹화 권한이 없는 상태로 앱을 실행합니다.
2. 권한을 승인한 뒤 창 목록이 표시되는지 확인합니다.
3. 브라우저 창 하나를 선택하고 preview가 맞는지 확인합니다.
4. 10초 녹화 후 결과 파일이 재생되는지 확인합니다.
5. 녹화 중 대상 창을 닫고 앱이 안전하게 종료 메시지를 보여주는지 확인합니다.
6. 녹화 중 다른 창으로 전환해도 선택된 창만 녹화되는지 확인합니다.
7. 로컬 project를 만들고 녹화 결과 또는 로컬 media file을 asset으로 가져옵니다.
8. asset을 timeline track에 clip으로 배치합니다.
9. playhead를 이동하고 preview가 현재 timeline 위치를 반영하는지 확인합니다.
10. clip trim, split, delete를 실행하고 timeline 상태가 예상대로 바뀌는지 확인합니다.
11. clip opacity, scale, position, rotation, volume을 바꾸고 단일 active Program Monitor preview에만 적용되는지 확인합니다.
12. undo/redo 후 static clip effects 상태가 예상대로 바뀌는지 확인합니다.
13. project를 저장하고 다시 열어 asset, track, clip, trim, static clip effects 상태가 유지되는지 확인합니다.
14. keyframes, transitions, audio mix가 Program Monitor에서 best-effort preview로 보이는지 확인합니다.
15. `VIDEO_TOOL_FFMPEG_PATH` 또는 absolute `PATH` discovery로 FFmpeg를 준비한 뒤 MP4 export를 시작하고 queued/running progress를 확인합니다.
16. 실행 중인 export를 cancel하면 partial output이 버려지고 UI가 cancelled state를 path 없이 표시하는지 확인합니다.
17. 완료된 MP4 export의 open과 reveal 동작이 되며 renderer가 output path, FFmpeg path, argv를 표시하지 않는지 확인합니다.
18. UI가 multiple export formats, cloud export, 최종 multitrack render, frame-perfect mastering, AI video provider를 구현된 기능처럼 표시하지 않는지 확인합니다.
19. `VIDEO_TOOL_TTS_CONFIG_PATH`가 없을 때 local TTS runtime이 unavailable로 표시되는지 확인합니다.
20. placeholder가 아닌 실제 local wrapper 설정을 준비한 뒤, 동의된 10초에서 30초 reference sample로 voice profile을 저장합니다.
21. local Qwen TTS job을 실행하고 output audio가 생성되며 open, reveal 동작이 되는지 확인합니다.
22. voice profile 삭제 후 sample 파일과 metadata가 로컬 profile 저장소에서 사라지는지 확인합니다.

## 11. Acceptance criteria

### AC 1: 창 선택

Given 앱이 화면 녹화 권한을 가지고 있습니다.
When 사용자가 Source Picker 화면을 엽니다.
Then 앱은 현재 선택 가능한 데스크톱 창 목록을 보여줘야 합니다.

### AC 2: 선택 창 preview

Given 사용자가 창 목록에서 하나의 창을 선택했습니다.
When 선택이 완료됩니다.
Then 앱은 선택한 창의 preview만 표시해야 합니다.

### AC 3: 녹화 시작

Given preview가 준비됐습니다.
When 사용자가 record를 누릅니다.
Then 앱은 recording 상태로 전환하고 경과 시간을 표시해야 합니다.

### AC 4: 녹화 중지와 저장

Given 앱이 recording 상태입니다.
When 사용자가 stop을 누릅니다.
Then 앱은 녹화를 중지하고 로컬 결과 파일을 생성해야 합니다.

### AC 5: 결과 확인

Given 녹화 파일이 생성됐습니다.
When 저장이 완료됩니다.
Then 앱은 파일명, 저장 위치, 파일 크기, 녹화 시간을 보여줘야 합니다.

### AC 6: 권한 거부

Given 화면 녹화 권한이 없습니다.
When 사용자가 녹화를 시작하려고 합니다.
Then 앱은 녹화를 시작하지 않고 권한 설정 안내를 보여줘야 합니다.

### AC 7: 대상 창 종료

Given 앱이 선택된 창을 녹화 중입니다.
When 대상 창이 닫힙니다.
Then 앱은 녹화를 안전하게 중지하고 사용자에게 원인을 알려야 합니다.

### AC 8: AI provider 상태

Given MVP 단계입니다.
When 사용자가 Gemini Veo, OpenAI Sora, ElevenLabs 기능을 찾습니다.
Then 앱은 해당 기능을 구현된 기능으로 표시하면 안 됩니다.

### AC 8.1: 로컬 project 생성과 asset import

Given 사용자가 로컬 project를 만들었습니다.
When 사용자가 녹화 결과 또는 로컬 media file을 가져옵니다.
Then 앱은 해당 파일을 project asset으로 표시하고 로컬 저장소에 metadata를 보관해야 합니다.

### AC 8.2: timeline track과 clip 배치

Given project asset이 있습니다.
When 사용자가 asset을 timeline에 추가합니다.
Then 앱은 track 위에 clip을 표시해야 합니다.

### AC 8.3: clip trim, split, delete

Given timeline에 clip이 있습니다.
When 사용자가 clip을 trim, split, delete합니다.
Then 앱은 timeline state를 로컬에서 갱신하고 저장할 수 있어야 합니다.

### AC 8.4: playhead와 preview

Given timeline에 clip이 있습니다.
When 사용자가 playhead를 이동합니다.
Then 앱은 현재 playhead 위치를 표시하고 preview를 갱신해야 합니다.

### AC 8.5: 로컬 MP4 export

Given 사용자가 저장된 로컬 project를 열었고 FFmpeg가 사용 가능합니다.
When 사용자가 MP4 export를 시작합니다.
Then 앱은 path를 renderer에 노출하지 않고 queued/running/completed 상태, progress, cancel, open, reveal 동작을 제공해야 합니다.

### AC 8.6: static clip effects 저장과 preview

Given timeline에 clip이 있습니다.
When 사용자가 opacity, scale, position, rotation, volume을 변경합니다.
Then 앱은 값을 로컬 timeline state에 저장하고 undo/redo, save, reopen 흐름에서 유지해야 합니다.

### AC 8.7: static clip effects 범위 제한

Given clip에 static effects가 있습니다.
When 사용자가 preview를 확인합니다.
Then 앱은 단일 active Program Monitor preview에서 best-effort로 effects, keyframes, transitions, audio mix를 평가하고 frame-perfect mastering이나 multiple export formats를 구현된 기능으로 표시하면 안 됩니다.

### AC 9: 로컬 voice profile 동의

Given 사용자가 voice profile sample을 만들려고 합니다.
When explicit consent가 true가 아닙니다.
Then 앱은 sample 저장을 시작하면 안 됩니다.

### AC 10: 로컬 Qwen TTS 설정

Given `VIDEO_TOOL_TTS_CONFIG_PATH`가 설정되지 않았습니다.
When 사용자가 local TTS 상태를 확인합니다.
Then 앱은 `local_qwen` provider를 unavailable로 표시해야 합니다.

### AC 11: 로컬 Qwen TTS 실행

Given 사용자가 절대 경로 기반 local wrapper 설정과 동의된 voice profile을 준비했습니다.
When 사용자가 TTS job을 시작합니다.
Then 앱은 wrapper를 호출하고 생성된 audio asset metadata를 표시해야 합니다.

## 12. 검증 기준

제품이 의사결정 가능한 상태가 되려면 다음 항목이 충족돼야 합니다.

1. MVP가 특정 창 선택, 녹화, 로컬 project timeline editing에 집중한다는 점이 명확합니다.
2. Gemini Veo, OpenAI Sora, ElevenLabs는 미래 확장으로만 기록돼 있습니다.
3. Electron 보안 원칙이 구현 기준으로 충분히 구체적입니다.
4. 데이터 모델이 초기 녹화, 로컬 project timeline, 미래 생성 job을 함께 설명합니다.
5. roadmap이 capture/recording에서 시작해 local timeline editing과 provider seam으로 확장됩니다.
6. 테스트 계획과 acceptance criteria가 구현 완료 판단에 쓸 수 있을 만큼 구체적입니다.
7. local voice profile과 local Qwen TTS는 로컬 audio asset 확장으로 표시되고, cloud provider 구현과 섞이지 않습니다.
8. Voicebox, OpenCut, Qwen reference 경계가 dependency나 코드 복사로 오해되지 않습니다.
9. Static clip opacity, scale, position, rotation, volume은 local editing 값으로 저장되고 단일 active Program Monitor preview에만 적용됩니다.
10. Keyframes, transitions, audio mix, local MP4 H.264/AAC export는 구현된 범위로 기록되고, multiple export formats, cloud export, 최종 multitrack render, frame-perfect mastering, AI video provider는 남은 작업으로 분리돼 있습니다.

## 13. 결정 필요 사항

1. 최종 timeline export 포맷은 현재 MP4 H.264/AAC로 고정돼 있습니다. 추가 포맷 지원 여부는 별도 결정이 필요합니다.
2. macOS만 먼저 지원할지, Windows까지 동시에 다룰지 정해야 합니다.
3. 시스템 오디오 녹음을 MVP에 넣을지, 마이크 오디오만 다룰지 정해야 합니다.
4. provider 확장 순서를 정해야 합니다. 후보는 Gemini Veo, OpenAI Sora, ElevenLabs입니다.
5. local Qwen wrapper의 권장 runtime, GPU VRAM, memory 기준을 지원 matrix로 고정할지 정해야 합니다.

## 14. 요약 결정

초기 구현은 capture/recording으로 시작했습니다. 현재 제품 가치는 사용자가 특정 데스크톱 창을 선택하고, 그 창만 안전하게 녹화해 로컬 파일로 저장한 뒤, 로컬 project timeline에서 imported asset, track, clip, trim, split, delete, clip effects, keyframes, transitions, audio mix, playhead, preview, MP4 export를 사용할 수 있다는 점입니다. Clip effects와 v3 timeline 값은 로컬에 저장하고 undo/redo, save, reopen 흐름에 포함하며, Program Monitor는 best-effort preview 평가 surface입니다. 저장된 timeline은 local FFmpeg로 MP4 H.264/AAC export할 수 있습니다. AI 영상 생성과 cloud TTS는 제품 방향에 포함하지만 MVP 구현 범위가 아닙니다. Multiple export formats, cloud export, 최종 multitrack render, frame-perfect mastering은 남은 작업입니다. 로컬 voice profile과 local Qwen TTS는 로컬 audio asset 확장으로 문서화합니다. 구조는 provider adapter와 job model을 통해 확장할 수 있게 설계합니다.
