import {loadEnv} from 'vite';
import fs from 'node:fs/promises';
const env=loadEnv('development',process.cwd(),''),key=env.GEMINI_API_KEY||env.google_api||env.GOOGLE_API_KEY;
const setup={model:'models/gemini-3.5-transcribe-live',sessionResumption:{},contextWindowCompression:{slidingWindow:{}},generationConfig:{responseModalities:['TEXT']},inputAudioTranscription:{languageCodes:['en-US','ko-KR']}};
const res=await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens',{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify({uses:1,expireTime:new Date(Date.now()+1800000).toISOString(),newSessionExpireTime:new Date(Date.now()+60000).toISOString(),bidiGenerateContentSetup:setup})});
const credential=await res.json();if(!res.ok){console.log(JSON.stringify({stage:'token',status:res.status,message:credential.error?.message?.replaceAll(key,'[redacted]')}));process.exit(1);}
let readyResolve,started=0;const ready=new Promise(r=>readyResolve=r),events=[];
const ws=new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(credential.name)}`);
ws.onopen=()=>ws.send(JSON.stringify({setup}));ws.onmessage=async e=>{const m=JSON.parse(typeof e.data==='string'?e.data:await e.data.text());if(m.setupComplete)readyResolve();if(m.sessionResumptionUpdate)events.push({resumable:Boolean(m.sessionResumptionUpdate.resumable)});if(m.error)console.log({error:m.error.code,message:m.error.message?.replaceAll(key,'[redacted]')});const c=m.serverContent;if(c){const event={ms:Math.round(performance.now()-started)};for(const k of ['inputTranscription','interimInputTranscription','turnComplete'])if(c[k])event[k]=c[k];if(Object.keys(event).length>1)events.push(event);}};
const timer=setTimeout(()=>{console.log('timeout');ws.close();process.exit(1);},30000);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 await Promise.race([ready,new Promise((_,r)=>setTimeout(()=>r(new Error('setup timeout')),10000))]);started=performance.now();
 for(const lang of ['en','ko']){
 const wav=await fs.readFile(`public/samples/${lang}.wav`);let offset=12,pcm;while(offset+8<=wav.length){const size=wav.readUInt32LE(offset+4);if(wav.toString('ascii',offset,offset+4)==='data'){pcm=wav.subarray(offset+8,offset+8+size);break;}offset+=8+size+(size%2);}
 for(let n=0;n<pcm.length;n+=3200){ws.send(JSON.stringify({realtimeInput:{audio:{data:pcm.subarray(n,n+3200).toString('base64'),mimeType:'audio/pcm;rate=16000'}}}));await pause(100);}
 for(let n=0;n<20;n++){ws.send(JSON.stringify({realtimeInput:{audio:{data:Buffer.alloc(3200).toString('base64'),mimeType:'audio/pcm;rate=16000'}}}));await pause(100);}
 }
 ws.send(JSON.stringify({realtimeInput:{audioStreamEnd:true}}));await pause(1500);
 await fs.writeFile('reports/transcription-probe-2026-10-29.json',JSON.stringify({synthetic:true,setup,events},null,2));console.log(JSON.stringify({first:events[0],finals:events.filter(e=>e.inputTranscription),interims:events.filter(e=>e.interimInputTranscription).length}));
}finally{clearTimeout(timer);ws.close();}
