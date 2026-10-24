import { describe, expect, it } from 'vitest';
import { GENERAL_ORDER, HALL, LIMITS, MAX_GENERALS } from './defs';
import { cloneLayout, countOf, emptyLayout, place, validate } from './layout';
import { preset } from './presets';

describe('配置の制限', () => {
  it('施設は上限までしか置けない', () => {
    const l = emptyLayout();
    // 城域の2行目に、櫓（弓）を上限まで並べる
    for (let i = 0; i < LIMITS.tbow; i++) expect(place(l, 'tbow', 2 + i, 2)).toEqual({ ok: true });
    const r = place(l, 'tbow', 2 + LIMITS.tbow, 2);
    expect(r.ok).toBe(false);
    expect(countOf(l, 'tbow')).toBe(LIMITS.tbow);
  });

  it(`武将は全体で ${MAX_GENERALS} 人までしか置けない`, () => {
    const l = emptyLayout();
    GENERAL_ORDER.slice(0, MAX_GENERALS).forEach((k, i) => {
      expect(place(l, k, 2 + i, 5)).toEqual({ ok: true });
    });
    const r = place(l, GENERAL_ORDER[MAX_GENERALS], 2 + MAX_GENERALS, 5);
    expect(r).toEqual({ ok: false, msg: `武将は${MAX_GENERALS}人までです` });
    expect(l.generals).toHaveLength(MAX_GENERALS);
  });

  it('同じ武将は1人しか置けない', () => {
    const l = emptyLayout();
    expect(place(l, 'brave', 2, 5).ok).toBe(true);
    expect(place(l, 'brave', 3, 5).ok).toBe(false);
    expect(countOf(l, 'brave')).toBe(1);
  });

  it('城域の外と、ほかの配置の上には置けない', () => {
    const l = emptyLayout();
    expect(place(l, 'wall', 0, 0).ok).toBe(false);
    expect(place(l, 'wall', 5, 5).ok).toBe(true);
    expect(place(l, 'tbow', 5, 5).ok).toBe(false);
  });

  it('堀は城域の外側3マスにだけ置ける', () => {
    const l = emptyLayout();
    expect(place(l, 'moat', 2, 2).ok).toBe(true);
    expect(place(l, 'moat', 8, 8).ok).toBe(false);
  });

  it('本丸は消せない', () => {
    const l = emptyLayout();
    expect(place(l, 'erase', HALL.x, HALL.y).ok).toBe(false);
    expect(l.buildings.some((b) => b.type === 'hall')).toBe(true);
  });
});

describe('配置データの読み込み', () => {
  it('編成例はそのまま読み込める', () => {
    const l = preset('basic');
    expect(validate(cloneLayout(l))).toEqual(l);
  });

  it(`武将は ${MAX_GENERALS} 人までなら読み込み、超えると読み込まない`, () => {
    const at = (n: number) => {
      const l = emptyLayout();
      l.generals = GENERAL_ORDER.slice(0, n).map((kind, i) => ({ kind, x: 2 + i, y: 5 }));
      return l;
    };
    // 同じ置き方で人数だけを変え、上限の判定だけで結果が分かれることを確かめる
    expect(validate(at(MAX_GENERALS))).toEqual(at(MAX_GENERALS));
    expect(validate(at(MAX_GENERALS + 1))).toBeNull();
  });

  it('本丸がない配置や、本丸の位置が違う配置は読み込まない', () => {
    expect(validate({ buildings: [], generals: [] })).toBeNull();
    expect(validate({ buildings: [{ type: 'hall', x: HALL.x + 1, y: HALL.y }], generals: [] })).toBeNull();
  });
});
