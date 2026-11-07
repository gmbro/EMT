import fs from 'node:fs/promises';
import {createGoogleLive} from '../src/google-live.js';
import {usageSummary} from '../src/request-metrics.mjs';
const origin='http://localhost:5173', duration=120*60*1000;
const path=process.env.ENDURANCE_REPORT || 'reports/endurance-120min-2026-10-31.json';
const audio=await fs.readFile('reports/long-synthetic.wav');let offset=12,pcm;
while(offset+8<=audio.length){const size=audio.readUInt32LE(offset+4);if(audio.toString('ascii',offset,offset+4)==='data'){pcm=audio.subarray(offset+8,offset+8+size);break;}offset+=8+size+(size%2);}
if(!pcm)throw new Error('PCM fixture missing');
const report={status:'running',synthetic:true,physicalMicrophone:false,targetMinutes:120,startedAt:new Date().toISOString(),updates:0,finals:0,errors:[],recoveries:[],firstSourceMs:null};
let started,live;const save=async()=>fs.writeFile(path,JSON.stringify({...report,elapsedSeconds:started?(performance.now()-started)/1000:0,usage:usageSummary()},null,2));
try{
 live=await createGoogleLive({fetchImpl:(p,o)=>fetch(origin+p,{...o,headers:{...o.headers,Origin:origin}}),onUpdate:()=>{report.updates++;report.firstSourceMs??=Math.round(performance.now()-started);},onFinal:()=>report.finals++,onError:e=>report.errors.push(e.message),onStatus:s=>{if(s)report.recoveries.push(s);}});
 started=performance.now();await save();let n=0,nextSave=started+60000;
 while(performance.now()-started<duration&&!report.errors.length){const part=pcm.subarray(n,n+3200);live.push(Float32Array.from({length:part.length/2},(_,i)=>part.readInt16LE(i*2)/32768));n+=3200;if(n>=pcm.length)n=0;await new Promise(r=>setTimeout(r,100));if(performance.now()>=nextSave){await save();nextSave=performance.now()+60000;}}
 await live.stop();report.status=report.errors.length?'failed':'complete';
}catch(e){report.status='failed';report.errors.push(e.message);}finally{await live?.stop({flush:false});await save();}
console.log(JSON.stringify(report));if(report.status!=='complete')process.exitCode=1;
