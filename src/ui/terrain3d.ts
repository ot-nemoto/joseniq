// 3Dの地面：マスごとの高さ（段）で持ち上げた上面と、段の側面。上面には盤面の絵（地面の canvas）を貼る
import { BufferGeometry, Color, Float32BufferAttribute, Group, type Material, Mesh, MeshLambertMaterial } from 'three';
import { H, isCliff, W } from '../sim';
import { ART } from './models';

export const ZSTEP = 0.35; // 1段の高さ（マス単位）
const BASE = -0.5; // 盤面の台の下の端

export type Heights = ArrayLike<number> | undefined;
// 盤面の外は平地として扱う
const at = (hs: Heights, x: number, y: number) => (!hs || x < 0 || y < 0 || x >= W || y >= H ? 0 : hs[y * W + x]);

// 盤面の位置 (x, y) の地面の高さ（3Dの座標）。地面の形と同じく、マスごとの段の高さ
// （段を移るときに跳ねないよう、武将や兵の高さは renderer.ts で少しずつ追わせる）
export function groundZ(hs: Heights, x: number, y: number) {
  const tx = Math.min(W - 1, Math.max(0, Math.floor(x)));
  const ty = Math.min(H - 1, Math.max(0, Math.floor(y)));
  return at(hs, tx, ty) * ZSTEP;
}
// 敷地のいちばん高いマスの高さ（建物を置く高さ）
export function footZ(hs: Heights, x0: number, y0: number, w: number, h: number) {
  let m = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) m = Math.max(m, at(hs, x, y));
  return m * ZSTEP;
}

// 地面の形を作る。top は上面（盤面の絵を貼る材質）。上面と側面の2つの Mesh を返す
export function buildTerrain(hs: Heights, top: Material): Group {
  const g = new Group();
  // 上面：マスごとの四角。絵は盤面全体に1枚を貼る
  const pos: number[] = [];
  const uv: number[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const z = at(hs, x, y) * ZSTEP;
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
  // 色は、1段の段差は土、崖（2段以上）は岩肌、盤面の外周は濃い土
  const sp: number[] = [];
  const sc: number[] = [];
  const earth = new Color(ART.hill);
  const rock = new Color(ART.rock);
  const rim = new Color(ART.hill2);
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
      for (const e of SIDES) {
        const nx = x + e.dx;
        const ny = y + e.dy;
        const out = nx < 0 || ny < 0 || nx >= W || ny >= H;
        const hn = out ? BASE / ZSTEP : at(hs, nx, ny);
        if (hn >= h) continue;
        const z1 = h * ZSTEP;
        const z0 = out ? BASE : hn * ZSTEP;
        const c = out ? rim : isCliff(h, hn) ? rock : earth;
        const ax = x + e.a[0];
        const ay = y + e.a[1];
        const bx = x + e.b[0];
        const by = y + e.b[1];
        for (const [px, pz, py] of [
          [ax, z0, ay],
          [bx, z0, by],
          [bx, z1, by],
          [ax, z0, ay],
          [bx, z1, by],
          [ax, z1, ay],
        ]) {
          sp.push(px, pz, py);
          sc.push(c.r, c.g, c.b);
        }
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
  return g;
}
