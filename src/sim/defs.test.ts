import { describe, expect, it } from 'vitest';
import { ADEF, type AttackerKind, GDEF, GENERAL_ORDER, type GeneralKind, UNIT_ORDER } from './defs';

// 全員分を求める表（Record）から、武将と兵の種類の一覧を取る（並び順の配列と比べるため）
const GENERALS_ALL = Object.keys(GDEF) as GeneralKind[];
const UNITS_ALL = Object.keys(ADEF) as AttackerKind[];
// 守りにだけある値（守り方の設定で、能力値ではない。docs/design.md）
const DEFENSE_ONLY = new Set(['aggro', 'leash']);

describe('武将の能力は、攻めと守りで同じ（docs/design.md）', () => {
  it.each(GENERALS_ALL)('%s：守りの表の能力値が、攻めの表でも同じ', (k) => {
    const def = GDEF[k] as unknown as Record<string, unknown>;
    const atk = ADEF[k] as unknown as Record<string, unknown>;
    for (const [key, v] of Object.entries(def)) {
      if (DEFENSE_ONLY.has(key)) continue;
      expect({ key, v: atk[key] }).toEqual({ key, v });
    }
  });

  it.each(GENERALS_ALL)('%s：攻めの表では武将として扱う（兵力を使わず、1人まで）', (k) => {
    expect(ADEF[k]).toMatchObject({ general: true, limit: 1, cost: 0 });
  });

  it('兵の行は、武将として扱わない', () => {
    for (const k of UNITS_ALL) if (!(k in GDEF)) expect(ADEF[k].general).toBeFalsy();
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
