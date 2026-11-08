import {qwenLocalPlugin} from './local/qwen/vite-plugin.mjs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createHandler } from './api/translate.js';
import { createHandler as createLiveHandler } from './api/live-token.js';

const productionHeaders = Object.fromEntries(JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url))).headers.find(rule => rule.source === '/(.*)').headers.map(header => [header.key, header.value]));
// Identify the exact deployed sources even when deploying an uncommitted checkout.
// Environment files and meeting records are deliberately excluded.
const sourceRoot = fileURLToPath(new URL('./', import.meta.url));
const sourceFiles = [...['src', 'api'].flatMap(directory => readdirSync(new URL(`./${directory}/`, import.meta.url), { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && /\.(?:js|jsx|mjs|css|json)$/.test(entry.name)).map(entry => `${entry.parentPath}/${entry.name}`.slice(sourceRoot.length))), 'package.json', 'index.html', 'public/model-licenses.md', 'public/fonts/PretendardVariable-9599f12fd42f.woff2', 'public/fonts/OFL.txt', 'public/fonts/source.json', 'vite.config.js', 'vercel.json'].sort();
const sourceDigest = createHash('sha256');
const fileDigests = sourceFiles.map(path => {
  const body = readFileSync(new URL(`./${path}`, import.meta.url));
  sourceDigest.update(path).update('\0').update(body).update('\0');
  return { path, sha256: createHash('sha256').update(body).digest('hex') };
});
const sourceHash = sourceDigest.digest('hex');
const release = { buildId: sourceHash.slice(0, 12), sourceHash, files: fileDigests, builtAt: new Date().toISOString(), speech: process.env.DEEPGRAM_API_KEY?'deepgram-nova-3':'google-live-transcribe', translation: 'gemini-3.6-flash' };

const localTranslation = () => {
  const getKey = () => {
    const env = loadEnv('development', process.cwd(), '');
    return process.env.google_api || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || env.google_api || env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  };
  const handler = createHandler({ getKey });
  const liveHandler = createLiveHandler({ getKey, getDeepgramKey:()=>process.env.DEEPGRAM_API_KEY||loadEnv('development',process.cwd(),'').DEEPGRAM_API_KEY });
  return { name: 'local-gemini-translation', configureServer(server) {
    // ONNX imports a same-origin public ESM file with ?import. Vite's normal
    // transform route rejects imports from public/, so serve only these pinned
    // runtime modules before the transform middleware. No arbitrary file path.
    server.middlewares.use((req, res, next) => {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (!/^\/runtime\/ort-wasm-simd-threaded(?:\.asyncify)?\.mjs$/.test(path) || !['GET', 'HEAD'].includes(req.method)) return next();
      try {
        const body = readFileSync(new URL(`./public${path}`, import.meta.url));
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Length', body.length);
        res.end(req.method === 'HEAD' ? undefined : body);
      } catch { next(); }
    });
    server.middlewares.use('/api/translate', (req, res) => { void handler(req, res); });
    server.middlewares.use('/api/live-token', (req, res) => { void liveHandler(req, res); });
  } };
};

export default defineConfig(({command})=>({
  plugins: [qwenLocalPlugin(command==='serve'&&process.env.EMT_LOCAL_QWEN==='1'), react(), localTranslation(), { name: 'release-metadata', generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(release) });
  } }],
  define: { __LOCAL_QWEN__: JSON.stringify(command==='serve'&&process.env.EMT_LOCAL_QWEN==='1'), __BUILD_ID__: JSON.stringify(release.buildId) },
  worker: { format: 'es' },
  preview: { headers: productionHeaders },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
}));
