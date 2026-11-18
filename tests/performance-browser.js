// Development-only measurement UI. Never imports or publishes actual meeting data.
import '../src/main.jsx';
import {createMeetingStore} from '../src/meeting-store.mjs';
const report={synthetic:true,interactionPaintMs:[],longTasks:[],events:[],firstUIReadyMs:null,transcriptMutations:0};
const output=document.getElementById('performance-output');
const render=()=>{output.textContent=JSON.stringify(report,null,2);};
new MutationObserver(entries=>{report.transcriptMutations+=entries.filter(e=>e.target.closest?.('.turn-scroll')).length;}).observe(document.getElementById('root'),{subtree:true,childList:true,characterData:true});
try{new PerformanceObserver(list=>{for(const e of list.getEntries())report.longTasks.push(Math.round(e.duration));render();}).observe({type:'longtask',buffered:true});}catch{}
try{new PerformanceObserver(list=>{for(const e of list.getEntries())if(e.interactionId)report.events.push({type:e.name,duration:e.duration,inputDelay:Math.round(e.processingStart-e.startTime)});render();}).observe({type:'event',durationThreshold:16,buffered:true});}catch{}
document.addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button||button.closest('#performance-check'))return;
 const name=button.getAttribute('aria-label')||button.textContent.trim();
 const started=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>{report.interactionPaintMs.push({name,ms:Math.round(performance.now()-started)});render();}));
},true);
document.addEventListener('input',event=>{
 if(!event.target.matches('textarea,input')||event.target.closest('#performance-check'))return;
 const started=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>{report.interactionPaintMs.push({name:event.target.id||event.target.getAttribute('aria-label')||'input',ms:Math.round(performance.now()-started)});render();}));
},true);
const ready=setInterval(()=>{if(document.querySelector('.archive-home')){clearInterval(ready);report.firstUIReadyMs=Math.round(performance.now());render();}},20);
document.getElementById('reset-performance').onclick=()=>{report.interactionPaintMs=[];report.longTasks=[];report.events=[];report.transcriptMutations=0;render();};
document.getElementById('seed-performance').onclick=async()=>{
 const store=createMeetingStore();await store.load();const createdAt='2026-11-19T01:00:00.000Z';
 const records=Array.from({length:2000},(_,i)=>({id:`perf-${i}`,language:'en-US',original:`Synthetic statement ${i+1}. `+'We have not approved the contract. Security review is required before implementation. '.repeat(2),translation:`검증용 발언 ${i+1}. `+'계약을 아직 승인하지 않았습니다. 도입 전에 보안 검토가 필요합니다. '.repeat(2),status:'complete',createdAt:Date.parse(createdAt)+i,translationBatch:true}));
 await store.put({id:'performance-synthetic-2000',createdAt,records,speeches:[],replies:[]});await store.close();location.reload();
};
render();
