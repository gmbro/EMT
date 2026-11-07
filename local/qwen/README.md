# Qwen local speech recognition

This development mode runs Qwen3-ASR 1.7B on this Apple Silicon Mac using MLX.
It does not change the public Vercel deployment. Other computers and phones do
not acquire this Mac's inference service by opening the public website.

## Run on the configured Mac

```sh
npm run dev:qwen
```

Open http://127.0.0.1:4174/ and start a new meeting. Allow microphone access.
The first model load takes time; retry starting once the model has loaded.
The Python environment and model have already been installed on this Mac.
Stop the terminal process to stop both Vite and the Qwen worker.

## Recreate the Python environment (Apple Silicon)

Use Python 3.12 and create `.venv-qwen` in the repository root, then install
`local/qwen/requirements-macos.lock` into that environment. The worker downloads
`mlx-community/Qwen3-ASR-1.7B-bf16` on first startup into `.qwen-models/` (~3.8 GB).
This is a community MLX conversion of Qwen's model, not a browser ONNX model.
Do not commit the environment, model files, or `.env.local`.

## Data and cost

- Audio is sent only to this computer's loopback endpoint and held in memory.
- The worker has no network listener; Vite accepts only loopback peers and
  localhost/127.0.0.1 hosts. Audio POSTs require matching Origin.
- There is no automatic fallback to Google speech recognition in Qwen mode.
- Existing Gemini text translation and reply guides retain their API costs.
- Qwen inference has no per-token API charge here, but uses this Mac's GPU,
  memory and power. The first model download needs internet access.
- Existing meeting-history persistence remains enabled in this browser origin.
  Records at localhost:4173 and 127.0.0.1:4174 are separate browser storage.

## Streaming and validation boundaries

The adapter requests the first cumulative audio preview at 800 ms, a second at
1.6 seconds, then every 1.5 seconds. It finishes on 700 ms
silence, and segments continuous speech at 8 seconds. This is chunked decoding,
not persistent native streaming state. It may revise interim text and may cut
words at segment boundaries. Final segments are queued, never silently dropped;
if the queue exceeds six tasks, recognition stops with an explicit error.

On 2026-11-02, actual English and Korean fixture audio was transcribed on this
Mac. After startup warmup, earlier previews and suppression of replayed prefixes,
two independent English browser fixtures first displayed text after 2,454 and
2,468 ms (3,253 ms before this change). First visible Korean translation took
3,895 and 3,640 ms (4,877 ms before). These are short synthetic examples, not
a population benchmark; they include leading silence in the fixture audio.
The one-second source target is NOT met. This is not evidence of 120-minute
stability, real microphone accuracy, mobile support or cross-device latency.
See `reports/latency-2026-11-02/` for new browser measurements and
`reports/qwen-2026-11-02/` for HTTP inference checks. HTTP fixture timings measure
already-complete audio requests, not microphone-to-text latency.

The default production build still uses Google speech. Publishing the static
web app cannot deploy this Python/MLX process to Vercel functions. Public Qwen
requires a separately provisioned inference environment and a reviewed access
and audio-transfer policy.
