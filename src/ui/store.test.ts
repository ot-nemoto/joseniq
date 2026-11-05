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
const noDb = undefined as unknown as IDBFactory;

describe('保存先（IndexedDB を使えないとき）', () => {
  it('localStorage に保存し、前の保存を読める', async () => {
    const l = legacy({ [SIEGE_KEY]: '前の予定' });
    const s = await openStore(noDb, l);
    expect(s.get(SIEGE_KEY)).toBe('前の予定');
    s.set(LAYOUT_KEY, '配置');
    expect(l.m.get(LAYOUT_KEY)).toBe('配置');
    expect(s.get(LAYOUT_KEY)).toBe('配置');
  });
  it('枠が一杯で書けなければ知らせる。開いているあいだは、今の値を読める', async () => {
    const s = await openStore(noDb, legacy({}, true));
    let failed = 0;
    s.onFail = () => failed++;
    s.set(LAYOUT_KEY, '配置');
    expect(failed).toBe(1);
    expect(s.get(LAYOUT_KEY)).toBe('配置');
  });
  it('どちらの保存先もなければ知らせる', async () => {
    const s = await openStore(noDb, null);
    let failed = 0;
    s.onFail = () => failed++;
    s.set(LAYOUT_KEY, '配置');
    expect(failed).toBe(1);
  });
});
