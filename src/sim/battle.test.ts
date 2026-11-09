import { describe, expect, it } from 'vitest';
import { autoStep, buildPlan, deployDue, entryPoints, OPPOSITE, runPlan, TEMPLATES, type Template } from './auto';
import {
  type Attacker,
  type Battle,
  canDeploy,
  createBattle,
  deploy,
  hallOf,
  rangeAt,
  skillReach,
  step,
} from './battle';
import {
  ADEF,
  ATTACK_ENGAGED,
  type AttackerKind,
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
  SLOW_RATE,
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
const duel = (atk: AttackerKind, def: GeneralKind) => {
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

  it.each([
    ['弓兵', 'arc', true],
    ['上杉謙信（近くで斬る）', 'brave', false],
  ] as const)('%s：飛び道具で撃つか', (_, kind, shoots) => {
    const { s, a } = duel(kind, 'brave');
    let shot = false;
    while (!s.over && s.t < 60 && a.atkT < 0) {
      step(s);
      shot ||= s.shots.length > 0;
    }
    expect(a.atkT).toBeGreaterThan(0);
    expect(shot).toBe(shoots);
  });
});

describe('大島光義（ふだんは槍、スキルで弓）', () => {
  const g = GDEF.archer;
  // 光義を攻めに出し、x の所に守将（体力を上げた秀吉）を置く。光義の向かう先を守将にする
  const setup = (x: number) => {
    const s = createBattle({ ...emptyLayout(), generals: [{ kind: 'builder', x, y: 15 }] });
    deploy(s, 'archer', 0, 15);
    const u = s.attackers[0];
    const d = s.defenders[0];
    d.hp = d.maxHp = 1e6;
    u.hp = u.maxHp = 1e6;
    u.x = 0.5;
    u.y = 15.5;
    u.target = d.id;
    return { s, u, d };
  };

  it('通常攻撃は槍で、近くの1人に飛び道具なしで当たる', () => {
    expect(g.shot).toBeUndefined();
    expect(g.range).toBeLessThan(1);
    const { s, u, d } = setup(10);
    // スキルを出させない
    u.skillAt = 1e9;
    u.nextSkill = false;
    let shot = false;
    while (s.t < 30 && u.atkT < 0) {
      step(s);
      shot ||= s.shots.length > 0;
    }
    expect(u.atkSkill).toBe(false);
    expect(shot).toBe(false);
    expect(d.hp).toBeLessThan(d.maxHp);
    expect(Math.hypot(u.x - d.x, u.y - d.y)).toBeLessThan(g.range + 1);
  });

  it('スキルが出せる番になると、スキルの射程に入った所で立ち止まって矢を撃ち、そのあと槍の届く所まで近づく', () => {
    const { s, u, d } = setup(14);
    // 守将はその場に留める（動くと矢が外れることがあるため）
    const [hx, hy] = [d.x, d.y];
    const tick = () => {
      d.x = d.px = hx;
      d.y = d.py = hy;
      d.path = [];
      step(s);
    };
    while (s.t < 30 && u.atkT < 0) tick();
    expect(u.atkSkill).toBe(true);
    const at = Math.hypot(u.x - d.x, u.y - d.y);
    // 射程に入った所で出す（相手の体の分だけ、射程より少し遠いことがある）
    expect(at).toBeLessThanOrEqual((g.skillRange ?? 0) + 1);
    expect(at).toBeGreaterThan(g.range + 2);
    // 溜めのあいだは立ち止まる
    const [x0, y0] = [u.x, u.y];
    while (u.cast) tick();
    expect(Math.hypot(u.x - x0, u.y - y0)).toBeLessThan(1e-9);
    // 溜めが終わると矢が出て、届くと強い傷が入る
    expect(s.shots.some((sh) => sh.side === 'a')).toBe(true);
    const before = d.hp;
    while (s.t < 30 && s.shots.length) tick();
    expect(before - d.hp).toBeCloseTo(g.skillDmg ?? 0, 5);
    // そのあとは、槍の届く所まで近づいて突く
    const t0 = s.t;
    while (s.t < t0 + 10 && !(u.atkT > t0 && !u.atkSkill)) tick();
    expect(u.atkSkill).toBe(false);
    expect(Math.hypot(u.x - d.x, u.y - d.y)).toBeLessThan(g.range + 1);
  });

  it('攻めのスキルの矢は、建物に攻めの倍率を掛けて当たる', () => {
    const l = emptyLayout();
    l.buildings.push({ type: 'tgun', x: 8, y: 15 });
    const s = createBattle(l);
    deploy(s, 'archer', 0, 15);
    const u = s.attackers[0];
    u.hp = u.maxHp = 1e6;
    const tower = s.buildings.find((b) => b.type === 'tgun');
    if (!tower) throw new Error('鉄砲櫓がない');
    tower.hp = tower.maxHp = 1e6;
    u.x = 0.5;
    u.y = 15.5;
    u.target = tower.id;
    while (s.t < 30 && u.atkT < 0) step(s);
    expect(u.atkSkill).toBe(true);
    while (u.cast) step(s);
    while (s.t < 30 && s.shots.some((sh) => sh.side === 'a')) step(s);
    expect(tower.maxHp - tower.hp).toBeCloseTo((g.skillDmg ?? 0) * ADEF.archer.fac, 5);
  });

  it('スキルの矢は、放った所より後ろ（撃ち手の背中）の相手には当たらない', () => {
    const s = createBattle({
      ...emptyLayout(),
      generals: [
        { kind: 'brave', x: 7, y: 15 }, // 狙う相手
        { kind: 'guard', x: 3, y: 15 }, // 光義の背中に張り付く
      ],
    });
    deploy(s, 'archer', 0, 15);
    const u = s.attackers[0];
    u.hp = u.maxHp = 1e6;
    const pins = [
      { d: s.defenders[0], x: 7.5, y: 15.5 },
      { d: s.defenders[1], x: 3.1, y: 15.5 }, // 光義（3.5, 15.5）の0.4マス後ろ
    ];
    for (const { d } of pins) d.hp = d.maxHp = 1e6;
    const tick = () => {
      for (const { d, x, y } of pins) {
        d.x = d.px = x;
        d.y = d.py = y;
        d.path = [];
        d.cd = 1;
      }
      u.x = u.px = 3.5;
      u.y = u.py = 15.5;
      step(s);
    };
    u.target = pins[0].d.id;
    while (s.t < 5 && !(u.atkT >= 0 && u.atkSkill)) tick();
    expect(u.atkSkill).toBe(true);
    while (u.cast) tick();
    while (s.t < 10 && s.shots.some((sh) => sh.side === 'a')) tick();
    expect(pins[0].d.maxHp - pins[0].d.hp).toBeCloseTo(g.skillDmg ?? 0, 5);
    expect(pins[1].d.hp).toBe(pins[1].d.maxHp);
  });

  it('スキルの矢は貫通し、射程の端まで飛んで、通り道の守将と建物すべてに当たる。通り道から外れた相手には当たらない', () => {
    const l = emptyLayout();
    // 光義は (0.5, 15.5) から東へ撃つ。弓櫓（4, 15）は通り道、城壁（2, 15）は通り道でも傷が入らない
    l.buildings.push({ type: 'tbow', x: 4, y: 15 }, { type: 'wall', x: 2, y: 15 });
    const s = createBattle({
      ...l,
      generals: [
        { kind: 'brave', x: 6, y: 15 }, // 狙う相手（建物を直す秀吉は使わない）
        { kind: 'guard', x: 7, y: 15 }, // その後ろ
        { kind: 'rider', x: 6, y: 18 }, // 通り道から外れた所
      ],
    });
    deploy(s, 'archer', 0, 15);
    const u = s.attackers[0];
    u.hp = u.maxHp = 1e6;
    u.x = 0.5;
    u.y = 15.5;
    const pins = s.defenders.map((d) => ({ d, x: d.x, y: d.y }));
    for (const { d } of pins) d.hp = d.maxHp = 1e6;
    const tower = s.buildings.find((b) => b.type === 'tbow');
    const wall = s.buildings.find((b) => b.type === 'wall');
    if (!tower || !wall) throw new Error('建物がない');
    tower.hp = tower.maxHp = 1e6;
    const tick = () => {
      for (const { d, x, y } of pins) {
        d.x = d.px = x;
        d.y = d.py = y;
        d.path = [];
        d.cd = 1; // 守将は撃ち返さない
      }
      u.x = u.px = 0.5;
      u.y = u.py = 15.5;
      step(s);
    };
    u.target = pins[0].d.id;
    // 光義の弓は、櫓の射程の外から撃つよう、撃つまで櫓を黙らせる
    tower.cd = 99;
    while (s.t < 5 && u.atkT < 0) tick();
    expect(u.atkSkill).toBe(true);
    while (u.cast) tick();
    const arrow = s.shots.find((sh) => sh.side === 'a');
    expect(arrow?.pierce).toBeDefined();
    // 射程の端まで飛ぶ
    expect(Math.hypot((arrow?.tx ?? 0) - 0.5, (arrow?.ty ?? 0) - 15.5)).toBeGreaterThanOrEqual(
      (g.skillRange ?? 0) - 1e-9,
    );
    while (s.t < 10 && s.shots.some((sh) => sh.side === 'a')) tick();
    const dmg = g.skillDmg ?? 0;
    expect(pins[0].d.maxHp - pins[0].d.hp).toBeCloseTo(dmg, 5);
    expect(pins[1].d.maxHp - pins[1].d.hp).toBeCloseTo(dmg, 5);
    expect(pins[2].d.hp).toBe(pins[2].d.maxHp);
    expect(tower.maxHp - tower.hp).toBeCloseTo(dmg * ADEF.archer.fac, 5);
    expect(wall.hp).toBe(wall.maxHp);
  });

  it('守りの光義も、スキルの射程に入った攻め手へ矢を撃つ', () => {
    const s = createBattle({ ...emptyLayout(), generals: [{ kind: 'archer', x: 10, y: 15 }] });
    deploy(s, 'shd', 0, 15);
    const a = s.attackers[0];
    const d = s.defenders[0];
    a.hp = a.maxHp = 1e6;
    a.x = d.x - 7;
    a.y = d.y;
    let fired = false;
    while (s.t < 5 && !fired) {
      a.x = d.x - 7;
      a.y = d.y;
      a.path = [];
      step(s);
      fired = s.shots.some((sh) => sh.side === 'd');
    }
    expect(fired).toBe(true);
    expect(d.atkSkill).toBe(true);
  });
});

