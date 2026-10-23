import { describe, expect, it } from 'vitest';
import { GENERAL_ORDER } from '../sim';
import { bushoMon, type Frame, SPR_H, SPR_W, spriteGrid } from './pixel';

const FRAMES: readonly Frame[] = ['walk0', 'walk1', 'walk2', 'walk3', 'atk0', 'atk1', 'atk2', 'down0', 'down1'];
const key = (g: string[][]) => g.map((r) => r.map((c) => c || '.').join('')).join('\n');

describe.each(GENERAL_ORDER)('ドット絵：%s', (kind) => {
  it.each(FRAMES)('%s は絵の枠に収まる', (frame) => {
    const { grid, clipped } = spriteGrid(kind, frame);
    expect(grid).toHaveLength(SPR_H);
    for (const row of grid) expect(row).toHaveLength(SPR_W);
    expect(clipped).toBe(0);
    // 何かしら描かれている
    expect(grid.flat().filter((c) => c).length).toBeGreaterThan(50);
  });

  it('攻撃の3コマは、それぞれ別の絵になる', () => {
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
