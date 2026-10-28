// ======================================================================
// 地図の型：城ごとの地形の高さと川。施設とは別の層で、配置データの heights と water に入れる
// どの型も、選ぶたびにランダムに作る。型は起伏の出方（強さ・中央の山の寄り方）と、川の割合を決める
// ======================================================================
import { H, MAX_HEIGHT, RING, W } from './defs';

export const MAPS = [
  { id: 'flat', name: '平城' }, // 平ら、川が多い
  { id: 'hirayama', name: '平山城' }, // 中くらいの丘（0〜2段）
  { id: 'yama', name: '山城' }, // 中央に寄った高い山（0〜4段）、川が少ない
] as const;
export type MapId = (typeof MAPS)[number]['id'];
export const isMapId = (v: unknown): v is MapId => MAPS.some((m) => m.id === v);

// 型ごとの起伏と川（数値は仮）
// top：いちばん高い段、bias：中央に山を寄せる強さ（0〜1）、cliffs：崖を作る数、river：川のマスの割合、
// flow：川の流れ方（cross：盤面を大きく横切って蛇行する、around：となりの辺へ抜けながら丘を回り込む、
// corner：盤面の角の近くで、となり合う2辺のあいだを短く横切る）、
// flatRing：外周の出撃エリアのうち平地（高さ0。攻め手を出せる）にするマスの割合
type Flow = 'cross' | 'around' | 'corner';
interface MapStyle {
  top: number;
  bias: number;
  cliffs: number;
  river: number;
  flow: Flow;
  flatRing: number;
}
export const MAP_STYLE: Record<MapId, MapStyle> = {
  flat: { top: 0, bias: 0, cliffs: 0, river: 0.05, flow: 'cross', flatRing: 1 },
  hirayama: { top: 2, bias: 0.45, cliffs: 3, river: 0.03, flow: 'around', flatRing: 0.7 },
  yama: { top: MAX_HEIGHT, bias: 0.7, cliffs: 6, river: 0.02, flow: 'corner', flatRing: 0.5 },
};

export interface Terrain {
  heights: number[]; // W×H の 0〜MAX_HEIGHT
  water: number[]; // W×H。1なら川（橋のかかったマスも含む）
  bridge: number[]; // W×H。1なら川にかかった橋（攻め手も守将も渡れる）
}

// ---- ランダムな地形 ----------------------------------------------------------
// 決まった並びの乱数（同じ seed なら同じ地形）
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const inBoard = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
const NEXT = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
export const isRingTile = (i: number) => {
  const x = i % W;
  const y = (i / W) | 0;
  return x < RING || y < RING || x >= W - RING || y >= H - RING;
};
// start のマスから、崖（2段以上の差）と blocked のマスを越えずに行けるマス（1なら行ける）
export function reach(
  hs: ArrayLike<number>,
  start: (i: number) => boolean,
  blocked: (i: number) => boolean = () => false,
) {
  const seen = new Uint8Array(W * H);
  const queue: number[] = [];
  for (let i = 0; i < W * H; i++)
    if (start(i) && !blocked(i)) {
      seen[i] = 1;
      queue.push(i);
    }
  for (let q = 0; q < queue.length; q++) {
    const x = queue[q] % W;
    const y = (queue[q] / W) | 0;
    for (const [dx, dy] of NEXT) {
      const nx = x + dx;
      const ny = y + dy;
      const i = ny * W + nx;
      if (!inBoard(nx, ny) || seen[i] || blocked(i) || Math.abs(hs[i] - hs[queue[q]]) >= 2) continue;
      seen[i] = 1;
      queue.push(i);
    }
  }
  return seen;
}
// 外周の出撃エリアから、崖（2段以上の差）を越えずに、すべてのマスへ行けるか（川は考えない）
export function allReachable(hs: ArrayLike<number>) {
  return reach(hs, isRingTile).every((v) => v === 1);
}
// 攻め手を出せるマス：外周の出撃エリアの平地（高さ0）で、川でない
export const canDeployTile = (hs: ArrayLike<number>, water: ArrayLike<number>, i: number) =>
  isRingTile(i) && hs[i] === 0 && !water[i];
