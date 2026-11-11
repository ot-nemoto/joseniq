// 武将と兵の大きな絵の共通部分：素材ごとの色（暗・影・地・明の4段）、外側の輪郭の色、多角形の内外の判定、スキルの光と攻撃の残像。
// 描き方のファイル（kenshin.js など武将7人分と ashigaru.js）と一緒に読み込む（export.mjs がつなげて読む）。ゲームの側（src/ui）は使わない
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
const rad = (a) => (a * Math.PI) / 180;
// 長さ l1・l2 の2本の骨で (ax, ay) から (bx, by) へ届くときの関節（膝・肘）の位置。2つある解のうち、pick で選ぶ
function joint(ax, ay, bx, by, l1, l2, pick) {
  const D = Math.hypot(bx - ax, by - ay) || 1, d = Math.min(D, l1 + l2 - 0.01), ux = (bx - ax) / D, uy = (by - ay) / D;
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const px = ax + ux * a, py = ay + uy * a;
  return pick([px - uy * h, py + ux * h], [px + uy * h, py - ux * h]);
}
// 描く板（W×H）：素材の名前を置く m、手で置いた頭の色 sg（あとから描いた形に隠された所は消す）、武器のマス wm（スキルの溜めで光らせる）と、
// 画面の点で塗る道具（多角形・楕円・太さ t の線）。weapon(fn) のあいだに塗ったマスを武器のマスにする
function mkCanvas(W, H) {
  const grid = (v) => Array.from({ length: H }, () => Array(W).fill(v));
  const m = grid(''), sg = grid(''), wm = grid(0);
  let inW = false;
  const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < W && y < H) { m[y][x] = v; sg[y][x] = ''; wm[y][x] = inW ? 1 : 0; } };
  const polyA = (pts, v) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inPoly(x + 0.5, y + 0.5, pts)) set(x, y, v); };
  const ellA = (cx, cy, rx, ry, v) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) set(x, y, v); };
  const lineA = (x0, y0, x1, y1, v, t = 1) => { const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) || 1; const h = (t - 1) / 2;
    for (let i = 0; i <= n; i++) { const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n; for (let j = 0; j < t; j++) for (let k = 0; k < t; k++) set(Math.round(x - h + k), Math.round(y - h + j), v); } };
  const weapon = (fn) => { inW = true; fn(); inW = false; };
  return { m, sg, wm, set, polyA, ellA, lineA, weapon };
}
// 陰影：素材の板 m を、素材ごとの色（pal の4段）で塗った絵にする。横に続く同じ素材の中の位置で暗・影・地を決め、上の端と右の端を明るく、
// 下の端を暗くする。adjust(v, tone, x, y, same) で素材ごとに段を変える（肌は明るい側へ寄せる決まりのあと）。
// 続けて、ほかの素材と接する右と下の端を暗い段（light の素材は影の段）にする。skip の素材と、pass の素材に接する所は暗くしない
function shade(m, pal, { skip, pass, light = '', adjust }) {
  const H = m.length, W = m[0].length;
  const out = Array.from({ length: H }, () => Array(W).fill(''));
  const same = (x, y, v) => x >= 0 && y >= 0 && x < W && y < H && m[y][x] === v;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = m[y][x]; if (!v) continue;
    let x0 = x, x1 = x; while (same(x0 - 1, y, v)) x0--; while (same(x1 + 1, y, v)) x1++;
    const t = x1 > x0 ? (x - x0) / (x1 - x0) : 0.5;
    let tone = t < 0.18 ? 0 : t < 0.42 ? 1 : 2;
    if (x1 - x0 < 3) tone = 2;
    if (!same(x, y - 1, v) || (!same(x + 1, y, v) && t > 0.5)) tone = Math.min(3, tone + 1);
    if (!same(x, y + 1, v)) tone = Math.max(0, tone - 1);
    if (v === 's') tone = Math.max(1, tone);
    if (adjust) tone = adjust(v, tone, x, y, same);
    out[y][x] = pal[v][tone];
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = m[y][x]; if (!v || skip.includes(v)) continue;
    const r = x + 1 < W ? m[y][x + 1] : '', d = y + 1 < H ? m[y + 1][x] : '';
    if ((r && r !== v && !pass.includes(r)) || (d && d !== v && !pass.includes(d))) out[y][x] = pal[v][light.includes(v) ? 1 : 0];
  }
  return out;
}
// 外側の輪郭：絵のない所で、縦横に絵と接するマスを塗る。上に絵があるか、接する素材が dark のものなら LINE、そうでなければその素材の暗い段
function outline(out, m, pal, dark) {
  const H = m.length, W = m[0].length, add = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (m[y][x]) continue;
    const ns = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([i, j]) => i >= 0 && j >= 0 && i < W && j < H && m[j][i]);
    if (!ns.length) continue;
    const [i, j] = ns[0], v = m[j][i];
    add.push([x, y, (y > 0 && m[y - 1][x]) || dark.includes(v) ? LINE : pal[v][0]]);
  }
  for (const [x, y, c] of add) out[y][x] = c;
}
// 絵の上の1点を塗る（枠の外は塗らない）
function dot(out, x, y, c) {
  x = Math.round(x); y = Math.round(y);
  if (x >= 0 && y >= 0 && x < out[0].length && y < out.length) out[y][x] = c;
}
// 被弾の火花：(sx, sy) を中心に、白い十字と、reach まで伸びる金（いちばん先の4は橙）の筋。diag なら斜めにも橙の粒を散らす
function spark(out, [sx, sy], reach = 4, diag = false) {
  const P = [[0, 0, '#ffffff'], [1, 0, '#ffffff'], [-1, 0, '#ffffff'], [0, 1, '#ffffff'], [0, -1, '#ffffff']];
  for (let r = 2; r <= reach; r++) P.push([r, 0, r < 4 ? '#ffe27a' : '#f08a2a'], [-r, 0, r < 4 ? '#ffe27a' : '#f08a2a'], [0, r, r < 4 ? '#ffe27a' : '#f08a2a'], [0, -r, r < 4 ? '#ffe27a' : '#f08a2a']);
  if (diag) for (const d of [2, 3]) P.push([d, d, '#f08a2a'], [-d, d, '#f08a2a'], [d, -d, '#f08a2a'], [-d, -d, '#f08a2a']);
  for (const [dx, dy, c] of P) dot(out, sx + dx, sy + dy, c);
}
// 倒れのコマ：絵 g を、(px, py) を軸に deg 度回し、(dx, dy) だけずらす
function rotate(g, deg, px, py, dx = 0, dy = 0) {
  const H = g.length, W = g[0].length, a = rad(deg), c = Math.cos(a), sn = Math.sin(a);
  const out = Array.from({ length: H }, () => Array(W).fill(''));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const X = x - px - dx, Y = y - py - dy;
    const sx = Math.round(px + X * c + Y * sn), sy = Math.round(py - X * sn + Y * c);
    if (sx >= 0 && sy >= 0 && sx < W && sy < H && g[sy][sx]) out[y][x] = g[sy][sx];
  }
  return out;
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
// 振った武器の通った弧（刀で斬る・軍配で打つ）。中心 (cx, cy) から半径 r の所を、角度 a0 から a1（度。画面の下向きが正）まで、
// 太さ wid で塗る。今の武器の側（a1）ほど太い。絵のない所にだけ置く。from より始めの側（弧の割合）は描かない
function swingArc(out, cx, cy, r, a0, a1, wid, from = 0.2) {
  const H = out.length, W = out[0].length;
  if (!(a1 > a0)) return; // 振った幅がなければ描かない
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (out[y][x]) continue;
    // 角度は a0 から測り直す（a0 が -180 度より小さくても、真左をまたぐ側の弧が欠けないように）
    const a = a0 + ((((Math.atan2(y + 0.5 - cy, x + 0.5 - cx) * 180) / Math.PI - a0) % 360) + 360) % 360;
    if (a > a1) continue;
    const k = (a - a0) / (a1 - a0), d = r - Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    // 始めの細すぎる所は、離れた線の切れ端に見えるので描かない（軍配。刀は弧が長いので始めから描く）
    if (k < from) continue;
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
