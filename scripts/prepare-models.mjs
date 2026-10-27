import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, rename, rm, copyFile, readFile, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL_CATALOG, MODEL_ASSETS } from '../src/models/catalog.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const cacheRoot = join(root, '.model-cache');
const outputRoot = join(root, 'public', 'models');
const require = createRequire(import.meta.url);
const verifyOnly = process.argv.includes('--verify-only');

async function matches(path, expected) {
  try {
    if ((await stat(path)).size !== expected.bytes) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest('hex') === expected.sha256;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function download(model, asset, target) {
  await mkdir(dirname(target), { recursive: true });
  const url = `https://huggingface.co/${model.id}/resolve/${model.revision}/${asset.path}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const temporary = `${target}.part-${process.pid}-${randomUUID()}`;
    let sink;
    try {
      console.log(`[models] Download ${model.id}/${asset.path} (${(asset.bytes / 1e6).toFixed(1)} MB), attempt ${attempt}`);
      const response = await fetch(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${url}`);
      sink = createWriteStream(temporary, { flags: 'wx' });
      // Keep every asset out of the cache until the whole pinned file validates.
      const hash = createHash('sha256');
      let bytes = 0;
      await pipeline(response.body, async function* (source) {
        for await (const chunk of source) {
          bytes += chunk.byteLength;
          if (bytes > asset.bytes) throw new Error(`Unexpected size for ${asset.path}`);
          hash.update(chunk);
          yield chunk;
        }
      }, sink);
      sink = null;
      if (bytes !== asset.bytes || hash.digest('hex') !== asset.sha256) {
        throw new Error(`SHA-256 or byte length mismatch for ${model.id}/${asset.path}`);
      }
      await rename(temporary, target);
      return;
    } catch (error) {
      sink?.destroy();
      await rm(temporary, { force: true });
      if (attempt === 3) throw error;
      console.warn(`[models] Retry after ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
}

async function prepareAsset({ model, asset }) {
  const cached = join(cacheRoot, model.revision, model.id, asset.path);
  const output = join(outputRoot, model.localId, asset.path);
  if (verifyOnly) {
    if (!(await matches(output, asset))) throw new Error(`Missing or invalid public asset: ${output}`);
    return;
  }
  if (!(await matches(cached, asset))) await download(model, asset, cached);
  await mkdir(dirname(output), { recursive: true });
  await copyFile(cached, output);
}

async function prepareRuntime() {
  // Resolve the exact installed ORT version used by Transformers.js. Neither
  // runtime JavaScript nor WASM should be fetched from a third-party CDN.
  const transformersDist = dirname(require.resolve('@huggingface/transformers'));
  const transformersRequire = createRequire(require.resolve('@huggingface/transformers'));
  const ortDist = dirname(transformersRequire.resolve('onnxruntime-web'));
  const runtimeRoot = join(root, 'public', 'runtime');
  if (!verifyOnly) await mkdir(runtimeRoot, { recursive: true });
  const files = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'];
  for (const name of files) {
    let source = join(ortDist, name);
    try { await stat(source); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      source = join(transformersDist, name);
    }
    const content = await readFile(source);
    const expected = { bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') };
    const target = join(runtimeRoot, name);
    if (verifyOnly) {
      if (!(await matches(target, expected))) throw new Error(`Runtime does not match installed package: ${name}`);
    } else {
      await copyFile(source, target);
    }
  }
  const packageData = JSON.parse(await readFile(join(ortDist, '..', 'package.json'), 'utf8'));
  if (!verifyOnly) {
    await writeFile(join(runtimeRoot, 'version.json'), JSON.stringify({ onnxruntime: packageData.version, build: 'asyncify' }) + '\n');
    for (const name of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) await rm(join(runtimeRoot, name), { force: true });
  }
}

const queue = Object.entries(MODEL_CATALOG).flatMap(([key, model]) => MODEL_ASSETS[key].map(asset => ({ model, asset })));
let cursor = 0;
await Promise.all(Array.from({ length: 3 }, async () => {
  while (cursor < queue.length) await prepareAsset(queue[cursor++]);
}));
await prepareRuntime();
if (!verifyOnly) {
  await writeFile(join(outputRoot, 'catalog.json'), JSON.stringify(MODEL_CATALOG, null, 2) + '\n');
}
const total = Object.values(MODEL_CATALOG).reduce((sum, model) => sum + model.bytes, 0);
console.log(`[models] ${verifyOnly ? 'Verified' : 'Prepared'} ${queue.length} pinned model files (${(total / 1e6).toFixed(1)} MB) and the same-origin ONNX runtime.`);
