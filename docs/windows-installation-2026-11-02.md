# Windows Qwen 로컬 설치 안내 배포

## 제공 기능

- 공개 메인 화면에 펼칠 수 있는 1·2·3 설치 안내와 ZIP/체크섬/문제 해결 안내 다운로드.
- 설치.cmd: Python 3.12 x64, Node.js 22+ 및 여유 공간 확인 후 가상 환경에 설치.
  사용자가 선택한 CPU 또는 NVIDIA CUDA 환경의 PyTorch와 별도 잠금 파일을 적용.
- 실행.cmd: localhost 전용 서버와 Windows PyTorch worker를 시작하고 웹 브라우저 열기.
- 번역키설정.cmd: 기존 키를 덮어쓰지 않고 본인의 .env.local을 메모장으로 열기.
- 모델: Qwen/Qwen3-ASR-1.7B-hf, 고정 리비전 bcd2b5b7f32b480ab5790554cfa8347f246a14f3.
- 시작 전 모델 준비 상태 표시. 받아쓰기 전용/추천 답변 끔을 로컬 기본값으로 사용.
  이 상태에서는 Gemini 준비 확인도 호출하지 않아 API 키가 없어도 준비 가능.
- 기존 Mac MLX 경로 유지. 공개 웹은 Google 음성을 사용하며 설치 후 로컬 주소에서만 Qwen 사용.

## 확인한 범위

- 자동 테스트 153개: Windows 실행 경로 선택, API 키 없이 받아쓰기 준비 등 포함.
- Windows x64/Python 3.12 대상으로 CPU/GPU 의존성 해석 및 잠금 파일 생성.
- 실제 Windows용 PyTorch 다운로드 인덱스에서 대상 wheel 확인.
- ZIP 파일 목록, 경로, SHA-256, 파일별 manifest, Python 문법, 잘못된 음성 입력 거절 검증.
- ZIP에 운영 API 키·.env.local·회의 기록·모델 캐시가 포함되지 않는지 검사.
- ZIP을 별도 폴더에 풀어 Mac의 Node 환경에서 웹 빌드 성공. Windows 설치 실행 검증과는 다름.
- 웹 빌드 성공. 기존 CSS 닫는 중괄호 누락을 수정해 해당 구문 경고 제거.
- npm production 의존성 감사 0건. Python 전체 공급망 보안 감사라는 의미는 아님.
- 브라우저에서 안내 펼치기와 실제 ZIP 다운로드 확인. 390px 폭에서 가로 넘침 없음.
- Mac 로컬 페이지의 모델 준비 완료·추천 답변 기본 꺼짐 확인.

## 미검증 및 사용자 확인 순서

Windows 실기기가 없어 .cmd 실행, CUDA 드라이버 호환, 모델 추론, 마이크,
속도, 긴 회의 지속성을 Windows에서 직접 검증하지 못했다. 화면에 시험 설치판임을 표시했다.
CPU만 있는 노트북은 실시간을 따라가지 못할 수 있다. 메모리/속도 부족 시
기존 유한 큐/시간 초과 보호가 중단을 표시하며 Google 음성으로 자동 전환하지 않는다.

1. Windows x64에서 Node.js/Python 준비 → ZIP 전체 압축 해제 → 설치.cmd.
2. 설치 성공 후 실행.cmd → Qwen 준비 완료 표시 확인.
3. 영어/한국어 한 문장을 각각 말하고 최종 원문·종료·재개 확인.
4. 필요하면 본인 Gemini 키를 설정하고 서버 재시작 → 번역/추천 답변 확인.
5. 오류가 있으면 Windows 버전, GPU 이름, 오류 문구만 공유. 키/회의 내용은 공유하지 않음.

## 출처

- https://huggingface.co/Qwen/Qwen3-ASR-1.7B-hf
- https://github.com/QwenLM/Qwen3-ASR
- https://raw.githubusercontent.com/huggingface/transformers/v5.22.1/src/transformers/models/qwen3_asr/processing_qwen3_asr.py
- https://pytorch.org/get-started/locally/
- PyTorch wheel 인덱스: https://download.pytorch.org/whl/cpu/torch/ , https://download.pytorch.org/whl/cu128/torch/

배포 ZIP은 `scripts/package-windows.py`의 허용 목록으로만 생성한다.
모델 가중치는 ZIP에 포함하지 않고 사용자 기기의 명시적 설치 단계에서 다운로드한다.
