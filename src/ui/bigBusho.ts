// 3頭身で、斜め前と斜め後ろの2方向を描いた武将と兵の駒。武将は背丈38ドット（上杉謙信・織田信長・大島光義・真田昌幸・豊臣秀吉・徳川家康・武田信玄）、
// 兵は武将の半分ほどの背丈20ドットほど（歩兵・弓兵・工兵・盾兵・斥候。騎兵は28ドット、衝車は26ドットほど）。
// 左向きは貼るときに反転する。絵は武将ごとのデータ（kenshinFrames.ts など）から作り、朱や赤の飾りは軍の色に塗り替える。
// 武将の背中の幟は、字が裏返らないよう体とは別の絵にし、コマごとの位置（flag）に立てる。家紋は pixel.ts の表（bushoMon）から取る。兵は幟を持たない
import { type AttackerKind, GDEF, isGeneralKind } from '../sim';
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
import { bushoMon, type Frame, specOf } from './pixel';
import { SHINGEN } from './shingenFrames';
import { SHOSHA } from './shoshaFrames';
import { TATE } from './tateFrames';
import { YUMI } from './yumiFrames';

export type BigView = 'front' | 'back';
export type BigAction = 'idle' | 'walk' | 'attack' | 'hurt' | 'fall';
type Frames<T> = Readonly<Record<BigView, Readonly<Record<BigAction, readonly T[]>>>>;
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

const dataOf = (kind: AttackerKind): BigData => BIG[kind];
// 絵の大きさ（ドット）と、足元の位置（絵の幅・高さに対する割合。y は下から）
export function bigSize(kind: AttackerKind) {
  const d = dataOf(kind);
  return { w: d.w, h: d.h, cx: 0.5, cy: (d.h - d.foot) / d.h };
}
// 体力の棒を出す高さ（ドット）：武将は幟の上の端（待機のコマで一番高い所）の少し上、兵は頭の上の端の少し上
export function bigBarDots(kind: AttackerKind) {
  const d = dataOf(kind);
  if (d.top !== undefined) return d.foot - d.top + 2;
  const ys = [...d.flag.front.idle, ...d.flag.back.idle].flatMap((a) => (a ? [a[1]] : []));
  return d.foot - (ys.length ? Math.min(...ys) : d.foot - 40) + 2;
}
// 駒の大きさの、武将に対する割合：兵は背丈（足元から頭の上の端まで）を、武将の背丈38ドットで割る
export const bigScale = (kind: AttackerKind) => {
  const d = dataOf(kind);
  return d.top === undefined ? 1 : (d.foot - d.top) / 38;
};
// 飛び道具の出る所（ドット）：構えたときの、足元からの高さと、撃つ向きへの前のずれ。
// 鉄砲は肩の高さの銃口、弓は引き絞った弓の握り（武将の値。兵は絵のデータの muzzle）
export const BIG_MUZZLE = { gun: { up: 20, fwd: 8 }, bow: { up: 21, fwd: 10 } };
export const bigMuzzle = (kind: AttackerKind) => {
  const w = specOf(kind).weapon;
  if (w !== 'gun' && w !== 'bow') return null;
  // 兵は武将より小さいので、絵から書き出した所を使う
  return dataOf(kind).muzzle ?? BIG_MUZZLE[w];
};
export const bigFrames = (kind: AttackerKind, view: BigView, action: BigAction) =>
  dataOf(kind).frames[view][action].length;
// 武将と兵（並びは BIG に書いた順）と、その絵のデータ（モーションの確かめのページが使う）
export const BIG_KINDS = Object.keys(BIG) as AttackerKind[];
export const bigData = (kind: AttackerKind): Readonly<BigData> => dataOf(kind);

