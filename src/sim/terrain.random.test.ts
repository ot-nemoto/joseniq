import { describe, expect, it } from 'vitest';
import { H, RING, W } from './defs';
import { allReachable, canDeployTile, landConnected, MAP_STYLE, MAPS, makeTerrain } from './terrain';

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1).concat([777, 2026]);
const isRing = (i: number) => i % W < RING || ((i / W) | 0) < RING || i % W >= W - RING || ((i / W) | 0) >= H - RING;

// 川が盤面の端から端まで流れているか：川のマスをたどって、2つ以上の辺に着くか
function edgeToEdge(water: number[]) {
  const seen = new Uint8Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (!water[s] || seen[s]) continue;
    const sides = new Set<string>();
    const q = [s];
    seen[s] = 1;
    for (let k = 0; k < q.length; k++) {
      const x = q[k] % W;
      const y = (q[k] / W) | 0;
      if (x === 0) sides.add('w');
      if (x === W - 1) sides.add('e');
      if (y === 0) sides.add('n');
      if (y === H - 1) sides.add('s');
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        const j = ny * W + nx;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[j] || !water[j]) continue;
        seen[j] = 1;
        q.push(j);
      }
    }
    // つながった川のかたまりごとに、2つ以上の辺に着いていなければ、途中で途切れている
    if (sides.size < 2) return false;
  }
  return true;
}

// 陸（川でないマス。橋は渡れる）のつながりの数。崖（2段以上の差）は通れない
function landGroups(heights: number[], water: number[], bridge: number[]) {
  const land = (i: number) => !water[i] || !!bridge[i];
  const seen = new Uint8Array(W * H);
  let n = 0;
  for (let s = 0; s < W * H; s++) {
    if (!land(s) || seen[s]) continue;
    n++;
    const q = [s];
    seen[s] = 1;
    for (let k = 0; k < q.length; k++) {
      const x = q[k] % W;
      const y = (q[k] / W) | 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        const j = ny * W + nx;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[j] || !land(j)) continue;
        if (Math.abs(heights[j] - heights[q[k]]) >= 2) continue;
        seen[j] = 1;
        q.push(j);
      }
    }
  }
  return n;
}

describe.each(MAPS.map((m) => m.id))('地図の型 %s', (id) => {
  it.each(SEEDS)('種 %i：段の範囲・外周から全マスへ行ける・川が端から端まで・割合の近く', (seed) => {
    const { heights, water, bridge } = makeTerrain(id, seed);
    const st = MAP_STYLE[id];
    expect(heights).toHaveLength(W * H);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...heights)).toBeLessThanOrEqual(st.top);
    expect(allReachable(heights)).toBe(true);
    // 川は渡れず橋だけ渡れる決まりで、どの出撃できるマスからも、陸のマスすべてへ行ける
    expect(landConnected(heights, water, bridge)).toBe(true);
    // 陸はひとつながり（どの出撃口から出ても、すべての陸へ行ける）
    expect(landGroups(heights, water, bridge)).toBe(1);
    // 橋は川のマスにだけかかり、少なくとも1つある
    expect(bridge.every((b, i) => !b || water[i])).toBe(true);
    expect(bridge.some((b) => b)).toBe(true);
    // 橋は1マスで、向かい合う両岸が陸で橋と同じ高さ。となりに橋は並ばない
    for (let i = 0; i < W * H; i++) {
      if (!bridge[i]) continue;
      const lr = !water[i - 1] && !water[i + 1];
      const ud = !water[i - W] && !water[i + W];
      expect(lr || ud).toBe(true);
      const [a, b] = lr ? [i - 1, i + 1] : [i - W, i + W];
      expect([heights[a], heights[b]]).toEqual([heights[i], heights[i]]);
      expect(bridge[i + 1] || bridge[i + W]).toBeFalsy();
    }
    // 出撃エリアの平地の割合（川のマスは除く）が、目安の近く
    const ring = heights.map((_, i) => i).filter((i) => isRing(i) && !water[i]);
    const flat = ring.filter((i) => canDeployTile(heights, water, i)).length / ring.length;
    expect(flat).toBeGreaterThan(st.flatRing - 0.15);
    expect(flat).toBeLessThanOrEqual(Math.min(1, st.flatRing + 0.15));
    expect(edgeToEdge(water)).toBe(true);
    const ratio = water.reduce((a, b) => a + b, 0) / (W * H);
    expect(ratio).toBeGreaterThan(st.river * 0.5);
    // 川は曲がるぶん1本が長いので、目安を超えるのは川1本ぶん（盤面の5％ほど）まで
    expect(ratio).toBeLessThan(st.river + 0.05);
    // 川は段を登らない：隣り合う川のマスの高さは同じ
    for (let i = 0; i < W * H; i++) {
      if (!water[i]) continue;
      if (i % W < W - 1 && water[i + 1]) expect(heights[i + 1]).toBe(heights[i]);
      if (i + W < W * H && water[i + W]) expect(heights[i + W]).toBe(heights[i]);
    }
  });
});

it('起伏のある型では、外周の出撃エリアにも起伏がある', () => {
  const { heights } = makeTerrain('yama', 7);
  expect(new Set(heights.filter((_, i) => isRing(i))).size).toBeGreaterThan(1);
});

it('同じ種なら同じ地形、違う種なら違う地形', () => {
  expect(makeTerrain('hirayama', 5)).toEqual(makeTerrain('hirayama', 5));
  expect(makeTerrain('hirayama', 5)).not.toEqual(makeTerrain('hirayama', 6));
});
