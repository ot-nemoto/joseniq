import {
  BDEF,
  type BuildingType,
  GDEF,
  type GeneralKind,
  H,
  HALL,
  HALL_MARGIN,
  isBuildingType,
  isFacilityType,
  isGeneralKind,
  LIMITS,
  MAX_GENERALS,
  MAX_HEIGHT,
  type PlaceTool,
  type Tool,
  W,
  ZW,
} from './defs';
import { inB, inZone, ringOrder } from './geometry';
import { canDeployTile, isMapId } from './terrain';

// ---- 配置データ ---------------------------------------------------------
export interface PlacedBuilding {
  type: BuildingType;
  x: number;
  y: number;
}
export interface PlacedGeneral {
  kind: GeneralKind;
  x: number;
  y: number;
}
export interface Layout {
  buildings: PlacedBuilding[];
  generals: PlacedGeneral[];
  // 地形の高さ（W×H、0〜MAX_HEIGHT）。施設とは別の層で、施設や武将はこの上に置く。ないときは平ら（平城）
  heights?: number[];
  // 川（W×H、1なら川。橋のかかったマスも含む）。攻め手も守将も渡れず（橋のかかったマスだけ渡れる）、施設や武将は置けない
  water?: number[];
  // 川にかかった橋（W×H、1なら橋）。橋のマスは攻め手も守将も渡れる。施設や武将は置けない
  bridge?: number[];
  map?: string; // 地図の型の名前（画面で選んでいる型を出すため）
}
// マスが川か
export const isWater = (l: Layout, x: number, y: number) => l.water?.[y * W + x] === 1;
// マスが、渡れない川か（橋がかかっていない）
export const isRiver = (l: Layout, x: number, y: number) => isWater(l, x, y) && l.bridge?.[y * W + x] !== 1;
// 攻め手を出せるマスか（外周の出撃エリアの平地で、川でない）
export const canDeployAt = (l: Layout, x: number, y: number) =>
  inB(x, y) && canDeployTile(l.heights, l.water, y * W + x);
// (x, y) にいちばん近い、ok を満たす外周のマス（外周を両回りにたどって探す）。なければ null。
// ok を渡さなければ、攻め手を出せるマスを探す
export function nearestDeploy(
  l: Layout,
  x: number,
  y: number,
  ok: (x: number, y: number) => boolean = (px, py) => canDeployAt(l, px, py),
): { x: number; y: number } | null {
  const ring = ringOrder();
  let k0 = 0;
  let best = Infinity;
  ring.forEach(([rx, ry], k) => {
    const d = Math.hypot(rx - x, ry - y);
    if (d < best) {
      best = d;
      k0 = k;
    }
  });
  for (let d = 0; d <= ring.length / 2; d++)
    for (const k of [k0 + d, k0 - d]) {
      const [rx, ry] = ring[((k % ring.length) + ring.length) % ring.length];
      if (ok(rx, ry)) return { x: rx, y: ry };
    }
  return null;
}
// マスの高さ。地形がなければ 0
export const heightAt = (l: Layout, x: number, y: number) => l.heights?.[y * W + x] ?? 0;
// 隣り合う2マスのあいだが崖か（高さの差が2段以上）
export const isCliff = (a: number, b: number) => Math.abs(a - b) >= 2;
export interface Footprint {
  x0: number;
  y0: number;
  w: number;
  h: number;
}
export type PlaceResult = { ok: true } | { ok: false; msg: string };

export function fpOf(b: PlacedBuilding): Footprint {
  return b.type === 'hall' ? { x0: b.x, y0: b.y, w: HALL.w, h: HALL.h } : { x0: b.x, y0: b.y, w: 1, h: 1 };
}

export const cloneLayout = (l: Layout): Layout => structuredClone(l);
// 本丸の左上のマス。本丸を置いていなければ、盤面の真ん中（HALL）
export const hallPos = (l: Layout): { x: number; y: number } => l.buildings.find((b) => b.type === 'hall') ?? HALL;
// 本丸だけを真ん中に置いた配置（テストなどのもと）
export const emptyLayout = (): Layout => ({ buildings: [{ type: 'hall', x: HALL.x, y: HALL.y }], generals: [] });
// 何も置いていない配置（全消去や、地形を作り直したとき）
export const bareLayout = (): Layout => ({ buildings: [], generals: [] });

