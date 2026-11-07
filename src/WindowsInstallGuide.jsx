import React from 'react';
import {Download, Monitor} from 'lucide-react';
export function WindowsInstallGuide(){
 return <details className="windows-install"><summary><Monitor size={16}/>Windows에서 음성 API 비용 없이 받아쓰기<span>설치 안내</span></summary>
  <div className="windows-install-body">
   <p className="install-status">Windows 설치판 · 실기기 검증 전</p>
   <p>Windows 10/11 x64용입니다. NVIDIA GPU 사용을 권장하며, CPU만 사용하면 실시간 회의를 따라가지 못할 수 있어요. Windows ARM은 이 설치판에서 지원하지 않습니다.</p>
   <ol>
    <li><strong>1. 설치 파일 받기</strong><p>ZIP을 내려받아 문서 폴더 등에 모두 풀어주세요. 모델은 설치 중 공식 Hugging Face에서 별도로 내려받습니다. 여유 공간 15GB 이상을 준비해 주세요.</p><a className="install-download" href="/downloads/emt-qwen-windows.zip" download><Download size={15}/>Windows 설치 ZIP 다운로드</a><a href="/downloads/emt-qwen-windows.sha256" download>SHA-256 확인 파일</a></li>
    <li><strong>2. 실행 환경과 모델 설치</strong><p><a href="https://nodejs.org/en/download" target="_blank" rel="noreferrer">Node.js 22 이상 LTS</a>와 <a href="https://www.python.org/downloads/windows/" target="_blank" rel="noreferrer">Python 3.12 · 64비트</a>를 설치한 뒤, 압축을 푼 폴더의 <code>설치.cmd</code>를 실행하세요. Python 설치 관리자를 사용한다면 먼저 터미널에서 <code>py install 3.12</code>를 실행하세요.</p><p>NVIDIA GPU와 최신 드라이버가 있으면 <code>GPU</code>, 없으면 Enter를 눌러 CPU를 선택하세요. 설치 실패 시 창의 오류를 확인하고 같은 파일을 다시 실행할 수 있어요.</p></li>
    <li><strong>3. 로컬 웹에서 시작</strong><p><code>실행.cmd</code>를 열면 이 노트북의 로컬 웹이 열립니다. 모델 준비가 끝난 뒤 ‘새 회의 시작’을 누르고 마이크를 허용하세요. 사용 중 실행 창은 닫지 마세요.</p><a href="http://127.0.0.1:4174/" target="_blank" rel="noreferrer">설치 후 로컬 웹 열기 ↗</a><p>다음부터는 <code>실행.cmd</code>만 열면 됩니다. 이 공개 웹 주소로 돌아오면 Google 음성 인식을 사용해요.</p></li>
   </ol>
   <details><summary>번역·추천 답변도 사용하려면</summary><p><code>번역키설정.cmd</code>를 열고 <code>GEMINI_API_KEY=</code> 뒤에 본인의 Gemini API 키를 저장한 뒤 로컬 서비스를 다시 실행하세요. 키를 채팅에 보내지 마세요. 받은 ZIP에는 운영 API 키가 포함되지 않습니다.</p><p>받아쓰기만 사용하면 음성 API 요금이 없습니다. 번역·추천 답변·내 발언 영어 변환은 해당 키의 Google API 요금이 발생합니다. 로컬 모드의 음성은 이 노트북에서 처리하고, API 기능을 켜면 텍스트를 Google로 보냅니다.</p></details>
   <p>처음 모델을 준비할 때 수분 이상 걸릴 수 있습니다. CPU/GPU 속도와 Windows 마이크 동작은 아직 실기기에서 확인하지 못했습니다. 구간별 인식 방식으로, 1초 이내 표시를 보장하지 않습니다.</p>
   <a href="/downloads/windows-guide.txt" download>설치·문제 해결 안내 저장</a>
  </div>
 </details>;
}
