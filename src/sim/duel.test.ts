import { describe, expect, it } from 'vitest';
import { ADEF, BDEF, GDEF, GENERAL_ORDER, UNIT_ORDER } from './defs';
import {
  createDuel,
  DUEL_DIST_MAX,
  DUEL_DIST_MIN,
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
    expect(d.points.at(-1)?.t).toBeGreaterThanOrEqual(d.end?.t ?? 0);
  });

  it('守りの武将は、見つける範囲に入ってから動き出す', () => {
    const d = createDuel({ left: 'brave', right: gen('archer'), dist: 25 });
    const home = d.right.isB ? 0 : d.right.x;
    while ((d.points.at(-1)?.dist ?? 0) > GDEF.archer.aggro + 2) stepDuel(d);
    expect(d.right.isB ? 0 : d.right.x).toBeCloseTo(home, 5);
  });

  it('当たらない組み合わせは、時間切れで引き分けになる', () => {
    const d = runDuel(createDuel({ left: 'guard', right: { k: 'fac', type: 'drum' }, dist: 10 }));
    expect(d.end).toEqual({ t: expect.closeTo(DUEL_LIMIT, 1), winner: null, reason: 'time' });
    expect(d.hits).toEqual([]);
  });

  it('同じ組み合わせは、いつも同じ結果になる', () => {
    const s = { left: 'arc', right: { k: 'fac', type: 'tgun' }, dist: 15 } as const;
    expect(runDuel(createDuel(s)).hits).toEqual(runDuel(createDuel(s)).hits);
  });

  it('倒れた時に飛んでいた弾が残った側を倒せば、相打ちになる', () => {
    // 信長どうし：体力を三段撃ちの2発分に下げると、互いの三段撃ちの弾が飛んでいるうちに両方が倒れる
    const d = createDuel({ left: 'gunner', right: gen('gunner'), dist: 12 });
    d.left.hp = d.right.hp = 200;
    runDuel(d);
    expect(d.end?.reason).toBe('both');
    expect(d.end?.winner).toBeNull();
    expect(d.left.hp).toBe(0);
    expect(d.right.hp).toBe(0);
  });

  it('1回しか当てていなければ、傷/秒は出さない', () => {
    const d = runDuel(createDuel({ left: 'inf', right: gen('sage'), dist: 12 }));
    const t = duelTotals(d, 'right');
    expect(t.count).toBe(1);
    expect(t.perSec).toBeNull();
  });

  it('どの組み合わせと距離でも、決着のあとに体力は変わらず、勝者は生きていて、一覧と体力が合う', () => {
    const rights: DuelRight[] = [
      ...GENERAL_ORDER.map(gen),
      ...DUEL_FACILITIES.map((type): DuelRight => ({ k: 'fac', type })),
    ];
    for (const left of UNIT_ORDER)
      for (const right of rights)
        for (const dist of [DUEL_DIST_MIN, 12, DUEL_DIST_MAX]) {
          const d = runDuel(createDuel({ left, right, dist }));
          const name = `${left} 対 ${JSON.stringify(right)} 距離${dist}`;
          const l = d.left.hp;
          const r = d.right.hp;
          if (d.end?.reason !== 'time') for (let i = 0; i < 60; i++) stepDuel(d);
          if (d.end?.reason !== 'time') expect([d.left.hp, d.right.hp], name).toEqual([l, r]);
          if (d.end?.winner === 'left') expect([l > 0, r], name).toEqual([true, 0]);
          if (d.end?.winner === 'right') expect([r > 0, l], name).toEqual([true, 0]);
          if (d.end?.reason === 'both') expect([l, r], name).toEqual([0, 0]);
          expect(duelTotals(d, 'left').total, name).toBeCloseTo(d.right.maxHp - r, 3);
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