describe('織田信長（ふだんは槍、スキルで鉄砲の三段撃ち）', () => {
  const g = GDEF.gunner;
  const volley = g.skillVolley ?? 1;
  const gap = g.skillVolleyGap ?? 0;
  // 信長を攻めに出し、守将（体力を上げた秀吉）を置く。信長の向かう先を守将にする。守将はその場に留める
  const setup = (x: number, hp = 1e6) => {
    const s = createBattle({ ...emptyLayout(), generals: [{ kind: 'builder', x, y: 15 }] });
    deploy(s, 'gunner', 0, 15);
    const u = s.attackers[0];
    const d = s.defenders[0];
    d.hp = d.maxHp = hp;
    u.hp = u.maxHp = 1e6;
    u.x = 0.5;
    u.y = 15.5;
    u.target = d.id;
    const [hx, hy] = [d.x, d.y];
    const tick = () => {
      d.x = d.px = hx;
      d.y = d.py = hy;
      d.path = [];
      d.cd = 1;
      step(s);
    };
    return { s, u, d, tick };
  };
  // 攻めの弾を撃った時刻（s.shots に新しく入った時）を集める
  const shotTimes = (s: Battle, seen: Set<object>, out: number[]) => {
    for (const sh of s.shots)
      if (sh.side === 'a' && !seen.has(sh)) {
        seen.add(sh);
        out.push(s.t);
      }
  };

  it('能力値：通常攻撃は飛び道具なしの近く、スキルは射程7・3発・撃つ間0.2秒（攻守で同じ）', () => {
    expect(g.shot).toBeUndefined();
    expect(g.range).toBeLessThan(1);
    expect(g.skillRange).toBe(BDEF.tgun.range);
    expect(volley).toBe(3);
    expect(gap).toBeCloseTo(0.2, 9);
    for (const k of [
      'skillCd',
      'skillWindup',
      'skillRange',
      'skillShot',
      'skillDmg',
      'skillVolley',
      'skillVolleyGap',
    ] as const)
      expect(ADEF.gunner[k]).toBe(g[k]);
  });

  it('通常攻撃は槍で、近くの1人に飛び道具なしで当たる', () => {
    const { s, u, d, tick } = setup(10);
    u.skillAt = 1e9;
    u.nextSkill = false;
    let shot = false;
    while (s.t < 30 && u.atkT < 0) {
      tick();
      shot ||= s.shots.length > 0;
    }
    expect(u.atkSkill).toBe(false);
    expect(shot).toBe(false);
    expect(d.hp).toBeLessThan(d.maxHp);
    expect(Math.hypot(u.x - d.x, u.y - d.y)).toBeLessThan(g.range + 1);
  });

  it('スキルの射程で立ち止まり、溜めのあと撃つ間をおいて3発撃ち、そのあと槍の届く所まで近づく', () => {
    const { s, u, d, tick } = setup(14);
    while (s.t < 30 && u.atkT < 0) tick();
    expect(u.atkSkill).toBe(true);
    const t0 = u.atkT;
    const at = Math.hypot(u.x - d.x, u.y - d.y);
    expect(at).toBeLessThanOrEqual((g.skillRange ?? 0) + 1);
    expect(at).toBeGreaterThan(g.range + 2);
    // 3発を撃ち終えるまで立ち止まる
    const [x0, y0] = [u.x, u.y];
    const seen = new Set<object>();
    const times: number[] = [];
    while (u.cast) {
      tick();
      shotTimes(s, seen, times);
    }
    expect(Math.hypot(u.x - x0, u.y - y0)).toBeLessThan(1e-9);
    expect(times).toHaveLength(volley);
    expect(times[0] - t0).toBeCloseTo(g.skillWindup ?? 0, 1);
    for (let i = 1; i < volley; i++) expect(times[i] - times[i - 1]).toBeCloseTo(gap, 1);
    // 弾は届いた時に当たる
    while (s.t < 30 && s.shots.length) tick();
    expect(d.maxHp - d.hp).toBeCloseTo((g.skillDmg ?? 0) * volley, 5);
    // 次の番は、3発目を撃った時から攻撃の間隔のあと。そのあとは槍の届く所まで近づいて突く
    const t1 = s.t;
    while (s.t < t1 + 10 && !(u.atkT > t1 && !u.atkSkill)) tick();
    expect(u.atkSkill).toBe(false);
    expect(u.atkT - times[volley - 1]).toBeGreaterThanOrEqual(g.cd - 1e-6);
    expect(Math.hypot(u.x - d.x, u.y - d.y)).toBeLessThan(g.range + 1);
  });

  it('途中で相手が倒れても狙いを移さず、残りの弾は倒れた相手のいた所へ飛ぶ', () => {
    const s = createBattle({
      ...emptyLayout(),
      generals: [
        { kind: 'builder', x: 8, y: 15 }, // 狙う相手（1発で倒れる）
        { kind: 'guard', x: 8, y: 17 }, // 近くにいる別の守将
      ],
    });
    deploy(s, 'gunner', 0, 15);
    const u = s.attackers[0];
    u.hp = u.maxHp = 1e6;
    const [first, other] = s.defenders;
    first.hp = first.maxHp = 100;
    other.hp = other.maxHp = 1e6;
    const pins = [
      { d: first, x: 8.5, y: 15.5 },
      { d: other, x: 8.5, y: 17.5 },
    ];
    const tick = () => {
      for (const { d, x, y } of pins) {
        d.x = d.px = x;
        d.y = d.py = y;
        d.path = [];
        d.cd = 1;
      }
      u.x = u.px = 2.5;
      u.y = u.py = 15.5;
      step(s);
    };
    u.target = first.id;
    while (s.t < 5 && !(u.atkT >= 0 && u.atkSkill)) tick();
    expect(u.atkSkill).toBe(true);
    const shots: { tg: number; tx: number; ty: number }[] = [];
    const seen = new Set<object>();
    while (s.t < 10 && (u.cast || s.shots.length)) {
      tick();
      for (const sh of s.shots)
        if (sh.side === 'a' && !seen.has(sh)) {
          seen.add(sh);
          shots.push({ tg: sh.tg, tx: sh.tx, ty: sh.ty });
        }
    }
    expect(first.hp).toBe(0);
    expect(shots).toHaveLength(volley);
    for (const sh of shots) expect(sh.tg).toBe(first.id);
    // 倒れたあとの弾は、倒れた相手のいた所へ飛び、近くの別の守将には当たらない
    for (const sh of shots.slice(1)) expect(Math.hypot(sh.tx - 8.5, sh.ty - 15.5)).toBeLessThan(1e-6);
    expect(other.hp).toBe(other.maxHp);
  });

  it('溜めのあいだに相手が倒れたら1発も撃たず、次の番は撃つ間の分だけ早く来る（1発のスキルと同じ待ち）', () => {
    const { s, u, d, tick } = setup(14);
    while (s.t < 30 && u.atkT < 0) tick();
    expect(u.atkSkill).toBe(true);
    // 溜めのあいだに、ほかの者に倒されたとする
    d.hp = 0;
    while (u.cast) step(s);
    expect(s.shots.some((sh) => sh.side === 'a')).toBe(false);
    // 溜めが終わった時に、次の番までの残りは攻撃の間隔だけ
    expect(u.cd).toBeCloseTo(g.cd, 1);
  });

  it('攻めの三段撃ちは、建物に攻めの倍率を掛けて当たる', () => {
    const l = emptyLayout();
    l.buildings.push({ type: 'tgun', x: 8, y: 15 });
    const s = createBattle(l);
    deploy(s, 'gunner', 0, 15);
    const u = s.attackers[0];
    u.hp = u.maxHp = 1e6;
    const tower = s.buildings.find((b) => b.type === 'tgun');
    if (!tower) throw new Error('鉄砲櫓がない');
    tower.hp = tower.maxHp = 1e6;
    u.x = 0.5;
    u.y = 15.5;
    u.target = tower.id;
    while (s.t < 30 && u.atkT < 0) step(s);
    expect(u.atkSkill).toBe(true);
    while (u.cast) step(s);
    while (s.t < 30 && s.shots.some((sh) => sh.side === 'a')) step(s);
    expect(tower.maxHp - tower.hp).toBeCloseTo((g.skillDmg ?? 0) * volley * ADEF.gunner.fac, 5);
  });

  it('足止めされた守りの信長は、溜めと撃つ間が延び、延びた分が atkLag に記録される（画面は経過からこれを引いてコマを選ぶ）', () => {
    const s = createBattle({ ...emptyLayout(), generals: [{ kind: 'gunner', x: 10, y: 15 }] });
    deploy(s, 'shd', 0, 15);
    const a = s.attackers[0];
    const d = s.defenders[0];
    a.hp = a.maxHp = 1e6;
    const tick = () => {
      a.x = a.px = d.hx - g.leash;
      a.y = a.py = d.hy;
      a.path = [];
      a.cd = 1;
      d.slow = 99; // ずっと足止めされている
      step(s);
    };
    while (s.t < 10 && !(d.atkT >= 0 && d.atkSkill)) tick();
    expect(d.atkSkill).toBe(true);
    expect(d.atkLag).toBe(0);
    const seen = new Set<object>();
    const eff: number[] = []; // 弾を撃った時刻の、攻撃してからの経過から遅れを引いたもの
    const real: number[] = []; // 弾を撃った時刻の、攻撃してからの経過
    while (d.cast) {
      tick();
      for (const sh of s.shots)
        if (sh.side === 'd' && !seen.has(sh)) {
          seen.add(sh);
          eff.push(s.t - d.atkT - d.atkLag);
          real.push(s.t - d.atkT);
        }
    }
    expect(eff).toHaveLength(volley);
    for (let i = 0; i < volley; i++) {
      // 遅れを引いた経過は、足止めがないときと同じ（溜めと撃つ間のとおり）
      expect(eff[i]).toBeCloseTo((g.skillWindup ?? 0) + i * gap, 1);
      // 実際の経過は、足止めの分だけ延びている（撃つたびにティックの刻みの分だけずれるので、数ティックは許す）
      expect(Math.abs(real[i] - ((g.skillWindup ?? 0) + i * gap) / SLOW_RATE)).toBeLessThan(4 * DT);
    }
  });

  it('足止めされた守りの昌幸の火計も、溜めが延びた分が atkLag に記録される（溜めのある通常攻撃）', () => {
    const s = createBattle({ ...emptyLayout(), generals: [{ kind: 'sage', x: 10, y: 15 }] });
    deploy(s, 'shd', 0, 15);
    const a = s.attackers[0];
    const d = s.defenders[0];
    a.hp = a.maxHp = 1e6;
    const tick = () => {
      a.x = a.px = d.hx - 3;
      a.y = a.py = d.hy;
      a.path = [];
      a.cd = 1;
      d.slow = 99;
      step(s);
    };
    while (s.t < 10 && d.atkT < 0) tick();
    expect(d.atkT).toBeGreaterThan(0);
    expect(d.cast).not.toBeNull();
    while (d.cast) tick();
    // 溜め windup は、足止めのあいだ SLOW_RATE の速さでしか進まないので、遅れは windup × (1 / SLOW_RATE - 1)
    const windup = GDEF.sage.windup ?? 0;
    expect(Math.abs(d.atkLag - windup * (1 / SLOW_RATE - 1))).toBeLessThan(2 * DT);
  });

  it('守りの信長も、スキルの射程に入った攻め手へ3発撃ち、そのあと槍の届く所まで近づく', () => {
    const s = createBattle({ ...emptyLayout(), generals: [{ kind: 'gunner', x: 10, y: 15 }] });
    deploy(s, 'shd', 0, 15);
    const a = s.attackers[0];
    const d = s.defenders[0];
    a.hp = a.maxHp = 1e6;
    // 持ち場から離れられる距離（leash）の内に留める（外なら、撃ったあと追わずに持ち場へ戻る）
    const pin = () => {
      a.x = a.px = d.hx - g.leash;
      a.y = a.py = d.hy;
      a.path = [];
      a.cd = 1;
    };
    pin();
    const seen = new Set<object>();
    const times: number[] = [];
    while (s.t < 5 && !(d.atkT >= 0 && d.atkSkill)) {
      pin();
      step(s);
    }
    expect(d.atkSkill).toBe(true);
    expect(Math.hypot(d.x - a.x, d.y - a.y)).toBeGreaterThan(g.range + 2);
    while (d.cast) {
      pin();
      step(s);
      for (const sh of s.shots)
        if (sh.side === 'd' && !seen.has(sh)) {
          seen.add(sh);
          times.push(s.t);
        }
    }
    expect(times).toHaveLength(volley);
    const t1 = s.t;
    while (s.t < t1 + 10 && !(d.atkT > t1 && !d.atkSkill)) {
      pin();
      step(s);
    }
    expect(d.atkSkill).toBe(false);
    expect(Math.hypot(d.x - a.x, d.y - a.y)).toBeLessThan(g.range + 1);
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
    // 西から本丸へまっすぐ進む道の、3.5マスほど脇に弓櫓を置く（櫓の縁までが、弓兵の寄り道の距離3より遠く、射程4より近い）
    const l = emptyLayout();
    l.buildings.push({ type: 'tbow', x: 10, y: HALL.y - 4 });
    const s = createBattle(l);
    s.timeLimit = 30;
    deploy(s, 'arc', 0, HALL.y);
    const u = s.attackers[0];
    while (!s.over && u.atkT < 0) step(s);
    expect(Math.hypot(u.atkX - 10.5, u.atkY - (HALL.y - 3.5))).toBeLessThan(1);
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

  it('射程は、相手より高い所に立つと差1段につき伸びる。遠くを撃つものだけ', () => {
    // 西の端（x < 10）を2段の高台にする
    const s = createBattle({ ...emptyLayout(), heights: heights((x) => x < 10, 2) });
    const low = { isB: false, x: 15.5, y: 3.5 } as unknown as Attacker;
    const high = { isB: false, x: 5.5, y: 3.5 } as unknown as Attacker;
    // 高い所から低い相手へは伸びる。近くで戦うものは伸びない
    expect(rangeAt(s, ADEF.arc.range, 3.5, 3.5, low)).toBe(ADEF.arc.range + 2);
    expect(rangeAt(s, ADEF.brave.range, 3.5, 3.5, low)).toBe(ADEF.brave.range);
    // 同じ高さの相手へは伸びない
    expect(rangeAt(s, ADEF.arc.range, 3.5, 3.5, high)).toBe(ADEF.arc.range);
    // 低い所から高い相手へも、縮みはしない
    expect(rangeAt(s, ADEF.arc.range, 15.5, 3.5, high)).toBe(ADEF.arc.range);
  });

  it('高台の櫓は、低い所の敵には遠くまで届くが、同じ高さの敵には伸びない', () => {
    // 高台の縁の櫓から5マス離して、的を置く。弓櫓の射程より遠い
    const fires = (x: number, y: number) => {
      const l = emptyLayout();
      l.buildings.push({ type: 'tbow', x: 5, y: 5 });
      const s = createBattle({ ...l, heights: heights((tx) => tx < 10, 2) });
      deploy(s, 'shd', W - 1, H - 1);
      const [u] = s.attackers;
      u.x = x;
      u.y = y;
      const b = s.buildings.find((e) => e.type === 'tbow');
      if (!b) throw new Error('櫓がない');
      b.cd = 0;
      step(s);
      return b.cd > 0;
    };
    expect(fires(10.5, 5.5)).toBe(true); // 東の低い所
    expect(fires(5.5, 10.5)).toBe(false); // 南の同じ高さ
  });

  it('建物を相手にしても、高さの差で射程が決まる', () => {
    const l = emptyLayout();
    l.buildings.push({ type: 'tbow', x: 5, y: 5 });
    const s = createBattle({ ...l, heights: heights((x) => x < 10, 2) });
    const tower = s.buildings.find((e) => e.type === 'tbow');
    if (!tower) throw new Error('櫓がない');
    expect(rangeAt(s, ADEF.arc.range, 3.5, 3.5, tower)).toBe(ADEF.arc.range);
    expect(rangeAt(s, ADEF.arc.range, 15.5, 3.5, tower)).toBe(ADEF.arc.range);
    expect(rangeAt(s, ADEF.arc.range, 3.5, 3.5, hallOf(s))).toBe(ADEF.arc.range + 2);
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

// スキルを持つ武将を櫓の隣（守りなら持ち場の隣に盾兵）に置き、攻撃した時刻と、それがスキルだったかを記録する
// （倒されないよう体力を上げる）。drum なら、守りの武将のそばに鼓楼を置く（攻撃の待ちが速く減る）
// slow：守りの武将を、ずっと足止めしておく。gap は前の番からの経過、idle は次の番が来られるようになってから番を始めるまでの経過
function skillTurns(kind: GeneralKind, side: 'a' | 'd', until: number, drum = false, slow = false) {
  const l = emptyLayout();
  if (side === 'a') l.buildings.push({ type: 'tbow', x: 12, y: 2 });
  if (drum) l.buildings.push({ type: 'drum', x: 5, y: 12 });
  const s = createBattle(side === 'a' ? l : { ...l, generals: [{ kind, x: 5, y: 10 }] });
  if (side === 'a') deploy(s, kind, 11, 0);
  else deploy(s, 'shd', 0, 10);
  const u = side === 'a' ? s.attackers[0] : s.defenders[0];
  const foe = side === 'a' ? null : s.attackers[0];
  u.hp = u.maxHp = 1e9;
  if (side === 'a') {
    const tower = s.buildings.find((b) => b.type === 'tbow');
    if (tower) tower.hp = tower.maxHp = 1e9;
  }
  const out: { t: number; skill: boolean; planned: boolean; gap: number; idle: number }[] = [];
  let last = -1;
  let planned = u.nextSkill;
  let readyBefore = -1;
  while (s.t < until && !s.over) {
    if (foe) {
      foe.hp = foe.maxHp;
      foe.x = 5.5;
      foe.y = 11.3;
      foe.path = [];
    }
    if (slow && u.side === 'd') u.slow = 99;
    step(s);
    // 番を始めると readyT が -1 に戻るので、ひとつ前のティックまでの値を使う。ひとつ前のティックでまだ待っていたら、
    // 待ちが0になったティックに番を始めたので、経過は0
    if (u.atkT !== last) {
      const idle = readyBefore < 0 ? 0 : u.atkT - readyBefore;
      out.push({ t: u.atkT, skill: u.atkSkill, planned, gap: u.atkT - last, idle });
      last = u.atkT;
    }
    readyBefore = u.readyT;
    // 番の中身は、前の番を終えた時に決まり、次の番まで変わらない
    if (u.cd > 0) planned = u.nextSkill;
  }
  return out;
}

describe('スキルの番の流れ', () => {
  it.each(['guard', 'brave', 'archer'] as const)('%s：スキルを出した時に、足元に発動の光の印を出す', (kind) => {
    const l = emptyLayout();
    l.buildings.push({ type: 'tbow', x: 12, y: 2 });
    const s = createBattle(l);
    deploy(s, kind, 11, 0);
    const u = s.attackers[0];
    u.hp = u.maxHp = 1e9;
    while (s.t < 20 && u.atkT < 0) step(s);
    expect(u.atkSkill).toBe(true);
    const fx = s.effects.find((e) => e.k === 'skill');
    expect(fx).toMatchObject({ x: u.x, y: u.y, side: 'a' });
  });

  it.each([
    ['guard', 'a'],
    ['guard', 'd'],
    ['brave', 'a'],
    ['brave', 'd'],
  ] as const)(
    '%s（%s）：最初の番はスキル。そのあとは攻撃し、スキルの間隔が過ぎた番でまたスキルを出す',
    (kind, side) => {
      const g = GDEF[kind];
      const windup = g.skillWindup ?? 0;
      const out = skillTurns(kind, side, 20);
      expect(out[0].skill).toBe(true);
      expect(out[1].skill).toBe(false);
      // スキルのあと、溜めが終わって効いた時から、攻撃の間隔を数え直す
      expect(out[1].t - out[0].t).toBeCloseTo(windup + g.cd, 1);
      // 攻撃のあいだは、攻撃の間隔ごと
      expect(out[2].t - out[1].t).toBeCloseTo(g.cd, 1);
      const skills = out.filter((o) => o.skill).map((o) => o.t);
      expect(skills.length).toBeGreaterThanOrEqual(2);
      // スキルは、スキルの間隔を過ぎてから、最初に来た番で出る（番の時刻はティックの刻みで、1回の番ごとに1ティックまで遅れる）
      for (let i = 1; i < skills.length; i++) {
        expect(skills[i] - skills[i - 1]).toBeGreaterThanOrEqual((g.skillCd ?? 0) - 1e-9);
        expect(skills[i] - skills[i - 1]).toBeLessThan((g.skillCd ?? 0) + g.cd + 2 * DT + 1e-9);
      }
      // どの番も、前の番を終えた時に決めた中身のとおり
      for (const o of out) expect(o.skill).toBe(o.planned);
    },
  );

  it.each(['guard', 'gunner'] as const)(
    '%s（守り）：足止めされたまま戦い続けても、構えを解いた扱いにならない（番が来られるようになってからの経過で見る）',
    (kind) => {
      const g = GDEF[kind];
      const out = skillTurns(kind, 'd', 30, false, true).slice(1);
      expect(out.length).toBeGreaterThan(5);
      // スキルのあとの番は、足止めで待ちが延び、前の番からの経過が、攻撃の間隔＋ATTACK_ENGAGED を超える
      expect(out.some((o) => o.gap > g.cd + ATTACK_ENGAGED)).toBe(true);
      // 番が来られるようになってからは、すぐに番を始めている（続けて戦っている）
      for (const o of out) expect(o.idle).toBeLessThan(ATTACK_ENGAGED);
      for (const o of out) expect(o.skill).toBe(o.planned);
    },
  );

  // 守りの武将がスキルを出したあと、相手を見つける範囲の外へ相手を離し、番が来られるようになってから idle 秒たって
  // 戻す。そのあいだにスキルが出せるようになったとして、戻した後の番がスキルかを返す
  const turnAfterPause = (kind: 'guard' | 'gunner', idle: number) => {
    const s = createBattle({ ...emptyLayout(), generals: [{ kind, x: 5, y: 10 }] });
    deploy(s, 'shd', 0, 10);
    const u = s.defenders[0];
    const foe = s.attackers[0];
    u.hp = u.maxHp = 1e9;
    let away = false;
    const tick = () => {
      foe.hp = foe.maxHp;
      foe.x = away ? W - 1.5 : 5.5;
      foe.y = away ? H - 1.5 : 11.3;
      foe.path = [];
      step(s);
    };
    while (s.t < 10 && u.atkT < 0) tick();
    expect(u.atkSkill).toBe(true);
    const t0 = u.atkT;
    expect(u.nextSkill).toBe(false);
    while (s.t < 10 && u.cast) tick();
    away = true;
    while (s.t < 10 && u.readyT < 0) tick();
    const ready = u.readyT;
    while (s.t - ready < idle) tick();
    expect(u.atkT).toBe(t0);
    u.skillAt = s.t;
    away = false;
    while (s.t < 20 && u.atkT === t0) tick();
    expect(u.atkT).toBeGreaterThan(t0);
    return { skill: u.atkSkill, gap: u.atkT - t0, idle: u.atkT - ready };
  };

  it.each(['guard', 'gunner'] as const)(
    '%s（守り）：スキルのあと、番が来られるようになってから ATTACK_ENGAGED の内なら、前の番で決めた中身（攻撃）のまま番を始める',
    (kind) => {
      const g = GDEF[kind];
      const r = turnAfterPause(kind, 1.1);
      expect(r.idle).toBeLessThan(ATTACK_ENGAGED);
      // 最後の攻撃からは、攻撃の間隔＋ATTACK_ENGAGED を超えている（前の判定では、構えを解いた扱いだった）
      expect(r.gap).toBeGreaterThan(g.cd + ATTACK_ENGAGED);
      expect(r.skill).toBe(false);
    },
  );

  it('番が来られるようになってから ATTACK_ENGAGED を過ぎたら、構えを解いた扱いになり、番の中身を決め直す', () => {
    const r = turnAfterPause('guard', ATTACK_ENGAGED + 0.3);
    expect(r.idle).toBeGreaterThan(ATTACK_ENGAGED);
    expect(r.skill).toBe(true);
  });

  it('足止めされていても、番が来られるようになってから ATTACK_ENGAGED の内は、構えを解いた扱いにならない', () => {
    const g = GDEF.guard;
    const s = createBattle({ ...emptyLayout(), generals: [{ kind: 'guard', x: 5, y: 10 }] });
    deploy(s, 'shd', 0, 10);
    const u = s.defenders[0];
    const foe = s.attackers[0];
    u.hp = u.maxHp = 1e9;
    const tick = () => {
      foe.hp = foe.maxHp;
      foe.x = 5.5;
      foe.y = 11.3;
      foe.path = [];
      u.slow = 99;
      step(s);
    };
    while (s.t < 10 && u.atkT < 0) tick();
    expect(u.atkSkill).toBe(true);
    const t0 = u.atkT;
    expect(u.nextSkill).toBe(false);
    // 最後の攻撃から、攻撃の間隔＋ATTACK_ENGAGED を超えるまで待つ。そのあいだにスキルが出せるようになったとする
    while (u.atkT === t0 && s.t - t0 <= g.cd + ATTACK_ENGAGED) tick();
    expect(u.atkT).toBe(t0);
    u.skillAt = s.t;
    let ready = u.readyT;
    while (s.t < 20 && u.atkT === t0) {
      ready = u.readyT;
      tick();
    }
    // 番を始めたのは、待ちが0になってから ATTACK_ENGAGED の内（待ちが0になったティックに始めたなら経過は0）
    expect(ready < 0 ? 0 : u.atkT - ready).toBeLessThan(ATTACK_ENGAGED);
    expect(u.atkSkill).toBe(false);
  });
});

describe('徳川家康の軍配（スキル）', () => {
  const g0guard = GDEF.guard;
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
    // 守将を射程の内へ寄せて、最初の番（開戦からすぐ出せるので、スキル）まで進める
    sage.x = guard.x + 0.8;
    sage.y = guard.y;
    guard.target = sage.id;
    while (guard.atkT < 0) step(s);
    expect(guard.atkSkill).toBe(true);
    // 溜めのあいだは、まだ効かない
    expect(guard.cast?.skill).toBe(true);
    expect(inf.wardEnd).toBe(0);
    expect(s.effects.some((e) => e.k === 'ward')).toBe(false);
    while (guard.cast) step(s);
    expect(s.t - guard.atkT).toBeCloseTo(GDEF.guard.skillWindup ?? 0, 1);
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

  it('軍配が効くと、掛かった味方（自分を除く）の所へ向かう光の粒の印を出す', () => {
    const s = createBattle({ buildings: emptyLayout().buildings, generals: [{ kind: 'sage', x: 30, y: 30 }] });
    deploy(s, 'guard', 0, 10);
    deploy(s, 'inf', 0, 10);
    const [guard, inf] = s.attackers;
    guard.cast = { t: DT / 2, x: guard.x, y: guard.y, skill: true };
    // 軍配は、このティックで味方が動く前に効く
    const at: [number, number] = [inf.x, inf.y];
    step(s);
    const fx = s.effects.find((e) => e.k === 'wardFx');
    if (fx?.k !== 'wardFx') throw new Error('光の粒の印がない');
    expect(fx.to).toEqual([at]);
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

  it('攻めの家康は、ほかの武将と同じく敵へ向かい、軍配の効く範囲に敵が入ると、その場でスキルを出す', () => {
    const l = emptyLayout();
    l.buildings.push({ type: 'tbow', x: 14, y: 8 });
    const s = createBattle(l);
    deploy(s, 'guard', 14, 0);
    const u = s.attackers[0];
    u.hp = u.maxHp = 1e6;
    // 敵が遠いあいだは出さない
    while (s.t < 1) step(s);
    expect(u.atkT).toBeLessThan(0);
    while (s.t < 30 && u.atkT < 0) step(s);
    expect(u.atkT).toBeGreaterThanOrEqual(0);
    expect(u.atkSkill).toBe(true);
    // 軍配の届く所まで歩かず、効く範囲のふちで出す（櫓のマスの真ん中までの距離は、体の半分だけ長くなることがある）
    const d = Math.hypot(u.x - 14.5, u.y - 8.5);
    expect(d).toBeGreaterThan(GDEF.guard.range + 1);
    expect(d).toBeLessThanOrEqual(WARD_RADIUS + 1);
  });

  it('守りの家康は、軍配の効く範囲に敵が入ると、その場でスキルを出す', () => {
    const s = createBattle({ ...emptyLayout(), generals: [{ kind: 'guard', x: 10, y: 10 }] });
    deploy(s, 'shd', 0, 10);
    const u = s.defenders[0];
    const foe = s.attackers[0];
    const hold = () => {
      foe.x = foe.px = u.x - 3;
      foe.y = foe.py = u.y;
      foe.path = [];
      foe.cd = 1;
      u.x = u.px = 10.5;
      u.y = u.py = 10.5;
    };
    while (s.t < 3 && u.atkT < 0) {
      hold();
      step(s);
    }
    expect(u.atkSkill).toBe(true);
  });

  it('壊れない城壁には掛けず、壊せる建物には掛ける', () => {
    const l = emptyLayout();
    l.buildings.push({ type: 'wall', x: 6, y: 10 }, { type: 'tbow', x: 4, y: 10 });
    const s = createBattle({ ...l, generals: [{ kind: 'guard', x: 5, y: 10 }] });
    deploy(s, 'shd', 0, 10);
    const d = s.defenders[0];
    d.cast = { t: DT / 2, x: d.x, y: d.y, skill: true };
    step(s);
    expect(s.buildings.find((b) => b.type === 'wall')?.wardEnd).toBe(0);
    expect(s.buildings.find((b) => b.type === 'tbow')?.wardEnd).toBeGreaterThan(s.t);
  });

  it('守りの家康は、鼓楼で攻撃の待ちが速く減っても、スキルの間隔より早くスキルを出さない', () => {
    const l = emptyLayout();
    l.buildings.push({ type: 'drum', x: 5, y: 12 });
    const s = createBattle({ ...l, generals: [{ kind: 'guard', x: 5, y: 10 }] });
    deploy(s, 'shd', 0, 10);
    const u = s.defenders[0];
    const foe = s.attackers[0];
    const rate = BDEF.drum.rate ?? 1;
    const tick = () => {
      foe.hp = foe.maxHp;
      foe.x = 5.5;
      foe.y = 11.3;
      foe.path = [];
      step(s);
    };
    // 最初のスキルのあと、攻撃を1回出させる
    while (s.t < 10 && !(u.atkT >= 0 && !u.atkSkill)) tick();
    // 次の攻撃の番の直前に、スキルが出せる時刻を「その次の番（鼓楼で速まった待ちのあと）より遅く、
    // 速まらない待ちのあとより早い」所に置く
    while (u.cd > DT * rate) tick();
    const turn = s.t + u.cd / rate;
    u.skillAt = turn + (GDEF.guard.cd / rate + GDEF.guard.cd) / 2;
    const atk = u.atkT;
    while (u.atkT === atk) tick();
    // その次の番は、まだスキルを出せないので攻撃
    expect(u.atkSkill).toBe(false);
    expect(u.nextSkill).toBe(false);
    const next = u.atkT;
    while (u.atkT === next) tick();
    expect(u.atkT).toBeLessThan(u.skillAt);
    expect(u.atkSkill).toBe(false);
  });

  it('しばらく戦っていなかった家康は、出せるスキルを次の番で出す', () => {
    const l = emptyLayout();
    l.buildings.push({ type: 'tbow', x: 12, y: 2 });
    const s = createBattle(l);
    deploy(s, 'guard', 11, 0);
    const u = s.attackers[0];
    u.hp = u.maxHp = 1e9;
    const tower = s.buildings.find((b) => b.type === 'tbow');
    if (tower) tower.hp = tower.maxHp = 1e9;
    // 最初のスキルと、続く攻撃を1回出させる
    while (s.t < 10 && !(u.atkT >= 0 && !u.atkSkill)) step(s);
    expect(u.nextSkill).toBe(false);
    // 戦いが止んで構えを解いたあと、スキルが出せるようになった（攻撃の番のまま決まっている）ことにする
    const atk = u.atkT;
    s.t = Math.max(u.skillAt, atk + g0guard.cd + ATTACK_ENGAGED) + 0.1;
    u.cd = 0;
    u.readyT = atk + g0guard.cd; // 攻撃の待ちが0になった時刻
    step(s);
    expect(u.atkT).toBeGreaterThan(atk);
    expect(u.atkSkill).toBe(true);
  });

  it('攻めの家康は、打って施設と本丸を削る', () => {
    const s = createBattle(emptyLayout());
    deploy(s, 'guard', HALL.x, 0);
    const hp = hallOf(s).hp;
    while (!s.over && s.t < 30) step(s);
    expect(hallOf(s).hp).toBeLessThan(hp);
  });
});

describe('豊臣秀吉の刀狩（スキル）', () => {
  const g = GDEF.builder;
  const cut = g.disarm ?? 0;
  const time = g.disarmTime ?? 0;
  const r = g.disarmRadius ?? 0;
  // 溜めが次のティックで終わるようにして、刀狩をすぐ効かせる
  const fire = (s: Battle, u: Battle['attackers'][number] | Battle['defenders'][number]) => {
    u.cast = { t: DT / 2, x: u.x, y: u.y, skill: true };
    step(s);
  };

  it('攻めの秀吉は、範囲の内の守将と施設（城壁を除く）に掛け、範囲の外と味方には掛けない', () => {
    const l = emptyLayout();
    l.buildings.push({ type: 'tbow', x: 12, y: 10 }, { type: 'tbow', x: 22, y: 10 }, { type: 'wall', x: 10, y: 12 });
    const s = createBattle({
      ...l,
      generals: [
        { kind: 'sage', x: 9, y: 11 },
        { kind: 'rider', x: 20, y: 20 },
      ],
    });
    deploy(s, 'builder', 0, 10);
    deploy(s, 'inf', 0, 10);
    const [u, inf] = s.attackers;
    u.x = u.px = 10.5;
    u.y = u.py = 10.5;
    inf.x = inf.px = 11;
    inf.y = inf.py = 10.5;
    fire(s, u);
    const [near, far] = s.buildings.filter((b) => b.type === 'tbow');
    const wall = s.buildings.find((b) => b.type === 'wall' && b.x0 === 10 && b.y0 === 12);
    const [sage, rider] = s.defenders;
    expect(near.disarmEnd).toBeCloseTo(s.t + time, 5);
    expect(near.disarm).toBe(cut);
    expect(sage.disarmEnd).toBeCloseTo(s.t + time, 5);
    expect(far.disarmEnd).toBe(0);
    expect(rider.disarmEnd).toBe(0);
    expect(wall?.disarmEnd).toBe(0);
    expect(inf.disarmEnd).toBe(0);
    expect(u.disarmEnd).toBe(0);
    // 効いた時に、掛かった相手の所で印がはじける
    const fx = s.effects.find((e) => e.k === 'disarm');
    if (fx?.k !== 'disarm') throw new Error('刀狩の印がない');
    expect(fx.r).toBe(r);
    expect(fx.to).toHaveLength(2);
  });

  it('守りの秀吉は、範囲の内の攻め手（兵・武将）に掛け、味方の守将と施設には掛けない', () => {
    const l = emptyLayout();
    l.buildings.push({ type: 'tbow', x: 6, y: 10 });
    const s = createBattle({
      ...l,
      generals: [
        { kind: 'builder', x: 5, y: 10 },
        { kind: 'sage', x: 5, y: 12 },
      ],
    });
    deploy(s, 'inf', 0, 10);
    deploy(s, 'guard', 0, 10);
    deploy(s, 'inf', 0, 10);
    const [inf, guard, farInf] = s.attackers;
    const [u, sage] = s.defenders;
    inf.x = u.x + 1;
    inf.y = u.y;
    guard.x = u.x;
    guard.y = u.y + 2;
    farInf.x = u.x + r + 1;
    farInf.y = u.y;
    fire(s, u);
    expect(inf.disarmEnd).toBeCloseTo(s.t + time, 5);
    expect(guard.disarmEnd).toBeCloseTo(s.t + time, 5);
    expect(farInf.disarmEnd).toBe(0);
    expect(sage.disarmEnd).toBe(0);
    expect(s.buildings.every((b) => b.disarmEnd === 0)).toBe(true);
  });

  it('溜めのあいだは、まだ掛からない', () => {
    const s = createBattle({ ...emptyLayout(), generals: [{ kind: 'builder', x: 5, y: 10 }] });
    deploy(s, 'shd', 0, 10);
    const a = s.attackers[0];
    const u = s.defenders[0];
    a.hp = a.maxHp = 1e6;
    while (s.t < 10 && u.atkT < 0) {
      a.x = a.px = u.x + 1;
      a.y = a.py = u.y;
      a.path = [];
      step(s);
    }
    expect(u.atkSkill).toBe(true);
    expect(u.cast?.skill).toBe(true);
    expect(a.disarmEnd).toBe(0);
    while (u.cast) {
      a.x = a.px = u.x + 1;
      a.y = a.py = u.y;
      step(s);
    }
    expect(s.t - u.atkT).toBeCloseTo(g.skillWindup ?? 0, 1);
    expect(a.disarmEnd).toBeCloseTo(s.t + time, 5);
  });

  it('掛かった櫓の矢の傷が減り、切れると元に戻る（掛かっているあいだに放った矢だけ）', () => {
    const l = emptyLayout();
    l.buildings.push({ type: 'tbow', x: 6, y: 10 });
    const s = createBattle(l);
    deploy(s, 'shd', 0, 10);
    const a = s.attackers[0];
    a.hp = a.maxHp = 1e6;
    const tower = s.buildings.find((b) => b.type === 'tbow');
    if (!tower) throw new Error('弓櫓がない');
    tower.disarm = cut;
    tower.disarmEnd = s.t + 100;
    const shotDmg = () => {
      const n = s.shots.length;
      for (let i = 0; i < 400; i++) {
        a.x = a.px = 3.5;
        a.y = a.py = 10.5;
        a.path = [];
        step(s);
        const sh = s.shots.find((x) => x.side === 'd');
        if (s.shots.length > n && sh) return sh.dmg;
      }
      throw new Error('矢を放たない');
    };
    const full = BDEF.tbow.dmg ?? 0;
    expect(shotDmg()).toBeCloseTo(full * (1 - cut), 5);
    tower.disarmEnd = s.t;
    s.shots = [];
    expect(shotDmg()).toBeCloseTo(full, 5);
  });

  it('掛かった守将の火計と、掛かった攻め手の通常攻撃の傷が減る', () => {
    const s = createBattle({ buildings: emptyLayout().buildings, generals: [{ kind: 'sage', x: 30, y: 30 }] });
    deploy(s, 'inf', 0, 10);
    const inf = s.attackers[0];
    const sage = s.defenders[0];
    inf.hp = inf.maxHp = 1e6;
    sage.hp = sage.maxHp = 1e6;
    // 火計
    sage.disarm = cut;
    sage.disarmEnd = s.t + 100;
    sage.cast = { t: DT / 2, x: inf.x, y: inf.y };
    step(s);
    expect(inf.maxHp - inf.hp).toBeCloseTo((GDEF.sage.aoe ?? 0) * (1 - cut), 5);
    // 歩兵の通常攻撃（守将に当てる）
    inf.disarm = cut;
    inf.disarmEnd = s.t + 100;
    sage.cast = null;
    sage.cd = 99;
    sage.x = inf.x + 0.6;
    sage.y = inf.y;
    inf.target = sage.id;
    inf.cd = 0;
    for (let i = 0; i < 200 && sage.hp === sage.maxHp; i++) {
      sage.x = inf.x + 0.6;
      sage.y = inf.y;
      step(s);
    }
    expect(sage.maxHp - sage.hp).toBeCloseTo(ADEF.inf.dmg * (ADEF.inf.vsGen ?? 1) * (1 - cut), 5);
  });

  it('掛け直すと時間が延び、割合は重ならない', () => {
    const s = createBattle({ ...emptyLayout(), generals: [{ kind: 'builder', x: 5, y: 10 }] });
    deploy(s, 'inf', 0, 10);
    const inf = s.attackers[0];
    const u = s.defenders[0];
    inf.x = u.x + 1;
    inf.y = u.y;
    fire(s, u);
    const end0 = inf.disarmEnd;
    for (let i = 0; i < 30; i++) step(s);
    inf.x = u.x + 1;
    inf.y = u.y;
    fire(s, u);
    expect(inf.disarmEnd).toBeGreaterThan(end0);
    expect(inf.disarm).toBe(cut);
  });

  it('秀吉のいない戦いでは、だれにも掛からない', () => {
    const l = emptyLayout();
    l.buildings.push({ type: 'tbow', x: 6, y: 10 });
    const s = createBattle({
      ...l,
      generals: [
        { kind: 'guard', x: 5, y: 10 },
        { kind: 'brave', x: 5, y: 12 },
      ],
    });
    deploy(s, 'brave', 0, 10);
    deploy(s, 'inf', 0, 10);
    while (s.t < 20 && !s.over) step(s);
    for (const e of [...s.attackers, ...s.defenders, ...s.buildings]) expect(e.disarmEnd).toBe(0);
  });
});

describe('スキルを出す距離', () => {
  it('スキルを持つ武将はみな、スキルを出す距離が0より大きい（スキルの種類を足した時の入れ忘れを見る）', () => {
    for (const kind of GENERAL_ORDER) {
      const g = GDEF[kind];
      if (g.skillCd) expect(skillReach(g), kind).toBeGreaterThan(0);
      else expect(skillReach(g), kind).toBe(0);
    }
  });
});

describe('上杉謙信', () => {
  const g = GDEF.brave;
  const spin = g.spin ?? 0;
  const r = g.spinRadius ?? 0;

  it('通常攻撃は、狙った1人だけに当たる（周りの敵に傷が入らない）', () => {
    const s = createBattle({
      ...emptyLayout(),
      generals: [
        { kind: 'builder', x: 10, y: 10 },
        { kind: 'guard', x: 10, y: 11 },
      ],
    });
    deploy(s, 'brave', 0, 10);
    const u = s.attackers[0];
    const [a, b] = s.defenders;
    for (const d of [a, b]) d.hp = d.maxHp = 1e6;
    // スキルを出させない
    u.skillAt = 1e9;
    u.nextSkill = false;
    u.x = a.x - 0.7;
    u.y = a.y;
    u.target = a.id;
    while (s.t < 5 && u.atkT < 0) step(s);
    expect(u.atkSkill).toBe(false);
    const hit = [a, b].filter((d) => d.hp < d.maxHp);
    expect(hit.length).toBe(1);
  });

  it('攻めの謙信は、回転斬りの範囲に敵が入ると、刀の届く所まで歩かずにスキルを出す', () => {
    const l = emptyLayout();
    l.buildings.push({ type: 'tbow', x: 14, y: 8 });
    const s = createBattle(l);
    deploy(s, 'brave', 14, 0);
    const u = s.attackers[0];
    u.hp = u.maxHp = 1e6;
    while (s.t < 30 && u.atkT < 0) step(s);
    expect(u.atkSkill).toBe(true);
    const d = Math.hypot(u.x - 14.5, u.y - 8.5);
    expect(d).toBeGreaterThan(g.range + 1);
    expect(d).toBeLessThanOrEqual(r + 1);
  });

  it.each([false, true])('攻めの謙信は、城壁を挟んだ相手には回転斬りを出さない（城壁 %s）', (wall) => {
    const l = emptyLayout();
    // 謙信は (11.5, 8.5)、弓櫓は (13, 8)。間の (12, 8) に城壁
    l.buildings.push({ type: 'tbow', x: 13, y: 8 });
    if (wall) l.buildings.push({ type: 'wall', x: 12, y: 8 });
    const s = createBattle(l);
    deploy(s, 'brave', 0, 8);
    const u = s.attackers[0];
    u.hp = u.maxHp = 1e6;
    const tower = s.buildings.find((b) => b.type === 'tbow');
    if (!tower) throw new Error('弓櫓がない');
    tower.cd = 99;
    let spun = false;
    while (s.t < 1) {
      u.x = u.px = 11.5;
      u.y = u.py = 8.5;
      u.path = [];
      u.target = tower.id;
      step(s);
      spun ||= u.atkT >= 0 && u.atkSkill;
    }
    expect(spun).toBe(!wall);
  });

  it.each([false, true])('守りの謙信は、城壁を挟んだ攻め手には回転斬りを出さない（城壁 %s）', (wall) => {
    const l = emptyLayout();
    if (wall) l.buildings.push({ type: 'wall', x: 11, y: 10 });
    const s = createBattle({ ...l, generals: [{ kind: 'brave', x: 10, y: 10 }] });
    deploy(s, 'shd', 0, 10);
    const u = s.defenders[0];
    const foe = s.attackers[0];
    foe.hp = foe.maxHp = 1e6;
    let spun = false;
    while (s.t < 1) {
      foe.x = foe.px = 12.3;
      foe.y = foe.py = 10.5;
      foe.path = [];
      foe.cd = 1;
      u.x = u.px = 10.5;
      u.y = u.py = 10.5;
      step(s);
      spun ||= u.atkT >= 0 && u.atkSkill;
    }
    expect(spun).toBe(!wall);
  });

  it('守りの謙信は、回転斬りの範囲に入った敵を、その場で斬る', () => {
    const s = createBattle({ ...emptyLayout(), generals: [{ kind: 'brave', x: 10, y: 10 }] });
    deploy(s, 'shd', 0, 10);
    const u = s.defenders[0];
    const foe = s.attackers[0];
    foe.hp = foe.maxHp = 1e6;
    const hold = () => {
      foe.x = foe.px = u.x - (r - 0.2);
      foe.y = foe.py = u.y;
      foe.path = [];
      foe.cd = 1;
      u.x = u.px = 10.5;
      u.y = u.py = 10.5;
    };
    while (s.t < 3 && foe.hp === foe.maxHp) {
      hold();
      step(s);
    }
    expect(u.atkSkill).toBe(true);
    expect(foe.maxHp - foe.hp).toBeCloseTo(spin, 5);
  });

  it('回転斬りは、溜めが終わった時に、範囲の敵と壊せる建物に当たる。壊れない城壁と範囲の外には当たらない', () => {
    const l = emptyLayout();
    // 謙信は (10.5, 10.5)。弓櫓と城壁は範囲の内、鉄砲櫓は範囲の外
    l.buildings.push({ type: 'tbow', x: 11, y: 10 }, { type: 'wall', x: 9, y: 10 }, { type: 'tgun', x: 14, y: 10 });
    const s = createBattle({
      ...l,
      generals: [
        { kind: 'builder', x: 10, y: 11 },
        { kind: 'gunner', x: 10, y: 14 },
      ],
    });
    deploy(s, 'brave', 0, 10);
    const u = s.attackers[0];
    u.x = 10.5;
    u.y = 10.5;
    const [near, far] = s.defenders;
    const hp = (t: string) => s.buildings.find((b) => b.type === t)?.hp ?? 0;
    const before = { near: near.hp, far: far.hp, tbow: hp('tbow'), wall: hp('wall'), tgun: hp('tgun') };
    u.cast = { t: DT / 2, x: u.x, y: u.y, skill: true };
    step(s);
    expect(Math.hypot(far.x - u.x, far.y - u.y)).toBeGreaterThan(r);
    expect(before.near - near.hp).toBeCloseTo(spin, 5);
    expect(far.hp).toBe(before.far);
    expect(before.tbow - hp('tbow')).toBeCloseTo(spin * ADEF.brave.fac, 5);
    expect(hp('wall')).toBe(before.wall);
    expect(hp('tgun')).toBe(before.tgun);
    expect(s.effects.some((e) => e.k === 'spin')).toBe(true);
  });

  it('守りの回転斬りは、範囲の攻め手に当たる', () => {
    const s = createBattle({ ...emptyLayout(), generals: [{ kind: 'brave', x: 10, y: 10 }] });
    deploy(s, 'shd', 0, 10);
    deploy(s, 'shd', 0, 10);
    const [a, b] = s.attackers;
    const d = s.defenders[0];
    a.x = d.x + 1;
    a.y = d.y;
    b.x = d.x + r + 1;
    b.y = d.y;
    d.cast = { t: DT / 2, x: d.x, y: d.y, skill: true };
    step(s);
    expect(a.maxHp - a.hp).toBeCloseTo(spin, 5);
    expect(b.hp).toBe(b.maxHp);
  });

  it('溜めのあいだに倒されたら、回転斬りは出ない', () => {
    const s = createBattle({ ...emptyLayout(), generals: [{ kind: 'builder', x: 10, y: 11 }] });
    deploy(s, 'brave', 0, 10);
    const u = s.attackers[0];
    u.x = 10.5;
    u.y = 10.5;
    const d = s.defenders[0];
    d.hp = d.maxHp = 1e6;
    u.cast = { t: 0.2, x: u.x, y: u.y, skill: true };
    u.hp = 0;
    while (s.t < 0.5) step(s);
    expect(d.hp).toBe(d.maxHp);
    expect(s.effects.some((e) => e.k === 'spin')).toBe(false);
  });
});

describe('鼓楼', () => {
  // 櫓の近くに鼓楼を n 個置いて、1ティックで櫓の次に撃つまでの残りがどれだけ減るか
  const tick = (type: 'tbow' | 'cata', n: number) => {
    const l = emptyLayout();
    const x = 5;
    const y = 5;
    l.buildings.push({ type, x, y });
    for (let i = 0; i < n; i++) l.buildings.push({ type: 'drum', x: x + 2 + i, y });
    const s = createBattle(l);
    s.started = true;
    const b = s.buildings.find((e) => e.type === type);
    if (!b) throw new Error('施設がない');
    b.cd = 1;
    step(s);
    return 1 - b.cd;
  };
  it('櫓も大筒も速くなり、2つの範囲に入っても1つのときと同じ', () => {
    for (const type of ['tbow', 'cata'] as const) {
      expect(tick(type, 1)).toBeGreaterThan(tick(type, 0));
      expect(tick(type, 2)).toBeCloseTo(tick(type, 1));
    }
  });
});
