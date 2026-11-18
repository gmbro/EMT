import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecordIndex, unchangedRecord, createInputActivityPublisher, createLatestCheckpointWriter } from '../src/meeting-state.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));

test('record index retains every row through patches, chronological inserts, filters and archive restore', () => {
  const index = createRecordIndex();
  let records = [{id:'one',original:'Not approved.'},{id:'three',original:'Review required.'}];
  assert.equal(index.indexOf(records,'three'),1);
  const before = records;
  records = [records[0],{...records[1],translation:'검토가 필요합니다.'}];
  index.updated(before,records,1);
  assert.equal(index.get(records,'three').translation,'검토가 필요합니다.');
  const insertBefore=records;
  records=[records[0],{id:'two',original:'Second statement.'},records[1]];
  index.inserted(insertBefore,records,1);
  assert.equal(index.indexOf(records,'two'),1); assert.equal(index.indexOf(records,'three'),2);
  const appendBefore=records; records=[...records,{id:'four',original:'Last statement.'}];
  index.inserted(appendBefore,records,3);
  assert.equal(index.get(records,'four').original,'Last statement.');
  records=records.filter(row=>row.id!=='two');
  assert.equal(index.indexOf(records,'three'),1); assert.equal(index.get(records,'two'),undefined);
  records=[records[2],records[1],records[0]];
  assert.equal(index.indexOf(records,'four'),0); assert.equal(index.indexOf(records,'one'),2);
  assert.equal(index.get([], 'one'),undefined);
});

test('streaming patches keep the record index instead of rereading thousands of IDs per delta', () => {
  let reads=0;
  const records=Array.from({length:10000},(_,n)=>({get id(){reads++;return `row-${n}`;},original:`Statement ${n}`}));
  const index=createRecordIndex(); index.get(records,'row-9999'); const initialReads=reads;
  const next=[...records]; next[9999]={...next[9999],translation:'번역'};
  index.updated(records,next,9999);
  for(let n=0;n<1000;n++)assert.equal(index.get(next,'row-9999').translation,'번역');
  assert.ok(reads-initialReads<10,'row patches should not rebuild the ID map');
  assert.equal(next.length,10000); assert.equal(next[0].original,'Statement 0');
});

test('identical patches are ignored while changed source, status, empty correction and metrics are retained', () => {
  const row={id:'one',original:'No.',translation:'아니요.',status:'complete'};
  assert.equal(unchangedRecord(row,{...row}),true);
  for(const patch of [{original:'Yes.'},{translation:''},{status:'error'},{firstTranslationAfterRequestMs:0}])assert.equal(unchangedRecord(row,{...row,...patch}),false);
});

test('audio activity transitions publish immediately without amplitude-only transcript rerenders', () => {
  const values=[]; const activity=createInputActivityPublisher(value=>values.push(value));
  for(let n=0;n<500;n++)activity.update(.01);
  assert.deepEqual(values,[]);
  activity.update(.0101); assert.deepEqual(values,[.0101]);
  for(let n=0;n<500;n++)activity.update(.1+n*.001);
  assert.deepEqual(values,[.0101]);
  activity.update(.01); assert.deepEqual(values,[.0101,.01]);
  activity.update(.02); activity.reset(); activity.update(.03);
  assert.deepEqual(values,[.0101,.01,.02,0,.03]);
});

test('slow checkpoint storage writes the active and newest snapshots without a stale backlog', async () => {
  const writes=[],finished=[],releases=[];
  const writer=createLatestCheckpointWriter({write:async(key,snapshot)=>{writes.push({key,snapshot});await new Promise(resolve=>releases.push(resolve));},onSaved:item=>finished.push(item.stamp)});
  writer.submit('draft','1',{records:['first']}); await tick();
  writer.submit('draft','1',{records:['duplicate']});
  writer.submit('draft','2',{records:['middle']});
  writer.submit('draft','3',{records:['last']});
  let flushed=false; const flush=writer.flush().then(()=>{flushed=true;});
  assert.equal(writes.length,1); assert.equal(flushed,false);
  releases.shift()(); await tick();
  assert.deepEqual(writes.map(row=>row.snapshot.records),[['first'],['last']]);
  assert.equal(flushed,false); releases.shift()(); await flush;
  assert.equal(flushed,true); assert.deepEqual(finished,['1','3']);
});

test('checkpoint failure is surfaced and does not prevent saving a newer snapshot or archiving after flush', async () => {
  const writes=[],errors=[],saved=[];let release;
  const writer=createLatestCheckpointWriter({write:async(key,snapshot)=>{writes.push(snapshot);if(snapshot===1){await new Promise(resolve=>release=resolve);throw new Error('storage unavailable');}},onError:error=>errors.push(error.message),onSaved:item=>saved.push(item.stamp)});
  writer.submit('first-draft','1',1);await tick();writer.submit('new-draft','2',2);
  release(); await writer.flush();
  assert.deepEqual(writes,[1,2]);assert.deepEqual(errors,['storage unavailable']);assert.deepEqual(saved,['2']);
  let archived=false; await writer.flush(); archived=true; assert.equal(archived,true);
});

// Damaged imported archives may contain duplicate IDs; retain the original
// findIndex behavior rather than silently editing a different row.
test('damaged duplicate IDs retain first-row lookup semantics', () => {
  const index=createRecordIndex(); const first={id:'same',original:'First'};
  const before=[first,{id:'same',original:'Second'}];
  assert.equal(index.get(before,'same'),first);
  const after=[...before,{id:'same',original:'Third'}];index.inserted(before,after,2);
  assert.equal(index.get(after,'same'),first);
});
