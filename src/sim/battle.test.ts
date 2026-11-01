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
  it('同じ配置・同じ出撃なら、何度計算しても結果が同じ（決定論）', () => {
    const l = preset('flat');
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
    ['攻めの軍師が守将を', 'sage', 'brave'],
    ['守りの軍師が攻め手を', 'brave', 'sage'],
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

describe('飛び道具', () => {
  // 北の中ほどに施設を置き、北から攻め手を歩かせて、初めて撃つまで進める
  const fired = (type: 'tbow' | 'cata', kinds: ('inf' | 'shd')[]) => {
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

  it('大筒の玉は、相手が先に倒れても、相手が最後にいた所に落ちてまわりに当たる', () => {
    const s = fired('cata', ['inf', 'inf']);
    const sh = s.shots[0];
    expect(sh.splash).toBe(BDEF.cata.splash);
    const tg = s.attackers.find((u) => u.id === sh.tg);
    const other = s.attackers.find((u) => u !== tg);
    if (!tg || !other) throw new Error('攻め手が2人いない');
    tg.hp = 0;
    // 届くまで、相手がいた所に留める
    while (s.shots.length) {
      other.x = tg.x;
      other.y = tg.y;
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
    s.shots.push({ k: 'arrow', side: 'a', x: tx - 5, y: ty, sx: tx - 5, sy: ty, tg: hall.id, tx, ty, dmg: 10 });
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

  it.each([
    ['弓将', 'archer', true],
    ['鉄砲大将', 'gunner', true],
    ['槍将（間合いは長いが、近くで突く）', 'spear', false],
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
    // 壊れないので、燃える様子も出さない
    expect(walls(s).every((w) => w.burnT === -1)).toBe(true);
  }, 20000); // 戦闘を制限時間まで計算するので時間がかかる

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
    // 南の辺の中ほどの壁を、弓櫓にする
    const y = HALL.x + HALL.w + 3;
    const i = l.buildings.findIndex((b) => b.x === HALL.x && b.y === y);
    l.buildings[i] = { type: 'tbow', x: HALL.x, y };
    const s = createBattle(l);
    s.timeLimit = 120;
    // 工兵は櫓を狙うので、南から出して櫓を壊させる
    for (let k = 0; k < 6; k++) deploy(s, 'eng', HALL.x - 2 + k, H - 1);
    while (!s.over && !s.stats.tDown) step(s);
    expect(s.stats.tDown).toBe(1);
    const tile = y * W + HALL.x;
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
    // 衝車は本丸だけを狙う。北西の角の近くへ動かした本丸を、東の端から攻める
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

  it('射程が伸びるのは遠くを撃つものだけ（間合いの長い槍は伸びない）', () => {
    const s = createBattle({ ...emptyLayout(), heights: heights(() => true, 2) });
    expect(rangeAt(s, ADEF.spear.range, 3.5, 3.5)).toBe(ADEF.spear.range);
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
  }, 20000); // 戦闘を制限時間まで計算するので時間がかかる

  it('高台の上の櫓は、平らな所の櫓より早く（遠くから）撃ち始める', () => {
    // 北の中ほどに弓櫓を置き、北から盾兵（体力が高い）を歩かせて、初めて撃たれた時刻を比べる
    const firstHit = (h: number) => {
      const l = emptyLayout();
      l.buildings.push({ type: 'tbow', x: HALL.x, y: 8 });
      if (h) l.heights = heights((x, y) => x === HALL.x && y === 8, h);
      const s = createBattle(l);
      deploy(s, 'shd', HALL.x, 0);
      while (!s.over && s.attackers[0].hp === s.attackers[0].maxHp) step(s);
      return s.t;
    };
    expect(firstHit(2)).toBeLessThan(firstHit(0));
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
  }, 20000);
  it('橋がなければ、川の向こうの本丸へは着けない', () => {
    const s = createBattle(river());
    s.timeLimit = 30;
    for (let i = 0; i < 2; i++) deploy(s, 'ram', 0, 10 + i);
    while (!s.over) step(s);
    expect(hallOf(s).hp).toBe(hallOf(s).maxHp);
  }, 20000);
  it('攻め手は、出撃エリアの平地からしか出せない', () => {
    const l = { ...emptyLayout(), heights: Array.from({ length: W * H }, (_, i) => (i % W === W - 1 ? 1 : 0)) };
    const s = createBattle(l);
    expect(deploy(s, 'inf', W - 1, 10)).toEqual({ ok: false, msg: '出撃エリアの平地から出撃します' });
    expect(deploy(s, 'inf', 0, 10).ok).toBe(true);
  });
});
