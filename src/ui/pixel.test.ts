import { describe, expect, it } from 'vitest';
import { GENERAL_ORDER, UNIT_ORDER } from '../sim';
import { bushoMon, type Frame, SPR_H, SPR_W, spriteGrid, spriteScale, TROOP_SCALE } from './pixel';

const FRAMES: readonly Frame[] = ['walk0', 'walk1', 'walk2', 'walk3', 'atk0', 'atk1', 'atk2', 'down0', 'down1'];
const key = (g: string[][]) => g.map((r) => r.map((c) => c || '.').join('')).join('\n');

describe.each(UNIT_ORDER)('ドット絵：%s', (kind) => {
  it.each(FRAMES)('%s は絵の枠に収まる', (frame) => {
    const { grid, clipped, edge } = spriteGrid(kind, frame);
    expect(grid).toHaveLength(SPR_H);
    for (const row of grid) expect(row).toHaveLength(SPR_W);
    expect(clipped).toBe(0);
    // 枠の端に接したドットは、外側の輪郭が描けずに欠ける
    expect(edge).toBe(0);
    // 何かしら描かれている
    expect(grid.flat().filter((c) => c).length).toBeGreaterThan(50);
  });

  // 斥候は攻撃しない（手を振るだけ）ので、攻撃の絵は比べない
  it.skipIf(kind === 'scout')('攻撃の3コマは、それぞれ別の絵になる', () => {
    const [a0, a1, a2] = (['atk0', 'atk1', 'atk2'] as const).map((f) => key(spriteGrid(kind, f).grid));
    expect(a0).not.toBe(a1);
    expect(a1).not.toBe(a2);
    expect(a0).not.toBe(a2);
  });

  it('歩くコマは、立ち姿と違う絵を含む', () => {
    const stand = key(spriteGrid(kind, 'walk0').grid);
    expect(key(spriteGrid(kind, 'walk1').grid)).not.toBe(stand);
    expect(key(spriteGrid(kind, 'walk3').grid)).not.toBe(stand);
  });

  it('倒れる2コマは、立ち姿と違う絵になる', () => {
    const stand = key(spriteGrid(kind, 'walk0').grid);
    expect(key(spriteGrid(kind, 'down0').grid)).not.toBe(stand);
    expect(key(spriteGrid(kind, 'down1').grid)).not.toBe(stand);
  });
});

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

it('兵は幟を持たず、武将より小さく貼る', () => {
  for (const k of UNIT_ORDER) {
    const general = (GENERAL_ORDER as readonly string[]).includes(k);
    expect(bushoMon(k).pix.length > 0).toBe(general);
    expect(spriteScale(k)).toBe(general ? 1 : TROOP_SCALE);
  }
  expect(TROOP_SCALE).toBeLessThan(1);
});

it('兵の絵は、兵種ごとに違う', () => {
  const troops = UNIT_ORDER.filter((k) => !(GENERAL_ORDER as readonly string[]).includes(k));
  const pics = troops.map((k) => key(spriteGrid(k, 'walk0').grid));
  expect(new Set(pics).size).toBe(troops.length);
});
