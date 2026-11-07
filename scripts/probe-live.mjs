import { readFile, writeFile } from 'node:fs/promises';
import { loadEnv } from 'vite';
import { createLiveToken } from '../api/live-token.js';
const key=loadEnv('development',process.cwd(),'').GEMINI_API_KEY;
const reports=[];
for(const [file,target] of [['en','ko'],['ko','en']]){
  const credential=await createLiveToken(key,target);
  const wav=await readFile(`public/samples/${file}.wav`);let offset=12, pcm;
  while(offset+8<=wav.length){const size=wav.readUInt32LE(offset+4);if(wav.toString('ascii',offset,offset+4)==='data'){pcm=wav.subarray(offset+8,offset+8+size);break;}offset+=8+size+(size%2);}
  const events=[];let started=0, readyResolve, doneResolve;
  const ready=new Promise(resolve=>{readyResolve=resolve;}), done=new Promise(resolve=>{doneResolve=resolve;});
  const socket=new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(credential.token)}`);
  socket.onopen=()=>socket.send(JSON.stringify({setup:credential.setup}));
  socket.onmessage=async event=>{const msg=JSON.parse(typeof event.data==='string'?event.data:await event.data.text());if(msg.setupComplete)readyResolve();if(msg.error){events.push({error:msg.error.code});doneResolve();}const c=msg.serverContent;if(c){const e={ms:Math.round(performance.now()-started)};for(const k of ['inputTranscription','interimInputTranscription','outputTranscription','turnComplete','generationComplete','interrupted'])if(c[k])e[k]=c[k];if(Object.keys(e).length>1)events.push(e);}};
  socket.onclose=event=>{events.push({closed:event.code});doneResolve();};socket.onerror=()=>{events.push({connectionError:true});doneResolve();};
  try{
    await Promise.race([ready,done.then(()=>{throw new Error('Live setup failed');}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('Live setup timed out')),12000))]);
    started=performance.now();
    for(let n=0;n<pcm.length;n+=3200){socket.send(JSON.stringify({realtimeInput:{audio:{data:pcm.subarray(n,n+3200).toString('base64'),mimeType:'audio/pcm;rate=16000'}}}));await new Promise(resolve=>setTimeout(resolve,100));}
    for(let n=0;n<30;n++){socket.send(JSON.stringify({realtimeInput:{audio:{data:Buffer.alloc(3200).toString('base64'),mimeType:'audio/pcm;rate=16000'}}}));await new Promise(resolve=>setTimeout(resolve,100));}
    socket.send(JSON.stringify({realtimeInput:{audioStreamEnd:true}}));
    await Promise.race([done,new Promise(resolve=>setTimeout(resolve,5000))]);
    reports.push({sample:file,target,audioMilliseconds:pcm.length/32,events});
    console.log(JSON.stringify({sample:file,target,firstSource:events.find(e=>e.inputTranscription||e.interimInputTranscription)?.ms,firstTranslation:events.find(e=>e.outputTranscription)?.ms,events:events.length}));
  }finally{socket.close();}
}
await writeFile('reports/live-google-probe-2026-10-28.json',JSON.stringify({synthetic:true,reports},null,2)+'\n');
