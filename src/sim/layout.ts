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
  isRemovedGeneral,
  LIMITS,
  type LimitedTool,
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
  const { shape: _, ...r } = put(l, tool, x, y);
  return r;
}
// place の中身。門・施設を置いたときは、置いたあとの塀と郭の形（shape）も返す（置く前の案内で使い回す）
function put(l: Layout, tool: Tool, x: number, y: number): PlaceResult & { shape?: CastleShape } {
  // 本丸は2×2なので、つかんだ所によっては左上が盤面の外になる。盤面の外かを見る前に、本丸の置き場所の決まりで理由を返す
  if (tool === 'hall') {
    if (countOf(l, 'hall') >= LIMITS.hall)
      return { ok: false, msg: `本丸は${LIMITS.hall}つだけです（つかんで動かせます）` };
    return placeHall(l, x, y);
  }
  if (!inB(x, y)) return { ok: false, msg: '' };
  if (tool === 'erase') {
    const o = occAt(l, x, y);
    if (!o) return { ok: false, msg: '' };
    // 武将はパネルのスイッチで外す（壁などを消しながら、うっかり武将まで消さないように）
    if (o.k === 'g') return { ok: false, msg: '' };
    // 塀の上の門・櫓は、消すと城壁に戻す（塀に穴を空けて郭を壊さないため。城壁を消せば穴が空く）
    const b = l.buildings[o.i];
    if (onWallTypes.includes(b.type)) l.buildings[o.i] = { type: 'wall', x: b.x, y: b.y };
    else l.buildings.splice(o.i, 1);
    return { ok: true };
  }
  if (!inZone(x, y)) return { ok: false, msg: `配置できるのは城域（${ZW}×${ZW}）の中だけです` };
  // 門と弓櫓・鉄砲櫓は、できあがった塀の城壁の上に置き、その城壁を置き換える
  if (onWallTypes.includes(tool as BuildingType)) return placeOnWall(l, tool as BuildingType, x, y);
  if (occAt(l, x, y)) return { ok: false, msg: '他の配置と重なります' };
  if (isWater(l, x, y)) return { ok: false, msg: '川の上には置けません' };
  // 数の上限があるのは、本丸（上で見る）と武将だけ
  if (isGeneralKind(tool)) {
    if (countOf(l, tool) >= LIMITS[tool]) return { ok: false, msg: `${GDEF[tool].busho}は最大${LIMITS[tool]}までです` };
    if (l.generals.length >= MAX_GENERALS) return { ok: false, msg: `武将は${MAX_GENERALS}人までです` };
    l.generals.push({ kind: tool, x, y });
    return { ok: true };
  }
  const b: PlacedBuilding = { type: tool, x, y };
  // 門と施設は、置いたあとの塀と郭の形で確かめる（城壁は、塀を作っている途中の形を許すため、開戦前に確かめる）
  if (tool === 'wall') {
    l.buildings.push(b);
    return { ok: true };
  }
  const before = castleShape(l);
  l.buildings.push(b);
  const shape = castleShape(l);
  const why = placeWhy(shape, b, before);
  if (why) {
    l.buildings.pop();
    return { ok: false, msg: why };
  }
  return { ok: true, shape };
}
// 塀の城壁の上に置いて、城壁を置き換えるもの（門・弓櫓・鉄砲櫓）
const onWallTypes: readonly BuildingType[] = ['gate', 'tbow', 'tgun'];
// 門・櫓を、(x, y) の城壁を置き換えて置く。城壁でなければ置けない
function placeOnWall(l: Layout, type: BuildingType, x: number, y: number): PlaceResult & { shape?: CastleShape } {
  const nm = BDEF[type].name;
  const o = occAt(l, x, y);
  const i = o?.k === 'b' && l.buildings[o.i].type === 'wall' ? o.i : -1;
  if (i < 0)
    return {
      ok: false,
      msg: o ? `${nm}は、塀（城壁）の上に置きます` : `${nm}は、塀（城壁）の上に置きます。先に城壁で塀を作ってください`,
    };
  const b: PlacedBuilding = { type, x, y };
  const old = l.buildings[i];
  const before = castleShape(l);
  l.buildings[i] = b;
  const shape = castleShape(l);
  const why = placeWhy(shape, b, before);
  if (why) {
    l.buildings[i] = old;
    return { ok: false, msg: why };
  }
  return { ok: true, shape };
}
// 門・施設 b を置いた（置き直した）あとの塀と郭の形 cs で、その b を置けない理由。置けるなら null。
// 門と弓櫓・鉄砲櫓は郭を囲む塀の線に、大筒・鼓楼・鐘楼は郭の中に置く。施設は、その郭の広い土地に応じた数まで。
// before は置く前の形。塀の上の櫓の点数を払う郭は、郭の深さ（門で決まる）と残りの点数で決まるので、b を置くと
// ほかの施設の払う郭が入れ替わることがある。置く前は点数を超えていなかった施設が、置いたあとに超えるなら置けない
function placeWhy(cs: CastleShape, b: PlacedBuilding, before: CastleShape): string | null {
  if (b.type !== 'gate' && !isFacilityType(b.type)) return null;
  if (cs.offLine.includes(b))
    return b.type === 'gate'
      ? '門は、郭を囲む塀の線（両側が別の郭か城の外になる所）に置きます'
      : '櫓は、郭を囲む塀の線（両側が別の郭か城の外になる所）に置きます';
  if (cs.onLine.includes(b)) return '大筒・鼓楼・鐘楼は、塀の線ではなく郭の中に置きます';
  if (b.type !== 'gate') {
    const k = cs.owner.get(b);
    if (k === undefined) return '施設は、郭（塀で囲んだ中）に置きます';
    const info = cs.kuruwa[k];
    if (info.used > info.points)
      return `${info.name}の点数が足りません（${BDEF[b.type].name}は ${BDEF[b.type].cost} 点。置くと ${info.used} / ${info.points} 点。広い土地 ${LAND_PER_POINT} マスにつき1点）`;
  }
  const was = new Set(before.over);
  const pushed = cs.over.find((q) => q !== b && !was.has(q));
  const pk = pushed ? cs.owner.get(pushed) : undefined;
  if (pk !== undefined) {
    const p = cs.kuruwa[pk];
    return `${BDEF[b.type].name}を置くと、塀の上の櫓の点数を払う郭が入れ替わり、${p.name}の点数が足りなくなります（${p.used} / ${p.points} 点）`;
  }
  return null;
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
  // 塀の上の門・櫓は、動かした先の城壁と入れ替える（元の所は城壁に戻す）
  if (onWallTypes.includes(type)) {
    if (b.x === x && b.y === y) return { ok: true };
    l.buildings[i] = { type: 'wall', x: b.x, y: b.y };
    const { shape: _, ...r } = placeOnWall(l, type, x, y);
    if (!r.ok) l.buildings[i] = b;
    return r;
  }
  return reput(l.buildings, i, () => place(l, type, x, y), { type, x, y });
}
export const checkMove = (l: Layout, i: number, x: number, y: number) => moveBuilding(cloneLayout(l), i, x, y);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isInt = (v: unknown): v is number => Number.isInteger(v);

