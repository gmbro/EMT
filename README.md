# LiveSpeak

A privacy-first Korean-to-English meeting assistant prototype.

## Development

```sh
npm install
npm run dev
```

## Deployment

Import this repository into Vercel. The project uses `npm run build` and publishes `dist/`.

## Privacy and speech support

- The client never calls the configured Vercel `google_api` secret.
- Speech recognition starts only when the browser exposes the on-device `SpeechRecognition` APIs, the Korean on-device pack is available, and `processLocally` is set to `true`.
- The current UI does not provide translation or AI reply generation. Those require a local model running on the user's device; no remote fallback is allowed.
- Browser on-device speech recognition support is experimental and browser-dependent. A model pack may require a one-time download before use.
