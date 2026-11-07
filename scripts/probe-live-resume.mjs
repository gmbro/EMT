import {readFile,writeFile} from 'node:fs/promises';import {loadEnv} from 'vite';import {liveSetup} from '../api/live-token.js';
const key=loadEnv('development',process.cwd(),'').GEMINI_API_KEY;
let resumeHandle,canResume=false;const results=[];
for(let attempt=0;attempt<2;attempt++){
 const setup={...liveSetup('ko'),sessionResumption:resumeHandle?{handle:resumeHandle}:{}};
 const r=await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens',{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':key},body:JSON.stringify({uses:1,bidiGenerateContentSetup:setup})});
 const credential=await r.json();if(!r.ok||!credential.name)throw new Error(`Resume token request failed (${r.status})`);
 let resolveReady,rejectReady;const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
 const socket=new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(credential.name)}`);
 const result={attempt,resumed:!!resumeHandle,source:'',translation:'',hasResumeHandle:false};
 const timer=setTimeout(()=>rejectReady(new Error('Resume setup timed out')),10000);
 socket.onopen=()=>socket.send(JSON.stringify({setup}));socket.onclose=e=>{if(!result.ready)rejectReady(new Error(`Resume setup closed (${e.code})`));};socket.onerror=()=>rejectReady(new Error('Resume connection error'));
 socket.onmessage=async event=>{const m=JSON.parse(typeof event.data==='string'?event.data:await event.data.text());if(m.setupComplete){result.ready=true;clearTimeout(timer);resolveReady();}if(m.sessionResumptionUpdate){canResume=!!(m.sessionResumptionUpdate.resumable&&m.sessionResumptionUpdate.newHandle);if(canResume){resumeHandle=m.sessionResumptionUpdate.newHandle;result.hasResumeHandle=true;}}if(m.serverContent?.inputTranscription?.text)result.source+=m.serverContent.inputTranscription.text;if(m.serverContent?.outputTranscription?.text)result.translation+=m.serverContent.outputTranscription.text;};
 try{await ready;const wav=await readFile('public/samples/en.wav');let offset=12,pcm;while(offset+8<=wav.length){const size=wav.readUInt32LE(offset+4);if(wav.toString('ascii',offset,offset+4)==='data'){pcm=wav.subarray(offset+8,offset+8+size);break;}offset+=8+size+(size%2);}const audio=Buffer.concat([pcm,Buffer.alloc(96000)]);for(let n=0;n<audio.length;n+=3200){socket.send(JSON.stringify({realtimeInput:{audio:{data:audio.subarray(n,n+3200).toString('base64'),mimeType:'audio/pcm;rate=16000'}}}));await new Promise(resolve=>setTimeout(resolve,100));}await new Promise(resolve=>setTimeout(resolve,3000));result.safeResume=canResume;results.push(result);console.log(JSON.stringify(result));}finally{clearTimeout(timer);socket.close();}
 if(!resumeHandle||!canResume)break;
}
await writeFile('reports/live-resumption-probe-2026-10-28.json',JSON.stringify({synthetic:true,results},null,2)+'\n');
