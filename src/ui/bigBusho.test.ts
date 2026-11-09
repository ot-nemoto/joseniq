import { describe, expect, it } from 'vitest';
import { ADEF, type AttackerKind, GDEF, isGeneralKind, skillSpan } from '../sim';
import {
  ATTACK_TIME,
  BIG_KINDS,
  BIG_MUZZLE,
  type BigPose,
  bigBarDots,
  bigBodyBox,
  bigData,
  bigFrame,
  bigHasSkill,
  bigMuzzle,
  bigScale,
  bigWeapon,
  SKILL_TIME,
} from './bigBusho';

const pose = (o: Partial<BigPose>): BigPose => ({ fall: -1, mv: 0, phase: 0, cd: -1, cdFull: 0, since: -1, ...o });
const at = (kind: AttackerKind, o: Partial<BigPose>, flash = 0) => {
  const f = bigFrame(kind, pose(o), flash, 0);
  return `${f.action}${f.i}`;
};

describe('大きな絵の武将のコマの選び方（bigFrame）', () => {
  it('刀：攻撃した時刻から、踏み込み斬り・振り抜き・残心を出し、そのあとは構えて待つ', () => {
    const cd = 0.8;
    const t = ATTACK_TIME.sword.post;
    const sinceHit = (since: number) => at('brave', { cdFull: cd, since, cd: cd - since });
    expect(sinceHit(0)).toBe('attack2');
    expect(sinceHit(t[0] + 0.01)).toBe('attack3');
    expect(sinceHit(t[1] + 0.01)).toBe('attack4');
    expect(sinceHit(t[2] + 0.01)).toBe('idle0');
  });

  it('刀：続けて攻撃しているあいだは、次に攻撃できるまでの残りで、溜め・振りかぶりを出す', () => {
    const cd = 0.8;
    const t = ATTACK_TIME.sword.pre;
    const left = (rest: number) => at('brave', { cdFull: cd, since: cd - rest, cd: rest });
    expect(left(t[0] + 0.01)).toBe('idle0');
    expect(left(t[0] - 0.01)).toBe('attack0');
    expect(left(t[1] - 0.01)).toBe('attack1');
  });

  it('弓（弓兵）：つがえる・引き絞るのあと、放つ・残身・下ろすを出す。区切りは攻撃の間隔の中に収まる', () => {
    const cd = ADEF.arc.cd;
    const tm = ATTACK_TIME.bow;
    expect(bigWeapon('arc')).toBe('bow');
    expect(tm.pre[0] + tm.post[2]).toBeLessThan(cd);
    expect(at('arc', { cdFull: cd, cd: tm.pre[0] - 0.01 })).toBe('attack0');
    expect(at('arc', { cdFull: cd, cd: tm.pre[1] - 0.01 })).toBe('attack1');
    expect(at('arc', { cdFull: cd, since: 0, cd })).toBe('attack2');
    expect(at('arc', { cdFull: cd, since: tm.post[1] + 0.01, cd: cd - tm.post[1] - 0.01 })).toBe('attack4');
  });

  it('大島光義は、ふだんは槍の区切りを使い、矢はスキルの弓から出す', () => {
    expect(bigWeapon('archer')).toBe('spear');
    expect(bigMuzzle('archer')).toEqual(BIG_MUZZLE.bow);
  });

  it('離れた所を指す軍配の武将は采配の区切りを使い、攻撃の間隔に収まり、指したままのあいだに溜めが終わる', () => {
    expect(bigWeapon('sage')).toBe('fan');
    expect(bigWeapon('rider')).toBe('fan');
    expect(ATTACK_TIME.fan.pre[0] + ATTACK_TIME.fan.post[2]).toBeLessThan(GDEF.sage.cd);
    expect(ATTACK_TIME.fan.pre[0] + ATTACK_TIME.fan.post[2]).toBeLessThan(GDEF.rider.cd);
    for (const k of ['sage', 'rider'] as const)
      expect(GDEF[k].windup ?? 0).toBeLessThanOrEqual(ATTACK_TIME.fan.post[1]);
  });

  it('近くを打つ軍配の武将（家康）は打つ区切りを使い、攻撃の間隔に収まる', () => {
    expect(bigWeapon('guard')).toBe('baton');
    expect(ATTACK_TIME.baton.pre[0] + ATTACK_TIME.baton.post[2]).toBeLessThan(GDEF.guard.cd);
  });

  it('兵の武器：歩兵と騎兵は槍、弓兵は弓、衝車は丸太、工兵は槌、盾兵は盾、持ち物のない斥候は手を振る', () => {
    expect(bigWeapon('inf')).toBe('spear');
    expect(bigWeapon('cav')).toBe('spear');
    expect(bigWeapon('arc')).toBe('bow');
    expect(bigWeapon('ram')).toBe('ram');
    expect(bigWeapon('eng')).toBe('mallet');
    expect(bigWeapon('shd')).toBe('shield');
    expect(bigWeapon('scout')).toBe('wave');
  });

  it('どの駒も、攻撃の5コマは攻撃の間隔に収まり、4倍速でもどのコマも描画1回分（1/60秒）より長く出る', () => {
    const frame = 4 / 60;
    for (const kind of BIG_KINDS) {
      const { pre, post } = ATTACK_TIME[bigWeapon(kind)];
      expect(pre[0] + post[2], kind).toBeLessThan(ADEF[kind].cd);
      const lens = [pre[0] - pre[1], pre[1], post[0], post[1] - post[0], post[2] - post[1]];
      for (const l of lens) expect(l, kind).toBeGreaterThan(frame);
    }
  });

  it('まだ攻撃していない武将は、待機の姿のまま（開戦前・敵を待つ守り）', () => {
    expect(at('brave', { cdFull: 0.8, cd: 0 })).toBe('idle0');
    expect(at('brave', { cdFull: 0.8, cd: -3 })).toBe('idle0');
    expect(at('gunner', { cdFull: 0.9, cd: 0 })).toBe('idle0');
    expect(at('archer', { cdFull: 0.9, cd: -1 })).toBe('idle0');
  });

  it('戦いが止んで、攻撃の間隔に少し足した時間を過ぎたら、構えを解く', () => {
    expect(at('brave', { cdFull: 0.8, since: 5, cd: -4.2 })).toBe('idle0');
  });

  it('歩いているあいだは、攻撃の前の2コマを出さない', () => {
    expect(at('brave', { mv: 1, phase: 0.3, cdFull: 0.8, since: 0.6, cd: 0.2 })).toBe('walk1');
  });

  it('攻撃の後の3コマは、傷を受けた光より先に出す。光だけのときは、のけぞり・立て直し', () => {
    expect(at('brave', { cdFull: 0.8, since: 0.05, cd: 0.75 }, 4)).toBe('attack2');
    expect(at('brave', {}, 4)).toBe('hurt0');
    expect(at('brave', {}, 2)).toBe('hurt1');
  });

  it('倒れは進みで3コマを選び、後ろの半分ほどで薄れて消える', () => {
    const fall = (f: number) => bigFrame('brave', pose({ fall: f }), 0, 0);
    expect(fall(0.1)).toEqual({ action: 'fall', i: 0, fade: 1 });
    expect(fall(0.3).i).toBe(1);
    expect(fall(0.5)).toEqual({ action: 'fall', i: 2, fade: 1 });
    expect(fall(1).fade).toBeCloseTo(0);
  });

  it('様子が分からない駒（配置の画面など）は、実際の時刻で待機のコマを進める', () => {
    expect(bigFrame('brave', undefined, 0, 0).action).toBe('idle');
    expect(bigFrame('brave', undefined, 0, 700).i).toBe(2);
  });
});

