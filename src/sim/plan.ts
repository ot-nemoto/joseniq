// ======================================================================
// 攻城配置：開戦前に決めておく出撃の予定
// 出撃口（外周のマス）ごとに「兵種・数・開始秒・間隔」の行を持つ。武将と兵を、口に重ねて置く。
// 実行するときは PlanStep[] に直し、開戦からの秒数どおりに出す。
// ======================================================================
import type { PlanStep } from './auto';
import {
  ADEF,
  type AttackerKind,
  BUDGET_A,
  DT,
  type GeneralKind,
  H,
  isAttackerKind,
  MAX_GENERALS,
  PLAN_LIMIT,
  PLAN_TICKS,
  W,
} from './defs';
import { clamp, inB, inRing } from './geometry';
import { canDeployAt, type Layout, nearestDeploy } from './layout';

export const MAX_ROW_N = BUDGET_A; // 1行で出せる数の上限（歩兵を兵力いっぱいまで）
export const MAX_ROW_DT = 10; // 1行の間隔（秒）の上限

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
// 出撃口にできるマスか：口のマスと、兵をずらして出す先（辺に沿って±2マス）が、すべて攻め手を出せるマス
// （外周の出撃エリアの平地で、川でない）。ずらした先が出せないと、その兵は出撃できずに消えてしまうため
export function canGateAt(l: Layout, x: number, y: number) {
  return isGate(x, y) && gateSpread({ x, y }).every((c) => canDeployAt(l, c.x, c.y));
}
// (x, y) にいちばん近い、出撃口にできるマス。なければ、いちばん近い攻め手を出せるマス（それもなければ null）
export function nearestGate(l: Layout, x: number, y: number, taken: (x: number, y: number) => boolean = () => false) {
  return (
    nearestDeploy(l, x, y, (px, py) => !taken(px, py) && canGateAt(l, px, py)) ??
    nearestDeploy(l, x, y, (px, py) => !taken(px, py) && canDeployAt(l, px, py))
  );
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
// 武将を外周のマスに置く。そこに口がなければ作り、あれば重ねる。予定に入っている武将なら、その口へ移す（開始秒はそのまま）
export function putGeneralAt(d: Draft, kind: GeneralKind, x: number, y: number): PutResult {
  if (!isGate(x, y)) return { ok: false, msg: '武将は外周の青いマスに置きます' };
  const cur = d.rows.find((r) => r.kind === kind);
  if (!cur && draftCost(d).generals >= MAX_GENERALS) return { ok: false, msg: `武将は${MAX_GENERALS}人までです` };
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
// 行の最後の1体が出る時刻（開始＋間隔×（数−1））は、開戦から PLAN_LIMIT 秒まで。
// 数・開始・間隔の上限は、ほかの2つの欄の今の値から決める（小数の誤差で1つ少なくならないよう、少し足して切り捨てる）
const EPS = 1e-9;
// 時間の決まりで出せる数（間隔が0なら、全員が開始の時刻に出るので、時間の上限はない）
export function rowNByTime(r: DraftRow) {
  if (r.t0 > PLAN_LIMIT + EPS) return 0;
  return r.dt > 0 ? Math.floor((PLAN_LIMIT - r.t0) / r.dt + EPS) + 1 : MAX_ROW_N;
}
// 開始（秒）の上限
export const rowT0Max = (r: DraftRow) => Math.max(0, PLAN_LIMIT - r.dt * (r.n - 1));
// 間隔（秒）の上限
export const rowDtMax = (r: DraftRow) =>
  r.n > 1 ? Math.max(0, Math.min(MAX_ROW_DT, (PLAN_LIMIT - r.t0) / (r.n - 1))) : MAX_ROW_DT;
// i 番目の行で出せる数の上限：ほかの行と合わせて予定の兵力が上限を超えず、最後の1体が PLAN_LIMIT 秒までに出る数（少なくとも1）
export function maxRowN(d: Draft, i: number) {
  const r = d.rows[i];
  if (!r) return 1;
  const cost = ADEF[r.kind].cost;
  if (ADEF[r.kind].general) return 1;
  const others = draftCost(d).spent - cost * r.n;
  const byBudget = cost ? Math.floor((BUDGET_A - others) / cost) : MAX_ROW_N;
  return Math.max(1, Math.min(MAX_ROW_N, byBudget, rowNByTime(r)));
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// 保存した予定を確かめる。形や範囲が違えば null
export function parseDraft(o: unknown): Draft | null {
  if (!isRecord(o) || o.version !== 1 || !Array.isArray(o.gates) || !Array.isArray(o.rows)) return null;
  // 口の数に上限はない。外周のマスだけで、同じマスの口は2つ持たないので、外周のマスの数までに収まる
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

// ---- 出撃を予定にまとめる ---------------------------------------------------
// 出撃したマスの口：そのマスが口ならその口。でなければ、その出撃が出るマス（口のマスと辺に沿った±2）に入る口。
// どちらもなければ新しい口を足す。口が隣り合うこともあるので、口のマスとの一致を先に見る。gates は口の一覧（書き足す）
function gateFor(gates: Gate[], x: number, y: number): Gate {
  const g =
    gates.find((q) => q.x === x && q.y === y) ?? gates.find((q) => gateSpread(q).some((c) => c.x === x && c.y === y));
  if (g) return g;
  const n = { x, y };
  gates.push(n);
  return n;
}
// ティックを秒に直す。0.0001秒まで持ち、行を出撃に展開したときのティックがずれないようにする
const sec = (ticks: number) => Math.round(ticks * DT * 10000) / 10000;
// 出撃の一覧（ティック・兵種・マス。ティックの順に並んでいること）を、予定に足す。
// 出撃は時刻の順に見て、置くときと同じ決まり（外周のマス・兵力・武将の人数と重なり）に合うものだけを受け入れる。
// 兵力が足りなくなったら、それより遅い出撃が落ちる。受け入れた出撃は、同じ口・同じ兵種で間隔がそろって続いた所を
// 「数・開始・間隔」の1行にまとめる（ティックの丸めで1ずれるのは許す）。戻り値は、受け入れなかった出撃の数
export function addDeploys(d: Draft, deploys: readonly PlanStep[]) {
  // 口は、今の予定の口に、受け入れた出撃の口だけを足していく一覧の上で決める。予定にはマスの位置で置く
  // （置くたびに行のない口が消えて番号がずれるので、番号は使わない）
  const gates = d.gates.map((g) => ({ ...g }));
  const generals = new Set(d.rows.filter((r) => ADEF[r.kind].general).map((r) => r.kind));
  let spent = draftCost(d).spent;
  let dropped = 0;
  const groups = new Map<string, { at: Gate; kind: AttackerKind; ticks: number[] }>();
  for (const p of deploys) {
    const a = ADEF[p.kind];
    // 開戦から PLAN_LIMIT 秒より後の出撃（前の形の出撃記録など）も、予定には入れない
    const ok =
      p.tick > PLAN_TICKS || !isGate(p.x, p.y)
        ? false
        : a.general
          ? !generals.has(p.kind) && generals.size < MAX_GENERALS
          : spent + a.cost <= BUDGET_A;
    if (!ok) {
      dropped++;
      continue;
    }
    if (a.general) generals.add(p.kind);
    else spent += a.cost;
    const at = gateFor(gates, p.x, p.y);
    const key = `${at.x},${at.y}|${p.kind}`;
    const g = groups.get(key) ?? { at, kind: p.kind, ticks: [] };
    g.ticks.push(p.tick);
    groups.set(key, g);
  }
  for (const { at, kind, ticks } of groups.values()) {
    if (ADEF[kind].general) {
      const r = putGeneralAt(d, kind as GeneralKind, at.x, at.y);
      if (r.ok) r.row.t0 = sec(ticks[0]);
      continue;
    }
    // 間隔がそろって続く出撃を1つの並びにまとめる
    let run: number[] = [];
    const flush = () => {
      if (!run.length) return;
      const r = addTroopAt(d, kind, at.x, at.y);
      if (r.ok) {
        r.row.t0 = sec(run[0]);
        r.row.dt = run.length > 1 ? sec((run[run.length - 1] - run[0]) / (run.length - 1)) : 0.5;
        r.row.n = Math.min(run.length, maxRowN(d, d.rows.indexOf(r.row)));
      }
      run = [];
    };
    for (const t of ticks) {
      if (run.length >= 2) {
        const step = (run[run.length - 1] - run[0]) / (run.length - 1);
        if (Math.abs(t - run[run.length - 1] - step) > 1) flush();
      }
      run.push(t);
    }
    flush();
  }
  pruneGates(d);
  return dropped;
}
// 読み込んだ予定を、置くときと同じ決まり（武将は3人で同じ武将は1人・兵力は上限まで）で置き直す
export function sanitizeDraft(d: Draft): Draft {
  const out = emptyDraft();
  for (const r of d.rows) {
    const g = d.gates[r.gate];
    const res = ADEF[r.kind].general
      ? putGeneralAt(out, r.kind as GeneralKind, g.x, g.y)
      : addTroopAt(out, r.kind, g.x, g.y);
    if (!res.ok) continue;
    // 武将の行は数1・間隔0のままなので、そのまま写してよい（数は兵力と時間の上限までに収める）
    res.row.t0 = r.t0;
    res.row.dt = r.dt;
    // 開始が PLAN_LIMIT 秒より後の行は、1体も出せないので外す（前の決まりで作った予定）
    if (r.t0 > PLAN_LIMIT) {
      removeRow(out, out.rows.indexOf(res.row));
      continue;
    }
    res.row.n = Math.min(r.n, maxRowN(out, out.rows.indexOf(res.row)));
  }
  return out;
}
