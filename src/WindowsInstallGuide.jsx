import React from 'react';
import {Download, Monitor} from 'lucide-react';
export function WindowsInstallGuide(){
 return <details className="windows-install"><summary><Monitor size={16}/>Windows에서 음성 API 비용 없이 받아쓰기<span>설치 안내</span></summary>
  <div className="windows-install-body">
   <p className="install-status">Windows 설치판 · 실기기 검증 전</p>
   <p>Windows 10/11 x64용입니다. NVIDIA GPU 사용을 권장하며, CPU만 사용하면 실시간 회의를 따라가지 못할 수 있어요. Windows ARM은 이 설치판에서 지원하지 않습니다.</p>
   <ol>
    <li><strong>Windows 설치 프로그램 열기</strong><p>여유 공간 15GB 이상을 준비한 뒤 내려받은 EMT-Setup.exe를 더블클릭하세요.</p><a className="install-download" href="/downloads/EMT-Setup.exe" download><Download size={15}/>Windows 설치 프로그램 (.exe)</a></li>
    <li><strong>사용할 장치 선택</strong><p>설치 프로그램이 필요한 Python과 Node.js를 확인하고, 없으면 Windows 패키지 관리자(winget)로 설치합니다. 일반 PC는 Enter, NVIDIA GPU를 사용하려면 GPU를 입력하세요. 모델 다운로드와 확인이 끝나면 회의 화면이 열립니다.</p></li>
    <li><strong>다음부터 시작 메뉴에서 EMT 열기</strong><p>회의 중에는 실행 창을 열어 두세요. 설치가 중단되면 표시된 오류를 확인하고 같은 EXE를 다시 열 수 있습니다.</p></li>
   </ol>
   <details><summary>번역·추천 답변도 사용하려면</summary><p><code>%LOCALAPPDATA%\EMT\app</code> 폴더의 <code>번역키설정.cmd</code>를 열고 <code>GEMINI_API_KEY=</code> 뒤에 본인의 Gemini API 키를 저장한 뒤 로컬 서비스를 다시 실행하세요. 키를 채팅에 보내지 마세요. 받은 ZIP에는 운영 API 키가 포함되지 않습니다.</p><p>받아쓰기만 사용하면 음성 API 요금이 없습니다. 번역·추천 답변·내 발언 영어 변환은 해당 키의 Google API 요금이 발생합니다. 로컬 모드의 음성은 이 노트북에서 처리하고, API 기능을 켜면 텍스트를 Google로 보냅니다.</p></details>
   <p>처음 모델을 준비할 때 수분 이상 걸릴 수 있습니다. CPU/GPU 속도와 Windows 마이크 동작은 아직 실기기에서 확인하지 못했습니다. 구간별 인식 방식으로, 1초 이내 표시를 보장하지 않습니다.</p>
   <a href="/downloads/windows-guide.txt" download>설치·문제 해결 안내 저장</a>
  </div>
 </details>;
}
