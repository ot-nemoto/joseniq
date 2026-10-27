// 建物の模様の貼り絵（瓦・石垣・漆喰・下見板・木）。コードで描き、一度だけ作って使い回す。
// どれも「明るさの絵（色に掛ける）」と「凹凸の絵（法線マップ）」の組で作る。明るさの絵は白に近い灰色にし、
// 材質の色（石垣の色・屋根の色など）を掛けて使う
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

export type Pattern = 'tile' | 'stone' | 'plaster' | 'board' | 'wood' | 'water';
// 1枚の絵が覆う大きさ（マス）。貼る向きは models.ts の worldUV で、面に沿って決める
export const PATTERN_SPAN: Record<Pattern, number> = {
  tile: 0.5,
  stone: 0.6,
  plaster: 1,
  board: 0.5,
  wood: 0.5,
  water: 2,
};

const SIZE = 256;

// 決まった並びの乱数（毎回同じ模様にする。建物の破片の散らばり方にも使う）
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 高さの絵 h（0〜1）と明るさの絵 l（0〜1）から、2枚の貼り絵を作る。strength は凹凸の強さ
function make(h: Float32Array, l: Float32Array, strength: number) {
  const map = document.createElement('canvas');
  const nrm = document.createElement('canvas');
  map.width = map.height = nrm.width = nrm.height = SIZE;
  const mg = map.getContext('2d');
  const ng = nrm.getContext('2d');
  if (mg && ng) {
    const md = mg.createImageData(SIZE, SIZE);
    const nd = ng.createImageData(SIZE, SIZE);
    const at = (x: number, y: number) => h[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const i = y * SIZE + x;
        const v = Math.round(Math.min(1, Math.max(0, l[i])) * 255);
        md.data.set([v, v, v, 255], i * 4);
        // 隣との高さの差から面の向きを求める（絵の下向きが v の正の向き）
        const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
        const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
        const len = Math.hypot(dx, dy, 1);
        nd.data.set(
          [((-dx / len) * 0.5 + 0.5) * 255, ((dy / len) * 0.5 + 0.5) * 255, ((1 / len) * 0.5 + 0.5) * 255, 255],
          i * 4,
        );
      }
    mg.putImageData(md, 0, 0);
    ng.putImageData(nd, 0, 0);
  }
  const t = new CanvasTexture(map);
  t.colorSpace = SRGBColorSpace;
  const n = new CanvasTexture(nrm);
  for (const x of [t, n]) {
    x.wrapS = x.wrapT = RepeatWrapping;
    x.anisotropy = 8;
  }
  return { map: t, normal: n };
}

