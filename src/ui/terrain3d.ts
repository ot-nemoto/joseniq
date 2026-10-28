// 3Dの地面：マスごとの高さ（段）で持ち上げた上面と、段の側面。上面には盤面の絵（地面の canvas）を貼る。
// 堀のマスは掘り下げて岸に石の壁を立て、水面を張る
import { BufferGeometry, Color, Float32BufferAttribute, Group, type Material, Mesh, MeshLambertMaterial } from 'three';
import { H, isCliff, W } from '../sim';
import { ART } from './models';

export const ZSTEP = 1.0; // 1段の高さ（マス単位）
const BASE = -0.5; // 盤面の台の下の端
const MOAT_DEPTH = 0.32; // 堀の底の、まわりの地面からの深さ
export const WATER_DEPTH = 0.1; // 堀の水面の、まわりの地面からの深さ
const WADE = 0.2; // 堀を渡る武将・兵の足元の、まわりの地面からの深さ（腰まで水に浸かって見える）

export type Heights = ArrayLike<number> | undefined;
// 堀のマス（1なら堀）。なければ堀はない
export type Moat = ArrayLike<number> | undefined;
// 盤面の外は平地として扱う
const at = (hs: Heights, x: number, y: number) => (!hs || x < 0 || y < 0 || x >= W || y >= H ? 0 : hs[y * W + x]);
const isMoat = (moat: Moat, x: number, y: number) =>
  !!moat && x >= 0 && y >= 0 && x < W && y < H && moat[y * W + x] === 1;

// 盤面の位置 (x, y) の地面の高さ（3Dの座標）。地面の形と同じく、マスごとの段の高さ。堀の中は水に浸かる高さ
// （段を移るときに跳ねないよう、武将や兵の高さは renderer.ts で少しずつ追わせる）
export function groundZ(hs: Heights, x: number, y: number, moat?: Moat) {
  const tx = Math.min(W - 1, Math.max(0, Math.floor(x)));
  const ty = Math.min(H - 1, Math.max(0, Math.floor(y)));
  return at(hs, tx, ty) * ZSTEP - (isMoat(moat, tx, ty) ? WADE : 0);
}
// 敷地のいちばん高いマスの高さ（建物を置く高さ）
export function footZ(hs: Heights, x0: number, y0: number, w: number, h: number) {
  let m = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) m = Math.max(m, at(hs, x, y));
  return m * ZSTEP;
}

