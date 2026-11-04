// 試作：3頭身・背丈38ドットで、斜め前と斜め後ろの2方向を描いた武将の駒（今は上杉謙信・織田信長・大島光義・真田昌幸）。
// 左向きは貼るときに反転する。絵は武将ごとのデータ（kenshinFrames.ts など）から作り、朱や赤の飾りは軍の色に塗り替える。
// 背中の幟は、字が裏返らないよう体とは別の絵にし、コマごとの位置（flag）に立てる。家紋は今の駒と同じ表（bushoMon）から取る
import type { AttackerKind } from '../sim';
import { KENSHIN } from './kenshinFrames';
import { MASAYUKI } from './masayukiFrames';
import { MITSUYOSHI } from './mitsuyoshiFrames';
import { NOBUNAGA } from './nobunagaFrames';
import { bushoMon, specOf } from './pixel';

export type BigView = 'front' | 'back';
export type BigAction = 'idle' | 'walk' | 'attack' | 'hurt' | 'fall';
type Frames<T> = Readonly<Record<BigView, Readonly<Record<BigAction, readonly T[]>>>>;
export interface BigData {
  w: number;
  h: number;
  foot: number; // 足元の行
  ch: string; // 色の文字の並び（何番目の色か）
  pal: readonly string[];
  team: readonly number[]; // 軍の色に塗り替える色（暗い順に4段）の番号。使わない段は -1
  frames: Frames<readonly string[]>;
  flag: Frames<readonly [number, number] | null>;
}
const BIG: Partial<Record<AttackerKind, BigData>> = {
  brave: KENSHIN,
  gunner: NOBUNAGA,
  archer: MITSUYOSHI,
  sage: MASAYUKI,
};
// 描いたが、まだ盤面に入れていない武将（ユーザーの確認を得るまで、モーションの確かめのページだけに出す）
const DRAFT: Partial<Record<AttackerKind, BigData>> = {};

export const hasBig = (kind: AttackerKind) => kind in BIG;
export const isBigDraft = (kind: AttackerKind) => kind in DRAFT && !(kind in BIG);
const dataOf = (kind: AttackerKind): BigData => {
  const d = BIG[kind] ?? DRAFT[kind];
  if (!d) throw new Error(`大きな絵のない武将: ${kind}`);
  return d;
};
// 絵の大きさ（ドット）と、足元の位置（絵の幅・高さに対する割合。y は下から）
export function bigSize(kind: AttackerKind) {
  const d = dataOf(kind);
  return { w: d.w, h: d.h, cx: 0.5, cy: (d.h - d.foot) / d.h };
}
// 体力の棒を出す高さ（ドット）：幟の上の端（待機のコマで一番高い所）の少し上
export function bigBarDots(kind: AttackerKind) {
  const d = dataOf(kind);
  const ys = [...d.flag.front.idle, ...d.flag.back.idle].flatMap((a) => (a ? [a[1]] : []));
  return d.foot - (ys.length ? Math.min(...ys) : d.foot - 40) + 2;
}
// 飛び道具の出る所（ドット）：構えたときの、足元からの高さと、撃つ向きへの前のずれ。
// 鉄砲は肩の高さの銃口、弓は引き絞った弓の握り
export const BIG_MUZZLE = { gun: { up: 20, fwd: 8 }, bow: { up: 21, fwd: 10 } };
export const bigMuzzle = (kind: AttackerKind) => {
  const w = specOf(kind).weapon;
  return hasBig(kind) && (w === 'gun' || w === 'bow') ? BIG_MUZZLE[w] : null;
};
export const bigFrames = (kind: AttackerKind, view: BigView, action: BigAction) =>
  dataOf(kind).frames[view][action].length;
// 大きな絵を持つ武将（並びは BIG・DRAFT に書いた順。試作中を含む）と、その絵のデータ（モーションの確かめのページが使う）
export const BIG_KINDS = [...new Set([...Object.keys(BIG), ...Object.keys(DRAFT)])] as AttackerKind[];
export const bigData = (kind: AttackerKind): Readonly<BigData> => dataOf(kind);

// 攻撃のコマの区切り（戦闘の秒）。攻撃は前の2コマと後の3コマに分ける。
// pre：次に攻撃できるまでの残りがこれを切ったら、前の1コマ目・2コマ目
//   （刀は溜め・振りかぶり、鉄砲は構える・狙う、弓はつがえる・引き絞る、軍配は構える・掲げる）
// post：攻撃した時刻からの経過で、後の3コマの終わり
//   （刀は踏み込み斬り・振り抜き・残心、鉄砲は撃つ・反動・下ろす、弓は放つ・残身・下ろす、軍配は振り下ろす・指す・下ろす）
// 前の2コマと後の3コマを足した長さは、攻撃の間隔（刀 0.8秒・鉄砲 3.0秒・弓 0.9秒・軍配 4.0秒）より短くする。
// 軍配（火計）は、攻撃した時刻に落ちる場所の円が出て、溜め（windup 0.6秒）のあとに火が出るので、火が出るまで指したままにする
export const ATTACK_TIME = {
  sword: { pre: [0.28, 0.14], post: [0.14, 0.28, 0.48] },
  gun: { pre: [0.7, 0.3], post: [0.22, 0.5, 0.95] },
  bow: { pre: [0.36, 0.18], post: [0.1, 0.24, 0.46] },
  fan: { pre: [0.5, 0.25], post: [0.15, 0.6, 1.0] },
} as const;
export type BigWeapon = keyof typeof ATTACK_TIME;
export const bigWeapon = (kind: AttackerKind): BigWeapon => {
  const w = specOf(kind).weapon;
  return w === 'gun' ? 'gun' : w === 'bow' ? 'bow' : w === 'fan' ? 'fan' : 'sword';
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
