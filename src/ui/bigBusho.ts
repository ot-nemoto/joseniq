// 試作：3頭身・背丈38ドットで、斜め前と斜め後ろの2方向を描いた武将の駒（今は上杉謙信と織田信長）。
// 左向きは貼るときに反転する。絵は武将ごとのデータ（kenshinFrames.ts など）から作り、朱や赤の飾りは軍の色に塗り替える。
// 背中の幟は、字が裏返らないよう体とは別の絵にし、コマごとの位置（flag）に立てる。家紋は今の駒と同じ表（bushoMon）から取る
import type { AttackerKind } from '../sim';
import { KENSHIN } from './kenshinFrames';
import { NOBUNAGA } from './nobunagaFrames';
import { bushoMon } from './pixel';

export type BigView = 'front' | 'back';
export type BigAction = 'idle' | 'walk' | 'attack' | 'hurt' | 'fall';
type Frames<T> = Readonly<Record<BigView, Readonly<Record<BigAction, readonly T[]>>>>;
interface BigData {
  w: number;
  h: number;
  foot: number; // 足元の行
  ch: string; // 色の文字の並び（何番目の色か）
  pal: readonly string[];
  team: readonly number[]; // 軍の色に塗り替える色（暗い順に4段）の番号。使わない段は -1
  frames: Frames<readonly string[]>;
  flag: Frames<readonly [number, number] | null>;
}
const BIG: Partial<Record<AttackerKind, BigData>> = { brave: KENSHIN, gunner: NOBUNAGA };

export const hasBig = (kind: AttackerKind) => kind in BIG;
const dataOf = (kind: AttackerKind): BigData => {
  const d = BIG[kind];
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
// 鉄砲の銃口の位置（ドット）：肩の高さで構えたときの、足元からの高さと、撃つ向きへの前のずれ
export const BIG_MUZZLE = { up: 20, fwd: 8 };
export const bigFrames = (kind: AttackerKind, view: BigView, action: BigAction) =>
  dataOf(kind).frames[view][action].length;

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
