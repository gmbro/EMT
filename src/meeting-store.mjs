import { ARCHIVE_KEY, loadMeetings } from './meeting-archive.mjs';
export const ARCHIVE_EVENT_KEY = 'meeting-archive-changed';

// Keep large transcripts out of synchronous localStorage and the render path.
// Import the old archive once; retain its original bytes as a recovery backup.
export function createMeetingStore({ indexedDB, storage, name = 'meeting-records' } = {}) {
  // Accessing these browser properties can itself throw when storage is blocked.
  if (indexedDB === undefined) { try { indexedDB = globalThis.indexedDB; } catch { indexedDB = null; } }
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch { storage = null; } }
  let database, opening, queue = Promise.resolve();
  const open = () => opening ||= new Promise((resolve, reject) => {
    if (!indexedDB) return reject(new Error('이 브라우저는 회의 기록 저장을 지원하지 않아요.'));
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('sessions', { keyPath: 'id' });
      request.result.createObjectStore('meta');
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('다른 회의 탭을 닫고 다시 열어주세요.'));
    request.onsuccess = () => {
      database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
  async function transaction(stores, mode, run) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode); let result;
      tx.oncomplete = () => resolve(typeof result === 'function' ? result() : result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('회의 기록 저장이 중단됐어요.'));
      try { result = run(tx); } catch (error) { tx.abort(); reject(error); }
    });
  }
  const serial = operation => {
    const result = queue.then(operation);
    queue = result.catch(() => {}); return result;
  };
  const notify = () => { try { storage?.setItem(ARCHIVE_EVENT_KEY, `${Date.now()}-${Math.random()}`); } catch { /* IndexedDB remains authoritative. */ } };
  return {
    async load() {
      await serial(() => transaction(['sessions', 'meta'], 'readwrite', tx => {
        const meta = tx.objectStore('meta'), check = meta.get('legacy-imported');
        check.onsuccess = () => {
          if (check.result) return;
          let legacy = []; try { legacy = loadMeetings(storage); } catch { /* No legacy storage. */ }
          for (const session of legacy) tx.objectStore('sessions').put(session);
          meta.put(true, 'legacy-imported');
        };
      }));
      return this.read();
    },
    async read() {
      await queue;
      return transaction(['sessions'], 'readonly', tx => {
        const request = tx.objectStore('sessions').getAll();
        return () => loadMeetings({ getItem: key => key === ARCHIVE_KEY ? JSON.stringify({ version: 1, sessions: request.result }) : null });
      });
    },
    put(session) { return serial(async () => { await transaction(['sessions'], 'readwrite', tx => { tx.objectStore('sessions').put(session); }); notify(); }); },
    remove(id) { return serial(async () => { await transaction(['sessions'], 'readwrite', tx => { tx.objectStore('sessions').delete(id); }); notify(); }); },
    async close() { await queue; database?.close(); },
  };
}
