// IndexedDB の薄いラッパー。資料・スレッド・メッセージ・参考画像を端末内に保存する。
const DB_NAME = 'kyojuu-biru';
const DB_VERSION = 2;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'name' });
      if (!db.objectStoreNames.contains('threads')) db.createObjectStore('threads', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('messages')) {
        const s = db.createObjectStore('messages', { keyPath: 'id' });
        s.createIndex('threadId', 'threadId');
      }
      for (const n of ['posts', 'photos']) if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export const db = {
  async all(name) { return wrap((await store(name)).getAll()); },
  async get(name, key) { return wrap((await store(name)).get(key)); },
  async put(name, value) { return wrap((await store(name, 'readwrite')).put(value)); },
  async del(name, key) { return wrap((await store(name, 'readwrite')).delete(key)); },
  async clear(name) { return wrap((await store(name, 'readwrite')).clear()); },
  async getKV(key, def = null) { const v = await wrap((await store('kv')).get(key)); return v === undefined ? def : v; },
  async setKV(key, value) { return wrap((await store('kv', 'readwrite')).put(value, key)); },
  async delKV(key) { return wrap((await store('kv', 'readwrite')).delete(key)); },
  async allKV() {
    const s = await store('kv');
    const [keys, vals] = await Promise.all([wrap(s.getAllKeys()), wrap(s.getAll())]);
    return keys.map((k, i) => [k, vals[i]]);
  },
  async messages(threadId) {
    const s = await store('messages');
    const list = await wrap(s.index('threadId').getAll(threadId));
    return list.sort((a, b) => a.seq - b.seq);
  },
  async deleteThreadMessages(threadId) {
    const list = await this.messages(threadId);
    const s = await store('messages', 'readwrite');
    await Promise.all(list.map(m => wrap(s.delete(m.id))));
  },
};

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// 端末の保存領域を「消されにくい」扱いにしてもらう（対応ブラウザのみ）
export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch (_) {}
  return false;
}
