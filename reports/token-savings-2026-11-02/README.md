# Token savings verification — 2026-11-02

Local implementation only. No deployment and no speech/model replacement.

Implemented: shorter translation system instruction retaining facts/negations/time/glossary/injection constraints; hidden guide stops scheduling automatic requests; latest guide source omitted from prior context because it is transmitted separately; per-task input/output/thought/cached/unknown diagnostics. Already dispatched requests may still be billed. Exact preview/final cache and first-preview scheduling remain unchanged.

142 automated tests passed; production build passed. Real Google text A/B: 16 authored bilingual cases per variant, alternating order, same current model selection. before input 4544/output400; after input3184/output403. Input -29.93%; estimated text cost -20.55% at $0.75/M input and $3.75/M output. Excludes audio, guide savings, hosting, and billing adjustments. All32 completed, usage known; zero reported thoughts. Regex checks54/56 versus55/56, not a quality score. Output inspection preserved numerals, dates, negations and conditions. KO01 uses 'advance payment' rather than checker 'deposit'; KO05 remains awkward ('at this time today').

First-token medians1168.5ms before /1331.5ms after. Single paired sample set cannot establish latency equivalence; no promise of no slowdown. No new physical microphone, 120-minute, or mobile runtime test. Audio tokens still not fully accounted; no total meeting cost reduction claim. Changing ASR/model or partial-phrase splitting remains gated on matched audio evaluation to avoid accuracy regression.

Recommendation: keep gemini-3.5-transcribe-live + gemini-3.6-flash minimal for default. Evaluate gemini-3.5-flash-lite offline before routing simple utterances. Open-weight comparison candidates: Qwen3-ASR0.6B/1.7B, faster-whisper large-v3/turbo. None has been shown superior to Live Transcribe on this application's audio. Official GPU/Python runtimes are not drop-in browser implementations. NVIDIA Parakeet RNNT multilingual is another self-hosted candidate with distinct licensing and deployment requirements.

Sources:
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite
- https://huggingface.co/Qwen/Qwen3-ASR-0.6B
- https://github.com/SYSTRAN/faster-whisper
- https://docs.nvidia.com/nim/speech/latest/asr/deploy-asr-models/parakeet-rnnt.html
