import { describe, expect, it } from 'vitest';
import { buildPlan, entryPoints, OPPOSITE, runPlan, TEMPLATES, type Template } from './auto';
import { type Battle, createBattle, deploy, hallOf, step } from './battle';
import { ADEF, BUDGET_A, GENERAL_ORDER, type GeneralKind, HALL, HALL_MARGIN, MAX_GENERALS } from './defs';
import { emptyLayout, type Layout, moveBuilding } from './layout';
import { preset } from './presets';

// 戦闘の結果をまとめる（勝敗・終わった時点・本丸の体力・損耗など）
const outcome = (s: Battle) => ({
  result: s.result,
  tick: s.tick,
  endT: s.endT,
  hallHp: hallOf(s).hp,
  stats: s.stats,
});

// 本番の作戦探し（auto.ts の planAttack）と同じ出撃口の選び方：二方向の作戦なら反対側も使う
const entriesOf = (tpl: Template, eps: ReturnType<typeof entryPoints>, i: number) =>
  tpl.pair ? [eps[i].e, eps[OPPOSITE[i]].e] : [eps[i].e];

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

// 編成例の勝敗や時間は、パラメータを調整するたびに変わるのでテストにはしない。
// 調整の目安は `npm run balance` で表にして見る
describe('戦闘の計算', () => {
  it('同じ配置・同じ出撃なら、何度計算しても結果が同じ（決定論）', () => {
    const l = preset('basic');
    const eps = entryPoints(l);
    // 編成例ごとに、辺の中央と角の近くの出撃口を1つずつ試す
    TEMPLATES.forEach((tpl, ti) => {
      for (const i of [ti % 4, 4 + (ti % 4)]) {
        const plan = buildPlan(tpl, entriesOf(tpl, eps, i));
        expect(outcome(runPlan(l, plan))).toEqual(outcome(runPlan(l, plan)));
      }
    });
  }, 60_000);
});

// 本丸だけの城に守りの武将を1人置き、すぐ外から攻めの武将を1人出す
const duel = (atk: GeneralKind, def: GeneralKind) => {
  const s = createBattle({
    buildings: preset('basic').buildings.filter((b) => b.type === 'hall'),
    generals: [{ kind: def, x: 4, y: 15 }],
  });
  expect(deploy(s, atk, 0, 15).ok).toBe(true);
  return { s, a: s.attackers[0], d: s.defenders[0] };
};

describe('攻撃の記録（画面の動きのため）', () => {
  // 通常の攻撃（上杉謙信）と火計（真田昌幸）の、攻め・守りの4通り
  it.each([
    ['通常の攻撃', 'brave'],
    ['火計', 'sage'],
  ] as const)('%s：攻め・守りとも、攻撃した時刻と狙った位置が記録される', (_, kind) => {
    const { s, a, d } = duel(kind, kind);
    while (!s.over && s.t < 60 && (a.atkT < 0 || d.atkT < 0)) step(s);
    for (const u of [a, d]) {
      expect(u.atkT).toBeGreaterThan(0);
      expect(u.atkT).toBeLessThanOrEqual(s.t);
      expect(u.atkX !== 0 || u.atkY !== 0).toBe(true);
    }
  });

  it('忍びに足止めされても、攻撃したことにはならない', () => {
    const { s, a } = duel('brave', 'ninja');
    let stunned = false;
    while (!s.over && s.t < 30 && !stunned) {
      // 謙信は攻撃の間隔が残った状態にして、自分からは攻撃させない
      a.cd = 0.2;
      step(s);
      stunned = a.cd > 0.2;
    }
    expect(stunned).toBe(true);
    expect(a.atkT).toBe(-1);
  });
});

