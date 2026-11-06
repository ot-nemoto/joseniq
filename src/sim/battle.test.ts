import { describe, expect, it } from 'vitest';
import { autoStep, buildPlan, deployDue, entryPoints, OPPOSITE, runPlan, TEMPLATES, type Template } from './auto';
import { type Battle, canDeploy, createBattle, deploy, hallOf, rangeAt, step } from './battle';
import {
  ADEF,
  BDEF,
  BUDGET_A,
  DT,
  GDEF,
  GENERAL_ORDER,
  type GeneralKind,
  H,
  HALL,
  HALL_MARGIN,
  MAX_GENERALS,
  PLAN_LIMIT,
  PLAN_TICKS,
  SHIELD_RADIUS,
  SHOT_SPEED,
  W,
  WARD_RADIUS,
} from './defs';
import { emptyLayout, type Layout, moveBuilding, notReady } from './layout';
import { preset } from './presets';

// 戦闘の結果をまとめる（勝敗・終わった時点・本丸の体力・損耗など）
const outcome = (s: Battle) => ({
  result: s.result,
  tick: s.tick,
  endT: s.endT,
  hallHp: hallOf(s).hp,
  stats: s.stats,
});

// auto.ts の planAttack と同じ出撃口の選び方：二方向の作戦なら反対側も使う
const entriesOf = (tpl: Template, eps: ReturnType<typeof entryPoints>, i: number) =>
  tpl.pair ? [eps[i].e, eps[OPPOSITE[i]].e] : [eps[i].e];

describe('出撃の制限', () => {
  it(`出撃できるのは開戦から ${PLAN_LIMIT} 秒まで（ちょうどは出せる）`, () => {
    const s = createBattle(emptyLayout());
    s.tick = PLAN_TICKS;
    expect(canDeploy(s, 'inf')).toBe(true);
    expect(deploy(s, 'inf', 0, 10)).toEqual({ ok: true });
    s.tick = PLAN_TICKS + 1;
    expect(canDeploy(s, 'inf')).toBe(false);
    expect(canDeploy(s, GENERAL_ORDER[0])).toBe(false);
    expect(deploy(s, 'inf', 0, 10)).toEqual({ ok: false, msg: `出撃できるのは開戦から${PLAN_LIMIT / 60}分までです` });
  });

  it(`予定どおりに出すと、開戦から ${PLAN_LIMIT} 秒ちょうどの出撃も出る（deployDue のあとに step）`, () => {
    const s = createBattle(emptyLayout());
    s.started = true;
    const auto = { plan: [{ tick: PLAN_TICKS, kind: 'inf' as const, x: 0, y: 10 }], i: 0, waitAfterPlan: true };
    while (s.tick <= PLAN_TICKS && !s.over) {
      expect(deployDue(s, auto)).toEqual([]);
      step(s);
    }
    expect(s.deployLog.map((r) => r.tick)).toEqual([PLAN_TICKS]);
  });

  it(`兵力が残っていても、${PLAN_LIMIT} 秒を過ぎて攻め手がいなければ退却（もう出せないため）`, () => {
    const s = createBattle(emptyLayout());
    s.started = true;
    while (!s.over) step(s);
    expect(s.result).toBe('wipe');
    expect(s.tick).toBe(PLAN_TICKS + 1);
    expect(s.budgetA).toBe(BUDGET_A);
  });

  it(`編成例は、どの手順も ${PLAN_LIMIT} 秒までに出し終わる（攻城の「基本」のもとなので）`, () => {
    for (const tpl of TEMPLATES)
      for (const st of tpl.steps)
        expect({ tpl: tpl.name, last: st.t0 + st.dt * (st.n - 1) <= PLAN_LIMIT }).toEqual({
          tpl: tpl.name,
          last: true,
        });
  });

  it(`武将は全体で ${MAX_GENERALS} 人まで、同じ武将は1人まで`, () => {
    const s = createBattle(emptyLayout());
    expect(deploy(s, GENERAL_ORDER[0], 0, 10)).toEqual({ ok: true });
    expect(deploy(s, GENERAL_ORDER[0], 0, 11).ok).toBe(false);
    for (let i = 1; i < MAX_GENERALS; i++) expect(deploy(s, GENERAL_ORDER[i], 0, 10 + i).ok).toBe(true);
    expect(deploy(s, GENERAL_ORDER[MAX_GENERALS], 0, 20)).toEqual({
      ok: false,
      msg: `武将は${MAX_GENERALS}人までです`,
    });
  });

  it(`兵力は ${BUDGET_A} までしか使えない`, () => {
    const s = createBattle(emptyLayout());
    let n = 0;
    while (deploy(s, 'inf', 0, 10).ok) n++;
    expect(n * ADEF.inf.cost).toBeLessThanOrEqual(BUDGET_A);
    expect(s.budgetA).toBeLessThan(ADEF.inf.cost);
    expect(s.stats.spent).toBe(BUDGET_A - s.budgetA);
    expect(deploy(s, 'inf', 0, 10)).toEqual({ ok: false, msg: '兵力が足りません' });
  });

  it('出撃できるのは外周の青いエリアだけ', () => {
    const s = createBattle(emptyLayout());
    expect(deploy(s, 'inf', 5, 5).ok).toBe(false);
    expect(deploy(s, 'inf', 0, 5).ok).toBe(true);
  });
});

