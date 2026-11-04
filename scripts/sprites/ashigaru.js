// 歩兵（足軽・槍）3頭身・背丈30ドットほど（武将より一回り小さい）。斜め前（front）と斜め後ろ（back）。
// 体の作りは kenshin.js と同じ（体の位置を縮めて置き、頭は手で置いた絵）。兵は幟を持たず、胴と陣笠の合印を軍の色にする。common.js と一緒に読む
RAMP.e = ['#5c6470', '#9aa4b2', '#dfe6ee', '#ffffff']; // 穂先
RAMP.h = ['#3c2414', '#6a4426', '#94663a', '#b88a56']; // 槍の柄
RAMP.u = ['#2e2a26', '#4c443c', '#6c6256', '#8c8070']; // 着物・股引（くすんだ茶）
RAMP.w = ['#6a6458', '#a49c8a', '#d2cab6', '#ece6d6']; // 脚絆
RAMP.z = ['#5a4422', '#8a6c38', '#b89a5c', '#d8c088']; // 草鞋
RAMP.j = ['#0e0e12', '#1c1c24', '#2e2e3a', '#4c4c5e']; // 陣笠（黒漆）

// 背丈30ドット用に1ドットずつ置いた頭（陣笠・顔）。J 陣笠 j 陣笠の影 L 陣笠の光 D 笠の縁 A a 合印（軍の色）
// k 髪 S 肌 s 肌の影 b 眉 e 白目 E 黒目 m 口
const HEAD_PAL = {
  J: RAMP.j[2], j: RAMP.j[1], L: RAMP.j[3], D: RAMP.j[0], A: RAMP.r[2], a: RAMP.r[1],
  k: '#2a1d16', S: '#ecc4a0', s: '#c98f6e', b: '#2a1d16', e: '#f8f4ee', E: '#1c120c', m: '#a04a3c',
};
const HEAD_FRONT = {
  ax: 7.5, ay: 6,
  rows: [
    '......jJJL......',
    '....jJJJJJLL....',
    '..jjJJJJAaJJL...',
    '.jjJJJJJaaJJJJL.',
    'DDDDDDDDDDDDDDDD',
    '...kkkssssss....',
    '...kkSbbSSbbs...',
    '...kkSeESSeEs...',
    '...kkSSSSSSSs...',
    '....kSSSSmSs....',
    '.....ssSSSs.....',
  ],
};
const HEAD_BACK = {
  ax: 7.5, ay: 6,
  rows: [
    '......jJJL......',
    '....jJJJJJLL....',
    '..jjJJJJJJJJL...',
    '.jjJJJJJJJJJJJL.',
    'DDDDDDDDDDDDDDDD',
    '...kkkkkkkkks...',
    '...kkkkkkkkSs...',
    '...kkkkkkkkSs...',
    '...kkkkkkkkS....',
    '....kkkkkkkS....',
    '.....ssssss.....',
  ],
};
const KA = (() => {
  const FW = 80, FH = 72; // 描く枠（謙信と同じ）。最後に CX・CY から W×H を切り出す
  const W = 56, H = 48, CX = 14, CY = 24;
  const OX = 16, OY = 10, SC = 0.68;
  const HEAD = 14, KY = 0.68, DROP = 13;
  const Y = (y) => (y <= HEAD ? y : HEAD + (y - HEAD) * KY) + DROP;
  const AX = 39, AY = 65;
  const SP = (x, y) => [AX + (x - AX) * SC, AY + (y - AY) * SC];
  const TW = (t) => Math.max(1, Math.round(t * SC));
  const rad = (a) => (a * Math.PI) / 180;
  function draw(view, o = {}) {
    const front = view === 'front';
    const F = front ? [1, 0.5] : [1, -0.5];
    const lean = o.lean || 0, bob = o.bob || 0;
    const T = (x, y) => { const s = Math.max(0, (42 - y) / 26); return SP(x + lean * s * F[0] + OX, Y(y) + lean * s * F[1] + bob + OY); };
    const m = Array.from({ length: FH }, () => Array(FW).fill(''));
    const sg = Array.from({ length: FH }, () => Array(FW).fill(''));
    const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < FW && y < FH) { m[y][x] = v; sg[y][x] = ''; } };
    let top = null; // 頭（陣笠）の上の端。体力の棒を出す高さに使う
    const stampHead = (hd) => {
      const [cx, cy] = T(24, 8.5);
      const x0 = Math.round(cx - hd.ax), y0 = Math.round(cy - hd.ay);
      top = [x0 + hd.ax, y0];
      hd.rows.forEach((row, j) => [...row].forEach((ch, i) => {
        if (ch === '.') return;
        const x = x0 + i, y = y0 + j;
        if (x < 0 || y < 0 || x >= FW || y >= FH) return;
        m[y][x] = 'S s'.includes(ch) ? 's' : 'Aa'.includes(ch) ? 'r' : 'j';
        sg[y][x] = HEAD_PAL[ch];
      }));
    };
    const polyA = (pts, v) => { for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) if (inPoly(x + 0.5, y + 0.5, pts)) set(x, y, v); };
    const poly = (pts, v) => polyA(pts.map(([x, y]) => T(x, y)), v);
    const ellA = (cx, cy, rx, ry, v) => { for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) set(x, y, v); };
    const lineA = (x0, y0, x1, y1, v, t = 1) => { const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) || 1; const h = (t - 1) / 2;
      for (let i = 0; i <= n; i++) { const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n; for (let j = 0; j < t; j++) for (let k = 0; k < t; k++) set(Math.round(x - h + k), Math.round(y - h + j), v); } };
    const joint = (ax, ay, bx, by, l1, l2, pick) => {
      const D = Math.hypot(bx - ax, by - ay) || 1, d = Math.min(D, l1 + l2 - 0.01), ux = (bx - ax) / D, uy = (by - ay) / D;
      const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
      const px = ax + ux * a, py = ay + uy * a;
      return pick([px - uy * h, py + ux * h], [px + uy * h, py - ux * h]);
    };
    // 脚：股引（u）の腿から膝、脚絆（w）のすね、草鞋（z）
    const leg = (hip, foot, wid, shoe) => {
      wid = TW(wid); shoe = shoe * SC;
      const h = SP(hip[0] + OX, Y(hip[1]) + bob + OY), f = SP(foot[0] + OX, Y(foot[1]) + OY);
      const k = joint(h[0], h[1], f[0], f[1], 7.5 * KY * SC, 7.5 * KY * SC, (a, b) => (a[0] * F[0] + a[1] * F[1] > b[0] * F[0] + b[1] * F[1] ? a : b));
      lineA(h[0], h[1], k[0], k[1], 'u', wid);
      lineA(k[0], k[1], f[0], f[1] - 1, 'w', wid);
      lineA(f[0] - shoe / 2, f[1], f[0] + shoe / 2, f[1] + (front ? 0.5 : -0.5), 'z', 2);
    };
    const step = o.step || 0, back = o.back || 0;
    const nearHip = front ? [21, 40] : [26, 40], farHip = front ? [26, 40] : [21, 40];
    const nearFoot = front ? [20, 54] : [27, 54], farFoot = front ? [26, 53] : [20.5, 53];
    const legs = () => {
      leg(farHip, [farFoot[0] - F[0] * back, farFoot[1] - F[1] * back - (o.farLift || 0)], 4, 6);
      leg(nearHip, [nearFoot[0] + F[0] * step, nearFoot[1] + F[1] * step - (o.nearLift || 0)], 5, 7);
    };
    // 槍：sp.hx, sp.hy は手前の手の位置（体の座標）、ang は穂先の向き（画面の角度）。
    // 柄は手から穂先へ fwd、石突へ bk（体の単位）。two を持てば、奥の手も柄の two だけ後ろを握る
    const sp = o.spear;
    const hand = SP(sp.hx + OX, Y(sp.hy) + OY + bob);
    const dir = [Math.cos(rad(sp.ang)), Math.sin(rad(sp.ang))];
    const nearSh = T(...(front ? [17, 20] : [31, 20])), farSh = T(...(front ? [31, 20] : [17, 20]));
    const farHand = sp.two != null
      ? [hand[0] - dir[0] * sp.two * SC, hand[1] - dir[1] * sp.two * SC]
      : [farSh[0] + (front ? 1 : -1) * SC, farSh[1] + 11 * SC];
    const armIK = (s, h, up, fore, w = 5) => {
      const e = joint(s[0], s[1], h[0], h[1], 8 * 0.8 * SC, 8 * 0.8 * SC, (a, b) => (a[1] > b[1] ? a : b));
      lineA(s[0], s[1], e[0], e[1], up, TW(w));
      lineA(e[0], e[1], h[0], h[1], fore, TW(w - 1));
      ellA(h[0] + 0.5, h[1] + 0.5, 2 * SC, 1.8 * SC, 's');
    };
    const spear = () => {
      const fwd = (sp.fwd ?? 26) * SC, bk = (sp.bk ?? 18) * SC, tip = 5 * SC;
      lineA(hand[0] - dir[0] * bk, hand[1] - dir[1] * bk, hand[0] + dir[0] * fwd, hand[1] + dir[1] * fwd, 'h', 1);
      lineA(hand[0] + dir[0] * fwd, hand[1] + dir[1] * fwd, hand[0] + dir[0] * (fwd + tip), hand[1] + dir[1] * (fwd + tip), 'e', 1);
      // 穂先の根元の口金
      set(Math.round(hand[0] + dir[0] * fwd), Math.round(hand[1] + dir[1] * fwd), 'd');
    };
    const grip = (h) => ellA(h[0] + 0.5, h[1] + 0.5, 2 * SC, 1.8 * SC, 's');
    // 胴（軍の色）・草摺・袖
    const body = () => {
      poly([[17, 17], [31, 17], [32, 38], [16, 38]], 'r');
      poly([[16, 37], [32, 37], [33, 44], [15, 44]], 'r');
      poly([[15, 36], [33, 36], [33, 38], [15, 38]], 'd');
      poly([[18, 15], [30, 15], [31, 18], [17, 18]], 'u');
    };
    const sode = (cx, cy) => { const [X, Yc] = T(cx, cy); const w = 2.5 * SC, u = 2.5 * SC; polyA([[X - w, Yc - u], [X + w, Yc - u], [X + w + 0.5, Yc + u], [X - w - 0.5, Yc + u + 0.5]], 'u'); };
    const bands = [];
    const bandRows = (rows, x0, x1) => { for (const y of rows) for (let x = x0; x < x1; x++) { const [X, Yr] = T(x, y).map(Math.round); if (m[Yr] && m[Yr][X] === 'r') bands.push([X, Yr]); } };

    // 手が体の前にあって、柄を体の後ろに隠すのは、斜め後ろで槍を立てているときだけ
    const occl = !front && !o.raised;
    legs();
    if (front) {
      armIK(farSh, farHand, 'u', 'u', 4);
      if (o.spearBehind) spear();
      body();
      bandRows([24, 31, 41], 16, 33);
      sode(31, 20);
      stampHead(HEAD_FRONT);
      armIK(nearSh, hand, 'u', 'u');
      sode(17, 20);
      if (!o.spearBehind) spear();
      grip(hand);
      if (sp.two != null) grip(farHand);
    } else {
      if (occl) { armIK(farSh, farHand, 'u', 'u', 4); spear(); grip(hand); }
      body();
      bandRows([24, 31, 41], 15, 34);
      if (!occl) armIK(farSh, farHand, 'u', 'u', 4);
      sode(17, 20);
      stampHead(HEAD_BACK);
      armIK(nearSh, sp.two != null ? farHand : [nearSh[0] + 1 * SC, nearSh[1] + 11 * SC], 'u', 'u');
      sode(31, 20);
      if (!occl) { spear(); grip(hand); if (sp.two != null) grip(farHand); }
    }
    // 陰影（kenshin.js と同じ決め方）
    const out = Array.from({ length: FH }, () => Array(FW).fill(''));
    const same = (x, y, v) => x >= 0 && y >= 0 && x < FW && y < FH && m[y][x] === v;
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      const v = m[y][x]; if (!v) continue;
      let x0 = x, x1 = x; while (same(x0 - 1, y, v)) x0--; while (same(x1 + 1, y, v)) x1++;
      const t = x1 > x0 ? (x - x0) / (x1 - x0) : 0.5;
      let tone = t < 0.18 ? 0 : t < 0.42 ? 1 : 2;
      if (x1 - x0 < 3) tone = 2;
      if (!same(x, y - 1, v) || (!same(x + 1, y, v) && t > 0.5)) tone = Math.min(3, tone + 1);
      if (!same(x, y + 1, v)) tone = Math.max(0, tone - 1);
      if (v === 's') tone = Math.max(1, tone);
      if (v === 'e' || v === 'h') tone = 2;
      out[y][x] = RAMP[v][tone];
    }
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      const v = m[y][x]; if (!v || 'kseh'.includes(v)) continue;
      const r = x + 1 < FW ? m[y][x + 1] : '', d = y + 1 < FH ? m[y + 1][x] : '';
      if ((r && r !== v && r !== 'h') || (d && d !== v && d !== 'h')) out[y][x] = RAMP[v][0];
    }
    for (const [x, y] of bands) out[y][x] = RAMP.r[0];
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) if (sg[y][x]) out[y][x] = sg[y][x];
    const add = [];
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      if (m[y][x]) continue;
      const ns = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([i, j]) => i >= 0 && j >= 0 && i < FW && j < FH && m[j][i]);
      if (!ns.length) continue;
      const [i, j] = ns[0], v = m[j][i];
      add.push([x, y, (y > 0 && m[y - 1][x]) || 'djuhe'.includes(v) ? LINE : RAMP[v][0]]);
    }
    for (const [x, y, c] of add) out[y][x] = c;
    if (o.flash) for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      const c = out[y][x]; if (!c) continue;
      const n = parseInt(c.slice(1), 16), k = o.flash;
      const mix = (v) => Math.round(v + (255 - v) * k);
      out[y][x] = '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix).map((v) => v.toString(16).padStart(2, '0')).join('');
    }
    if (o.spark) {
      const [sx, sy] = T(...o.spark).map(Math.round);
      const P = [[0, 0, '#ffffff'], [1, 0, '#ffffff'], [-1, 0, '#ffffff'], [0, 1, '#ffffff'], [0, -1, '#ffffff']];
      for (let r = 2; r <= 3; r++) P.push([r, 0, r < 3 ? '#ffe27a' : '#f08a2a'], [-r, 0, r < 3 ? '#ffe27a' : '#f08a2a'], [0, r, r < 3 ? '#ffe27a' : '#f08a2a'], [0, -r, r < 3 ? '#ffe27a' : '#f08a2a']);
      for (const [dx, dy, c] of P) { const x = sx + dx, y = sy + dy; if (x >= 0 && y >= 0 && x < FW && y < FH) out[y][x] = c; }
    }
    // 突きの筋：穂先の後ろに、突いた向きの白い線
    if (o.streak) {
      const fwd = (sp.fwd ?? 26) * SC + 5 * SC;
      const tx = hand[0] + dir[0] * fwd, ty = hand[1] + dir[1] * fwd;
      for (let i = 2; i < o.streak; i++) for (const s of [-2, 2]) {
        const x = Math.round(tx - dir[0] * i - dir[1] * s), y = Math.round(ty - dir[1] * i + dir[0] * s);
        if (x >= 0 && y >= 0 && x < FW && y < FH && !out[y][x]) out[y][x] = i < o.streak / 2 ? '#ffffff' : '#cfe0ff';
      }
    }
    out.top = top;
    return out;
  }
  function rotate(g, deg, px, py, dx = 0, dy = 0) {
    const a = rad(deg), c = Math.cos(a), sn = Math.sin(a);
    const out = Array.from({ length: FH }, () => Array(FW).fill(''));
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      const X = x - px - dx, Yr = y - py - dy;
      const sx = Math.round(px + X * c + Yr * sn), sy = Math.round(py - X * sn + Yr * c);
      if (sx >= 0 && sy >= 0 && sx < FW && sy < FH && g[sy][sx]) out[y][x] = g[sy][sx];
    }
    return out;
  }
  const crop = (g) => {
    const c = g.slice(CY, CY + H).map((r) => r.slice(CX, CX + W));
    if (g.top) c.top = [g.top[0] - CX, g.top[1] - CY];
    return c;
  };
  // 槍を立てて持つ：画面の左に、手前の手（斜め後ろでは奥の手）で握り、石突を地に近づける
  const up = (f, dy = 0, da = 0) => (f ? { hx: 16, hy: 27 + dy, ang: -97 + da, fwd: 30, bk: 18 } : { hx: 16, hy: 27 + dy, ang: -95 + da, fwd: 30, bk: 18 });
  // 槍を前へ向けて両手で持つ：ang は前の向き（斜め前は右下、斜め後ろは右上）
  const AF = 27, AB = -27;
  const level = (f, hx, hy, da = 0, fwd = 24, bk = 12) => ({ hx, hy, ang: (f ? AF : AB) + da, fwd, bk, two: 7 });
  const stance = (v) => {
    const f = v === 'front';
    const base = { lean: 1, step: 2, back: 2 };
    return [
      draw(v, { ...base, bob: 1, spear: up(f, 0, 0) }),
      draw(v, { ...base, bob: 1, spear: up(f, 0, -1) }),
      draw(v, { ...base, bob: 2, spear: up(f, 1, -1) }),
      draw(v, { ...base, bob: 2, spear: up(f, 1, 0) }),
    ];
  };
  const walk = (v) => {
    const f = v === 'front';
    const base = { lean: 2 };
    return [
      draw(v, { ...base, step: 7, back: 6, bob: 1, spear: up(f, 1, -3) }),
      draw(v, { ...base, step: 0, back: -1, farLift: 3, bob: 0, spear: up(f, 0, -4) }),
      draw(v, { ...base, step: -5, back: -7, bob: 1, spear: up(f, 1, -3) }),
      draw(v, { ...base, step: 1, back: 0, nearLift: 3, bob: 0, spear: up(f, 0, -2) }),
    ];
  };
  const hurt = (v) => {
    const f = v === 'front';
    return [
      draw(v, { lean: -5, bob: 1, step: 1, back: 3, flash: 0.55, spark: f ? [29, 24] : [30, 22], spear: up(f, 0, -10) }),
      draw(v, { lean: -2, bob: 2, step: 2, back: 4, spear: up(f, 1, -6) }),
    ];
  };
  const fall = (v) => {
    const f = v === 'front';
    const kneel = draw(v, { lean: 3, bob: 7, step: 3, back: 2, spear: up(f, 8, f ? -28 : -24) });
    const px = 40, py = 64;
    return [kneel, rotate(kneel, -38, px, py, 6, 0), rotate(kneel, -84, px, py, 14, 2)];
  };
  // 攻撃：構える（槍を前へ下ろす）→ 引く → 突く → 伸ばす → 戻す
  const attack = (v) => {
    const f = v === 'front';
    const r = !f; // 斜め後ろで槍を前へ向けたら、体の前に出す
    const by = f ? 0 : -6;
    return [
      { name: '構える', g: draw(v, { lean: 0, bob: 2, step: 4, back: 4, raised: r, spear: level(f, 22, 32 + by) }) },
      { name: '引く', g: draw(v, { lean: -3, bob: 3, step: 4, back: 5, raised: r, spear: level(f, 18, 32 + by, -3) }) },
      { name: '突く', g: draw(v, { lean: 6, bob: 3, step: 9, back: 5, raised: r, streak: 10, spear: level(f, 30, 30 + by, 0, 26) }) },
      { name: '伸ばす', g: draw(v, { lean: 7, bob: 4, step: 9, back: 7, raised: r, spear: level(f, 32, 30 + by, 1, 26) }) },
      { name: '戻す', g: draw(v, { lean: 3, bob: 2, step: 7, back: 5, raised: r, spear: level(f, 26, 31 + by, 0) }) },
    ];
  };
  const C = (gs) => gs.map(crop);
  const view = (v) => ({
    歩き: C(walk(v)),
    被弾: C(hurt(v)),
    倒れ: C(fall(v)),
    待機: C(stance(v)),
    攻撃: attack(v).map((a) => ({ ...a, g: crop(a.g) })),
  });
  return { W, H, 斜め前: view('front'), 斜め後ろ: view('back') };
})();
