// Fixed synthetic fixture only; never prints credentials or reads microphone audio.
import { readFile, writeFile } from 'node:fs/promises';
const res=await fetch('http://localhost:5173/api/live-token',{method:'POST',headers:{Origin:'http://localhost:5173','Content-Type':'application/json'},body:JSON.stringify({target:'ko'})});
const credential=await res.json();if(!res.ok)throw new Error(credential.error);
const events=[];let readyResolve;const ready=new Promise(resolve=>{readyResolve=resolve;});
const socket=new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(credential.token)}`);
socket.onopen=()=>socket.send(JSON.stringify({setup:credential.setup}));
socket.onmessage=async event=>{const msg=JSON.parse(typeof event.data==='string'?event.data:await event.data.text());if(msg.setupComplete)readyResolve();if(msg.serverContent){const {inputTranscription,interimInputTranscription,outputTranscription}=msg.serverContent;if(inputTranscription||interimInputTranscription||outputTranscription)events.push({inputTranscription,interimInputTranscription,outputTranscription});}};
try{
 await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('setup timeout')),12000))]);
 const wav=await readFile('public/samples/ko.wav');let offset=12,pcm;
 while(offset+8<=wav.length){const size=wav.readUInt32LE(offset+4);if(wav.toString('ascii',offset,offset+4)==='data'){pcm=wav.subarray(offset+8,offset+8+size);break;}offset+=8+size+(size%2);}
 for(let n=0;n<pcm.length;n+=3200){socket.send(JSON.stringify({realtimeInput:{audio:{data:pcm.subarray(n,n+3200).toString('base64'),mimeType:'audio/pcm;rate=16000'}}}));await new Promise(resolve=>setTimeout(resolve,100));}
 for(let n=0;n<30;n++){socket.send(JSON.stringify({realtimeInput:{audio:{data:Buffer.alloc(3200).toString('base64'),mimeType:'audio/pcm;rate=16000'}}}));await new Promise(resolve=>setTimeout(resolve,100));}
 socket.send(JSON.stringify({realtimeInput:{audioStreamEnd:true}}));await new Promise(resolve=>setTimeout(resolve,3000));
 await writeFile('reports/korean-source-probe-2026-10-29.json',JSON.stringify({synthetic:true,target:'ko',echo:false,events},null,2));console.log(JSON.stringify({events:events.length,input:events.map(e=>e.inputTranscription?.text||'').join(''),interimEvents:events.filter(e=>e.interimInputTranscription).length,outputEvents:events.filter(e=>e.outputTranscription).length}));
}finally{socket.close();}
