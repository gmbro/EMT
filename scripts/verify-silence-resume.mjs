import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createGoogleLive} from '../src/google-live.js';
import {usageSummary} from '../src/request-metrics.mjs';
const origin=process.env.CHECK_ORIGIN||'http://localhost:5173', rows=[],errors=[],statuses=[];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const live=await createGoogleLive({fetchImpl:(path,opts)=>fetch(origin+path,{...opts,headers:{...opts.headers,Origin:origin}}),onUpdate:()=>{},onFinal:r=>rows.push(r),onError:e=>errors.push(e.message),onStatus:s=>statuses.push(s)});
async function sample(language){const wav=await fs.readFile(`public/samples/${language}.wav`);let offset=12,pcm;while(offset+8<=wav.length){const n=wav.readUInt32LE(offset+4);if(wav.toString('ascii',offset,offset+4)==='data'){pcm=wav.subarray(offset+8,offset+8+n);break;}offset+=8+n+(n%2);}for(let n=0;n<pcm.length;n+=3200){const part=pcm.subarray(n,n+3200);live.push(Float32Array.from({length:part.length/2},(_,i)=>part.readInt16LE(i*2)/32768));await wait(100);}}
try{
 await sample('en');for(let i=0;i<250;i++){live.push(new Float32Array(1600));await wait(100);}await sample('ko');for(let i=0;i<20;i++){live.push(new Float32Array(1600));await wait(100);}await live.stop();
 const result={synthetic:true,physicalMicrophone:false,origin,rows,errors,statuses,usage:usageSummary()};
 await fs.writeFile(`reports/cost-reliability-2026-10-30/silence-${origin.startsWith('https')?'production':'local'}.json`,JSON.stringify(result,null,2));
 console.log(JSON.stringify({errors,statuses,text:rows.map(r=>r.original),audio:result.usage.audio}));
 assert.equal(errors.length,0);assert.ok(rows.some(r=>/agenda/i.test(r.original)));assert.ok(rows.some(r=>r.language==='ko-KR'&&!r.sourcePending));assert.ok(result.usage.audio.sentSeconds<result.usage.audio.capturedSeconds*.6);
}finally{await live.stop({flush:false});}
