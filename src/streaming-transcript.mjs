import { detectCaptionLanguage, supportedCaptionWord } from './meeting-archive.mjs';
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
// Only split authoritative input. A following subject helps distinguish a
// new clause from a list, a decimal or an unfinished condition.
function meaningBoundary(text,language) {
 let sentence=sentenceBoundary(text);
 if(language==='auto'){
   // A standalone English phrase followed by Korean can finish without punctuation.
   const transition=/\s+(?=[가-힣])/u.exec(text);
   if(transition && /^[^가-힣]*[a-z](?:[^가-힣]*)$/i.test(text.slice(0,transition.index)) &&
      (text.slice(0,transition.index).match(/[a-z]+/gi)||[]).length>=2){
     sentence=sentence?Math.min(sentence,transition.index):transition.index;
   }
 }
 const clause=/[;,]\s+(?=(?:(?:but|and|so|however)\s+)?(?:we|they|you|I|it|our team)\s+\w+)/ig;
 for(const match of text.matchAll(clause)){
   const prefix=text.slice(0,match.index);
   if(prefix.trim().split(/\s+/).length<4 || /^(?:if|unless|although|when|provided|because)\b/i.test(prefix.trim()))continue;
   return sentence ? Math.min(sentence,match.index+1) : match.index+1;
 }
 return sentence;
}
function bilingualText(part) {
 if (!part?.text || supportedCaptionWord(part.text,part.languageCode)) return part?.text || '';
 return part.text.split(/(\s+)/).filter(word=>supportedCaptionWord(word,part.languageCode)).join('').trim();
}
export function createStreamingTranscript({onUpdate,onFinal,onDiscard,sample=false,id=()=>crypto.randomUUID(),now=Date.now,clock=()=>performance.now(),language='auto'}) {
 let turnId=null,record=null,tail='',hypothesis='',disposed=false;
 const emit=(text,pending)=>{
   if(!text?.trim()||disposed)return;
   record ||= {id:id(),createdAt:now(),startedAt:clock(),translation:'',input:'voice',sample,live:true,speechModel:'transcribe'};
   turnId ||= record.id;
   record={...record,turnId,original:text,language:language==='auto'?detectCaptionLanguage(text):language,sourcePending:pending, stableOriginal:tail};onUpdate({...record});
 };
 return {
   get idle(){return !record;},
   receive(content){
     if(disposed)return;
     if(content.interimInputTranscription?.text || content.inputTranscription?.text){
       hypothesis=bilingualText(content.interimInputTranscription);
       if(!tail && !hypothesis && !bilingualText(content.inputTranscription) && record){onDiscard?.(record.id);record=null;}
       if(content.interimInputTranscription?.text)emit(join(tail,hypothesis),true);
     }
     if(content.inputTranscription?.text){
       tail=join(tail,bilingualText(content.inputTranscription));hypothesis='';
       let boundary=meaningBoundary(tail,language);
       while(boundary){const completed=tail.slice(0,boundary).trim(),remaining=tail.slice(boundary).trimStart();emit(completed,false);const final={...record};record=null;tail=remaining;onFinal(final);boundary=meaningBoundary(tail,language);}
       if(tail)emit(tail,true);
     }
   },
   flush(){
     if(tail){emit(tail,false);onFinal({...record});record=null;tail='';}
     if(hypothesis){emit(hypothesis,true);onFinal({...record,sourcePending:true,incomplete:true});record=null;}
     turnId=null;tail='';hypothesis='';
   },
   dispose(){disposed=true;record=null;tail='';hypothesis='';},
 };
}

// Keep the original bilingual record intact. Embedded English product names
// alone do not warrant a separate translation under Korean speech.
export function englishForTranslation(original, language) {
 if(!/[가-힣]/u.test(original))return language==='ko-KR'?'':original;
 const passages=original.match(/[A-Za-z0-9][^가-힣ㄱ-ㅎㅏ-ㅣ\n]*/gu)||[];
 return passages.map(part=>part.trim()).filter(part=>language!=='ko-KR'||/\b[A-Za-z]+(?:['’-][a-z]+)?\s+[a-z]+\b/.test(part)).join(' ');
}
