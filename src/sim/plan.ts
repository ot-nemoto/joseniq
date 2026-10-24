// ======================================================================
// 攻城配置：開戦前に決めておく出撃の予定
// 出撃口（外周のマス）ごとに「兵種・数・開始秒・間隔」の行を持つ。武将と兵を、口に重ねて置く。
// 実行するときは PlanStep[] に直し、開戦からの秒数どおりに出す。
// ======================================================================
import type { PlanStep } from './auto';
import { ADEF, type AttackerKind, BUDGET_A, type GeneralKind, H, isAttackerKind, MAX_GENERALS, W } from './defs';
import { clamp, inB, inRing } from './geometry';

export const MAX_GATES = 4; // 出撃口は4か所まで
export const MAX_ROW_N = BUDGET_A; // 1行で出せる数の上限（歩兵を兵力いっぱいまで）

// 出撃口：外周のマス。座標は本丸の位置によらず、盤面の絶対の座標で持つ
export interface Gate {
  x: number;
  y: number;
}
// 出撃の行：gate 番目の出撃口から、kind を n 体、t0 秒から dt 秒おきに出す。武将は n=1・dt=0
export interface DraftRow {
  gate: number;
  kind: AttackerKind;
  n: number;
  t0: number;
  dt: number;
}
export interface Draft {
  version: 1;
  gates: Gate[];
  rows: DraftRow[];
}

export const emptyDraft = (): Draft => ({ version: 1, gates: [], rows: [] });
export const isGate = (x: number, y: number) => inB(x, y) && inRing(x, y);
// 出撃口の向き（北・南東など）
export function gateDir(g: Gate) {
  const ns = g.y === 0 ? '北' : g.y === H - 1 ? '南' : '';
  const ew = g.x === 0 ? '西' : g.x === W - 1 ? '東' : '';
  return ns + ew;
}

// 同じ口から続けて出すときのずらし方。1体目は口のマスから、そのあと辺に沿って左右（上下）へ2マスまでずらす
const SPREAD = [0, 1, -1, 2, -2] as const;
// 口から辺に沿って o マスずらしたマス（左右の辺の口なら上下にずらす）
function along(g: Gate, o: number): Gate {
  const vert = g.x === 0 || g.x === W - 1;
  return vert ? { x: g.x, y: clamp(g.y + o, 0, H - 1) } : { x: clamp(g.x + o, 0, W - 1), y: g.y };
}
// 口から兵が出るマス（盤面に薄く塗る）
export function gateSpread(g: Gate): Gate[] {
  const out: Gate[] = [];
  for (const o of SPREAD) {
    const c = along(g, o);
    if (!out.some((q) => q.x === c.x && q.y === c.y)) out.push(c);
  }
  return out;
}

// 使う兵力と武将の人数
export function draftCost(d: Draft) {
  let spent = 0;
  let generals = 0;
  for (const r of d.rows) {
    if (ADEF[r.kind].general) generals++;
    else spent += ADEF[r.kind].cost * r.n;
  }
  return { spent, generals };
}

// 実行する出撃の並び。開戦からの秒数のまま、ティックの順に並べる（同じティックなら行の順）
export function draftToPlan(d: Draft): PlanStep[] {
  const out: PlanStep[] = [];
  const cnt = d.gates.map(() => 0);
  for (const r of d.rows) {
    const g = d.gates[r.gate];
    if (!g) continue;
    for (let k = 0; k < r.n; k++) {
      const c = along(g, SPREAD[cnt[r.gate]++ % SPREAD.length]);
      out.push({ tick: Math.round((r.t0 + r.dt * k) * 30), kind: r.kind, x: c.x, y: c.y });
    }
  }
  return out.sort((a, b) => a.tick - b.tick);
}

// ---- 武将と兵を口に置く -----------------------------------------------------
// 行のない口を消し、行の口の番号を詰める
function pruneGates(d: Draft) {
  const used = d.gates.map((_, i) => d.rows.some((r) => r.gate === i));
  const to = used.map((u, i) => (u ? used.slice(0, i).filter(Boolean).length : -1));
  d.gates = d.gates.filter((_, i) => used[i]);
  for (const r of d.rows) r.gate = to[r.gate];
}
// 置いた結果：置けたら、その行
export type PutResult = { ok: true; row: DraftRow } | { ok: false; msg: string };
const GATES_FULL = `出撃口は${MAX_GATES}か所までです`;
// 新しい口が要るのに、口がもう上限まであるか。free は、置いたあとに空いて消える口（動かす武将の元の口）の数
const gatesFull = (d: Draft, x: number, y: number, free = 0) =>
  !d.gates.some((g) => g.x === x && g.y === y) && d.gates.length - free >= MAX_GATES;
