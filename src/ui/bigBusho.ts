// 3頭身で、斜め前と斜め後ろの2方向を描いた武将と兵の駒。武将は背丈38ドット（上杉謙信・織田信長・大島光義・真田昌幸・豊臣秀吉・徳川家康・武田信玄）、
// 兵は武将の半分ほどの背丈20ドットほど（歩兵・弓兵・工兵・盾兵・斥候。騎兵は28ドット、衝車は26ドットほど）。
// 左向きは貼るときに反転する。絵は武将ごとのデータ（kenshinFrames.ts など）から作り、朱や赤の飾りは軍の色に塗り替える。
// 武将の背中の幟は、字が裏返らないよう体とは別の絵にし、コマごとの位置（flag）に立てる。家紋は pixel.ts の表（bushoMon）から取る。兵は幟を持たない
import { ATTACK_ENGAGED, type AttackerKind } from '../sim';
import { ASHIGARU } from './ashigaruFrames';
import { HIDEYOSHI } from './hideyoshiFrames';
import { IEYASU } from './ieyasuFrames';
import { KENSHIN } from './kenshinFrames';
import { KIBA } from './kibaFrames';
import { KOUHEI } from './kouheiFrames';
import { MASAYUKI } from './masayukiFrames';
import { MITSUYOSHI } from './mitsuyoshiFrames';
import { MONOMI } from './monomiFrames';
import { NOBUNAGA } from './nobunagaFrames';
import { bushoMon, shotWeapon, specOf } from './pixel';
import { SHINGEN } from './shingenFrames';
import { SHOSHA } from './shoshaFrames';
import { TATE } from './tateFrames';
import { YUMI } from './yumiFrames';

export type BigView = 'front' | 'back';
// skill はスキルのコマ（スキルを持つ武将だけが持つ。持たない駒は攻撃のコマで代える）
export type BigAction = 'idle' | 'walk' | 'attack' | 'hurt' | 'fall' | 'skill';
type Frames<T> = Readonly<
  Record<BigView, Readonly<Record<Exclude<BigAction, 'skill'>, readonly T[]> & { skill?: readonly T[] }>>
>;
export interface BigData {
  w: number;
  h: number;
  foot: number; // 足元の行
  top?: number; // 兵の頭の上の端の行（幟のない兵の、体力の棒を出す高さに使う）
  muzzle?: { up: number; fwd: number }; // 弓の兵の矢が出る所（BIG_MUZZLE と同じ測り方）
  ch: string; // 色の文字の並び（何番目の色か）
  pal: readonly string[];
  team: readonly number[]; // 軍の色に塗り替える色（暗い順に4段）の番号。使わない段は -1
  frames: Frames<readonly string[]>;
  flag: Frames<readonly [number, number] | null>;
}
const BIG: Record<AttackerKind, BigData> = {
  brave: KENSHIN,
  gunner: NOBUNAGA,
  archer: MITSUYOSHI,
  sage: MASAYUKI,
  builder: HIDEYOSHI,
  guard: IEYASU,
  rider: SHINGEN,
  inf: ASHIGARU,
  arc: YUMI,
  cav: KIBA,
  ram: SHOSHA,
  eng: KOUHEI,
  shd: TATE,
  scout: MONOMI,
};

