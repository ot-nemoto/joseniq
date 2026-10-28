import { describe, expect, it } from 'vitest';
import { deployDue, runPlan } from './auto';
import { createBattle } from './battle';
import { BUDGET_A, H, MAX_GENERALS, W } from './defs';
import { emptyLayout } from './layout';
import {
  addDeploys,
  addTroopAt,
  type Draft,
  draftCost,
  draftToPlan,
  emptyDraft,
  gateDir,
  gateSpread,
  maxRowN,
  parseDraft,
  putGeneralAt,
  removeGeneralFrom,
  removeRow,
  sanitizeDraft,
} from './plan';
import { basicSiege, preset } from './presets';
import { parseDeploys } from './record';

const north: Draft['gates'][number] = { x: 15, y: 0 };
const draft = (rows: Draft['rows'], gates = [north]): Draft => ({ version: 1, gates, rows });

describe('予定の兵力と口', () => {
  it('兵は兵力を使い、武将は人数だけ数える', () => {
    const d = draft([
      { gate: 0, kind: 'inf', n: 10, t0: 0, dt: 0.5 },
      { gate: 0, kind: 'shd', n: 3, t0: 1, dt: 1 },
      { gate: 0, kind: 'brave', n: 1, t0: 2, dt: 0 },
    ]);
    expect(draftCost(d)).toEqual({ spent: 10 + 4 * 3, generals: 1 });
  });

  it('出撃口の向き', () => {
    expect(gateDir({ x: 15, y: 0 })).toBe('北');
    expect(gateDir({ x: W - 1, y: H - 1 })).toBe('南東');
    expect(gateDir({ x: 0, y: 9 })).toBe('西');
  });

  it('兵が出るマスは、口のマスと、辺に沿って左右（上下）に2マスずつ。盤面の端では重ねない', () => {
    expect(gateSpread({ x: 15, y: 0 })).toEqual([
      { x: 15, y: 0 },
      { x: 16, y: 0 },
      { x: 14, y: 0 },
      { x: 17, y: 0 },
      { x: 13, y: 0 },
    ]);
    expect(gateSpread({ x: 0, y: 0 })).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
    ]);
  });
});

describe('予定を出撃の並びに直す', () => {
  it('開戦からの秒数のまま、間隔どおりに並べる', () => {
    const d = draft([
      { gate: 0, kind: 'inf', n: 3, t0: 2, dt: 0.5 },
      { gate: 0, kind: 'brave', n: 1, t0: 3, dt: 0 },
    ]);
    expect(draftToPlan(d).map((p) => [p.tick, p.kind])).toEqual([
      [60, 'inf'],
      [75, 'inf'],
      [90, 'inf'],
      [90, 'brave'],
    ]);
  });

  it('同じ口から続けて出すときは、1体目を口のマスから出し、そのあと辺に沿ってずらす', () => {
    const d = draft([{ gate: 0, kind: 'inf', n: 6, t0: 0, dt: 0 }], [{ x: 0, y: 10 }]);
    expect(draftToPlan(d).map((p) => [p.x, p.y])).toEqual([
      [0, 10],
      [0, 11],
      [0, 9],
      [0, 12],
      [0, 8],
      [0, 10],
    ]);
  });

  it('口が何か所あっても、どの口からも正しいマスに出る', () => {
    const gates = [
      { x: 15, y: 0 },
      { x: 0, y: 9 },
      { x: W - 1, y: 9 },
      { x: 15, y: H - 1 },
      { x: 3, y: 0 },
      { x: 0, y: 25 },
    ];
    const d = draft(
      gates.map((_, gate) => ({ gate, kind: 'inf', n: 1, t0: 0, dt: 0 })),
      gates,
    );
    expect(draftToPlan(d).map((p) => ({ x: p.x, y: p.y }))).toEqual(gates);
  });
});

