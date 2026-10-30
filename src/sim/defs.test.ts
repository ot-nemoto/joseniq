import { describe, expect, it } from 'vitest';
import { ADEF, type AttackerKind, GDEF, GENERAL_ORDER, type GeneralKind, isGeneralKind, UNIT_ORDER } from './defs';

// 全員分を求める表（Record）から、武将と兵の種類の一覧を取る（並び順の配列と比べるため）
const GENERALS_ALL = Object.keys(GDEF) as GeneralKind[];
const UNITS_ALL = Object.keys(ADEF) as AttackerKind[];
const TROOPS = UNITS_ALL.filter((k) => !isGeneralKind(k));
// 片方の側にしかない、動かし方の設定（能力値ではない。docs/design.md）。ここにない値は能力値として、攻守で同じでなければならない
const DEFENSE_ONLY = new Set(['aggro', 'leash']);
const ATTACK_ONLY = new Set(['cost', 'limit', 'general', 'fac', 'gate', 'hall', 'pref']);
const abilities = (row: object, sideOnly: Set<string>) =>
  Object.fromEntries(Object.entries(row).filter(([key]) => !sideOnly.has(key)));

describe('武将の能力は、攻めと守りで同じ（docs/design.md）', () => {
  // 両方の表を比べるので、片方だけで足す・変えると落ちる。両方で同じ値に上書きしたときは、攻守で同じなので通る
  it.each(GENERALS_ALL)('%s：能力値が、守りの表と攻めの表で同じ（片方にだけある能力もない）', (k) => {
    expect(abilities(ADEF[k], ATTACK_ONLY)).toEqual(abilities(GDEF[k], DEFENSE_ONLY));
  });

  it.each(GENERALS_ALL)('%s：攻めの表では武将として扱う（兵力を使わず、1人まで）', (k) => {
    expect(ADEF[k]).toMatchObject({ general: true, limit: 1, cost: 0 });
  });

  it.each(TROOPS)('%s：兵の行は、武将として扱わない', (k) => {
    expect(ADEF[k].general).toBeFalsy();
  });
});

describe('並び順の配列に、全員がちょうど1回ずつ入っている（入れ忘れると画面や判定から黙って抜けるため）', () => {
  it('GENERAL_ORDER に、武将が全員入っている', () => {
    expect([...GENERAL_ORDER].sort()).toEqual([...GENERALS_ALL].sort());
  });

  it('UNIT_ORDER に、兵と武将が全員入っている', () => {
    expect([...UNIT_ORDER].sort()).toEqual([...UNITS_ALL].sort());
  });
});
