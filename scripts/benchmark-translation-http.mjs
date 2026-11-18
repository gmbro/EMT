// Synthetic provider + server path benchmark; never reads credentials.
import fs from 'node:fs/promises';import {readSSE} from '../src/sse.mjs';
const origin=process.argv[2]||'https://emt-theta.vercel.app',label=process.argv[3]||'baseline';
let cases=JSON.parse(await fs.readFile('tests/fixtures/meeting-translation-quality.json','utf8'));
if(process.argv.includes('--long'))cases=[{id:'en-long-meeting-paragraph',language:'en-US',context:'A synthetic business meeting about implementation conditions.',glossary:'security review = 보안 검토; contract deposit = 계약금',text:'Before we discuss the implementation schedule, I want to make sure we are clear about the conditions. We have not approved the contract, and we have not promised to start work next Monday. The proposed price is 125,000 US dollars, excluding tax, and the contract deposit is 25,000 dollars rather than 250,000 dollars. Security review must be completed before any implementation date can be confirmed. The six-week schedule is an estimate only, and it does not include an additional three days that testing may require. Please send the updated proposal by tomorrow, with the assumptions and exclusions clearly listed. We also need to know whether the vendor can support 100 users in the pilot and whether access can be revoked immediately when someone leaves the project. If these conditions change, the estimate will need to be reviewed again. This does not mean that we have approved a revised price or committed to a deadline. Could you clarify which team is responsible for each review and whether the current estimate includes the required security checks?'}];
const rows=[];
for(const sample of cases){
 const started=performance.now();let text='',firstTokenMs=null,metadata,complete=false;
 const response=await fetch(origin+'/api/translate',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},signal:AbortSignal.timeout(30000),body:JSON.stringify({text:sample.text,language:sample.language,context:sample.context,glossary:sample.glossary})});
 if(!response.ok){await response.body?.cancel();rows.push({id:sample.id,status:response.status});continue;}
 for await(const e of readSSE(response.body)){if(e.type==='delta'&&e.text){firstTokenMs??=Math.round(performance.now()-started);text+=e.text;}if(e.type==='done'){metadata=e;if(e.text)text=e.text;complete=true;}if(e.type==='error'){rows.push({id:sample.id,error:e.code});break;}}
 rows.push({id:sample.id,firstTokenMs,totalMs:Math.round(performance.now()-started),complete,text,metadata});
}
const result={origin,label,checkedAt:new Date().toISOString(),synthetic:true,cases,rows};await fs.writeFile(`reports/translation-speed-2026-11-19/http-${label}.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify(rows.map(({id,firstTokenMs,totalMs,metadata,complete,status,error})=>({id,firstTokenMs,totalMs,model:metadata?.model,complete,status,error}))));
