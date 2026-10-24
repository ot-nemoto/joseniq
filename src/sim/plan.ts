// ======================================================================
// 攻城配置：開戦前に決めておく出撃の予定
// 出撃口（外周のマス）ごとに「兵種・数・開始秒・間隔」の行を持つ。今は武将だけを、口に重ねて置く。
// 実行するときは PlanStep[] に直し、開戦からの秒数どおりに出す。
// ======================================================================
import { buildPlan, type PlanStep, type RunSummary, runPlan, summaryOf } from './auto';
import {
  ADEF,
  type AttackerKind,
  BUDGET_A,
  type GeneralKind,
  H,
  isAttackerKind,
  MAX_GENERALS,
  TIME_LIMIT,
  W,
} from './defs';
import { clamp, inB, inRing } from './geometry';
import type { Layout } from './layout';

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

// 出撃口から兵が出るマス。buildPlan と同じく、辺に沿って左右（上下）に2マスずつずらして出す
export function gateSpread(g: Gate): Gate[] {
  const vert = g.x === 0 || g.x === W - 1;
  const out: Gate[] = [];
  for (let o = -2; o <= 2; o++) {
    const c = vert ? { x: g.x, y: clamp(g.y + o, 0, H - 1) } : { x: clamp(g.x + o, 0, W - 1), y: g.y };
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

// 作戦の決まりに合わない所を、画面に出す文で返す（空なら実行できる）
export function draftProblems(d: Draft): string[] {
  const out: string[] = [];
  if (!d.rows.length) out.push('出撃の行がありません');
  const { spent, generals } = draftCost(d);
  if (spent > BUDGET_A) out.push(`兵力が ${spent - BUDGET_A} 足りません（${spent} / ${BUDGET_A}）`);
  if (generals > MAX_GENERALS) out.push(`武将は${MAX_GENERALS}人までです（${generals}人）`);
  const seen = new Set<AttackerKind>();
  for (const r of d.rows) {
    const a = ADEF[r.kind];
    if (a.general && seen.has(r.kind)) out.push(`${a.busho}は1回しか出撃できません`);
    seen.add(r.kind);
    if (!d.gates[r.gate]) out.push(`${a.busho ?? a.name}の行の出撃口がありません`);
    if (r.t0 + r.dt * (r.n - 1) > TIME_LIMIT)
      out.push(`${a.busho ?? a.name}の行が、戦いの時間（${TIME_LIMIT}秒）を超えます`);
  }
  return out;
}

// 実行する出撃の並び。ふつうは最初の出撃を0ティックとする（自動攻城と同じく、開戦は最初の出撃のときなので）。
// keepStart なら、開戦からの秒数のまま並べる（「開戦」ボタンで始めるとき）
export function draftToPlan(d: Draft, keepStart = false): PlanStep[] {
  if (!d.rows.length || !d.gates.length) return [];
  const plan = buildPlan(
    { name: '', steps: d.rows.map((r) => ({ kind: r.kind, n: r.n, t0: r.t0, dt: r.dt, g: r.gate })) },
    d.gates.map((g) => [g.x, g.y] as const),
  );
  if (!keepStart) return plan;
  // buildPlan は一番早い出撃を0ティックにずらしているので、その分を戻す
  const first = Math.min(...d.rows.map((r) => Math.round(r.t0 * 30)));
  return plan.map((p) => ({ ...p, tick: p.tick + first }));
}

// ---- 武将を口に置く ---------------------------------------------------------
// 行のない口を消し、行の口の番号を詰める
function pruneGates(d: Draft) {
  const used = d.gates.map((_, i) => d.rows.some((r) => r.gate === i));
  const to = used.map((u, i) => (u ? used.slice(0, i).filter(Boolean).length : -1));
  d.gates = d.gates.filter((_, i) => used[i]);
  for (const r of d.rows) r.gate = to[r.gate];
}
// 武将を外周のマスに置く。そこに口がなければ作り、あれば重ねる。予定に入っている武将なら、その口へ移す（開始秒はそのまま）
export function putGeneralAt(
  d: Draft,
  kind: GeneralKind,
  x: number,
  y: number,
): { ok: true } | { ok: false; msg: string } {
  if (!isGate(x, y)) return { ok: false, msg: '武将は外周の青いマスに置きます' };
  const cur = d.rows.find((r) => r.kind === kind);
  if (!cur && draftCost(d).generals >= MAX_GENERALS) return { ok: false, msg: `武将は${MAX_GENERALS}人までです` };
  let gi = d.gates.findIndex((g) => g.x === x && g.y === y);
  if (gi < 0) {
    d.gates.push({ x, y });
    gi = d.gates.length - 1;
  }
  if (cur) cur.gate = gi;
  else d.rows.push({ gate: gi, kind, n: 1, t0: 0, dt: 0 });
  pruneGates(d);
  return { ok: true };
}
// 武将を予定から外す。誰もいなくなった口は消す
export function removeGeneralFrom(d: Draft, kind: GeneralKind) {
  d.rows = d.rows.filter((r) => r.kind !== kind);
  pruneGates(d);
}

// 今の配置に対して作戦を先読みする
export const previewDraft = (layout: Layout, d: Draft): RunSummary =>
  summaryOf(runPlan(layout, draftToPlan(d), TIME_LIMIT));

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// 保存・読み込みした作戦を確かめる。形や範囲が違えば null（兵力の超過などは draftProblems で知らせる）
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