describe('絵のコマの数', () => {
  it.each(BIG_KINDS)('%s：どの向きも待機4・歩き4・攻撃5・被弾2・倒れ3コマ', (kind) => {
    for (const view of ['front', 'back'] as const) {
      const f = bigData(kind).frames[view];
      expect([f.idle, f.walk, f.attack, f.hurt, f.fall].map((a) => a.length)).toEqual([4, 4, 5, 2, 3]);
      // スキルのコマは、スキルを持つ武将だけが5コマ持つ
      expect(f.skill?.length ?? 0, kind).toBe(ADEF[kind].skillCd ? 5 : 0);
    }
  });
});

describe('スキルのコマ', () => {
  // スキルを持つ武将（スキルのコマと区切りを持つ）
  const SKILLED = ['brave', 'gunner', 'archer', 'guard'] as const;
  const of = (kind: (typeof SKILLED)[number]) => {
    const g = GDEF[kind];
    const tm = SKILL_TIME[kind];
    if (!tm) throw new Error(`${kind} のスキルの区切りがない`);
    return { g, tm, atk: ATTACK_TIME[bigWeapon(kind)], windup: g.skillWindup ?? 0 };
  };

  it('スキルのコマを持つのは、スキルを持つ武将だけで、どれも区切りを持つ', () => {
    expect(BIG_KINDS.filter(bigHasSkill)).toEqual([...SKILLED]);
    expect(BIG_KINDS.filter((k) => ADEF[k].skillCd)).toEqual([...SKILLED]);
    expect(Object.keys(SKILL_TIME).sort()).toEqual([...SKILLED].sort());
  });

  it.each(SKILLED)('%s：次の番がスキルなら、前の2コマにスキルの構えを出す', (kind) => {
    const { g, tm } = of(kind);
    const left = (rest: number) => at(kind, { cdFull: g.cd, since: g.cd - rest, cd: rest, skillNext: true });
    expect(left(tm.pre[0] + 0.01)).toBe('idle0');
    expect(left(tm.pre[0] - 0.01)).toBe('skill0');
    expect(left(tm.pre[1] - 0.01)).toBe('skill1');
  });

  it.each(SKILLED)(
    '%s：スキルを出した時刻から、後の3コマにスキルの発動を出し、次の番が攻撃なら攻撃の構えに戻る',
    (kind) => {
      const { g, tm, atk } = of(kind);
      const next = skillSpan(g) + g.cd; // スキルのあと、次の番が来るまで
      const sinceSkill = (since: number) => at(kind, { cdFull: g.cd, since, cd: next - since, skillLast: true });
      // 溜めのあいだ前の2コマ目を出したままにするもの（三段撃ち）は、溜めのあとから後の3コマを出す
      if (tm.hold) {
        expect(sinceSkill(0)).toBe('skill1');
        expect(sinceSkill(tm.hold - 0.01)).toBe('skill1');
        expect(sinceSkill(tm.hold + 0.01)).toBe('skill2');
      } else expect(sinceSkill(0)).toBe('skill2');
      expect(sinceSkill(tm.post[0] + 0.01)).toBe('skill3');
      expect(sinceSkill(tm.post[1] + 0.01)).toBe('skill4');
      expect(sinceSkill(tm.post[2] + 0.01)).toBe('idle0');
      expect(sinceSkill(next - atk.pre[0] + 0.01)).toBe('attack0');
    },
  );

  it('足止めで溜めが遅れた分（lag）は、後の3コマの区切りでは経過から引き、戦いが止んだかの判定では引かない', () => {
    const tm = SKILL_TIME.gunner;
    if (!tm?.hold) throw new Error('信長の区切りがない');
    const skill = (since: number, lag: number) => at('gunner', { cdFull: 0.9, since, lag, cd: 1, skillLast: true });
    // 経過は1.0秒でも、0.5秒遅れていれば溜めの進みは0.5秒で、まだ狙う形
    expect(skill(1.0, 0)).toBe('skill3');
    expect(skill(1.0, 0.5)).toBe('skill1');
    // 遅れを引いた進みが、撃つ×3の区切りに入る
    expect(skill(tm.hold + 0.5 + 0.01, 0.5)).toBe('skill2');
    expect(skill(tm.post[1] + 0.5 + 0.01, 0.5)).toBe('skill4');
    // 戦いが止んだか（構えを解くか）は、溜めの遅れ（lag）ではなく、次の番の遅れ（turnLag）を引いた経過で見る
    expect(at('brave', { cdFull: 0.8, since: 3.0, lag: 2.5, cd: -2.2 })).toBe('idle0');
  });

  it('足止めで次の番が遅れた分（turnLag）は、戦いが止んだか（構えを解くか）の判定で経過から引く（戦いの計算と同じ）', () => {
    // 攻撃の間隔0.8秒＋1.5秒の窓を、経過3.0秒は超えるが、遅れ1.0秒を引いた2.0秒は超えない
    expect(at('brave', { cdFull: 0.8, since: 3.0, cd: -0.1 })).toBe('idle0');
    expect(at('brave', { cdFull: 0.8, since: 3.0, turnLag: 1.0, cd: -0.1 })).toBe('attack1');
    // 次の番がスキルなら、スキルの構え
    expect(at('brave', { cdFull: 0.8, since: 3.0, turnLag: 1.0, cd: -0.1, skillNext: true })).toBe('skill1');
    // 遅れを引いても窓を超えたら、構えを解く
    expect(at('brave', { cdFull: 0.8, since: 3.0, turnLag: 0.5, cd: -0.1 })).toBe('idle0');
  });

  it('スキルのコマを持たない駒は、スキルの番でも攻撃のコマを出す', () => {
    expect(at('sage', { cdFull: 4, cd: 0.05, since: 3.95, skillNext: true })).toBe('attack1');
    expect(at('sage', { cdFull: 4, cd: 4, since: 0, skillLast: true })).toBe('attack2');
  });

  it.each(SKILLED)(
    '%s：区切りは溜めと攻撃の間隔に収まり、4倍速でもどのコマも描画1回分（1/60秒）より長く出る',
    (kind) => {
      const { g, tm, atk, windup } = of(kind);
      if (tm.hold) {
        // 三段撃ち：溜めのあいだ狙う形のまま、1発ごとに後の3コマを1つずつ出す（撃った時刻が、そのコマの内に入る）
        const n = g.skillVolley ?? 1;
        expect(n).toBe(3);
        expect(tm.hold).toBeCloseTo(windup, 9);
        const starts = [tm.hold, tm.post[0], tm.post[1]];
        for (let i = 0; i < n; i++) {
          const shot = windup + i * (g.skillVolleyGap ?? 0);
          expect(shot).toBeGreaterThanOrEqual(starts[i] - 1e-9);
          expect(shot).toBeLessThan(tm.post[i]);
        }
      }
      // 溜めが終わって効くまで、後の3コマの2つ目を出したまま
      else expect(windup).toBeLessThanOrEqual(tm.post[1]);
      // スキルの構えは、前の攻撃の後の3コマが終わってから出る
      expect(atk.post[2] + tm.pre[0]).toBeLessThan(g.cd);
      // スキルの後の3コマは、次の攻撃の構えより前に終わる
      expect(tm.post[2] + atk.pre[0]).toBeLessThan(skillSpan(g) + g.cd);
      const { pre, post } = tm;
      const h = tm.hold ?? 0;
      const lens = [pre[0] - pre[1], pre[1], post[0] - h, post[1] - post[0], post[2] - post[1]];
      for (const l of lens) expect(l).toBeGreaterThan(4 / 60);
    },
  );
});