// 武将を外周のマスに置く。そこに口がなければ作り、あれば重ねる。予定に入っている武将なら、その口へ移す（開始秒はそのまま）
export function putGeneralAt(d: Draft, kind: GeneralKind, x: number, y: number): PutResult {
  if (!isGate(x, y)) return { ok: false, msg: '武将は外周の青いマスに置きます' };
  const cur = d.rows.find((r) => r.kind === kind);
  if (!cur && draftCost(d).generals >= MAX_GENERALS) return { ok: false, msg: `武将は${MAX_GENERALS}人までです` };
  // 口に1人だけいた武将を動かすなら、元の口は消えるので、その分は数えない
  const alone = !!cur && d.rows.filter((r) => r.gate === cur.gate).length === 1;
  if (gatesFull(d, x, y, alone ? 1 : 0)) return { ok: false, msg: GATES_FULL };
  const gi = gateAt(d, x, y);
  const row = cur ?? { gate: gi, kind, n: 1, t0: 0, dt: 0 };
  if (cur) cur.gate = gi;
  else d.rows.push(row);
  pruneGates(d);
  return { ok: true, row };
}
// 武将を予定から外す。誰もいなくなった口は消す
export function removeGeneralFrom(d: Draft, kind: GeneralKind) {
  d.rows = d.rows.filter((r) => r.kind !== kind);
  pruneGates(d);
}
// 口の番号。なければ作る
function gateAt(d: Draft, x: number, y: number) {
  const gi = d.gates.findIndex((g) => g.x === x && g.y === y);
  if (gi >= 0) return gi;
  d.gates.push({ x, y });
  return d.gates.length - 1;
}
// 兵を外周のマスに置く：1体・開始0秒・間隔0.5秒の行を足す（数や秒は、あとで口のリストで変える）。
// 同じ兵種を同じ口に何行でも置ける（波に分けて出すため）。予定の兵力が上限を超えるなら置けない
export function addTroopAt(d: Draft, kind: AttackerKind, x: number, y: number): PutResult {
  if (ADEF[kind].general) return { ok: false, msg: '' };
  if (!isGate(x, y)) return { ok: false, msg: '兵は外周の青いマスに置きます' };
  const { spent } = draftCost(d);
  if (spent + ADEF[kind].cost > BUDGET_A) return { ok: false, msg: `兵力が足りません（予定 ${spent} / ${BUDGET_A}）` };
  if (gatesFull(d, x, y)) return { ok: false, msg: GATES_FULL };
  const row = { gate: gateAt(d, x, y), kind, n: 1, t0: 0, dt: 0.5 };
  d.rows.push(row);
  return { ok: true, row };
}
// 行を外す。誰もいなくなった口は消す。i が範囲の外なら何もしない
export function removeRow(d: Draft, i: number) {
  if (!d.rows[i]) return;
  d.rows.splice(i, 1);
  pruneGates(d);
}
// i 番目の行で出せる数の上限：ほかの行と合わせて、予定の兵力が上限を超えない数（少なくとも1）
export function maxRowN(d: Draft, i: number) {
  const r = d.rows[i];
  if (!r) return 1;
  const cost = ADEF[r.kind].cost;
  if (ADEF[r.kind].general || !cost) return ADEF[r.kind].general ? 1 : MAX_ROW_N;
  const others = draftCost(d).spent - cost * r.n;
  return Math.max(1, Math.min(MAX_ROW_N, Math.floor((BUDGET_A - others) / cost)));
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// 保存した予定を確かめる。形や範囲が違えば null
export function parseDraft(o: unknown): Draft | null {
  if (!isRecord(o) || o.version !== 1 || !Array.isArray(o.gates) || !Array.isArray(o.rows)) return null;
  if (o.gates.length > MAX_GATES) return null;
  const gates: Gate[] = [];
  for (const g of o.gates as unknown[]) {
    if (!isRecord(g) || !isInt(g.x) || !isInt(g.y) || !isGate(g.x, g.y)) return null;
    if (gates.some((q) => q.x === g.x && q.y === g.y)) return null;
    gates.push({ x: g.x, y: g.y });
  }
  const rows: DraftRow[] = [];
  for (const r of o.rows as unknown[]) {
    if (!isRecord(r) || typeof r.kind !== 'string' || !isAttackerKind(r.kind)) return null;
    if (!isInt(r.gate) || r.gate < 0 || r.gate >= gates.length) return null;
    if (!isInt(r.n) || r.n < 1 || r.n > MAX_ROW_N || !isNum(r.t0) || r.t0 < 0 || !isNum(r.dt) || r.dt < 0) return null;
    const gen = ADEF[r.kind].general;
    rows.push({ gate: r.gate, kind: r.kind, n: gen ? 1 : r.n, t0: r.t0, dt: gen ? 0 : r.dt });
  }
  return { version: 1, gates, rows };
}