export const bigData = (kind: AttackerKind): Readonly<BigData> => BIG[kind];
// 絵の大きさ（ドット）と、足元の位置（絵の幅・高さに対する割合。y は下から）
export function bigSize(kind: AttackerKind) {
  const d = bigData(kind);
  return { w: d.w, h: d.h, cx: 0.5, cy: (d.h - d.foot) / d.h };
}
// 体力の棒を出す高さ（ドット）：武将は幟の上の端（待機のコマで一番高い所）の少し上、兵は頭の上の端の少し上
export function bigBarDots(kind: AttackerKind) {
  const d = bigData(kind);
  if (d.top !== undefined) return d.foot - d.top + 2;
  const ys = [...d.flag.front.idle, ...d.flag.back.idle].flatMap((a) => (a ? [a[1]] : []));
  return d.foot - (ys.length ? Math.min(...ys) : d.foot - 40) + 2;
}
// 駒の大きさの、武将に対する割合：兵は背丈（足元から頭の上の端まで）を、武将の背丈38ドットで割る
export const bigScale = (kind: AttackerKind) => {
  const d = bigData(kind);
  return d.top === undefined ? 1 : (d.foot - d.top) / 38;
};
// 飛び道具の出る所（ドット）：構えたときの、足元からの高さと、撃つ向きへの前のずれ。
// 鉄砲は肩の高さの銃口、弓は引き絞った弓の握り（武将の値。兵は絵のデータの muzzle）
export const BIG_MUZZLE = { gun: { up: 20, fwd: 8 }, bow: { up: 21, fwd: 10 } };
// スキルだけで飛び道具を使う武将（光義）は、スキルの武器で決める
export const bigMuzzle = (kind: AttackerKind) => {
  const w = shotWeapon(kind);
  if (!w) return null;
  // 兵は武将より小さいので、絵から書き出した所を使う
  return bigData(kind).muzzle ?? BIG_MUZZLE[w];
};
// スキルのコマを持つか
export const bigHasSkill = (kind: AttackerKind) => !!bigData(kind).frames.front.skill;
// 絵の表で引く動き：スキルのコマを持たない駒は、攻撃のコマで代える
const actionOf = (kind: AttackerKind, action: BigAction) =>
  action === 'skill' && !bigHasSkill(kind) ? 'attack' : action;
// コマの表（frames）と幟の位置の表（flag）のどちらからも、同じ決まりで引く
const pick = <T>(
  f: Readonly<Record<Exclude<BigAction, 'skill'>, readonly T[]> & { skill?: readonly T[] }>,
  kind: AttackerKind,
  action: BigAction,
) => {
  const a = actionOf(kind, action);
  return a === 'skill' ? (f.skill ?? f.attack) : f[a];
};
const rowsOf = (kind: AttackerKind, view: BigView, action: BigAction) => pick(bigData(kind).frames[view], kind, action);
export const bigFrames = (kind: AttackerKind, view: BigView, action: BigAction) => rowsOf(kind, view, action).length;
// 武将と兵（並びは BIG に書いた順）と、その絵のデータ（モーションの確かめのページが使う）
export const BIG_KINDS = Object.keys(BIG) as AttackerKind[];

