import { detectCaptionLanguage } from './meeting-archive.mjs';
const join=(a,b)=>!a?a+b:!b?a:b.startsWith(' ')||a.endsWith(' ')||/^[,.;!?。？！]/u.test(b)?a+b:a+' '+b;
// Provider finalized chunks may end INSIDE a sentence, including just after a
// negation. Keep that authoritative tail until the sentence is complete.
export function sentenceBoundary(text){
 let boundary=0;
 for(let i=0;i<text.length;i++){
   if(!/[.!?。？！]/u.test(text[i]))continue;
   if(text[i]==='.'&&(/\d/.test(text[i-1]||'')&&/\d/.test(text[i+1]||'')||/(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc)|\b[A-Z])$/u.test(text.slice(0,i))))continue;
   if(i===text.length-1||/[\s"”')A-Z가-힣]/u.test(text[i+1]))return i+1;
 }
 return boundary;
}
export function createStreamingTranscript({onUpdate,onFinal,sample=false,id=()=>crypto.randomUUID(),now=Date.now,clock=()=>performance.now(),language='auto'}) {
 let record=null,tail='',hypothesis='',disposed=false;
 const emit=(text,pending)=>{
   if(!text?.trim()||disposed)return;
   record ||= {id:id(),createdAt:now(),startedAt:clock(),translation:'',input:'voice',sample,live:true,speechModel:'transcribe'};
   record={...record,original:text,language:language==='auto'?detectCaptionLanguage(text):language,sourcePending:pending, stableOriginal:tail};onUpdate({...record});
 };
 return {
   get idle(){return !record;},
   receive(content){
     if(disposed)return;
     if(content.interimInputTranscription?.text){hypothesis=content.interimInputTranscription.text;emit(join(tail,hypothesis),true);}
     if(content.inputTranscription?.text){
       tail=join(tail,content.inputTranscription.text);hypothesis='';
       let boundary=sentenceBoundary(tail);
       if(!boundary && tail.length>360){const clause=tail.slice(0,360).match(/^([\s\S]{120,}[,;，；])\s/u);if(clause)boundary=clause[1].length;}
       while(boundary){const completed=tail.slice(0,boundary).trim(),remaining=tail.slice(boundary).trimStart();emit(completed,false);const final={...record};record=null;tail=remaining;onFinal(final);boundary=sentenceBoundary(tail);}
       if(tail)emit(tail,true);
     }
   },
   flush(){
     if(tail){emit(tail,false);onFinal({...record});record=null;tail='';}
     if(hypothesis){emit(hypothesis,true);onFinal({...record,sourcePending:true,incomplete:true});record=null;}
     tail='';hypothesis='';
   },
   dispose(){disposed=true;record=null;tail='';hypothesis='';},
 };
}
