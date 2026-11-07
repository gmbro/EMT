import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createLiveToken,createHandler,LIVE_MODEL} from '../api/live-token.js';
class Reply extends EventEmitter{statusCode=200;headers={};setHeader(k,v){this.headers[k]=v;}end(body){this.body=body;}}
const req=(body,extra={})=>({method:'POST',headers:{host:'localhost:5173',origin:'http://localhost:5173','content-type':'application/json'},body,...extra});
test('live credentials are one-use, expire quickly and lock model, target and no tools',async()=>{
  let sent;
  const credential=await createLiveToken('private-key','ko',{now:()=>100000,fetchImpl:async(url,options)=>{sent={url,options};return new Response(JSON.stringify({name:'ephemeral-test'}));}});
  const body=JSON.parse(sent.options.body);
  assert.equal(body.uses,1);assert.equal(Date.parse(body.newSessionExpireTime),160000);
  assert.equal(Date.parse(body.expireTime),1900000);assert.equal(body.bidiGenerateContentSetup.model,LIVE_MODEL);
  assert.deepEqual(body.bidiGenerateContentSetup.generationConfig.responseModalities,['TEXT']);
  assert.deepEqual(body.bidiGenerateContentSetup.inputAudioTranscription.languageCodes,['en-US','ko-KR']);
  assert.equal(body.bidiGenerateContentSetup.tools,undefined);
  assert.ok(body.bidiGenerateContentSetup.inputAudioTranscription);
  assert.ok(!JSON.stringify(credential).includes('private-key'));assert.ok(!sent.url.includes('private-key'));
});
test('token route rejects foreign origin, arbitrary model, audio and target before Google access',async()=>{
  let calls=0;const handler=createHandler({getKey:()=> 'key',fetchImpl:async()=>{calls++;throw new Error('must not fetch');}});
  for(const body of [{target:'fr'},{target:'ko',model:'other'},{target:'en',audio:'private'},null]){const res=new Reply();await handler(req(body),res);assert.equal(res.statusCode,400);}
  const res=new Reply();await handler(req({target:'ko'},{headers:{host:'localhost:5173',origin:'https://evil.example','content-type':'application/json'}}),res);
  assert.equal(res.statusCode,403);assert.equal(calls,0);
});
test('provider credential errors never echo a private key or provider payload',async()=>{
  const handler=createHandler({getKey:()=> 'private-key',fetchImpl:async()=>new Response(JSON.stringify({error:{message:'private-key leaked provider response'}}),{status:403})});
  const res=new Reply();await handler(req({target:'en'}),res);assert.equal(res.statusCode,503);assert.ok(!res.body.includes('private-key'));assert.ok(!res.body.includes('provider response'));
});
test('resumption remains constrained to the chosen translation model and target',async()=>{
 let input;
 await createLiveToken('key','en',{resumeHandle:'test-resume',fetchImpl:async(url,options)=>{input=JSON.parse(options.body);return new Response('{"name":"ephemeral"}');}});
 assert.equal(input.bidiGenerateContentSetup.sessionResumption.handle,'test-resume');assert.equal(input.bidiGenerateContentSetup.model,LIVE_MODEL);assert.deepEqual(input.bidiGenerateContentSetup.generationConfig.responseModalities,['TEXT']);assert.ok(input.bidiGenerateContentSetup.contextWindowCompression.slidingWindow);
});
test('transcription hints are bounded, cannot change model, and are locked into one-use credentials',async()=>{
 let sent;const handler=createHandler({getKey:()=> 'key',fetchImpl:async(url,options)=>{sent=JSON.parse(options.body);return new Response('{"name":"ephemeral"}');}});
 const res=new Reply();await handler(req({target:'ko',language:'en-US',vocabulary:['Harvey','계약금']}),res);assert.equal(res.statusCode,200);assert.deepEqual(sent.bidiGenerateContentSetup.inputAudioTranscription,{languageCodes:['en-US'],customVocabulary:['Harvey','계약금']});
 for(const body of [{target:'ko',language:'fr'},{target:'ko',vocabulary:['x'.repeat(81)]},{target:'ko',vocabulary:'command'}]){const denied=new Reply();await handler(req(body),denied);assert.equal(denied.statusCode,400);}
});
test('already-open older tabs keep their fixed translation protocol while new clients use text transcription',async()=>{
 const requests=[];const handler=createHandler({getKey:()=> 'key',fetchImpl:async(url,options)=>{requests.push(JSON.parse(options.body));return new Response('{"name":"ephemeral"}');}});
 for(const body of [{target:'ko'},{target:'ko',language:'auto',vocabulary:[]}]){const res=new Reply();await handler(req(body),res);assert.equal(res.statusCode,200);}
 assert.equal(requests[0].bidiGenerateContentSetup.model,'models/gemini-3.5-live-translate-preview');assert.equal(requests[0].bidiGenerateContentSetup.generationConfig.translationConfig.targetLanguageCode,'ko');assert.equal(requests[1].bidiGenerateContentSetup.model,LIVE_MODEL);assert.deepEqual(requests[1].bidiGenerateContentSetup.generationConfig.responseModalities,['TEXT']);
});
