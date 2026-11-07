import test from 'node:test';
import assert from 'node:assert/strict';
import { boundCaptionHistory, mutateCaptionHistory, createLatestTaskRunner } from '../src/captions.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
function scheduler() {
  const tasks = new Map(); let next = 0;
  return { tasks, schedule(fn) { const id = ++next; tasks.set(id, fn); return id; }, cancel(id) { tasks.delete(id); },
    async tick() { const task = tasks.entries().next().value; assert.ok(task, 'a timer is armed'); tasks.delete(task[0]); task[1](); await flush(); } };
}

test('history retains ordered bilingual rows and counts Unicode code points', () => {
  const first = { id: 'first', original: 'hello', translation: '안녕😀' };
  const second = { id: 'second', original: 'thank you', translation: '감사해요' };
  const result = boundCaptionHistory([first, second], 20);
  assert.deepEqual(result.records, [second]);
  assert.equal(result.characterCount, 13);
  assert.equal(result.removed, 8);
});

test('one oversized row retains both language tails without broken surrogate pairs', () => {
  const result = boundCaptionHistory([{ id: 'huge', original: '😀'.repeat(10000), translation: '한'.repeat(10000) }]);
  assert.equal(result.characterCount, 10000);
  assert.equal(Array.from(result.records[0].original).length, 5000);
  assert.equal(result.records[0].translation.length, 5000);
  assert.equal(result.records[0].clipped, true);
  assert.equal(result.removed, 10000);
});

test('a long meeting retains every earlier row when translations arrive later', () => {
  let history = { records: [{ id: 'old', original: 'a'.repeat(6000), translation: '' }, { id: 'new', original: 'b'.repeat(3000), translation: '' }], characterCount: 9000, historyTrimmed: 0 };
  history = mutateCaptionHistory(history, records => records.map(row => row.id === 'new' ? { ...row, translation: '다'.repeat(3000), status: 'complete' } : row));
  assert.deepEqual(history.records.map(row => row.id), ['old', 'new']);
  assert.equal(history.characterCount, 12000); assert.equal(history.historyTrimmed, 0);
  history = mutateCaptionHistory(history, rows => rows.map(row => row.id === 'old' ? { ...row, translation: 'late result' } : row));
  assert.equal(history.records[0].translation, 'late result');
});
test('3000 long meeting rows survive without clipping Unicode or removing first utterance', () => {
  const records=Array.from({length:3000},(_,i)=>({id:String(i),original:`${i}: `+'Meeting detail 😀 '.repeat(20),translation:'회의 세부사항 '.repeat(20)}));
  const history=mutateCaptionHistory({records:[],historyTrimmed:0},()=>records);
  assert.equal(history.records.length,3000);assert.equal(history.records[0].original,records[0].original);
  assert.ok(history.characterCount>1000000);assert.equal(history.historyTrimmed,0);
});

test('zero translation and one-character budgets stay within the cap', () => {
  assert.equal(boundCaptionHistory([{ original: '😀😀', translation: '' }], 1).records[0].original, '😀');
  assert.equal(boundCaptionHistory([{ original: '', translation: '가나다' }], 1).records[0].translation, '다');
  assert.throws(() => boundCaptionHistory([], 0), RangeError);
});

test('continuous drafts do not reset the throttle timer and newest text is selected', async () => {
  const clock = scheduler(), called = [], published = [];
  const runner = createLatestTaskRunner({ ...clock, run: async task => { called.push(task); return task.toUpperCase(); }, publish: value => published.push(value) });
  runner.submit('h'); const firstTimer = [...clock.tasks.keys()][0];
  runner.submit('he'); runner.submit('hello');
  assert.deepEqual([...clock.tasks.keys()], [firstTimer]);
  await clock.tick();
  assert.deepEqual(called, ['hello']); assert.deepEqual(published, ['HELLO']);
  runner.dispose();
});

test('ongoing translation publishes useful partial text and coalesces pending drafts', async () => {
  const clock = scheduler(), running = deferred(), called = [], published = [];
  const runner = createLatestTaskRunner({ ...clock, run: async (task, emit) => {
    called.push(task); emit(`partial:${task}`);
    return task === 'first' ? running.promise : `done:${task}`;
  }, publish: value => published.push(value) });
  runner.submit('first'); await clock.tick();
  runner.submit('second'); runner.submit('third');
  assert.equal(clock.tasks.size, 0, 'only one inference may be active');
  running.resolve('done:first'); await flush(); await clock.tick();
  assert.deepEqual(called, ['first', 'third']);
  assert.deepEqual(published, ['partial:first', 'done:first', 'partial:third', 'done:third']);
  runner.dispose();
});

test('finalization invalidates an old draft while retaining the next utterance', async () => {
  const clock = scheduler(), running = deferred(), published = [];
  const runner = createLatestTaskRunner({ ...clock, run: task => task === 'old' ? running.promise : Promise.resolve(task), publish: value => published.push(value) });
  runner.submit('old'); await clock.tick(); runner.invalidate(); runner.submit('new');
  running.resolve('late old result'); await flush(); await clock.tick();
  assert.deepEqual(published, ['new']);
  runner.dispose();
});

test('final translations get priority without losing the newest interim draft', async () => {
  const clock = scheduler(), published = []; let idle = false;
  const runner = createLatestTaskRunner({ ...clock, canRun: () => idle, run: async task => task, publish: value => published.push(value) });
  runner.submit('one'); await clock.tick(); runner.submit('two'); idle = true; await clock.tick();
  assert.deepEqual(published, ['two']);
  runner.dispose(); assert.equal(clock.tasks.size, 0);
});

test('failed interim translation does not prevent the following utterance', async () => {
  const clock = scheduler(), published = [], errors = [];
  const runner = createLatestTaskRunner({ ...clock, run: async task => { if (task === 'bad') throw new Error('timeout'); return task; }, publish: value => published.push(value), onError: error => errors.push(error.message) });
  runner.submit('bad'); await clock.tick(); runner.submit('good'); await clock.tick();
  assert.deepEqual(errors, ['timeout']); assert.deepEqual(published, ['good']); runner.dispose();
});

test('zero-delay preview yields while final translation slots are busy',async()=>{
 const waits=[],tasks=[];let free=false;
 const runner=createLatestTaskRunner({delay:0,canRun:()=>free,schedule:(fn,ms)=>{tasks.push(fn);waits.push(ms);return tasks.length;},cancel:()=>{},run:async()=>{},publish:()=>{}});
 runner.submit('draft');await tasks.shift()();assert.deepEqual(waits,[0,50]);
 free=true;await tasks.shift()();runner.dispose();
});