describe('パネルと兵種の画面に出す全身（bigBodyBox）', () => {
  // 兵種の画面は60ドット四方、パネルのボタンは横を詰めた横44×縦60ドット
  it.each(BIG_KINDS.flatMap((kind) => [[kind, 60, 60] as const, [kind, 44, 60] as const]))(
    '%s：%i×%i の切り出す枠は絵の中に収まり、足元を含み、置く位置は枠の中',
    (kind, w, h) => {
      const d = bigData(kind);
      const b = bigBodyBox(kind, w, h);
      expect(b.x0).toBeGreaterThanOrEqual(0);
      expect(b.x0 + b.w).toBeLessThanOrEqual(d.w);
      expect(b.y0).toBeGreaterThanOrEqual(0);
      expect(b.y0 + b.h).toBeLessThanOrEqual(d.h);
      expect(b.y0 + b.h).toBeGreaterThan(d.foot);
      expect(b.dx).toBeGreaterThanOrEqual(0);
      expect(b.dx + b.w).toBeLessThanOrEqual(w);
      expect(b.dy + b.h).toBe(h);
    },
  );

  it('武将の絵は枠いっぱいに切り出し、ずらさない。兵の絵は枠より低いので、下にそろえて置く', () => {
    for (const kind of BIG_KINDS.filter(isGeneralKind)) {
      const b = bigBodyBox(kind, 44, 60);
      expect([b.w, b.h, b.dx, b.dy]).toEqual([44, 60, 0, 0]);
    }
    const inf = bigBodyBox('inf', 44, 60);
    expect([inf.w, inf.h]).toEqual([44, bigData('inf').h]);
    expect(inf.dy).toBeGreaterThan(0);
  });
});