describe('門と城壁', () => {
  // 本丸のまわり（4マス離れた所）を城壁で囲う。gate を渡すと、北の辺の中ほどを門にする
  function walled(gate: boolean): Layout {
    const l = emptyLayout();
    const a = HALL.x - 4;
    const b = HALL.x + HALL.w + 3;
    for (let i = a; i <= b; i++)
      for (const [x, y] of [
        [i, a],
        [i, b],
        [a, i],
        [b, i],
      ])
        if (!l.buildings.some((q) => q.x === x && q.y === y))
          l.buildings.push({ type: gate && x === HALL.x && y === a ? 'gate' : 'wall', x, y });
    return l;
  }
  const walls = (s: Battle) => s.buildings.filter((b) => b.type === 'wall');

  it('城壁は、工兵が叩いても、軍師の火計を受けても壊れない', () => {
    // 門のない囲いは配置の決まりで戦えないが、計算の上でも壁が壊れないことを見る（道がないので、短い時間で切る）
    const s = createBattle(walled(false));
    s.timeLimit = 20;
    for (let i = 0; i < 8; i++) deploy(s, 'eng', 0, 12 + i);
    deploy(s, 'sage', 0, 16);
    while (!s.over) step(s);
    expect(s.result).not.toBe('win');
    // 火計は射程が長いので、壁越しに本丸へ届くことはある（壁は壊れない）
    expect(walls(s).every((w) => w.hp === w.maxHp)).toBe(true);
  });

  it('攻め手は門へ向かい、門を壊して通る', () => {
    const s = createBattle(walled(true));
    s.timeLimit = 90;
    for (let i = 0; i < 3; i++) deploy(s, 'ram', HALL.x - 1 + i, 0);
    while (!s.over) step(s);
    expect(s.stats.gateDown).toBe(1);
    expect(walls(s).every((w) => w.hp === w.maxHp)).toBe(true);
    expect(hallOf(s).hp).toBeLessThan(hallOf(s).maxHp);
  });

  it('壁の並びに置いた櫓は、壊れても石垣の台が残り、通れない', () => {
    const l = walled(true);
    // 南の辺の中ほどの壁を、櫓（弓）にする
    const y = HALL.x + HALL.w + 3;
    const i = l.buildings.findIndex((b) => b.x === HALL.x && b.y === y);
    l.buildings[i] = { type: 'tbow', x: HALL.x, y };
    const s = createBattle(l);
    s.timeLimit = 120;
    // 工兵は櫓を狙うので、南から出して櫓を壊させる
    for (let k = 0; k < 6; k++) deploy(s, 'eng', HALL.x - 2 + k, 31);
    while (!s.over && !s.stats.tDown) step(s);
    expect(s.stats.tDown).toBe(1);
    const tile = y * 32 + HALL.x;
    expect(s.grid[tile]).not.toBe(0);
    // そのあとも、櫓の跡のマスに攻め手は入らない
    let entered = false;
    while (!s.over) {
      step(s);
      if (s.attackers.some((u) => u.hp > 0 && Math.floor(u.x) === HALL.x && Math.floor(u.y) === y)) entered = true;
    }
    expect(entered).toBe(false);
  });

  it('大筒は壁の並びに組み込むものではないので、壊れたら通れる', () => {
    const l = walled(true);
    l.buildings.push({ type: 'cata', x: HALL.x, y: 30 });
    const s = createBattle(l);
    s.timeLimit = 60;
    for (let k = 0; k < 6; k++) deploy(s, 'eng', HALL.x - 2 + k, 31);
    while (!s.over && !s.stats.tDown) step(s);
    expect(s.stats.tDown).toBe(1);
    expect(s.grid[30 * 32 + HALL.x]).toBe(0);
  });

  it('壁で閉じた区画の中の櫓は道がないので、工兵は狙いを変えて、ほかの櫓を壊しに行く', () => {
    const l = emptyLayout();
    // 南の端の近くに、壁で閉じた3×3の区画を作り、真ん中に櫓（弓）を置く
    for (let x = 3; x <= 5; x++)
      for (let y = 26; y <= 28; y++) l.buildings.push({ type: x === 4 && y === 27 ? 'tbow' : 'wall', x, y });
    // 区画の外、少し離れた所にもう1つ櫓を置く
    l.buildings.push({ type: 'tbow', x: 12, y: 27 });
    const s = createBattle(l);
    s.timeLimit = 60;
    for (let k = 0; k < 4; k++) deploy(s, 'eng', 3 + k, 31);
    while (!s.over && !s.stats.tDown) step(s);
    const [inner, outer] = [s.buildings.find((b) => b.x0 === 4 && b.y0 === 27), s.buildings.find((b) => b.x0 === 12)];
    expect(outer?.hp).toBe(0);
    expect(inner?.hp).toBe(inner?.maxHp);
  });

  it('守将は門を通り抜けて、囲いの外の敵を討つ', () => {
    const l = walled(true);
    l.generals.push({ kind: 'brave', x: HALL.x, y: HALL.y - 2 });
    const s = createBattle(l);
    s.timeLimit = 30;
    // 門の北、囲いの外に歩兵を出す（歩兵は門を叩きに来る）
    deploy(s, 'inf', HALL.x, 0);
    while (!s.over) step(s);
    expect(s.stats.aLost).toBe(1);
    expect(s.stats.gateDown).toBe(0);
  });
});

describe('本丸を動かす', () => {
  it('本丸を動かすと、攻め手は新しい位置の本丸へ向かう', () => {
    const l = emptyLayout();
    expect(moveBuilding(l, 0, HALL_MARGIN, HALL_MARGIN).ok).toBe(true);
    const s = createBattle(l);
    s.timeLimit = 60;
    // 衝車は本丸だけを狙う。北西の角の近くへ動かした本丸を、東の端から攻める
    for (let i = 0; i < 3; i++) deploy(s, 'ram', 31, 10 + i);
    while (!s.over) step(s);
    const hall = hallOf(s);
    expect([hall.x0, hall.y0]).toEqual([HALL_MARGIN, HALL_MARGIN]);
    expect(hall.hp).toBeLessThan(hall.maxHp);
  });
});