export function validate(o: unknown): Layout | null {
  if (!isRecord(o) || !Array.isArray(o.buildings) || !Array.isArray(o.generals)) return null;
  const l: Layout = { buildings: [], generals: [] };
  const occ = new Set<number>();
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
    if (pb.type === 'hall' && !hallFits(pb.x, pb.y)) return null;
    l.buildings.push(pb);
  }
  for (const g of o.generals as unknown[]) {
    // 外した武将（前田利家・服部半蔵）は黙って飛ばす
    if (isRecord(g) && isRemovedGeneral(g.kind)) continue;
    if (!isRecord(g) || typeof g.kind !== 'string' || !isGeneralKind(g.kind) || !isInt(g.x) || !isInt(g.y)) return null;
    const k = g.y * W + g.x;
    if (!inZone(g.x, g.y) || occ.has(k)) return null;
    occ.add(k);
    l.generals.push({ kind: g.kind, x: g.x, y: g.y });
  }
  // 本丸が2つ・同じ武将が2人など、数の上限を超える配置は読み込まない
  for (const t of Object.keys(LIMITS) as LimitedTool[]) if (countOf(l, t) > LIMITS[t]) return null;
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

// ---- 塀と郭 ------------------------------------------------------------------
// 郭ごとに、その郭の塀にこの数以上の門を置く（郭の数と、門の総数の上限は決めない）
export const GATES_PER_RING = 2;
// 郭ごとの広い土地の下限（どの郭も同じ）
export const KURUWA_LAND = 100;
// 郭の点数：広い土地このマス数につき1点。郭の施設（櫓・大筒・鼓楼・鐘楼）は、施設ごとの点数（BDEF の cost）を、
// その郭の点数から使う（攻めの兵力と同じ考え方。数値は仮）
export const LAND_PER_POINT = 10;
// 広い土地：郭の空きマスのうち、この大きさの四角の空き地（同じ高さ）の一部になっているマス。幅の狭い通路は数えない
export const LAND_BLOCK = 3;
// 漢数字（郭の名前に使う）
const KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const kanji = (n: number) => KANJI[n - 1] ?? String(n);
// 斜めを含む8つの隣
const NEXT8 = [...NEXT4, [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
// 塀の線に置くもの（両側が違う郭か、郭と城の外）と、郭の中に置くもの（塀の線には置かない）
export const ON_LINE: readonly BuildingType[] = ['wall', ...onWallTypes];
const IN_KURUWA: readonly BuildingType[] = ['cata', 'drum', 'bell'];
// 郭ごとの数え。本丸を囲む郭は、内から二の丸・三の丸…（本丸を一の丸とする）。本丸を囲まない郭は出丸
export interface KuruwaInfo {
  name: string;
  depth: number; // 本丸から門をいくつ通って入るか（本丸に面した郭が1）
  surround: boolean; // 本丸を囲む郭か
  land: number; // 広い土地
  gates: number; // この郭の塀にある門
  used: number; // この郭の施設が使う点数（塀の線の櫓は本丸に近い郭のもの、郭の中の施設は置いた郭のもの）
  points: number; // 郭の点数（広い土地 LAND_PER_POINT マスにつき1点）
}
// 塀と郭の形。郭は、施設（門も）・川・崖で区切った、ひと続きの空きマス（縦横に進む）。外周に触れる郭は城の外
export interface CastleShape {
  outside: Uint8Array; // 城の外のマス
  tileKuruwa: Int16Array; // マスごとの郭（kuruwa の番号＋1。0 は郭でない）
  land: Uint8Array; // 広い土地のマス
  kuruwa: KuruwaInfo[]; // 本丸を囲む郭（内から）、出丸の順
  hallOutside: boolean; // 本丸が城の外に面している（塀の中にない）
  pockets: number; // 門から入れない郭の数
  cutOff: Uint8Array; // 城の門へ行けない城の外のマス（出撃できるのに、城の門のない城の外の区画）
  cutOffs: number; // 城の門へ行けない城の外の区画の数
  offLine: PlacedBuilding[]; // 塀の線にない城壁・門・櫓（両側が同じ郭）
  onLine: PlacedBuilding[]; // 塀の線に置いた大筒・鼓楼・鐘楼
  over: PlacedBuilding[]; // 点数を超えた郭の施設
  owner: Map<PlacedBuilding, number>; // 施設が点数を使う郭（kuruwa の番号）
  bad: PlacedBuilding[]; // 盤面で赤く出すもの（上の3つをまとめたもの）
}
// 本丸を囲む郭：その郭に面した施設（縦横斜め。崖をはさむものは除く）と川・崖だけを残してほかの施設を取り除いたとき、
// 本丸から外周へ出られない郭
export function castleShape(l: Layout): CastleShape {
  const { blocked, hall } = blockMap(l, () => false);
  const onEdge = (k: number) => {
    const x = k % W;
    const y = (k / W) | 0;
    return x === 0 || y === 0 || x === W - 1 || y === H - 1;
  };
  // 郭の塗り分け（縦横に、施設・川・崖をよけて）
  const region = new Int32Array(W * H).fill(-1);
  const tiles: number[][] = [];
  const edge: boolean[] = [];
  for (let i = 0; i < W * H; i++) {
    if (region[i] >= 0 || blocked[i] || isRiver(l, i % W, (i / W) | 0)) continue;
    const r = tiles.length;
    const list = [i];
    region[i] = r;
    let e = false;
    for (let q = 0; q < list.length; q++) {
      const k = list[q];
      if (onEdge(k)) e = true;
      const x = k % W;
      const y = (k / W) | 0;
      for (const [dx, dy] of NEXT4) {
        const j = (y + dy) * W + x + dx;
        if (region[j] >= 0 || !canStep(l, blocked, x, y, x + dx, y + dy)) continue;
        region[j] = r;
        list.push(j);
      }
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
  // 本丸に崖をはさまずに面した郭
  const hallSide = hall
    ? aroundHall(hall)
        .filter(([x, y, nx, ny]) => canStep(l, blocked, x, y, nx, ny))
        .map(([, , nx, ny]) => region[ny * W + nx])
    : [];
  const hallOutside = hallSide.some((r) => edge[r]);
  // 施設のマス k と郭のマス (x, y) が、崖をはさまずに隣り合うか
  const touching = (k: number, x: number, y: number) => !isCliff(heightAt(l, k % W, (k / W) | 0), heightAt(l, x, y));
  // 施設が崖をはさまずに縦横斜めで面している郭
  const sideMemo = new Map<PlacedBuilding, number[]>();
  const sides = (b: PlacedBuilding) => {
    const memo = sideMemo.get(b);
    if (memo) return memo;
    const out = new Set<number>();
    const f = fpOf(b);
    for (let y = f.y0; y < f.y0 + f.h; y++)
      for (let x = f.x0; x < f.x0 + f.w; x++)
        for (const [dx, dy] of NEXT8) {
          const nx = x + dx;
          const ny = y + dy;
          if (inB(nx, ny) && region[ny * W + nx] >= 0 && touching(y * W + x, nx, ny)) out.add(region[ny * W + nx]);
        }
    const list = [...out];
    sideMemo.set(b, list);
    return list;
  };
  const surrounds = tiles.map((list, r) => {
    if (edge[r] || !hall) return false;
    const wall = new Uint8Array(W * H);
    for (const k of list) {
      const x = k % W;
      const y = (k / W) | 0;
      for (const [dx, dy] of NEXT8) {
        const j = (y + dy) * W + x + dx;
        if (inB(x + dx, y + dy) && blocked[j] && touching(j, x, y)) wall[j] = 1;
      }
    }
    for (const k of hallTiles) wall[k] = 0;
    // 本丸から歩いて、外周に出られたら囲んでいない
    const seen = new Uint8Array(W * H);
    const queue = [...hallTiles];
    for (const k of queue) seen[k] = 1;
    for (let q = 0; q < queue.length; q++) {
      const k = queue[q];
      if (onEdge(k)) return false;
      const x = k % W;
      const y = (k / W) | 0;
      for (const [dx, dy] of NEXT4) {
        const j = (y + dy) * W + x + dx;
        if (seen[j] || !canStep(l, wall, x, y, x + dx, y + dy)) continue;
        seen[j] = 1;
        queue.push(j);
      }
    }
    return true;
  });
  // 郭の深さ：本丸に面した郭が1。そこから門を1つ通って入る郭が2…（本丸を囲まない郭も、門でつながれば数える）
  const gates = l.buildings.filter((b) => b.type === 'gate');
  const gateSides = gates.map((g) => sides(g));
  const rDepth = new Int32Array(tiles.length);
  let front = [...new Set(hallSide.filter((r) => !edge[r]))];
  let depth = 0;
  while (front.length) {
    depth++;
    for (const r of front) rDepth[r] = depth;
    const next = new Set<number>();
    for (const rs of gateSides)
      if (rs.some((r) => rDepth[r] === depth)) for (const r of rs) if (!edge[r] && !rDepth[r]) next.add(r);
    front = [...next];
  }
  // 施設に面していない区画（崖や川だけで閉じた台地・中州）は、城と関係のない地形なので郭に数えない
  const walled = tiles.map((list) =>
    list.some((k) => {
      const x = k % W;
      const y = (k / W) | 0;
      return NEXT8.some(([dx, dy]) => {
        const j = (y + dy) * W + x + dx;
        return inB(x + dx, y + dy) && blocked[j] === 1 && touching(j, x, y);
      });
    }),
  );
  const pockets = tiles.filter((_, r) => !edge[r] && !rDepth[r] && walled[r]).length;
  // 郭の並び：本丸を囲む郭を深さの順に（二の丸・三の丸…）、そのあと出丸を深さの順に
  const rs = tiles.map((_, r) => r).filter((r) => rDepth[r] > 0);
  const order = rs
    .slice()
    .sort((a, b) => Number(surrounds[b]) - Number(surrounds[a]) || rDepth[a] - rDepth[b] || a - b);
  const nOut = order.filter((r) => !surrounds[r]).length;
  const rKuruwa = new Int32Array(tiles.length).fill(-1);
  const kuruwa: KuruwaInfo[] = order.map((r, i) => {
    rKuruwa[r] = i;
    const n = surrounds[r] ? i + 2 : i - (order.length - nOut) + 1;
    return {
      name: surrounds[r] ? `${kanji(n)}の丸` : nOut > 1 ? `出丸${kanji(n)}` : '出丸',
      depth: rDepth[r],
      surround: surrounds[r],
      land: 0,
      gates: 0,
      used: 0,
      points: 0,
    };
  });
  const tileKuruwa = new Int16Array(W * H);
  for (const r of rs) for (const k of tiles[r]) tileKuruwa[k] = rKuruwa[r] + 1;
  // 広い土地：郭のマスのうち、LAND_BLOCK×LAND_BLOCK の同じ高さの空き地（同じ郭の中）の一部になっているもの
  const land = new Uint8Array(W * H);
  for (let y = 0; y + LAND_BLOCK <= H; y++)
    for (let x = 0; x + LAND_BLOCK <= W; x++) {
      const h = heightAt(l, x, y);
      const r = region[y * W + x];
      if (r < 0 || rKuruwa[r] < 0) continue;
      let ok = true;
      for (let dy = 0; dy < LAND_BLOCK && ok; dy++)
        for (let dx = 0; dx < LAND_BLOCK && ok; dx++)
          if (!inB(x + dx, y + dy) || region[(y + dy) * W + x + dx] !== r || heightAt(l, x + dx, y + dy) !== h)
            ok = false;
      if (ok)
        for (let dy = 0; dy < LAND_BLOCK; dy++) for (let dx = 0; dx < LAND_BLOCK; dx++) land[(y + dy) * W + x + dx] = 1;
    }
  for (let k = 0; k < W * H; k++) if (land[k] && tileKuruwa[k]) kuruwa[tileKuruwa[k] - 1].land++;
  for (const info of kuruwa) info.points = Math.floor(info.land / LAND_PER_POINT);
  // 門：両側の郭のどちらの塀の門としても数える
  for (const g of gateSides) if (g.length > 1) for (const r of g) if (rKuruwa[r] >= 0) kuruwa[rKuruwa[r]].gates++;
  // 塀の線：塀の線に置くものは、両側が違う郭（または郭と城の外）か、片側が郭でもう片側が川・崖（川岸や崖の上の塀）。
  // 郭の中に置くものは片側だけ
  const natural = (b: PlacedBuilding) =>
    NEXT8.some(([dx, dy]) => {
      const x = b.x + dx;
      const y = b.y + dy;
      return inB(x, y) && (isRiver(l, x, y) || isCliff(heightAt(l, b.x, b.y), heightAt(l, x, y)));
    });
  const offLine = l.buildings.filter((b) => {
    if (!ON_LINE.includes(b.type)) return false;
    const s = sides(b);
    return s.length === 0 || (s.length === 1 && (rKuruwa[s[0]] < 0 || !natural(b)));
  });
  const onLine = l.buildings.filter((b) => IN_KURUWA.includes(b.type) && sides(b).length > 1);
  // 施設の点数：塀の線の櫓は本丸に近い（深さの浅い）郭の、郭の中の施設は置いた郭の点数を使う。
  // 近さが同じ郭どうしなら、残りの点数が多い郭が払う
  const owner = new Map<PlacedBuilding, number>();
  const left = (k: number) => kuruwa[k].points - kuruwa[k].used;
  for (const b of l.buildings) {
    if (!isFacilityType(b.type)) continue;
    const ks = sides(b)
      .map((r) => rKuruwa[r])
      .filter((k) => k >= 0)
      .sort((a, b) => kuruwa[a].depth - kuruwa[b].depth || left(b) - left(a) || a - b);
    if (!ks.length) continue;
    owner.set(b, ks[0]);
    kuruwa[ks[0]].used += BDEF[b.type].cost ?? 0;
  }
  const over = [...owner].filter(([, k]) => kuruwa[k].used > kuruwa[k].points).map(([b]) => b);
  const bad = [...new Set([...offLine, ...onLine, ...over])];
  // 城の門へ行けない城の外：出撃できるマスがあるのに、城の門（城の外に面した門）が1つもない城の外の区画
  const outRegions = new Set<number>();
  for (const g of gateSides) for (const r of g) if (edge[r]) outRegions.add(r);
  const cutOff = new Uint8Array(W * H);
  let cutOffs = 0;
  for (let r = 0; r < tiles.length; r++) {
    if (!edge[r] || outRegions.has(r) || !tiles[r].some((k) => canDeployAt(l, k % W, (k / W) | 0))) continue;
    cutOffs++;
    for (const k of tiles[r]) cutOff[k] = 1;
  }
  return {
    outside,
    tileKuruwa,
    land,
    kuruwa,
    hallOutside,
    pockets,
    cutOff,
    cutOffs,
    offLine,
    onLine,
    over,
    owner,
    bad,
  };
}

// 塀の城壁 (x, y) の上に櫓を置くと、点数を使う郭（kuruwa の番号）。郭に面していなければ null
export function wallOwner(l: Layout, cs: CastleShape, x: number, y: number): number | null {
  let best: number | null = null;
  for (const [dx, dy] of NEXT8) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inB(nx, ny) || isCliff(heightAt(l, x, y), heightAt(l, nx, ny))) continue;
    const v = cs.tileKuruwa[ny * W + nx] - 1;
    if (v < 0) continue;
    const a = cs.kuruwa[v];
    const b = best === null ? null : cs.kuruwa[best];
    if (!b || a.depth < b.depth || (a.depth === b.depth && a.points - a.used > b.points - b.used)) best = v;
  }
  return best;
}
// 道具 tool を (x, y) に置いたらどうなるか（置く前の案内に使う。配置は書き換えない）。
// 置ける施設なら、点数を使う郭の名前と、置いたあとの使う点数・郭の点数も返す
export function placePreview(
  l: Layout,
  tool: Tool,
  x: number,
  y: number,
): PlaceResult & { kuruwa?: string; used?: number; points?: number } {
  const c = cloneLayout(l);
  const { shape: cs, ...r } = put(c, tool, x, y);
  if (!r.ok || !cs || tool === 'erase' || isGeneralKind(tool) || !isFacilityType(tool)) return r;
  const b = c.buildings.find((q) => q.type === tool && q.x === x && q.y === y);
  const k = b ? cs.owner.get(b) : undefined;
  if (k === undefined) return r;
  const info = cs.kuruwa[k];
  return { ...r, kuruwa: info.name, used: info.used, points: info.points };
}

// 攻城を始められない理由。始められるなら null
// shape は castleShape(l) の結果（もう求めてあれば渡す。なければ中で求める）
// 門を置き終えたか（防衛配置のパネルの、門の「必須」の印）。門を置けば直る開戦の条件だけを見る：
// 郭があり、どの郭（出丸も）もその郭の塀に GATES_PER_RING 以上の門があり、門から入れない郭がなく、外周から本丸へ通じる道がある。
// 本丸が塀の中にない・門へ行けない城の外があるなどは、塀の側でも直せるので、ここでは見ない（開戦前の確かめ notReady が見る）
export function gatesDone(l: Layout, shape?: CastleShape): boolean {
  const cs = shape ?? castleShape(l);
  if (!cs.kuruwa.length || cs.pockets) return false;
  if (cs.kuruwa.some((info) => info.gates < GATES_PER_RING)) return false;
  return hallReachable(l);
}
export function notReady(l: Layout, shape?: CastleShape): string | null {
  if (countOf(l, 'hall') !== 1) return '本丸を置いてください';
  if (!hallReachable(l)) return '外周から本丸へ通じる道がありません（囲いに門を置くか、崖をよけてください）';
  const bg = blockedGates(l);
  if (bg.length)
    return `前後がふさがった門があります（${bg.length}つ）。門は、縦か横の向きで、前後のマスを空けてください`;
  const un = unmannedFacilities(l);
  if (un.length)
    return `守り手が入れない施設があります（${BDEF[un[0].type].name}など${un.length}つ）。施設は、本丸から歩いて行ける所に面して置いてください`;
  const cs = shape ?? castleShape(l);
  if (cs.hallOutside) return '本丸が塀の中にありません。本丸を、城壁と門（川も使えます）で囲んでください';
  if (cs.pockets) return `門から入れない郭があります（${cs.pockets}つ）。郭には門を置いてください`;
  if (cs.cutOffs)
    return '城の門へ歩いて行けない城の外があります（盤面に赤く出しています）。その側からも攻め手が城の門へ行けるよう、塀に門を足すか、城の外を切り離している塀を外してください';
  if (cs.offLine.length)
    return `塀の線にない城壁・門・櫓があります（${cs.offLine.length}か所。盤面に赤で出しています）。両側が別の郭（または城の外）になるように、塀の線に置いてください`;
  if (cs.onLine.length)
    return `塀の線に置いた大筒・鼓楼・鐘楼があります（${cs.onLine.length}か所。盤面に赤で出しています）。郭の中に置いてください`;
  for (const info of cs.kuruwa) {
    const name = info.name;
    if (info.gates < GATES_PER_RING) return `${name}の塀の門が足りません（今は ${info.gates} / ${GATES_PER_RING}）`;
    if (info.land < KURUWA_LAND)
      return `${name}の広い土地が足りません（今は ${info.land} / ${KURUWA_LAND}）。${name}を広げるか、${name}の中の施設を減らしてください`;
    if (info.used > info.points)
      return `${name}の施設が点数を超えています（${info.used} / ${info.points} 点。広い土地 ${LAND_PER_POINT} マスにつき1点）。施設を減らすか、${name}を広げてください`;
  }
  return null;
}