export function countOf(l: Layout, tool: PlaceTool): number {
  return isGeneralKind(tool)
    ? l.generals.filter((g) => g.kind === tool).length
    : l.buildings.filter((b) => b.type === tool).length;
}

// マス (x,y) にあるもの：施設（b）か武将（g）と、その番号
export function occAt(l: Layout, x: number, y: number): { k: 'b' | 'g'; i: number } | null {
  for (let i = 0; i < l.buildings.length; i++) {
    const f = fpOf(l.buildings[i]);
    if (x >= f.x0 && x < f.x0 + f.w && y >= f.y0 && y < f.y0 + f.h) return { k: 'b', i };
  }
  for (let i = 0; i < l.generals.length; i++) {
    if (l.generals[i].x === x && l.generals[i].y === y) return { k: 'g', i };
  }
  return null;
}

export function place(l: Layout, tool: Tool, x: number, y: number): PlaceResult {
  // 本丸は2×2なので、つかんだ所によっては左上が盤面の外になる。盤面の外かを見る前に、本丸の置き場所の決まりで理由を返す
  if (tool === 'hall') {
    if (countOf(l, 'hall') >= LIMITS.hall) return { ok: false, msg: '本丸は1つだけです（つかんで動かせます）' };
    return placeHall(l, x, y);
  }
  if (!inB(x, y)) return { ok: false, msg: '' };
  if (tool === 'erase') {
    const o = occAt(l, x, y);
    if (!o) return { ok: false, msg: '' };
    // 武将はパネルのスイッチで外す（壁などを消しながら、うっかり武将まで消さないように）
    if (o.k === 'g') return { ok: false, msg: '' };
    l.buildings.splice(o.i, 1);
    return { ok: true };
  }
  if (!inZone(x, y)) return { ok: false, msg: `配置できるのは城域（${ZW}×${ZW}）の中だけです` };
  if (occAt(l, x, y)) return { ok: false, msg: '他の配置と重なります' };
  if (isWater(l, x, y)) return { ok: false, msg: '川の上には置けません' };
  const nm = isGeneralKind(tool) ? GDEF[tool].busho : BDEF[tool].name;
  if (countOf(l, tool) >= LIMITS[tool]) return { ok: false, msg: `${nm}は最大${LIMITS[tool]}までです` };
  if (isGeneralKind(tool) && l.generals.length >= MAX_GENERALS)
    return { ok: false, msg: `武将は${MAX_GENERALS}人までです` };
  if (isGeneralKind(tool)) l.generals.push({ kind: tool, x, y });
  else l.buildings.push({ type: tool, x, y });
  return { ok: true };
}
export const check = (l: Layout, tool: Tool, x: number, y: number) => place(cloneLayout(l), tool, x, y);

// 武将を外す
export function removeGeneral(l: Layout, kind: GeneralKind) {
  l.generals = l.generals.filter((g) => g.kind !== kind);
}
// list の i番目を、いったん外して place と同じ決まりで置き直す（決まりを1か所にまとめる）。
// place は list の最後に足すので、それを取り出して i番目に戻し、並び順を変えない。置けなければ元のまま
function reput<T>(list: T[], i: number, put: () => PlaceResult, moved: T): PlaceResult {
  const [old] = list.splice(i, 1);
  const r = put();
  if (r.ok) list.pop();
  list.splice(i, 0, r.ok ? moved : old);
  return r;
}
// 武将をドラッグで置く：まだ盤面にいなければ置き、いれば動かす。置けなければ何もしない。
// 武将の並び順は戦闘での順番になるので、元の位置に戻す
export function putGeneral(l: Layout, kind: GeneralKind, x: number, y: number): PlaceResult {
  const i = l.generals.findIndex((q) => q.kind === kind);
  if (i < 0) return place(l, kind, x, y);
  return reput(l.generals, i, () => place(l, kind, x, y), { kind, x, y });
}
export const checkPut = (l: Layout, kind: GeneralKind, x: number, y: number) => putGeneral(cloneLayout(l), kind, x, y);
// 本丸を (x, y)（左上）に置けるか。4マスすべてが置ける範囲（盤面の端から HALL_MARGIN 以上内側）にあり、ほかと重ならない
export const hallFits = (x: number, y: number) =>
  x >= HALL_MARGIN &&
  y >= HALL_MARGIN &&
  x + HALL.w - 1 <= W - 1 - HALL_MARGIN &&
  y + HALL.h - 1 <= H - 1 - HALL_MARGIN;
