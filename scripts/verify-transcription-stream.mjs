import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {createGoogleLive} from '../src/google-live.js';
const origin=process.argv[2]||'http://localhost:5173';const records=[],updates=[];let errors=[],connections=0;
const fetchImpl=(path,options)=>{connections++;return fetch(origin+path,{...options,headers:{...options.headers,Origin:origin}});};
const live=await createGoogleLive({fetchImpl,onUpdate:r=>updates.push({language:r.language,original:r.original,ms:r.liveFirstSourceStreamMs,sourcePending:r.sourcePending}),onFinal:r=>records.push(r),onError:e=>errors.push(e.message),rotateAfterMs:6000});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 for(const lang of ['en','ko','en']){
  const wav=await fs.readFile(`public/samples/${lang}.wav`);let offset=12,pcm;while(offset+8<=wav.length){const size=wav.readUInt32LE(offset+4);if(wav.toString('ascii',offset,offset+4)==='data'){pcm=wav.subarray(offset+8,offset+8+size);break;}offset+=8+size+(size%2);}
  for(let n=0;n<pcm.length;n+=3200){const frames=pcm.subarray(n,n+3200);const samples=Float32Array.from({length:frames.length/2},(_,i)=>frames.readInt16LE(i*2)/32768);live.push(samples);await pause(100);}
  for(let n=0;n<30;n++){live.push(new Float32Array(1600));await pause(100);}
 }
 await live.stop();console.log(JSON.stringify({connections,errors,originals:records.map(r=>r.original)}));assert.equal(errors.length,0);assert.equal(records.length,3);assert.equal(records[1].original,'회의 일정을 내일 오후 3시로 변경해 주세요.');assert.ok(records.filter(r=>r.original.includes('meeting agenda')).length===2);assert.ok(connections>=2);
 const result={synthetic:true,origin,forcedRotationMs:6000,connections,errors,records,updates};await fs.writeFile('reports/transcription-handoff-2026-10-29.json',JSON.stringify(result,null,2));console.log(JSON.stringify({connections,errors,originals:records.map(r=>r.original),firstInterim:updates[0]}));
}finally{await live.stop({flush:false});}
