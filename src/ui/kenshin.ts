// 上杉謙信（猛将）の試作の駒：4頭身・斜め前と斜め後ろの2方向。左向きは貼るときに反転する。
// 絵は kenshinFrames.ts のデータから作る。赤い縅と紐は、軍の色に塗り替える
import { KENSHIN_CH, KENSHIN_FRAMES, KENSHIN_H, KENSHIN_PAL, KENSHIN_TEAM, KENSHIN_W } from './kenshinFrames';

export const BIG_W = KENSHIN_W;
export const BIG_H = KENSHIN_H;
// 足元の位置（絵の幅・高さに対する割合。y は下から）
export const BIG_CX = 0.5;
export const BIG_CY = (KENSHIN_H - 68.5) / KENSHIN_H;

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
