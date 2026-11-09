import { describe, expect, it } from 'vitest';
import { ADEF, type AttackerKind, BDEF, GENERAL_ORDER, HALL, isBuildingType, UNIT_ORDER } from './defs';
import {
  createSample,
  hasSkillSample,
  isSampleFacility,
  retarget,
  type Sample,
  type SampleOf,
  stepSample,
} from './sample';

// 見本を sec 秒進め、見本にしたものが攻撃したかを返す（施設は、撃った飛び道具があったか）
function run(of: SampleOf, sec: number) {
  const sm = createSample(of);
  const s = sm.battle;
  const n = s.attackers.length + s.defenders.length; // 見本に出てくる武将と兵の数
  let attacked = false;
  let alive = true;
  const subject = () =>
    of.k === 'atk' ? s.attackers.find((u) => u.kind === of.kind) : of.k === 'def' ? s.defenders[0] : null;
  while (s.t < sec) {
    stepSample(sm);
    const u = subject();
    // 施設は、撃った飛び道具か、駆けつけた守将の攻撃（鐘楼）で見る
    attacked ||=
      of.k === 'fac' ? s.shots.some((sh) => sh.side === 'd') || s.defenders.some((g) => g.atkT > 0) : !!u && u.atkT > 0;
    alive &&= s.attackers.length + s.defenders.length === n && s.buildings.every((b) => b.hp > 0);
  }
  return { sm, attacked, alive };
}
// 見本にできる施設は BDEF から拾う（施設を足したら、見本で攻撃できるかもここで確かめる）
const FACILITIES = Object.keys(BDEF).filter(isBuildingType).filter(isSampleFacility);

describe('動作の見本', () => {
  it('撃つ施設と、まわりに効く施設を見本にできる（櫓・大筒・鼓楼・鐘楼）', () => {
    expect(FACILITIES).toEqual(['tbow', 'tgun', 'cata', 'drum', 'bell']);
  });

  it('鼓楼の見本では、隣の弓櫓が鼓楼の効き目の範囲にいる', () => {
    const sm = createSample({ k: 'fac', type: 'drum' });
    const drum = sm.battle.buildings.find((b) => b.type === 'drum');
    const tbow = sm.battle.buildings.find((b) => b.type === 'tbow');
    expect(drum && tbow && Math.hypot(drum.x0 - tbow.x0, drum.y0 - tbow.y0)).toBeLessThanOrEqual(BDEF.drum.aura ?? 0);
  });

  it('鐘楼の見本では、鐘が鳴って上杉謙信が駆けつけ、的を見張りの範囲の外へ移すと鐘が止まる', () => {
    const sm = createSample({ k: 'fac', type: 'bell' });
    const s = sm.battle;
    const g = s.defenders[0];
    let rang = false;
    let far = 0;
    while (s.t < 10) {
      stepSample(sm);
      rang ||= s.ringing.length > 0;
      far = Math.max(far, Math.hypot(g.x - g.hx, g.y - g.hy));
    }
    expect(rang).toBe(true);
    expect(far).toBeGreaterThan(3);
    // 鐘楼の北、見張りの範囲の外へ移す
    const bell = s.buildings.find((b) => b.type === 'bell');
    expect(retarget(sm, bell?.x0 ?? 0, (bell?.y0 ?? 0) - Math.ceil(BDEF.bell.aura ?? 0) - 1)).toBe(sm);
    stepSample(sm);
    expect(s.ringing).toEqual([]);
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
      // 少し歩かせてから置き直す（歩兵は通り道の近くの施設にしか寄らないので、通り道から2マスほどの所へ）
      for (let i = 0; i < 60; i++) stepSample(sm);
      const next = retarget(sm, HALL.x - 6, HALL.y - 2);
      if (!next) throw new Error('置き直せない');
      expect(next).not.toBe(sm);
      const tw = next.battle.buildings.find((b) => b.type === 'tbow');
      expect(tw).toMatchObject({ x0: HALL.x - 6, y0: HALL.y - 2 });
      // 攻め手は最初の位置へ戻らず、置き直す前にいた所から動く
      expect(next.battle.attackers[0]).toMatchObject({ x: sm.battle.attackers[0].x, y: sm.battle.attackers[0].y });
      const s = next.battle;
      const u = s.attackers[0];
      while (s.t < 20 && u.atkT < 0) stepSample(next);
      expect(Math.hypot(u.atkX - (HALL.x - 5.5), u.atkY - (HALL.y - 1.5))).toBeLessThan(1);
    },
  );

  it('建物のあるマスや盤面の外、攻め手の体がかかるマスは選べず、衝車の見本は相手を動かせない', () => {
    const fac = createSample({ k: 'fac', type: 'tbow' });
    expect(retarget(fac, HALL.x, HALL.y)).toBeNull();
    expect(retarget(fac, -1, 0)).toBeNull();
    expect(retarget(createSample({ k: 'atk', kind: 'ram' }), HALL.x - 6, HALL.y - 4)).toBeNull();
    // 攻め手の体がかかる隣のマスにも、弓櫓は置けない
    const atk = createSample({ k: 'atk', kind: 'inf' });
    const u = atk.battle.attackers[0];
    u.x = 8.95;
    expect(retarget(atk, 9, Math.floor(u.y))).toBeNull();
    expect(retarget(atk, 10, Math.floor(u.y))).not.toBeNull();
  });

  it('的は止めたまま動かない', () => {
    const { sm } = run({ k: 'def', kind: 'brave' }, 10);
    expect(sm.pin?.x).toBe(sm.px);
    expect(sm.pin?.y).toBe(sm.py);
  });
});