// 本丸の4マスが、すべて同じ高さか（段をまたいで置かない）
export function hallLevel(l: Layout, x: number, y: number) {
  const h = heightAt(l, x, y);
  for (let yy = y; yy < y + HALL.h; yy++)
    for (let xx = x; xx < x + HALL.w; xx++) if (heightAt(l, xx, yy) !== h) return false;
  return true;
}
function placeHall(l: Layout, x: number, y: number): PlaceResult {
  if (!hallFits(x, y)) return { ok: false, msg: `本丸は、盤面の端から${HALL_MARGIN}マス以上内側に置きます` };
  if (!hallLevel(l, x, y)) return { ok: false, msg: '本丸は、段をまたがない平らな所に置きます' };
  for (let yy = y; yy < y + HALL.h; yy++)
    for (let xx = x; xx < x + HALL.w; xx++) {
      if (occAt(l, xx, yy)) return { ok: false, msg: '他の配置と重なります' };
      if (isWater(l, xx, yy)) return { ok: false, msg: '川の上には置けません' };
    }
  l.buildings.push({ type: 'hall', x, y });
  return { ok: true };
}
// 置いた施設（i番目）をドラッグで動かす。決まりは putGeneral と同じ。本丸（2×2）は (x, y) を左上として置く
export function moveBuilding(l: Layout, i: number, x: number, y: number): PlaceResult {
  const b = l.buildings[i];
  if (!b) return { ok: false, msg: '' };
  const type = b.type;
  return reput(l.buildings, i, () => place(l, type, x, y), { type, x, y });
}
export const checkMove = (l: Layout, i: number, x: number, y: number) => moveBuilding(cloneLayout(l), i, x, y);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isInt = (v: unknown): v is number => Number.isInteger(v);

export function validate(o: unknown): Layout | null {
  if (!isRecord(o) || !Array.isArray(o.buildings) || !Array.isArray(o.generals)) return null;
  const l: Layout = { buildings: [], generals: [] };
  const occ = new Set<number>();
  let halls = 0;
  for (const b of o.buildings as unknown[]) {
    // 堀と拒馬は今は外している。外す前に書き出したデータも読めるよう、堀と拒馬は黙って飛ばす
    if (isRecord(b) && (b.type === 'moat' || b.type === 'bar')) continue;
    if (!isRecord(b) || typeof b.type !== 'string' || !isBuildingType(b.type) || !isInt(b.x) || !isInt(b.y))
      return null;
    const pb: PlacedBuilding = { type: b.type, x: b.x, y: b.y };
    const f = fpOf(pb);
    for (let yy = f.y0; yy < f.y0 + f.h; yy++)
      for (let xx = f.x0; xx < f.x0 + f.w; xx++) {
        const k = yy * W + xx;
        if (!inZone(xx, yy) || occ.has(k)) return null;
        occ.add(k);
      }
    if (pb.type === 'hall') {
      if (!hallFits(pb.x, pb.y)) return null;
      halls++;
    }
    l.buildings.push(pb);
  }
  if (halls > 1) return null;
  for (const g of o.generals as unknown[]) {
    if (!isRecord(g) || typeof g.kind !== 'string' || !isGeneralKind(g.kind) || !isInt(g.x) || !isInt(g.y)) return null;
    const k = g.y * W + g.x;
    if (!inZone(g.x, g.y) || occ.has(k)) return null;
    occ.add(k);
    l.generals.push({ kind: g.kind, x: g.x, y: g.y });
  }
  for (const t of Object.keys(LIMITS) as PlaceTool[]) if (countOf(l, t) > LIMITS[t]) return null;
  if (l.generals.length > MAX_GENERALS) return null;
  // 地形：なければ平ら。あれば W×H の 0〜MAX_HEIGHT の整数
  if (o.heights !== undefined) {
    const hs = o.heights;
    if (!Array.isArray(hs) || hs.length !== W * H || !hs.every((v) => isInt(v) && v >= 0 && v <= MAX_HEIGHT))
      return null;
    l.heights = hs as number[];
  }
  // 川：あれば W×H の 0 か 1。川の上に施設や武将があれば読まない
  if (o.water !== undefined) {
    const ws = o.water;
    if (!Array.isArray(ws) || ws.length !== W * H || !ws.every((v) => v === 0 || v === 1)) return null;
    l.water = ws as number[];
    for (const k of occ) if (l.water[k]) return null;
  }
  // 橋：あれば W×H の 0 か 1。橋は川のマスにだけかかる
  if (o.bridge !== undefined) {
    const bs = o.bridge;
    if (!Array.isArray(bs) || bs.length !== W * H || !bs.every((v, i) => v === 0 || (v === 1 && l.water?.[i] === 1)))
      return null;
    l.bridge = bs as number[];
  }
  // 本丸は段をまたいで置かない
  for (const b of l.buildings) if (b.type === 'hall' && !hallLevel(l, b.x, b.y)) return null;
  // 地図の型の名前は、決まった型だけを読む。高さのない平山城などは、平城として扱う（ボタンの表示と盤面を合わせる）
  if (isMapId(o.map) && (o.map === 'flat' || l.heights)) l.map = o.map;
  return l;
}

