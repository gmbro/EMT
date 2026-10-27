export class ModelClient {
  constructor() {
    this.pending = new Map();
    this.nextId = 0;
    this.worker = new Worker(new URL('./model.worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      const request = this.pending.get(data.id);
      if (!request) return;
      if (data.event === 'progress') { request.touch(); request.onProgress?.(data); return; }
      if (data.event === 'update') { request.touch(); request.onUpdate?.(data); return; }
      if (data.event === 'error') { this.fail(new Error(data.message)); return; }
      this.pending.delete(data.id); request.cleanup(); request.resolve(data.value);
    };
    this.worker.onerror = () => this.fail(new Error('기기 모델을 실행하지 못했어요. 최신 브라우저로 새로고침해 주세요.'));
    this.worker.onmessageerror = () => this.fail(new Error('음성 모델과 연결하지 못했어요. 새로고침해 주세요.'));
  }
  fail(error) {
    this.failure = error; error.localModelFatal = true; this.worker.terminate();
    for (const request of this.pending.values()) { request.cleanup(); request.reject(error); }
    this.pending.clear();
  }
  request(action, payload = {}, onProgress, onUpdate) {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      let timer;
      const stall = action.startsWith('prepare') ? 180000 : 60000;
      const touch = () => { clearTimeout(timer); timer = setTimeout(() => this.fail(new Error('기기 모델의 응답이 멈췄어요. 다른 탭을 닫고 통역 준비를 다시 눌러주세요.')), stall); };
      const limit = setTimeout(() => this.fail(new Error('모델 준비 시간이 너무 길어졌어요. 연결과 기기 메모리를 확인하고 다시 준비해 주세요.')), 10 * 60 * 1000);
      const cleanup = () => { clearTimeout(timer); clearTimeout(limit); };
      this.pending.set(id, { resolve, reject, onProgress, onUpdate, touch, cleanup }); touch();
      try { this.worker.postMessage({ id, action, payload }, payload.samples ? [payload.samples.buffer] : []); }
      catch (error) { this.fail(error); }
    });
  }
  destroy() { this.worker.terminate(); this.fail(new Error('기기 모델 세션이 종료됐어요.')); }
}