// 攻撃のコマの区切り（戦闘の秒）。攻撃は前の2コマと後の3コマに分ける。
// pre：次に攻撃できるまでの残りがこれを切ったら、前の1コマ目・2コマ目
//   （刀は溜め・振りかぶり、槍は構える・引く、槌は構える・振りかぶる、盾は構える・引く、手を振る（斥候）は手を上げる・振る、衝車は引く・溜める、弓はつがえる・引き絞る、軍配の采配は構える・掲げる）
// post：攻撃した時刻からの経過で、後の3コマの終わり
//   （刀は踏み込み斬り・振り抜き・残心、槍は突く・伸ばす・戻す、槌は打ち下ろす・打ち込む・戻す、盾は押す・押し込む・戻す、
//    手を振るのは振る・振る・下ろす、衝車は突く・打ちつける・戻す、弓は放つ・残身・下ろす、
//    軍配の采配は振り下ろす・指す・下ろす）
// 前の2コマと後の3コマを足した長さは、攻撃の間隔（刀 0.8秒・槍 0.8秒・槌 0.8秒・盾 1.0秒・手を振る 1.0秒・衝車 1.6秒・弓 0.9秒・采配は昌幸 4.0秒・信玄 3.0秒・軍配で打つ 0.9秒）より短くする。
// 離れた所を指す軍配の武将（昌幸・信玄）は、采配（fan）の区切りを使う。采配は、攻撃した時刻に円や帯が出て、
// 溜め（windup 0.6秒）のあとに働くので、働くまで指したままにする。
// 近くを打つ軍配の武将（家康）は、軍配で打つ（baton：構える・振りかぶる・打ち下ろす・打ち込む・戻す）の区切りを使う
export const ATTACK_TIME = {
  sword: { pre: [0.28, 0.14], post: [0.14, 0.28, 0.48] },
  spear: { pre: [0.28, 0.14], post: [0.14, 0.28, 0.48] },
  mallet: { pre: [0.28, 0.14], post: [0.14, 0.28, 0.48] },
  shield: { pre: [0.32, 0.16], post: [0.14, 0.3, 0.56] },
  wave: { pre: [0.32, 0.16], post: [0.14, 0.3, 0.56] },
  ram: { pre: [0.5, 0.25], post: [0.15, 0.4, 0.8] },
  bow: { pre: [0.36, 0.18], post: [0.1, 0.24, 0.46] },
  fan: { pre: [0.5, 0.25], post: [0.15, 0.6, 1.0] },
  baton: { pre: [0.28, 0.14], post: [0.14, 0.28, 0.48] },
} as const;
// スキルのコマの区切り（戦闘の秒）。スキルを持つ武将ごとに持つ。考え方は攻撃と同じで、前の2コマは次の番までの残りで、
// 後の3コマはスキルを出した時刻から出す。後の3コマの2つ目は、溜め（skillWindup）が終わって効くまで出したままにする。
// 前の2コマは、前の攻撃の後の3コマが終わってから出るよう、攻撃の間隔に収める。
// 後の3コマは、次の攻撃の前の2コマより前に終える（スキルのあとは、溜めと攻撃の間隔を足した時間で次の番が来る）
// hold を持つものは、スキルを出した時刻からその秒数のあいだ（溜めのあいだ）前の2コマ目を出したままにし、後の3コマは
// hold のあとから出す（信長の三段撃ちは、狙ったまま溜めて、溜めのあとの3発に後の3コマを1つずつ当てる）
type Timing = {
  readonly pre: readonly [number, number];
  readonly post: readonly [number, number, number];
  readonly hold?: number;
};
export const SKILL_TIME: Partial<Record<AttackerKind, Timing>> = {
  // 徳川家康の軍配：構える・掲げる → 振り下ろす・指す（輪が広がる溜め0.6秒のあいだ）・下ろす
  guard: { pre: [0.36, 0.18], post: [0.15, 0.6, 0.8] },
  // 上杉謙信の回転斬り：構える・溜める → 薙ぐ・斬り抜く（溜め0.3秒のあいだ）・残心
  brave: { pre: [0.28, 0.14], post: [0.1, 0.3, 0.5] },
  // 大島光義の弓：つがえる・引き絞る → 狙う（溜め0.36秒のあいだ）・放つ（矢が出る時）・下ろす。
  // 矢は溜めが終わった時に出るので、後の3コマの1つ目を溜めのあいだ出す
  archer: { pre: [0.36, 0.18], post: [0.36, 0.46, 0.66] },
  // 織田信長の三段撃ち：構える・狙う（溜め0.7秒のあいだ狙ったまま）→ 撃つ・撃つ・撃つ（0.7秒・0.9秒・1.1秒に1発ずつ）
  gunner: { pre: [0.36, 0.18], hold: 0.7, post: [0.9, 1.1, 1.4] },
  // 豊臣秀吉の刀狩：構える・掲げる（溜め0.4秒のあいだ掲げたまま）→ 突き立てる（効いた時）・押し込む・残心
  builder: { pre: [0.36, 0.18], hold: 0.4, post: [0.55, 0.7, 0.95] },
};
// スキルの区切り。スキルを持たない駒は、攻撃の区切りで代える
export const skillTime = (kind: AttackerKind): Timing => SKILL_TIME[kind] ?? ATTACK_TIME[bigWeapon(kind)];
export type BigWeapon = keyof typeof ATTACK_TIME;
export const bigWeapon = (kind: AttackerKind): BigWeapon => {
  const w = specOf(kind).weapon;
  if (w === 'fan' || w === 'baton' || w === 'bow' || w === 'spear' || w === 'mallet' || w === 'shield') return w;
  // 衝車は丸太を打ちつけ、持ち物のない兵（斥候）は手を振る
  if (specOf(kind).cart) return 'ram';
  return w === 'none' ? 'wave' : 'sword';
};
// 次の番が来られるようになってから構え続ける時間（これを過ぎたら戦いが止んだとみなして構えを解く）。
// 戦いの計算も、これを過ぎたらスキルの番を決め直すので、値は src/sim/defs.ts に置く
export { ATTACK_ENGAGED };
// 待機のコマを進める間隔（実際のミリ秒）
export const BIG_IDLE_MS = 320;

