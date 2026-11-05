// ---- 保存先 ---------------------------------------------------------------
// 配置と出撃の予定を、ブラウザの IndexedDB に保存する。localStorage は同じドメインのほかのページと枠を分け合うので、
// ほかのページが枠を使い切ると保存できなくなるため。起動の前に全部をメモリへ読むので、読むのは同期でできる。
// 書くのは裏で進める。IndexedDB を使えないブラウザでは localStorage に保存する
export const LAYOUT_KEY = 'kozen-enbu-layout-v8'; // 42×42・本丸2×2・川
export const SIEGE_KEY = 'kozen-enbu-siege-v2'; // 攻城配置（開戦前に決める、兵と武将の出撃の予定）
const KEYS = [LAYOUT_KEY, SIEGE_KEY];
const DB_NAME = 'joseniq';
const TABLE = 'kv';

export interface Store {
  get(key: string): string | null;
  set(key: string, value: string): void;
  onFail: () => void; // 書けなかったときに呼ぶ
}
type Legacy = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function openDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((done, fail) => {
    const r = idb.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(TABLE);
    r.onsuccess = () => done(r.result);
    r.onerror = () => fail(r.error);
  });
}
function readAll(db: IDBDatabase): Promise<Map<string, string>> {
  return new Promise((done, fail) => {
    const out = new Map<string, string>();
    const r = db.transaction(TABLE).objectStore(TABLE).openCursor();
    r.onsuccess = () => {
      const c = r.result;
      if (!c) return done(out);
      out.set(String(c.key), String(c.value));
      c.continue();
    };
    r.onerror = () => fail(r.error);
  });
}
function put(db: IDBDatabase, key: string, value: string): Promise<void> {
  return new Promise((done, fail) => {
    const t = db.transaction(TABLE, 'readwrite');
    t.objectStore(TABLE).put(value, key);
    t.oncomplete = () => done();
    t.onerror = () => fail(t.error);
    t.onabort = () => fail(t.error);
  });
}
// localStorage は、設定によっては触るだけで例外になる
function legacyStorage(): Legacy | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export async function openStore(idb = globalThis.indexedDB, legacy = legacyStorage()): Promise<Store> {
  let db: IDBDatabase | null = null;
  let values = new Map<string, string>();
  try {
    if (idb) {
      db = await openDb(idb);
      values = await readAll(db);
    }
  } catch {
    db = null;
  }
  const store: Store = {
    get: (key) => values.get(key) ?? null,
    set(key, value) {
      values.set(key, value);
      if (db) {
        put(db, key, value).catch(() => store.onFail());
        return;
      }
      try {
        if (!legacy) throw new Error('保存先がない');
        legacy.setItem(key, value);
      } catch {
        store.onFail();
      }
    },
    onFail: () => {},
  };
  // 前に localStorage へ保存した分を引き継ぐ。IndexedDB に書けてから、localStorage の分を消す
  for (const key of KEYS) {
    try {
      const old = legacy?.getItem(key);
      if (old === null || old === undefined) continue;
      if (!values.has(key)) {
        values.set(key, old);
        if (db) await put(db, key, old);
      }
      if (db) legacy?.removeItem(key);
    } catch {
      // 引き継げなければ、localStorage の分を残す
    }
  }
  return store;
}
