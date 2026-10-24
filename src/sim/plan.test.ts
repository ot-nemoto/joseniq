import { describe, expect, it } from 'vitest';
import { buildPlan, entryPoints, runPlan, summaryOf, TEMPLATES } from './auto';
import { BUDGET_A, H, MAX_GENERALS, TIME_LIMIT, W } from './defs';
import {
  type Draft,
  draftCost,
  draftProblems,
  draftToPlan,
  emptyDraft,
  gateDir,
  MAX_GATES,
  parseDraft,
  previewDraft,
  putGeneralAt,
  removeGeneralFrom,
} from './plan';
import { preset } from './presets';

const north: Draft['gates'][number] = { x: 15, y: 0 };
const draft = (rows: Draft['rows'], gates = [north]): Draft => ({ version: 1, gates, rows });

describe('作戦の兵力と決まり', () => {
  it('兵は兵力を使い、武将は人数だけ数える', () => {
    const d = draft([
      { gate: 0, kind: 'inf', n: 10, t0: 0, dt: 0.5 },
      { gate: 0, kind: 'shd', n: 3, t0: 1, dt: 1 },
      { gate: 0, kind: 'brave', n: 1, t0: 2, dt: 0 },
    ]);
    expect(draftCost(d)).toEqual({ spent: 10 + 4 * 3, generals: 1 });
    expect(draftProblems(d)).toEqual([]);
  });

  it('行がない作戦は実行できない', () => {
    expect(draftProblems(emptyDraft())).toEqual(['出撃の行がありません']);
  });

  it(`兵力 ${BUDGET_A} を超えたら知らせる`, () => {
    const d = draft([{ gate: 0, kind: 'cav', n: 13, t0: 0, dt: 0 }]);
    expect(draftProblems(d)).toEqual([`兵力が 5 足りません（65 / ${BUDGET_A}）`]);
  });

  it(`武将は ${MAX_GENERALS} 人までで、同じ武将は1回だけ`, () => {
    const gens = (['brave', 'archer', 'sage', 'spear'] as const).map((kind) => ({ gate: 0, kind, n: 1, t0: 0, dt: 0 }));
    expect(draftProblems(draft(gens))).toEqual([`武将は${MAX_GENERALS}人までです（4人）`]);
    const twice = draft([
      { gate: 0, kind: 'brave', n: 1, t0: 0, dt: 0 },
      { gate: 0, kind: 'brave', n: 1, t0: 5, dt: 0 },
    ]);
    expect(draftProblems(twice)).toEqual(['上杉謙信は1回しか出撃できません']);
  });

  it('出撃口のない行と、戦いの時間を超える行を知らせる', () => {
    const d = draft([
      { gate: 1, kind: 'inf', n: 1, t0: 0, dt: 0 },
      { gate: 0, kind: 'inf', n: 3, t0: TIME_LIMIT - 1, dt: 1 },
    ]);
    expect(draftProblems(d)).toEqual([
      '歩兵の行の出撃口がありません',
      `歩兵の行が、戦いの時間（${TIME_LIMIT}秒）を超えます`,
    ]);
  });

  it('出撃口の向き', () => {
    expect(gateDir({ x: 15, y: 0 })).toBe('北');
    expect(gateDir({ x: W - 1, y: H - 1 })).toBe('南東');
    expect(gateDir({ x: 0, y: 9 })).toBe('西');
  });
});

describe('作戦を出撃の並びに直す', () => {
  it('最初の出撃を0ティックにし、間隔どおりに並べる', () => {
    const d = draft([
      { gate: 0, kind: 'inf', n: 3, t0: 2, dt: 0.5 },
      { gate: 0, kind: 'brave', n: 1, t0: 3, dt: 0 },
    ]);
    const plan = draftToPlan(d);
    expect(plan.map((p) => [p.tick, p.kind])).toEqual([
      [0, 'inf'],
      [15, 'inf'],
      [30, 'inf'],
      [30, 'brave'],
    ]);
    // 北の辺の出撃口からは、辺に沿って左右にずらして出す
    expect(plan.every((p) => p.y === 0)).toBe(true);
  });

  it('自動攻城のひな形を作戦の形にすると、ひな形と同じ出撃・同じ結果になる', () => {
    const layout = preset('basic');
    const tpl = TEMPLATES[0];
    const ep = entryPoints(layout)[2];
    const d: Draft = {
      version: 1,
      gates: [{ x: ep.e[0], y: ep.e[1] }],
      rows: tpl.steps.map((s) => ({ gate: 0, kind: s.kind, n: s.n, t0: s.t0, dt: s.dt })),
    };
    const plan = buildPlan(tpl, [ep.e]);
    expect(draftToPlan(d)).toEqual(plan);
    expect(previewDraft(layout, d)).toEqual(summaryOf(runPlan(layout, plan, TIME_LIMIT)));
  });
});

