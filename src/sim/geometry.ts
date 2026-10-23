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

export function rectDist(px: number, py: number, x0: number, y0: number, w: number, h: number) {
  const dx = Math.max(x0 - px, 0, px - (x0 + w));
  const dy = Math.max(y0 - py, 0, py - (y0 + h));
  return Math.hypot(dx, dy);
}
