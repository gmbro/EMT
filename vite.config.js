import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const productionHeaders = Object.fromEntries(JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url))).headers[0].headers.map(header => [header.key, header.value]));

export default defineConfig({
  plugins: [react()],
  define: { __BUILD_ID__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'local') },
  worker: { format: 'es' },
  preview: { headers: productionHeaders },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
