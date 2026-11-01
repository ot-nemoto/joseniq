import { describe, expect, it } from 'vitest';
import { BDEF, GENERAL_ORDER, isBuildingType, UNIT_ORDER } from './defs';
import { createSample, isSampleFacility, type Sample, type SampleOf, stepSample } from './sample';

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

  it('的は止めたまま動かない', () => {
    const { sm } = run({ k: 'def', kind: 'brave' }, 10);
    expect(sm.pin?.x).toBe(sm.px);
    expect(sm.pin?.y).toBe(sm.py);
  });
});