// コマを選ぶのに使う、駒の今の様子（renderer.ts の Pose のうち、ここで使うもの）
export interface BigPose {
  fall: number; // 倒れる動きの進み 0〜1（倒れていなければ -1）
  mv: number; // 動いている度合い 0〜1
  phase: number; // 歩いた歩数
  cd: number; // 次に攻撃できるまでの残り（戦闘の秒）。分からなければ -1
  cdFull: number; // 攻撃の間隔（戦闘の秒）。分からなければ 0
  since: number; // 最後に攻撃した時刻からの経過（戦闘の秒。攻撃していなければ -1）
  // since のうち、足止めで溜めが遅れた分（戦闘の秒）。後の3コマの区切りは、since からこれを引いた溜めの進みで選ぶ
  lag?: number;
  // 次の番が来られるようになってからの経過（戦闘の秒。待っているあいだは -1）。戦いが止んだか（構えを解くか）は、
  // 戦いの計算と同じく、これが ATTACK_ENGAGED を過ぎたかで見る。渡されなければ、残り（cd）が0を切ってからの分とみる
  // （残りは鼓楼や足止めで減る速さが変わるので、その時は実際の経過とずれる。渡さないのは、どちらもない確かめのページ）
  ready?: number;
  skillNext?: boolean; // 次の番がスキル（前の2コマにスキルの構えを出す）
  skillLast?: boolean; // 最後の動きがスキル（後の3コマにスキルの発動を出す）
}
// 今出すコマ。fade は薄さの倍率（倒れて消えていくとき 1 から 0 へ）
export interface BigFrame {
  action: BigAction;
  i: number;
  fade: number;
}
// 今出すコマを選ぶ。選ぶ順は、倒れ → 攻撃の前の2コマ → 攻撃の後の3コマ → 被弾 → 歩き → 待機。
// flash は傷を受けた光の残りのティック数（4 から1ずつ減る）、nowMs は実際の時刻（待機のコマを進める）
export function bigFrame(kind: AttackerKind, pose: BigPose | undefined, flash: number, nowMs: number): BigFrame {
  // スキルの番は、スキルのコマと区切りを使う。next は次の番（前の2コマ）、last は最後の動き（後の3コマ）
  const atk = ATTACK_TIME[bigWeapon(kind)];
  const skill = bigHasSkill(kind);
  const nextSkill = skill && !!pose?.skillNext;
  const lastSkill = skill && !!pose?.skillLast;
  const next: Timing = nextSkill ? skillTime(kind) : atk;
  const last: Timing = lastSkill ? skillTime(kind) : atk;
  // 攻撃してからの溜めの進み（足止めで遅れた分を引いた経過）。後の3コマの区切りはこれで選ぶ
  const prog = pose && pose.since >= 0 ? Math.max(0, pose.since - (pose.lag ?? 0)) : -1;
  if (pose && pose.fall >= 0) {
    const f = pose.fall;
    return { action: 'fall', i: f < 0.18 ? 0 : f < 0.4 ? 1 : 2, fade: f < 0.55 ? 1 : 1 - (f - 0.55) / 0.45 };
  }
  if (
    pose &&
    pose.mv <= 0.3 &&
    pose.cdFull > 0 &&
    pose.cd < next.pre[0] &&
    (pose.since < 0 || prog >= last.post[2]) &&
    ((pose.since >= 0 && (pose.ready ?? -pose.cd) < ATTACK_ENGAGED) || pose.cd > 0)
  )
    // 次に攻撃できるまでの残りで構える。残りが pre[0] を切ったら前の1コマ目（0）、pre[1] を切ったら2コマ目（1）。
    // 攻撃するまでその形で待つ。構えるのは、戦っている間（次の番が来られるようになってから、少しの時間の内）か、
    // 残りが0より大きいとき。どの駒も構える時間を持たないので、戦い始めの1回目は前の2コマを出さない。
    // まだ攻撃していない武将（開戦前や、持ち場で敵を待つ守り）は、残りが0以下なので待機の姿のまま
    return { action: nextSkill ? 'skill' : 'attack', i: pose.cd < next.pre[1] ? 1 : 0, fade: 1 };
  // 溜めのあいだ前の2コマ目を出したままにするスキル（三段撃ち）は、溜めが終わるまで狙う形
  if (pose && lastSkill && last.hold && pose.since >= 0 && prog < last.hold) return { action: 'skill', i: 1, fade: 1 };
  if (pose && pose.since >= 0 && prog < last.post[2])
    // 攻撃した時刻（弾が出る・傷を与える瞬間）から、後の3コマ（2・3・4）を出す。
    // 攻撃の動き（SLASH_TIME）より長く出して、速さを上げても見えるようにする
    return {
      action: lastSkill ? 'skill' : 'attack',
      i: prog < last.post[0] ? 2 : prog < last.post[1] ? 3 : 4,
      fade: 1,
    };
  // 被弾：光の残りの前の半分は「のけぞり（0）」、後の半分は「立て直し（1）」
  if (flash > 0) return { action: 'hurt', i: flash >= 3 ? 0 : 1, fade: 1 };
  if (pose && pose.mv > 0.3) return { action: 'walk', i: Math.floor(pose.phase * 4) % 4, fade: 1 };
  return { action: 'idle', i: Math.floor(nowMs / BIG_IDLE_MS), fade: 1 };
}

