import { IDBDatabase, IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { LAYOUT_KEY, openStore, SIEGE_KEY } from './store';

// IndexedDB のないブラウザの代わり。localStorage の代わりに Map を渡す
function legacy(init: Record<string, string> = {}, full = false) {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (full) throw new DOMException('一杯', 'QuotaExceededError');
      m.set(k, v);
    },
    removeItem: (k: string) => void m.delete(k),
  };
}
describe('保存先（IndexedDB を使えないとき）', () => {
  it('localStorage に保存し、前の保存を読める', async () => {
    const l = legacy({ [SIEGE_KEY]: '前の予定' });
    const s = await openStore(null, l);
    expect(s.get(SIEGE_KEY)).toBe('前の予定');
    s.set(LAYOUT_KEY, '配置');
    expect(l.m.get(LAYOUT_KEY)).toBe('配置');
    expect(s.get(LAYOUT_KEY)).toBe('配置');
  });
  it('枠が一杯で書けなければ知らせる。開いているあいだは、今の値を読める', async () => {
    const s = await openStore(null, legacy({}, true));
    let failed = 0;
    s.onFail = () => failed++;
    s.set(LAYOUT_KEY, '配置');
    expect(failed).toBe(1);
    expect(s.get(LAYOUT_KEY)).toBe('配置');
  });
  it('どちらの保存先もなければ知らせる', async () => {
    const s = await openStore(null, null);
    let failed = 0;
    s.onFail = () => failed++;
    s.set(LAYOUT_KEY, '配置');
    expect(failed).toBe(1);
  });
});

describe('保存先（IndexedDB）', () => {
  // 裏の書き込みが終わるまで待つ（開き直して読むと、前の書き込みのあとに並ぶ）
  const reopen = (idb: IDBFactory, l = legacy()) => openStore(idb, l);

  it('書いた値を、開き直しても読める。localStorage には書かない', async () => {
    const idb = new IDBFactory();
    const l = legacy();
    (await reopen(idb, l)).set(LAYOUT_KEY, '配置');
    expect((await reopen(idb, l)).get(LAYOUT_KEY)).toBe('配置');
    expect(l.m.size).toBe(0);
  });
  it('localStorage が一杯でも保存できる', async () => {
    const idb = new IDBFactory();
    const l = legacy({}, true);
    const s = await reopen(idb, l);
    let failed = 0;
    s.onFail = () => failed++;
    s.set(LAYOUT_KEY, '配置');
    expect((await reopen(idb, l)).get(LAYOUT_KEY)).toBe('配置');
    expect(failed).toBe(0);
  });
  it('localStorage の前の保存を引き継いで消し、ほかのページのキーは消さない', async () => {
    const idb = new IDBFactory();
    const l = legacy({ [LAYOUT_KEY]: '前の配置', 'giv:repos': 'ほかのページ' });
    expect((await reopen(idb, l)).get(LAYOUT_KEY)).toBe('前の配置');
    expect([...l.m.keys()]).toEqual(['giv:repos']);
    expect((await reopen(idb, l)).get(LAYOUT_KEY)).toBe('前の配置');
  });
  it('localStorage に残っている値は IndexedDB より新しいので、そちらを使う', async () => {
    const idb = new IDBFactory();
    (await reopen(idb)).set(LAYOUT_KEY, '古い配置');
    const l = legacy({ [LAYOUT_KEY]: '新しい配置' });
    expect((await reopen(idb, l)).get(LAYOUT_KEY)).toBe('新しい配置');
    expect((await reopen(idb)).get(LAYOUT_KEY)).toBe('新しい配置');
  });
  it('開く処理が終わらなければ、見切って localStorage で始める', async () => {
    const stuck = { open: () => ({}) } as unknown as globalThis.IDBFactory;
    const l = legacy({ [LAYOUT_KEY]: '配置' });
    const s = await openStore(stuck, l, 10);
    expect(s.get(LAYOUT_KEY)).toBe('配置');
    expect(s.readFailed).toBe(false);
    expect(l.m.get(LAYOUT_KEY)).toBe('配置');
  });
  it('読めず、localStorage にも何もなければ、読めなかったと分かる', async () => {
    const stuck = { open: () => ({}) } as unknown as globalThis.IDBFactory;
    expect((await openStore(stuck, legacy(), 10)).readFailed).toBe(true);
  });
  it('一度 localStorage へ逃がしても、また書けたら、古い値を残さない', async () => {
    const idb = new IDBFactory();
    const l = legacy();
    const s = await openStore(idb, l);
    const realTx = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = () => {
      throw new DOMException('切れた', 'InvalidStateError');
    };
    s.set(LAYOUT_KEY, '逃がした配置');
    await new Promise((r) => setTimeout(r, 0));
    IDBDatabase.prototype.transaction = realTx;
    expect(l.m.get(LAYOUT_KEY)).toBe('逃がした配置');
    s.set(LAYOUT_KEY, '新しい配置');
    expect((await openStore(idb, l)).get(LAYOUT_KEY)).toBe('新しい配置');
    expect(l.m.has(LAYOUT_KEY)).toBe(false);
  });
  it('接続が切れて書けなければ、localStorage に書く', async () => {
    const idb = new IDBFactory();
    const l = legacy();
    const real = idb.open.bind(idb);
    let conn: IDBDatabase | null = null;
    idb.open = (...a: Parameters<typeof real>) => {
      const r = real(...a);
      r.addEventListener('success', () => {
        conn = r.result;
      });
      return r;
    };
    const s = await openStore(idb, l);
    (conn as IDBDatabase | null)?.close();
    s.set(LAYOUT_KEY, '配置');
    await new Promise((r) => setTimeout(r, 0));
    expect(l.m.get(LAYOUT_KEY)).toBe('配置');
  });
});
