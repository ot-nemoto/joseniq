import { describe, expect, it } from 'vitest';
import { ADEF, GDEF, isGeneralKind } from '../sim';
import {
  ATTACK_TIME,
  BIG_KINDS,
  type BigPose,
  bigBarDots,
  bigBodyBox,
  bigData,
  bigFrame,
  bigMuzzle,
  bigScale,
  bigWeapon,
} from './bigBusho';

const pose = (o: Partial<BigPose>): BigPose => ({ fall: -1, mv: 0, phase: 0, cd: -1, cdFull: 0, since: -1, ...o });
const at = (kind: 'brave' | 'gunner' | 'archer', o: Partial<BigPose>, flash = 0) => {
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

  it('鉄砲：構える時間のあいだ（残りが0以上）は、まだ撃っていなくても、構える・狙うを出す', () => {
    const t = ATTACK_TIME.gun.pre;
    expect(at('gunner', { cdFull: 3, cd: t[0] - 0.01 })).toBe('attack0');
    expect(at('gunner', { cdFull: 3, cd: t[1] - 0.01 })).toBe('attack1');
  });

  it('弓：つがえる・引き絞るのあと、放つ・残身・下ろすを出す。区切りは攻撃の間隔の中に収まる', () => {
    const cd = 0.9;
    const tm = ATTACK_TIME.bow;
    expect(tm.pre[0] + tm.post[2]).toBeLessThan(cd);
    expect(at('archer', { cdFull: cd, cd: tm.pre[0] - 0.01 })).toBe('attack0');
    expect(at('archer', { cdFull: cd, cd: tm.pre[1] - 0.01 })).toBe('attack1');
    expect(at('archer', { cdFull: cd, since: 0, cd })).toBe('attack2');
    expect(at('archer', { cdFull: cd, since: tm.post[1] + 0.01, cd: cd - tm.post[1] - 0.01 })).toBe('attack4');
  });

  it('軍配は、火計の武将（昌幸）なら采配、近くを打つ武将（家康）なら打つ区切りを使い、どちらも攻撃の間隔に収まる', () => {
    expect(bigWeapon('sage')).toBe('fan');
    expect(bigWeapon('guard')).toBe('fanHit');
    expect(bigWeapon('rider')).toBe('fan');
    expect(ATTACK_TIME.fan.pre[0] + ATTACK_TIME.fan.post[2]).toBeLessThan(GDEF.sage.cd);
    expect(ATTACK_TIME.fan.pre[0] + ATTACK_TIME.fan.post[2]).toBeLessThan(GDEF.rider.cd);
    expect(ATTACK_TIME.fanHit.pre[0] + ATTACK_TIME.fanHit.post[2]).toBeLessThan(GDEF.guard.cd);
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

  it('まだ攻撃していない武将は、構える時間のあいだのほかは、待機の姿のまま（開戦前・敵を待つ守り）', () => {
    expect(at('brave', { cdFull: 0.8, cd: 0 })).toBe('idle0');
    expect(at('brave', { cdFull: 0.8, cd: -3 })).toBe('idle0');
    expect(at('gunner', { cdFull: 3, cd: 0 })).toBe('idle0');
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
    }
  });
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