// 1行の「色の文字＋続く数」を、色の番号の並び（空きは -1）に戻す
function decode(row: string, ch: string): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < row.length) {
    const c = row[i++];
    let n = '';
    while (i < row.length && row[i] >= '0' && row[i] <= '9') n += row[i++];
    const v = c === '.' ? -1 : ch.indexOf(c);
    for (let k = 0; k < (n ? Number(n) : 1); k++) out.push(v);
  }
  return out;
}

// パネルのボタンや兵種の画面で見せるコマ
export interface BigPick {
  action: BigAction;
  i: number;
}
export const BIG_STAND: BigPick = { action: 'idle', i: 0 }; // 止まった姿（待機の構え）
// 大きな絵の武将と兵の全身を、等倍（1ドットを cv の1点の dpr 倍）で w × h ドットに切り出して cv に描く（パネルのボタンと兵種の画面）
export function drawBigBody(
  ctx: CanvasRenderingContext2D,
  cv: HTMLCanvasElement,
  kind: AttackerKind,
  f: BigPick,
  color: string,
  w: number,
  h = w,
) {
  const b = bigBodyBox(kind, w, h);
  const kx = cv.width / w;
  const ky = cv.height / h;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    bigSprite(kind, 'front', f.action, f.i, color),
    b.x0,
    b.y0,
    b.w,
    b.h,
    b.dx * kx,
    b.dy * ky,
    b.w * kx,
    b.h * ky,
  );
}
// パネルのボタンと兵種の画面に出す全身：絵の中で切り出す枠（左上 x0・y0 と大きさ w・h）と、それを置く w × h ドットの中の位置（dx・dy）。
// 横は絵の真ん中、縦は足元の少し下までを入れる。絵が w × h より小さい兵は、絵の全体を、横は真ん中・縦は下にそろえて置く
export function bigBodyBox(kind: AttackerKind, w: number, h = w) {
  const d = bigData(kind);
  const sw = Math.min(w, d.w);
  const sh = Math.min(h, d.h);
  return {
    x0: Math.round(d.w / 2 - sw / 2),
    y0: Math.max(0, Math.min(d.h - sh, Math.round(d.foot) + 3 - sh)),
    w: sw,
    h: sh,
    dx: Math.round((w - sw) / 2),
    dy: h - sh,
  };
}

