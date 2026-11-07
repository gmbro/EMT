import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {readSSE} from '../src/sse.mjs';
import {createLiveCaptionAssembler} from '../src/live-captions.mjs';
const origin='https://emt-theta.vercel.app';
const report={origin,synthetic:true,verifiedAt:new Date().toISOString(),limits:{realMicrophone:false,mobileDevice:false,longMeeting:false}};
const local=JSON.parse(await fs.readFile('dist/version.json','utf8'));
const versionResponse=await fetch(`${origin}/version.json?verify=${Date.now()}`,{headers:{'cache-control':'no-cache'},redirect:'manual'});
assert.equal(versionResponse.status,200);const version=await versionResponse.json();
const differences=local.files.filter(file=>version.files.find(remote=>remote.path===file.path)?.sha256!==file.sha256).map(file=>file.path);
assert.ok(differences.every(path=>path==='vercel.json'),'Application or API sources do not match');
report.release={buildId:version.buildId,sourceHash:version.sourceHash,appAndApiSourcesMatch:true,platformConfigDifferences:differences};
const page=await fetch(origin,{redirect:'manual'});assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/wss:\/\/generativelanguage[.]googleapis[.]com/);assert.equal(page.headers.get('x-content-type-options'),'nosniff');
report.publicAccess={status:page.status,requiresLogin:false,securityHeaders:true};
const health=await fetch(`${origin}/api/translate`,{headers:{'cache-control':'no-cache'}});const healthBody=await health.json();assert.equal(health.status,200);assert.equal(healthBody.ready,true);assert.match(healthBody.audio,/Google/);report.health=healthBody;
async function translate(text,language){
 const response=await fetch(`${origin}/api/translate`,{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({text,language,glossary:'deposit = 계약금'}),signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);
 let output='',done=false;for await(const event of readSSE(response.body)){if(event.type==='delta')output+=event.text;if(event.type==='done')done=true;if(event.type==='error')throw new Error('Production text translation failed');}assert.ok(done&&output.trim());return output.trim();
}
report.textTranslation=await translate('We have not approved the contract. Do not pay the deposit before Friday.','en-US');assert.match(report.textTranslation,/금요일/);assert.match(report.textTranslation,/계약금/);
const channels=[];
try{
 for(const target of ['ko','en']){
  const response=await fetch(`${origin}/api/live-token`,{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({target})});assert.equal(response.status,200);
  const credential=await response.json();assert.equal(credential.setup.generationConfig.translationConfig.targetLanguageCode,target);assert.ok(credential.token);
  const records=[],channel={target,records,setupReady:false};
  channel.assembler=createLiveCaptionAssembler({language:target==='ko'?'en-US':'ko-KR',onUpdate:()=>{},onFinal:row=>records.push(row)});
  const socket=new WebSocket(`wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(credential.token)}`);channel.socket=socket;channels.push(channel);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Google live setup timeout')),12000);socket.onopen=()=>socket.send(JSON.stringify({setup:credential.setup}));socket.onerror=()=>{clearTimeout(timer);reject(new Error('Google live connection failed'));};socket.onclose=event=>{if(!channel.setupReady){clearTimeout(timer);reject(new Error(`Google live setup closed (${event.code})`));}};socket.onmessage=async event=>{const message=JSON.parse(typeof event.data==='string'?event.data:await event.data.text());if(message.setupComplete){clearTimeout(timer);channel.setupReady=true;resolve();}if(message.serverContent)channel.assembler.receive(message.serverContent);};});
 }
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 async function sendPCM(pcm){for(let offset=0;offset<pcm.length;offset+=3200){const data=pcm.subarray(offset,offset+3200).toString('base64');const message=JSON.stringify({realtimeInput:{audio:{data,mimeType:'audio/pcm;rate=16000'}}});for(const channel of channels)channel.socket.send(message);await pause(100);}}
 for(const language of ['en','ko']){
  const wav=await fs.readFile(`public/samples/${language}.wav`);let offset=12,pcm;
  while(offset+8<=wav.length){const bytes=wav.readUInt32LE(offset+4);if(wav.toString('ascii',offset,offset+4)==='data'){pcm=wav.subarray(offset+8,offset+8+bytes);break;}offset+=8+bytes+(bytes%2);}
  assert.ok(pcm);await sendPCM(pcm);await sendPCM(Buffer.alloc(96000));
 }
 for(const c of channels)c.socket.send(JSON.stringify({realtimeInput:{audioStreamEnd:true}}));await pause(1000);
 report.voice=[];
 for(const c of channels){c.assembler.flush();assert.equal(c.records.length,1,'Expected exactly one row in each language');const row=c.records[0];const translation=await translate(row.original,row.language);report.voice.push({language:row.language,source:row.original,liveTranslation:row.translation,refinedTranslation:translation});}
 assert.match(report.voice[0].source,/meeting agenda/i);assert.match(report.voice[0].refinedTranslation,/내일/);assert.match(report.voice[1].source,/3시/);assert.match(report.voice[1].refinedTranslation,/3.*(?:PM|p[.]?m)/i);
 report.voiceConnection={twoConcurrentSessions:true,automaticLanguageSwitch:true,ephemeralTokens:true};
}finally{for(const c of channels){c.assembler.dispose();c.socket.close();}}
const denied=[];
for(const path of ['/.env.local','/tests/meeting-browser.html','/reports/google-live-browser-2026-10-28.json']){const response=await fetch(origin+path,{redirect:'manual'});assert.equal(response.status,404);denied.push({path,status:response.status});}
report.privateFilesUnavailable=denied;
await fs.writeFile('reports/deployment-verification-2026-10-28.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
