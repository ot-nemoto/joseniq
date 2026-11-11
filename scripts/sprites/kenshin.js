// 上杉謙信（刀）3頭身・背丈38ドット。斜め前（front）と斜め後ろ（back）。枠 80×72、体は 48×56 の位置（OX, OY ずらし）に縮めて置き、頭は38ドット用に手で置いた絵（HEAD_FRONT・HEAD_BACK）。common.js と一緒に読む
RAMP.e = ['#5c6470', '#9aa4b2', '#dfe6ee', '#ffffff'];
RAMP.C = ['#8e8798', '#bdb8c8', '#f4f2ec', '#ffffff']; // 頭巾の布（陣羽織と境目を出すため、別の素材にする）

// 背丈38ドット用に1ドットずつ置いた頭（頭巾・顔・前立て）。D 頭巾の縁 W 頭巾 w 頭巾の影 H 頭巾の光 S 肌 s 肌の影 b 眉 E 目 B ひげ G 金 g 金の影 Y 金の光
// 陣羽織の白は、頭巾の青みがかった白と分けるため、少し生成りに寄せる
RAMP.c = ['#857a6c', '#cdc4b0', '#ede6d4', '#f9f5ea'];
// 顔の点が何か分かるよう、形と色で分ける：目は白目（e）と黒目（E）の2ドット、眉は暗い横線、ひげは明るめの茶、口（m）は赤み
const HEAD_PAL = { e: '#f8f4ee', m: '#a04a3c', b: '#2a1d16', D: '#8e8798', W: '#f4f2ec', w: '#bdb8c8', H: '#ffffff', S: '#ecc4a0', s: '#c98f6e', E: '#1c120c', B: '#6a5040', G: '#e0b84e', g: '#a8782c', Y: '#fff0a0' };
const HEAD_FRONT = {
  ax: 7.5, ay: 8.5,
  rows: [
    '........Y.......',
    '.......gG.......',
    '......gGGY......',
    '....WWWgGWWW....',
    '..WWWWWWWWWWHH..',
    '.wWWWWWWWWWWWHW.',
    '.wWWWWWSSSSSSWW.',
    '.wWWWWbbbSSSbbW.',
    '.wWWWWSeESSSeEs.',
    '.wwWWWSSSSSSSSs.',
    '.wwWWWSBBmSBBS..',
    '.wwwWWWSBBBSWW..',
    '..DwwWWWWWWWW...',
    '...DDwwwwwwD....',
  ],
};
const HEAD_BACK = {
  ax: 7.5, ay: 8.5,
  rows: [
    '..........Y.....',
    '.........gG.....',
    '........gGGY....',
    '.....WWWWgWW....',
    '...WWWWWWWWWHH..',
    '..wWWWWWWWWWWHW.',
    '.wwWWWWWWWWWWWS.',
    '.wwWWWWWWWWWWWSs',
    '.wwWWWWWWWWWWWS.',
    '.wwwWWWWWWWWWWB.',
    '.wwwWWWWWWWWWW..',
    '..DwwWWWWWWWWW..',
    '...DDwwwwwwwD...',
    '.....DDDDDD.....',
  ],
};
const KQ3D = (() => {
  const W = 80, H = 72, OX = 16, OY = 10, SC = 36 / 44, BLADE = 20, HILT = 6;
  // 3頭身：頭（あごまで14ドット）はそのままにし、首から下を縦に縮める。足元の位置は4頭身と同じ
  const HEAD = 14, KY = 0.68, DROP = 13;
  const Y = (y) => (y <= HEAD ? y : HEAD + (y - HEAD) * KY) + DROP;
  // 全体の縮め：足元（AX, AY）を軸に、絵の上の位置を縮める。線の太さや長さも同じ割合で縮める
  const AX = 39, AY = 65;
  const SP = (x, y) => [AX + (x - AX) * SC, AY + (y - AY) * SC];
  const TW = (t) => Math.max(1, Math.round(t * SC));
  function draw(view, o = {}) {
    const front = view === 'front';
    const F = front ? [1, 0.5] : [1, -0.5]; // 画面の上での「前」
    const lean = o.lean || 0, bob = o.bob || 0, sway = o.sway || 0;
    const T = (x, y) => { const s = Math.max(0, (42 - y) / 26); return SP(x + lean * s * F[0] + OX, Y(y) + lean * s * F[1] + bob + OY); };
    const { m, sg, wm, set, polyA, ellA, lineA, weapon } = mkCanvas(W, H);
    const stampHead = (hd) => {
      const [cx, cy] = T(24, 8.5);
      const x0 = Math.round(cx - hd.ax), y0 = Math.round(cy - hd.ay);
      hd.rows.forEach((row, j) => [...row].forEach((ch, i) => {
        if (ch === '.') return;
        const x = x0 + i, y = y0 + j;
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        m[y][x] = ch === 'S' || ch === 's' ? 's' : ch === 'G' || ch === 'g' || ch === 'Y' ? 'g' : 'C';
        sg[y][x] = HEAD_PAL[ch];
      }));
    };
    const poly = (pts, v) => polyA(pts.map(([x, y]) => T(x, y)), v);
    const ell = (cx, cy, rx, ry, v) => { const [X, Y] = T(cx, cy); ellA(X, Y, rx * SC, ry * SC, v); };
    const rect = (x, y, w, h, v) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const [X, Y] = T(x + i, y + j); set(Math.round(X), Math.round(Y), v); } };
    const line = (x0, y0, x1, y1, v, t) => { const a = T(x0, y0), b = T(x1, y1); lineA(a[0], a[1], b[0], b[1], v, TW(t || 1)); };
    // 脚：腰から膝、足へ。膝は前へ曲げる
    const leg = (hip, foot, v, wid, shoe) => {
      wid = TW(wid); shoe = shoe * SC;
      const h = SP(hip[0] + OX, Y(hip[1]) + bob + OY), f = SP(foot[0] + OX, Y(foot[1]) + OY);
      const k = joint(h[0], h[1], f[0], f[1], 7.5 * KY * SC, 7.5 * KY * SC, (a, b) => (a[0] * F[0] + a[1] * F[1] > b[0] * F[0] + b[1] * F[1] ? a : b));
      lineA(h[0], h[1], k[0], k[1], 'f', wid);
      lineA(k[0], k[1], f[0], f[1] - 1, v, wid);
      for (const t of [0.5]) { const x = k[0] + (f[0] - k[0]) * t, y = k[1] + (f[1] - 1 - k[1]) * t; lineA(x - wid / 2 + 0.5, y, x + wid / 2 - 0.5, y, 'r'); }
      lineA(f[0] - shoe / 2, f[1], f[0] + shoe / 2, f[1] + (front ? 0.5 : -0.5), 'd', 2);
    };
    const step = o.step || 0, back = o.back || 0;
    const nearHip = front ? [20.5, 40] : [26.5, 40], farHip = front ? [26, 40] : [20.5, 40];
    const nearFoot = front ? [20, 54] : [27, 54], farFoot = front ? [26, 53] : [20.5, 53];
    const legs = () => {
      // 足を上げる（lift）ときは、画面の上へずらす
      leg(farHip, [farFoot[0] - F[0] * back, farFoot[1] - F[1] * back - (o.farLift || 0)], 'f', 4, 6);
      leg(nearHip, [nearFoot[0] + F[0] * step, nearFoot[1] + F[1] * step - (o.nearLift || 0)], 'n', 5, 7);
    };
    // 刀と腕
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
    const blade = () => weapon(bladeBody);
    const bladeBody = () => {
      const HL = HILT * SC, BL = BLADE * SC, t2 = TW(2);
      lineA(hand[0] - dir[0] * HL, hand[1] - dir[1] * HL, hand[0], hand[1], 'd', t2);
      lineA(hand[0] + dir[0] * 2 * SC, hand[1] + dir[1] * 2 * SC, hand[0] + dir[0] * (2 * SC + BL), hand[1] + dir[1] * (2 * SC + BL), 'e', t2);
      const t = [hand[0] + dir[0] * 1.5 * SC, hand[1] + dir[1] * 1.5 * SC], q = 1.5 * SC;
      lineA(t[0] - dir[1] * q, t[1] + dir[0] * q, t[0] + dir[1] * q, t[1] - dir[0] * q, 'g', t2);
    };
    const sode = (cx, cy, wide) => { const [X, Y] = T(cx, cy); const w = wide * SC, u = 3 * SC; polyA([[X - w, Y - u], [X + w, Y - u], [X + w + 0.5, Y + u], [X - w - 0.5, Y + u + 0.5]], 'n'); };
    const lace = [];
    const laceRows = (rows, x0, x1, t = null) => { for (const y of rows) for (let x = x0; x < x1; x++) { const [X, Y] = T(x, y).map(Math.round); if (m[Y] && m[Y][X] === 'n') lace.push([X, Y, t ?? (x % 2 ? 2 : 1)]); } };

    if (front) {
      legs();
      poly([[14, 14], [18, 14], [17 - sway, 30], [12 - sway, 29]], 'C');
      if (sw) armIK(farSh, farHand, 'f', 'f', 4);
      poly([[15, 17], [33, 17], [34, 42], [13, 42]], 'c');
      poly([[23, 18], [29, 18], [29, 33], [23, 33]], 'n');
      poly([[23, 33], [29, 33], [30, 41], [22, 41]], 'n');
      poly([[21, 17], [23, 17], [22, 42], [20, 42]], 'g');
      poly([[29, 17], [30, 17], [31, 42], [30, 42]], 'g');
      poly([[13, 41], [34, 41], [34, 44], [13, 44]], 'g');
      if (!sw) {
        poly([[30, 18], [35, 19], [36, 23], [32, 24]], 'n');
        poly([[33, 23], [36, 23], [36, 29], [33, 29]], 'f');
        poly([[33, 29], [36, 29], [36, 34], [33, 34]], 'n');
        ell(34.5, 35.6, 1.9, 1.7, 's');
        line(29, 31, 36, 35, 'd', 2); rect(28, 30, 2, 3, 'g');
      } else sode(33, 21, 2.5);
      if (sw && o.bladeBehind) blade();
      poly([[16, 12], [32, 12], [33, 16], [29, 19], [19, 19], [15, 16]], 'C');
      stampHead(HEAD_FRONT);
      if (!sw) {
        poly([[12, 23], [16, 23], [16, 29], [12, 29]], 'f');
        poly([[12, 29], [16, 29], [16, 35], [12, 35]], 'n');
        ell(14, 36.6, 2.3, 2, 's');
        rect(12, 30, 5, 1, 'r'); rect(12, 34, 5, 1, 'r');
        poly([[11, 17], [19, 17], [19, 23], [11, 24]], 'n');
      } else { armIK(nearSh, hand, 'f', 'n'); sode(15, 20, 4); }
      if (sw && !o.bladeBehind) blade();
      // 縅は2段、袖は1段にする（細かすぎる段を減らす）
      laceRows([24, 33], 23, 30, 2);
      laceRows([20], 10, 20, 2);
    } else {
      legs();
      // 手が体の前にある間（左肩の前で構えるときも）は、両腕と刀の根元が背中に隠れる
      const occl = sw && !o.raised;
      if (sw) armIK(farSh, farHand, 'f', 'f', 4);
      if (occl) { armIK(nearSh, hand, 'f', 'n'); blade(); }
      // 陣羽織の背と、裾の金と角の飾り
      poly([[14, 17], [34, 17], [35, 42], [12, 42]], 'c');
      poly([[12, 41], [35, 41], [35, 44], [12, 44]], 'g');
      // 鞘（左の腰から手前へ）
      line(17, 33, 6, 43, 'd', 2); rect(4, 43, 3, 2, 'g');
      if (!sw) {
        poly([[10, 17], [16, 17], [16, 23], [10, 24]], 'n');
        poly([[11, 23], [14, 23], [14, 29], [11, 29]], 'f');
        poly([[11, 29], [14, 29], [14, 34], [11, 34]], 'n');
        ell(12.5, 35.5, 1.9, 1.7, 's');
        poly([[33, 23], [37, 23], [37, 29], [33, 29]], 'f');
        poly([[33, 29], [37, 29], [37, 35], [33, 35]], 'n');
        ell(35, 36.6, 2.3, 2, 's');
        rect(33, 30, 5, 1, 'r'); rect(33, 34, 5, 1, 'r');
        poly([[31, 17], [38, 17], [38, 23], [32, 24]], 'n');
      } else { sode(13, 20, 2.5); sode(34, 20, 4); }
      // 頭巾（後ろ）・頬の端・前立て・結び目と垂れ
      poly([[16, 12], [32, 12], [33, 16], [30, 18], [18, 18], [15, 16]], 'C');
      stampHead(HEAD_BACK);
      poly([[17, 13], [20, 13], [19 - sway, 30], [16 - sway, 29]], 'C');
      poly([[21, 13], [24, 13], [23 - sway, 27], [21 - sway, 26]], 'C');
      ell(20.5, 12.5, 3, 2.2, 'C');
      if (sw && !occl) { armIK(nearSh, hand, 'f', 'n'); blade(); }
      laceRows([20], 9, 40, 2);
    }
    // 陰影
    const out = shade(m, RAMP, { skip: 'kse', pass: 'r', light: 'c', adjust: (v, tone, x, y, same) => (v === 'e' ? (!same(x, y - 1, v) ? 3 : 2) : tone) });
    for (const [x, y, t] of lace) out[y][x] = RAMP.r[t];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (sg[y][x]) out[y][x] = sg[y][x];
    outline(out, m, RAMP, 'dnfe');
    // 斬られた所に火花を散らす
    if (o.spark) spark(out, T(...o.spark).map(Math.round), 4, true);
    // スキルの溜め：武器のまわりを光らせる
    if (o.aura) weaponAura(out, wm, o.aura, ['#ffd2c8', '#ff9a7a']);
    // 斬撃の軌跡：手前の肩を中心に、刀の通った弧
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
    // 横に払う軌跡（回転斬り）：胸の下の高さで、体のまわりの平たい楕円の弧。色は通常攻撃の弧より赤みを帯びさせる。sweep は [始めの角度, 終わりの角度, 太さ, 逆向き]。
    // 角度は楕円の上の角度（0 は右、90 は手前、180 は左、270 は奥）で、逆向きなら始めの角度の側を太くする（刀の今いる側）。
    // 派手に見せるため、太い帯の外側に細い光の線を重ね、帯に沿って光の粒を散らす。
    // ghost は、それまでに通った残りの弧を細い点線で残す（1 なら弧の外を一周、刀の通った名残）
    if ((o.sweep || o.ghost) && sw) {
      const [a0, a1, wid0, rev] = o.sweep ?? [0, 0, 0, false], wid = wid0 * SC, FLAT = 0.38;
      const [cx, cy] = T(24, 27);
      const tip = [hand[0] + dir[0] * (2 + BLADE) * SC, hand[1] + dir[1] * (2 + BLADE) * SC];
      const rx = o.ghostR ?? Math.hypot(tip[0] - cx, (tip[1] - cy) / FLAT);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (out[y][x]) continue;
        const u = x + 0.5 - cx, v = (y + 0.5 - cy) / FLAT;
        let a = (Math.atan2(v, u) * 180) / Math.PI;
        while (a < a0) a += 360;
        const d = rx - Math.hypot(u, v);
        const inSweep = o.sweep && a <= a1;
        if (inSweep) {
          let k = (a - a0) / (a1 - a0);
          if (rev) k = 1 - k;
          if (d >= 0 && d < wid * k + 0.6) out[y][x] = d < 1.2 ? '#ffffff' : k > 0.55 ? '#ff9a7a' : '#ffd2c8';
          // 外側の細い光の線（帯の太い側だけ）
          else if (k > 0.35 && d < -1 && d > -2.2) out[y][x] = '#ffb8a0';
          // 帯の内側に散る光の粒
          else if (k > 0.3 && d > wid * k + 1.2 && d < wid * k + 3 && (x * 7 + y * 13) % 11 === 0) out[y][x] = '#ffffff';
        } else if (o.ghost && d >= 0 && d < 1.2 && (x + y) % 2 === 0) out[y][x] = '#ffc4b4';
      }
    }
    return out;
  }
  // 被弾：白く光って火花が散り、後ろへのけぞる → 構えを戻しかける
  const hurt = (v) => {
    const f = v === 'front';
    return [
      draw(v, { lean: -5, bob: 1, step: 1, back: 3, sway: 3, spark: f ? [30, 24] : [36, 19],
        sword: f ? { hx: 20, hy: 23, ang: -128 } : { hx: 19, hy: 23, ang: -126 } }),
      draw(v, { lean: -2, bob: 2, step: 2, back: 4, sway: 2,
        sword: f ? { hx: 19, hy: 25, ang: -112 } : { hx: 19, hy: 25, ang: -110 } }),
    ];
  };
  // 倒れ：膝から崩れ、刀の先が地に落ちる → 後ろへ傾く → 倒れ伏す
  const fall = (v) => {
    const f = v === 'front';
    const kneel = draw(v, { lean: 3, bob: 7, step: 3, back: 2, sway: 2,
      sword: f ? { hx: 24, hy: 41, ang: 112 } : { hx: 20, hy: 41, ang: 110 } });
    const px = 40, py = 64; // 足元
    return [kneel, rotate(kneel, -38, px, py, 6, 0), rotate(kneel, -84, px, py, 14, 2)];
  };
  // 構えた待機：刀を抜いて中段に構え、足を前後に開いて膝を曲げ、腰を落とす。息に合わせて腰と切っ先がわずかに上下する
  const stance = (v) => {
    const f = v === 'front';
    const base = { lean: 1, step: 4, back: 4 };
    // どちらも刀を画面の左に立てる。斜め前は右肩の前（八相）、斜め後ろは左肩の横
    const sw = (dy, da) => (f ? { hx: 18, hy: 23 + dy, ang: -106 + da } : { hx: 19, hy: 23 + dy, ang: -104 + da });
    return [
      draw(v, { ...base, bob: 2, sword: sw(0, 0), sway: 1 }),
      draw(v, { ...base, bob: 2, sword: sw(0, -2), sway: 2 }),
      draw(v, { ...base, bob: 3, sword: sw(1, -1), sway: 2 }),
      draw(v, { ...base, bob: 3, sword: sw(1, 1), sway: 1 }),
    ];
  };
  // 歩き：刀を左に立てたまま、前の向きへ脚を交互に出す。脚が揃うコマで後ろ足を上げ、体を持ち上げる
  const walk = (v) => {
    const f = v === 'front';
    const sw = (dy) => (f ? { hx: 18, hy: 24 + dy, ang: -102 } : { hx: 19, hy: 24 + dy, ang: -100 });
    const base = { lean: 2 };
    return [
      draw(v, { ...base, step: 7, back: 6, bob: 1, sword: sw(1), sway: 1 }),
      draw(v, { ...base, step: 0, back: -1, farLift: 3, bob: 0, sword: sw(0), sway: 2 }),
      draw(v, { ...base, step: -5, back: -7, bob: 1, sword: sw(1), sway: 1 }),
      draw(v, { ...base, step: 1, back: 0, nearLift: 3, bob: 0, sword: sw(0), sway: 0 }),
    ];
  };
  // スキル（回転斬り）：刀を胸の下の高さで後ろへ水平に引いて構える → 体をひねって溜める → 手前を通って横に払う →
  // 奥を回って斬り抜く → 刀を横に払い切った残心。払う・斬り抜くでは、体のまわりに平たい弧を出し、2コマでひと回りする。
  // 通常攻撃（頭の上から振り下ろす）と見分けるため、刀はどのコマも胸の下の高さで水平に持つ
  const skill = (v) => {
    const f = v === 'front';
    const g = (o) => draw(v, o);
    return f
      ? [
          { name: '構える', g: g({ aura: 1, sword: { hx: 15, hy: 27, ang: 185 }, lean: -2, bob: 3, step: 5, back: 5, sway: 2, bladeBehind: true }) },
          { name: '溜める', g: g({ aura: 2, sword: { hx: 12, hy: 26, ang: 180 }, lean: -4, bob: 5, step: 6, back: 6, sway: 3, bladeBehind: true }) },
          { name: '薙ぐ', g: g({ sword: { hx: 34, hy: 27, ang: 2 }, lean: 4, bob: 4, step: 8, back: 6, sway: -1, sweep: [0, 180, 8, true] }) },
          { name: '斬り抜く', g: g({ sword: { hx: 14, hy: 26, ang: 178 }, lean: 2, bob: 4, step: 8, back: 6, sway: -2, bladeBehind: true, sweep: [180, 360, 8, true], ghost: 1 }) },
          { name: '残心', g: g({ sword: { hx: 33, hy: 28, ang: 4 }, lean: 2, bob: 3, step: 7, back: 5, ghost: 1 }) },
        ]
      : [
          { name: '構える', g: g({ aura: 1, sword: { hx: 14, hy: 26, ang: 185 }, lean: -2, bob: 3, step: 5, back: 5, sway: 2, raised: true }) },
          { name: '溜める', g: g({ aura: 2, sword: { hx: 12, hy: 25, ang: 180 }, lean: -4, bob: 5, step: 6, back: 6, sway: 3, raised: true }) },
          { name: '薙ぐ', g: g({ sword: { hx: 36, hy: 25, ang: -2 }, lean: 4, bob: 4, step: 8, back: 6, sway: 2, raised: true, sweep: [0, 180, 8, true] }) },
          { name: '斬り抜く', g: g({ sword: { hx: 14, hy: 25, ang: 180 }, lean: 2, bob: 4, step: 8, back: 6, sway: 3, raised: true, sweep: [180, 360, 8, true], ghost: 1 }) },
          { name: '残心', g: g({ sword: { hx: 34, hy: 25, ang: 2 }, lean: 2, bob: 3, step: 7, back: 5, sway: 1, raised: true, ghost: 1 }) },
        ];
  };
  return {
    W, H,
    斜め前: {
      歩き: walk('front'),
      被弾: hurt('front'),
      倒れ: fall('front'),
      待機: stance('front'),
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
      歩き: walk('back'),
      被弾: hurt('back'),
      倒れ: fall('back'),
      待機: stance('back'),
      スキル: skill('back'),
      攻撃: [
        { name: '溜め', g: draw('back', { sword: { hx: 19, hy: 20, ang: -124 }, lean: -2, bob: 3, step: 4, back: 5, sway: 2 }) },
        { name: '振りかぶり', g: draw('back', { sword: { hx: 26, hy: -3, ang: 160 }, lean: -4, step: 1, back: 3, sway: 3, raised: true }) },
        { name: '踏み込み斬り', g: draw('back', { sword: { hx: 36, hy: 24, ang: 8 }, lean: 6, bob: 3, step: 9, back: 5, sway: 2, raised: true, arc: [-160, 8, 5] }) },
        { name: '振り抜き', g: draw('back', { sword: { hx: 35, hy: 30, ang: 42 }, lean: 7, bob: 4, step: 9, back: 7, sway: 3, raised: true, }) },
        { name: '残心', g: draw('back', { sword: { hx: 34, hy: 26, ang: -8 }, lean: 3, bob: 2, step: 8, back: 5, sway: 1, raised: true }) },
      ],
    },
  };
})();
