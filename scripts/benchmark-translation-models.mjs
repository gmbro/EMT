// Synthetic text only. Keys stay in local environment and are never reported.
import fs from 'node:fs/promises';
import { readSSE } from '../src/sse.mjs';
try { process.loadEnvFile('.env.local'); } catch {}
const key=(process.env.google_api||process.env.GEMINI_API_KEY||process.env.GOOGLE_API_KEY||'').trim();
if(!key)throw new Error('Local Google key required');
const source=await fs.readFile('api/translate.js','utf8');
const system=source.match(/const SYSTEM = `([\s\S]*?)`;/)[1];
const candidates=[{model:'gemini-3.8-flash',thinking:'low'},{model:'gemini-3.6-flash',thinking:'minimal'},{model:'gemini-3.5-flash-lite',thinking:'minimal'}];
const fixturePath='tests/fixtures/meeting-translation-quality.json';
let cases;
try{cases=JSON.parse(await fs.readFile(fixturePath,'utf8'));}catch{cases=[{id:'negation',text:'We have not approved the contract. The deposit is $25,000, not $250,000. Please send the revised schedule by tomorrow.',language:'en-US',context:'Contract review meeting.'}];}
const quick=process.argv.includes('--quick');if(quick)cases=cases.slice(0,1);
const rows=[];
for(const sample of cases){
 await Promise.all(candidates.map(async candidate=>{
  const started=performance.now();let firstTokenMs=null,text='',usage=null,complete=false;
  try{
   const r=await fetch('https://generativelanguage.googleapis.com/v1beta/interactions',{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},signal:AbortSignal.timeout(30000),body:JSON.stringify({model:candidate.model,stream:true,store:false,system_instruction:system,input:JSON.stringify({target_language:sample.language==='en-US'?'Korean':'English',prior_context:sample.context||'',glossary:sample.glossary||'',transcript_to_translate:sample.text,incomplete_draft:false}),generation_config:{thinking_level:candidate.thinking,max_output_tokens:Math.min(2048,Math.max(256,sample.text.length*3))}})});
   if(!r.ok){await r.body?.cancel();rows.push({...candidate,id:sample.id,status:r.status});return;}
   for await(const e of readSSE(r.body,{eventTypes:true})){
    if(e.event_type==='step.delta'&&e.delta?.type==='text'){if(e.delta.text){firstTokenMs??=Math.round(performance.now()-started);text+=e.delta.text;}}
    if(['interaction.complete','interaction.completed'].includes(e.event_type)){complete=true;const u=e.interaction?.usage||e.usage||{};usage=Object.fromEntries(['total_input_tokens','total_output_tokens','total_thought_tokens','total_tokens'].filter(k=>Number.isFinite(u[k])).map(k=>[k,u[k]]));break;}
   }
   rows.push({...candidate,id:sample.id,firstTokenMs,totalMs:Math.round(performance.now()-started),complete,text,usage});
  }catch(error){rows.push({...candidate,id:sample.id,error:error.name});}
 }));
 console.log(JSON.stringify(rows.filter(row=>row.id===sample.id)));
}
await fs.writeFile(`reports/translation-speed-2026-11-19/models${quick?'-quick':process.argv.includes('--final')?'-final':''}.json`,JSON.stringify({synthetic:true,checkedAt:new Date().toISOString(),cases,rows},null,2));
