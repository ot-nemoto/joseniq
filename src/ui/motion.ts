// 武将と兵の動きの記録：前のコマとの差から、歩く・倒れるを読み取る。攻撃は戦闘の計算が記録した時刻と位置を使う。
// 画面に依存しない部分だけをここに置き、描き方（姿勢）は renderer.ts で決める
import type { AttackerKind, Battle } from '../sim';

export const SLASH_TIME = 0.4; // 攻撃の動きの長さ（戦闘の秒）
export const FALL_TIME = 1.1; // 倒れて消えるまでの長さ

export interface Motion {
  kind: AttackerKind;
  side: 'a' | 'd';
  x: number;
  y: number;
  walk: number; // 歩いた距離の合計（足の運びの位相）
  mv: number; // 動いている度合い 0〜1
  mx: number; // 最後に動いた向き（盤面の座標）
  my: number;
  // 一度でも動いたか攻撃したか。まだなら、向きは防衛配置と同じ画面の右向きにする（mx, my は使わない）
  turned: boolean;
  atk: number; // 最後に攻撃の動きを始めた時刻（なければ -1）
  ax: number; // 攻撃した向き
  ay: number;
}
export interface Dying {
  kind: AttackerKind;
  side: 'a' | 'd';
  x: number;
  y: number;
  mx: number;
  my: number;
  turned: boolean;
  t0: number;
}

// 画面の左右の向き（1 か -1）。dx は画面での向きの横の成分。
// 動きも攻撃もまだなら（turned が false）、防衛配置と同じ画面の右向き
export const faceOf = (turned: boolean, dx: number) => (turned && dx < 0 ? -1 : 1);

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

  // 戦闘の状態を前のコマと比べ、動いた量・攻撃した時刻・消えた武将と兵を記録する。now は実際の時刻（ミリ秒）。
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
        seen.add(u.id);
        let m = this.motions.get(u.id);
        if (!m) {
          m = {
            kind: u.kind,
            side: u.side,
            x: u.x,
            y: u.y,
            walk: 0,
            mv: 0,
            // turned が付くまでは使わない仮の向き
            mx: 1,
            my: 0,
            turned: false,
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
          m.turned = true;
        }
        if (elapsed > 0) m.mv += ((dist > 1e-4 ? 1 : 0) - m.mv) * 0.35;
        // 前のコマのあとに攻撃していたら、狙った向きを記録し、動きを始める。
        // 動きは攻撃した時刻ではなく今の時刻から始める（倍速では1コマで何度も計算が進み、
        // 攻撃した時刻から始めると、描く前に動きが終わってしまうことがある）
        if (u.atkT > this.lastT) {
          m.atk = b.t;
          m.ax = u.atkX - u.x;
          m.ay = u.atkY - u.y;
          // 動かずに初めて攻撃したときは、攻撃のあとも狙った向きを向いたままにする
          // （狙った位置が自分と同じで向きの長さがないときは、まだ決めない）
          if (!m.turned && Math.hypot(m.ax, m.ay) > 1e-6) {
            m.mx = m.ax;
            m.my = m.ay;
            m.turned = true;
          }
        }
        m.x = u.x;
        m.y = u.y;
      }
    const t = this.clock(b, now);
    // 記録にあって今いない武将・兵は倒れた
    for (const [id, m] of this.motions) {
      if (seen.has(id)) continue;
      this.motions.delete(id);
      this.dying.push({ kind: m.kind, side: m.side, x: m.x, y: m.y, mx: m.mx, my: m.my, turned: m.turned, t0: t });
    }
    this.dying = this.dying.filter((d) => t - d.t0 < FALL_TIME);
    this.lastT = b.t;
    return t;
  }
}
