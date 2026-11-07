import fs from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {loadEnv} from 'vite';
import {createHandler} from '../api/translate.js';
import {EVAL_CASES} from './eval-cases.mjs';
const root=new URL('../',import.meta.url);
let baseline=await fs.readFile(new URL('reports/token-savings-2026-11-02/baseline-api.txt',root),'utf8');
baseline=baseline.replaceAll("'../src/",`'${new URL('src/',root).href}`);
const old=await import('data:text/javascript;base64,'+Buffer.from(baseline).toString('base64'));
const env=loadEnv('development',process.cwd(),'');
const getKey=()=>env.google_api||env.GEMINI_API_KEY||env.GOOGLE_API_KEY;
const handlers={before:old.createHandler({getKey}),after:createHandler({getKey})};
class Reply extends EventEmitter{body='';statusCode=200;setHeader(){}flushHeaders(){}write(s){this.body+=s;}end(s=''){this.body+=s;this.writableEnded=true;}}
const rows=[];
for(const [i,c] of EVAL_CASES.entries())for(const variant of i%2?['after','before']:['before','after']){
 const reply=new Reply();await handlers[variant]({method:'POST',body:{text:c.text,language:c.language,context:c.context||'',glossary:c.glossary||''},headers:{host:'localhost:4173',origin:'http://localhost:4173','content-type':'application/json'}},reply);
 const events=reply.body.split('\n').filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6)));
 const done=events.find(e=>e.type==='done');const output=done?.text??events.filter(e=>e.type==='delta').map(e=>e.text).join('');
 rows.push({id:c.id,variant,status:reply.statusCode,complete:!!done,output,usage:done?.usage,firstTokenMs:done?.firstTokenMs,checks:c.checks.map(p=>({pattern:p,pass:new RegExp(p,'iu').test(output)}))});
 console.log(c.id,variant,done?'complete':'failed');
}
const summary={};for(const variant of ['before','after']){const r=rows.filter(r=>r.variant===variant),times=r.map(r=>r.firstTokenMs).filter(Number.isFinite).sort((a,b)=>a-b);summary[variant]={completed:r.filter(r=>r.complete).length,input:r.reduce((n,r)=>n+(r.usage?.total_input_tokens||0),0),output:r.reduce((n,r)=>n+(r.usage?.total_output_tokens||0),0),thought:r.reduce((n,r)=>n+(r.usage?.total_thought_tokens||0),0),unknown:r.filter(r=>!r.usage).length,checksPassed:r.flatMap(r=>r.checks).filter(c=>c.pass).length,medianFirstTokenMs:(times[7]+times[8])/2};}
await fs.writeFile(new URL('reports/token-savings-2026-11-02/prompt-ab.json',root),JSON.stringify({synthetic:true,method:'16 paired text inputs, alternating order, same model; not audio latency or independent quality scoring',summary,rows},null,2));console.log(JSON.stringify(summary));
