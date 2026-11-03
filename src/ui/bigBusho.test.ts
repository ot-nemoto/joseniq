import { describe, expect, it } from 'vitest';
import { ATTACK_TIME, type BigPose, bigFrame } from './bigBusho';

const pose = (o: Partial<BigPose>): BigPose => ({ fall: -1, mv: 0, phase: 0, cd: -1, cdFull: 0, since: -1, ...o });
const at = (kind: 'brave' | 'gunner', o: Partial<BigPose>, flash = 0) => {
  const f = bigFrame(kind, pose(o), flash, 0);
  return `${f.action}${f.i}`;
};

describe('大きな絵の武将のコマの選び方（bigFrame）', () => {
  it('刀：攻撃した時刻から、踏み込み斬り・振り抜き・残心を出し、そのあとは構えて待つ', () => {
    const cd = 0.8;
    const t = ATTACK_TIME.sword.post;
    const after = (since: number) => at('brave', { cdFull: cd, since, cd: cd - since });
    expect(after(0)).toBe('attack2');
    expect(after(t[0] + 0.01)).toBe('attack3');
    expect(after(t[1] + 0.01)).toBe('attack4');
    expect(after(t[2] + 0.01)).toBe('idle0');
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