// ---- 攻城を始められるか -------------------------------------------------------
// 縦横の隣
const NEXT4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
// 門はちょうどこの数を置く
export const GATES_REQUIRED = LIMITS.gate;
// 攻め手が通れる地面か（施設のないマスと、壊せば通れる門・大筒）。城壁と櫓・鼓楼は通れない
const passable = (t: BuildingType) => !!BDEF[t].breakThrough;
// 通れない施設のあるマス（through の施設は通れるものとして数えない）と、本丸の敷地
function blockMap(l: Layout, through: (t: BuildingType) => boolean) {
  const blocked = new Uint8Array(W * H);
  let hall: Footprint | null = null;
  for (const b of l.buildings) {
    const f = fpOf(b);
    if (b.type === 'hall') hall = f;
    if (through(b.type)) continue;
    for (let y = f.y0; y < f.y0 + f.h; y++) for (let x = f.x0; x < f.x0 + f.w; x++) blocked[y * W + x] = 1;
  }
  return { blocked, hall: hall as Footprint | null };
}
// 縦横に隣どうしの (x,y) から (nx,ny) へ、歩いて移れるか（盤面の中で、通れない施設・川・崖がない）
const canStep = (l: Layout, blocked: Uint8Array, x: number, y: number, nx: number, ny: number) =>
  inB(nx, ny) && !blocked[ny * W + nx] && !isRiver(l, nx, ny) && !isCliff(heightAt(l, x, y), heightAt(l, nx, ny));
