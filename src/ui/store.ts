// ---- 保存先 ---------------------------------------------------------------
// 配置と出撃の予定を、ブラウザの IndexedDB に保存する。localStorage は同じドメインのほかのページと枠を分け合うので、
// ほかのページが枠を使い切ると保存できなくなるため。起動の前に全部をメモリへ読むので、読むのは同期でできる。
// 書くのは裏で進める。IndexedDB を使えないブラウザでは localStorage に保存する
export const LAYOUT_KEY = 'kozen-enbu-layout-v8'; // 42×42・本丸2×2・川
export const SIEGE_KEY = 'kozen-enbu-siege-v2'; // 攻城配置（開戦前に決める、兵と武将の出撃の予定）
const KEYS = [LAYOUT_KEY, SIEGE_KEY];
const DB_NAME = 'joseniq';
const TABLE = 'kv';
const OPEN_WAIT = 3000; // 開くのを待つ時間（ミリ秒）

export interface Store {
  get(key: string): string | null;
  set(key: string, value: string): void;
  onFail: () => void; // 書けなかったときに呼ぶ
  readFailed: boolean; // 保存を読めず、何もない状態で始めた
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
// どちらの保存先も、設定によっては触るだけで例外になる
function indexedDb(): IDBFactory | null {
  try {
    return globalThis.indexedDB ?? null;
  } catch {
    return null;
  }
}
function legacyStorage(): Legacy | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
// ブラウザによっては開く処理が終わらないことがある。待ち続けて遊べなくならないように、見切って localStorage を使う
function timeLimit<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([work, new Promise<T>((_, fail) => setTimeout(() => fail(new Error('時間切れ')), ms))]);
}

export async function openStore(
  idb: IDBFactory | null = indexedDb(),
  legacy: Legacy | null = legacyStorage(),
  waitMs = OPEN_WAIT,
): Promise<Store> {
  let db: IDBDatabase | null = null;
  let values = new Map<string, string>();
  let failed = false;
  if (idb) {
    try {
      [db, values] = await timeLimit(
        openDb(idb).then(async (d) => [d, await readAll(d)] as const),
        waitMs,
      );
    } catch {
      failed = true;
    }
  }
  const spilled = new Set<string>(); // IndexedDB に書けず、localStorage へ逃がした鍵
  const writeLegacy = (key: string, value: string) => {
    try {
      if (!legacy) throw new Error('保存先がない');
      legacy.setItem(key, value);
      spilled.add(key);
    } catch {
      store.onFail();
    }
  };
  const store: Store = {
    get: (key) => values.get(key) ?? null,
    set(key, value) {
      values.set(key, value);
      if (!db) return writeLegacy(key, value);
      put(db, key, value).then(
        // また書けたら、逃がした古い値を消す（次の起動で、新しい値として読まないように）
        () => {
          if (spilled.delete(key)) legacy?.removeItem(key);
        },
        () => writeLegacy(key, value),
      );
    },
    onFail: () => {},
    readFailed: false,
  };
  // localStorage に残っている値は、前の版の保存か、IndexedDB に書けなかったときの保存なので、どちらも IndexedDB より新しい。
  // IndexedDB に書けてから、localStorage の分を消す
  for (const key of KEYS) {
    try {
      const old = legacy?.getItem(key);
      if (old === null || old === undefined) continue;
      values.set(key, old);
      if (db) {
        await put(db, key, old);
        legacy?.removeItem(key);
      }
    } catch {
      // 引き継げなければ、localStorage の分を残す
    }
  }
  store.readFailed = failed && !values.size;
  return store;
}
