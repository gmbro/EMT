import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {readSSE} from '../src/sse.mjs';
const origin='http://127.0.0.1:4174',results=[];
for(const language of ['en','ko']){
 const wav=await fs.readFile(`public/samples/${language}.wav`);let at=12,pcm;
 while(at+8<=wav.length){const n=wav.readUInt32LE(at+4);if(wav.toString('ascii',at,at+4)==='data'){pcm=wav.subarray(at+8,at+8+n);break;}at+=8+n+(n%2);}
 const started=performance.now();const res=await fetch(origin+'/api/qwen',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({pcm:pcm.toString('base64'),language:'auto'})});
 assert.equal(res.status,200);let firstMs,text='',done;
 for await(const e of readSSE(res.body)){if(e.type==='delta'){firstMs??=performance.now()-started;text+=e.text;}if(e.type==='error')throw new Error(e.message);if(e.type==='done')done=e;}
 assert.ok(done);results.push({language,audioSeconds:pcm.length/32000,text,firstMs:Math.round(firstMs),totalMs:Math.round(performance.now()-started),modelMs:done.milliseconds});
}
const foreign=await fetch(origin+'/api/qwen',{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json'},body:'{}'});assert.equal(foreign.status,403);
const bad=await fetch(origin+'/api/qwen',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({pcm:'x',language:'auto'})});assert.equal(bad.status,400);
const report={synthetic:true,model:'Qwen3-ASR-1.7B-bf16 via MLX',method:'Pre-recorded complete English/Korean WAV via local HTTP, includes inference but not realtime audio capture delay',results,security:{foreignOrigin:foreign.status,invalidAudio:bad.status}};
await fs.writeFile('reports/qwen-2026-11-02/actual-inference.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