// 地面の形を作る。top は上面（盤面の絵を貼る材質）、water は堀の水面の材質。上面・側面・水面の Mesh を返す
export function buildTerrain(hs: Heights, top: Material, moat?: Moat, water?: Material): Group {
  const g = new Group();
  // マスの上面の高さ。堀のマスは底まで下げる
  const topZ = (x: number, y: number) => at(hs, x, y) * ZSTEP - (isMoat(moat, x, y) ? MOAT_DEPTH : 0);
  // 上面：マスごとの四角。絵は盤面全体に1枚を貼る
  const pos: number[] = [];
  const uv: number[] = [];
  const wpos: number[] = [];
  const wuv: number[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const z = topZ(x, y);
      const quad = [
        [x, y],
        [x, y + 1],
        [x + 1, y + 1],
        [x, y],
        [x + 1, y + 1],
        [x + 1, y],
      ];
      for (const [px, py] of quad) {
        pos.push(px, z, py);
        uv.push(px / W, 1 - py / H);
      }
      // 堀の水面：まわりの地面より少し下に張る。さざ波の模様は盤面の座標で貼る
      if (isMoat(moat, x, y))
        for (const [px, py] of quad) {
          wpos.push(px, at(hs, x, y) * ZSTEP - WATER_DEPTH, py);
          wuv.push(px / 2, py / 2);
        }
    }
  const tg = new BufferGeometry();
  tg.setAttribute('position', new Float32BufferAttribute(pos, 3));
  tg.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  tg.computeVertexNormals();
  const tm = new Mesh(tg, top);
  tm.receiveShadow = true;
  tm.name = 'top';
  g.add(tm);

  // 側面：隣より高いマスの縁に、低い側へ向いた壁を立てる。盤面の外周は台の下の端まで下ろす
  // 1段の段差（坂）は土の段々（上り下りできることを見せる）、崖（2段以上）は岩肌、盤面の外周は濃い土、堀の岸は石
  const sp: number[] = [];
  const sc: number[] = [];
  const earth = new Color(ART.hill);
  const rock = new Color(ART.rock);
  const earthHi = new Color(ART.hill).multiplyScalar(1.15);
  const earthLine = new Color(ART.hill2);
  const rim = new Color(ART.hill2);
  const bank = new Color(ART.bank);
  // 縁の向き：隣の向き (dx, dy) と、縁の両端（マスの左上からのずれ）。低い側から見て表になる順に並べる
  const SIDES = [
    { dx: 0, dy: -1, a: [1, 0], b: [0, 0] },
    { dx: 1, dy: 0, a: [1, 1], b: [1, 0] },
    { dx: 0, dy: 1, a: [0, 1], b: [1, 1] },
    { dx: -1, dy: 0, a: [0, 0], b: [0, 1] },
  ];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const h = at(hs, x, y);
      const here = isMoat(moat, x, y);
      for (const e of SIDES) {
        const nx = x + e.dx;
        const ny = y + e.dy;
        const out = nx < 0 || ny < 0 || nx >= W || ny >= H;
        const z0 = out ? BASE : topZ(nx, ny);
        const ax = x + e.a[0];
        const ay = y + e.a[1];
        const bx = x + e.b[0];
        const by = y + e.b[1];
        // 縁に、高さ lo〜hi の壁を立てる。inward なら、このマスの側（堀の中）を向ける
        const wall = (lo: number, hi: number, c: Color, inward = false) => {
          const quad = [
            [ax, lo, ay],
            [bx, lo, by],
            [bx, hi, by],
            [ax, lo, ay],
            [bx, hi, by],
            [ax, hi, ay],
          ];
          if (inward) quad.reverse();
          for (const [px, pz, py] of quad) {
            sp.push(px, pz, py);
            sc.push(c.r, c.g, c.b);
          }
        };
        // 堀のマスの縁で、隣が堀でなく、まわりの地面（rimZ）より低いとき（低いマス・盤面の外周）は、
        // 水面の下が開かないよう、まわりの地面の高さまで石の岸を立てる（外向きと、堀の中向き）
        const rimZ = h * ZSTEP;
        if (here && (out || !isMoat(moat, nx, ny)) && z0 < rimZ) {
          wall(z0, rimZ, out ? rim : bank);
          wall(Math.max(z0, topZ(x, y)), rimZ, bank, true);
          continue;
        }
        const z1 = topZ(x, y);
        if (z0 >= z1) continue;
        const hn = out ? 0 : at(hs, nx, ny);
        if (!out && !isMoat(moat, x, y) && !isMoat(moat, nx, ny) && h - hn === 1) {
          // 坂（1段の差）：土の壁を3段の段々にし、段ごとに明るさを変えて、上り下りできることを見せる
          // 段と段のあいだには、細い濃い土の筋を入れる
          const dz = (z1 - z0) / 3;
          const line = 0.03;
          for (let k = 0; k < 3; k++) {
            const lo = z0 + dz * k + (k > 0 ? line : 0);
            const hi = z0 + dz * (k + 1) - (k < 2 ? line : 0);
            wall(lo, hi, k % 2 ? earthHi : earth);
            if (k < 2) wall(hi, hi + 2 * line, earthLine);
          }
          continue;
        }
        wall(z0, z1, out ? rim : isMoat(moat, nx, ny) ? bank : isCliff(h, hn) ? rock : earth);
      }
    }
  const sg = new BufferGeometry();
  sg.setAttribute('position', new Float32BufferAttribute(sp, 3));
  sg.setAttribute('color', new Float32BufferAttribute(sc, 3));
  sg.computeVertexNormals();
  const sm = new Mesh(sg, new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  sm.receiveShadow = true;
  sm.castShadow = true;
  sm.name = 'side';
  g.add(sm);
  if (water && wpos.length) {
    const wg = new BufferGeometry();
    wg.setAttribute('position', new Float32BufferAttribute(wpos, 3));
    wg.setAttribute('uv', new Float32BufferAttribute(wuv, 2));
    wg.computeVertexNormals();
    const wm = new Mesh(wg, water);
    wm.receiveShadow = true;
    wm.name = 'water';
    g.add(wm);
  }
  return g;
}