describe('予定の出撃', () => {
  it('時刻になった予定だけを出し、出せなかったものを返す', () => {
    const s = createBattle(emptyLayout());
    s.started = true;
    const auto = {
      plan: [
        { tick: 0, kind: 'brave' as const, x: 15, y: 0 },
        { tick: 0, kind: 'brave' as const, x: 16, y: 0 },
        { tick: 30, kind: 'sage' as const, x: 15, y: 0 },
      ],
      i: 0,
    };
    expect(deployDue(s, auto)).toEqual([{ kind: 'brave', msg: '上杉謙信はすでに出撃しています' }]);
    expect(auto.i).toBe(2);
    expect(s.attackers.map((a) => a.kind)).toEqual(['brave']);
  });
});

describe('武将を口に置く', () => {
  it('外周のマスに置くと口ができ、同じマスに置くと重なる', () => {
    const d = emptyDraft();
    expect(putGeneralAt(d, 'brave', 15, 0).ok).toBe(true);
    expect(putGeneralAt(d, 'sage', 15, 0).ok).toBe(true);
    expect(putGeneralAt(d, 'archer', 0, 9).ok).toBe(true);
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

  it('置いた武将は、開始秒どおりに口のマスから出る（一番早い出撃も0秒にずらさない）', () => {
    const d = emptyDraft();
    putGeneralAt(d, 'brave', 0, 10);
    putGeneralAt(d, 'sage', 0, 10);
    putGeneralAt(d, 'archer', W - 1, 20);
    d.rows[0].t0 = 5;
    d.rows[1].t0 = 2.5;
    d.rows[2].t0 = 4;
    expect(draftToPlan(d)).toEqual([
      { tick: 75, kind: 'sage', x: 0, y: 11 },
      { tick: 120, kind: 'archer', x: W - 1, y: 20 },
      { tick: 150, kind: 'brave', x: 0, y: 10 },
    ]);
  });
});

describe('兵を口に置く', () => {
  it('外周のマスに置くと、1体・開始0秒・間隔0.5秒の行が足される。武将と同じ口に重ねられる', () => {
    const d = emptyDraft();
    putGeneralAt(d, 'brave', 15, 0);
    expect(addTroopAt(d, 'shd', 15, 0).ok).toBe(true);
    expect(addTroopAt(d, 'eng', 0, 9).ok).toBe(true);
    expect(d.gates).toEqual([
      { x: 15, y: 0 },
      { x: 0, y: 9 },
    ]);
    expect(d.rows.slice(1)).toEqual([
      { gate: 0, kind: 'shd', n: 1, t0: 0, dt: 0.5 },
      { gate: 1, kind: 'eng', n: 1, t0: 0, dt: 0.5 },
    ]);
  });

  it('同じ兵種を同じ口に何行でも置ける（波に分けて出す）', () => {
    const d = emptyDraft();
    addTroopAt(d, 'shd', 15, 0);
    addTroopAt(d, 'shd', 15, 0);
    d.rows[1].t0 = 10;
    expect(d.gates).toHaveLength(1);
    expect(d.rows.map((r) => [r.kind, r.t0])).toEqual([
      ['shd', 0],
      ['shd', 10],
    ]);
  });

  it('外周でないマスや武将は、兵としては置けない', () => {
    const d = emptyDraft();
    expect(addTroopAt(d, 'inf', 5, 5)).toEqual({ ok: false, msg: '兵は外周の青いマスに置きます' });
    expect(addTroopAt(d, 'brave', 15, 0).ok).toBe(false);
    expect(d).toEqual(emptyDraft());
  });

  it(`予定の兵力が ${BUDGET_A} を超えるなら置けない。1行の数の上限は、ほかの行と合わせて ${BUDGET_A} まで`, () => {
    const d = emptyDraft();
    addTroopAt(d, 'cav', 15, 0); // 5
    d.rows[0].n = 11; // 55
    addTroopAt(d, 'inf', 15, 0); // 56
    expect(addTroopAt(d, 'ram', 15, 0)).toEqual({ ok: false, msg: `兵力が足りません（予定 56 / ${BUDGET_A}）` });
    expect(maxRowN(d, 1)).toBe(5); // 歩兵はあと5体まで
    expect(maxRowN(d, 0)).toBe(11); // 騎兵は今の11体まで
    putGeneralAt(d, 'brave', 15, 0);
    expect(maxRowN(d, 2)).toBe(1); // 武将は1人
  });

  it('口の数に上限はない。武将を別のマスへ動かすと、誰もいなくなった元の口は消える', () => {
    const d = emptyDraft();
    const xs = [3, 6, 9, 12, 15, 18];
    putGeneralAt(d, 'brave', xs[0], 0);
    for (const x of xs.slice(1)) expect(addTroopAt(d, 'inf', x, 0).ok).toBe(true);
    expect(d.gates).toHaveLength(xs.length);
    expect(putGeneralAt(d, 'sage', 24, 0).ok).toBe(true);
    expect(d.gates).toHaveLength(xs.length + 1);
    // 今ある口には重ねられる
    expect(addTroopAt(d, 'inf', xs[1], 0).ok).toBe(true);
    expect(d.gates).toHaveLength(xs.length + 1);
    // 上杉謙信は口1に1人だけなので、動かすと元の口が消える
    expect(putGeneralAt(d, 'brave', 27, 0).ok).toBe(true);
    expect(d.gates).toHaveLength(xs.length + 1);
    expect(d.gates.some((g) => g.x === xs[0])).toBe(false);
    expect(d.gates.some((g) => g.x === 27)).toBe(true);
  });

  it('置いたら、その行を返す', () => {
    const d = emptyDraft();
    const r = addTroopAt(d, 'arc', 15, 0);
    expect(r.ok && r.row).toBe(d.rows[0]);
    const g = putGeneralAt(d, 'sage', 15, 0);
    expect(g.ok && g.row).toBe(d.rows[1]);
  });

  it('範囲の外の行は外せず、数の上限は1', () => {
    const d = emptyDraft();
    addTroopAt(d, 'inf', 15, 0);
    removeRow(d, -1);
    removeRow(d, 5);
    expect(d.rows).toHaveLength(1);
    expect(maxRowN(d, -1)).toBe(1);
  });

  it('行を外すと、誰もいなくなった口は消えて、後ろの口の番号が詰まる', () => {
    const d = emptyDraft();
    addTroopAt(d, 'inf', 15, 0);
    addTroopAt(d, 'arc', 0, 9);
    addTroopAt(d, 'eng', W - 1, 9);
    removeRow(d, 1);
    expect(d.gates).toEqual([
      { x: 15, y: 0 },
      { x: W - 1, y: 9 },
    ]);
    expect(d.rows.map((r) => [r.kind, r.gate])).toEqual([
      ['inf', 0],
      ['eng', 1],
    ]);
  });
});

describe('攻城配置の編成例', () => {
  // 「基本」の城は防衛側が勝つことを目指して組むので、落とせるかどうかは確かめない（戦いが最後まで走ることだけ見る）
  it('基本は、決まりに合った予定で、基本の城と最後まで戦える', () => {
    const d = basicSiege();
    expect(parseDraft(JSON.parse(JSON.stringify(d)))).toEqual(d);
    expect(draftCost(d)).toEqual({ spent: BUDGET_A, generals: MAX_GENERALS });
    const s = runPlan(preset('flat'), draftToPlan(d));
    expect(s.over).toBe(true);
  });
});

describe('出撃を予定にまとめる', () => {
  it('同じ口・同じ兵種で間隔がそろった出撃は1行にまとめ、そろわない所で行を分ける', () => {
    const d = emptyDraft();
    addDeploys(d, [
      { tick: 0, kind: 'inf', x: 15, y: 0 },
      { tick: 30, kind: 'inf', x: 16, y: 0 },
      { tick: 61, kind: 'inf', x: 14, y: 0 }, // 1ティックのずれは許す
      { tick: 300, kind: 'inf', x: 15, y: 0 }, // 間が空いたので別の行
      { tick: 45, kind: 'brave', x: 17, y: 0 },
      { tick: 90, kind: 'arc', x: 0, y: 9 }, // 別の辺は別の口
    ]);
    expect(d.gates).toEqual([
      { x: 15, y: 0 },
      { x: 0, y: 9 },
    ]);
    expect(d.rows).toEqual([
      { gate: 0, kind: 'inf', n: 3, t0: 0, dt: 1.0167 },
      { gate: 0, kind: 'inf', n: 1, t0: 10, dt: 0.5 },
      { gate: 0, kind: 'brave', n: 1, t0: 1.5, dt: 0 },
      { gate: 1, kind: 'arc', n: 1, t0: 3, dt: 0.5 },
    ]);
  });

  it('予定から出た出撃をまとめ直すと、同じ口・同じ数・同じ間隔に戻る', () => {
    const src = emptyDraft();
    addTroopAt(src, 'shd', W - 1, 20);
    src.rows[0].n = 5;
    src.rows[0].dt = 0.8;
    putGeneralAt(src, 'sage', W - 1, 20);
    const d = emptyDraft();
    addDeploys(d, draftToPlan(src));
    expect(d.gates).toEqual(src.gates);
    expect(d.rows.map((r) => [r.kind, r.n, r.t0, r.dt])).toEqual([
      ['shd', 5, 0, 0.8],
      ['sage', 1, 0, 0],
    ]);
  });

  it('口から兵が出るマス（±2）の外の出撃には、新しい口を作る。中なら同じ口にまとめる。兵力の上限を超える分は足さない', () => {
    const d = emptyDraft();
    addDeploys(
      d,
      [3, 9, 15, 21, 27].map((x, i) => ({ tick: i, kind: 'inf' as const, x, y: 0 })),
    );
    expect(d.gates).toHaveLength(5);
    expect(d.rows.reduce((n, r) => n + r.n, 0)).toBe(5);
    const near = emptyDraft();
    addDeploys(
      near,
      [15, 16, 14, 17, 13].map((x, i) => ({ tick: i, kind: 'inf' as const, x, y: 0 })),
    );
    expect(near.gates).toEqual([{ x: 15, y: 0 }]);
    // 3マス離れたら、新しい口を作る
    const apart = emptyDraft();
    addDeploys(apart, [
      { tick: 0, kind: 'inf', x: 15, y: 0 },
      { tick: 1, kind: 'inf', x: 18, y: 0 },
    ]);
    expect(apart.gates).toEqual([
      { x: 15, y: 0 },
      { x: 18, y: 0 },
    ]);
  });

  it('隣り合う口があるとき、口のマスでの出撃は、先に並んでいる隣の口ではなく、その口にまとめる', () => {
    const d = emptyDraft();
    addTroopAt(d, 'inf', 15, 0);
    addTroopAt(d, 'inf', 17, 0);
    addDeploys(d, [{ tick: 0, kind: 'arc', x: 17, y: 0 }]);
    expect(d.gates).toEqual([
      { x: 15, y: 0 },
      { x: 17, y: 0 },
    ]);
    const arc = d.rows.find((r) => r.kind === 'arc');
    expect(arc && d.gates[arc.gate]).toEqual({ x: 17, y: 0 });
    // 口のマスでない所（16）は、±2に入る口のうち先に並んでいる口にまとめる
    addDeploys(d, [{ tick: 0, kind: 'cav', x: 16, y: 0 }]);
    const cav = d.rows.find((r) => r.kind === 'cav');
    expect(cav && d.gates[cav.gate]).toEqual({ x: 15, y: 0 });
    const full = emptyDraft();
    addDeploys(
      full,
      Array.from({ length: 13 }, (_, i) => ({ tick: i * 30, kind: 'cav' as const, x: 15, y: 0 })),
    );
    expect(draftCost(full).spent).toBe(BUDGET_A);
  });

  it('時刻の順に見て、決まりに合わない出撃（兵力が足りない・外周でない・同じ武将）を落とし、その数を返す', () => {
    const d = emptyDraft();
    const deploys = [
      ...Array.from({ length: 11 }, (_, i) => ({ tick: i, kind: 'cav' as const, x: 15, y: 0 })), // 55
      { tick: 20, kind: 'shd' as const, x: 0, y: 9 }, // 59：入る
      { tick: 25, kind: 'ram' as const, x: 0, y: 9 }, // 64：入らない
      { tick: 30, kind: 'inf' as const, x: 0, y: 9 }, // 60：入る（遅くても兵力が足りれば入る）
      { tick: 40, kind: 'inf' as const, x: 5, y: 5 }, // 外周でない
      { tick: 50, kind: 'brave' as const, x: 15, y: 0 },
      { tick: 60, kind: 'brave' as const, x: 15, y: 0 }, // 同じ武将は1人
    ];
    expect(addDeploys(d, deploys)).toBe(3);
    expect(d.rows.map((r) => [r.kind, r.n])).toEqual([
      ['cav', 11],
      ['shd', 1],
      ['inf', 1],
      ['brave', 1],
    ]);
  });

  it('受け入れなかった出撃の口は作らない', () => {
    const d = emptyDraft();
    for (const x of [3, 9, 15]) addTroopAt(d, 'inf', x, 0);
    d.rows[0].n = 58; // 予定の兵力を使い切る（58 + 1 + 1 = 60）
    // 兵力が足りずに入らない兵の口は作らず、武将の口だけを足す
    expect(
      addDeploys(d, [
        { tick: 0, kind: 'inf', x: 0, y: 20 },
        { tick: 1, kind: 'sage', x: W - 1, y: 20 },
      ]),
    ).toBe(1);
    expect(d.gates).toHaveLength(4);
    expect(d.rows.find((r) => r.kind === 'sage')?.gate).toBe(3);
  });

  it('間隔の短い出撃をまとめても、展開したときのティックがずれない', () => {
    const ticks = Array.from({ length: 21 }, (_, i) => i * 7);
    const d = emptyDraft();
    addDeploys(
      d,
      ticks.map((tick) => ({ tick, kind: 'inf' as const, x: 15, y: 0 })),
    );
    expect(d.rows).toHaveLength(1);
    expect(draftToPlan(d).map((p) => p.tick)).toEqual(ticks);
  });

  it('読み込んだ予定は、置くときと同じ決まりで置き直す', () => {
    const d: Draft = {
      version: 1,
      gates: [{ x: 15, y: 0 }],
      rows: [
        { gate: 0, kind: 'brave', n: 1, t0: 1, dt: 0 },
        { gate: 0, kind: 'brave', n: 1, t0: 2, dt: 0 }, // 同じ武将は1人
        { gate: 0, kind: 'cav', n: 13, t0: 0, dt: 1 }, // 兵力の上限まで（12）
      ],
    };
    expect(sanitizeDraft(d).rows).toEqual([
      { gate: 0, kind: 'brave', n: 1, t0: 2, dt: 0 },
      { gate: 0, kind: 'cav', n: 12, t0: 0, dt: 1 },
    ]);
  });

  it('前の形の出撃記録から、出撃の一覧を読む', () => {
    const deploys = [
      { tick: 0, kind: 'inf', x: 15, y: 0 },
      { tick: 3, kind: 'brave', x: 15, y: 0 },
    ];
    expect(parseDeploys({ version: 1, deploys })).toEqual(deploys);
    expect(parseDeploys({ deploys: [] })).toBeNull();
    expect(parseDeploys({ deploys: [{ tick: 0, kind: 'xx', x: 0, y: 0 }] })).toBeNull();
    expect(parseDeploys({ gates: [], rows: [] })).toBeNull();
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

  it('外周でない出撃口・重なる出撃口・おかしな行は読み込まない。口の数に上限はない', () => {
    expect(parseDraft(draft([], [{ x: 5, y: 5 }]))).toBeNull();
    expect(parseDraft(draft([], [north, north]))).toBeNull();
    const many = Array.from({ length: 10 }, (_, i) => ({ x: i * 3 + 1, y: 0 }));
    expect(parseDraft(draft([], many))?.gates).toEqual(many);
    expect(parseDraft(draft([{ gate: 1, kind: 'inf', n: 1, t0: 0, dt: 0 }]))).toBeNull();
    expect(parseDraft(draft([{ gate: 0, kind: 'inf', n: 0, t0: 0, dt: 0 }]))).toBeNull();
    expect(parseDraft(draft([{ gate: 0, kind: 'inf', n: 1, t0: -1, dt: 0 }]))).toBeNull();
    expect(parseDraft({ ...draft([]), version: 2 })).toBeNull();
  });
});
