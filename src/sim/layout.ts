import {
  BDEF,
  type BuildingType,
  GDEF,
  type GeneralKind,
  H,
  HALL,
  isBuildingType,
  isGeneralKind,
  LIMITS,
  MAX_GENERALS,
  MOAT_BAND,
  type PlaceTool,
  type Tool,
  W,
  ZW,
} from './defs';
import { inB, inMoatBand, inRing, inZone } from './geometry';

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
}
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
export const emptyLayout = (): Layout => ({ buildings: [{ type: 'hall', x: HALL.x, y: HALL.y }], generals: [] });

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
    if (l.buildings[o.i].type === 'hall') return { ok: false, msg: '本丸は中央に固定されています' };
    l.buildings.splice(o.i, 1);
    return { ok: true };
  }
  if (!inZone(x, y)) return { ok: false, msg: `配置できるのは城域（${ZW}×${ZW}）の中だけです` };
  if (occAt(l, x, y)) return { ok: false, msg: tool === 'wall' ? '' : '他の配置と重なります' };
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
// 置いた施設（i番目）をドラッグで動かす。決まりは putGeneral と同じで、本丸は動かせない
export function moveBuilding(l: Layout, i: number, x: number, y: number): PlaceResult {
  const b = l.buildings[i];
  if (!b) return { ok: false, msg: '' };
  const type = b.type;
  if (type === 'hall') return { ok: false, msg: '本丸は中央に固定されています' };
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
      if (pb.x !== HALL.x || pb.y !== HALL.y) return null;
      halls++;
    }
    l.buildings.push(pb);
  }
  if (halls !== 1) return null;
  for (const g of o.generals as unknown[]) {
    if (!isRecord(g) || typeof g.kind !== 'string' || !isGeneralKind(g.kind) || !isInt(g.x) || !isInt(g.y)) return null;
    const k = g.y * W + g.x;
    if (!inZone(g.x, g.y) || occ.has(k)) return null;
    occ.add(k);
    l.generals.push({ kind: g.kind, x: g.x, y: g.y });
  }
  for (const t of Object.keys(LIMITS) as PlaceTool[]) if (countOf(l, t) > LIMITS[t]) return null;
  if (l.generals.length > MAX_GENERALS) return null;
  return l;
}

// ---- 攻城を始められるか -------------------------------------------------------
// 門はちょうどこの数を置く
export const GATES_REQUIRED = LIMITS.gate;
// 攻め手が通れる地面か（施設のないマス・堀・拒馬と、壊せば通れる門・大筒）。城壁と櫓・鼓楼は通れない
const passable = (t: BuildingType) => !!BDEF[t].terrain || !!BDEF[t].breakThrough;
// 外周から本丸まで、通れる地面だけを通って行けるか。斜めには進まない形で確かめる（甘く見積もらないため）
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
      if (inRing(x, y) && !blocked[y * W + x]) {
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
      if (!inB(nx, ny) || seen[k] || blocked[k]) continue;
      seen[k] = 1;
      queue.push(k);
    }
  }
  return false;
}
// 攻城を始められない理由。始められるなら null
export function notReady(l: Layout): string | null {
  const gates = countOf(l, 'gate');
  if (gates !== GATES_REQUIRED) return `門を${GATES_REQUIRED}つ置いてください（今は ${gates} / ${GATES_REQUIRED}）`;
  if (!hallReachable(l)) return '外周から本丸へ通じる道がありません（囲いに門を置いてください）';
  return null;
}
