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
import { canDeployTile, isMapId, isRingTile, MAP_STYLE, type MapId } from './terrain';

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
  // 川（W×H、1なら川。橋のかかったマスも含む）。攻め手も守将も入れるが遅い（RIVER_SPEED）。施設や武将は置けない
  water?: number[];
  // 川にかかった橋（W×H、1なら橋）。橋のマスは普通の速さで渡れる。施設や武将は置けない
  bridge?: number[];
  // 守りが引いた堀（W×H、1なら堀）。効果は川と同じ。川と同じ高さで、川につながる所にだけ引ける。
  // 書き換えるときは、配列ごと作り直す（画面は配列が変わったかで地面を作り直すため）
  moat?: number[];
  map?: string; // 地図の型の名前（画面で選んでいる型を出すため）
}
// マスが川か
export const isWater = (l: Layout, x: number, y: number) => l.water?.[y * W + x] === 1;
// マスが、橋のかかっていない川か
export const isRiver = (l: Layout, x: number, y: number) => isWater(l, x, y) && l.bridge?.[y * W + x] !== 1;
// マスが堀か
export const isMoat = (l: Layout, x: number, y: number) => l.moat?.[y * W + x] === 1;
// マスが水の中か（橋のかかっていない川か堀）。入れるが遅く、郭を区切らず、逃げ道には使えない
export const isWet = (l: Layout, x: number, y: number) => isRiver(l, x, y) || isMoat(l, x, y);
// 堀の数
export const moatCount = (l: Layout) => l.moat?.reduce((a, v) => a + v, 0) ?? 0;
// 堀のマス数の上限（城の型の MOAT_CAP。型のない配置は平城）
export const moatCapOf = (l: Layout) => MOAT_CAP[isMapId(l.map) ? l.map : 'flat'];
// 堀のマス k を、on なら引き、そうでなければ消す（配列ごと作り直す）
function setMoat(l: Layout, k: number, on: boolean) {
  const m = l.moat ? l.moat.slice() : new Array<number>(W * H).fill(0);
  m[k] = on ? 1 : 0;
  l.moat = m.some((v) => v) ? m : undefined;
}
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
    if (!o && isMoat(l, x, y)) {
      setMoat(l, y * W + x, false);
      return { ok: true };
    }
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
  if (isMoat(l, x, y)) return { ok: false, msg: tool === 'moat' ? '' : '堀の上には置けません' };
  if (tool === 'moat') return putMoat(l, x, y);
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
// 堀を (x, y) に引く。置くときは、施設や川と重ならないことだけを見る（塀より先に堀を引けるように）。
// 引ける場所（川に同じ高さでつながる）・数の上限・門の前後・橋の両端は、
// 置いたあとの形で赤く出し、開戦前の確かめ（notReady）で止める
function putMoat(l: Layout, x: number, y: number): PlaceResult {
  setMoat(l, y * W + x, true);
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
      if (isMoat(l, xx, yy)) return { ok: false, msg: '堀の上には置けません' };
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
  // 堀：あれば W×H の 0 か 1。川の上や、施設・武将のあるマスには引かない（引ける場所と数は、開戦前に確かめる）
  if (o.moat !== undefined) {
    const ms = o.moat;
    if (!Array.isArray(ms) || ms.length !== W * H || !ms.every((v) => v === 0 || v === 1)) return null;
    for (let k = 0; k < W * H; k++)
      if (ms[k] && (occ.has(k) || l.water?.[k] || !inZone(k % W, (k / W) | 0))) return null;
    if (ms.some((v) => v)) l.moat = ms as number[];
  }
  // 本丸は段をまたいで置かない
  for (const b of l.buildings) if (b.type === 'hall' && !hallLevel(l, b.x, b.y)) return null;
  // 地図の型の名前は、決まった型だけを読む。高さのない平山城などは、平城として扱う（ボタンの表示と盤面を合わせる）
  if (isMapId(o.map) && (o.map === 'flat' || l.heights)) l.map = o.map;
  // 平城は平ら（MAP_STYLE の top が0）なので、高さのある地形を、型なしや平城として読まない。
  // いちばん高い段から型を決める（堀の上限や「平城のみ」の決まりを、型の名前を書き換えてすり抜けられないようにするため）
  const top = l.heights ? Math.max(...l.heights) : 0;
  if (top > 0 && (l.map === undefined || l.map === 'flat')) l.map = top <= MAP_STYLE.hirayama.top ? 'hirayama' : 'yama';
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
// 縦横に隣どうしの (x,y) から (nx,ny) へ、歩いて移れるか（盤面の中で、通れない施設・崖がない）。
// 川と堀は、遅いが入れるので通れるとみなす。wade を false にすると、川と堀を通らない（陸だけを歩く）
// 外周の出撃口どうしは、歩いて渡れないものとして数える（出撃口は、そこから城域へ入る入口としてだけ使う）
const canStep = (l: Layout, blocked: Uint8Array, x: number, y: number, nx: number, ny: number, wade = true) =>
  inB(nx, ny) &&
  !(isRingTile(y * W + x) && isRingTile(ny * W + nx)) &&
  !blocked[ny * W + nx] &&
  (wade || !isWet(l, nx, ny)) &&
  !isCliff(heightAt(l, x, y), heightAt(l, nx, ny));
// seeds のマスから、縦横に歩いて行けるマスを塗る（斜めには進まない形で確かめる。甘く見積もらないため）
function spread(l: Layout, blocked: Uint8Array, seeds: number[], wade = true): Uint8Array {
  const seen = new Uint8Array(W * H);
  for (const k of seeds) seen[k] = 1;
  const queue = [...seeds];
  for (let q = 0; q < queue.length; q++) {
    const x = queue[q] % W;
    const y = (queue[q] / W) | 0;
    for (const [dx, dy] of NEXT4) {
      const k = (y + dy) * W + x + dx;
      if (seen[k] || !canStep(l, blocked, x, y, x + dx, y + dy, wade)) continue;
      seen[k] = 1;
      queue.push(k);
    }
  }
  return seen;
}
// 橋のマス k の両端：橋を渡る向き（左右が陸なら東西、そうでなければ南北）の、両隣のマス（盤面の中のものだけ）
function bridgeEndsOf(l: Layout, k: number): number[] {
  const x = k % W;
  const y = (k / W) | 0;
  const ew = inB(x - 1, y) && inB(x + 1, y) && !l.water?.[k - 1] && !l.water?.[k + 1];
  const ends: [number, number][] = ew
    ? [
        [x - 1, y],
        [x + 1, y],
      ]
    : [
        [x, y - 1],
        [x, y + 1],
      ];
  return ends.filter(([ex, ey]) => inB(ex, ey)).map(([ex, ey]) => ey * W + ex);
}

// ---- 引き橋 -----------------------------------------------------------------
// 引き橋の門：門の縦か横の向きで、片側が堀、反対側が空いた陸なら、その堀のマスは門の引き橋。
// 開戦前の確かめでは橋として数え（逃げ道・本丸への道・門の前後・城の外から門への道）、戦いでは上がっていて堀のまま。
// 攻め手は水の中から攻撃できないので、引き橋の門は外から壊せない。門が壊れると下りて橋になる。
// 引き橋にするのは堀だけ（川の前の門は今までどおり前後がふさがった門）。堀を引ける平城だけの仕組みにするため
export interface Drawbridge {
  gate: PlacedBuilding; // 引き橋の門
  k: number; // 引き橋のマス（y * W + x）
}
export function drawbridges(l: Layout): Drawbridge[] {
  if (!l.moat) return [];
  const { blocked: occ } = blockMap(l, () => false);
  const out: Drawbridge[] = [];
  for (const b of l.buildings) {
    if (b.type !== 'gate') continue;
    for (const [dx, dy] of NEXT4) {
      const x = b.x + dx;
      const y = b.y + dy;
      if (!inB(x, y) || !isMoat(l, x, y) || isCliff(heightAt(l, b.x, b.y), heightAt(l, x, y))) continue;
      if (!canStep(l, occ, b.x, b.y, b.x - dx, b.y - dy, false)) continue;
      out.push({ gate: b, k: y * W + x });
      break;
    }
  }
  return out;
}
// 開戦前の確かめで道を見るときの配置：引き橋のマスを、堀から外して陸（下りた橋）とみなす。
// db は drawbridges(l) の結果（もう求めてあれば渡す。以下の関数も同じ）
function landView(l: Layout, db = drawbridges(l)): Layout {
  if (!db.length || !l.moat) return l;
  const moat = l.moat.slice();
  for (const d of db) moat[d.k] = 0;
  return { ...l, moat: moat.some((v) => v) ? moat : undefined };
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
// 外周から本丸まで、通れる地面だけを通って行けるか（崖は通れない。川と堀は渡らない。橋と引き橋は渡れる）
export function hallReachable(l: Layout, db = drawbridges(l)): boolean {
  return reachHall(landView(l, db), []);
}
// 攻め手が入れるか：引き橋の門は外から壊せないので、引き橋の門を壁とみなし、引き橋も上げた（堀の）まま、
// 外周から陸と橋だけで本丸へ行けるか。外の門も内の門もすべて引き橋にすると、攻め手が入れない城になるため
export function hallBreachable(l: Layout, db = drawbridges(l)): boolean {
  if (!db.length) return true;
  const shut = db.map((d) => d.gate);
  return reachHall(l, shut);
}
// 外周から本丸まで、陸と橋だけを通って行けるか。shut の門は壁とみなす
function reachHall(l: Layout, shut: PlacedBuilding[]): boolean {
  const { blocked, hall } = blockMap(l, passable);
  if (!hall) return false;
  for (const g of shut) blocked[g.y * W + g.x] = 1;
  const seeds: number[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (canDeployAt(l, x, y) && !blocked[y * W + x]) seeds.push(y * W + x);
  const seen = spread(l, blocked, seeds, false);
  return aroundHall(hall).some(([, , nx, ny]) => inB(nx, ny) && seen[ny * W + nx] === 1);
}
// 守り手が入れない施設：本丸から守り手が歩いて行けるマスに、縦か横で接していない施設（撃つ櫓・大筒と、まわりに効く鼓楼・鐘楼）。
// 守り手が歩いて行けるのは、施設のないマスと、門のマス（崖はよけ、川と堀は渡り、縦横に進む）。施設と隣のマスの間が崖なら、接していないとみなす。
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
// 空いているマスは、施設がなく、川や堀でもなく（引き橋は空いているとみなす）、門との間が崖でもない、盤面の中のマス（武将は動くので数えない）。
// 門は人や荷が通る口なので、前後を陸で空ける
export function blockedGates(l0: Layout, db = drawbridges(l0)): PlacedBuilding[] {
  // 引き橋は、下りた橋（陸）とみなす
  const l = landView(l0, db);
  const { blocked: occ } = blockMap(l, () => false);
  return l.buildings.filter((b) => {
    if (b.type !== 'gate') return false;
    const open = (x: number, y: number) => canStep(l, occ, b.x, b.y, x, y, false);
    return !(open(b.x, b.y - 1) && open(b.x, b.y + 1)) && !(open(b.x - 1, b.y) && open(b.x + 1, b.y));
  });
}

// ---- 塀と郭 ------------------------------------------------------------------
// 本丸から城の外へ、同じ門を通らずに行ける道（逃げ道）の数。同じ郭の中を通るのは認める。
// 外の門の開きは2つの門の組で見るので、この数は2のままにする
export const ESCAPE_ROUTES = 2;
// 逃げ道の外の門が、本丸の真ん中から見て開いていなければならない角度（度。数値は仮）
export const ESCAPE_ANGLE = 90;
// 城の外に面した塀このマス数につき、外の門を1つ置く（切り上げ。数値は仮）
export const WALL_PER_GATE = 50;
// 同じ郭の外周の門どうしを、直線でこのマス数より近くに置かない（数値は仮）。
// 門は、両側の郭のうち本丸に近い（深さの浅い）郭の外周の塀にあるとみなす（同じ深さなら両方）。外周の違う門どうし（二の丸の門と三の丸の門など）は比べない
export const GATE_SPACING = 15;
// 堀のマス数の上限：城の型ごと（数値は仮）。川を活かす平城の特徴として、平城だけが堀を引ける。
// 平山城と山城は、高低差を活かす城なので、堀は引けない
export const MOAT_CAP: Record<MapId, number> = { flat: 50, hirayama: 0, yama: 0 };
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
  used: number; // この郭の施設が使う点数（塀の線の櫓は本丸に近い郭のもの、郭の中の施設は置いた郭のもの）
  points: number; // 郭の点数（広い土地 LAND_PER_POINT マスにつき1点）
}
// 塀と郭の形。郭は、施設（門も）・崖で区切った、ひと続きの空きマス（縦横に進む）。川と堀は郭を区切らない。外周に触れる郭は城の外
export interface CastleShape {
  outside: Uint8Array; // 城の外のマス
  tileKuruwa: Int16Array; // マスごとの郭（kuruwa の番号＋1。0 は郭でない）
  land: Uint8Array; // 広い土地のマス
  kuruwa: KuruwaInfo[]; // 本丸を囲む郭（内から）、出丸の順
  hallOutside: boolean; // 本丸が城の外に面している（塀の中にない）
  pockets: number; // 門から入れない郭の数
  cutOff: Uint8Array; // 城の門へ行けない城の外のマス（出撃できるのに、城の門のない城の外の区画。城域の中のマスだけ）
  cutOffs: number; // 城の門へ行けない城の外の区画の数
  routes: number; // 本丸から城の外への逃げ道の数（ESCAPE_ROUTES まで数える）
  routesApart: boolean; // 逃げ道の外の門が、ESCAPE_ANGLE 以上開いた組を取れる
  outerGates: number; // 城の外に面した門の数
  outerWall: number; // 城の外に面した塀のマス数（城壁・門・櫓）
  gatesNeed: number; // 城の外に面した門の必要な数
  closeGates: PlacedBuilding[]; // 同じ郭の外周で、ほかの門から GATE_SPACING より近い門
  closePairs: [PlacedBuilding, PlacedBuilding][]; // 近すぎる門の組（画面で、門に合わせたときに相手を示すため）
  offLine: PlacedBuilding[]; // 塀の線にない城壁・門・櫓（両側が同じ郭）
  onLine: PlacedBuilding[]; // 塀の線に置いた大筒・鼓楼・鐘楼
  over: PlacedBuilding[]; // 点数を超えた郭の施設
  outsideFacilities: PlacedBuilding[]; // 郭の外（城の外の野原など）の施設。点数を払う郭がない
  owner: Map<PlacedBuilding, number>; // 施設が点数を使う郭（kuruwa の番号）
  bad: PlacedBuilding[]; // 盤面で赤く出すもの（塀の線にないもの・塀の線の大筒など・点数を超えた施設・郭の外の施設・近すぎる門・橋をふさいだ施設をまとめたもの）
  moats: number; // 堀のマス数
  moatCap: number; // 堀のマス数の上限（城の型の MOAT_CAP）
  moatAstray: number[]; // 引けない所の堀（川につながらない・前後がふさがった門の前後・橋の両端）のマス
  bridgeShut: PlacedBuilding[]; // 橋の両端をふさいだ施設（門のほか）
  moatOver: number[]; // 上限を超えた堀のマス（川から遠いものから数える）
  drawbridges: Drawbridge[]; // 引き橋（drawbridges(l) の結果）
}
// 区画と門のつながりで、from から to へ、同じ門を通らずに行ける道の数（limit まで）。
// 門を容量1の辺にした最大流。sides は門ごとの面した区画。使わない門は sides から空にして渡す
function gateRoutes(regions: number, sides: number[][], from: number[], to: number[], limit: number) {
  const S = regions + 2 * sides.length;
  const T = S + 1;
  const next: { to: number; cap: number; back: number }[][] = Array.from({ length: T + 1 }, () => []);
  const link = (a: number, b: number, cap: number) => {
    next[a].push({ to: b, cap, back: next[b].length });
    next[b].push({ to: a, cap: 0, back: next[a].length - 1 });
  };
  for (const r of from) link(S, r, limit);
  for (const r of to) link(r, T, limit);
  sides.forEach((rs, i) => {
    const gin = regions + 2 * i;
    link(gin, gin + 1, 1);
    for (const r of rs) {
      link(r, gin, limit);
      link(gin + 1, r, limit);
    }
  });
  let flow = 0;
  while (flow < limit) {
    const prev: ([number, number] | null)[] = new Array(T + 1).fill(null);
    const queue = [S];
    for (let q = 0; q < queue.length && !prev[T]; q++) {
      const a = queue[q];
      next[a].forEach((e, i) => {
        if (e.cap > 0 && e.to !== S && !prev[e.to]) {
          prev[e.to] = [a, i];
          queue.push(e.to);
        }
      });
    }
    if (!prev[T]) break;
    for (let v = T; v !== S; ) {
      const [a, i] = prev[v] as [number, number];
      const e = next[a][i];
      e.cap--;
      next[e.to][e.back].cap++;
      v = a;
    }
    flow++;
  }
  return flow;
}

// 本丸を囲む郭：その郭に面した施設（縦横斜め。崖をはさむものは除く）と川・崖だけを残してほかの施設を取り除いたとき、
// 本丸から外周へ出られない郭
export function castleShape(l: Layout): CastleShape {
  const { blocked, hall } = blockMap(l, () => false);
  const db = drawbridges(l);
  const onEdge = (k: number) => {
    const x = k % W;
    const y = (k / W) | 0;
    return x === 0 || y === 0 || x === W - 1 || y === H - 1;
  };
  // 郭の塗り分け（縦横に、施設・崖をよけて。川と堀は郭を区切らないので、またいで塗る）
  const region = new Int32Array(W * H).fill(-1);
  const tiles: number[][] = [];
  const edge: boolean[] = [];
  for (let i = 0; i < W * H; i++) {
    if (region[i] >= 0 || blocked[i]) continue;
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
  // 門を縦横に歩いて通れる区画
  const doors = gates.map((g) => [
    ...new Set(
      NEXT4.flatMap(([dx, dy]) =>
        canStep(l, blocked, g.x, g.y, g.x + dx, g.y + dy) ? [region[(g.y + dy) * W + g.x + dx]] : [],
      ),
    ),
  ]);
  // 橋でつないだ門：地形の橋か引き橋の両端がどちらも門なら、2つの門を、郭から郭へ渡る1つの口とみなす。
  // 川や堀の向こうに、橋でつないだ出島・馬出しを作れるようにするため（橋は城の外の区画にあるが、この口は城の外を通らないとみなす）。
  // 戦いの中の動きは変えない（攻め手は川を歩いて橋に上がれる）
  const gateAt = new Map(gates.map((g, i) => [g.y * W + g.x, i]));
  const spans: { a: number; b: number; k: number }[] = [];
  for (let k = 0; k < W * H; k++) {
    if (!l.bridge?.[k] || !l.water?.[k]) continue;
    const [a, b] = bridgeEndsOf(l, k).map((j) => gateAt.get(j));
    if (a !== undefined && b !== undefined) spans.push({ a, b, k });
  }
  for (const d of db) {
    const a = gateAt.get(d.gate.y * W + d.gate.x);
    const b = gateAt.get(2 * d.k - (d.gate.y * W + d.gate.x));
    if (a !== undefined && b !== undefined) spans.push({ a, b, k: d.k });
  }
  const spanned = new Set(spans.flatMap((p) => [p.a, p.b]));
  // 深さを数えるときの口：門ごとの区画と、橋でつないだ2つの門の区画をまとめたもの
  const passes = [...doors, ...spans.map((p) => [...doors[p.a], ...doors[p.b]])];
  const rDepth = new Int32Array(tiles.length);
  const hallKuruwa = [...new Set(hallSide.filter((r) => !edge[r]))];
  let front = hallKuruwa;
  let depth = 0;
  while (front.length) {
    depth++;
    for (const r of front) rDepth[r] = depth;
    const next = new Set<number>();
    for (const rs of passes)
      if (rs.some((r) => rDepth[r] === depth)) for (const r of rs) if (!edge[r] && !rDepth[r]) next.add(r);
    front = [...next];
  }
  // 施設に面していない区画（崖だけで閉じた台地）は、城と関係のない地形なので郭に数えない
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
      used: 0,
      points: 0,
    };
  });
  const tileKuruwa = new Int16Array(W * H);
  for (const r of rs) for (const k of tiles[r]) tileKuruwa[k] = rKuruwa[r] + 1;
  // 広い土地：郭のマスのうち、LAND_BLOCK×LAND_BLOCK の同じ高さの空き地（同じ郭の中で、川や堀を含まない）の一部になっているもの
  const land = new Uint8Array(W * H);
  for (let y = 0; y + LAND_BLOCK <= H; y++)
    for (let x = 0; x + LAND_BLOCK <= W; x++) {
      const h = heightAt(l, x, y);
      const r = region[y * W + x];
      if (r < 0 || rKuruwa[r] < 0) continue;
      let ok = true;
      for (let dy = 0; dy < LAND_BLOCK && ok; dy++)
        for (let dx = 0; dx < LAND_BLOCK && ok; dx++)
          if (
            !inB(x + dx, y + dy) ||
            region[(y + dy) * W + x + dx] !== r ||
            heightAt(l, x + dx, y + dy) !== h ||
            isWet(l, x + dx, y + dy)
          )
            ok = false;
      if (ok)
        for (let dy = 0; dy < LAND_BLOCK; dy++) for (let dx = 0; dx < LAND_BLOCK; dx++) land[(y + dy) * W + x + dx] = 1;
    }
  for (let k = 0; k < W * H; k++) if (land[k] && tileKuruwa[k]) kuruwa[tileKuruwa[k] - 1].land++;
  for (const info of kuruwa) info.points = Math.floor(info.land / LAND_PER_POINT);
  // 塀の線：塀の線に置くものは、両側が違う郭（または郭と城の外）か、片側が郭でもう片側が崖（崖の上の塀）。
  // 郭の中に置くものは片側だけ。川と堀は郭を区切らないので、川岸の塀は、川の向こうが城の外なら、郭と城の外の間の塀になる
  const natural = (b: PlacedBuilding) =>
    NEXT8.some(([dx, dy]) => {
      const x = b.x + dx;
      const y = b.y + dy;
      return inB(x, y) && isCliff(heightAt(l, b.x, b.y), heightAt(l, x, y));
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
  // 郭の外の施設：点数を払う郭がない施設。画面で置くときは止めるが、置いたあとで郭の囲いを外したときや、
  // 配置データの読み込みでは生じる
  const outsideFacilities: PlacedBuilding[] = [];
  const left = (k: number) => kuruwa[k].points - kuruwa[k].used;
  for (const b of l.buildings) {
    if (!isFacilityType(b.type)) continue;
    const ks = sides(b)
      .map((r) => rKuruwa[r])
      .filter((k) => k >= 0)
      .sort((a, b) => kuruwa[a].depth - kuruwa[b].depth || left(b) - left(a) || a - b);
    if (!ks.length) {
      outsideFacilities.push(b);
      continue;
    }
    owner.set(b, ks[0]);
    kuruwa[ks[0]].used += BDEF[b.type].cost ?? 0;
  }
  const over = [...owner].filter(([, k]) => kuruwa[k].used > kuruwa[k].points).map(([b]) => b);
  // 近すぎる門：門は、門を縦横に歩いて通れる郭のうち、深さの浅い郭の外周にある（同じ深さなら、その郭すべての外周にある）。
  // 外周ごとに門をまとめ、その中で GATE_SPACING より近い組を探す
  const perimeter = new Map<number, PlacedBuilding[]>();
  gates.forEach((g, i) => {
    const ks = [...new Set(doors[i].map((r) => rKuruwa[r]).filter((k) => k >= 0))];
    const min = Math.min(...ks.map((k) => kuruwa[k].depth));
    for (const k of ks) if (kuruwa[k].depth === min) perimeter.set(k, [...(perimeter.get(k) ?? []), g]);
  });
  const close = new Set<PlacedBuilding>();
  const closePairs: [PlacedBuilding, PlacedBuilding][] = [];
  for (const gs of perimeter.values())
    for (let i = 0; i < gs.length; i++)
      for (let j = i + 1; j < gs.length; j++)
        if (Math.hypot(gs[i].x - gs[j].x, gs[i].y - gs[j].y) < GATE_SPACING) {
          close.add(gs[i]).add(gs[j]);
          // 2つの外周に同じ組が入ることがあるので、組は1度だけ数える
          if (!closePairs.some(([a, b]) => a === gs[i] && b === gs[j])) closePairs.push([gs[i], gs[j]]);
        }
  const closeGates = gates.filter((g) => close.has(g));
  const bad = [...new Set([...offLine, ...onLine, ...over, ...outsideFacilities, ...closeGates])];
  // 出撃できる城の外（出撃口を含む城の外の区画）
  const field = tiles.map((list, r) => edge[r] && list.some((k) => canDeployAt(l, k % W, (k / W) | 0)));
  // 逃げ道：本丸に面した陸から、攻め手が出撃できる城の外の陸へ、同じ門を通らない道。川や堀は渡らない（陸だけを歩く）。
  // 郭の塗り分けは川や堀をまたぐので、逃げ道は、陸だけでつながる区画（dry）で数え直す。門は縦横に歩ける面だけでつなぐ
  // 引き橋は、下りた橋（陸）とみなす
  const lv = landView(l, db);
  const dry = new Int32Array(W * H).fill(-1);
  const dryOf: number[] = []; // dry の区画ごとの、郭の塗り分けの区画（region）
  for (let i = 0; i < W * H; i++) {
    if (dry[i] >= 0 || blocked[i] || isWet(lv, i % W, (i / W) | 0)) continue;
    const r = dryOf.length;
    dryOf.push(region[i]);
    dry[i] = r;
    const list = [i];
    for (let q = 0; q < list.length; q++) {
      const k = list[q];
      const x = k % W;
      const y = (k / W) | 0;
      for (const [dx, dy] of NEXT4) {
        const j = (y + dy) * W + x + dx;
        if (dry[j] >= 0 || !canStep(lv, blocked, x, y, x + dx, y + dy, false)) continue;
        dry[j] = r;
        list.push(j);
      }
    }
  }
  // 出撃できる陸の区画（城の外の、出撃エリアを含む陸）
  const dryField = new Uint8Array(dryOf.length);
  for (let k = 0; k < W * H; k++) if (dry[k] >= 0 && canDeployAt(l, k % W, (k / W) | 0)) dryField[dry[k]] = 1;
  const dryDoors = gates.map((g) => [
    ...new Set(
      NEXT4.flatMap(([dx, dy]) =>
        canStep(lv, blocked, g.x, g.y, g.x + dx, g.y + dy, false) ? [dry[(g.y + dy) * W + g.x + dx]] : [],
      ),
    ),
  ]);
  const dryHall = hall
    ? [
        ...new Set(
          aroundHall(hall)
            .filter(([x, y, nx, ny]) => canStep(lv, blocked, x, y, nx, ny, false))
            .map(([, , nx, ny]) => dry[ny * W + nx])
            .filter((d) => !edge[dryOf[d]]),
        ),
      ]
    : [];
  const outs = dryOf.flatMap((_, d) => (dryField[d] ? [d] : []));
  // 城の門へ行けない城の外：出撃口があるのに、陸と橋だけを歩いて城の門（どれかの門）に着けない城の外の陸の区画。
  // 川と堀は渡れないものとして数える
  // 出撃口だけの区画（城壁に接した出撃口など）は、そこから城域へ入れないだけなので、数えない
  const atGate = new Uint8Array(dryOf.length);
  for (const ds of dryDoors) for (const d of ds) atGate[d] = 1;
  const inZoneLand = new Uint8Array(dryOf.length);
  for (let k = 0; k < W * H; k++) if (dry[k] >= 0 && !isRingTile(k)) inZoneLand[dry[k]] = 1;
  const cutOff = new Uint8Array(W * H);
  const lost = new Set<number>();
  for (let k = 0; k < W * H; k++) {
    const d = dry[k];
    if (d < 0 || !dryField[d] || !edge[dryOf[d]] || atGate[d] || !inZoneLand[d]) continue;
    lost.add(d);
    // 盤面に塗るのは城域の中だけ（外周の出撃口には何も置けないので、塗ると直す所に見えてしまう）
    if (!isRingTile(k)) cutOff[k] = 1;
  }
  const cutOffs = lost.size;
  // 出撃できない城の外の陸は、道として通らない
  // 橋でつないだ門のあいだの橋は、城の外の区画にあっても、郭から郭へ渡る道として通る
  const spanDry = new Set(spans.map((p) => dry[p.k]));
  const ways = dryDoors.map((ds) => ds.filter((d) => !edge[dryOf[d]] || dryField[d] || spanDry.has(d)));
  // 逃げ道に使える外の門：出撃できる城の外の陸と、郭の陸の両方に面した門
  const exits = gates.flatMap((_, i) =>
    dryDoors[i].some((d) => dryField[d]) && dryDoors[i].some((d) => rDepth[dryOf[d]] > 0) ? [i] : [],
  );
  // 外の門：逃げ道に使える外の門と同じく、攻め手が陸と橋で出撃できる城の外と、本丸から門を通って行ける郭の両方に面した門。
  // 川や堀で囲んだ陸に面した門は、攻め手が必ず水を渡るので数えない（門の前をじかに川や堀にした門を止めるのと同じ理由）。
  // 橋でつないだ門は、郭どうしをつなぐ口なので、外の門に数えない
  const outer = exits.filter((i) => !spanned.has(i));
  const routesBy = (only: number[]) =>
    gateRoutes(
      dryOf.length,
      ways.map((ds, i) => (exits.includes(i) && !only.includes(i) ? [] : ds)),
      dryHall,
      outs,
      ESCAPE_ROUTES,
    );
  const routes = routesBy(exits);
  // 本丸の真ん中から見て、2つの門が ESCAPE_ANGLE 以上開いているか
  const apart = (a: PlacedBuilding, b: PlacedBuilding) => {
    if (!hall) return false;
    const cx = hall.x0 + hall.w / 2 - 0.5;
    const cy = hall.y0 + hall.h / 2 - 0.5;
    const [ax, ay, bx, by] = [a.x - cx, a.y - cy, b.x - cx, b.y - cy];
    return ax * bx + ay * by <= Math.hypot(ax, ay) * Math.hypot(bx, by) * Math.cos((ESCAPE_ANGLE * Math.PI) / 180);
  };
  // 開いた2つの外の門だけを残しても、2本の道が取れる組があるか
  const routesApart =
    routes >= ESCAPE_ROUTES &&
    exits.some((a, i) =>
      exits.slice(i + 1).some((b) => apart(gates[a], gates[b]) && routesBy([a, b]) >= ESCAPE_ROUTES),
    );
  const outerWall = l.buildings.filter(
    (b) => ON_LINE.includes(b.type) && sides(b).some((r) => field[r]) && sides(b).some((r) => rKuruwa[r] >= 0),
  ).length;
  // 堀：川から、同じ高さの堀を縦横にたどって行ける堀だけが、川につながる。門の前後の堀と、橋の両端の堀は引けない所。
  // 上限を超えた分は、川から遠い（たどる順の後の）ものから数える
  const moatOrder: number[] = [];
  const moatAstray: number[] = [];
  let moats = 0;
  // 橋の両端：橋を渡る向き（左右が陸なら東西、そうでなければ南北）の、両隣のマス。
  // 門のほかの施設や堀でふさぐと、渡れない橋になる
  const bridgeEnds = new Set<number>();
  for (let k = 0; k < W * H; k++) if (l.bridge?.[k]) for (const j of bridgeEndsOf(l, k)) bridgeEnds.add(j);
  const bridgeShut = l.buildings.filter((b) => b.type !== 'gate' && b.type !== 'hall' && bridgeEnds.has(b.y * W + b.x));
  if (l.moat) {
    const seen = new Uint8Array(W * H);
    const queue: number[] = [];
    for (let k = 0; k < W * H; k++) if (l.moat[k]) moats++;
    for (let k = 0; k < W * H; k++) {
      if (!l.water?.[k]) continue;
      seen[k] = 1;
      queue.push(k);
    }
    for (let q = 0; q < queue.length; q++) {
      const k = queue[q];
      const x = k % W;
      const y = (k / W) | 0;
      for (const [dx, dy] of NEXT4) {
        const nx = x + dx;
        const ny = y + dy;
        const j = ny * W + nx;
        if (!inB(nx, ny) || seen[j] || !l.moat[j] || heightAt(l, nx, ny) !== heightAt(l, x, y)) continue;
        seen[j] = 1;
        queue.push(j);
        moatOrder.push(j);
      }
    }
    // 前後がふさがった門の前後の堀も、引けない所として赤く出す（門の前後は陸にする）
    const shut = new Set<number>();
    for (const g of blockedGates(l, db))
      for (const [dx, dy] of NEXT4) if (inB(g.x + dx, g.y + dy)) shut.add((g.y + dy) * W + g.x + dx);
    for (let k = 0; k < W * H; k++) if (l.moat[k] && (!seen[k] || shut.has(k) || bridgeEnds.has(k))) moatAstray.push(k);
  }
  const moatCap = moatCapOf(l);
  const stray = new Set(moatAstray);
  const moatOver = moatOrder.filter((k) => !stray.has(k)).slice(Math.max(0, moatCap - stray.size));
  return {
    outside,
    tileKuruwa,
    land,
    kuruwa,
    hallOutside,
    pockets,
    cutOff,
    cutOffs,
    routes,
    routesApart,
    outerGates: outer.length,
    outerWall,
    gatesNeed: Math.max(ESCAPE_ROUTES, Math.ceil(outerWall / WALL_PER_GATE)),
    closeGates,
    closePairs,
    offLine,
    onLine,
    over,
    outsideFacilities,
    owner,
    bad: [...new Set([...bad, ...bridgeShut])],
    moats,
    moatCap,
    moatAstray,
    bridgeShut,
    moatOver: moats > moatCap ? moatOver : [],
    drawbridges: db,
  };
}

// 門 g と近すぎる門（closePairs で g と組になった門）。画面の案内の札と盤面の印で同じものを出すため
export const closePeers = (cs: CastleShape, g: PlacedBuilding): PlacedBuilding[] =>
  cs.closePairs.flatMap(([a, b]) => (a === g ? [b] : b === g ? [a] : []));
// 門 a と門 b の直線の距離の書き方（例：「12.4マス」）
export const gateGap = (a: PlacedBuilding, b: PlacedBuilding) => `${Math.hypot(a.x - b.x, a.y - b.y).toFixed(1)}マス`;
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
  if (!r.ok || !cs || tool === 'erase' || tool === 'moat' || isGeneralKind(tool) || !isFacilityType(tool)) return r;
  const b = c.buildings.find((q) => q.type === tool && q.x === x && q.y === y);
  const k = b ? cs.owner.get(b) : undefined;
  if (k === undefined) return r;
  const info = cs.kuruwa[k];
  return { ...r, kuruwa: info.name, used: info.used, points: info.points };
}

// 逃げ道と外の門の数がそろっていないときの理由。そろっていれば null
export function escapeShort(cs: CastleShape): string | null {
  if (cs.routes < ESCAPE_ROUTES)
    return `本丸から城の外への逃げ道が足りません（今は ${cs.routes} / ${ESCAPE_ROUTES} 本）。同じ門を通らずに外へ出られるよう、門を足してください`;
  if (!cs.routesApart)
    return `逃げ道の外の門が近すぎます。本丸から見て ${ESCAPE_ANGLE} 度以上開いた2か所へ、別々の門を通って出られるようにしてください`;
  if (cs.outerGates < cs.gatesNeed)
    return `城の外へ出る門が足りません（今は ${cs.outerGates} / ${cs.gatesNeed}）。城の外に面した塀 ${WALL_PER_GATE} マスにつき1つ要ります`;
  return null;
}
// 門に関わる開戦の条件がそろったか（防衛配置のパネルの、門の「必須」の印）。
// 開戦前の確かめ（notReady）が、門を置く・直すよう求める理由が1つもなければ、そろった：
// 本丸への道・門の前後・本丸が塀の中にあるか・門から入れない郭・門へ行けない城の外・逃げ道と外の門の数・門の間かく。
// 守り手が入れない施設・塀の線・郭の外の施設・広い土地・施設の点数は、門と関わらないので見ない。
// notReady は最初の理由だけを返すので、ほかの理由に隠れても印が食い違わないよう、ここでは門に関わる理由をすべて見る。
// 本丸への道は、塀だけの城では、入れない郭か門へ行けない城の外でも止まるが、notReady と同じ判定にそろえるため見る
export function gatesDone(l: Layout, shape?: CastleShape): boolean {
  if (countOf(l, 'hall') !== 1) return false;
  const cs = shape ?? castleShape(l);
  if (!cs.kuruwa.length || cs.hallOutside || cs.pockets || cs.cutOffs || escapeShort(cs) || cs.closeGates.length)
    return false;
  return hallReachable(l, cs.drawbridges) && !blockedGates(l, cs.drawbridges).length;
}
// 攻城を始められない理由。始められるなら null
// shape は castleShape(l) の結果（もう求めてあれば渡す。なければ中で求める）
export function notReady(l: Layout, shape?: CastleShape): string | null {
  if (countOf(l, 'hall') !== 1) return '本丸を置いてください';
  const db = shape?.drawbridges ?? drawbridges(l);
  if (!hallReachable(l, db))
    return '外周から本丸へ通じる道がありません（囲いに門を置くか、崖をよけてください。川と堀は、橋のほかは渡れないものとして数えます）';
  const bg = blockedGates(l, db);
  if (bg.length)
    return `前後がふさがった門があります（${bg.length}つ）。門は、縦か横の向きで、前後のマスを空けてください（川や堀にもしません）`;
  if (!hallBreachable(l, db))
    return '引き橋の門を通らずに本丸へ行く道がありません。引き橋の門（門のすぐ外に堀を引いた門）は外から壊せないので、攻め手が入れません。引き橋のない門を通って、外周から本丸へ行けるようにしてください';
  const un = unmannedFacilities(l);
  if (un.length)
    return `守り手が入れない施設があります（${BDEF[un[0].type].name}など${un.length}つ）。施設は、本丸から歩いて行ける所に面して置いてください`;
  const cs = shape ?? castleShape(l);
  if (cs.bridgeShut.length)
    return `渡れない橋があります（橋の両端に置いた施設が${cs.bridgeShut.length}か所。盤面に赤で出しています）。橋の両端には、門のほかは置かないでください`;
  if (cs.hallOutside) return '本丸が塀の中にありません。本丸を、城壁と門で囲んでください（川や堀は囲いになりません）';
  if (cs.pockets)
    return `本丸から門を通って入れない郭があります（${cs.pockets}つ）。門で本丸の側とつなぐか、その塀を外してください`;
  if (cs.cutOffs)
    return '城の門へ歩いて行けない城の外があります（盤面に赤く出しています）。川と堀は、橋のほかは渡れないものとして数えます。その側からも攻め手が城の門へ行けるよう、塀に門を足すか、城の外を切り離している塀や堀を外してください';
  if (cs.offLine.length)
    return `塀の線にない城壁・門・櫓があります（${cs.offLine.length}か所。盤面に赤で出しています）。両側が別の郭（または城の外）になるように、塀の線に置いてください`;
  if (cs.onLine.length)
    return `塀の線に置いた大筒・鼓楼・鐘楼があります（${cs.onLine.length}か所。盤面に赤で出しています）。郭の中に置いてください`;
  if (cs.outsideFacilities.length)
    return `郭の外に置いた施設があります（${cs.outsideFacilities.length}か所。盤面に赤で出しています）。施設は、郭の中か、郭を囲む塀の線に置いてください`;
  if (cs.moatAstray.length)
    return `引けない所に引いた堀があります（${cs.moatAstray.length}マス。盤面に赤で出しています）。堀は、川に同じ高さでつながる所に引き、門の前後と橋の両端は空けてください`;
  const esc = escapeShort(cs);
  if (esc) return esc;
  for (const info of cs.kuruwa) {
    const name = info.name;
    if (info.land < KURUWA_LAND)
      return `${name}の広い土地が足りません（今は ${info.land} / ${KURUWA_LAND}）。${name}を広げるか、${name}の中の施設を減らしてください`;
    if (info.used > info.points)
      return `${name}の施設が点数を超えています（${info.used} / ${info.points} 点。広い土地 ${LAND_PER_POINT} マスにつき1点）。施設を減らすか、${name}を広げてください`;
  }
  if (cs.moats > cs.moatCap)
    return cs.moatCap
      ? `堀が上限を超えています（${cs.moats} / ${cs.moatCap} マス。盤面に赤で出しています）。堀を減らしてください`
      : `この城の型では、堀は引けません（${cs.moats}マス。盤面に赤で出しています）。堀を引けるのは平城だけです`;
  // 門の間かくは、郭の形（土地）が決まってから見る
  if (cs.closeGates.length)
    return `同じ郭の外周に、近すぎる門があります（${cs.closeGates.length}つ。盤面に赤で出しています）。同じ郭の外周の門どうしは、${GATE_SPACING} マス以上離してください`;
  return null;
}