// ひとつの出撃できるマスから、崖と川（橋は渡れる）をよけて行けるマス。出撃できるマスがなければ null
function reachFromOneDeploy(hs: ArrayLike<number>, water: ArrayLike<number>, bridge: ArrayLike<number>) {
  const river = (i: number) => !!water[i] && !bridge[i];
  let s0 = -1;
  for (let i = 0; i < W * H && s0 < 0; i++) if (canDeployTile(hs, water, i)) s0 = i;
  return s0 < 0 ? null : reach(hs, (i) => i === s0, river);
}
// 出撃できるマスのどこから出ても、陸のマス（川でない。橋は渡れる）すべてへ行けるか。
// 陸がひとつながりなら、どこから出ても同じなので、ひとつの出撃できるマスから確かめる
export function landConnected(hs: ArrayLike<number>, water: ArrayLike<number>, bridge: ArrayLike<number>) {
  const seen = reachFromOneDeploy(hs, water, bridge);
  if (!seen) return false;
  for (let i = 0; i < W * H; i++) if ((!water[i] || bridge[i]) && !seen[i]) return false;
  return true;
}

// 粗い格子の乱数をなめらかに補間した起伏（0〜1）
function octave(r: () => number, cells: number) {
  const g = Array.from({ length: (cells + 1) * (cells + 1) }, () => r());
  const at = (i: number, j: number) => g[j * (cells + 1) + i];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const fx = (x / W) * cells;
    const fy = (y / H) * cells;
    const i = Math.min(cells - 1, Math.floor(fx));
    const j = Math.min(cells - 1, Math.floor(fy));
    const tx = smooth(fx - i);
    const ty = smooth(fy - j);
    const a = at(i, j) * (1 - tx) + at(i + 1, j) * tx;
    const b = at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx;
    return a * (1 - ty) + b * ty;
  };
}
// 隣との差を1段までにする（高い方を削る）
function soften(hs: number[]) {
  for (let changed = true; changed; ) {
    changed = false;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let m = Infinity;
        for (const [dx, dy] of NEXT) if (inBoard(x + dx, y + dy)) m = Math.min(m, hs[(y + dy) * W + x + dx]);
        if (hs[y * W + x] > m + 1) {
          hs[y * W + x] = m + 1;
          changed = true;
        }
      }
  }
}

// 起伏：ゆるい起伏2つと中央の山を混ぜて段に分け、隣との差を1段までにならす
function relief(r: () => number, st: MapStyle): number[] {
  const big = octave(r, 4);
  const small = octave(r, 9);
  const c = (W - 1) / 2;
  const v: number[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const n = big(x, y) + small(x, y) * 0.35;
      const d = Math.hypot(x - c, y - c) / Math.hypot(c, c); // 中央からの離れ具合 0〜1
      v.push(n * (1 - st.bias) + (1 - d) * 1.35 * st.bias);
    }
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const hs = v.map((n) => Math.min(st.top, Math.floor(((n - lo) / (hi - lo)) * (st.top + 1))));
  soften(hs);
  return hs;
}

// 盤面の辺：0 上・1 右・2 下・3 左。辺 side の、端から p マス目のマス
const edgeTile = (side: number, p: number) =>
  side === 0 ? p : side === 1 ? p * W + W - 1 : side === 2 ? (H - 1) * W + p : p * W;
