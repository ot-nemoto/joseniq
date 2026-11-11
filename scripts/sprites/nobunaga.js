// 織田信長（ふだんは槍、スキルで鉄砲の三段撃ち）3頭身・背丈38ドット。斜め前（front）と斜め後ろ（back）。謙信と同じ組み立てで、頭・色・武器を差し替える。
// 槍の描き方は大島光義（mitsuyoshi.js）と同じ。鉄砲は、ふだんは背負い、スキルの時だけ構える
const KN = (() => {
  // 素材の色（暗・影・地・明）
  const R = {
    n: ['#0c0c10', '#191920', '#2a2a34', '#46465a'], // 黒漆の鎧
    f: ['#1a110c', '#2e1f17', '#45302a', '#5e4436'], // 茶の小袖・袴
    c: ['#4e100c', '#82221b', '#b03a30', '#d4604f'], // 赤いマント
    g: ['#6e4a1c', '#a8782c', '#e0b84e', '#fff0a0'], // 金
    d: ['#0b0b10', '#1e1e26', '#33333f', '#5c5c74'], // 黒（鞘・足袋）
    e: ['#2a2d35', '#4a4e5a', '#70768a', '#a8aebd'], // 鉄砲の銃身（黒い鎧の前でも見えるよう、明るめの鉄）
    t: ['#3a2010', '#5c3519', '#7e4c26', '#a3683a'], // 鉄砲の木の台
    y: ['#3a2010', '#5c3519', '#7e4c26', '#a3683a'], // 槍の柄（鉄砲の台と同じ木。輪郭で暗くしないよう、別の素材にする）
    w: ['#8f8a80', '#c4c0b6', '#e8e5dc', '#ffffff'], // 白い縄の帯
    r: ['#5e1414', '#9c2a24', '#d14a38', '#f08a6a'], // 朱の飾り（軍の色に塗り替える）
    s: ['#8a5a44', '#c98f6e', '#ecc4a0', '#fde3c8'], // 肌
    C: ['#120d0a', '#241a14', '#3a2b22', '#55402f'], // 髪（手で置いた頭の素材）
  };
  // 手で置いた頭。K 髪の縁 h 髪 H 髪の光 R 元結（髷を結う紐） S 肌 s 肌の影 b 眉 e 白目 E 黒目 B ひげ m 口
  // 顔の点が何か分かるよう、形と色で分ける：目は白目と黒目の2ドット、眉は暗い横線、ひげは髪より明るい茶、口は赤み
  const HP = { K: '#120d0a', h: '#3a2b22', H: '#5f4836', R: '#d6d6de', S: '#ecc4a0', s: '#c98f6e', b: '#1e140e', e: '#f8f4ee', E: '#1c120c', B: '#5a4030', m: '#a04a3c' };
  const HEAD_FRONT = {
    ax: 7.5, ay: 10,
    rows: [
      '....hHh.........',
      '...hHhHh........',
      '..hH.hHh........',
      '.....RR.........',
      '....KhhhhK......',
      '...KhhhhHHhK....',
      '..KhhhhhhhHhK...',
      '..KhhhSSSSSShK..',
      '..KhhSbbbSSbbK..',
      '..KhhSeESSSeEs..',
      '..KhhSSSSSSSSs..',
      '...KhSBBmSBBs...',
      '....KSSBBBSS....',
      '.....SSSBSS.....',
      '......SSBS......',
      '.......SS.......',
    ],
  };
  const HEAD_BACK = {
    ax: 7.5, ay: 10,
    rows: [
      '......hHh.......',
      '.....hHhHh......',
      '.....hH.hHh.....',
      '.......RR.......',
      '.....KhhhhK.....',
      '...KKhhhhHHKK...',
      '..KhhhhhhhhHhK..',
      '..KhhhhhhhhhhhK.',
      '..KhhhhhhhhhhSK.',
      '..KhhhhhhhhhhSs.',
      '..KhhhhhhhhhhS..',
      '...KhhhhhhhhBS..',
      '....KhhhhhhhB...',
      '......SSSS......',
      '................',
      '................',
    ],
  };
  const W = 80, H = 72, OX = 16, OY = 10, SC = 36 / 44;
  const HEAD = 14, KY = 0.68, DROP = 13;
  const Y = (y) => (y <= HEAD ? y : HEAD + (y - HEAD) * KY) + DROP;
  const AX = 39, AY = 65;
  const SP = (x, y) => [AX + (x - AX) * SC, AY + (y - AY) * SC];
  const TW = (t) => Math.max(1, Math.round(t * SC));
  const rad = (a) => (a * Math.PI) / 180;
  const GUN_BACK = 6, GUN_FORE = 17; // 鉄砲：握る手から台尻まで、握る手から銃口まで（縮める前のドット）
  // 槍：握る手から穂先の側（柄の先まで）と石突きの側の長さ、穂先の長さ（縮める前のドット）
  const SPEAR_FWD = 20, SPEAR_BACK = 13, SPEAR_TIP = 5;
  function draw(view, o = {}) {
    const front = view === 'front';
    const F = front ? [1, 0.5] : [1, -0.5];
    const lean = o.lean || 0, bob = o.bob || 0, sway = o.sway || 0;
    const T = (x, y) => { const s = Math.max(0, (42 - y) / 26); return SP(x + lean * s * F[0] + OX, Y(y) + lean * s * F[1] + bob + OY); };
    const m = Array.from({ length: H }, () => Array(W).fill(''));
    const sg = Array.from({ length: H }, () => Array(W).fill(''));
    const fix = [];
    const wm = Array.from({ length: H }, () => Array(W).fill(0)); // 武器のマス（スキルの溜めで光らせる）
    let inW = false;
    const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < W && y < H) { m[y][x] = v; sg[y][x] = ''; wm[y][x] = inW ? 1 : 0; } };
    const stampHead = (hd) => {
      const [cx, cy] = T(24, 8.5);
      const x0 = Math.round(cx - hd.ax), y0 = Math.round(cy - hd.ay);
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
      lineA(h[0], h[1], k[0], k[1], 'f', wid);
      lineA(k[0], k[1], f[0], f[1] - 1, v, wid);
      // すね当ての金の縁（1本）
      const x = k[0] + (f[0] - k[0]) * 0.15, y = k[1] + (f[1] - 1 - k[1]) * 0.15; lineA(x - wid / 2 + 0.5, y, x + wid / 2 - 0.5, y, 'g');
      lineA(f[0] - shoe / 2, f[1], f[0] + shoe / 2, f[1] + (front ? 0.5 : -0.5), 'd', 2);
    };
    const step = o.step || 0, back = o.back || 0;
    const nearHip = front ? [20.5, 40] : [26.5, 40], farHip = front ? [26, 40] : [20.5, 40];
    const nearFoot = front ? [20, 54] : [27, 54], farFoot = front ? [26, 53] : [20.5, 53];
    const legs = () => {
      leg(farHip, [farFoot[0] - F[0] * back, farFoot[1] - F[1] * back - (o.farLift || 0)], 'n', 4, 6);
      leg(nearHip, [nearFoot[0] + F[0] * step, nearFoot[1] + F[1] * step - (o.nearLift || 0)], 'n', 5, 7);
    };
    // 鉄砲と腕：hand は台を握る手（引き金の手）、farHand は銃身を支える手
    const gn = o.gun;
    let hand, dir, farHand;
    if (gn) { hand = SP(gn.hx + OX, Y(gn.hy) + OY); dir = [Math.cos(rad(gn.ang)), Math.sin(rad(gn.ang))]; farHand = [hand[0] + dir[0] * 7 * SC, hand[1] + dir[1] * 7 * SC]; }
    const nearSh = T(...(front ? [15, 20] : [34, 20])), farSh = T(...(front ? [33, 20] : [14, 20]));
    const armIK = (s, h, up, fore, w = 5) => {
      const e = joint(s[0], s[1], h[0], h[1], 8 * 0.8 * SC, 8 * 0.8 * SC, (a, b) => (a[1] > b[1] ? a : b));
      lineA(s[0], s[1], e[0], e[1], up, TW(w));
      lineA(e[0], e[1], h[0], h[1], fore, TW(w - 1));
      ellA(h[0] + 0.5, h[1] + 0.5, 2.0 * SC, 1.8 * SC, 'n'); // 黒の手甲
    };
    const muzzle = () => [hand[0] + dir[0] * GUN_FORE * SC, hand[1] + dir[1] * GUN_FORE * SC];
    const gun = () => { inW = true; gunBody(hand, dir); inW = false; };
    // 鉄砲の本体：hand は握る所、dir は銃口の向き
    const gunBody = (hand, dir) => {
      const b = GUN_BACK * SC, f = GUN_FORE * SC;
      // 台尻から握りまでの木の台（太め）、握りから先は木の台の上に銃身
      lineA(hand[0] - dir[0] * b, hand[1] - dir[1] * b, hand[0], hand[1], 't', TW(3));
      lineA(hand[0], hand[1], hand[0] + dir[0] * f * 0.62, hand[1] + dir[1] * f * 0.62, 't', TW(2));
      const mx = hand[0] + dir[0] * f, my = hand[1] + dir[1] * f;
      lineA(hand[0] + dir[0] * 2 * SC, hand[1] + dir[1] * 2 * SC, mx, my, 'e', TW(2));
      // 金の帯（2か所）
      for (const k of [0.3, 0.58]) { const x = hand[0] + dir[0] * f * k, y = hand[1] + dir[1] * f * k; set(Math.round(x), Math.round(y), 'g'); }
    };
    // 槍：spear.hx・hy は握る手、ang は穂先の向き、grip は握る手が手前（near）か奥（far）か。
    // two なら、もう一方の手も柄の後ろ（握る手から石突きの側へ）を握る。そうでなければ rest の所に下ろす
    const sp = o.spear;
    let sHand, sDir, sOther = null;
    if (sp) {
      sHand = SP(sp.hx + OX, Y(sp.hy) + OY);
      sDir = [Math.cos(rad(sp.ang)), Math.sin(rad(sp.ang))];
      if (sp.two) sOther = [sHand[0] - sDir[0] * 7 * SC, sHand[1] - sDir[1] * 7 * SC];
      else if (sp.rest) sOther = T(...sp.rest);
    }
    let spTip = null; // 穂先の先の端（突いた残像を引く所）
    const spear = () => {
      const b = [sHand[0] - sDir[0] * SPEAR_BACK * SC, sHand[1] - sDir[1] * SPEAR_BACK * SC];
      const t = [sHand[0] + sDir[0] * SPEAR_FWD * SC, sHand[1] + sDir[1] * SPEAR_FWD * SC];
      const e = [t[0] + sDir[0] * SPEAR_TIP * SC, t[1] + sDir[1] * SPEAR_TIP * SC];
      // 柄は木、穂先は白い帯の色（色の数を増やさないため）
      lineA(b[0], b[1], t[0], t[1], 'y', TW(2));
      lineA(t[0], t[1], e[0], e[1], 'w', TW(2));
      fix.push([Math.round(e[0]), Math.round(e[1]), '#ffffff']);
      spTip = e;
    };
    const spFar = sp && sp.grip === 'far';
    // 背負った鉄砲（構えていないとき）：右の腰に台尻を置き、銃口を左の肩の上へ出して斜めに負う
    const backGun = () => {
      const butt = T(...(front ? [31, 40] : [33, 41])), up = T(...(front ? [12, 4] : [12, 5]));
      const l = Math.hypot(up[0] - butt[0], up[1] - butt[1]) || 1, d = [(up[0] - butt[0]) / l, (up[1] - butt[1]) / l];
      gunBody([butt[0] + d[0] * GUN_BACK * SC, butt[1] + d[1] * GUN_BACK * SC], d);
    };
    const sode = (cx, cy, wide) => { const [X, Yy] = T(cx, cy); const w = wide * SC, u = 3 * SC; polyA([[X - w, Yy - u], [X + w, Yy - u], [X + w + 0.5, Yy + u], [X - w - 0.5, Yy + u + 0.5]], 'n'); };
    const lace = [];
    const laceRows = (rows, x0, x1, t = 2) => { for (const y of rows) for (let x = x0; x < x1; x++) { const [X, Yy] = T(x, y).map(Math.round); if (m[Yy] && m[Yy][X] === 'n') lace.push([X, Yy, t]); } };

    if (front) {
      // 赤いマント（背中の側。肩から両わきに見える）
      poly([[12, 16], [34, 16], [35 + sway * 0.5, 44], [11 + sway, 44]], 'c');
      poly([[11 + sway, 43], [35 + sway * 0.5, 43], [35 + sway * 0.5, 44.5], [11 + sway, 44.5]], 'g');
      // 鉄砲を構えていないときは背負う（マントと胴のあいだ）
      if (!gn) backGun();
      legs();
      // 槍：奥の腕は、握る手（奥で握るとき）か、もう一方の手
      if (sp) { const h = spFar ? sHand : sOther; if (h) armIK(farSh, h, 'f', 'n', 4); }
      if (gn) armIK(farSh, farHand, 'f', 'n', 4);
      // 黒漆の胴と草摺、白い縄の帯、金の縁
      poly([[16, 17], [32, 17], [33, 42], [15, 42]], 'n');
      poly([[16, 29.5], [32, 29.5], [32.5, 31.5], [16, 31.5]], 'w');
      poly([[15, 41.5], [33, 41.5], [33, 43.5], [15, 43.5]], 'g');
      sode(33, 21, 2.5);
      // 腰の刀（左の腰に納める）
      line(29, 31, 36, 36, 'd', 2); rect(28, 30, 2, 2, 'g');
      if (gn && o.gunBehind) gun();
      // 黒の立て襟
      poly([[17, 13], [31, 13], [32, 17], [29, 19], [19, 19], [16, 17]], 'n');
      stampHead(HEAD_FRONT);
      // 槍と、手前の腕：握る手（手前で握るとき）か、もう一方の手
      if (sp) { spear(); const h = spFar ? sOther : sHand; if (h) armIK(nearSh, h, 'f', 'n'); }
      if (gn) armIK(nearSh, hand, 'f', 'n');
      sode(15, 20, 4);
      if (gn && !o.gunBehind) gun();
      // 朱の飾り（軍の色）：胸の上と袖に1段ずつ。横線が重なって縞に見えないよう、ほかの線は入れない
      laceRows([20], 16, 33);
      laceRows([22], 10, 20);
    } else {
      legs();
      // 槍を奥の手で握るときは、槍と奥の腕を体の陰に描く
      if (sp && spFar) { armIK(farSh, sHand, 'f', 'n', 4); spear(); }
      else if (sp && sOther) armIK(farSh, sOther, 'f', 'n', 4);
      const occl = gn && !o.raised;
      if (gn) armIK(farSh, farHand, 'f', 'n', 4);
      if (occl) { armIK(nearSh, hand, 'f', 'n'); gun(); }
      // 赤いマントが背中を覆う（金の縁）
      poly([[13, 16], [35, 16], [37 + sway * 0.5, 47], [11 + sway, 47]], 'c');
      poly([[11 + sway, 46], [37 + sway * 0.5, 46], [37 + sway * 0.5, 47.5], [11 + sway, 47.5]], 'g');
      line(13, 17, 11 + sway, 46, 'g', 1);
      line(35, 17, 37 + sway * 0.5, 46, 'g', 1);
      // 背負った鉄砲（マントの上）
      if (!gn) backGun();
      // 腰の刀（左の腰から手前へ）
      line(17, 34, 6, 44, 'd', 2); rect(4, 44, 3, 2, 'g');
      sode(13, 20, 2.5); sode(34, 20, 4);
      poly([[16, 12], [32, 12], [33, 16], [30, 18], [18, 18], [15, 16]], 'n');
      stampHead(HEAD_BACK);
      if (gn && !occl) { armIK(nearSh, hand, 'f', 'n'); gun(); }
      if (sp && !spFar) { spear(); armIK(nearSh, sHand, 'f', 'n'); }
      else if (sp && spFar && sOther && sp.two) armIK(nearSh, sOther, 'f', 'n');
      laceRows([22], 9, 40);
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
      const v = m[y][x]; if (!v || 'ksy'.includes(v)) continue;
      const r = x + 1 < W ? m[y][x + 1] : '', d = y + 1 < H ? m[y + 1][x] : '';
      if ((r && r !== v && r !== 'r') || (d && d !== v && d !== 'r')) out[y][x] = R[v][v === 'c' || v === 'w' ? 1 : 0];
    }
    for (const [x, y, t] of lace) out[y][x] = R.r[t];
    for (const [x, y, c] of fix) if (y >= 0 && y < H && x >= 0 && x < W && m[y][x]) out[y][x] = c;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (sg[y][x]) out[y][x] = sg[y][x];
    const add = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (m[y][x]) continue;
      const ns = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([i, j]) => i >= 0 && j >= 0 && i < W && j < H && m[j][i]);
      if (!ns.length) continue;
      const [i, j] = ns[0], v = m[j][i];
      add.push([x, y, (y > 0 && m[y - 1][x]) || 'dnfetC'.includes(v) ? LINE : R[v][0]]);
    }
    for (const [x, y, c] of add) out[y][x] = c;
    const dot = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < W && y < H) out[y][x] = c; };
    // 撃った瞬間：銃口の火花（前へ長く伸ばす）
    if (o.fire && gn) {
      const [mx, my] = muzzle(), px = -dir[1], py = dir[0];
      for (let k = 1; k <= 6; k++) { const c = k < 3 ? '#ffffff' : k < 5 ? '#ffe27a' : '#f08a2a'; dot(mx + dir[0] * k, my + dir[1] * k, c); if (k < 5) { dot(mx + dir[0] * k + px, my + dir[1] * k + py, k < 3 ? '#ffe27a' : '#f08a2a'); dot(mx + dir[0] * k - px, my + dir[1] * k - py, k < 3 ? '#ffe27a' : '#f08a2a'); } }
      for (const s of [-1, 1]) for (let k = 1; k <= 3; k++) dot(mx + dir[0] * k * 0.6 + px * s * (k + 1), my + dir[1] * k * 0.6 + py * s * (k + 1), k < 2 ? '#ffe27a' : '#f08a2a');
      dot(mx, my, '#ffffff');
    }
    // 煙：銃口の先に灰色の玉を重ね、時間がたつほど大きく、上へ流す
    if (o.smoke && gn) {
      // 撃った場所（狙ったときの銃口）に残す。銃を動かしても煙はついて行かない
      const sf = o.smokeFrom, sh0 = sf ? SP(sf.hx + OX, Y(sf.hy) + OY) : hand, sd = sf ? [Math.cos(rad(sf.ang)), Math.sin(rad(sf.ang))] : dir;
      const mx = sh0[0] + sd[0] * GUN_FORE * SC, my = sh0[1] + sd[1] * GUN_FORE * SC;
      const [n, drift] = o.smoke;
      for (let k = 0; k < n; k++) {
        const cx = mx + sd[0] * (2 + k * 2.5), cy = my + sd[1] * (2 + k * 2.5) - drift - k * 1.2, r = 1.5 + k * 0.5 + drift * 0.35;
        for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy); if (d > r) continue;
          if (x >= 0 && y >= 0 && x < W && y < H && !out[y][x]) out[y][x] = d > r - 0.8 ? '#8c8a86' : '#c9c7c2';
        }
      }
    }
    // スキルの溜め：武器（鉄砲）のまわりを光らせる
    if (o.aura) weaponAura(out, wm, o.aura, ['#fff0a0', '#e0b84e']);
    // 突いた槍の残像：穂先から、突いた向きと逆へ伸びる細い筋（common.js の thrustTrail）
    if (o.thrust && spTip) thrustTrail(out, spTip, sDir, o.thrust);
    if (o.spark) {
      const [sx, sy] = T(...o.spark).map(Math.round);
      const P = [[0, 0, '#ffffff'], [1, 0, '#ffffff'], [-1, 0, '#ffffff'], [0, 1, '#ffffff'], [0, -1, '#ffffff']];
      for (let r = 2; r <= 4; r++) P.push([r, 0, r < 4 ? '#ffe27a' : '#f08a2a'], [-r, 0, r < 4 ? '#ffe27a' : '#f08a2a'], [0, r, r < 4 ? '#ffe27a' : '#f08a2a'], [0, -r, r < 4 ? '#ffe27a' : '#f08a2a']);
      for (const [dx, dy, c] of P) dot(sx + dx, sy + dy, c);
    }
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
  // 待機：槍を画面の左に立てて持つ（斜め前は手前の手、斜め後ろは奥の手）。もう一方の手は腰に下ろす。鉄砲は背負う
  const holdSpear = (f, dy = 0, da = 0) => (f
    ? { hx: 12, hy: 31 + dy, ang: -95 + da, grip: 'near', rest: [33, 34] }
    : { hx: 11, hy: 31 + dy, ang: -93 + da, grip: 'far', rest: [34, 34] });
  const stance = (v) => {
    const f = v === 'front';
    const base = { lean: 1, step: 4, back: 4 };
    return [
      draw(v, { ...base, bob: 2, spear: holdSpear(f), sway: 0 }),
      draw(v, { ...base, bob: 2, spear: holdSpear(f, 0, -1), sway: 1 }),
      draw(v, { ...base, bob: 3, spear: holdSpear(f, 1, -1), sway: 1 }),
      draw(v, { ...base, bob: 3, spear: holdSpear(f, 1, 1), sway: 0 }),
    ];
  };
  const walk = (v) => {
    const f = v === 'front';
    const base = { lean: 2 };
    return [
      draw(v, { ...base, step: 7, back: 6, bob: 1, spear: holdSpear(f, 1, 3), sway: 1 }),
      draw(v, { ...base, step: 0, back: -1, farLift: 3, bob: 0, spear: holdSpear(f, 0, 0), sway: 2 }),
      draw(v, { ...base, step: -5, back: -7, bob: 1, spear: holdSpear(f, 1, -3), sway: 1 }),
      draw(v, { ...base, step: 1, back: 0, nearLift: 3, bob: 0, spear: holdSpear(f, 0, 0), sway: 0 }),
    ];
  };
  // 攻撃（槍）：両手で中段に構える → 引く → 突く → 伸ばす → 戻す。穂先は盤面の「前」（斜め前は右下、斜め後ろは右上）へ向ける。
  // 前の手は、斜め前は奥の手、斜め後ろは手前の手
  const attack = (v) => {
    const f = v === 'front';
    const base = { step: 5, back: 5 };
    const ang = f ? 20 : -26, grip = f ? 'far' : 'near';
    const S = (hx, hy, da = 0) => ({ hx, hy, ang: ang + da, grip, two: true });
    return f
      ? [
          { name: '構える', g: draw(v, { ...base, bob: 2, lean: 0, spear: S(28, 31) }) },
          { name: '引く', g: draw(v, { ...base, bob: 3, lean: -2, spear: S(23, 32, -2) }) },
          { name: '突く', g: draw(v, { ...base, thrust: 14, step: 8, bob: 3, lean: 4, spear: S(35, 30) }) },
          { name: '伸ばす', g: draw(v, { ...base, thrust: 20, step: 9, bob: 3, lean: 6, spear: S(39, 29, 2) }) },
          { name: '戻す', g: draw(v, { ...base, bob: 2, lean: 1, spear: S(30, 31) }) },
        ]
      : [
          { name: '構える', g: draw(v, { ...base, bob: 2, lean: 0, spear: S(36, 25) }) },
          { name: '引く', g: draw(v, { ...base, bob: 3, lean: -2, spear: S(31, 27, 2) }) },
          { name: '突く', g: draw(v, { ...base, thrust: 14, step: 8, bob: 3, lean: 4, spear: S(42, 21) }) },
          { name: '伸ばす', g: draw(v, { ...base, thrust: 20, step: 9, bob: 3, lean: 6, spear: S(45, 19, -2) }) },
          { name: '戻す', g: draw(v, { ...base, bob: 2, lean: 1, spear: S(38, 24) }) },
        ];
  };
  // スキル（鉄砲の三段撃ち）：構える → 狙う（溜めのあいだ狙ったまま）→ 撃つ・撃つ・撃つ（1発ごとに火花。反動で少しずつ銃口が上がり、煙が重なる）。
  // 台尻を右肩に当て、頬を台に付けて狙う（握る手は肩の高さ）。狙う向きは盤面の「前」（斜め前は右下、斜め後ろは右上）。槍は持たない
  const skill = (v) => {
    const f = v === 'front';
    const base = { step: 5, back: 5 };
    const aim = f ? 22 : -24, sh = f ? [18, 17] : [32, 17];
    const G = (dx, dy, da) => ({ hx: sh[0] + dx, hy: sh[1] + dy, ang: aim + da });
    const raised = !f;
    return [
      { name: '構える', g: draw(v, { ...base, aura: 1, bob: 2, lean: 0, gun: G(0, 6, 34), raised }) },
      { name: '狙う', g: draw(v, { ...base, aura: 2, bob: 2, lean: 1, gun: G(0, 0, 0), raised }) },
      { name: '撃つ', g: draw(v, { ...base, bob: 2, lean: 1, gun: G(0, 0, 0), raised, fire: true }) },
      { name: '撃つ', g: draw(v, { ...base, bob: 2, lean: 0, gun: G(-1, -1, -4), raised, fire: true, smoke: [2, 1], smokeFrom: G(0, 0, 0) }) },
      { name: '撃つ', g: draw(v, { ...base, bob: 1, lean: -1, gun: G(-1, -1, -8), raised, fire: true, smoke: [4, 3], smokeFrom: G(0, 0, 0) }) },
    ];
  };
  const hurt = (v) => {
    const f = v === 'front';
    return [
      draw(v, { lean: -5, bob: 1, step: 1, back: 3, sway: 2, spark: f ? [27, 24] : [33, 19], spear: holdSpear(f, -1, -16) }),
      draw(v, { lean: -2, bob: 2, step: 2, back: 4, sway: 1, spear: holdSpear(f, 0, -8) }),
    ];
  };
  const fall = (v) => {
    const f = v === 'front';
    const kneel = draw(v, { lean: 3, bob: 7, step: 3, back: 2, sway: 1, spear: { ...holdSpear(f, 7, 0), ang: f ? -150 : -30 } });
    const px = 40, py = 64;
    return [kneel, rotate(kneel, -38, px, py, 6, 0), rotate(kneel, -84, px, py, 14, 2)];
  };
  return {
    W, H, R,
    斜め前: { 待機: stance('front'), 歩き: walk('front'), 攻撃: attack('front'), スキル: skill('front'), 被弾: hurt('front'), 倒れ: fall('front') },
    斜め後ろ: { 待機: stance('back'), 歩き: walk('back'), 攻撃: attack('back'), スキル: skill('back'), 被弾: hurt('back'), 倒れ: fall('back') },
  };
})();
