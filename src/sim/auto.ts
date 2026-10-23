// ======================================================================
// 自動攻城
// 戦闘は決定的なので、候補の作戦を先に走らせて結果を比べ、最良の案を選ぶ。
// ======================================================================
import { type Battle, type BattleResult, createBattle, deploy, hallOf, step } from './battle';
import { type AttackerKind, H, HALL, TIME_LIMIT, W } from './defs';
import { clamp } from './geometry';
import type { Layout } from './layout';

export interface PlanStep {
  tick: number;
  kind: AttackerKind;
  x: number;
  y: number;
}
export interface AutoState {
  plan: PlanStep[];
  i: number;
  // true なら、作戦を出し切って全滅しても終わらせない（手動の戦いと同じ終わり方）
  waitAfterPlan?: boolean;
}
export interface RunSummary {
  result: BattleResult | null;
  endT: number;
  hallRatio: number;
  spent: number;
  lost: number;
}
interface TemplateStep {
  kind: AttackerKind;
  n: number;
  t0: number;
  dt: number;
  g?: number;
}
export interface Template {
  name: string;
  pair?: boolean;
  steps: TemplateStep[];
}
type Entry = readonly [number, number];
export interface Progress {
  done: number;
  total: number;
}
export interface AttackPlan {
  plan: PlanStep[];
  summary: RunSummary;
  score: number;
  label: string;
}