describe('武将を口に置く', () => {
  it('外周のマスに置くと口ができ、同じマスに置くと重なる', () => {
    const d = emptyDraft();
    expect(putGeneralAt(d, 'brave', 15, 0)).toEqual({ ok: true });
    expect(putGeneralAt(d, 'sage', 15, 0)).toEqual({ ok: true });
    expect(putGeneralAt(d, 'archer', 0, 9)).toEqual({ ok: true });
    expect(d.gates).toEqual([
      { x: 15, y: 0 },
      { x: 0, y: 9 },
    ]);
    expect(d.rows.map((r) => [r.kind, r.gate, r.n, r.t0])).toEqual([
      ['brave', 0, 1, 0],
      ['sage', 0, 1, 0],
      ['archer', 1, 1, 0],
    ]);
  });

  it('外周でないマスには置けない', () => {
    const d = emptyDraft();
    expect(putGeneralAt(d, 'brave', 5, 5)).toEqual({ ok: false, msg: '武将は外周の青いマスに置きます' });
    expect(d).toEqual(emptyDraft());
  });

  it(`武将は ${MAX_GENERALS} 人まで。置いた武将は別の口へ移せて、開始秒はそのまま`, () => {
    const d = emptyDraft();
    putGeneralAt(d, 'brave', 15, 0);
    putGeneralAt(d, 'archer', 15, 0);
    putGeneralAt(d, 'sage', 0, 9);
    expect(putGeneralAt(d, 'spear', 0, 9)).toEqual({ ok: false, msg: `武将は${MAX_GENERALS}人までです` });
    d.rows[2].t0 = 4;
    // 口2（0,9）にいた軍師を口1へ移すと、誰もいなくなった口2は消える
    expect(putGeneralAt(d, 'sage', 15, 0).ok).toBe(true);
    expect(d.gates).toEqual([{ x: 15, y: 0 }]);
    expect(d.rows.find((r) => r.kind === 'sage')).toEqual({ gate: 0, kind: 'sage', n: 1, t0: 4, dt: 0 });
  });

  it('外すと予定から消え、誰もいなくなった口は消えて、後ろの口の番号が詰まる', () => {
    const d = emptyDraft();
    putGeneralAt(d, 'brave', 15, 0);
    putGeneralAt(d, 'archer', 0, 9);
    putGeneralAt(d, 'sage', W - 1, 9);
    removeGeneralFrom(d, 'archer');
    expect(d.gates).toEqual([
      { x: 15, y: 0 },
      { x: W - 1, y: 9 },
    ]);
    expect(d.rows.map((r) => [r.kind, r.gate])).toEqual([
      ['brave', 0],
      ['sage', 1],
    ]);
  });

  it('開戦からの秒数のまま並べると、一番早い出撃も予定の秒数に出る', () => {
    const d = emptyDraft();
    putGeneralAt(d, 'brave', 15, 0);
    putGeneralAt(d, 'sage', 15, 0);
    d.rows[0].t0 = 5;
    d.rows[1].t0 = 2.5;
    expect(draftToPlan(d, true).map((p) => [p.tick, p.kind])).toEqual([
      [75, 'sage'],
      [150, 'brave'],
    ]);
    // ふつうの並べ方では、一番早い出撃が0ティックになる
    expect(draftToPlan(d).map((p) => p.tick)).toEqual([0, 75]);
  });
});

describe('作戦の読み込み', () => {
  it('保存した作戦はそのまま読み込める', () => {
    const d = draft([{ gate: 0, kind: 'eng', n: 4, t0: 1.5, dt: 0.3 }], [north, { x: 0, y: 2 }]);
    expect(parseDraft(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });

  it('武将の行は、数を1・間隔を0にそろえる', () => {
    const d = parseDraft(draft([{ gate: 0, kind: 'sage', n: 3, t0: 0, dt: 2 }]));
    expect(d?.rows).toEqual([{ gate: 0, kind: 'sage', n: 1, t0: 0, dt: 0 }]);
  });

  it('外周でない出撃口・重なる出撃口・多すぎる出撃口・おかしな行は読み込まない', () => {
    expect(parseDraft(draft([], [{ x: 5, y: 5 }]))).toBeNull();
    expect(parseDraft(draft([], [north, north]))).toBeNull();
    const many = Array.from({ length: MAX_GATES + 1 }, (_, i) => ({ x: i + 2, y: 0 }));
    expect(parseDraft(draft([], many))).toBeNull();
    expect(parseDraft(draft([{ gate: 1, kind: 'inf', n: 1, t0: 0, dt: 0 }]))).toBeNull();
    expect(parseDraft(draft([{ gate: 0, kind: 'inf', n: 0, t0: 0, dt: 0 }]))).toBeNull();
    expect(parseDraft(draft([{ gate: 0, kind: 'inf', n: 1, t0: -1, dt: 0 }]))).toBeNull();
    expect(parseDraft({ ...draft([]), version: 2 })).toBeNull();
  });
});
