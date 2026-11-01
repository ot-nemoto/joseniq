import { describe, expect, it } from 'vitest';
import { type AttackerKind, BDEF, GENERAL_ORDER, HALL, isBuildingType, UNIT_ORDER } from './defs';
import { createSample, isSampleFacility, retarget, type Sample, type SampleOf, stepSample } from './sample';

// 見本を sec 秒進め、見本にしたものが攻撃したかを返す（施設は、撃った飛び道具があったか）
function run(of: SampleOf, sec: number) {
  const sm = createSample(of);
  const s = sm.battle;
  let attacked = false;
  let alive = true;
  const subject = () =>
    of.k === 'atk' ? s.attackers.find((u) => u.kind === of.kind) : of.k === 'def' ? s.defenders[0] : null;
  while (s.t < sec) {
    stepSample(sm);
    const u = subject();
    attacked ||= of.k === 'fac' ? s.shots.some((sh) => sh.side === 'd') : !!u && u.atkT > 0;
    alive &&= s.attackers.length + s.defenders.length === count(sm) && s.buildings.every((b) => b.hp > 0);
  }
  return { sm, attacked, alive };
}
// 見本に出てくる武将と兵の数（攻め手は1人、施設は的の盾兵だけ、守りの武将は武将と的の盾兵）
const count = (sm: Sample) => (sm.of.k === 'def' ? 2 : 1);
// 撃つ施設は BDEF から拾う（撃つ施設を足したら、見本で撃てるかもここで確かめる）
const FACILITIES = Object.keys(BDEF).filter(isBuildingType).filter(isSampleFacility);

describe('動きの見本', () => {
  it('撃つ施設だけを見本にできる（櫓と大筒）', () => {
    expect(FACILITIES).toEqual(['tbow', 'tgun', 'cata']);
  });

  // 斥候は攻撃しない囮なので、攻撃の確かめから外す
  it.each(UNIT_ORDER.filter((k) => k !== 'scout'))('攻め手 %s は、15秒のうちに攻撃する', (kind) => {
    const { attacked } = run({ k: 'atk', kind }, 15);
    expect(attacked).toBe(true);
  });

  it.each(FACILITIES)('施設 %s は、15秒のうちに撃つ', (type) => {
    const { attacked } = run({ k: 'fac', type }, 15);
    expect(attacked).toBe(true);
  });

  it.each(GENERAL_ORDER)('守りの武将 %s は、15秒のうちに攻撃する', (kind) => {
    const { attacked } = run({ k: 'def', kind }, 15);
    expect(attacked).toBe(true);
  });

  it.each([
    { k: 'atk', kind: 'gunner' },
    { k: 'atk', kind: 'scout' },
    { k: 'fac', type: 'cata' },
    { k: 'def', kind: 'sage' },
  ] as SampleOf[])('$k の見本は、60秒たってもだれも倒れず、戦いも終わらない', (of) => {
    const { sm, alive } = run(of, 60);
    expect(alive).toBe(true);
    expect(sm.battle.over).toBe(false);
  });

  // 撃つ側から見て北・東・南のマス（施設と守りの武将の見本は、撃つ側にカメラを向けている）
  const around = (sm: Sample, d: number) =>
    [
      [0, -1],
      [1, 0],
      [0, 1],
    ].map(([dx, dy]) => ({ x: Math.floor(sm.focus.x) + dx * d, y: Math.floor(sm.focus.y) + dy * d, dx, dy }));

  it.each([
    { k: 'fac', type: 'cata' },
    { k: 'fac', type: 'tbow' },
    { k: 'def', kind: 'brave' },
    { k: 'def', kind: 'archer' },
  ] as SampleOf[])('$k の見本は、押したマスへ的を移すと、そちらへ攻撃する', (of) => {
    for (const p of around(createSample(of), 4)) {
      const sm = createSample(of);
      expect(retarget(sm, p.x, p.y)).toBe(sm);
      expect(sm.pin?.x).toBe(p.x + 0.5);
      expect(sm.pin?.y).toBe(p.y + 0.5);
      const s = sm.battle;
      let toward = false;
      while (s.t < 15 && !toward) {
        stepSample(sm);
        const u = s.defenders[0];
        // 施設は飛び道具の向き、武将は攻撃した位置の向きで見る
        const v =
          of.k === 'fac'
            ? s.shots.map((sh) => [sh.tx - sh.sx, sh.ty - sh.sy])
            : u && u.atkT > 0
              ? [[u.atkX - sm.focus.x, u.atkY - sm.focus.y]]
              : [];
        toward = v.some(([x, y]) => x * p.dx + y * p.dy > 0);
      }
      expect(toward).toBe(true);
      expect(sm.pin?.x).toBe(sm.px);
    }
  });

  it.each(['inf', 'archer'] as AttackerKind[])(
    '攻め手 %s の見本は、押したマスに弓櫓を置き直し、今いる所からそれを攻める',
    (kind) => {
      const sm = createSample({ k: 'atk', kind });
      // 少し歩かせてから置き直す
      for (let i = 0; i < 60; i++) stepSample(sm);
      const next = retarget(sm, HALL.x - 6, HALL.y - 4);
      if (!next) throw new Error('置き直せない');
      expect(next).not.toBe(sm);
      const tw = next.battle.buildings.find((b) => b.type === 'tbow');
      expect(tw).toMatchObject({ x0: HALL.x - 6, y0: HALL.y - 4 });
      // 攻め手は最初の位置へ戻らず、置き直す前にいた所から動く
      expect(next.battle.attackers[0]).toMatchObject({ x: sm.battle.attackers[0].x, y: sm.battle.attackers[0].y });
      const s = next.battle;
      const u = s.attackers[0];
      while (s.t < 20 && u.atkT < 0) stepSample(next);
      expect(Math.hypot(u.atkX - (HALL.x - 5.5), u.atkY - (HALL.y - 3.5))).toBeLessThan(1);
    },
  );

  it('建物のあるマスや盤面の外は選べず、衝車の見本は相手を動かせない', () => {
    const fac = createSample({ k: 'fac', type: 'tbow' });
    expect(retarget(fac, HALL.x, HALL.y)).toBeNull();
    expect(retarget(fac, -1, 0)).toBeNull();
    expect(retarget(createSample({ k: 'atk', kind: 'ram' }), HALL.x - 6, HALL.y - 4)).toBeNull();
  });

  it('的は止めたまま動かない', () => {
    const { sm } = run({ k: 'def', kind: 'brave' }, 10);
    expect(sm.pin?.x).toBe(sm.px);
    expect(sm.pin?.y).toBe(sm.py);
  });
});