// 攻撃のコマの区切り（戦闘の秒）。攻撃は前の2コマと後の3コマに分ける。
// pre：次に攻撃できるまでの残りがこれを切ったら、前の1コマ目・2コマ目
//   （刀は溜め・振りかぶり、槍は構える・引く、槌は構える・振りかぶる、盾は構える・引く、手を振る（斥候）は手を上げる・振る、衝車は引く・溜める、鉄砲は構える・狙う、弓はつがえる・引き絞る、軍配の采配は構える・掲げる、軍配で打つのは構える・振り上げる）
// post：攻撃した時刻からの経過で、後の3コマの終わり
//   （刀は踏み込み斬り・振り抜き・残心、槍は突く・伸ばす・戻す、槌は打ち下ろす・打ち込む・戻す、盾は押す・押し込む・戻す、
//    手を振るのは振る・振る・下ろす、衝車は突く・打ちつける・戻す、鉄砲は撃つ・反動・下ろす、弓は放つ・残身・下ろす、
//    軍配の采配は振り下ろす・指す・下ろす、軍配で打つのは打ち下ろす・振り抜く・戻す）
// 前の2コマと後の3コマを足した長さは、攻撃の間隔（刀 0.8秒・槍 0.8秒・槌 0.8秒・盾 1.0秒・手を振る 1.0秒・衝車 1.6秒・鉄砲 3.0秒・弓 0.9秒・采配 4.0秒・軍配で打つ 1.0秒）より短くする。
// 軍配は、範囲攻撃（火計）の武将（昌幸）なら采配（fan）、近くを打つ武将（家康）なら打つ（fanHit）の区切りを使う。
// 軍配（火計）は、攻撃した時刻に落ちる場所の円が出て、溜め（windup 0.6秒）のあとに火が出るので、火が出るまで指したままにする
export const ATTACK_TIME = {
  sword: { pre: [0.28, 0.14], post: [0.14, 0.28, 0.48] },
  spear: { pre: [0.28, 0.14], post: [0.14, 0.28, 0.48] },
  mallet: { pre: [0.28, 0.14], post: [0.14, 0.28, 0.48] },
  shield: { pre: [0.32, 0.16], post: [0.14, 0.3, 0.56] },
  wave: { pre: [0.32, 0.16], post: [0.14, 0.3, 0.56] },
  ram: { pre: [0.5, 0.25], post: [0.15, 0.4, 0.8] },
  gun: { pre: [0.7, 0.3], post: [0.22, 0.5, 0.95] },
  bow: { pre: [0.36, 0.18], post: [0.1, 0.24, 0.46] },
  fan: { pre: [0.5, 0.25], post: [0.15, 0.6, 1.0] },
  fanHit: { pre: [0.32, 0.16], post: [0.14, 0.3, 0.56] },
} as const;
export type BigWeapon = keyof typeof ATTACK_TIME;
export const bigWeapon = (kind: AttackerKind): BigWeapon => {
  const w = specOf(kind).weapon;
  if (w === 'fan') return isGeneralKind(kind) && GDEF[kind].aoe ? 'fan' : 'fanHit';
  if (w === 'gun' || w === 'bow' || w === 'spear' || w === 'mallet' || w === 'shield') return w;
  // 衝車は丸太を打ちつけ、持ち物のない兵（斥候）は手を振る
  if (specOf(kind).cart) return 'ram';
  return w === 'none' ? 'wave' : 'sword';
};
// 攻撃してから構え続ける時間の、攻撃の間隔への足し分（これを過ぎたら戦いが止んだとみなして構えを解く）
export const ATTACK_ENGAGED = 1.5;
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
  const tm = ATTACK_TIME[bigWeapon(kind)];
  if (pose && pose.fall >= 0) {
    const f = pose.fall;
    return { action: 'fall', i: f < 0.18 ? 0 : f < 0.4 ? 1 : 2, fade: f < 0.55 ? 1 : 1 - (f - 0.55) / 0.45 };
  }
  if (
    pose &&
    pose.mv <= 0.3 &&
    pose.cdFull > 0 &&
    pose.cd < tm.pre[0] &&
    (pose.since < 0 || pose.since >= tm.post[2]) &&
    ((pose.since >= 0 && pose.since < pose.cdFull + ATTACK_ENGAGED) || pose.cd > 0)
  )
    // 次に攻撃できるまでの残りで構える。残りが pre[0] を切ったら前の1コマ目（0）、pre[1] を切ったら2コマ目（1）。
    // 攻撃するまでその形で待つ。構えるのは、戦っている間（最後に攻撃してから、攻撃の間隔に少し足した時間の内）か、
    // 残りが0より大きいとき。構える時間（aim）を持つ武将は、しばらく攻撃していなかったら、戦いの計算が攻撃の前に
    // 構える時間をおくので、戦い始めの1回目もここで前の2コマを出す。まだ攻撃していない武将（開戦前や、持ち場で
    // 敵を待つ守り）は、残りが0以下なので待機の姿のまま
    return { action: 'attack', i: pose.cd < tm.pre[1] ? 1 : 0, fade: 1 };
  if (pose && pose.since >= 0 && pose.since < tm.post[2])
    // 攻撃した時刻（弾が出る・傷を与える瞬間）から、後の3コマ（2・3・4）を出す。
    // 攻撃の動き（SLASH_TIME）より長く出して、速さを上げても見えるようにする
    return { action: 'attack', i: pose.since < tm.post[0] ? 2 : pose.since < tm.post[1] ? 3 : 4, fade: 1 };
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

// パネルのボタンや兵種の画面で見せる姿（Frame）に当たる、大きな絵のコマ。walk0 は、歩いている途中（moving）なら
// 歩きの0コマ目、止まった姿なら待機の構え。攻撃は振りかぶり（溜めの次）・斬る（撃つ）・振り抜き（反動）、倒れは傾く・倒れ伏す
export function panelFrame(frame: Frame, moving = false): { action: BigAction; i: number } {
  if (frame === 'walk0' && !moving) return { action: 'idle', i: 0 };
  if (frame.startsWith('walk')) return { action: 'walk', i: Number(frame.slice(4)) };
  if (frame.startsWith('atk')) return { action: 'attack', i: Number(frame.slice(3)) + 1 };
  return { action: 'fall', i: frame === 'down0' ? 1 : 2 };
}
// 大きな絵の武将と兵の全身を、等倍（1ドットを cv の1点の dpr 倍）で w × h ドットに切り出して cv に描く（パネルのボタンと兵種の画面）
export function drawBigBody(
  ctx: CanvasRenderingContext2D,
  cv: HTMLCanvasElement,
  kind: AttackerKind,
  frame: Frame,
  moving: boolean,
  color: string,
  w: number,
  h = w,
) {
  const b = bigBodyBox(kind, w, h);
  const f = panelFrame(frame, moving);
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
  const d = dataOf(kind);
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
  const d = dataOf(kind);
  const rows = d.frames[view][action];
  const n = wrap(i, rows.length);
  const key = `${kind}|${view}|${action}|${n}|${white ? 'w' : side}`;
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

// 幟：竿（BIG_FLAG_H 段）・横木・白い布（9×14）・軍の色の帯・家紋。今の武将の幟と同じ作りで、竿だけ長い
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
  // 家紋は布の中ほどに置く（今の幟と同じ置き方）
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
  const list = dataOf(kind).flag[view][action];
  return list[wrap(i, list.length)];
}
