import { describe, expect, it } from 'vitest';
import { type Battle, createBattle, DT, GDEF, preset } from '../sim';
import { FALL_TIME, isAttack, MotionTracker } from './motion';

// 戦闘は進めず、時刻や武将の状態を直接書き換えて記録のしかたを確かめる。
// こうすると、武将の体力や威力などのパラメータを調整しても、このテストは変わらない

// 本丸と、守りの上杉謙信だけの城（謙信は本丸の左にいる）
const kenshinBattle = () => {
  const l = preset('basic');
  const b = createBattle({
    buildings: l.buildings.filter((x) => x.type === 'hall'),
    generals: [{ kind: 'brave', x: 4, y: 15 }],
  });
  const u = b.defenders[0];
  u.cd = 0;
  return { b, u };
};
// 時刻を1コマ進めて記録する（実際の時刻は戦闘の時刻と同じにしておく）
const tick = (tr: MotionTracker, b: Battle) => {
  b.t += DT;
  tr.update(b, b.t * 1000);
};
const ATK_CD = GDEF.brave.cd;

describe('攻撃の判定', () => {
  it('間隔が0まで減ったあと、攻撃の間隔ちょうどに戻ったら攻撃', () => {
    expect(isAttack(0, ATK_CD, DT, ATK_CD)).toBe(true);
  });
  it('間隔が残っているときに伸びたのは、足止め', () => {
    expect(isAttack(0.5, ATK_CD + 2, DT, ATK_CD)).toBe(false);
  });
  it('間隔が0でも、攻撃の間隔と違う値に伸びたのは、足止め', () => {
    expect(isAttack(0, ATK_CD + 2, DT, ATK_CD)).toBe(false);
  });
  it('間隔が減っているだけなら、攻撃ではない', () => {
    expect(isAttack(0.5, 0.5 - DT, DT, ATK_CD)).toBe(false);
  });
});

describe('動きの記録', () => {
  it('攻撃したコマと、狙った向きを記録する', () => {
    const { b, u } = kenshinBattle();
    const tr = new MotionTracker();
    tr.update(b, 0);
    u.target = b.hallId; // 本丸（右側）を狙う
    u.cd = ATK_CD;
    tick(tr, b);
    const m = tr.motions.get(u.id);
    expect(m?.atk).toBe(b.t);
    expect(m?.ax).toBeGreaterThan(0);
  });

  it('足止めで間隔が伸びても、攻撃として記録しない', () => {
    const { b, u } = kenshinBattle();
    const tr = new MotionTracker();
    tr.update(b, 0);
    // 攻撃の間隔が残っているときの足止め
    u.cd = 0.5;
    tick(tr, b);
    u.cd = ATK_CD + 2;
    tick(tr, b);
    // 間隔が0のときの足止め
    u.cd = 0;
    tick(tr, b);
    u.cd = ATK_CD + 2;
    tick(tr, b);
    expect(tr.motions.get(u.id)?.atk).toBe(-1);
  });

  it('動いた向きと、動いている度合いを記録する', () => {
    const { b, u } = kenshinBattle();
    const tr = new MotionTracker();
    tr.update(b, 0);
    for (let i = 0; i < 10; i++) {
      u.x += 0.05;
      tick(tr, b);
    }
    const m = tr.motions.get(u.id);
    expect(m?.mx).toBeGreaterThan(0);
    expect(m?.walk).toBeCloseTo(0.5);
    expect(m?.mv).toBeGreaterThan(0.9);
    // 止まると、動いている度合いは下がる
    for (let i = 0; i < 10; i++) tick(tr, b);
    expect(tr.motions.get(u.id)?.mv).toBeLessThan(0.1);
  });

  // 武将を盤面から消して（倒れたことにして）、倒れる動きの記録を返す
  const killed = () => {
    const { b, u } = kenshinBattle();
    const tr = new MotionTracker();
    tr.update(b, 0);
    b.defenders = b.defenders.filter((x) => x !== u);
    tick(tr, b);
    return { b, tr };
  };

  it('倒れた武将は、倒れる動きのあと消える', () => {
    const { b, tr } = killed();
    expect(tr.dying).toHaveLength(1);
    expect(tr.dying[0].kind).toBe('brave');
    b.t += FALL_TIME / 2;
    tr.update(b, b.t * 1000);
    expect(tr.dying).toHaveLength(1);
    b.t += FALL_TIME;
    tr.update(b, b.t * 1000);
    expect(tr.dying).toHaveLength(0);
  });

  it('戦闘が終わったあとも、実際の時間で倒れる動きが進んで消える', () => {
    const { b, tr } = killed();
    b.over = true; // ここで戦闘の時間は止まる
    tr.update(b, 0);
    tr.update(b, (FALL_TIME / 2) * 1000);
    expect(tr.dying).toHaveLength(1);
    tr.update(b, (FALL_TIME + 0.1) * 1000);
    expect(tr.dying).toHaveLength(0);
  });

  it('一時停止中（戦闘の途中で時間が止まっている）は、倒れる動きも止まる', () => {
    const { b, tr } = killed();
    tr.update(b, 0);
    tr.update(b, 10_000);
    expect(tr.dying).toHaveLength(1);
  });

  it('別の戦闘に切り替えたら、記録をやり直す', () => {
    const { b, tr } = killed();
    const next = kenshinBattle();
    tr.update(next.b, b.t * 1000);
    expect(tr.dying).toHaveLength(0);
    expect([...tr.motions.keys()]).toEqual([next.u.id]);
  });
});
