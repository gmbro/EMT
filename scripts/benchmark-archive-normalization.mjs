// CPU-only synthetic archive comparison, not end-to-end website latency.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {loadMeetings,normalizeMeetings} from '../src/meeting-archive.mjs';
const sessions=Array.from({length:5},(_,n)=>({id:`synthetic-${n}`,createdAt:new Date(1795046400000+n*1000).toISOString(),records:Array.from({length:2000},(_,i)=>({id:`${n}-${i}`,original:`Original ${i}. `+'Review conditions before approval. '.repeat(6),translation:`번역 ${i}. `+'승인 전 조건을 검토해 주세요. '.repeat(6),language:'en-US',status:'complete',createdAt:1795046400000+i,translationBatch:true})),speeches:[],replies:[]}));
const before=[],after=[];
for(let n=0;n<7;n++){
 let started=performance.now();const a=loadMeetings({getItem:()=>JSON.stringify({version:1,sessions})});before.push(performance.now()-started);
 started=performance.now();const b=normalizeMeetings(sessions);after.push(performance.now()-started);
 assert.deepEqual(a,b);assert.equal(b.reduce((sum,s)=>sum+s.records.length,0),10000);
}
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const report={synthetic:true,cpuOnly:true,records:10000,runs:7,oldJsonRoundtripMs:before,directStructuredMs:after,medianBeforeMs:median(before),medianAfterMs:median(after)};
await fs.writeFile('reports/web-performance-2026-11-19/archive-cpu.json',JSON.stringify(report,null,2));console.log(JSON.stringify({medianBeforeMs:report.medianBeforeMs,medianAfterMs:report.medianAfterMs,records:report.records}));
