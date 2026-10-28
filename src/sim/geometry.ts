import { H, MOAT_BAND, RING, W, ZONE } from './defs';

// ---- 幾何 ---------------------------------------------------------------
export const tileIdx = (x: number, y: number) => y * W + x;
export const inB = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
// 攻撃側の出撃エリア
export const inRing = (x: number, y: number) => x < RING || y < RING || x >= W - RING || y >= H - RING;
export const inMoatBand = (x: number, y: number) =>
  Math.min(x - ZONE.x0, ZONE.x1 - x, y - ZONE.y0, ZONE.y1 - y) < MOAT_BAND;
export const inZone = (x: number, y: number) => x >= ZONE.x0 && x <= ZONE.x1 && y >= ZONE.y0 && y <= ZONE.y1;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
// 盤面の外周のマスを、左上の角から時計回りに並べたもの（出撃エリアを順にたどるため）
export function ringOrder(): [number, number][] {
  const r: [number, number][] = [];
  for (let x = 0; x < W - 1; x++) r.push([x, 0]);
  for (let y = 0; y < H - 1; y++) r.push([W - 1, y]);
  for (let x = W - 1; x > 0; x--) r.push([x, H - 1]);
  for (let y = H - 1; y > 0; y--) r.push([0, y]);
  return r;
}
// 決まった並びの乱数（mulberry32）。同じ seed なら同じ並び（地形と自動攻城の作戦で使う）
export function rngOf(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rectDist(px: number, py: number, x0: number, y0: number, w: number, h: number) {
  const dx = Math.max(x0 - px, 0, px - (x0 + w));
  const dy = Math.max(y0 - py, 0, py - (y0 + h));
  return Math.hypot(dx, dy);
}
