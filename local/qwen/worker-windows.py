"""Windows PyTorch worker: stdin PCM -> stdout JSON; no audio files or sockets."""
import base64
import contextlib
import json
import os
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
MODEL_ID = 'Qwen/Qwen3-ASR-1.7B-hf'
REVISION = 'bcd2b5b7f32b480ab5790554cfa8347f246a14f3'
os.environ['HF_HOME'] = str(ROOT / '.qwen-models')
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['DO_NOT_TRACK'] = '1'

def emit(event):
    print(json.dumps(event, ensure_ascii=False), file=protocol, flush=True)

def decode_request(req):
    if not isinstance(req, dict) or set(req) - {'pcm', 'language'}:
        raise ValueError('fields')
    language = {'en-US':'English', 'ko-KR':'Korean', 'auto':None}[req['language']]
    raw = base64.b64decode(req['pcm'], validate=True)
    if not 320 <= len(raw) <= 256000 or len(raw) % 2:
        raise ValueError('audio')
    return raw, language

def main():
    import numpy as np
    import torch
    from transformers import AutoProcessor, AutoModelForMultimodalLM
    download = '--download' in sys.argv
    if download:
        from huggingface_hub import snapshot_download
        snapshot_download(MODEL_ID, revision=REVISION, allow_patterns=['*.json', '*.jinja', '*.safetensors', 'README.md'])
        print('Model download complete. NVIDIA CUDA available: ' + str(torch.cuda.is_available()), file=sys.stderr)
        return
    # Inference never needs model-network access after the explicit setup step.
    device = 'cuda:0' if torch.cuda.is_available() else 'cpu'
    dtype = torch.float16 if device.startswith('cuda') else torch.float32
    with contextlib.redirect_stdout(sys.stderr):
        processor = AutoProcessor.from_pretrained(MODEL_ID, revision=REVISION, local_files_only=True, trust_remote_code=False)
        model = AutoModelForMultimodalLM.from_pretrained(MODEL_ID, revision=REVISION, local_files_only=True, trust_remote_code=False, use_safetensors=True, dtype=dtype).to(device).eval()
    if '--check' in sys.argv:
        print('Model loaded successfully on '+device, file=sys.stderr)
        return
    emit({'type':'ready', 'model':'Qwen3-ASR-1.7B', 'device':device})
    for line in sys.stdin:
        try:
            raw, language = decode_request(json.loads(line))
            audio = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0
            started = time.monotonic()
            with contextlib.redirect_stdout(sys.stderr), torch.inference_mode():
                inputs = processor.apply_transcription_request(audio=audio, language=language).to(device, dtype)
                output = model.generate(**inputs, max_new_tokens=384, do_sample=False)
                ids = output[:, inputs['input_ids'].shape[1]:]
                text = processor.decode(ids, return_format='transcription_only')[0].strip()
            # Real model output per audio snapshot, without a fake typewriter.
            if text:
                emit({'type':'delta', 'text':text})
            emit({'type':'done', 'text':text, 'milliseconds':round((time.monotonic()-started)*1000)})
        except Exception as error:
            print(type(error).__name__, file=sys.stderr, flush=True)
            emit({'type':'error', 'message':'Qwen 인식에 실패했어요. GPU 메모리와 설치 상태를 확인해 주세요.'})

if __name__ == '__main__':
    protocol = sys.stdout
    main()
