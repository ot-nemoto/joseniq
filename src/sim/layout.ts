import {
  BDEF,
  type BuildingType,
  GDEF,
  type GeneralKind,
  H,
  HALL,
  HALL_MARGIN,
  isBuildingType,
  isGeneralKind,
  LIMITS,
  MAX_GENERALS,
  MAX_HEIGHT,
  MOAT_BAND,
  type PlaceTool,
  type Tool,
  W,
  ZW,
} from './defs';
import { inB, inMoatBand, inZone, ringOrder } from './geometry';
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
  if (!inB(x, y)) return { ok: false, msg: '' };
  if (tool === 'erase') {
    const o = occAt(l, x, y);
    if (!o) return { ok: false, msg: '' };
    // 武将はパネルのスイッチで外す（壁などを消しながら、うっかり武将まで消さないように）
    if (o.k === 'g') return { ok: false, msg: '' };
    l.buildings.splice(o.i, 1);
    return { ok: true };
  }
  if (tool === 'hall') {
    if (countOf(l, 'hall') >= LIMITS.hall) return { ok: false, msg: '本丸は1つだけです（つかんで動かせます）' };
    return placeHall(l, x, y);
  }
  if (!inZone(x, y)) return { ok: false, msg: `配置できるのは城域（${ZW}×${ZW}）の中だけです` };
  // なぞって置ける城壁と堀は、重なったマスを黙って飛ばす（なぞるたびにマスごとの知らせが出ないように）
  if (occAt(l, x, y)) return { ok: false, msg: tool === 'wall' || tool === 'moat' ? '' : '他の配置と重なります' };
  if (isWater(l, x, y)) return { ok: false, msg: '川の上には置けません' };
  if (tool === 'moat' && !inMoatBand(x, y))
    return { ok: false, msg: `堀は城域の外側${MOAT_BAND}マス以内にだけ置けます` };
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
    if (!isRecord(b) || typeof b.type !== 'string' || !isBuildingType(b.type) || !isInt(b.x) || !isInt(b.y))
      return null;
    const pb: PlacedBuilding = { type: b.type, x: b.x, y: b.y };
    const f = fpOf(pb);
    for (let yy = f.y0; yy < f.y0 + f.h; yy++)
      for (let xx = f.x0; xx < f.x0 + f.w; xx++) {
        const k = yy * W + xx;
        if (!inZone(xx, yy) || occ.has(k) || (pb.type === 'moat' && !inMoatBand(xx, yy))) return null;
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
// 門はちょうどこの数を置く
export const GATES_REQUIRED = LIMITS.gate;
// 攻め手が通れる地面か（施設のないマス・堀・拒馬と、壊せば通れる門・大筒）。城壁と櫓・鼓楼は通れない
const passable = (t: BuildingType) => !!BDEF[t].terrain || !!BDEF[t].breakThrough;
// 外周から本丸まで、通れる地面だけを通って行けるか（崖は通れない）。斜めには進まない形で確かめる（甘く見積もらないため）
export function hallReachable(l: Layout): boolean {
  const blocked = new Uint8Array(W * H);
  let hall: Footprint | null = null;
  for (const b of l.buildings) {
    const f = fpOf(b);
    if (b.type === 'hall') hall = f;
    if (passable(b.type)) continue;
    for (let y = f.y0; y < f.y0 + f.h; y++) for (let x = f.x0; x < f.x0 + f.w; x++) blocked[y * W + x] = 1;
  }
  if (!hall) return false;
  const h = hall;
  const nextToHall = (x: number, y: number) =>
    (x >= h.x0 - 1 && x <= h.x0 + h.w && y >= h.y0 && y < h.y0 + h.h) ||
    (y >= h.y0 - 1 && y <= h.y0 + h.h && x >= h.x0 && x < h.x0 + h.w);
  const seen = new Uint8Array(W * H);
  const queue: number[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (canDeployAt(l, x, y) && !blocked[y * W + x]) {
        seen[y * W + x] = 1;
        queue.push(y * W + x);
      }
  for (let q = 0; q < queue.length; q++) {
    const x = queue[q] % W;
    const y = (queue[q] / W) | 0;
    if (nextToHall(x, y)) return true;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      const k = ny * W + nx;
      if (!inB(nx, ny) || seen[k] || blocked[k] || isRiver(l, nx, ny)) continue;
      if (isCliff(heightAt(l, x, y), heightAt(l, nx, ny))) continue; // 崖は通れない
      seen[k] = 1;
      queue.push(k);
    }
  }
  return false;
}
// 攻城を始められない理由。始められるなら null
export function notReady(l: Layout): string | null {
  if (countOf(l, 'hall') !== 1) return '本丸を置いてください';
  const gates = countOf(l, 'gate');
  if (gates !== GATES_REQUIRED) return `門を${GATES_REQUIRED}つ置いてください（今は ${gates} / ${GATES_REQUIRED}）`;
  if (!hallReachable(l)) return '外周から本丸へ通じる道がありません（囲いに門を置くか、崖をよけてください）';
  return null;
}