// 瓦：上から下へ流れる丸瓦の筋と、段ごとの重なり
function tile() {
  const h = new Float32Array(SIZE * SIZE);
  const l = new Float32Array(SIZE * SIZE);
  const cols = 8;
  const rows = 6;
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const u = (x / SIZE) * cols;
      const v = (y / SIZE) * rows;
      const across = Math.abs(Math.sin(Math.PI * u)); // 丸瓦の丸み
      const lap = v - Math.floor(v); // 段の中の位置（下ほど手前に出る）
      const i = y * SIZE + x;
      h[i] = across * 0.8 + lap * 0.35;
      l[i] = 0.72 + across * 0.22 + lap * 0.08 - (lap > 0.93 ? 0.25 : 0);
    }
  return make(h, l, 6);
}
// 石垣：大きさのそろわない石を、段をずらして積む。石ごとに明るさを変え、目地をへこませる
function stone() {
  const h = new Float32Array(SIZE * SIZE);
  const l = new Float32Array(SIZE * SIZE).fill(0.45);
  const r = rng(7);
  const rows = 5;
  const rh = SIZE / rows;
  for (let row = 0; row < rows; row++) {
    const start = Math.floor(r() * 30);
    let x = start;
    const y0 = row * rh;
    // 石の幅の合計を絵の幅（SIZE）ちょうどにする。残りが少なければ、最後の石で埋める
    while (x < start + SIZE) {
      const rest = start + SIZE - x;
      const w = rest < 74 ? rest : 34 + r() * 40;
      const shade = 0.78 + r() * 0.22;
      const gap = 3;
      for (let yy = Math.floor(y0 + gap); yy < y0 + rh - gap; yy++)
        for (let xx = Math.floor(x + gap); xx < x + w - gap; xx++) {
          const px = ((xx % SIZE) + SIZE) % SIZE;
          const i = yy * SIZE + px;
          // 石の縁は丸く落とす
          const edge = Math.min(xx - x - gap, x + w - gap - xx, yy - y0 - gap, y0 + rh - gap - yy);
          const bevel = Math.min(1, edge / 6);
          h[i] = 0.4 + 0.6 * bevel + (r() - 0.5) * 0.05;
          l[i] = shade * (0.88 + 0.12 * bevel) + (r() - 0.5) * 0.04;
        }
      x += w;
    }
  }
  return make(h, l, 5);
}
// 漆喰：ごく弱いむら
function plaster() {
  const h = new Float32Array(SIZE * SIZE);
  const l = new Float32Array(SIZE * SIZE);
  const r = rng(11);
  // 粗い乱数をぼかして、ゆるやかなむらにする
  const g = 16;
  const grid = Array.from({ length: g * g }, () => r());
  const at = (gx: number, gy: number) => grid[(gy % g) * g + (gx % g)];
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const fx = (x / SIZE) * g;
      const fy = (y / SIZE) * g;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const v =
        at(x0, y0) * (1 - tx) * (1 - ty) +
        at(x0 + 1, y0) * tx * (1 - ty) +
        at(x0, y0 + 1) * (1 - tx) * ty +
        at(x0 + 1, y0 + 1) * tx * ty;
      const i = y * SIZE + x;
      h[i] = v * 0.3 + r() * 0.05;
      l[i] = 0.93 + v * 0.07;
    }
  return make(h, l, 2);
}
// 下見板：横に張った板を、上の板が下の板に重なるように並べる。縦に押縁
function board() {
  const h = new Float32Array(SIZE * SIZE);
  const l = new Float32Array(SIZE * SIZE);
  const r = rng(3);
  const planks = 6;
  const battens = 4;
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const v = ((y / SIZE) * planks) % 1;
      const u = ((x / SIZE) * battens) % 1;
      const batten = u < 0.08;
      const i = y * SIZE + x;
      h[i] = batten ? 1 : v * 0.6;
      l[i] = (batten ? 0.75 : 0.62 + v * 0.18) + Math.sin(x * 0.3 + y * 0.05) * 0.02 + (r() - 0.5) * 0.03;
    }
  return make(h, l, 4);
}
// 木：縦の木目
function wood() {
  const h = new Float32Array(SIZE * SIZE);
  const l = new Float32Array(SIZE * SIZE);
  const r = rng(5);
  const phase = Array.from({ length: 8 }, () => r() * 6);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const k = Math.floor((x / SIZE) * 8);
      const grain = Math.sin(x * 0.9 + Math.sin(y * 0.04 + phase[k]) * 3);
      const i = y * SIZE + x;
      const seam = x % 32 === 0;
      h[i] = grain * 0.15 + (seam ? -0.6 : 0);
      l[i] = 0.8 + grain * 0.08 - (seam ? 0.3 : 0);
    }
  return make(h, l, 3);
}

// 水面：向きと細かさの違うさざ波を重ねる（絵の端でつながるよう、波の数は整数にする）
function water() {
  const h = new Float32Array(SIZE * SIZE);
  const l = new Float32Array(SIZE * SIZE).fill(1);
  const waves = [
    [3, 1, 0.5],
    [-2, 3, 0.35],
    [5, -2, 0.2],
    [1, 6, 0.15],
  ];
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const u = (x / SIZE) * Math.PI * 2;
      const v = (y / SIZE) * Math.PI * 2;
      let s = 0;
      for (const [a, b, amp] of waves) s += Math.sin(a * u + b * v) * amp;
      h[y * SIZE + x] = s * 0.5 + 0.5;
    }
  return make(h, l, 3);
}

const made = new Map<Pattern, { map: CanvasTexture; normal: CanvasTexture }>();
const MAKERS: Record<Pattern, () => { map: CanvasTexture; normal: CanvasTexture }> = {
  tile,
  stone,
  plaster,
  board,
  wood,
  water,
};
export function pattern(p: Pattern) {
  let t = made.get(p);
  if (!t) {
    t = MAKERS[p]();
    made.set(p, t);
  }
  return t;
}
