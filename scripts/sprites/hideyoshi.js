// 豊臣秀吉（刀）3頭身・背丈38ドット（後立てを除く）。斜め前（front）と斜め後ろ（back）。謙信と同じ刀の構えと動きで、頭・色・飾りを差し替える。
// 目印は、背の大きな金の放射状の後立て（馬藺の後立）、高い黒い兜、赤い鎧、紫の袖と袴、背中の赤い×の紐、跳ね上がった口ひげ。common.js と一緒に読む
const KH = (() => {
  // 素材の色（暗・影・地・明）
  const R = {
    a: ['#3e0c08', '#6e1a12', '#a32e1c', '#cf5234'], // 赤い鎧（縅）
    n: ['#0c0c10', '#191920', '#2a2a34', '#46465a'], // 黒漆（胸板・籠手・すね当て）
    f: ['#24101e', '#3e1c34', '#5c2c4c', '#80456a'], // 紫の袖
    p: ['#1e0e1a', '#34182c', '#4e2442', '#6c3a5c'], // 紫の袴
    g: ['#6e4a1c', '#a8782c', '#e0b84e', '#fff0a0'], // 金
    d: ['#0b0b10', '#1e1e26', '#33333f', '#5c5c74'], // 黒（帯・鞘・柄）
    e: ['#5c6470', '#9aa4b2', '#dfe6ee', '#ffffff'], // 刀身
    r: ['#5e1414', '#9c2a24', '#d14a38', '#f08a6a'], // 赤い紐（軍の色に塗り替える）
    s: ['#7a4a34', '#b67c58', '#d9a77c', '#efc69e'], // 肌（日に焼けた色）
    C: ['#0c0c10', '#191920', '#2a2a34', '#46465a'], // 兜（手で置いた頭の素材）
  };
  // 手で置いた頭。K 兜の縁 N 兜 M 兜の光 n 兜の影 g 金 a 赤い錣 A 錣の影 S 肌 s 肌の影
  // b 眉 e 白目 E 黒目 B ひげ m 口 r 赤い紐（軍の色）
  const HP = {
    K: '#0c0c10', N: '#2a2a34', M: '#46465a', n: '#191920', g: '#e0b84e', a: '#a32e1c', A: '#6e1a12',
    S: '#d9a77c', s: '#b67c58', b: '#1e140e', e: '#f8f4ee', E: '#1c120c', B: '#5a4030', m: '#a04a3c', r: R.r[2],
  };
  const HEAD_FRONT = {
    ax: 8.5, ay: 8.5, top: 0,
    rows: [
      '.....KNNNNK.......',
      '.....KNMNNK.......',
      '.....KNNNNK.......',
      '....KNNNNNNK......',
      '..KNNNNNNNNNNK....',
      '.KngggggggggggK...',
      'KanrSSSSSSSSSSnK..',
      'KanrSSbbbSSSbbSnK.',
      'KanrSSSeESSSeESnK.',
      '.KarSSSSSSSSSSsK..',
      '..KrSBBBSmSBBBs...',
      '...rSBSSSSSSSBS...',
      '....rrSSSSSSSs....',
      '......rrSrr.......',
    ],
  };
  const HEAD_BACK = {
    ax: 8.5, ay: 8.5, top: 0,
    rows: [
      '.......KNNNNK.....',
      '.......KNgNNK.....',
      '.......KNgNgK.....',
      '......KNgNgNNK....',
      '....KNNgNgNgNNK...',
      '...KaaaaaaaaaaaK..',
      '..KAaaaaaaaaaaaaK.',
      '.KAaaaaaraaaaaaaSK',
      '.KAAaaaarraaaaaaS.',
      '..KAAaaarraaaaaK..',
      '.......rr.........',
      '......r..r........',
    ],
  };
  const W = 80, H = 72, OX = 16, OY = 10, SC = 36 / 44, BLADE = 20, HILT = 6;
  const HEAD = 14, KY = 0.68, DROP = 13;
  const Y = (y) => (y <= HEAD ? y : HEAD + (y - HEAD) * KY) + DROP;
  const AX = 39, AY = 65;
  const SP = (x, y) => [AX + (x - AX) * SC, AY + (y - AY) * SC];
  const TW = (t) => Math.max(1, Math.round(t * SC));
  // 後立て：兜の後ろから放射状に出す金の矢。本数、内と外の半径（横・縦。縮めたあとのドット）
  const HALO_N = 9, HALO_R0 = 6, HALO_RX = 19, HALO_RY = 13;
  function draw(view, o = {}) {
    const front = view === 'front';
    const F = front ? [1, 0.5] : [1, -0.5];
    const lean = o.lean || 0, bob = o.bob || 0, sway = o.sway || 0;
    const T = (x, y) => { const s = Math.max(0, (42 - y) / 26); return SP(x + lean * s * F[0] + OX, Y(y) + lean * s * F[1] + bob + OY); };
    const { m, sg, wm, set, polyA, ellA, lineA, weapon } = mkCanvas(W, H);
    const fix = [];
    let top = null; // 兜の上の端（幟を立てる位置を決める）
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
    const poly = (pts, v) => polyA(pts.map(([x, y]) => T(x, y)), v);
    const rect = (x, y, w, h, v) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const [X, Yy] = T(x + i, y + j); set(Math.round(X), Math.round(Yy), v); } };
    const line = (x0, y0, x1, y1, v, t) => { const a = T(x0, y0), b = T(x1, y1); lineA(a[0], a[1], b[0], b[1], v, TW(t || 1)); };
    const leg = (hip, foot, v, wid, shoe) => {
      wid = TW(wid); shoe = shoe * SC;
      const h = SP(hip[0] + OX, Y(hip[1]) + bob + OY), f = SP(foot[0] + OX, Y(foot[1]) + OY);
      const k = joint(h[0], h[1], f[0], f[1], 7.5 * KY * SC, 7.5 * KY * SC, (a, b) => (a[0] * F[0] + a[1] * F[1] > b[0] * F[0] + b[1] * F[1] ? a : b));
      lineA(h[0], h[1], k[0], k[1], 'p', wid);
      lineA(k[0], k[1], f[0], f[1] - 1, v, wid);
      // すね当ての赤い紐（1本。軍の色）
      const x = k[0] + (f[0] - k[0]) * 0.2, y = k[1] + (f[1] - 1 - k[1]) * 0.2; lineA(x - wid / 2 + 0.5, y, x + wid / 2 - 0.5, y, 'r');
      lineA(f[0] - shoe / 2, f[1], f[0] + shoe / 2, f[1] + (front ? 0.5 : -0.5), 'd', 2);
    };
    const step = o.step || 0, back = o.back || 0;
    const nearHip = front ? [20.5, 40] : [26.5, 40], farHip = front ? [26, 40] : [20.5, 40];
    const nearFoot = front ? [20, 54] : [27, 54], farFoot = front ? [26, 53] : [20.5, 53];
    const legs = () => {
      leg(farHip, [farFoot[0] - F[0] * back, farFoot[1] - F[1] * back - (o.farLift || 0)], 'n', 4, 6);
      leg(nearHip, [nearFoot[0] + F[0] * step, nearFoot[1] + F[1] * step - (o.nearLift || 0)], 'n', 5, 7);
    };
    // 刀と腕（謙信と同じ）：sword.hx・hy は柄を握る手前の手、ang は刃の向き。奥の手は柄の少し後ろを握る
    const sw = o.sword;
    let hand, dir, farHand;
    if (sw) { hand = SP(sw.hx + OX, Y(sw.hy) + OY); dir = [Math.cos(rad(sw.ang)), Math.sin(rad(sw.ang))]; farHand = [hand[0] - dir[0] * 4 * SC, hand[1] - dir[1] * 4 * SC]; }
    const nearSh = T(...(front ? [15, 20] : [34, 20])), farSh = T(...(front ? [33, 20] : [14, 20]));
    const armIK = (s, h, up, fore, w = 5) => {
      const e = joint(s[0], s[1], h[0], h[1], 8 * 0.8 * SC, 8 * 0.8 * SC, (a, b) => (a[1] > b[1] ? a : b));
      lineA(s[0], s[1], e[0], e[1], up, TW(w));
      lineA(e[0], e[1], h[0], h[1], fore, TW(w - 1));
      ellA(h[0] + 0.5, h[1] + 0.5, 2.1 * SC, 1.9 * SC, 's');
    };
    const blade = () => weapon(() => {
      const HL = HILT * SC, BL = BLADE * SC, t2 = TW(2);
      lineA(hand[0] - dir[0] * HL, hand[1] - dir[1] * HL, hand[0], hand[1], 'd', t2);
      lineA(hand[0] + dir[0] * 2 * SC, hand[1] + dir[1] * 2 * SC, hand[0] + dir[0] * (2 * SC + BL), hand[1] + dir[1] * (2 * SC + BL), 'e', t2);
      const t = [hand[0] + dir[0] * 1.5 * SC, hand[1] + dir[1] * 1.5 * SC], q = 1.5 * SC;
      lineA(t[0] - dir[1] * q, t[1] + dir[0] * q, t[0] + dir[1] * q, t[1] - dir[0] * q, 'g', t2);
    });
    // 後立て：兜の後ろ（頭の上のほう）を中心に、上と左右へ金の矢を広げる。矢が重なって塊に見えないよう、縁取りのない
    // 1ドットの線にして、体を描いたあとに空いている所（体の奥）にだけ置く。根元は暗く、先は明るい金
    const haloPts = [];
    const halo = () => {
      const [cx, cy] = T(front ? 23.5 : 25.5, 3.5);
      for (let i = 0; i < HALO_N; i++) {
        const a = rad(170 + (200 * i) / (HALO_N - 1));
        const c = Math.cos(a), s = Math.sin(a);
        const n = Math.ceil(Math.max(HALO_RX, HALO_RY) * 1.5);
        for (let k = 0; k <= n; k++) {
          const t = k / n, rx = HALO_R0 + (HALO_RX - HALO_R0) * t, ry = HALO_R0 * 0.8 + (HALO_RY - HALO_R0 * 0.8) * t;
          haloPts.push([Math.round(cx + c * rx), Math.round(cy + s * ry), t > 0.85 ? R.g[3] : t > 0.3 ? R.g[2] : R.g[1]]);
        }
      }
    };
    const sode = (cx, cy, wide) => { const [X, Yy] = T(cx, cy); const w = wide * SC, u = 3.4 * SC; polyA([[X - w, Yy - u], [X + w, Yy - u], [X + w + 0.5, Yy + u], [X - w - 0.5, Yy + u + 0.5]], 'a'); };
    // 縅の段（細かくしすぎないよう、暗い横線を数本だけ）と金の縁
    let xCords = false;
    const rows = (ys, x0, x1, c) => { for (const yy of ys) for (let x = x0; x < x1; x++) { const [X, Yy] = T(x, yy).map(Math.round); if (m[Yy] && m[Yy][X] === 'a') fix.push([X, Yy, c]); } };

    if (front) {
      halo();
      legs();
      if (sw) armIK(farSh, farHand, 'f', 'n', 4);
      // 赤い胴と草摺、黒い胸板、黒い帯、草摺の金の縁
      poly([[16, 17], [32, 17], [33, 44], [15, 44]], 'a');
      poly([[17, 17], [31, 17], [31, 21], [17, 21]], 'n');
      poly([[15.5, 29.5], [32.5, 29.5], [33, 31.5], [15.5, 31.5]], 'd');
      line(15, 44, 33, 44, 'g', 1);
      sode(33, 21, 2.8);
      line(29, 32, 36, 37, 'd', 2); rect(28, 31, 2, 2, 'g');
      if (sw && o.bladeBehind) blade();
      // 紫の襟
      poly([[17, 13], [31, 13], [32, 17], [29, 19], [19, 19], [16, 17]], 'f');
      stampHead(HEAD_FRONT);
      if (sw) armIK(nearSh, hand, 'f', 'n');
      sode(15, 20, 4.2);
      if (sw && !o.bladeBehind) blade();
      rows([24.5, 27, 35, 38.5], 15, 34, R.a[0]);
      rows([22], 15, 34, R.g[2]);
      rows([23.5], 9, 21, R.g[2]);
    } else {
      halo();
      legs();
      // 手が体の前にある間は、両腕と刀の根元が背中に隠れる
      const occl = sw && !o.raised;
      if (sw) armIK(farSh, farHand, 'f', 'n', 4);
      if (occl) { armIK(nearSh, hand, 'f', 'n'); blade(); }
      // 赤い胴の背・黒い背板・黒い帯・背中の赤い×の紐（軍の色）
      poly([[14, 17], [34, 17], [35, 44], [13, 44]], 'a');
      poly([[18, 17], [30, 17], [30, 21], [18, 21]], 'n');
      poly([[13.5, 29.5], [34.5, 29.5], [35, 31.5], [13.5, 31.5]], 'd');
      line(13, 44, 35, 44, 'g', 1);
      line(17, 33, 6, 43, 'd', 2); rect(4, 43, 3, 2, 'g');
      // 背中の×の紐：肩の下から帯まで（上は錣に隠れるので、肩の下から見せる）
      line(15.5, 20, 32.5, 32, 'r', 1.6);
      line(32.5, 20, 15.5, 32, 'r', 1.6);
      xCords = true;
      sode(13, 20, 2.8); sode(34, 20, 4.2);
      // 首の後ろ（錣の下）を赤い縅で埋める
      poly([[17, 12], [31, 12], [32, 17], [16, 17]], 'a');
      stampHead(HEAD_BACK);
      if (sw && !occl) { armIK(nearSh, hand, 'f', 'n'); blade(); }
      rows([24.5, 35, 38.5], 13, 36, R.a[0]);
      rows([23.5], 8, 41, R.g[2]);
    }
    // 陰影
    const out = shade(m, R, { skip: 'ksegr', pass: 'rg', adjust: (v, tone, x, y, same) => (v === 'e' ? (!same(x, y - 1, v) ? 3 : 2) : tone) });
    for (const [x, y, c] of fix) if (y >= 0 && y < H && x >= 0 && x < W && m[y][x]) out[y][x] = c;
    // 背中の×の紐は、赤い鎧の上でも見えるよう明るい赤にする
    if (xCords) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y][x] === 'r' && y < 50) out[y][x] = R.r[3];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (sg[y][x]) out[y][x] = sg[y][x];
    outline(out, m, R, 'dnfpeaC');
    for (const [x, y, c] of haloPts) if (x >= 0 && y >= 0 && x < W && y < H && !out[y][x]) out[y][x] = c;
    if (o.spark) spark(out, T(...o.spark).map(Math.round));
    // スキルの溜め：刀のまわりを金に光らせる（謙信と同じ作り。色は後立ての金）
    if (o.aura) weaponAura(out, wm, o.aura, [R.g[3], R.g[2]]);
    // 刀狩：地に突き立てた刀の切っ先から、地面に金の輪（平たい楕円）を広げる。quake は輪の横の半径（ドット）
    if (o.quake && sw) {
      const tx = hand[0] + dir[0] * (2 + BLADE) * SC, ty = Math.min(H - 5, hand[1] + dir[1] * (2 + BLADE) * SC);
      const rx = o.quake, ry = o.quake * 0.36;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (out[y][x]) continue;
        const d = Math.hypot((x + 0.5 - tx) / rx, (y + 0.5 - ty) / ry);
        if (Math.abs(d - 1) < 1.1 / ry) out[y][x] = (x + y) % 2 ? R.g[3] : R.g[2];
        else if (o.quake > 8 && Math.abs(d - 0.6) < 0.8 / ry && (x + y) % 2) out[y][x] = R.g[2];
      }
    }
    // 斬撃の軌跡：手前の肩を中心に、刀の通った弧（謙信と同じ）
    if (o.arc && sw) {
      const [a0, a1, wid0] = o.arc, wid = wid0 * SC, cx = nearSh[0], cy = nearSh[1];
      const tip = Math.hypot(hand[0] + dir[0] * (2 + BLADE) * SC - cx, hand[1] + dir[1] * (2 + BLADE) * SC - cy);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (out[y][x]) continue;
        let a = (Math.atan2(y + 0.5 - cy, x + 0.5 - cx) * 180) / Math.PI;
        while (a < a0) a += 360;
        if (a > a1) continue;
        const k = (a - a0) / (a1 - a0), d = tip - Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d >= 0 && d < wid * k + 0.6) out[y][x] = d < 1 ? TRAIL.core : k > 0.65 ? TRAIL.lead : TRAIL.body; // 色は common.js の TRAIL（槍・軍配の残像と同じ）
      }
    }
    out.top = top;
    return out;
  }
  // 以下の姿勢は謙信（kenshin.js）と同じ
  const hurt = (v) => {
    const f = v === 'front';
    return [
      draw(v, { lean: -5, bob: 1, step: 1, back: 3, sway: 3, spark: f ? [30, 24] : [36, 19],
        sword: f ? { hx: 20, hy: 23, ang: -128 } : { hx: 19, hy: 23, ang: -126 } }),
      draw(v, { lean: -2, bob: 2, step: 2, back: 4, sway: 2,
        sword: f ? { hx: 19, hy: 25, ang: -112 } : { hx: 19, hy: 25, ang: -110 } }),
    ];
  };
  const fall = (v) => {
    const f = v === 'front';
    const kneel = draw(v, { lean: 3, bob: 7, step: 3, back: 2, sway: 2,
      sword: f ? { hx: 24, hy: 41, ang: 112 } : { hx: 20, hy: 41, ang: 110 } });
    const px = 40, py = 64;
    return [kneel, rotate(kneel, -38, px, py, 6, 0), rotate(kneel, -84, px, py, 14, 2)];
  };
  const stance = (v) => {
    const f = v === 'front';
    const base = { lean: 1, step: 4, back: 4 };
    const s = (dy, da) => (f ? { hx: 18, hy: 23 + dy, ang: -106 + da } : { hx: 19, hy: 23 + dy, ang: -104 + da });
    return [
      draw(v, { ...base, bob: 2, sword: s(0, 0), sway: 1 }),
      draw(v, { ...base, bob: 2, sword: s(0, -2), sway: 2 }),
      draw(v, { ...base, bob: 3, sword: s(1, -1), sway: 2 }),
      draw(v, { ...base, bob: 3, sword: s(1, 1), sway: 1 }),
    ];
  };
  const walk = (v) => {
    const f = v === 'front';
    const s = (dy) => (f ? { hx: 18, hy: 24 + dy, ang: -102 } : { hx: 19, hy: 24 + dy, ang: -100 });
    const base = { lean: 2 };
    return [
      draw(v, { ...base, step: 7, back: 6, bob: 1, sword: s(1), sway: 1 }),
      draw(v, { ...base, step: 0, back: -1, farLift: 3, bob: 0, sword: s(0), sway: 2 }),
      draw(v, { ...base, step: -5, back: -7, bob: 1, sword: s(1), sway: 1 }),
      draw(v, { ...base, step: 1, back: 0, nearLift: 3, bob: 0, sword: s(0), sway: 0 }),
    ];
  };
  // スキル（刀狩）：刀を胸の前に立てて構える → 頭の上へ高く掲げる（溜めのあいだ、刀が金に光る）→ 前の地面に切っ先から
  // 突き立てる → 押し込む（地面に金の輪が広がる）→ 刀を立てたまま身を起こす残心。
  // 通常攻撃（振りかぶって斜めに斬り下ろす）と見分けるため、刀はどのコマもまっすぐ上か下へ向ける
  const skill = (v) => {
    const f = v === 'front';
    const g = (o) => draw(v, o);
    return f
      ? [
          { name: '構える', g: g({ aura: 1, sword: { hx: 31, hy: 25, ang: -88 }, lean: -1, bob: 2, step: 3, back: 4, sway: 1 }) },
          { name: '掲げる', g: g({ aura: 2, sword: { hx: 26, hy: 2, ang: -90 }, lean: -4, bob: 0, step: 2, back: 3, sway: 2, bladeBehind: true }) },
          { name: '突き立てる', g: g({ sword: { hx: 32, hy: 31, ang: 74 }, lean: 6, bob: 4, step: 8, back: 6, sway: -1, quake: 7 }) },
          { name: '押し込む', g: g({ sword: { hx: 32, hy: 33, ang: 74 }, lean: 7, bob: 6, step: 8, back: 7, sway: -2, quake: 13 }) },
          { name: '残心', g: g({ sword: { hx: 32, hy: 30, ang: 74 }, lean: 3, bob: 3, step: 7, back: 5 }) },
        ]
      : [
          { name: '構える', g: g({ aura: 1, sword: { hx: 33, hy: 25, ang: -88 }, lean: -1, bob: 2, step: 3, back: 4, sway: 1, raised: true }) },
          { name: '掲げる', g: g({ aura: 2, sword: { hx: 26, hy: 2, ang: -90 }, lean: -4, bob: 0, step: 2, back: 3, sway: 2, raised: true }) },
          { name: '突き立てる', g: g({ sword: { hx: 34, hy: 27, ang: 64 }, lean: 6, bob: 4, step: 8, back: 6, sway: 2, raised: true, quake: 7 }) },
          { name: '押し込む', g: g({ sword: { hx: 34, hy: 29, ang: 64 }, lean: 7, bob: 6, step: 8, back: 7, sway: 3, raised: true, quake: 13 }) },
          { name: '残心', g: g({ sword: { hx: 34, hy: 26, ang: 64 }, lean: 3, bob: 3, step: 7, back: 5, sway: 1, raised: true }) },
        ];
  };
  return {
    W, H, R,
    斜め前: {
      待機: stance('front'),
      歩き: walk('front'),
      被弾: hurt('front'),
      倒れ: fall('front'),
      スキル: skill('front'),
      攻撃: [
        { name: '溜め', g: draw('front', { sword: { hx: 18, hy: 20, ang: -125 }, lean: -2, bob: 3, step: 4, back: 5, sway: 2 }) },
        { name: '振りかぶり', g: draw('front', { sword: { hx: 20, hy: -2, ang: 198 }, lean: -4, step: 1, back: 3, sway: 3, bladeBehind: true }) },
        { name: '踏み込み斬り', g: draw('front', { sword: { hx: 34, hy: 31, ang: 38 }, lean: 6, bob: 3, step: 9, back: 5, sway: -1, arc: [-150, 38, 5] }) },
        { name: '振り抜き', g: draw('front', { sword: { hx: 32, hy: 38, ang: 62 }, lean: 7, bob: 4, step: 9, back: 7, sway: -2, arc: [-30, 62, 3] }) },
        { name: '残心', g: draw('front', { sword: { hx: 31, hy: 32, ang: 22 }, lean: 3, bob: 2, step: 8, back: 5 }) },
      ],
    },
    斜め後ろ: {
      待機: stance('back'),
      歩き: walk('back'),
      被弾: hurt('back'),
      倒れ: fall('back'),
      スキル: skill('back'),
      攻撃: [
        { name: '溜め', g: draw('back', { sword: { hx: 19, hy: 20, ang: -124 }, lean: -2, bob: 3, step: 4, back: 5, sway: 2 }) },
        { name: '振りかぶり', g: draw('back', { sword: { hx: 26, hy: -3, ang: 160 }, lean: -4, step: 1, back: 3, sway: 3, raised: true }) },
        { name: '踏み込み斬り', g: draw('back', { sword: { hx: 36, hy: 24, ang: 8 }, lean: 6, bob: 3, step: 9, back: 5, sway: 2, raised: true, arc: [-160, 8, 5] }) },
        { name: '振り抜き', g: draw('back', { sword: { hx: 35, hy: 30, ang: 42 }, lean: 7, bob: 4, step: 9, back: 7, sway: 3, raised: true }) },
        { name: '残心', g: draw('back', { sword: { hx: 34, hy: 26, ang: -8 }, lean: 3, bob: 2, step: 8, back: 5, sway: 1, raised: true }) },
      ],
    },
  };
})();
