import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeetingStore } from '../src/meeting-store.mjs';
test('unavailable browser storage rejects asynchronously so the UI can keep and export unsaved records',async()=>{
  const store=createMeetingStore({indexedDB:null,storage:null});
  await assert.rejects(store.load(),/저장/);
  await assert.rejects(store.put({id:'unsaved',records:[]}),/저장/);
  await store.close();
});
