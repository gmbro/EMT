const sentenceEnd = text => /[.!?。？！]["”']?\s*$/u.test(text);
const sourceMatches = (code, language) => !code || code.toLowerCase().startsWith(language === 'ko-KR' ? 'ko' : 'en');
// One Korean-target stream still supplies Korean source transcripts while
// echoTargetLanguage:false suppresses a Korean-to-English translation entirely.
export function createMeetingCaptionAssembler(options) {
  const english = createLiveCaptionAssembler({ ...options, language:'en-US' });
  const korean = createLiveCaptionAssembler({ ...options, language:'ko-KR' });
  let active = 'en-US';
  return {
    receive(content) {
      const source = content.inputTranscription?.text ? content.inputTranscription : content.interimInputTranscription;
      if (source?.text) {
        const code = source.languageCode?.toLowerCase().split('-')[0];
        const language = code === 'ko' ? 'ko-KR' : code === 'en' ? 'en-US' : code ? null : /[가-힣]/u.test(source.text) ? 'ko-KR' : active;
        if (!language) return;
        if (language !== active) (active === 'en-US' ? english : korean).flush();
        active = language;
      }
      (active === 'en-US' ? english : korean).receive(active === 'en-US' ? content : { ...content, outputTranscription:undefined });
    },
    flush() { english.flush(); korean.flush(); },
    dispose() { english.dispose(); korean.dispose(); },
  };
}
export function createLiveCaptionAssembler({ language, onUpdate, onFinal, sample=false, quietMs=1600, maxSourceChars=1000, maxSegmentMs=20000, schedule=setTimeout, cancel=clearTimeout, now=Date.now, clock=()=>performance.now(), id=()=>crypto.randomUUID() }) {
  let record=null,timer=null,disposed=false,pendingOutput='',accepting=true,hypothesis='';
  const snapshot = () => ({...record,original:record.original+hypothesis,sourcePending:Boolean(hypothesis)});
  const flush = (force=true) => {
    if(timer!==null){cancel(timer);timer=null;}
    if(!record || hypothesis && !force)return;
    const completed=snapshot();record=null;hypothesis='';
    if(completed.original.trim())onFinal({...completed,original:completed.original.trim(),translation:completed.translation.trim()});
  };
  const receive = content => {
    if(disposed)return;
    const input=content.inputTranscription, interim=content.interimInputTranscription;
    const source=input?.text?input:interim;
    const output=language==='ko-KR'?null:content.outputTranscription;
    if(source?.text && !sourceMatches(source.languageCode,language)){accepting=false;pendingOutput='';flush();return;}
    if(source?.text) {
      accepting=true;
      record ||= { id:id(),language,original:'',translation:pendingOutput,createdAt:now(),startedAt:clock(),sample,input:'voice',live:true };
      if(input?.text){record.original+=input.text;hypothesis='';}
      if(interim?.text)hypothesis=interim.text; // Replace speculative snapshots, never append them as committed deltas.
      pendingOutput='';
    }
    if(output?.text && !record && accepting)pendingOutput+=output.text;
    if(output?.text && record) {
      if(language!=='ko-KR')record.translation+=output.text;
      record.liveFirstTranslationMs ??= Math.round(clock()-record.startedAt);
    }
    if(!record)return;
    onUpdate(snapshot()); // No animation queue, debounce, or artificial typewriter delay.
    const complete=sentenceEnd(record.original)&&(language==='ko-KR'||sentenceEnd(record.translation));
    if(!hypothesis && (complete || record.original.length>=maxSourceChars || clock()-record.startedAt>=maxSegmentMs && source?.text)) {flush();return;}
    if(source?.text||output?.text){if(timer!==null)cancel(timer);timer=schedule(()=>flush(false),quietMs);}
    if(content.turnComplete)flush(false);
  };
  return {receive,flush,dispose(){disposed=true;if(timer!==null)cancel(timer);timer=null;record=null;pendingOutput='';hypothesis='';}};
}
export function pcm16Base64(samples) {
  const bytes=new Uint8Array(samples.length*2),view=new DataView(bytes.buffer);
  for(let i=0;i<samples.length;i++){const v=Math.max(-1,Math.min(1,samples[i]));view.setInt16(i*2,Math.round(v<0?v*32768:v*32767),true);}
  let binary='';for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);
  return btoa(binary);
}
export function createPCMFramer(send,size=1600){let buffer=new Float32Array(size),offset=0;return{push(samples){for(let start=0;start<samples.length;){const count=Math.min(size-offset,samples.length-start);buffer.set(samples.subarray(start,start+count),offset);offset+=count;start+=count;if(offset===size){send(buffer);buffer=new Float32Array(size);offset=0;}}},flush(){if(offset){send(buffer.slice(0,offset));offset=0;}}};}
