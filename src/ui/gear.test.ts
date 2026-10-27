import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { UNIT_ORDER } from '../sim';
import { buildGear } from './gear';
import { type Frame, SPR_CX, SPR_H, spriteGrid } from './pixel';

const FRAMES: readonly Frame[] = ['walk0', 'walk1', 'atk0', 'atk1', 'atk2'];

describe.each(UNIT_ORDER)('立体の持ち物：%s', (kind) => {
  it.each(FRAMES)('%s では、絵から外した武器・前立てと同じ所に立体を付ける', (frame) => {
    const full = spriteGrid(kind, frame).grid;
    const bare = spriteGrid(kind, frame, true).grid;
    // 絵から外したドット（輪郭は除く）
    const removed: Vector3[] = [];
    full.forEach((row, y) => {
      row.forEach((c, x) => {
        if (c && c !== 'K' && bare[y][x] !== c) removed.push(new Vector3(x + 0.5 - SPR_CX, SPR_H - y - 0.5, 0));
      });
    });
    const gear = buildGear(kind, frame);
    if (!removed.length) return;
    expect(gear).not.toBeNull();
    if (!gear) return;
    const box = new Box3().setFromObject(gear).expandByScalar(1.5);
    box.min.z = -10;
    box.max.z = 10;
    const inside = removed.filter((p) => box.containsPoint(p)).length;
    expect(inside / removed.length).toBeGreaterThan(0.8);
  });
  it('倒れたコマには付けない（落とした武器ごと絵で描く）', () => {
    expect(buildGear(kind, 'down0')).toBeNull();
    expect(buildGear(kind, 'down1')).toBeNull();
  });
});

it('斥候は持ち物がないので、付けない（絵のまま）', () => {
  expect(buildGear('scout', 'walk0')).toBeNull();
});
