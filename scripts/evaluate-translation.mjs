import { mkdir, writeFile } from 'node:fs/promises';
import { EVAL_CASES } from './eval-cases.mjs';
import { readSSE } from '../src/sse.mjs';

const origin = process.argv.find(arg => arg.startsWith('--origin='))?.slice(9) || 'http://localhost:5173';
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname)) throw new Error('Evaluation uses a local API only.');
const baseline = process.argv.includes('--baseline');
const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9) || `reports/translation-${baseline ? 'legacy-local' : 'gemini'}-2026-10-28.json`;
let localModel, modelLanguage;
async function legacy(input) {
  const { env, pipeline } = await import('@huggingface/transformers');
  const { MODEL_CATALOG } = await import('../src/models/catalog.js');
  const catalog = input.language === 'en-US' ? MODEL_CATALOG.multilingual : MODEL_CATALOG.koToEn;
  env.allowRemoteModels = false; env.allowLocalModels = true;
  if (modelLanguage !== input.language) {
    await localModel?.dispose();
    env.localModelPath = `${process.cwd()}/.model-cache/${catalog.revision}/`;
    localModel = await pipeline('translation', catalog.id, { dtype: 'q8', device: 'cpu', local_files_only: true }); modelLanguage = input.language;
  }
  const started = performance.now();
  const result = await localModel(input.text, { ...(input.language === 'en-US' ? { src_lang: 'en', tgt_lang: 'ko' } : {}), num_beams: 1, max_new_tokens: 256, do_sample: false });
  return { text: result[0].translation_text, model: catalog.id, elapsedMs: Math.round(performance.now() - started), firstTokenMs: null };
}
async function cloud(input) {
  const started = performance.now(); let firstTokenMs = null, text = '', complete = false, model;
  const r = await fetch(`${origin}/api/translate`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: input.text, language: input.language, context: input.context || '', glossary: input.glossary || '' }) });
  if (!r.ok) { const j = await r.json(); throw new Error(j.error || `HTTP ${r.status}`); }
  for await (const event of readSSE(r.body)) {
    if (event.type === 'delta') { firstTokenMs ??= Math.round(performance.now() - started); text += event.text; }
    if (event.type === 'error') throw new Error(event.message);
    if (event.type === 'done') { if(typeof event.text==='string')text=event.text; complete = true; model = event.model; }
  }
  if (!complete) throw new Error('Incomplete stream');
  return { text, model, firstTokenMs, elapsedMs: Math.round(performance.now() - started) };
}
if (!baseline) {
  const health = await fetch(`${origin}/api/translate`), body = await health.json();
  if (!health.ok) {
    await mkdir('reports', { recursive: true });
    await writeFile(output, JSON.stringify({ synthetic: true, status: 'blocked', reason: body.code || 'API_UNAVAILABLE', message: body.error, httpStatus: health.status, plannedCases: EVAL_CASES.length, completed: 0, results: [], limitations: 'No Gemini quality or latency score can be inferred because actual inference was unavailable.' }, null, 2) + '\n');
    console.error(body.error || 'Translation unavailable'); process.exit(2);
  }
}
const results = [];
try {
  for (const input of EVAL_CASES) {
    try {
      const result = await (baseline ? legacy(input) : cloud(input));
      const assertions = input.checks.map(pattern => ({ pattern, pass: new RegExp(pattern, 'iu').test(result.text) }));
      const { text: translation, ...metrics } = result;
      results.push({ ...input, source: input.text, translation, ...metrics, assertions });
      console.log(`${input.id}: ${assertions.filter(check => check.pass).length}/${assertions.length} critical checks; first=${result.firstTokenMs ?? 'not measured'}ms; total=${result.elapsedMs}ms`);
    } catch (error) { results.push({ ...input, error: error.message }); console.log(`${input.id}: request failed`); }
  }
} finally { await localModel?.dispose(); }
await mkdir('reports', { recursive: true });
const sorted = values => values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
const percentile = (values, p) => { const v = sorted(values); if (!v.length) return null; if (p === .5 && v.length % 2 === 0) return (v[v.length / 2 - 1] + v[v.length / 2]) / 2; return v[Math.min(v.length - 1, Math.ceil(v.length * p) - 1)]; };
const report = { synthetic: true, runtime: baseline ? 'Node ONNX CPU legacy compatibility models; not browser timings; context/glossary unsupported' : 'Local API proxy to Google Gemini; text only; context/glossary enabled',
  limitations: 'Critical fact regex checks are not a professional translation-quality score. References are authored examples, not certified conference interpreter judgments. Audio recognition, actual meeting acoustics, simultaneous speaker overlap and WER are not measured.',
  summary: { cases: results.length, completed: results.filter(row => !row.error).length, criticalChecksPassed: results.flatMap(row => row.assertions || []).filter(check => check.pass).length, criticalChecksTotal: results.flatMap(row => row.assertions || []).length,
    firstTokenMedianMs: percentile(results.map(row => row.firstTokenMs), .5), firstTokenP95Ms: percentile(results.map(row => row.firstTokenMs), .95), totalMedianMs: percentile(results.map(row => row.elapsedMs), .5), totalP95Ms: percentile(results.map(row => row.elapsedMs), .95) }, results };
await writeFile(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report.summary)); console.log(`Saved ${output}`);