describe('体力の棒の高さ（bigBarDots）', () => {
  it('兵は幟を持たないので、頭の上の端の2ドット上に出す。武将の幟より低い', () => {
    const d = bigData('inf');
    expect(d.top).toBeDefined();
    expect(bigBarDots('inf')).toBe(d.foot - (d.top ?? 0) + 2);
    for (const kind of BIG_KINDS.filter(isGeneralKind)) expect(bigBarDots(kind)).toBeGreaterThan(bigBarDots('inf'));
  });
});

describe('兵の大きさと、矢の出る所', () => {
  it('武将は割合1。兵は背丈を武将の背丈（38ドット）で割った割合で、歩いて戦う兵（背丈20ドットほど）は武将より小さい', () => {
    for (const kind of BIG_KINDS) {
      const d = bigData(kind);
      if (isGeneralKind(kind)) expect(bigScale(kind), kind).toBe(1);
      else expect(bigScale(kind), kind).toBeCloseTo((d.foot - (d.top ?? 0)) / 38);
    }
    for (const kind of ['inf', 'arc', 'eng', 'shd', 'scout'] as const) expect(bigScale(kind), kind).toBeLessThan(1);
  });

  it('弓兵は、武将の値ではなく、絵から書き出した所から矢を出す', () => {
    expect(bigMuzzle('arc')).toEqual(bigData('arc').muzzle);
    expect(bigMuzzle('inf')).toBeNull();
  });
});
