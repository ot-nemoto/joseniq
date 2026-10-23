import {
  BDEF,
  type BuildingType,
  GDEF,
  type GeneralKind,
  HALL,
  isBuildingType,
  isGeneralKind,
  LIMITS,
  MOAT_BAND,
  type PlaceTool,
  type Tool,
  W,
  ZW,
} from './defs';
import { inB, inMoatBand, inZone } from './geometry';

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

function occAt(l: Layout, x: number, y: number): { k: 'b' | 'g'; i: number } | null {
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
    if (o.k === 'b') {
      if (l.buildings[o.i].type === 'hall') return { ok: false, msg: '本丸は中央に固定されています' };
      l.buildings.splice(o.i, 1);
    } else l.generals.splice(o.i, 1);
    return { ok: true };
  }
  if (!inZone(x, y)) return { ok: false, msg: `配置できるのは城域（${ZW}×${ZW}）の中だけです` };
  if (occAt(l, x, y)) return { ok: false, msg: tool === 'wall' ? '' : '他の配置と重なります' };
  if (tool === 'moat' && !inMoatBand(x, y))
    return { ok: false, msg: `堀は城域の外側${MOAT_BAND}マス以内にだけ置けます` };
  const nm = isGeneralKind(tool) ? GDEF[tool].name : BDEF[tool].name;
  if (countOf(l, tool) >= LIMITS[tool]) return { ok: false, msg: `${nm}は最大${LIMITS[tool]}までです` };
  if (isGeneralKind(tool)) l.generals.push({ kind: tool, x, y });
  else l.buildings.push({ type: tool, x, y });
  return { ok: true };
}
export const check = (l: Layout, tool: Tool, x: number, y: number) => place(cloneLayout(l), tool, x, y);

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
  return l;
}
