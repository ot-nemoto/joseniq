// 武将の動きの記録：前のコマとの差から、歩く・倒れるを読み取る。攻撃は戦闘の計算が記録した時刻を使う。
// 画面に依存しない部分だけをここに置き、描き方（姿勢）は renderer.ts で決める
import { type Battle, type GeneralKind, isGeneralKind } from '../sim';

export const SLASH_TIME = 0.4; // 攻撃の動きの長さ（戦闘の秒）
export const FALL_TIME = 1.1; // 倒れて消えるまでの長さ

export interface Motion {
  kind: GeneralKind;
  side: 'a' | 'd';
  x: number;
  y: number;
  walk: number; // 歩いた距離の合計（足の運びの位相）
  mv: number; // 動いている度合い 0〜1
  mx: number; // 最後に動いた向き（盤面の座標）
  my: number;
  atk: number; // 最後に攻撃した時刻（なければ -1）
  ax: number; // 攻撃した向き
  ay: number;
}
export interface Dying {
  kind: GeneralKind;
  side: 'a' | 'd';
  x: number;
  y: number;
  mx: number;
  my: number;
  t0: number;
}

function findEntity(b: Battle, id: number): { x: number; y: number } | null {
  for (const u of b.defenders) if (u.id === id) return u;
  for (const u of b.attackers) if (u.id === id) return u;
  for (const bd of b.buildings) if (bd.id === id) return { x: bd.x0 + bd.w / 2, y: bd.y0 + bd.h / 2 };
  return null;
}

export class MotionTracker {
  readonly motions = new Map<number, Motion>();
  dying: Dying[] = [];
  private of: Battle | null = null;
  private lastT = 0;
  private overAt: number | null = null; // 戦闘が終わったときの実際の時刻（ミリ秒）。終わっていなければ null

  // 動きの時計：戦闘の時間で進める（一時停止で止まり、倍速で速くなる）。
  // 戦闘が終わると戦闘の時間は止まるので、終わったあとは実際の時間で進め、倒れる動きを最後まで見せる
  private clock(b: Battle, now: number) {
    if (!b.over) {
      this.overAt = null;
      return b.t;
    }
    if (this.overAt === null) this.overAt = now;
    return b.t + (now - this.overAt) / 1000;
  }

  // 戦闘の状態を前のコマと比べ、動いた量・攻撃した時刻・消えた武将を記録する。now は実際の時刻（ミリ秒）。
  // 戻り値は動きの時計の値
  update(b: Battle, now: number): number {
    if (b !== this.of || b.t < this.lastT) {
      this.motions.clear();
      this.dying = [];
      this.of = b;
      this.overAt = null;
      this.lastT = b.t;
    }
    const elapsed = b.t - this.lastT;
    const seen = new Set<number>();
    for (const list of [b.defenders, b.attackers])
      for (const u of list) {
        if (!isGeneralKind(u.kind)) continue;
        seen.add(u.id);
        let m = this.motions.get(u.id);
        if (!m) {
          const mx = u.side === 'a' ? 1 : -1;
          m = {
            kind: u.kind,
            side: u.side,
            x: u.x,
            y: u.y,
            walk: 0,
            mv: 0,
            mx,
            my: 0,
            atk: -1,
            ax: 1,
            ay: 0,
          };
          this.motions.set(u.id, m);
        }
        const dx = u.x - m.x;
        const dy = u.y - m.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 1e-4) {
          m.walk += dist;
          m.mx = dx;
          m.my = dy;
        }
        if (elapsed > 0) m.mv += ((dist > 1e-4 ? 1 : 0) - m.mv) * 0.35;
        // 前のコマのあとに攻撃していたら、その時刻と狙った向きを記録する
        if (u.atkT > m.atk) {
          m.atk = u.atkT;
          const tg = findEntity(b, u.target);
          m.ax = tg ? tg.x - u.x : m.mx;
          m.ay = tg ? tg.y - u.y : m.my;
        }
        m.x = u.x;
        m.y = u.y;
      }
    const t = this.clock(b, now);
    // 記録にあって今いない武将は倒れた
    for (const [id, m] of this.motions) {
      if (seen.has(id)) continue;
      this.motions.delete(id);
      this.dying.push({ kind: m.kind, side: m.side, x: m.x, y: m.y, mx: m.mx, my: m.my, t0: t });
    }
    this.dying = this.dying.filter((d) => t - d.t0 < FALL_TIME);
    this.lastT = b.t;
    return t;
  }
}