export function rngOf(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 作戦(plan)を1ティックずつ実行する。UIの自動攻城と先読みで同じ関数を使う。
export function autoStep(s: Battle, auto: AutoState) {
  while (auto.i < auto.plan.length && auto.plan[auto.i].tick <= s.tick) {
    const p = auto.plan[auto.i++];
    deploy(s, p.kind, p.x, p.y);
  }
  if (!auto.waitAfterPlan && auto.i >= auto.plan.length && s.started && !s.attackers.length && !s.over) {
    s.over = true;
    s.result = 'wipe';
    s.endT = s.t;
    return;
  }
  step(s);
}
export function runPlan(layout: Layout, plan: PlanStep[], maxT?: number) {
  const s = createBattle(layout);
  s.timeLimit = maxT || TIME_LIMIT;
  const auto: AutoState = { plan, i: 0 };
  for (let g = 0; g < 100000 && !s.over; g++) autoStep(s, auto);
  return s;
}
function scoreRun(s: Battle) {
  const st = s.stats;
  const hall = hallOf(s);
  if (s.result === 'win') return 100000 - s.endT * 10 - st.aLostCost * 150;
  return (1 - hall.hp / hall.maxHp) * 20000 + st.tDown * 1200 + st.dKilled * 900;
}
function summaryOf(s: Battle): RunSummary {
  const hall = hallOf(s);
  return {
    result: s.result,
    endT: s.endT,
    hallRatio: hall.hp / hall.maxHp,
    spent: s.stats.spent,
    lost: s.stats.aLostCost,
  };
}

// 将を1人出す手順
const general = (kind: AttackerKind, t0: number): TemplateStep => ({ kind, n: 1, t0, dt: 0 });

// 攻撃テンプレート。n体をt0秒から間隔dtで、g番目の出撃口から出す。
// 「基本」の城に兵力60で勝てた作戦をもとにしている。出す順番で出撃位置のずれ方が変わるので、手順の並びも結果に効く。
export const TEMPLATES: readonly Template[] = [
  {
    // 盾兵で守将の攻撃を受け、弓兵の足止めのあいだに将が討つ
    name: '盾と弓兵',
    steps: [
      general('sage', 0),
      general('archer', 3),
      { kind: 'shd', n: 7, t0: 7.4, dt: 0.8 },
      { kind: 'eng', n: 5, t0: 10.2, dt: 0.3 },
      { kind: 'arc', n: 8, t0: 15.7, dt: 0.25 },
      general('brave', 17.3),
      { kind: 'inf', n: 1, t0: 8.3, dt: 0 },
      { kind: 'ram', n: 1, t0: 15.6, dt: 0 },
    ],
  },
  {
    // 工兵と盾兵を交互に出して長い列を作り、斥候で目を引く
    name: '盾と工兵の列',
    steps: [
      general('sage', 3.9),
      { kind: 'eng', n: 9, t0: 0, dt: 1.25 },
      { kind: 'shd', n: 9, t0: 1, dt: 1.25 },
      general('archer', 0),
      { kind: 'scout', n: 3, t0: 6, dt: 0.3 },
      general('brave', 3.9),
      { kind: 'arc', n: 1, t0: 0.7, dt: 0 },
      { kind: 'inf', n: 1, t0: 24.9, dt: 0 },
    ],
  },
  {
    // 将が守将を引きつけたあと、盾兵に守らせた衝車で本丸を突く
    name: '衝車の突撃',
    steps: [
      general('archer', 0),
      { kind: 'inf', n: 3, t0: 0, dt: 0.05 },
      general('sage', 6),
      { kind: 'arc', n: 1, t0: 6.8, dt: 0 },
      general('brave', 12),
      { kind: 'shd', n: 5, t0: 22, dt: 1 },
      { kind: 'ram', n: 6, t0: 23, dt: 0.1 },
      { kind: 'scout', n: 4, t0: 6.4, dt: 0.4 },
    ],
  },
  {
    // 工兵を大勢出して城壁と櫓を崩し、将の道を開く
    name: '工兵で道を開く',
    steps: [
      general('sage', 0),
      { kind: 'shd', n: 7, t0: 3.3, dt: 0.4 },
      { kind: 'eng', n: 15, t0: 1, dt: 0.55 },
      general('brave', 5.2),
      { kind: 'arc', n: 1, t0: 10.1, dt: 0 },
      general('archer', 11.6),
    ],
  },
  {
    // 3将の後ろから騎兵を出し、守将を討つ
    name: '騎兵で将を狩る',
    steps: [
      general('sage', 0.3),
      general('brave', 1),
      general('archer', 4),
      { kind: 'shd', n: 6, t0: 1.8, dt: 0.5 },
      { kind: 'eng', n: 8, t0: 2, dt: 0.15 },
      { kind: 'cav', n: 3, t0: 8.3, dt: 0.5 },
      { kind: 'arc', n: 1, t0: 13, dt: 0 },
      { kind: 'scout', n: 2, t0: 0.7, dt: 0.4 },
    ],
  },
];

export function buildPlan(tpl: Template, entries: readonly Entry[]): PlanStep[] {
  const out: PlanStep[] = [];
  const cnt = [0, 0];
  for (const st of tpl.steps) {
    const g = st.g || 0;
    const e = entries[g] || entries[0];
    const vert = e[0] === 0 || e[0] === W - 1;
    for (let k = 0; k < st.n; k++) {
      const off = (cnt[g]++ % 5) - 2;
      out.push({
        tick: Math.round((st.t0 + st.dt * k) * 30),
        kind: st.kind,
        x: vert ? e[0] : clamp(e[0] + off, 0, W - 1),
        y: vert ? clamp(e[1] + off, 0, H - 1) : e[1],
      });
    }
  }
  out.sort((a, b) => a.tick - b.tick);
  const t0 = out[0].tick;
  for (const p of out) p.tick -= t0;
  return out;
}
// 出撃口は8か所：辺の中央（本丸の正面）4つと、角の近く4つ
export interface EntryPoint {
  name: string;
  e: Entry;
}
export function entryPoints(layout: Layout): EntryPoint[] {
  const { x: hx, y: hy } = layout.buildings.find((b) => b.type === 'hall') ?? HALL;
  return [
    { name: '西', e: [0, hy] },
    { name: '東', e: [W - 1, hy] },
    { name: '北', e: [hx, 0] },
    { name: '南', e: [hx, H - 1] },
    // 辺の中央は堀の土橋の正面になりやすいので、角の近くも候補にする
    { name: '北西', e: [0, 2] },
    { name: '北東', e: [W - 1, 2] },
    { name: '南西', e: [0, H - 3] },
    { name: '南東', e: [W - 1, H - 3] },
  ];
}
// 二方向の作戦で、陽動に使う反対側の出撃口
const OPPOSITE = [1, 0, 3, 2, 7, 6, 5, 4];

export interface PlanFilter {
  tpl?: number; // TEMPLATES の番号
  entry?: number; // entryPoints の番号
}

// 自動攻城：候補の作戦を先読みして最良のものを返す（ジェネレータ。yieldで進捗を返す）
// filter でテンプレートや出撃口を絞ると、その範囲で最良のものを選ぶ。
export function* planAttack(layout: Layout, filter: PlanFilter = {}): Generator<Progress, AttackPlan, void> {
  const eps = entryPoints(layout);
  const cands: { tpl: Template; eps: EntryPoint[] }[] = [];
  TEMPLATES.forEach((tpl, ti) => {
    if (filter.tpl !== undefined && filter.tpl !== ti) return;
    eps.forEach((ep, ei) => {
      if (filter.entry !== undefined && filter.entry !== ei) return;
      cands.push({ tpl, eps: tpl.pair ? [ep, eps[OPPOSITE[ei]]] : [ep] });
    });
  });
  const total = cands.length;
  let done = 0;
  let best: { c: (typeof cands)[number]; plan: PlanStep[]; score: number; summary: RunSummary } | null = null;
  for (const c of cands) {
    const plan = buildPlan(
      c.tpl,
      c.eps.map((x) => x.e),
    );
    const s = runPlan(layout, plan, TIME_LIMIT);
    const r = { c, plan, score: scoreRun(s), summary: summaryOf(s) };
    if (!best || r.score > best.score) best = r;
    done++;
    yield { done, total };
  }
  yield { done: total, total };
  if (!best) throw new Error('作戦の候補がありません');
  return {
    plan: best.plan,
    summary: best.summary,
    score: best.score,
    label: `${best.c.tpl.name}・${best.c.eps.map((x) => x.name).join('と')}から`,
  };
}
