import { describe, expect, it } from 'vitest';
import { GENERAL_ORDER, isGeneralKind, UNIT_ORDER } from '../sim';
import { bushoMon } from './pixel';

describe.each(GENERAL_ORDER)('武将の幟：%s', (kind) => {
  it('幟の家紋があり、旗に収まる大きさ（幅8×高さ9まで）', () => {
    const { pix } = bushoMon(kind);
    expect(pix.length).toBeGreaterThan(0);
    expect(pix.length).toBeLessThanOrEqual(9);
    for (const row of pix) expect(row.length).toBeLessThanOrEqual(8);
  });
});

it('武将ごとに家紋が違う', () => {
  const mons = GENERAL_ORDER.map((k) => bushoMon(k).mon);
  expect(new Set(mons).size).toBe(mons.length);
});

it('兵は幟を持たない', () => {
  for (const k of UNIT_ORDER) expect(bushoMon(k).pix.length > 0).toBe(isGeneralKind(k));
});