const onSide = (i: number, side: number) => {
  const x = i % W;
  const y = (i / W) | 0;
  return side === 0 ? y === 0 : side === 1 ? x === W - 1 : side === 2 ? y === H - 1 : x === 0;
};
// 川の道筋：始まりのマス、順にたどる寄り道の点、終わり（このどれかのマスに着いたら終わる）
interface RiverPlan {
  start: number;
  via: number[];
  end: (i: number) => boolean;
}
const between = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
// 流れ方ごとの道筋を決める。n は何本目の川か（cross では縦と横を交互にする）
function planRiver(r: () => number, flow: Flow, n: number): RiverPlan {
  if (flow === 'cross') {
    // 上か左の辺から、流れの向きに沿って並べた寄り道の点（横へは大きくばらつかせる）を通り、出発した辺以外の辺へ
    const vertical = n % 2 === 0;
    const side = vertical ? 0 : 3;
    const k = 2 + Math.floor(r() * 2);
    const via: number[] = [];
    for (let t = 1; t <= k; t++) {
      const along = Math.round(((t - 0.3 + r() * 0.6) / (k + 1)) * (W - 1));
      const across = between(r, 6, W - 7);
      via.push(vertical ? along * W + across : across * W + along);
    }
    return { start: edgeTile(side, between(r, 4, W - 5)), via, end: (i) => onEdge(i) && !onSide(i, side) };
  }
  // around と corner：辺 a から、となりの辺 b へ抜ける。2辺が出会う角を c とする
  const a = Math.floor(r() * 4);
  const b = (a + (r() < 0.5 ? 1 : 3)) % 4;
  // 辺 side の上で、角 c から d マス離れた位置（辺の端からの位置に直す）
  const cornerX = a === 1 || b === 1 ? W - 1 : 0;
  const cornerY = a === 2 || b === 2 ? H - 1 : 0;
  const fromCorner = (side: number, d: number) => {
    const horizontal = side === 0 || side === 2; // 辺に沿って x が変わる
    const c = horizontal ? cornerX : cornerY;
    return c === 0 ? d : (horizontal ? W : H) - 1 - d;
  };
  if (flow === 'corner') {
    // 角から 6〜12 マスの所どうしを結ぶ。寄り道はしない（短い川）
    const db = between(r, 6, 12);
    const endTile = edgeTile(b, fromCorner(b, db));
    return { start: edgeTile(a, fromCorner(a, between(r, 6, 12))), via: [], end: (i) => i === endTile };
  }
  // around：辺の中ほどから入り、角と盤面の中央のあいだの点（丘のまわり）を通って、となりの辺の中ほどへ抜ける
  const t = 0.3 + r() * 0.2; // 角から中央へどれだけ寄せるか
  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;
  const vx = Math.round(cornerX + (cx - cornerX) * t + (r() - 0.5) * 4);
  const vy = Math.round(cornerY + (cy - cornerY) * t + (r() - 0.5) * 4);
  const lo = 10;
  const hi = W - 11;
  const endAt = (i: number) => {
    if (!onSide(i, b)) return false;
    const p = b === 0 || b === 2 ? i % W : (i / W) | 0;
    return p >= lo && p <= hi;
  };
  return { start: edgeTile(a, between(r, lo, hi)), via: [vy * W + vx], end: endAt };
}
const onEdge = (i: number) => {
  const x = i % W;
  const y = (i / W) | 0;
  return x === 0 || y === 0 || x === W - 1 || y === H - 1;
};

// 川を1本、道筋 plan のとおりに引く。それぞれの区間は、低くて通りやすい所を選ぶ（幅は1マス）。
// 通りやすさのむらは大きくなめらかにして、川が蛇行するようにする
function carveRiver(r: () => number, hs: number[], water: number[], plan: RiverPlan) {
  const swirl = octave(r, 5);
  const grain = Array.from({ length: W * H }, () => r());
  const own = new Uint8Array(W * H); // この川がもう通ったマス（同じ川がぐるりと戻らないように）
  // 盤面のふちの近く（外周の出撃エリアと堀の帯）は通りにくくし、ふち沿いには流さない
  const nearEdge = (i: number) => {
    const x = i % W;
    const y = (i / W) | 0;
    return Math.min(x, y, W - 1 - x, H - 1 - y) < 4 ? 12 : 0;
  };
  // 前の川のマスは少し安く通る（合流することがある）
  const cost = (i: number) =>
    own[i] ? 40 : water[i] ? 2 : 1 + hs[i] * 4 + swirl(i % W, (i / W) | 0) * 8 + grain[i] + nearEdge(i);
  // a から、goal を満たすマスまでの道（a を含む）
  const route = (a: number, goal: (i: number) => boolean) => {
    const dist = new Float64Array(W * H).fill(Infinity);
    const from = new Int32Array(W * H).fill(-1);
    const done = new Uint8Array(W * H);
    dist[a] = 0;
    // 小さな盤面なので、いちばん近いマスを順に選ぶ素直なやり方で足りる
    for (;;) {
      let best = -1;
      for (let i = 0; i < W * H; i++)
        if (!done[i] && dist[i] < Infinity && (best < 0 || dist[i] < dist[best])) best = i;
      if (best < 0) return [a];
      done[best] = 1;
      if (best !== a && goal(best)) {
        const path: number[] = [];
        for (let i = best; i >= 0; i = from[i]) path.unshift(i);
        return path;
      }
      const x = best % W;
      const y = (best / W) | 0;
      for (const [dx, dy] of NEXT) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBoard(nx, ny)) continue;
        const j = ny * W + nx;
        // 川は2段以上の差（崖）は流れない
        if (done[j] || Math.abs(hs[j] - hs[best]) >= 2) continue;
        const d = dist[best] + cost(j);
        if (d < dist[j]) {
          dist[j] = d;
          from[j] = best;
        }
      }
    }
  };
  let at = plan.start;
  own[at] = 1;
  for (const goal of plan.via) {
    for (const i of route(at, (i) => i === goal)) own[i] = 1;
    at = goal;
  }
  for (const i of route(at, plan.end)) own[i] = 1;
  for (let i = 0; i < W * H; i++) if (own[i]) water[i] = 1;
}
// 川のマスと、その隣の川のマスとの差を1段までにならす（川が段を登らないように、高い方を削る）
function levelRiver(hs: number[], water: number[]) {
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < W * H; i++) {
      if (!water[i]) continue;
      const x = i % W;
      const y = (i / W) | 0;
      for (const [dx, dy] of NEXT) {
        if (!inBoard(x + dx, y + dy)) continue;
        const j = (y + dy) * W + x + dx;
        if (water[j] && hs[i] > hs[j]) {
          hs[i] = hs[j];
          changed = true;
        }
      }
    }
  }
  soften(hs);
}