// 軍の色から、暗い順に4段の色を作る
function teamRamp(side: string): string[] {
  const n = Number.parseInt(side.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const hex = (f: (v: number) => number) =>
    `#${rgb
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(f(v))))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`;
  return [hex((v) => v * 0.42), hex((v) => v * 0.7), hex((v) => v), hex((v) => v + (255 - v) * 0.4)];
}

const wrap = (i: number, n: number) => ((i % n) + n) % n;
const cache = new Map<string, HTMLCanvasElement>();
// 1コマの画像。white なら、傷を受けたときに重ねる白い形
export function bigSprite(
  kind: AttackerKind,
  view: BigView,
  action: BigAction,
  i: number,
  side: string,
  white = false,
): HTMLCanvasElement {
  const d = bigData(kind);
  const rows = rowsOf(kind, view, action);
  const n = wrap(i, rows.length);
  const key = `${kind}|${view}|${actionOf(kind, action)}|${n}|${white ? 'w' : side}`;
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = d.w;
  c.height = d.h;
  const x2 = c.getContext('2d');
  if (x2) {
    const team = teamRamp(side);
    const color = (v: number) => {
      if (white) return '#fff';
      const t = d.team.indexOf(v);
      return t >= 0 ? team[t] : d.pal[v];
    };
    rows[n].forEach((row, y) => {
      decode(row, d.ch).forEach((v, x) => {
        if (v < 0) return;
        x2.fillStyle = color(v);
        x2.fillRect(x, y, 1, 1);
      });
    });
  }
  cache.set(key, c);
  return c;
}

// 幟：竿（BIG_FLAG_H 段）・横木・白い布（9×14）・軍の色の帯・家紋。竿だけ長い
export const BIG_FLAG_W = 11;
export const BIG_FLAG_H = 44;
const FLAG_COLORS: Record<string, string> = { K: '#1c1a18', W: '#f4f0e4', w: '#c9c1ad', P: '#4a3a28', G: '#e0b84e' };
export function bigFlagSprite(kind: AttackerKind, side: string): HTMLCanvasElement {
  const { mon, pix } = bushoMon(kind);
  const key = `flag|${mon}|${side}`;
  let c = cache.get(key);
  if (c) return c;
  const g = Array.from({ length: BIG_FLAG_H }, () => Array<string>(BIG_FLAG_W).fill(''));
  const rect = (x: number, y: number, w: number, h: number, v: string) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) g[y + j][x + i] = v;
  };
  rect(0, 0, 1, BIG_FLAG_H, 'P');
  rect(0, 0, 10, 1, 'P');
  rect(1, 1, 9, 14, 'W');
  rect(9, 3, 1, 12, 'w');
  rect(1, 1, 9, 2, 'A');
  // 家紋は布の中ほどに置く
  const pw = Math.max(0, ...pix.map((r) => r.length));
  const ox = 1 + Math.floor((8 - pw) / 2);
  const oy = 4 + Math.floor((9 - pix.length) / 2);
  pix.forEach((row, j) => {
    [...row].forEach((v, i) => {
      if (v !== '.') g[oy + j][ox + i] = v;
    });
  });
  // 色のあるドットのまわりに輪郭を付ける
  const add: [number, number][] = [];
  for (let y = 0; y < BIG_FLAG_H; y++)
    for (let x = 0; x < BIG_FLAG_W; x++) {
      if (g[y][x]) continue;
      const near = (i: number, j: number) =>
        i >= 0 && j >= 0 && i < BIG_FLAG_W && j < BIG_FLAG_H && g[j][i] !== '' && g[j][i] !== 'K';
      if (near(x - 1, y) || near(x + 1, y) || near(x, y - 1) || near(x, y + 1)) add.push([x, y]);
    }
  for (const [x, y] of add) g[y][x] = 'K';
  g[0][0] = 'G'; // 竿頭
  c = document.createElement('canvas');
  c.width = BIG_FLAG_W;
  c.height = BIG_FLAG_H;
  const x2 = c.getContext('2d');
  if (x2)
    g.forEach((row, y) => {
      row.forEach((v, x) => {
        if (!v) return;
        x2.fillStyle = v === 'A' ? side : FLAG_COLORS[v];
        x2.fillRect(x, y, 1, 1);
      });
    });
  cache.set(key, c);
  return c;
}
// そのコマで幟の竿の上の端を置く位置（体の絵の中のドット。反転していないとき）。幟を立てないコマは null
export function bigFlagAt(
  kind: AttackerKind,
  view: BigView,
  action: BigAction,
  i: number,
): readonly [number, number] | null {
  const list = pick(bigData(kind).flag[view], kind, action);
  return list[wrap(i, list.length)];
}
