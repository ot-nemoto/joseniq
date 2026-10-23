import { describe, expect, it } from 'vitest';
import { buildPlan, entryPoints, runPlan, TEMPLATES } from './auto';
import { type Battle, createBattle, deploy, hallOf } from './battle';
import { ADEF, BUDGET_A, GENERAL_ORDER, MAX_GENERALS } from './defs';
import { preset } from './presets';

// 戦闘の結果をまとめる（勝敗・終わった時点・本丸の体力・損耗など）
const outcome = (s: Battle) => ({
  result: s.result,
  tick: s.tick,
  endT: s.endT,
  hallHp: hallOf(s).hp,
  stats: s.stats,
});

describe('出撃の制限', () => {
  it(`武将は全体で ${MAX_GENERALS} 人まで、同じ武将は1人まで`, () => {
    const s = createBattle(preset('basic'));
    expect(deploy(s, GENERAL_ORDER[0], 0, 10)).toEqual({ ok: true });
    expect(deploy(s, GENERAL_ORDER[0], 0, 11).ok).toBe(false);
    for (let i = 1; i < MAX_GENERALS; i++) expect(deploy(s, GENERAL_ORDER[i], 0, 10 + i).ok).toBe(true);
    expect(deploy(s, GENERAL_ORDER[MAX_GENERALS], 0, 20)).toEqual({
      ok: false,
      msg: `武将は${MAX_GENERALS}人までです`,
    });
  });

  it(`兵力は ${BUDGET_A} までしか使えない`, () => {
    const s = createBattle(preset('basic'));
    let n = 0;
    while (deploy(s, 'inf', 0, 10).ok) n++;
    expect(n * ADEF.inf.cost).toBeLessThanOrEqual(BUDGET_A);
    expect(s.budgetA).toBeLessThan(ADEF.inf.cost);
    expect(s.stats.spent).toBe(BUDGET_A - s.budgetA);
    expect(deploy(s, 'inf', 0, 10)).toEqual({ ok: false, msg: '兵力が足りません' });
  });

  it('出撃できるのは外周の青いエリアだけ', () => {
    const s = createBattle(preset('basic'));
    expect(deploy(s, 'inf', 5, 5).ok).toBe(false);
    expect(deploy(s, 'inf', 0, 5).ok).toBe(true);
  });
});

describe('戦闘の計算', () => {
  it('同じ配置・同じ出撃なら、何度計算しても結果が同じ（決定論）', () => {
    const l = preset('basic');
    const eps = entryPoints(l);
    for (const tpl of TEMPLATES) {
      const plan = buildPlan(tpl, [eps[0].e, eps[1].e]);
      expect(outcome(runPlan(l, plan))).toEqual(outcome(runPlan(l, plan)));
    }
  });

  // 編成例5種×出撃口8か所の結果を記録しておき、変わったら気づけるようにする。
  // 数値を調整して結果が変わるのが正しいときは、`npx vitest run -u` で記録を更新する
  it('「基本」の城に対する編成例の結果が変わらない', () => {
    const l = preset('basic');
    const eps = entryPoints(l);
    const OPPOSITE = [1, 0, 3, 2, 7, 6, 5, 4];
    const rows = TEMPLATES.map((tpl) => {
      const cells = eps.map((ep, i) => {
        const s = runPlan(l, buildPlan(tpl, tpl.pair ? [ep.e, eps[OPPOSITE[i]].e] : [ep.e]));
        const hall = hallOf(s);
        const r = s.result === 'win' ? `勝${s.endT.toFixed(1)}s` : `${s.result}:本丸${hall.hp.toFixed(1)}`;
        return `${ep.name}=${r}/損耗${s.stats.aLostCost}`;
      });
      return `${tpl.name}: ${cells.join(' ')}`;
    });
    expect(rows).toMatchSnapshot();
  }, 60_000);
});