// 出撃の制限・一騎打ちなどは、編成例の地形に頼らないよう、本丸だけの平らな配置（emptyLayout）で確かめる。
// 編成例の勝敗や時間は、パラメータを調整するたびに変わるのでテストにはしない。
// 調整の目安は `npm run balance` で表にして見る
describe('戦闘の計算', () => {
  // 編成例ごとに、辺の中央と角の近くの出撃口を1つずつ試す。編成例が増えても1件の時間が延びないように、編成例ごとのテストに分ける
  it.each(TEMPLATES.map((tpl, ti) => ({ name: tpl.name, tpl, ti })))(
    '同じ配置・同じ出撃なら、何度計算しても結果が同じ（決定論）：$name',
    ({ tpl, ti }) => {
      const l = preset('flat');
      const eps = entryPoints(l);
      for (const i of [ti % 4, 4 + (ti % 4)]) {
        const plan = buildPlan(tpl, entriesOf(tpl, eps, i));
        expect(outcome(runPlan(l, plan))).toEqual(outcome(runPlan(l, plan)));
      }
    },
  );
});

// 本丸だけの城に守りの武将を1人置き、すぐ外から攻めの武将を1人出す
const duel = (atk: GeneralKind, def: GeneralKind) => {
  const s = createBattle({
    buildings: emptyLayout().buildings,
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

  it.each([
    ['攻めの真田昌幸が守将を', 'sage', 'brave'],
    ['守りの真田昌幸が攻め手を', 'brave', 'sage'],
  ] as const)('%s火計で焼くと、焼かれた側に時刻が記録される', (_, atk, def) => {
    const { s, a, d } = duel(atk, def);
    const burned = atk === 'sage' ? d : a;
    expect(burned.burnT).toBe(-1);
    while (!s.over && s.t < 60 && burned.burnT < 0) step(s);
    expect(burned.burnT).toBeGreaterThan(0);
    expect(burned.burnT).toBeLessThanOrEqual(s.t);
  });

  it('守りの火計の傷を盾持ちが肩代わりしたら、燃えるのは盾持ち（円の外にいても）', () => {
    const s = createBattle({ buildings: emptyLayout().buildings, generals: [{ kind: 'sage', x: 4, y: 15 }] });
    deploy(s, 'inf', 0, 10);
    deploy(s, 'shd', 0, 10);
    const [inf, shd] = s.attackers;
    const sage = s.defenders[0];
    const r = GDEF.sage.radius ?? 0;
    // 歩兵は円のふちの内側、盾持ちは円の外で、歩兵を守れる近さに置き、すぐに火が出るようにする
    inf.x = 2;
    inf.y = 10;
    shd.x = 2;
    shd.y = 10 - (SHIELD_RADIUS - 0.1);
    sage.cast = { t: DT / 2, x: 2, y: 10 + r - 0.1 };
    step(s);
    expect(Math.hypot(shd.x - 2, shd.y - (10 + r - 0.1))).toBeGreaterThan(r);
    expect(inf.hp).toBe(inf.maxHp);
    expect(inf.burnT).toBe(-1);
    expect(shd.burnT).toBeGreaterThan(0);
  });
});

describe('飛び道具', () => {
  // 北の中ほどに施設を置き、北から攻め手を歩かせて、初めて撃つまで進める
  const fired = (type: 'tbow' | 'tgun' | 'cata', kinds: ('inf' | 'shd')[]) => {
    const l = emptyLayout();
    l.buildings.push({ type, x: HALL.x, y: 12 });
    const s = createBattle(l);
    kinds.forEach((k, i) => {
      deploy(s, k, HALL.x + i, 0);
    });
    while (!s.over && !s.shots.length) step(s);
    return s;
  };

  it('矢は撃った時には当たらず、飛んで届いた時に傷が入る', () => {
    const s = fired('tbow', ['shd']);
    const u = s.attackers[0];
    const sh = s.shots[0];
    expect(u.hp).toBe(u.maxHp);
    const dist = Math.hypot(u.x - sh.x, u.y - sh.y);
    const t0 = s.t;
    while (s.shots.length) step(s);
    expect(u.hp).toBeLessThan(u.maxHp);
    // 相手は近づいてくるので、止まった相手より早く届く
    expect(s.t - t0).toBeGreaterThan(0);
    expect(s.t - t0).toBeLessThanOrEqual(dist / SHOT_SPEED.arrow + 2 * DT);
  });

  it('矢は、まっすぐ歩く相手の動く先を読んで狙う', () => {
    const s = fired('tbow', ['shd']);
    const u = s.attackers[0];
    const sh = s.shots[0];
    // 狙った所は、撃った時の相手の位置から、相手の進む向きへずれている
    const ahead = (sh.tx - u.x) * u.vx + (sh.ty - u.y) * u.vy;
    expect(Math.hypot(u.vx, u.vy)).toBeGreaterThan(0);
    expect(ahead).toBeGreaterThan(0);
  });

  it('鉄砲の弾も、相手の動く先を読んで狙い、横へ逃げると外れる（地面には何も残さない）', () => {
    const s = fired('tgun', ['shd']);
    const u = s.attackers[0];
    const sh = s.shots[0];
    expect(sh.k).toBe('bullet');
    expect((sh.tx - u.x) * u.vx + (sh.ty - u.y) * u.vy).toBeGreaterThan(0);
    while (s.shots.length) {
      u.x = sh.tx + 2;
      u.y = sh.ty;
      step(s);
    }
    expect(u.hp).toBe(u.maxHp);
    expect(s.effects.some((e) => e.k === 'stuck')).toBe(false);
  });

  it('撃つ施設は、最後に撃った向きを記録する（撃つ前は -x の向き）', () => {
    const l = emptyLayout();
    l.buildings.push({ type: 'cata', x: HALL.x, y: 12 });
    expect(createBattle(l).buildings.find((e) => e.type === 'cata')).toMatchObject({ aimX: -1, aimY: 0 });
    const s = fired('cata', ['shd']);
    const c = s.buildings.find((e) => e.type === 'cata');
    const sh = s.shots[0];
    if (!c) throw new Error('大筒がない');
    expect(c.aimX).toBeCloseTo(sh.tx - sh.sx);
    expect(c.aimY).toBeCloseTo(sh.ty - sh.sy);
  });

  it('鉄砲と大筒は撃った所に火花と煙を出し、矢は出さない。大筒の煙は鉄砲より大きく長い', () => {
    const smokes = (type: 'tbow' | 'tgun' | 'cata') => fired(type, ['shd']).effects.filter((e) => e.k === 'smoke');
    expect(smokes('tbow')).toHaveLength(0);
    const [gun] = smokes('tgun');
    const [ball] = smokes('cata');
    if (gun?.k !== 'smoke' || ball?.k !== 'smoke') throw new Error('煙が出ていない');
    expect(ball.size).toBeGreaterThan(gun.size);
    expect(ball.ttl).toBeGreaterThan(gun.ttl);
  });

  it('矢が飛んでいるあいだに相手が横へ逃げると、外れて地面に刺さる', () => {
    const s = fired('tbow', ['shd']);
    const u = s.attackers[0];
    const sh = s.shots[0];
    // 狙った所から横へ2マス離れた所に留める
    while (s.shots.length) {
      u.x = sh.tx + 2;
      u.y = sh.ty;
      step(s);
    }
    expect(u.hp).toBe(u.maxHp);
    expect(s.effects.some((e) => e.k === 'stuck' && e.side === 'd')).toBe(true);
  });

  it('届く前に相手が倒れたら、矢は外れる（その場所にいるほかの攻め手にも当たらない）', () => {
    const s = fired('tbow', ['inf', 'inf']);
    const tg = s.attackers.find((u) => u.id === s.shots[0].tg);
    const other = s.attackers.find((u) => u !== tg);
    if (!tg || !other) throw new Error('攻め手が2人いない');
    tg.hp = 0;
    // 届くまで、相手がいた所に留める
    while (s.shots.length) {
      other.x = tg.x;
      other.y = tg.y;
      step(s);
    }
    expect(other.hp).toBe(other.maxHp);
  });

  it('大筒の玉は、相手が先に倒れても、狙った所に落ちてまわりに当たる', () => {
    const s = fired('cata', ['inf', 'inf']);
    const sh = s.shots[0];
    expect(sh.splash).toBe(BDEF.cata.splash);
    const tg = s.attackers.find((u) => u.id === sh.tg);
    const other = s.attackers.find((u) => u !== tg);
    if (!tg || !other) throw new Error('攻め手が2人いない');
    tg.hp = 0;
    // 届くまで、狙った所に留める
    while (s.shots.length) {
      other.x = sh.tx;
      other.y = sh.ty;
      step(s);
    }
    expect(other.hp).toBeLessThan(other.maxHp);
    expect(s.effects.some((e) => e.k === 'fire')).toBe(true);
  });

  // 攻め手がいなくなり、もう出せない状態で、本丸へ向かう攻め手の矢だけが飛んでいる
  const lastArrow = () => {
    const s = createBattle(emptyLayout());
    s.started = true;
    s.tick = PLAN_TICKS + 1;
    const hall = hallOf(s);
    const [tx, ty] = [hall.x0 + hall.w / 2, hall.y0 + hall.h / 2];
    s.shots.push({
      k: 'arrow',
      side: 'a',
      x: tx - 5,
      y: ty,
      sx: tx - 5,
      sy: ty,
      tg: hall.id,
      tx,
      ty,
      dmg: 10,
    });
    return { s, hall };
  };

  it('攻め手がいなくなっても、攻め手の矢が届くまでは全滅にしない', () => {
    const { s, hall } = lastArrow();
    step(s);
    expect(s.over).toBe(false);
    while (!s.over) step(s);
    expect(s.result).toBe('wipe');
    expect(hall.hp).toBe(hall.maxHp - 10);
  });

  it('runPlan の進め方（予定を出し切ったら全滅）でも、攻め手の矢が届くまで待つ', () => {
    const { s, hall } = lastArrow();
    const auto = { plan: [], i: 0, waitAfterPlan: false };
    autoStep(s, auto);
    expect(s.over).toBe(false);
    while (!s.over) autoStep(s, auto);
    expect(hall.hp).toBe(hall.maxHp - 10);
  });

  // 飛び道具の武将（織田信長・大島光義）は構える時間を持つ
  it.each([
    ['織田信長', 'gunner'],
    ['大島光義', 'archer'],
  ] as const)(
    '%s：しばらく撃っていなかったら構える時間をおいてから撃ち、続けて撃つあいだは構えない（攻め・守りとも）',
    (_, kind) => {
      const { s, a, d } = duel(kind, kind);
      const aim = GDEF[kind].aim ?? 0;
      expect(aim).toBeGreaterThan(0);
      expect(ADEF[kind].aim).toBe(aim);
      // 構え始めた時刻（攻撃の待ちが構える時間に戻った時刻）と、撃った時刻
      const rec = [a, d].map((u) => ({ u, prev: u.cd, aimAt: -1, shots: [] as number[] }));
      while (!s.over && s.t < 60 && rec.some((r) => r.shots.length < 2)) {
        step(s);
        for (const r of rec) {
          if (r.aimAt < 0 && r.shots.length === 0 && r.u.cd > r.prev + DT) r.aimAt = s.t;
          if (r.u.atkT > 0 && r.u.atkT !== r.shots[r.shots.length - 1]) r.shots.push(r.u.atkT);
          r.prev = r.u.cd;
        }
      }
      for (const r of rec) {
        expect(r.aimAt).toBeGreaterThan(0);
        expect(r.shots.length).toBe(2);
        // 1発目は、構え始めてから構える時間のあと
        expect(r.shots[0] - r.aimAt).toBeCloseTo(aim, 1);
        // 2発目は、攻撃の間隔のあとすぐ（構え直さない）
        expect(r.shots[1] - r.shots[0]).toBeLessThan(GDEF[kind].cd + aim / 2);
      }
    },
  );

  it.each([
    ['大島光義', 'archer', true],
    ['織田信長', 'gunner', true],
    ['上杉謙信（近くで斬る）', 'brave', false],
  ] as const)('%s：飛び道具で撃つか', (_, kind, shoots) => {
    const { s, a } = duel(kind, kind);
    let shot = false;
    while (!s.over && s.t < 60 && a.atkT < 0) {
      step(s);
      shot ||= s.shots.length > 0;
    }
    expect(a.atkT).toBeGreaterThan(0);
    expect(shot).toBe(shoots);
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

  it('城壁は、工兵が叩いても、真田昌幸の火計を受けても壊れない', () => {
    // 門のない囲いは配置の決まりで戦えないが、計算の上でも壁が壊れないことを見る（道がないので、短い時間で切る）
    const s = createBattle(walled(false));
    s.timeLimit = 20;
    for (let i = 0; i < 8; i++) deploy(s, 'eng', 0, 12 + i);
    deploy(s, 'sage', 0, 16);
    while (!s.over) step(s);
    expect(s.result).not.toBe('win');
    // 火計は射程が長いので、壁越しに本丸へ届くことはある（壁は壊れない）
    expect(walls(s).every((w) => w.hp === w.maxHp)).toBe(true);
    // 壊れないので、燃える様子も出さない
    expect(walls(s).every((w) => w.burnT === -1)).toBe(true);
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

  it('歩兵は本丸へ道なりに進み、道の近くの施設には寄るが、遠くの施設には寄らない', () => {
    // 西から本丸へまっすぐ進む道の、2マス脇と6マス脇に鼓楼を置く（鼓楼は撃ち返さない）
    const l = emptyLayout();
    l.buildings.push({ type: 'drum', x: 8, y: HALL.y - 2 }, { type: 'drum', x: 12, y: HALL.y - 6 });
    const s = createBattle(l);
    s.timeLimit = 60;
    // 歩兵は施設に弱いので、5体で壊す
    for (let i = 0; i < 5; i++) deploy(s, 'inf', 0, HALL.y - 2 + i);
    const [near, far] = s.buildings.filter((b) => b.type === 'drum');
    while (!s.over && (near.hp > 0 || hallOf(s).hp === hallOf(s).maxHp)) step(s);
    expect(near.hp).toBeLessThanOrEqual(0);
    expect(far.hp).toBe(far.maxHp);
    expect(hallOf(s).hp).toBeLessThan(hallOf(s).maxHp);
  });

  it('門で閉じた城でも、斥候は本丸への道を門の手前まで進む', () => {
    // 斥候は門を壊せないので、門の手前で待つ（出た所で止まらない）
    const s = createBattle(walled(true));
    s.timeLimit = 30;
    deploy(s, 'scout', HALL.x, 0);
    const u = s.attackers[0];
    while (!s.over && s.t < 20) step(s);
    expect(u.y).toBeGreaterThan(HALL.x - 7);
    expect(s.stats.gateDown).toBe(0);
  });

  it('弓兵は、寄り道の距離より遠くても、今いる所から射程の内の櫓は、道を離れずに撃つ', () => {
    // 西から本丸へまっすぐ進む道の、4マスほど脇に弓櫓を置く（弓兵の寄り道の距離3より遠く、射程5より近い）
    const l = emptyLayout();
    l.buildings.push({ type: 'tbow', x: 10, y: HALL.y - 5 });
    const s = createBattle(l);
    s.timeLimit = 30;
    deploy(s, 'arc', 0, HALL.y);
    const u = s.attackers[0];
    while (!s.over && u.atkT < 0) step(s);
    expect(Math.hypot(u.atkX - 10.5, u.atkY - (HALL.y - 4.5))).toBeLessThan(1);
    // 撃ったのは、本丸への道の上（出た行）から
    expect(Math.abs(u.y - (HALL.y + 0.5))).toBeLessThan(1);
  });

  it('衝車は、本丸への道をふさがない門には、寄り道の距離の内にあるときだけ向かう', () => {
    // 本丸への道のすぐ脇（衝車の寄り道の距離の内）を通る門と、道から遠い門。どちらも本丸への道をふさいでいない
    const run = (gx: number) => {
      const l = emptyLayout();
      l.buildings.push({ type: 'gate', x: gx, y: 2 });
      const s = createBattle(l);
      s.timeLimit = 60;
      deploy(s, 'ram', 0, 2);
      while (!s.over && hallOf(s).hp === hallOf(s).maxHp) step(s);
      return s;
    };
    expect(run(2).stats.gateDown).toBe(1);
    const far = run(12);
    expect(far.stats.gateDown).toBe(0);
    expect(hallOf(far).hp).toBeLessThan(hallOf(far).maxHp);
  });

  it('壁の並びに置いた櫓は、壊れても石垣の台が残り、通れない', () => {
    const l = walled(true);
    // 北の辺の、門の2つ東の壁を、弓櫓にする
    const x = HALL.x + 2;
    const y = HALL.x - 4;
    const i = l.buildings.findIndex((b) => b.x === x && b.y === y);
    l.buildings[i] = { type: 'tbow', x, y };
    const s = createBattle(l);
    s.timeLimit = 120;
    // 工兵は通り道の近くの櫓に寄り道するので、門のある北から出して櫓を壊させる
    for (let k = 0; k < 6; k++) deploy(s, 'eng', HALL.x - 2 + k, 0);
    while (!s.over && !s.stats.tDown) step(s);
    expect(s.stats.tDown).toBe(1);
    const tile = y * W + x;
    expect(s.grid[tile]).not.toBe(0);
    // そのあとも、櫓の跡のマスに攻め手は入らない
    let entered = false;
    while (!s.over) {
      step(s);
      if (s.attackers.some((u) => u.hp > 0 && Math.floor(u.x) === x && Math.floor(u.y) === y)) entered = true;
    }
    expect(entered).toBe(false);
  });

  it('大筒は壁の並びに組み込むものではないので、壊れたら通れる', () => {
    const l = walled(true);
    l.buildings.push({ type: 'cata', x: HALL.x, y: H - 2 });
    const s = createBattle(l);
    s.timeLimit = 60;
    for (let k = 0; k < 6; k++) deploy(s, 'eng', HALL.x - 2 + k, H - 1);
    while (!s.over && !s.stats.tDown) step(s);
    expect(s.stats.tDown).toBe(1);
    expect(s.grid[(H - 2) * W + HALL.x]).toBe(0);
  });

  it('壁で閉じた区画の中の櫓は道がないので、工兵は狙いを変えて、ほかの櫓を壊しに行く', () => {
    const l = emptyLayout();
    // 南の端の近くに、壁で閉じた3×3の区画を作り、真ん中に弓櫓を置く
    for (let x = 3; x <= 5; x++)
      for (let y = H - 6; y <= H - 4; y++) l.buildings.push({ type: x === 4 && y === H - 5 ? 'tbow' : 'wall', x, y });
    // 区画の外、少し離れた所にもう1つ櫓を置く
    l.buildings.push({ type: 'tbow', x: 12, y: H - 5 });
    const s = createBattle(l);
    s.timeLimit = 60;
    for (let k = 0; k < 4; k++) deploy(s, 'eng', 3 + k, H - 1);
    while (!s.over && !s.stats.tDown) step(s);
    const [inner, outer] = [
      s.buildings.find((b) => b.x0 === 4 && b.y0 === H - 5),
      s.buildings.find((b) => b.x0 === 12),
    ];
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
    // 門のない城では、衝車は本丸を狙う。北西の角の近くへ動かした本丸を、東の端から攻める
    for (let i = 0; i < 3; i++) deploy(s, 'ram', W - 1, 10 + i);
    while (!s.over) step(s);
    const hall = hallOf(s);
    expect([hall.x0, hall.y0]).toEqual([HALL_MARGIN, HALL_MARGIN]);
    expect(hall.hp).toBeLessThan(hall.maxHp);
  });
});

describe('地形の高低', () => {
  // 条件を満たすマスの高さを h にした地形
  const heights = (f: (x: number, y: number) => boolean, h: number) =>
    Array.from({ length: W * H }, (_, i) => (f(i % W, (i / W) | 0) ? h : 0));

  it('坂を上ると、平らな所より遅れる', () => {
    // 西の端から本丸へ歩く歩兵が x=12 に着くまでの時間。x=6 から先を1段高くする
    const reach = (l: Layout) => {
      const s = createBattle(l);
      deploy(s, 'inf', 0, HALL.y);
      while (!s.over && !s.attackers.some((u) => u.x >= 12)) step(s);
      return s.t;
    };
    const flat = emptyLayout();
    const hill = { ...emptyLayout(), heights: heights((x) => x >= 6, 1) };
    // 遅くなるのは段の境目を上る1マスの区間だけなので、差は小さい
    expect(reach(hill)).toBeGreaterThan(reach(flat));
  });

  it('坂の遅れは、上るマスへ向かう区間の全体に効く（段の境目を越えたあとも遅い）', () => {
    // 1段高いマスへ1マス進むのにかかる時間は、平らなときの 1 / UPHILL_SPEED 倍になる
    const cross = (h: number) => {
      const inf = createBattle({ ...emptyLayout(), heights: heights((x) => x >= 6, h) });
      deploy(inf, 'inf', 0, HALL.y);
      let t5 = -1;
      while (!inf.over && !inf.attackers.some((u) => u.x >= 6.5)) {
        step(inf);
        if (t5 < 0 && inf.attackers[0].x >= 5.5) t5 = inf.t;
      }
      return inf.t - t5;
    };
    expect(cross(1) / cross(0)).toBeGreaterThan(1.5);
  });

  it('射程が伸びるのは遠くを撃つものだけ（近くで戦うものは伸びない）', () => {
    const s = createBattle({ ...emptyLayout(), heights: heights(() => true, 2) });
    expect(rangeAt(s, ADEF.brave.range, 3.5, 3.5)).toBe(ADEF.brave.range);
    expect(rangeAt(s, ADEF.arc.range, 3.5, 3.5)).toBe(ADEF.arc.range + 2);
  });

  it('崖で囲った本丸には、攻め手が着けず、開戦前の確かめでも止まる', () => {
    // 本丸のまわり（本丸の3マス外まで）を2段の高台にし、その外は平地のままにする（ぐるりと崖になる）
    const l: Layout = {
      ...emptyLayout(),
      heights: heights((x, y) => x >= HALL.x - 3 && x <= HALL.x + 4 && y >= HALL.y - 3 && y <= HALL.y + 4, 2),
    };
    for (let i = 0; i < 5; i++) l.buildings.push({ type: 'gate', x: 3 + i, y: 3 });
    expect(notReady(l)).toMatch('本丸へ通じる道がありません');
    const s = createBattle(l);
    s.timeLimit = 40;
    for (let i = 0; i < 3; i++) deploy(s, 'ram', 0, 14 + i);
    while (!s.over) step(s);
    expect(hallOf(s).hp).toBe(hallOf(s).maxHp);
  });

  it('高台の上の櫓は、平らな所の櫓より早く（遠くから）撃ち始める', () => {
    // 北の中ほどに弓櫓を置き、北から盾兵（体力が高い）を歩かせて、初めて撃った時刻を比べる
    // （当たったかどうかは、矢が飛ぶあいだの盾兵の動きで変わるので見ない）
    const firstShot = (h: number) => {
      const l = emptyLayout();
      l.buildings.push({ type: 'tbow', x: HALL.x, y: 8 });
      if (h) l.heights = heights((x, y) => x === HALL.x && y === 8, h);
      const s = createBattle(l);
      deploy(s, 'shd', HALL.x, 0);
      while (!s.over && !s.shots.length) step(s);
      return s.t;
    };
    expect(firstShot(2)).toBeLessThan(firstShot(0));
  });
});

describe('早鐘（鐘楼）', () => {
  // 本丸の北に上杉謙信を置き、南から歩兵を本丸へ向かわせる。上杉謙信の見つける範囲には入らないが、
  // 知らせを受けたときに追える遠さには入る。bell なら、歩兵の通り道の脇に鐘楼を建てる
  function farFromBrave(bell: boolean) {
    const l = emptyLayout();
    const s = createBattle({
      ...l,
      buildings: [...l.buildings, ...(bell ? [{ type: 'bell' as const, x: HALL.x + 5, y: HALL.y + 6 }] : [])],
      generals: [{ kind: 'brave', x: HALL.x, y: 6 }],
    });
    s.timeLimit = 30;
    deploy(s, 'inf', HALL.x, H - 1);
    const g = s.defenders[0];
    let far = 0;
    let rang = false;
    while (!s.over) {
      step(s);
      if (s.ringing.length) rang = true;
      far = Math.max(far, Math.hypot(g.x - g.hx, g.y - g.hy));
    }
    return { far, rang };
  }
  it('鐘楼がなければ、見つける範囲の外の歩兵には動かない', () => {
    const r = farFromBrave(false);
    expect(r.rang).toBe(false);
    expect(r.far).toBeLessThan(1);
  });
  it('鐘楼が歩兵を見つけると鐘が鳴り、離れた上杉謙信も駆けつける', () => {
    const r = farFromBrave(true);
    expect(r.rang).toBe(true);
    expect(r.far).toBeGreaterThan(5);
  });
});

describe('川と橋', () => {
  // 西から3列目に、上から下まで川を通す。bridgeY を渡すと、その行に橋をかける
  function river(bridgeY?: number): Layout {
    const water = new Array<number>(W * H).fill(0);
    const bridge = new Array<number>(W * H).fill(0);
    for (let y = 0; y < H; y++) water[y * W + 3] = 1;
    if (bridgeY !== undefined) bridge[bridgeY * W + 3] = 1;
    return { ...emptyLayout(), water, bridge };
  }
  it('川は渡れず、橋のかかった所だけ通って本丸へ向かう', () => {
    const s = createBattle(river(H - 5));
    s.timeLimit = 60;
    // 川の西（外周）から衝車を出す
    for (let i = 0; i < 2; i++) deploy(s, 'ram', 0, 10 + i);
    let wet = false;
    let crossed = false;
    while (!s.over) {
      step(s);
      for (const u of s.attackers) {
        if (u.hp <= 0) continue;
        if (Math.floor(u.x) === 3 && Math.floor(u.y) !== H - 5) wet = true;
        if (Math.floor(u.x) === 3 && Math.floor(u.y) === H - 5) crossed = true;
      }
    }
    expect(wet).toBe(false);
    expect(crossed).toBe(true);
    expect(hallOf(s).hp).toBeLessThan(hallOf(s).maxHp);
  });
  it('橋がなければ、川の向こうの本丸へは着けない', () => {
    const s = createBattle(river());
    s.timeLimit = 30;
    for (let i = 0; i < 2; i++) deploy(s, 'ram', 0, 10 + i);
    while (!s.over) step(s);
    expect(hallOf(s).hp).toBe(hallOf(s).maxHp);
  });
  it('攻め手は、出撃エリアの平地からしか出せない', () => {
    const l = { ...emptyLayout(), heights: Array.from({ length: W * H }, (_, i) => (i % W === W - 1 ? 1 : 0)) };
    const s = createBattle(l);
    expect(deploy(s, 'inf', W - 1, 10)).toEqual({ ok: false, msg: '出撃エリアの平地から出撃します' });
    expect(deploy(s, 'inf', 0, 10).ok).toBe(true);
  });
});

describe('騎馬の突撃（武田信玄）', () => {
  // 守将のいる所を城壁で囲む。gate を渡すと、そのマスだけ門にする
  const sealed = (cx: number, cy: number, gate?: [number, number]) => {
    const l = emptyLayout();
    for (let y = cy - 1; y <= cy + 1; y++)
      for (let x = cx - 1; x <= cx + 1; x++) {
        if (x === cx && y === cy) continue;
        l.buildings.push({ type: gate && x === gate[0] && y === gate[1] ? 'gate' : 'wall', x, y });
      }
    return l;
  };
  const aoe = ADEF.rider.aoe ?? 0;

  it('帯の中の守将にまとめて当たり、帯の外の守将には当たらない（燃えない）', () => {
    const s = createBattle({
      buildings: emptyLayout().buildings,
      generals: [
        { kind: 'brave', x: 5, y: 10 },
        { kind: 'gunner', x: 9, y: 10 },
        { kind: 'archer', x: 5, y: 13 },
      ],
    });
    deploy(s, 'rider', 0, 10);
    const a = s.attackers[0];
    a.cast = { t: DT / 2, x: 2, y: 10.5, band: { ex: 10, ey: 10.5, tx: 5, ty: 10.5 } };
    step(s);
    const [brave, gunner, archer] = s.defenders;
    expect(brave.maxHp - brave.hp).toBe(aoe);
    expect(gunner.maxHp - gunner.hp).toBe(aoe);
    expect(archer.hp).toBe(archer.maxHp);
    expect(brave.burnT).toBe(-1);
    expect(s.effects.some((e) => e.k === 'charge')).toBe(true);
  });

  it('帯の元より後ろや、帯の先の外の守将には当たらない', () => {
    const s = createBattle({
      buildings: emptyLayout().buildings,
      generals: [
        { kind: 'brave', x: 1, y: 10 },
        { kind: 'gunner', x: 10, y: 10 },
      ],
    });
    deploy(s, 'rider', 0, 10);
    const a = s.attackers[0];
    const [behind, past] = s.defenders;
    behind.x = 1.6;
    behind.y = 10.5;
    past.x = 10.4;
    past.y = 10.5;
    a.cast = { t: DT / 2, x: 2, y: 10.5, band: { ex: 10, ey: 10.5, tx: 5, ty: 10.5 } };
    step(s);
    expect(behind.hp).toBe(behind.maxHp);
    expect(past.hp).toBe(past.maxHp);
  });

  it('崖の向こうの守将には、帯の幅の内でも当たらない', () => {
    const heights = new Array(W * H).fill(0).map((_, i) => (i % W >= 7 ? 2 : 0));
    const s = createBattle({ ...emptyLayout(), heights, generals: [{ kind: 'brave', x: 7, y: 10 }] });
    deploy(s, 'rider', 0, 10);
    const a = s.attackers[0];
    const d = s.defenders[0];
    d.x = 7.3;
    d.y = 10.5;
    a.cast = { t: DT / 2, x: 2, y: 10.5, band: { ex: 6.9, ey: 10.5, tx: 7.3, ty: 10.5 } };
    step(s);
    expect(d.hp).toBe(d.maxHp);
  });

  it('壊れない城壁には土埃を上げず、知らせは狙った所に出す', () => {
    const l = emptyLayout();
    l.buildings.push({ type: 'wall', x: 6, y: 10 });
    const s = createBattle(l);
    deploy(s, 'rider', 0, 10);
    const a = s.attackers[0];
    a.cast = { t: DT / 2, x: 2, y: 10.5, band: { ex: 5.9, ey: 10.5, tx: 3, ty: 10.5 } };
    step(s);
    const e = s.effects.find((f) => f.k === 'charge');
    expect(e?.k === 'charge' && e.hits).toEqual([]);
    expect(s.alarms.some((m) => m.x === 3 && m.y === 10.5)).toBe(true);
  });

  it('守りの信玄は、近い相手に帯が届かないと、帯の届く別の相手を狙う', () => {
    const l = emptyLayout();
    for (let y = 8; y <= 12; y++) l.buildings.push({ type: 'wall', x: 8, y });
    const s = createBattle({ ...l, generals: [{ kind: 'rider', x: 10, y: 10 }] });
    deploy(s, 'shd', 0, 10);
    deploy(s, 'shd', 0, 10);
    const [near, far] = s.attackers;
    while (s.t < 10 && far.hp === far.maxHp) {
      near.x = 6.5; // 城壁の向こうで近い
      near.y = 10.5;
      near.path = [];
      far.x = 14.5; // 帯の届く所で遠い
      far.y = 10.5;
      far.path = [];
      step(s);
    }
    expect(far.hp).toBeLessThan(far.maxHp);
    expect(near.hp).toBe(near.maxHp);
  });

  it('攻めの信玄は、本丸にも傷を与える', () => {
    const s = createBattle(emptyLayout());
    deploy(s, 'rider', HALL.x, 0);
    const hp = hallOf(s).hp;
    while (!s.over && s.t < 60 && hallOf(s).hp === hp) step(s);
    expect(hallOf(s).hp).toBeLessThan(hp);
  });

  it('城壁で囲まれた守将には、射程の内でも当たらない', () => {
    const l = sealed(8, 10);
    const s = createBattle({ ...l, generals: [{ kind: 'brave', x: 8, y: 10 }] });
    deploy(s, 'rider', 0, 10);
    const d = s.defenders[0];
    while (s.t < 30) step(s);
    expect(d.hp).toBe(d.maxHp);
  });

  it('攻めの帯は門の手前で止まり、門を破ると、その先の守将に当たる', () => {
    const l = sealed(8, 10, [7, 10]);
    const s = createBattle({ ...l, generals: [{ kind: 'brave', x: 8, y: 10 }] });
    deploy(s, 'rider', 0, 10);
    const d = s.defenders[0];
    const gate = s.buildings.find((b) => b.type === 'gate');
    if (!gate) throw new Error('門がない');
    gate.hp = 100; // 門はすぐ破れるようにする
    while (!s.over && s.t < 60 && d.hp === d.maxHp) {
      // 守将は門を通って出られるので、中に留める
      d.x = 8.5;
      d.y = 10.5;
      d.path = [];
      step(s);
      if (d.hp < d.maxHp) expect(gate.hp).toBeLessThanOrEqual(0);
    }
    expect(d.hp).toBeLessThan(d.maxHp);
  });

  it('守りの帯は、味方の門を通り抜けて攻め手に当たる', () => {
    const l = sealed(8, 10, [7, 10]);
    const s = createBattle({ ...l, generals: [{ kind: 'rider', x: 8, y: 10 }] });
    deploy(s, 'shd', 0, 10);
    const a = s.attackers[0];
    while (s.t < 20 && a.hp === a.maxHp) {
      a.x = 4.5;
      a.y = 10.5;
      a.path = [];
      step(s);
    }
    expect(a.hp).toBeLessThan(a.maxHp);
  });
});

describe('徳川家康の軍配', () => {
  const ward = GDEF.guard.ward ?? 0;
  const time = GDEF.guard.wardTime ?? 0;
  // 守りの火計を、歩兵の足元へすぐに落とす
  const burn = (s: Battle, sage: Battle['defenders'][number], x: number, y: number) => {
    sage.cast = { t: DT / 2, x, y };
    step(s);
  };

  it('周りの味方に掛かると受ける傷が減り、範囲の外へ出ても切れるまで続く。切れると元に戻る', () => {
    const s = createBattle({ buildings: emptyLayout().buildings, generals: [{ kind: 'sage', x: 30, y: 30 }] });
    deploy(s, 'guard', 0, 10);
    deploy(s, 'inf', 0, 10);
    const [guard, inf] = s.attackers;
    const sage = s.defenders[0];
    const aoe = GDEF.sage.aoe ?? 0;
    // 家康の攻撃の間隔が来るよう、守将を射程の内へ寄せて、軍配を振るまで進める
    guard.cd = 0;
    sage.x = guard.x + 1;
    sage.y = guard.y;
    guard.target = sage.id;
    while (guard.atkT < 0) step(s);
    // 溜めのあいだは、まだ効かない
    expect(guard.cast).not.toBeNull();
    expect(inf.wardEnd).toBe(0);
    expect(s.effects.some((e) => e.k === 'ward')).toBe(false);
    while (guard.cast) step(s);
    expect(s.t - guard.atkT).toBeCloseTo(GDEF.guard.windup ?? 0, 1);
    expect(inf.wardEnd).toBeCloseTo(s.t + time, 5);
    expect(s.effects.some((e) => e.k === 'ward')).toBe(true);
    // 範囲の外へ動かしても効く
    inf.x = guard.x + 20;
    inf.y = guard.y;
    inf.hp = inf.maxHp = 1000; // 火計で倒れないように
    const before = inf.hp;
    burn(s, sage, inf.x, inf.y);
    expect(before - inf.hp).toBeCloseTo(aoe * (1 - ward), 5);
    // 切れたあとは、そのまま傷を受ける
    inf.hp = inf.maxHp;
    s.t = inf.wardEnd;
    burn(s, sage, inf.x, inf.y);
    expect(inf.maxHp - inf.hp).toBe(aoe);
  });

  it('守りの家康は、周りの建物にも掛ける', () => {
    const l = emptyLayout();
    l.buildings.push({ type: 'tbow', x: 6, y: 10 });
    const s = createBattle({ ...l, generals: [{ kind: 'guard', x: 5, y: 10 }] });
    deploy(s, 'shd', 0, 10);
    const a = s.attackers[0];
    const d = s.defenders[0];
    while (s.t < 5 && (d.atkT < 0 || d.cast)) {
      a.x = 3.5;
      a.y = 10.5;
      a.path = [];
      step(s);
    }
    const tower = s.buildings.find((b) => b.type === 'tbow');
    expect(d.atkT).toBeGreaterThanOrEqual(0);
    expect(tower?.wardEnd).toBeGreaterThan(s.t);
  });

  it('攻めの家康は、櫓の前で止まらず、一番近い味方について歩く', () => {
    const l = emptyLayout();
    l.buildings.push({ type: 'tbow', x: 12, y: 2 });
    const s = createBattle(l);
    deploy(s, 'guard', 10, 0);
    deploy(s, 'ram', 10, 0);
    const [guard, ram] = s.attackers;
    ram.hp = ram.maxHp = 1e6; // 櫓に倒されないように（衝車は櫓に寄り道しない）
    guard.hp = guard.maxHp = 1e6;
    while (s.t < 30 && !s.over) step(s);
    // 櫓のそばで軍配を振ったあとも、本丸へ進む衝車から離れない
    expect(guard.atkT).toBeGreaterThanOrEqual(0);
    expect(ram.y).toBeGreaterThan(10);
    expect(Math.hypot(guard.x - ram.x, guard.y - ram.y)).toBeLessThanOrEqual(WARD_RADIUS);
  });

  it('攻めの家康は、味方がいなくなると敵へ向かい、射程に入ると軍配を振る', () => {
    const l = emptyLayout();
    l.buildings.push({ type: 'tbow', x: 14, y: 8 });
    const s = createBattle(l);
    deploy(s, 'guard', 14, 0);
    const u = s.attackers[0];
    u.hp = u.maxHp = 1e6;
    while (s.t < 30 && u.atkT < 0) step(s);
    expect(u.atkT).toBeGreaterThanOrEqual(0);
    // 櫓のマスの真ん中までの距離は、体の半分だけ射程より長くなることがある
    expect(Math.hypot(u.x - 14.5, u.y - 8.5)).toBeLessThanOrEqual(GDEF.guard.range + 1);
  });

  it('守りの家康は、追っている相手が遠くても、射程に敵がいれば軍配を振る', () => {
    const s = createBattle({ ...emptyLayout(), generals: [{ kind: 'guard', x: 10, y: 10 }] });
    deploy(s, 'shd', 0, 10);
    deploy(s, 'shd', 0, 10);
    const [far, near] = s.attackers;
    const d = s.defenders[0];
    far.x = d.x + 6;
    far.y = d.y;
    near.x = d.x - 2;
    near.y = d.y;
    d.target = far.id;
    d.cd = 0;
    step(s);
    expect(d.cast).not.toBeNull();
    expect(d.atkX).toBeCloseTo(near.x, 0);
  });

  it('壊れない城壁には掛けず、壊せる建物には掛ける', () => {
    const l = emptyLayout();
    l.buildings.push({ type: 'wall', x: 6, y: 10 }, { type: 'tbow', x: 4, y: 10 });
    const s = createBattle({ ...l, generals: [{ kind: 'guard', x: 5, y: 10 }] });
    deploy(s, 'shd', 0, 10);
    const d = s.defenders[0];
    d.cast = { t: DT / 2, x: d.x, y: d.y };
    step(s);
    expect(s.buildings.find((b) => b.type === 'wall')?.wardEnd).toBe(0);
    expect(s.buildings.find((b) => b.type === 'tbow')?.wardEnd).toBeGreaterThan(s.t);
  });

  it('攻めで家康だけが残ると、傷を与えず、時間切れで終わる', () => {
    const s = createBattle(emptyLayout());
    deploy(s, 'guard', HALL.x, 0);
    const hp = hallOf(s).hp;
    while (!s.over) step(s);
    expect(s.result).toBe('timeout');
    expect(hallOf(s).hp).toBe(hp);
  });
});
