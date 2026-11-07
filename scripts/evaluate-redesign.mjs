import fs from 'node:fs/promises';
import {EVAL_CASES} from './eval-cases.mjs';
import {translateCloud} from '../src/cloud-translation.mjs';
import {usageSummary} from '../src/request-metrics.mjs';
const origin='http://localhost:5173', nativeFetch=globalThis.fetch;
globalThis.fetch=(path,options={})=>nativeFetch(new URL(path,origin),{...options,headers:{...options.headers,Origin:origin}});
const extra=[
 {id:'EN09',language:'en-US',text:'The six-week estimate excludes the security review. We cannot confirm the start date until approval.',checks:['6|여섯','보안','제외|포함.{0,8}않','승인']},
 {id:'EN10',language:'en-US',text:'We may consider a pilot, but we have not agreed to a paid subscription.',checks:['시범|파일럿','유료','않|없|아닙']},
 {id:'KO09',language:'ko-KR',task:'speech',text:'보안 검토 기간이 6주 일정에 포함되는지 확인하고 싶습니다. 아직 시작 날짜를 확정한 것은 아닙니다.',checks:['six|6','security','not|haven.t']},
 {id:'KO10',language:'ko-KR',task:'speech',text:'자동 갱신에는 동의하지 않습니다. 시범 운영 결과를 검토한 뒤 구독 여부를 결정하겠습니다.',checks:['not|don.t','automatic|auto','pilot|trial']}
];
const results=[];
for(const input of [...EVAL_CASES,...extra]){
 let retries=0;
 try{const r=await translateCloud(input.text,input.language,{task:input.task||'translate',context:input.context||'',glossary:input.glossary||'',onRetry:()=>retries++});results.push({id:input.id,source:input.text,translation:r.text,firstTokenMs:r.firstTokenMs,totalMs:r.milliseconds,usage:r.usage,retries,checks:input.checks.map(pattern=>({pattern,pass:new RegExp(pattern,'iu').test(r.text)}))});console.log(`${input.id}: ${r.firstTokenMs}ms, retries=${retries}`);}
 catch(e){results.push({id:input.id,error:e.message,code:e.code,retries});console.log(`${input.id}: failed ${e.code}`);}
}
const guides=[];
for(const replyCount of [1,3]){
 try{const r=await translateCloud('Could you approve the six-week implementation timeline today?','en-US',{task:'replies',replyCount,context:'Security review must be completed before implementation. User has not approved the timeline.',retries:0});guides.push({count:replyCount,output:JSON.parse(r.text),usage:r.usage,firstTokenMs:r.firstTokenMs});}catch(e){guides.push({count:replyCount,error:e.message});}
}
const values=results.map(r=>r.firstTokenMs).filter(Number.isFinite).sort((a,b)=>a-b);
const report={checkedAt:new Date().toISOString(),synthetic:true,runtime:'Local API → Google; text requests, not audio end-to-end latency',cases:results.length,completed:results.filter(r=>!r.error).length,medianFirstTokenMs:values.length%2?values[Math.floor(values.length/2)]:(values[values.length/2-1]+values[values.length/2])/2,p95FirstTokenMs:values[Math.ceil(values.length*.95)-1],usage:usageSummary(),results,guides,limitations:'Regex fact checks and developer review, not certified interpreter scoring. No cost reduction percentage established; no physical mic/mobile or 30-minute real-time session measured.'};
await fs.writeFile('reports/redesign-evaluation-2026-10-29.json',JSON.stringify(report,null,2));console.log(JSON.stringify({completed:report.completed,cases:report.cases,median:report.medianFirstTokenMs,p95:report.p95FirstTokenMs,usage:report.usage}));
