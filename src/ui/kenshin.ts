// 上杉謙信（猛将）の試作の駒：3頭身・背丈38ドット、斜め前と斜め後ろの2方向。左向きは貼るときに反転する。
// 絵は kenshinFrames.ts のデータから作る。赤い縅と紐は、軍の色に塗り替える。
// 背中の幟は、字が裏返らないよう体とは別の絵にし、コマごとの位置（KENSHIN_FLAG）に立てる
import {
  KENSHIN_CH,
  KENSHIN_FLAG,
  KENSHIN_FRAMES,
  KENSHIN_H,
  KENSHIN_PAL,
  KENSHIN_TEAM,
  KENSHIN_W,
} from './kenshinFrames';

export const BIG_W = KENSHIN_W;
export const BIG_H = KENSHIN_H;
// 足元の位置（絵の幅・高さに対する割合。y は下から）
export const BIG_CX = 0.5;
export const BIG_CY = (KENSHIN_H - 67.5) / KENSHIN_H;

export type BigView = 'front' | 'back';
export type BigAction = keyof (typeof KENSHIN_FRAMES)['front'];

// 1行の「色の文字＋続く数」を、色の番号の並び（空きは -1）に戻す
function decode(row: string): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < row.length) {
    const ch = row[i++];
    let n = '';
    while (i < row.length && row[i] >= '0' && row[i] <= '9') n += row[i++];
    const v = ch === '.' ? -1 : KENSHIN_CH.indexOf(ch);
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

export const bigFrames = (view: BigView, action: BigAction) => KENSHIN_FRAMES[view][action].length;

const cache = new Map<string, HTMLCanvasElement>();
// 1コマの画像。white なら、傷を受けたときに重ねる白い形
export function bigSprite(view: BigView, action: BigAction, i: number, side: string, white = false): HTMLCanvasElement {
  const rows = KENSHIN_FRAMES[view][action];
  const n = ((i % rows.length) + rows.length) % rows.length;
  const key = `${view}|${action}|${n}|${white ? 'w' : side}`;
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = KENSHIN_W;
  c.height = KENSHIN_H;
  const x2 = c.getContext('2d');
  if (x2) {
    const team = teamRamp(side);
    const color = (v: number) => {
      if (white) return '#fff';
      const t = KENSHIN_TEAM.indexOf(v);
      return t >= 0 ? team[t] : KENSHIN_PAL[v];
    };
    rows[n].forEach((row, y) => {
      decode(row).forEach((v, x) => {
        if (v < 0) return;
        x2.fillStyle = color(v);
        x2.fillRect(x, y, 1, 1);
      });
    });
  }
  cache.set(key, c);
  return c;
}

// 幟：竿（BIG_FLAG_H 段）・横木・白い布（9×14）・軍の色の帯・家紋「毘」。今の武将の幟と同じ作りで、竿だけ長い
export const BIG_FLAG_W = 11;
export const BIG_FLAG_H = 44;
const BI = ['KKKKK..', 'K.K.K..', 'KKKKK..', 'K.K.K..', 'KKKKK..', 'K..K...', 'KK.KK.K', 'K..K..K', 'KKKKKKK'];
const FLAG_COLORS: Record<string, string> = { K: '#1c1a18', W: '#f4f0e4', w: '#c9c1ad', P: '#4a3a28', G: '#e0b84e' };
export function bigFlagSprite(side: string): HTMLCanvasElement {
  const key = `flag|${side}`;
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
  BI.forEach((row, j) => {
    [...row].forEach((v, i) => {
      if (v !== '.') g[4 + j][1 + i] = v;
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
export function bigFlagAt(view: BigView, action: BigAction, i: number): readonly [number, number] | null {
  const list = KENSHIN_FLAG[view][action] as readonly (readonly [number, number] | null)[];
  return list[((i % list.length) + list.length) % list.length];
}