// 川の両岸の1マスを、川と同じ高さまで下げる
function widenValley(hs: number[], water: number[]) {
  const low = hs.slice();
  for (let i = 0; i < W * H; i++) {
    if (!water[i]) continue;
    const x = i % W;
    const y = (i / W) | 0;
    for (const [dx, dy] of NEXT) {
      if (!inBoard(x + dx, y + dy)) continue;
      const j = (y + dy) * W + x + dx;
      if (!water[j]) low[j] = Math.min(low[j], hs[i]);
    }
  }
  hs.splice(0, hs.length, ...low);
  soften(hs);
}

// 外周の出撃エリアを、割合 p だけ平地（高さ0）にし、残りは1段以上にする。平地は2〜4か所のまとまった区間にする
function flattenRing(r: () => number, hs: number[], p: number) {
  // 外周のマスを、左上の角から時計回りに並べる
  const ring: number[] = [];
  for (let x = 0; x < W - 1; x++) ring.push(x);
  for (let y = 0; y < H - 1; y++) ring.push(y * W + W - 1);
  for (let x = W - 1; x > 0; x--) ring.push((H - 1) * W + x);
  for (let y = H - 1; y > 0; y--) ring.push(y * W);
  const L = ring.length;
  const flat = new Uint8Array(L);
  const want = Math.round(p * L);
  if (want >= L) flat.fill(1);
  else {
    // 区間の数と、平地の区間・あいだの区間それぞれの長さ（平地の合計が want、あいだの合計が L - want）を割り振り、
    // 外周のランダムな位置から、平地・あいだ・平地…と順に並べる（区間どうしが重ならない）
    const n = 2 + Math.floor(r() * 3);
    const split = (total: number) => {
      const w = Array.from({ length: n }, () => 0.5 + r());
      const sum = w.reduce((a, b) => a + b, 0);
      const parts = w.map((v) => Math.floor((v / sum) * total));
      parts[0] += total - parts.reduce((a, b) => a + b, 0);
      return parts;
    };
    const flats = split(want);
    const gaps = split(L - want);
    let at = Math.floor(r() * L);
    for (let k = 0; k < n; k++) {
      for (let t = 0; t < flats[k]; t++) flat[(at + t) % L] = 1;
      at += flats[k] + gaps[k];
    }
  }
  ring.forEach((i, k) => {
    hs[i] = flat[k] ? 0 : Math.max(1, hs[i]);
  });
}
// 橋をかけられる所：川のマスで、向かい合う2辺が陸、残りの2辺が川になっている所（まっすぐ渡れる所）。
// 両岸を返す（左右か上下）。盤面のふちから margin マス以内は除く
function spans(water: number[], margin: number) {
  const out: { i: number; a: number; b: number }[] = [];
  for (let y = margin; y < H - margin; y++)
    for (let x = margin; x < W - margin; x++) {
      const i = y * W + x;
      if (!water[i] || x < 1 || y < 1 || x > W - 2 || y > H - 2) continue;
      if (!water[i - 1] && !water[i + 1] && water[i - W] && water[i + W]) out.push({ i, a: i - 1, b: i + 1 });
      if (!water[i - W] && !water[i + W] && water[i - 1] && water[i + 1]) out.push({ i, a: i - W, b: i + W });
    }
  return out;
}
// 橋をかける。橋は1マスで、両岸が川と同じ高さの所にだけかける（橋の床は岸と同じ高さ）。
// 初めに、川のかたまりごとに1〜3か所をランダムに選ぶ。そのあと、出撃できる所から行けない陸が残っていれば、
// 行ける陸と行けない陸を向かい合わせる川のマスに橋をかける。同じ高さの所がなければ、その所の両岸を川の高さまで下げる
function placeBridges(r: () => number, hs: number[], water: number[]) {
  const bridge = new Array<number>(W * H).fill(0);
  const level = (sp: { i: number; a: number; b: number }) => hs[sp.a] === hs[sp.i] && hs[sp.b] === hs[sp.i];
  // 川のかたまり（つながった川のマス）ごとに分ける
  const group = new Int32Array(W * H).fill(-1);
  let groups = 0;
  for (let s = 0; s < W * H; s++) {
    if (!water[s] || group[s] >= 0) continue;
    const q = [s];
    group[s] = groups;
    for (let k = 0; k < q.length; k++) {
      const x = q[k] % W;
      const y = (q[k] / W) | 0;
      for (const [dx, dy] of NEXT) {
        const j = (y + dy) * W + x + dx;
        if (!inBoard(x + dx, y + dy) || !water[j] || group[j] >= 0) continue;
        group[j] = groups;
        q.push(j);
      }
    }
    groups++;
  }
  const first = spans(water, 4).filter(level);
  for (let g = 0; g < groups; g++) {
    const mine = first.filter((sp) => group[sp.i] === g);
    for (let k = 1 + Math.floor(r() * 3); k > 0 && mine.length; k--) {
      const [sp] = mine.splice(Math.floor(r() * mine.length), 1);
      // となりのマスに橋が並ばないようにする
      const x = sp.i % W;
      const y = (sp.i / W) | 0;
      if (NEXT.some(([dx, dy]) => inBoard(x + dx, y + dy) && bridge[(y + dy) * W + x + dx])) continue;
      bridge[sp.i] = 1;
    }
  }
  for (let guard = 0; guard < 60 && !landConnected(hs, water, bridge); guard++) {
    const seen = reachFromOneDeploy(hs, water, bridge);
    if (!seen) break;
    // 行ける陸と行けない陸を向かい合わせる所。同じ高さの所を先に選ぶ
    const cut = spans(water, 1).filter((sp) => !bridge[sp.i] && !!seen[sp.a] !== !!seen[sp.b]);
    if (!cut.length) break;
    const even = cut.filter(level);
    const pick = (even.length ? even : cut)[Math.floor(r() * (even.length || cut.length))];
    if (!level(pick)) {
      // 両岸を川の高さまで下げ、まわりとの差を1段までにならす
      hs[pick.a] = hs[pick.b] = hs[pick.i];
      soften(hs);
      levelRiver(hs, water);
    }
    bridge[pick.i] = 1;
  }
  return bridge;
}

