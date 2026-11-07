"""Local stdin/stdout worker. Audio stays in memory; no listener or audio files."""
import base64, contextlib, json, os, sys, time
from pathlib import Path
os.environ['HF_HOME'] = str(Path(__file__).resolve().parents[2] / '.qwen-models')
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['DO_NOT_TRACK'] = '1'
protocol=sys.stdout
def emit(event):
    print(json.dumps(event, ensure_ascii=False), file=protocol, flush=True)
with contextlib.redirect_stdout(sys.stderr):
    import numpy as np
    from mlx_audio.stt import load
    model = load('mlx-community/Qwen3-ASR-1.7B-bf16')
    # Compile the first inference before exposing readiness. Synthetic silence
    # only; no microphone data, and no warmup output enters the transcript.
    for _ in model.stream_transcribe(np.zeros(12800, dtype=np.float32), max_tokens=4):
        pass
emit({'type':'ready','model':'Qwen3-ASR-1.7B-bf16'})
for line in sys.stdin:
    try:
        req=json.loads(line)
        raw=base64.b64decode(req['pcm'], validate=True)
        if not 320 <= len(raw) <= 256000 or len(raw)%2:
            raise ValueError('invalid audio')
        language={'en-US':'English','ko-KR':'Korean','auto':None}[req.get('language','auto')]
        audio=np.frombuffer(raw,dtype='<i2').astype(np.float32)/32768.0
        start=time.monotonic()
        with contextlib.redirect_stdout(sys.stderr):
            text=''
            for event in model.stream_transcribe(audio, language=language, max_tokens=384):
                if event.text:
                    text+=event.text
                    emit({'type':'delta','text':event.text})
        emit({'type':'done','text':text,'milliseconds':round((time.monotonic()-start)*1000)})
    except Exception as error:
        print(type(error).__name__, file=sys.stderr, flush=True)
        emit({'type':'error','message':'Qwen 음성 인식에 실패했어요.'})
