import {translationChunks} from './translation-chunks.mjs';
export function createDraftTranslator(){
 const cache=new Map();
 return {clear:()=>cache.clear(),async translate(text,{translateChunk,onText,signal}){
   const output=[];
   for(const chunk of translationChunks(text,900)){
     if(signal?.aborted)throw Object.assign(new Error('cancelled'),{name:'AbortError'});
     let result=cache.get(chunk);
     if(!result){result=await translateChunk(chunk,partial=>onText?.([...output,partial].join('\n')));if(signal?.aborted)throw Object.assign(new Error('cancelled'),{name:'AbortError'});if(!result?.trim())throw new Error('empty draft');cache.set(chunk,result);if(cache.size>200)cache.delete(cache.keys().next().value);}
     output.push(result);onText?.(output.join('\n'));
   }
   return output.join('\n');
 }};
}
