// 武将の大きな絵の共通部分：素材ごとの色（暗・影・地・明の4段）、外側の輪郭の色、多角形の内外の判定。
// kenshin.js・nobunaga.js と一緒に読み込む（export.mjs がつなげて読む）。ゲームの側（src/ui）は使わない
const RAMP = {
  c: ['#8e8798', '#c8c3d2', '#efece4', '#ffffff'], // 白い布（頭巾・陣羽織）
  g: ['#6e4a1c', '#a8782c', '#e0b84e', '#fff0a0'], // 金
  n: ['#121830', '#212b52', '#33447a', '#5a6eaa'], // 紺の鎧
  f: ['#121830', '#1b2446', '#28365f', '#3e4f85'], // 紺の布（袖・袴）
  r: ['#5e1414', '#9c2a24', '#d14a38', '#f08a6a'], // 赤い縅・紐
  s: ['#8a5a44', '#c98f6e', '#ecc4a0', '#fde3c8'], // 肌
  k: ['#16100c', '#2c2018', '#45342a', '#5e4a3c'], // ひげ・眉
  d: ['#0b0b10', '#1e1e26', '#33333f', '#5c5c74'], // 黒漆（鞘・柄・足袋）
  v: ['#3a1e52', '#6a3a8a', '#9a62b8', '#c8a0e0'], // 紫の房紐
};
const LINE = '#1a1420';
function inPoly(px, py, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
// スキルの溜めで、武器のまわりを光らせる。mask は武器のマス（1）、level は光の強さ（1 は点々、2 は帯と外の点々）、
// cols は [内の色, 外の色]。光は、絵のない所（外側の輪郭のさらに外）にだけ置き、体や武器の上には重ねない
function weaponAura(out, mask, level, cols) {
  const H = out.length, W = out[0].length, R = 3;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (out[y][x]) continue;
    let d = 9;
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
      const X = x + i, Y = y + j;
      if (X >= 0 && Y >= 0 && X < W && Y < H && mask[Y][X]) d = Math.min(d, Math.max(Math.abs(i), Math.abs(j)));
    }
    const odd = (x + y) % 2 === 0;
    if (level >= 2 ? d <= 2 : d <= 2 && odd) out[y][x] = cols[0];
    else if (level >= 2 && d === 3 && odd) out[y][x] = cols[1];
  }
}
