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
// 攻撃の残像の色（刀の弧と同じ）：芯の白、先の側の淡い金、残りの青白
const TRAIL = { core: '#ffffff', lead: '#fff3c4', body: '#cfe0ff' };
// 振った武器の通った弧（家康の軍配で打つ）。中心 (cx, cy) から半径 r の所を、角度 a0 から a1（度。画面の下向きが正）まで、
// 太さ wid で塗る。今の武器の側（a1）ほど太い。絵のない所にだけ置く
function swingArc(out, cx, cy, r, a0, a1, wid) {
  const H = out.length, W = out[0].length;
  if (!(a1 > a0)) return; // 振った幅がなければ描かない
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (out[y][x]) continue;
    // 角度は a0 から測り直す（a0 が -180 度より小さくても、真左をまたぐ側の弧が欠けないように）
    const a = a0 + ((((Math.atan2(y + 0.5 - cy, x + 0.5 - cx) * 180) / Math.PI - a0) % 360) + 360) % 360;
    if (a > a1) continue;
    const k = (a - a0) / (a1 - a0), d = r - Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    // 始めの細すぎる所は、離れた線の切れ端に見えるので描かない
    if (k < 0.2) continue;
    if (d >= 0 && d < wid * k + 0.6) out[y][x] = d < 1 ? TRAIL.core : k > 0.65 ? TRAIL.lead : TRAIL.body;
  }
}
// 突いた槍の残像：穂先 tip から、突いた向き dir と逆へ、柄の両わきに沿って伸びる細い筋。len は内の筋の長さ（ドット）。
// 外の筋は短く、穂先から少し下げる。絵のない所にだけ置く
function thrustTrail(out, tip, dir, len) {
  const H = out.length, W = out[0].length, n = [-dir[1], dir[0]];
  const put = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < W && y < H && !out[y][x]) out[y][x] = c; };
  for (const s of [-1, 1]) {
    for (let k = 1; k <= len; k++) put(tip[0] - dir[0] * k + n[0] * s * 2, tip[1] - dir[1] * k + n[1] * s * 2, k <= 2 ? TRAIL.core : k <= len * 0.4 ? TRAIL.lead : TRAIL.body);
    for (let k = 3; k <= len * 0.6 + 2; k++) put(tip[0] - dir[0] * k + n[0] * s * 3.5, tip[1] - dir[1] * k + n[1] * s * 3.5, TRAIL.body);
  }
}
