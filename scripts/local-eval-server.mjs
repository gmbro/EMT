import { createServer } from 'node:http';
import { loadEnv } from 'vite';
import { createHandler } from '../api/translate.js';
const fast = process.argv.includes('--fast');
const port = fast ? 5175 : 5174;
const handler = createHandler({ getKey: () => loadEnv('development', process.cwd(), '').GEMINI_API_KEY, ...(fast ? { modelOrder: ['gemini-3.6-flash', 'gemini-3.8-flash'] } : {}) });
createServer((req, res) => { void handler(req, res); }).listen(port, '127.0.0.1', () => console.log(`Isolated local evaluation API: http://127.0.0.1:${port}`));
