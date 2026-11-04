// 徳川家康（堅守・軍配）3頭身・背丈38ドット。斜め前（front）と斜め後ろ（back）。昌幸と同じ組み立てで、頭・色・攻撃の動きを差し替える。
// 目印は、黒い兜の金の歯朶の前立て（2本の弧と真ん中の黒い玉）、赤い鉢巻（軍の色）、白い陣羽織と金の広い襟、紺黒の鎧、茶の袖、灰色の口ひげとあごひげ。
// 軍配は、昌幸のように火計を采配するのではなく、近くの敵を打つ。common.js と一緒に読む
const KI = (() => {
  // 素材の色（暗・影・地・明）
  const R = {
    n: ['#0a0e18', '#151c2c', '#222c42', '#3a4762'], // 紺黒の漆の胴・籠手・すね当て
    c: ['#8a8578', '#c4bfb2', '#ebe8de', '#fbfaf4'], // 白い陣羽織
    b: ['#6e4a1c', '#a8782c', '#d8ac46', '#f4d47a'], // 陣羽織の金の襟・縁
    o: ['#2a1a10', '#44301e', '#5e452e', '#7a5e42'], // 茶の袖
    p: ['#121828', '#1e2840', '#2e3a58', '#465476'], // 紺の袴
    g: ['#6e4a1c', '#a8782c', '#e0b84e', '#fff0a0'], // 金
    d: ['#0b0b10', '#1e1e26', '#33333f', '#5c5c74'], // 黒（鞘・軍配）
    t: ['#3a2010', '#5c3519', '#7e4c26', '#a3683a'], // 軍配の柄
    r: ['#5e1414', '#9c2a24', '#d14a38', '#f08a6a'], // 赤い鉢巻・すねの紐・軍配の日の丸（軍の色に塗り替える）
    s: ['#8a5a44', '#c98f6e', '#ecc4a0', '#fde3c8'], // 肌
    C: ['#0c0c10', '#191920', '#2a2a34', '#46465a'], // 兜（手で置いた頭の素材）
  };
  // 手で置いた頭。K 兜の縁 N 兜 M 兜の光 n 兜の影 Y 金の光 G 金 g 金の影 H 髪（白髪まじり） S 肌 s 肌の影
  // b 眉 e 白目 E 黒目 B ひげ（灰色） m 口 r 赤い鉢巻（軍の色）
  const HP = {
    K: '#0a0e18', N: '#222c42', M: '#3a4762', n: '#151c2c', Y: '#fff0a0', G: '#e0b84e', g: '#a8782c',
    H: '#4a4642', S: '#e6bb94', s: '#c08a68', b: '#2a2420', e: '#f8f4ee', E: '#1c120c', B: '#6e6a66', m: '#a04a3c',
    r: R.r[2],
  };
  // 歯朶の前立ては、2本の羽が兜の上でほぼ閉じた輪になる（下で合わさり、上の先が少し開く）。羽の外側は一つおきに抜いて葉のギザギザにし、
  // 付け根（下）は太いまま合わせる。輪の内側の下のほうに、とがった黒い鉢と、羽の付け根の黒い玉がのぞく
  const HEAD_FRONT = {
    ax: 11.5, ay: 17.5, top: 0,
    rows: [
      '.......Y.Y...G.G.......',
      '....Y.GGGG...GGGG.G....',
      '...Y.GGggg...gggGG.G...',
      '..Y.Gggg.......gggG.G..',
      '.Y.Ggg...........ggG.G.',
      '..GGgg...........ggGG..',
      '.YGGg.............gGGG.',
      '..GGg.............gGG..',
      '.GGGgg....KNK....ggGGG.',
      '..GGgg...KNMNK...ggGG..',
      '...GGgg.KNNNNNK.ggGG...',
      '....GGGggNgGgNggGGG....',
      '.....GGGGgGKGgGGGG.....',
      '......GGGggGgGGgGG.....',
      '........gGGGGGg........',
      '...KnnrrrrrrrrrrrrnK...',
      '...KnNHHHbbbSSSbbSnK...',
      '...KnNHHHSeESSSeESnK...',
      '....KnHHSSSSSSSSSsK....',
      '.....KnSSSBBBmBBBs.....',
      '......nSSSSSSSSSSs.....',
      '.......SSSSSBBBSs......',
      '.........SSSBBBS.......',
      '............BB.........',
    ],
  };
  const HEAD_BACK = {
    ax: 10, ay: 17.5, top: 0,
    rows: [
      '.......Y.Y...G.G.......',
      '....Y.GGGG...GGGG.G....',
      '...Y.GGggg...gggGG.G...',
      '..Y.Gggg.......gggG.G..',
      '.Y.Ggg...........ggG.G.',
      '..GGgg...........ggGG..',
      '.YGGg.............gGGG.',
      '..GGg.............gGG..',
      '.GGGgg....KNK....ggGGG.',
      '..GGgg...KNMNK...ggGG..',
      '...GGgg.KNNNNNK.ggGG...',
      '....GGGggNNNNNggGGG....',
      '.....GGGGgggggGGGG.....',
      '......GGGgGGGGGgGG.....',
      '........gGGGGGg........',
      '.....KNNNNNNNNNNNNNK...',
      '....KnNNNNNNNNNNNNNK...',
      '...KnggggggggggggggSK..',
      '...KnnnnnnnnnnnnnnnS...',
      '....KnnnnnnnnnnnnnK.s..',
    ],
  };
  const W = 80, H = 72, OX = 16, OY = 10, SC = 36 / 44;
  const HEAD = 14, KY = 0.68, DROP = 13;
  const Y = (y) => (y <= HEAD ? y : HEAD + (y - HEAD) * KY) + DROP;
  const AX = 39, AY = 65;
  const SP = (x, y) => [AX + (x - AX) * SC, AY + (y - AY) * SC];
  const TW = (t) => Math.max(1, Math.round(t * SC));
  const rad = (a) => (a * Math.PI) / 180;
  // 軍配：握る手から板の付け根までの柄の長さ、板の縦と横の半径（縮める前のドット）
  const FAN_HANDLE = 4, FAN_RU = 6, FAN_RV = 4.6;
  function draw(view, o = {}) {
    const front = view === 'front';
    const F = front ? [1, 0.5] : [1, -0.5];
    const lean = o.lean || 0, bob = o.bob || 0, sway = o.sway || 0;
    const T = (x, y) => { const s = Math.max(0, (42 - y) / 26); return SP(x + lean * s * F[0] + OX, Y(y) + lean * s * F[1] + bob + OY); };
    const m = Array.from({ length: H }, () => Array(W).fill(''));
    const sg = Array.from({ length: H }, () => Array(W).fill(''));
    const fix = [];
    let top = null; // 兜の鉢の上の端（幟を立てる位置を決める）
    const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < W && y < H) { m[y][x] = v; sg[y][x] = ''; } };
    const stampHead = (hd) => {
      const [cx, cy] = T(24, 8.5);
      const x0 = Math.round(cx - hd.ax), y0 = Math.round(cy - hd.ay);
      top = [x0 + hd.ax, y0 + hd.top];
      hd.rows.forEach((row, j) => [...row].forEach((ch, i) => {
        if (ch === '.') return;
        const x = x0 + i, y = y0 + j;
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        m[y][x] = ch === 'S' || ch === 's' ? 's' : 'C';
        sg[y][x] = HP[ch];
      }));
    };
    const polyA = (pts, v) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inPoly(x + 0.5, y + 0.5, pts)) set(x, y, v); };
    const poly = (pts, v) => polyA(pts.map(([x, y]) => T(x, y)), v);
    const ellA = (cx, cy, rx, ry, v) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) set(x, y, v); };
    const ell = (cx, cy, rx, ry, v) => { const [X, Yy] = T(cx, cy); ellA(X, Yy, rx * SC, ry * SC, v); };
    const rect = (x, y, w, h, v) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const [X, Yy] = T(x + i, y + j); set(Math.round(X), Math.round(Yy), v); } };
    const lineA = (x0, y0, x1, y1, v, t = 1) => { const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) || 1; const h = (t - 1) / 2;
      for (let i = 0; i <= n; i++) { const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n; for (let j = 0; j < t; j++) for (let k = 0; k < t; k++) set(Math.round(x - h + k), Math.round(y - h + j), v); } };
    const line = (x0, y0, x1, y1, v, t) => { const a = T(x0, y0), b = T(x1, y1); lineA(a[0], a[1], b[0], b[1], v, TW(t || 1)); };
    const joint = (ax, ay, bx, by, l1, l2, pick) => {
      const D = Math.hypot(bx - ax, by - ay) || 1, d = Math.min(D, l1 + l2 - 0.01), ux = (bx - ax) / D, uy = (by - ay) / D;
      const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
      const px = ax + ux * a, py = ay + uy * a;
      return pick([px - uy * h, py + ux * h], [px + uy * h, py - ux * h]);
    };
    const leg = (hip, foot, v, wid, shoe) => {
      wid = TW(wid); shoe = shoe * SC;
      const h = SP(hip[0] + OX, Y(hip[1]) + bob + OY), f = SP(foot[0] + OX, Y(foot[1]) + OY);
      const k = joint(h[0], h[1], f[0], f[1], 7.5 * KY * SC, 7.5 * KY * SC, (a, b) => (a[0] * F[0] + a[1] * F[1] > b[0] * F[0] + b[1] * F[1] ? a : b));
      lineA(h[0], h[1], k[0], k[1], 'p', wid);
      lineA(k[0], k[1], f[0], f[1] - 1, v, wid);
      // すね当ての赤い紐（1本。軍の色）
      const x = k[0] + (f[0] - k[0]) * 0.2, y = k[1] + (f[1] - 1 - k[1]) * 0.2; lineA(x - wid / 2 + 0.5, y, x + wid / 2 - 0.5, y, 'r');
      lineA(f[0] - shoe / 2, f[1], f[0] + shoe / 2, f[1] + (front ? 0.5 : -0.5), 'p', 2);
    };
    const step = o.step || 0, back = o.back || 0;
    const nearHip = front ? [20.5, 40] : [26.5, 40], farHip = front ? [26, 40] : [20.5, 40];
    const nearFoot = front ? [20, 54] : [27, 54], farFoot = front ? [26, 53] : [20.5, 53];
    const legs = () => {
      leg(farHip, [farFoot[0] - F[0] * back, farFoot[1] - F[1] * back - (o.farLift || 0)], 'n', 4, 6);
      leg(nearHip, [nearFoot[0] + F[0] * step, nearFoot[1] + F[1] * step - (o.nearLift || 0)], 'n', 5, 7);
    };
    // 軍配と腕：fan.hx・hy は柄を握る手、ang は柄から板への向き、hand は握る手が手前（near）か奥（far）か。
    // もう一方の手は rest の所（腰）に下ろす
    const fn = o.fan;
    let hand, dir;
    if (fn) { hand = SP(fn.hx + OX, Y(fn.hy) + OY); dir = [Math.cos(rad(fn.ang)), Math.sin(rad(fn.ang))]; }
    const nearSh = T(...(front ? [15, 20] : [34, 20])), farSh = T(...(front ? [33, 20] : [14, 20]));
    const armIK = (s, h, up, fore, w = 5) => {
      const e = joint(s[0], s[1], h[0], h[1], 8 * 0.8 * SC, 8 * 0.8 * SC, (a, b) => (a[1] > b[1] ? a : b));
      lineA(s[0], s[1], e[0], e[1], up, TW(w));
      lineA(e[0], e[1], h[0], h[1], fore, TW(w - 1));
      ellA(h[0] + 0.5, h[1] + 0.5, 2.0 * SC, 1.8 * SC, 'n'); // 黒の手甲
    };
    const fan = () => {
      // 柄（木）と、柄の先の黒い板。板は金の縁と、真ん中の日の丸（軍の色）
      const base = [hand[0] + dir[0] * FAN_HANDLE * SC, hand[1] + dir[1] * FAN_HANDLE * SC];
      lineA(hand[0] - dir[0] * 1.5 * SC, hand[1] - dir[1] * 1.5 * SC, base[0], base[1], 't', TW(1.5));
      const c = [base[0] + dir[0] * FAN_RU * SC, base[1] + dir[1] * FAN_RU * SC];
      const ru = FAN_RU * SC, rv = FAN_RV * SC;
      for (let y = Math.floor(c[1] - ru - 1); y <= c[1] + ru + 1; y++) for (let x = Math.floor(c[0] - ru - 1); x <= c[0] + ru + 1; x++) {
        const dx = x + 0.5 - c[0], dy = y + 0.5 - c[1], u = dx * dir[0] + dy * dir[1], v = -dx * dir[1] + dy * dir[0];
        // 付け根の側を細くした瓢箪の形
        const k = (u / ru) ** 2 + (v / (rv * (u < 0 ? 0.8 + 0.2 * (1 + u / ru) : 1))) ** 2;
        if (k > 1) continue;
        set(x, y, Math.hypot(u * 0.8, v) < rv * 0.34 ? 'r' : k > 0.62 ? 'g' : 'd');
      }
    };
    const fanHand = fn && fn.hand === 'far' ? 'far' : 'near';
    const rest = () => (fn && fn.rest ? T(...fn.rest) : null);
    const sode = (cx, cy, wide) => { const [X, Yy] = T(cx, cy); const w = wide * SC, u = 3.4 * SC; polyA([[X - w, Yy - u], [X + w, Yy - u], [X + w + 0.5, Yy + u], [X - w - 0.5, Yy + u + 0.5]], 'n'); };
    let seam = false;
    const goldRows = (rows, x0, x1, mat = 'n') => { for (const yy of rows) for (let x = x0; x < x1; x++) { const [X, Yy] = T(x, yy).map(Math.round); if (m[Yy] && m[Yy][X] === mat) fix.push([X, Yy, R.g[1]]); } };

    if (front) {
      legs();
      // 奥の腕：軍配を持たない手は腰に下ろす（橙の袖）
      if (fn && fanHand === 'near' && rest()) armIK(farSh, rest(), 'o', 'n', 4);
      if (fn && fanHand === 'far' && !o.fanFront) { armIK(farSh, hand, 'o', 'n', 4); fan(); }
      // 草摺（紺黒）・紺黒の胴・白い陣羽織と金の広い襟・腰の紐
      poly([[16, 40], [32, 40], [33, 45], [15, 45]], 'n');
      poly([[16, 17], [32, 17], [33, 41], [15, 41]], 'n');
      // 大袖は陣羽織の下（肩を陣羽織が覆い、袖の下の段だけが見える）
      sode(33, 22, 2.4);
      sode(14.5, 22, 3);
      poly([[12.5, 16.5], [21, 16.5], [20.5, 42.5], [12, 42.5]], 'c');
      poly([[28, 16.5], [35.5, 16.5], [36, 42.5], [28.5, 42.5]], 'c');
      poly([[18.5, 17], [21.5, 17], [21, 42.5], [18, 42.5]], 'b');
      poly([[27.5, 17], [30.5, 17], [31, 42.5], [28, 42.5]], 'b');
      line(12, 42.5, 36, 42.5, 'b', 1);
      poly([[21.5, 29.5], [27.5, 29.5], [28, 31.5], [21, 31.5]], 'o');
      // 腰の刀
      line(29, 32, 36, 37, 'd', 2); rect(28, 31, 2, 2, 'g');
      // 黒の立て襟
      poly([[17, 13], [31, 13], [32, 17], [29, 19], [19, 19], [16, 17]], 'n');
      stampHead(HEAD_FRONT);
      if (fn && fanHand === 'far' && o.fanFront) { armIK(farSh, hand, 'o', 'n', 4); fan(); }
      if (fn && fanHand === 'near') { armIK(nearSh, hand, 'o', 'n'); fan(); }
      else if (fn && rest()) armIK(nearSh, rest(), 'o', 'n');
      goldRows([25.5], 8, 15);
      goldRows([24, 35], 21, 28);
      goldRows([43.5], 15, 34);
    } else {
      legs();
      // 奥の腕：待機は軍配を握る、攻撃は腰に下ろす
      if (fn && fanHand === 'far') { armIK(farSh, hand, 'o', 'n', 4); fan(); }
      else if (fn && rest()) armIK(farSh, rest(), 'o', 'n', 4);
      // 草摺（紺黒）・白い陣羽織の背と金の縁・背の縫い目
      poly([[14, 40], [34, 40], [35, 45], [13, 45]], 'n');
      poly([[13, 17], [35, 17], [36, 43], [12, 43]], 'c');
      line(12, 43, 36, 43, 'b', 1);
      line(13, 17, 12, 43, 'b', 1);
      line(35, 17, 36, 43, 'b', 1);
      seam = true;
      // 腰の刀（左の腰から手前へ）
      line(17, 33, 6, 43, 'd', 2); rect(4, 43, 3, 2, 'g');
      sode(13, 20, 2.8); sode(34, 20, 4.2);
      goldRows([22, 25], 8, 18);
      goldRows([22, 25], 30, 41);
      goldRows([43.5], 13, 36);
      // 首の後ろ（錣の下）を紺黒の襟で埋める
      poly([[17, 12], [31, 12], [33, 17], [15, 17]], 'n');
      stampHead(HEAD_BACK);
      if (fn && fanHand === 'near') { armIK(nearSh, hand, 'o', 'n'); fan(); }
      else if (fn && rest()) armIK(nearSh, rest(), 'o', 'n');
    }
    // 陰影
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
      out[y][x] = R[v][tone];
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = m[y][x]; if (!v || 'ksbr'.includes(v)) continue;
      const r = x + 1 < W ? m[y][x + 1] : '', d = y + 1 < H ? m[y + 1][x] : '';
      if ((r && r !== v && r !== 'b' && r !== 'r') || (d && d !== v && d !== 'b' && d !== 'r')) out[y][x] = R[v][0];
    }
    for (const [x, y, c] of fix) if (y >= 0 && y < H && x >= 0 && x < W && m[y][x]) out[y][x] = c;
    // 陣羽織の背の縫い目（白い背中が平たい板に見えないよう、真ん中に薄い線を1本）
    if (seam) for (let yy = 18; yy < 42; yy++) { const [X, Yy] = T(24, yy).map(Math.round); if (m[Yy] && m[Yy][X] === 'c') out[Yy][X] = R.c[1]; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (sg[y][x]) out[y][x] = sg[y][x];
    const add = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (m[y][x]) continue;
      const ns = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([i, j]) => i >= 0 && j >= 0 && i < W && j < H && m[j][i]);
      if (!ns.length) continue;
      const [i, j] = ns[0], v = m[j][i];
      add.push([x, y, (y > 0 && m[y - 1][x]) || 'dncpgtC'.includes(v) ? LINE : R[v][0]]);
    }
    for (const [x, y, c] of add) out[y][x] = c;
    const dot = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < W && y < H) out[y][x] = c; };
    // 振り下ろした瞬間：軍配の通った跡（板の先から、振った向きと逆へ短い白い筋）
    if (o.swish && fn) {
      const tip = [hand[0] + dir[0] * (FAN_HANDLE + FAN_RU * 2) * SC, hand[1] + dir[1] * (FAN_HANDLE + FAN_RU * 2) * SC];
      const [sx, sy] = o.swish;
      for (let k = 1; k <= 5; k++) dot(tip[0] + sx * k, tip[1] + sy * k, k < 3 ? '#ffffff' : '#c9c7c2');
    }
    if (o.flash) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = out[y][x]; if (!c) continue;
      const n = parseInt(c.slice(1), 16), k = o.flash;
      out[y][x] = '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * k).toString(16).padStart(2, '0')).join('');
    }
    if (o.spark) {
      const [sx, sy] = T(...o.spark).map(Math.round);
      const P = [[0, 0, '#ffffff'], [1, 0, '#ffffff'], [-1, 0, '#ffffff'], [0, 1, '#ffffff'], [0, -1, '#ffffff']];
      for (let r = 2; r <= 4; r++) P.push([r, 0, r < 4 ? '#ffe27a' : '#f08a2a'], [-r, 0, r < 4 ? '#ffe27a' : '#f08a2a'], [0, r, r < 4 ? '#ffe27a' : '#f08a2a'], [0, -r, r < 4 ? '#ffe27a' : '#f08a2a']);
      for (const [dx, dy, c] of P) dot(sx + dx, sy + dy, c);
    }
    out.top = top;
    return out;
  }
  function rotate(g, deg, px, py, dx = 0, dy = 0) {
    const a = rad(deg), c = Math.cos(a), sn = Math.sin(a);
    const out = Array.from({ length: H }, () => Array(W).fill(''));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const X = x - px - dx, Yy = y - py - dy;
      const sx = Math.round(px + X * c + Yy * sn), sy = Math.round(py - X * sn + Yy * c);
      if (sx >= 0 && sy >= 0 && sx < W && sy < H && g[sy][sx]) out[y][x] = g[sy][sx];
    }
    return out;
  }
  // 待機：軍配を画面の左に立てて持つ（斜め前は手前の手、斜め後ろは奥の手）。もう一方の手は腰に下ろす（昌幸と同じ）
  const holdFan = (f, dy = 0, da = 0) => (f
    ? { hx: 13, hy: 30 + dy, ang: -96 + da, hand: 'near', rest: [33, 34] }
    : { hx: 11, hy: 30 + dy, ang: -94 + da, hand: 'far', rest: [35, 34] });
  const stance = (v) => {
    const f = v === 'front';
    const base = { lean: 1, step: 4, back: 4 };
    return [
      draw(v, { ...base, bob: 2, fan: holdFan(f), sway: 0 }),
      draw(v, { ...base, bob: 2, fan: holdFan(f, 0, -2), sway: 1 }),
      draw(v, { ...base, bob: 3, fan: holdFan(f, 1, -2), sway: 1 }),
      draw(v, { ...base, bob: 3, fan: holdFan(f, 1, 2), sway: 0 }),
    ];
  };
  const walk = (v) => {
    const f = v === 'front';
    const base = { lean: 2 };
    return [
      draw(v, { ...base, step: 7, back: 6, bob: 1, fan: holdFan(f, 1, 4), sway: 1 }),
      draw(v, { ...base, step: 0, back: -1, farLift: 3, bob: 0, fan: holdFan(f, 0, 0), sway: 2 }),
      draw(v, { ...base, step: -5, back: -7, bob: 1, fan: holdFan(f, 1, -4), sway: 1 }),
      draw(v, { ...base, step: 1, back: 0, nearLift: 3, bob: 0, fan: holdFan(f, 0, 0), sway: 0 }),
    ];
  };
  // 攻撃（軍配で打つ）：胸の前に構える → 振り上げる → 前へ打ち下ろす → 振り抜く → 戻す。
  // 斜め前は手前の手、斜め後ろは手前の手で、盤面の「前」（斜め前は右下、斜め後ろは右上）の敵を打つ
  const attack = (v) => {
    const f = v === 'front';
    const base = { step: 5, back: 5 };
    const A = (hx, hy, ang, more = {}) => ({ fan: { hx, hy, ang, hand: 'near', rest: f ? [33, 34] : [12, 34] }, ...more });
    return f
      ? [
          { name: '構える', g: draw(v, { ...base, bob: 2, lean: 0, ...A(21, 25, -70) }) },
          { name: '振り上げる', g: draw(v, { ...base, bob: 1, lean: -2, ...A(20, 6, -110) }) },
          { name: '打ち下ろす', g: draw(v, { ...base, bob: 3, lean: 5, step: 8, ...A(33, 26, 28, { swish: [-0.5, -1] }) }) },
          { name: '振り抜く', g: draw(v, { ...base, bob: 4, lean: 6, step: 8, ...A(31, 34, 70) }) },
          { name: '戻す', g: draw(v, { ...base, bob: 2, lean: 2, ...A(22, 29, -40) }) },
        ]
      : [
          { name: '構える', g: draw(v, { ...base, bob: 2, lean: 0, ...A(31, 25, -80) }) },
          { name: '振り上げる', g: draw(v, { ...base, bob: 1, lean: -2, ...A(33, 5, -100) }) },
          { name: '打ち下ろす', g: draw(v, { ...base, bob: 3, lean: 5, step: 8, ...A(42, 18, -6, { swish: [-0.6, 0.8] }) }) },
          { name: '振り抜く', g: draw(v, { ...base, bob: 4, lean: 6, step: 8, ...A(41, 25, 30) }) },
          { name: '戻す', g: draw(v, { ...base, bob: 2, lean: 2, ...A(37, 28, -60) }) },
        ];
  };
  const hurt = (v) => {
    const f = v === 'front';
    return [
      draw(v, { lean: -5, bob: 1, step: 1, back: 3, sway: 2, flash: 0.55, spark: f ? [27, 24] : [33, 19], fan: holdFan(f, -1, -18) }),
      draw(v, { lean: -2, bob: 2, step: 2, back: 4, sway: 1, fan: holdFan(f, 0, -8) }),
    ];
  };
  const fall = (v) => {
    const f = v === 'front';
    const kneel = draw(v, { lean: 3, bob: 7, step: 3, back: 2, sway: 1, fan: { ...holdFan(f, 8, 0), ang: f ? 150 : 160 } });
    const px = 40, py = 64;
    return [kneel, rotate(kneel, -38, px, py, 6, 0), rotate(kneel, -84, px, py, 14, 2)];
  };
  return {
    W, H, R,
    斜め前: { 待機: stance('front'), 歩き: walk('front'), 攻撃: attack('front'), 被弾: hurt('front'), 倒れ: fall('front') },
    斜め後ろ: { 待機: stance('back'), 歩き: walk('back'), 攻撃: attack('back'), 被弾: hurt('back'), 倒れ: fall('back') },
  };
})();