// seeds のマスから、縦横に歩いて行けるマスを塗る（斜めには進まない形で確かめる。甘く見積もらないため）
function spread(l: Layout, blocked: Uint8Array, seeds: number[]): Uint8Array {
  const seen = new Uint8Array(W * H);
  for (const k of seeds) seen[k] = 1;
  const queue = [...seeds];
  for (let q = 0; q < queue.length; q++) {
    const x = queue[q] % W;
    const y = (queue[q] / W) | 0;
    for (const [dx, dy] of NEXT4) {
      const k = (y + dy) * W + x + dx;
      if (seen[k] || !canStep(l, blocked, x, y, x + dx, y + dy)) continue;
      seen[k] = 1;
      queue.push(k);
    }
  }
  return seen;
}
// 本丸の敷地の縦横の隣のマス（本丸の敷地のマスとの組で返す）
function aroundHall(h: Footprint): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (let y = h.y0; y < h.y0 + h.h; y++)
    for (let x = h.x0; x < h.x0 + h.w; x++)
      for (const [dx, dy] of NEXT4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= h.x0 && nx < h.x0 + h.w && ny >= h.y0 && ny < h.y0 + h.h) continue;
        out.push([x, y, nx, ny]);
      }
  return out;
}
// 外周から本丸まで、通れる地面だけを通って行けるか（崖は通れない）
export function hallReachable(l: Layout): boolean {
  const { blocked, hall } = blockMap(l, passable);
  if (!hall) return false;
  const seeds: number[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (canDeployAt(l, x, y) && !blocked[y * W + x]) seeds.push(y * W + x);
  const seen = spread(l, blocked, seeds);
  return aroundHall(hall).some(([, , nx, ny]) => inB(nx, ny) && seen[ny * W + nx] === 1);
}
// 守り手が入れない施設：本丸から守り手が歩いて行けるマスに、縦か横で接していない施設（撃つ櫓・大筒と、まわりに効く鼓楼・鐘楼）。
// 守り手が歩いて行けるのは、施設のないマスと、門のマス（川と崖はよけ、縦横に進む）。施設と隣のマスの間が崖なら、接していないとみなす。
// 現実の櫓は、郭の内側から兵が出入りする。まわりを城壁などで閉じた、だれも入れない櫓は置けない
export function unmannedFacilities(l: Layout): PlacedBuilding[] {
  const { blocked, hall } = blockMap(l, (t) => t === 'gate');
  if (!hall) return [];
  const seeds = aroundHall(hall)
    .filter(([x, y, nx, ny]) => canStep(l, blocked, x, y, nx, ny))
    .map(([, , nx, ny]) => ny * W + nx);
  const seen = spread(l, blocked, [...new Set(seeds)]);
  return l.buildings.filter((b) => {
    if (!isFacilityType(b.type)) return false;
    const f = fpOf(b);
    for (let y = f.y0; y < f.y0 + f.h; y++)
      for (let x = f.x0; x < f.x0 + f.w; x++)
        for (const [dx, dy] of NEXT4) {
          const nx = x + dx;
          const ny = y + dy;
          if (inB(nx, ny) && seen[ny * W + nx] && !isCliff(heightAt(l, x, y), heightAt(l, nx, ny))) return false;
        }
    return true;
  });
}

// 前後がふさがった門：縦か横のどちらの向きでも、前後の2マスの両方が空いていない門。
// 空いているマスは、施設がなく、川でもなく、門との間が崖でもない、盤面の中のマス（武将は動くので数えない）。
// 門は人や荷が通る口なので、前後を空ける
export function blockedGates(l: Layout): PlacedBuilding[] {
  const { blocked: occ } = blockMap(l, () => false);
  return l.buildings.filter((b) => {
    if (b.type !== 'gate') return false;
    const open = (x: number, y: number) => canStep(l, occ, b.x, b.y, x, y);
    return !(open(b.x, b.y - 1) && open(b.x, b.y + 1)) && !(open(b.x - 1, b.y) && open(b.x + 1, b.y));
  });
}

// ---- 塀と土地 ----------------------------------------------------------------
// 塀の中の広い土地を、この数以上確保する
export const LAND_REQUIRED = 200;
// 広い土地：塀の中の空きマスのうち、この大きさの四角の空き地（同じ高さ）の一部になっているマス。幅の狭い通路は数えない
export const LAND_BLOCK = 3;
// 斜めを含む8つの隣
const NEXT8 = [...NEXT4, [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
// 塀と土地の形。区画は、施設（門も）・川・崖で区切った、ひと続きの空きマス（縦横に進む）
export interface CastleShape {
  outside: Uint8Array; // 城の外：外周に触れる区画のマス
  land: Uint8Array; // 広い土地のマス
  landCount: number;
  strays: PlacedBuilding[]; // 本丸を囲まない塀（城壁・門）
  hallOutside: boolean; // 本丸が城の外に面している（塀の中にない）
}
// 本丸を囲む区画：その区画に面した施設（縦横斜め）と川・崖だけを残してほかの施設を取り除いたとき、本丸から外周へ出られない区画。
// 塀（城壁・門）は、どれも本丸を囲む区画に面していなければならない（二重・三重に囲む塀は、内と外の区画の両方に面する）
export function castleShape(l: Layout): CastleShape {
  const { blocked, hall } = blockMap(l, () => false);
  const region = new Int32Array(W * H).fill(-1);
  const tiles: number[][] = [];
  const edge: boolean[] = [];
  for (let i = 0; i < W * H; i++) {
    if (region[i] >= 0 || blocked[i] || isRiver(l, i % W, (i / W) | 0)) continue;
    const r = tiles.length;
    region[i] = r;
    const seen = spread(l, blocked, [i]);
    const list: number[] = [];
    let e = false;
    for (let k = 0; k < W * H; k++) {
      if (!seen[k]) continue;
      region[k] = r;
      list.push(k);
      const x = k % W;
      const y = (k / W) | 0;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) e = true;
    }
    tiles.push(list);
    edge.push(e);
  }
  const outside = new Uint8Array(W * H);
  for (let r = 0; r < tiles.length; r++) if (edge[r]) for (const k of tiles[r]) outside[k] = 1;
  const hallTiles: number[] = [];
  if (hall)
    for (let y = hall.y0; y < hall.y0 + hall.h; y++)
      for (let x = hall.x0; x < hall.x0 + hall.w; x++) hallTiles.push(y * W + x);
  const hallOutside = !!hall && aroundHall(hall).some(([, , nx, ny]) => inB(nx, ny) && outside[ny * W + nx] === 1);
  const surrounds = tiles.map((list, r) => {
    if (edge[r] || !hall) return false;
    const wall = new Uint8Array(W * H);
    for (const k of list) {
      const x = k % W;
      const y = (k / W) | 0;
      for (const [dx, dy] of NEXT8)
        if (inB(x + dx, y + dy) && blocked[(y + dy) * W + x + dx]) wall[(y + dy) * W + x + dx] = 1;
    }
    for (const k of hallTiles) wall[k] = 0;
    const seen = spread(l, wall, hallTiles);
    for (let k = 0; k < W * H; k++) {
      const x = k % W;
      const y = (k / W) | 0;
      if (seen[k] && (x === 0 || y === 0 || x === W - 1 || y === H - 1)) return false;
    }
    return true;
  });
  const strays = l.buildings.filter(
    (b) =>
      (b.type === 'wall' || b.type === 'gate') &&
      !NEXT8.some(([dx, dy]) => {
        const x = b.x + dx;
        const y = b.y + dy;
        return inB(x, y) && region[y * W + x] >= 0 && surrounds[region[y * W + x]];
      }),
  );
  const inside = (x: number, y: number) => inB(x, y) && region[y * W + x] >= 0 && !outside[y * W + x];
  const land = new Uint8Array(W * H);
  for (let y = 0; y + LAND_BLOCK <= H; y++)
    for (let x = 0; x + LAND_BLOCK <= W; x++) {
      const h = heightAt(l, x, y);
      let ok = true;
      for (let dy = 0; dy < LAND_BLOCK && ok; dy++)
        for (let dx = 0; dx < LAND_BLOCK && ok; dx++)
          if (!inside(x + dx, y + dy) || heightAt(l, x + dx, y + dy) !== h) ok = false;
      if (ok)
        for (let dy = 0; dy < LAND_BLOCK; dy++) for (let dx = 0; dx < LAND_BLOCK; dx++) land[(y + dy) * W + x + dx] = 1;
    }
  let landCount = 0;
  for (const v of land) landCount += v;
  return { outside, land, landCount, strays, hallOutside };
}

// 攻城を始められない理由。始められるなら null
export function notReady(l: Layout): string | null {
  if (countOf(l, 'hall') !== 1) return '本丸を置いてください';
  const gates = countOf(l, 'gate');
  if (gates !== GATES_REQUIRED) return `門を${GATES_REQUIRED}つ置いてください（今は ${gates} / ${GATES_REQUIRED}）`;
  if (!hallReachable(l)) return '外周から本丸へ通じる道がありません（囲いに門を置くか、崖をよけてください）';
  const bg = blockedGates(l);
  if (bg.length)
    return `前後がふさがった門があります（${bg.length}つ）。門は、縦か横の向きで、前後のマスを空けてください`;
  const un = unmannedFacilities(l);
  if (un.length)
    return `守り手が入れない施設があります（${BDEF[un[0].type].name}など${un.length}つ）。施設は、本丸から歩いて行ける所に面して置いてください`;
  const shape = castleShape(l);
  if (shape.hallOutside) return '本丸が塀の中にありません。本丸を、城壁と門（川も使えます）で囲んでください';
  if (shape.strays.length)
    return `本丸を囲まない塀があります（${shape.strays.length}か所。盤面に赤で出しています）。塀に隙間があれば城壁か門でふさぎ、本丸を囲まない城壁・門は取り除いてください`;
  if (shape.landCount < LAND_REQUIRED)
    return `塀の中の広い土地が足りません（今は ${shape.landCount} / ${LAND_REQUIRED}）。一番外の塀を広げるか、塀の中の施設を減らしてください（数に入る土地は、盤面に色で出しています）`;
  return null;
}