describe('スキルだけの見本', () => {
  const SKILLED = ['archer', 'brave', 'gunner', 'guard'] as const;

  it('スキルを持つ武将だけが、スキルだけの見本にできる', () => {
    for (const kind of GENERAL_ORDER) {
      expect(hasSkillSample({ k: 'atk', kind }), kind).toBe(SKILLED.includes(kind as (typeof SKILLED)[number]));
      expect(hasSkillSample({ k: 'def', kind }), kind).toBe(SKILLED.includes(kind as (typeof SKILLED)[number]));
    }
    expect(hasSkillSample({ k: 'atk', kind: 'inf' })).toBe(false);
    expect(createSample({ k: 'atk', kind: 'inf' }, undefined, true).skill).toBe(false);
  });

  it.each(SKILLED.flatMap((kind) => (['atk', 'def'] as const).map((k) => [kind, k] as const)))(
    '%s（%s）：毎回の番でスキルを出し、見本役は動かず、見本役にスキルが届く',
    (kind, k) => {
      const sm = createSample({ k, kind }, undefined, true);
      const s = sm.battle;
      const u = sm.subject;
      if (!u) throw new Error('見本にした武将がいない');
      expect(sm.skill).toBe(true);
      // 信長の三段撃ちは狙った1人へ撃つので、見本役を並べず、スキルごとに3発撃つのを見る
      const single = kind === 'gunner';
      expect(sm.dummies.length).toBe(single ? 0 : 2);
      const seen = new Set<object>();
      const perSkill: number[] = []; // スキルごとに撃った弾の数
      const at = sm.dummies.map((d) => [d.u.x, d.u.y]);
      const reached = sm.dummies.map(() => false);
      let skills = 0;
      let attacks = 0;
      let last = -1;
      while (s.t < 12) {
        stepSample(sm);
        for (const sh of s.shots)
          if (sh.side === u.side && !seen.has(sh)) {
            seen.add(sh);
            if (perSkill.length) perSkill[perSkill.length - 1]++;
          }
        if (u.atkT !== last) {
          if (u.atkSkill) {
            skills++;
            perSkill.push(0);
          } else attacks++;
          last = u.atkT;
        }
        sm.dummies.forEach((d, i) => {
          // 傷を受けると光る（体力は見本が満タンに戻す）。家康は、傷を減らす効果が掛かる
          reached[i] ||= kind === 'guard' ? d.u.wardEnd > 0 : d.u.fl > 0;
        });
      }
      expect(skills).toBeGreaterThanOrEqual(3);
      expect(attacks).toBe(0);
      expect(sm.dummies.map((d) => [d.u.x, d.u.y])).toEqual(at);
      // 最後のスキルは撃ち終える前に見本を止めることがあるので、それより前のスキルで、毎回3発撃つかを見る
      if (single) expect(perSkill.slice(0, -1)).toEqual(perSkill.slice(0, -1).map(() => ADEF.gunner.skillVolley));
      else expect(reached).toEqual([true, true]);
    },
  );

  it.each(['atk', 'def'] as const)('上杉謙信（%s）：どの回転斬りも、見本役2人に当たる', (k) => {
    const sm = createSample({ k, kind: 'brave' }, undefined, true);
    const u = sm.subject;
    if (!u) throw new Error('見本にした武将がいない');
    let spins = 0;
    while (sm.battle.t < 12) {
      const casting = !!u.cast;
      stepSample(sm);
      if (casting && !u.cast) {
        spins++;
        // 回転斬りが効いたティック：見本役はどちらも傷を受けて光る
        expect(sm.dummies.map((d) => d.u.fl > 0)).toEqual([true, true]);
      }
    }
    expect(spins).toBeGreaterThanOrEqual(3);
  });

  it.each(['atk', 'def'] as const)('大島光義（%s）は、はじめの場所に留まって撃ち続ける', (k) => {
    const sm = createSample({ k, kind: 'archer' }, undefined, true);
    const u = sm.subject;
    if (!u) throw new Error('見本にした武将がいない');
    const [x, y] = [u.x, u.y];
    while (sm.battle.t < 8) stepSample(sm);
    expect([u.x, u.y]).toEqual([x, y]);
  });

  it.each(['atk', 'def'] as const)(
    '大島光義（%s）は、相手をスキルの射程の外へ動かすと、射程に入るまで歩いてから撃つ',
    (k) => {
      let sm = createSample({ k, kind: 'archer' }, undefined, true);
      const u0 = sm.subject;
      if (!u0) throw new Error('見本にした武将がいない');
      const [x0, y0] = [u0.x, u0.y];
      // 攻めは弓櫓を、守りは的を、光義から12マスより遠くへ動かす
      const next = k === 'atk' ? retarget(sm, HALL.x - 1, HALL.y - 6) : retarget(sm, Math.floor(x0), HALL.y - 12);
      if (!next) throw new Error('動かせない');
      sm = next;
      const u = sm.subject;
      if (!u) throw new Error('見本にした武将がいない');
      const t0 = sm.battle.t;
      let shots = 0;
      let last = u.atkT;
      while (sm.battle.t < t0 + 15) {
        stepSample(sm);
        if (u.atkT !== last) {
          expect(u.atkSkill).toBe(true);
          shots++;
          last = u.atkT;
        }
      }
      expect(Math.hypot(u.x - x0, u.y - y0)).toBeGreaterThan(1);
      expect(shots).toBeGreaterThanOrEqual(2);
    },
  );

  it.each(['atk', 'def'] as const)('大島光義（%s）：見本役が盤面の外に出る所へは、弓櫓・的を動かせない', (k) => {
    const sm = createSample({ k, kind: 'archer' }, undefined, true);
    expect(retarget(sm, 1, HALL.y - 3)).toBeNull();
    // スキルだけの見本でなければ動かせる
    expect(retarget(createSample({ k, kind: 'archer' }), 1, HALL.y - 3)).not.toBeNull();
  });

  it('攻め手の見本で弓櫓を置き直しても、スキルだけの見本のまま', () => {
    const sm = createSample({ k: 'atk', kind: 'archer' }, undefined, true);
    const next = retarget(sm, HALL.x - 4, HALL.y - 3);
    expect(next?.skill).toBe(true);
    expect(next?.dummies.length).toBe(2);
  });
});
