# LiveSpeak

A Korean-to-English live meeting assistant UI.

## Development

```sh
npm install
npm run dev
```

## Deployment

Import this repository into Vercel. The project uses `npm run build` and publishes `dist/`.

## Environment variables

Vercel project `emt` currently has a secret named `google_api` configured for Production and Preview. Its value is never included in this repository or client bundle. The current static client does not use it.

## Privacy and speech support

The browser SpeechRecognition API has browser-specific behavior and may use a remote recognition service. Do not describe microphone input as on-device/private unless the selected browser implementation is verified to process it locally. The current interface is a prototype; translation and suggested replies are sample content, not connected to a translation model.
