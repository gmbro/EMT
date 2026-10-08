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

- The client never calls the configured Vercel `google_api` secret and does not use a translation or AI backend.
- Speech recognition starts only when the browser exposes on-device `SpeechRecognition`, both Korean and English packs are available, and `processLocally` is set to `true`.
- Translation uses the browser's on-device Translator API for Korean-to-English and English-to-Korean. Reply suggestions use the browser's on-device `LanguageModel` API with English-only context, then translate suggested replies locally to Korean.
- Input can come from the microphone or a user-selected browser meeting tab's shared audio. The tab audio option requires browser screen-sharing permission and support for recognizing an audio track; captured video is not read or sent anywhere. Select Korean or English input before listening.
- The app makes no application-level network request containing audio, transcript, translation, or generated replies. The browser may download its required language and AI models on first setup; that download does not include meeting content.
- Browser API and hardware support is limited and changes over time. The app disables listening unless all required local APIs are available. Accuracy, speed, and Korean reply-generation quality depend on browser models and device performance.
