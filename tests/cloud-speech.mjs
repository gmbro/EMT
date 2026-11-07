import {test} from 'node:test';import assert from 'node:assert/strict';import {MeetingEngine} from '../src/meeting-engine.js';
test('Google speech readiness never constructs a model worker or downloads weights',async()=>{
  const previous={window:globalThis.window,fetch:globalThis.fetch};const calls=[];
  globalThis.window={};globalThis.fetch=async url=>{calls.push(url);return new Response(JSON.stringify({ready:true,model:'gemini-3.6-flash'}));};
  const engine=new MeetingEngine();Object.defineProperty(engine,'client',{get(){throw new Error('local worker must not start');}});
  try{const result=await engine.prepare('auto');assert.equal(result.cloudSpeech,true);assert.equal(engine.cloudSpeech,true);assert.deepEqual(calls,['/api/translate']);assert.match(result.speech,/Google/);}
  finally{engine.destroy();globalThis.window=previous.window;globalThis.fetch=previous.fetch;}
});
