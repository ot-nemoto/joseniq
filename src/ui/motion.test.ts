import { describe, expect, it } from 'vitest';
import { type Battle, createBattle, DT, deploy, GDEF, preset, step } from '../sim';
import { FALL_TIME, isAttack, MotionTracker } from './motion';

// 本丸と、守りの上杉謙信だけの城
const kenshinCastle = () => {
  const l = preset('basic');
  return {
    buildings: l.buildings.filter((b) => b.type === 'hall'),
    generals: [{ kind: 'brave' as const, x: 4, y: 15 }],
  };
};
const defBrave = (b: Battle) => b.defenders.find((u) => u.kind === 'brave');

describe('攻撃の判定', () => {
  const cd = GDEF.brave.cd;
  it('間隔が0まで減ったあと、攻撃の間隔ちょうどに戻ったら攻撃', () => {
    expect(isAttack(0, cd, DT, cd)).toBe(true);
  });
  it('間隔が残っているときに伸びたのは、足止め', () => {
    expect(isAttack(0.5, 3, DT, cd)).toBe(false);
  });
  it('間隔が0でも、攻撃の間隔と違う値に伸びたのは、足止め', () => {
    expect(isAttack(0, 3, DT, cd)).toBe(false);
  });
  it('間隔が減っているだけなら、攻撃ではない', () => {
    expect(isAttack(0.5, 0.5 - DT, DT, cd)).toBe(false);
  });
});

describe('動きの記録', () => {
  it('忍びに足止めされても、攻撃の動きをしない', () => {
    const b = createBattle(kenshinCastle());
    deploy(b, 'ninja', 0, 15);
    const tr = new MotionTracker();
    let stuns = 0;
    let prevCd = 0;
    for (let i = 0; i < 3000 && !b.over; i++) {
      step(b);
      tr.update(b, b.t * 1000);
      const k = defBrave(b);
      if (!k || !b.attackers.length) break;
      // 足止めで間隔が伸びたコマ（攻撃の間隔と違う値に跳ねた）では、攻撃として記録しない
      if (k.cd > prevCd + 1e-6 && Math.abs(k.cd - GDEF.brave.cd) > 1e-6) {
        stuns++;
        expect(tr.motions.get(k.id)?.atk).not.toBe(b.t);
      }
      prevCd = k.cd;
    }
    expect(stuns).toBeGreaterThan(0);
  });

  it('攻撃したコマを記録する', () => {
    const b = createBattle(kenshinCastle());
    deploy(b, 'inf', 0, 15);
    const tr = new MotionTracker();
    let attacks = 0;
    for (let i = 0; i < 600 && !b.over; i++) {
      step(b);
      tr.update(b, b.t * 1000);
      const k = defBrave(b);
      if (k && tr.motions.get(k.id)?.atk === b.t) attacks++;
    }
    expect(attacks).toBeGreaterThan(0);
  });

  // 謙信どうしを戦わせ、どちらかが倒れるまで進める
  const fightToDeath = () => {
    const b = createBattle(kenshinCastle());
    deploy(b, 'brave', 0, 15);
    const tr = new MotionTracker();
    for (let i = 0; i < 6000; i++) {
      step(b);
      tr.update(b, b.t * 1000);
      if (!defBrave(b) || !b.attackers.some((u) => u.kind === 'brave')) break;
    }
    return { b, tr };
  };

  it('倒れた武将は、倒れる動きのあと消える', () => {
    const { b, tr } = fightToDeath();
    expect(tr.dying).toHaveLength(1);
    const t0 = b.t;
    while (b.t - t0 < FALL_TIME + 0.1) {
      step(b);
      tr.update(b, b.t * 1000);
    }
    expect(tr.dying).toHaveLength(0);
  });

  it('戦闘が終わったあとも、実際の時間で倒れる動きが進んで消える', () => {
    const { b, tr } = fightToDeath();
    b.over = true; // ここで戦闘の時間は止まる
    tr.update(b, 0);
    tr.update(b, 500);
    expect(tr.dying).toHaveLength(1);
    tr.update(b, (FALL_TIME + 0.1) * 1000);
    expect(tr.dying).toHaveLength(0);
  });

  it('一時停止中（戦闘の途中で時間が止まっている）は、倒れる動きも止まる', () => {
    const { b, tr } = fightToDeath();
    tr.update(b, 0);
    tr.update(b, 10_000);
    expect(tr.dying).toHaveLength(1);
  });
});