// 地図の型 id の地形をランダムに作る。seed が同じなら同じ地形
export function makeTerrain(id: MapId, seed: number): Terrain {
  const st = MAP_STYLE[id];
  const r = rng(seed);
  const hs = relief(r, st);
  // 外周の出撃エリアの平地を決め、隣との差を1段までにならす
  flattenRing(r, hs, st.flatRing);
  soften(hs);
  // 川：割合に届くまで、型の流れ方で引く。川の幅は1マス。
  const water = new Array<number>(W * H).fill(0);
  const target = st.river * W * H;
  const count = () => water.reduce((a, b) => a + b, 0);
  // 川は必ず1本は引く（割合が小さくても）。cross は1本目の向き（縦か横）をランダムにする。
  // 引きすぎないよう、残りが前に引いた川の半分より少なくなったら止める
  const first = r() < 0.5 ? 0 : 1;
  let last = 0;
  for (let k = 0; k < 20 && (k === 0 || count() < target - last / 2); k++) {
    const before = count();
    carveRiver(r, hs, water, planRiver(r, st.flow, first + k));
    last = count() - before;
  }
  // 川の通る所を下流の高さまでならし、両岸の1マスも川と同じ高さまで下げて、谷を広げる（川が見えるように）
  levelRiver(hs, water);
  widenValley(hs, water);
  // 崖：川と外周の出撃エリアを除いた四角い範囲を一段持ち上げる。外周からすべてのマスへ道が残るときだけ採用する
  for (let k = 0; k < st.cliffs; k++) {
    const w = 3 + Math.floor(r() * 6);
    const h = 3 + Math.floor(r() * 6);
    const x0 = Math.floor(r() * (W - w));
    const y0 = Math.floor(r() * (H - h));
    const keep = hs.slice();
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) {
        const i = y * W + x;
        if (!water[i] && !isRingTile(i)) hs[i] = Math.min(st.top, hs[i] + 1);
      }
    if (!allReachable(hs)) hs.splice(0, hs.length, ...keep);
  }
  // 橋：どの出撃口からも、すべての陸へ行けるようにかける
  const bridge = placeBridges(r, hs, water);
  return { heights: hs, water, bridge };
}
