import { describe, expect, it } from 'vitest';
import { ADEF, BDEF, GDEF, GENERAL_ORDER, UNIT_ORDER } from './defs';
import {
  createDuel,
  DUEL_FACILITIES,
  DUEL_LIMIT,
  type DuelRight,
  duelTotals,
  runDuel,
  stepDuel,
  swapDuel,
} from './duel';

const gen = (kind: (typeof GENERAL_ORDER)[number]): DuelRight => ({ k: 'gen', kind });

describe('1対1の戦い', () => {
  it('はじめの距離のとおりに置き、体力は定義のまま', () => {
    const d = createDuel({ left: 'inf', right: { k: 'fac', type: 'tbow' }, dist: 20 });
    expect(d.points[0].dist).toBeCloseTo(20, 1);
    expect(d.left.hp).toBe(ADEF.inf.hp);
    expect(d.right.hp).toBe(BDEF.tbow.hp);
  });

  it('武将どうしで決着がつき、傷の一覧と体力の記録が合う', () => {
    const d = runDuel(createDuel({ left: 'brave', right: gen('gunner'), dist: 20 }));
    expect(d.end?.winner).not.toBeNull();
    for (const by of ['left', 'right'] as const) {
      const lost = (by === 'left' ? GDEF.gunner.hp : GDEF.brave.hp) - (by === 'left' ? d.right.hp : d.left.hp);
      expect(duelTotals(d, by).total).toBeCloseTo(lost, 5);
    }
    expect(d.points.at(-1)?.t).toBe(d.end?.t);
  });

  it('守りの武将は、見つける範囲に入ってから動き出す', () => {
    const d = createDuel({ left: 'brave', right: gen('archer'), dist: 25 });
    const home = d.right.isB ? 0 : d.right.x;
    while ((d.points.at(-1)?.dist ?? 0) > GDEF.archer.aggro + 2) stepDuel(d);
    expect(d.right.isB ? 0 : d.right.x).toBeCloseTo(home, 5);
  });

  it('当たらない組み合わせは、時間切れで引き分けになる', () => {
    const d = runDuel(createDuel({ left: 'guard', right: { k: 'fac', type: 'drum' }, dist: 10 }));
    expect(d.end).toEqual({ t: expect.closeTo(DUEL_LIMIT, 1), winner: null });
    expect(d.hits).toEqual([]);
  });

  it('同じ組み合わせは、いつも同じ結果になる', () => {
    const s = { left: 'arc', right: { k: 'fac', type: 'tgun' }, dist: 15 } as const;
    expect(runDuel(createDuel(s)).hits).toEqual(runDuel(createDuel(s)).hits);
  });

  it('どの組み合わせでも最後まで進み、止まらない', () => {
    for (const left of UNIT_ORDER) {
      for (const k of GENERAL_ORDER) runDuel(createDuel({ left, right: gen(k), dist: 12 }));
      for (const type of DUEL_FACILITIES) runDuel(createDuel({ left, right: { k: 'fac', type }, dist: 12 }));
    }
  });

  it('入れ替えられるのは武将どうしだけ', () => {
    expect(swapDuel({ left: 'brave', right: gen('archer'), dist: 9 })).toEqual({
      left: 'archer',
      right: gen('brave'),
      dist: 9,
    });
    expect(swapDuel({ left: 'inf', right: gen('archer'), dist: 9 })).toBeNull();
    expect(swapDuel({ left: 'brave', right: { k: 'fac', type: 'tbow' }, dist: 9 })).toBeNull();
  });
});
