// 武将の大きな絵の共通の作り：体の組み立て（mkBusho）と、武器ごとの持ち方とコマ（刀・槍・軍配）。
// common.js のあと、武将の描き方のファイル（kenshin.js など7人分）の前に読み込む（export.mjs がつなげて読む）。兵（ashigaru.js）は使わない
const BUSHO = { W: 80, H: 72, SC: 36 / 44 };

// 体の組み立て：枠 80×72 に、体を (OX, OY) だけずらし、足元 (AX, AY) を軸に SC の割合で縮めて置く。3頭身にするため、頭（あごまで14ドット）は
// そのままにし、首から下を縦に縮める。頭は38ドット用に手で置いた絵（HEAD_FRONT・HEAD_BACK）を押す。
// o は姿勢（lean 傾き・bob 沈み・step と back 前後の足の踏み出し・farLift と nearLift 足を上げる高さ）。cfg は武将ごとの違い：
// leg（腿の素材 thigh・奥のすねの素材 far・すねの飾りの位置と素材 garter・足の素材 shoe）、hand（手の楕円の横と縦の半径と素材）、
// sode（袖の縦の半分と素材）、head（手で置いた頭の色 pal と、絵の文字から素材を決める mat）
function mkBusho(view, o, cfg) {
  const { W, H, SC } = BUSHO, OX = 16, OY = 10;
  const HEAD = 14, KY = 0.68, DROP = 13, AX = 39, AY = 65;
  const Y = (y) => (y <= HEAD ? y : HEAD + (y - HEAD) * KY) + DROP;
  const SP = (x, y) => [AX + (x - AX) * SC, AY + (y - AY) * SC];
  const TW = (t) => Math.max(1, Math.round(t * SC));
  const front = view === 'front';
  const F = front ? [1, 0.5] : [1, -0.5]; // 画面の上での「前」
  const lean = o.lean || 0, bob = o.bob || 0;
  // 体の上の点を画面の点へ。腰（y = 42）より上を、上ほど前へ傾ける
  const T = (x, y) => { const s = Math.max(0, (42 - y) / 26); return SP(x + lean * s * F[0] + OX, Y(y) + lean * s * F[1] + bob + OY); };
  // 傾けない点（武器を握る手）
  const at = (x, y) => SP(x + OX, Y(y) + OY);
  const cv = mkCanvas(W, H);
  const { m, sg, polyA, ellA, lineA } = cv;
  const k = { ...cv, W, H, SC, TW, front, F, T, at, fix: [], top: null };
  k.poly = (pts, v) => polyA(pts.map(([x, y]) => T(x, y)), v);
  k.ell = (cx, cy, rx, ry, v) => { const [X, Yy] = T(cx, cy); ellA(X, Yy, rx * SC, ry * SC, v); };
  k.rect = (x, y, w, h, v) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const [X, Yy] = T(x + i, y + j); cv.set(Math.round(X), Math.round(Yy), v); } };
  k.line = (x0, y0, x1, y1, v, t) => { const a = T(x0, y0), b = T(x1, y1); lineA(a[0], a[1], b[0], b[1], v, TW(t || 1)); };
  // 脚：腰から膝、足へ。膝は前へ曲げる。すねに飾りの線を1本引く
  const leg = (hip, foot, v, wid, shoe) => {
    wid = TW(wid); shoe = shoe * SC;
    const h = SP(hip[0] + OX, Y(hip[1]) + bob + OY), f = SP(foot[0] + OX, Y(foot[1]) + OY);
    const kn = joint(h[0], h[1], f[0], f[1], 7.5 * KY * SC, 7.5 * KY * SC, (a, b) => (a[0] * F[0] + a[1] * F[1] > b[0] * F[0] + b[1] * F[1] ? a : b));
    lineA(h[0], h[1], kn[0], kn[1], cfg.leg.thigh, wid);
    lineA(kn[0], kn[1], f[0], f[1] - 1, v, wid);
    const [gt, gm] = cfg.leg.garter;
    const x = kn[0] + (f[0] - kn[0]) * gt, y = kn[1] + (f[1] - 1 - kn[1]) * gt; lineA(x - wid / 2 + 0.5, y, x + wid / 2 - 0.5, y, gm);
    lineA(f[0] - shoe / 2, f[1], f[0] + shoe / 2, f[1] + (front ? 0.5 : -0.5), cfg.leg.shoe, 2);
  };
  const step = o.step || 0, back = o.back || 0;
  const nearHip = front ? [20.5, 40] : [26.5, 40], farHip = front ? [26, 40] : [20.5, 40];
  const nearFoot = front ? [20, 54] : [27, 54], farFoot = front ? [26, 53] : [20.5, 53];
  k.legs = () => {
    // 足を上げる（lift）ときは、画面の上へずらす
    leg(farHip, [farFoot[0] - F[0] * back, farFoot[1] - F[1] * back - (o.farLift || 0)], cfg.leg.far, 4, 6);
    leg(nearHip, [nearFoot[0] + F[0] * step, nearFoot[1] + F[1] * step - (o.nearLift || 0)], 'n', 5, 7);
  };
  k.nearSh = T(...(front ? [15, 20] : [34, 20]));
  k.farSh = T(...(front ? [33, 20] : [14, 20]));
  // 腕：肩 s から手 h へ。肘は下へ曲げる。up は上腕、fore は前腕の素材
  k.armIK = (s, h, up, fore, w = 5) => {
    const e = joint(s[0], s[1], h[0], h[1], 8 * 0.8 * SC, 8 * 0.8 * SC, (a, b) => (a[1] > b[1] ? a : b));
    lineA(s[0], s[1], e[0], e[1], up, TW(w));
    lineA(e[0], e[1], h[0], h[1], fore, TW(w - 1));
    const [rx, ry, hm] = cfg.hand;
    ellA(h[0] + 0.5, h[1] + 0.5, rx * SC, ry * SC, hm);
  };
  // 袖：(cx, cy) を中心に、横の半分が wide の台形
  k.sode = (cx, cy, wide) => {
    const [X, Yy] = T(cx, cy); const [su, sm] = cfg.sode; const w = wide * SC, u = su * SC;
    polyA([[X - w, Yy - u], [X + w, Yy - u], [X + w + 0.5, Yy + u], [X - w - 0.5, Yy + u + 0.5]], sm);
  };
  // 手で置いた頭を押す。頭の絵が上の端（top）を持てば、幟を立てる位置として覚える
  const headMat = cfg.head.mat ?? ((ch) => (ch === 'S' || ch === 's' ? 's' : 'C'));
  k.stampHead = (hd) => {
    const [cx, cy] = T(24, 8.5);
    const x0 = Math.round(cx - hd.ax), y0 = Math.round(cy - hd.ay);
    if (hd.top != null) k.top = [x0 + hd.ax, y0 + hd.top];
    hd.rows.forEach((row, j) => [...row].forEach((ch, i) => {
      if (ch === '.') return;
      const x = x0 + i, y = y0 + j;
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      m[y][x] = headMat(ch);
      sg[y][x] = cfg.head.pal[ch];
    }));
  };
  // 体の上の横の段（rows の y、x0 から x1 の手前まで）のうち、素材が mat のマス（飾りの線を引く所）
  k.cells = (rows, x0, x1, mat) => {
    const r = [];
    for (const yy of rows) for (let x = x0; x < x1; x++) { const [X, Yy] = T(x, yy).map(Math.round); if (m[Yy] && m[Yy][X] === mat) r.push([X, Yy]); }
    return r;
  };
  // 陰影のあとに重ねる：決まった色の点（fix。絵のある所だけ）と、手で置いた頭の色
  k.putFix = (out) => { for (const [x, y, c] of k.fix) if (y >= 0 && y < H && x >= 0 && x < W && m[y][x]) out[y][x] = c; };
  k.putHead = (out) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (sg[y][x]) out[y][x] = sg[y][x]; };
  return k;
}
// 倒れ：膝から崩れた姿（kneel）を、足元を軸に後ろへ傾けて倒す
const bushoFall = (kneel) => [kneel, rotate(kneel, -38, 40, 64, 6, 0), rotate(kneel, -84, 40, 64, 14, 2)];
// 描き方のファイルが返す形：枠の大きさ、素材の色、向きごとのコマ（poses(v) は 待機・歩き・攻撃・スキル・被弾・倒れ）
const bushoFrames = (R, poses) => ({ W: BUSHO.W, H: BUSHO.H, R, 斜め前: poses('front'), 斜め後ろ: poses('back') });

// 刀（謙信・秀吉）：sw.hx・hy は柄を握る手前の手、ang は刃の向き。奥の手は柄の少し後ろを握る
const BLADE = 20, HILT = 6; // 刃と柄の長さ（縮める前のドット）
function swordKit(k, sw) {
  const { SC, TW, lineA } = k;
  const hand = k.at(sw.hx, sw.hy), dir = [Math.cos(rad(sw.ang)), Math.sin(rad(sw.ang))];
  const farHand = [hand[0] - dir[0] * 4 * SC, hand[1] - dir[1] * 4 * SC];
  const tip = [hand[0] + dir[0] * (2 + BLADE) * SC, hand[1] + dir[1] * (2 + BLADE) * SC]; // 切っ先
  // 柄（黒）・刃・鍔（金）。武器のマスにする
  const blade = () => k.weapon(() => {
    const HL = HILT * SC, BL = BLADE * SC, t2 = TW(2);
    lineA(hand[0] - dir[0] * HL, hand[1] - dir[1] * HL, hand[0], hand[1], 'd', t2);
    lineA(hand[0] + dir[0] * 2 * SC, hand[1] + dir[1] * 2 * SC, hand[0] + dir[0] * (2 * SC + BL), hand[1] + dir[1] * (2 * SC + BL), 'e', t2);
    const t = [hand[0] + dir[0] * 1.5 * SC, hand[1] + dir[1] * 1.5 * SC], q = 1.5 * SC;
    lineA(t[0] - dir[1] * q, t[1] + dir[0] * q, t[0] + dir[1] * q, t[1] - dir[0] * q, 'g', t2);
  });
  // 斬撃の軌跡：手前の肩 c を中心に、刀の通った弧。arc は [始めの角度, 終わりの角度, 太さ]。色は common.js の TRAIL（槍・軍配の残像と同じ）
  const arc = (out, [a0, a1, wid0], [cx, cy]) => {
    const { W, H } = k, wid = wid0 * SC;
    const r = Math.hypot(tip[0] - cx, tip[1] - cy);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (out[y][x]) continue;
      let a = (Math.atan2(y + 0.5 - cy, x + 0.5 - cx) * 180) / Math.PI;
      while (a < a0) a += 360;
      if (a > a1) continue;
      const kk = (a - a0) / (a1 - a0), d = r - Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d >= 0 && d < wid * kk + 0.6) out[y][x] = d < 1 ? TRAIL.core : kk > 0.65 ? TRAIL.lead : TRAIL.body;
    }
  };
  return { hand, dir, farHand, tip, blade, arc };
}
// 刀のコマ（スキルを除く）：待機は刀を画面の左に立てる（斜め前は右肩の前の八相、斜め後ろは左肩の横）。
// 攻撃は溜め → 振りかぶり → 踏み込み斬り → 振り抜き → 残心
function swordPoses(draw, v) {
  const f = v === 'front';
  // 構えた待機：足を前後に開いて膝を曲げ、腰を落とす。息に合わせて腰と切っ先がわずかに上下する
  const stance = () => {
    const base = { lean: 1, step: 4, back: 4 };
    const sw = (dy, da) => (f ? { hx: 18, hy: 23 + dy, ang: -106 + da } : { hx: 19, hy: 23 + dy, ang: -104 + da });
    return [
      draw(v, { ...base, bob: 2, sword: sw(0, 0), sway: 1 }),
      draw(v, { ...base, bob: 2, sword: sw(0, -2), sway: 2 }),
      draw(v, { ...base, bob: 3, sword: sw(1, -1), sway: 2 }),
      draw(v, { ...base, bob: 3, sword: sw(1, 1), sway: 1 }),
    ];
  };
  // 歩き：刀を左に立てたまま、前の向きへ脚を交互に出す。脚が揃うコマで後ろ足を上げ、体を持ち上げる
  const walk = () => {
    const sw = (dy) => (f ? { hx: 18, hy: 24 + dy, ang: -102 } : { hx: 19, hy: 24 + dy, ang: -100 });
    const base = { lean: 2 };
    return [
      draw(v, { ...base, step: 7, back: 6, bob: 1, sword: sw(1), sway: 1 }),
      draw(v, { ...base, step: 0, back: -1, farLift: 3, bob: 0, sword: sw(0), sway: 2 }),
      draw(v, { ...base, step: -5, back: -7, bob: 1, sword: sw(1), sway: 1 }),
      draw(v, { ...base, step: 1, back: 0, nearLift: 3, bob: 0, sword: sw(0), sway: 0 }),
    ];
  };
  // 被弾：火花が散り、後ろへのけぞる → 構えを戻しかける
  const hurt = () => [
    draw(v, { lean: -5, bob: 1, step: 1, back: 3, sway: 3, spark: f ? [30, 24] : [36, 19],
      sword: f ? { hx: 20, hy: 23, ang: -128 } : { hx: 19, hy: 23, ang: -126 } }),
    draw(v, { lean: -2, bob: 2, step: 2, back: 4, sway: 2,
      sword: f ? { hx: 19, hy: 25, ang: -112 } : { hx: 19, hy: 25, ang: -110 } }),
  ];
  // 倒れ：膝から崩れ、刀の先が地に落ちる → 後ろへ傾く → 倒れ伏す
  const fall = () => bushoFall(draw(v, { lean: 3, bob: 7, step: 3, back: 2, sway: 2,
    sword: f ? { hx: 24, hy: 41, ang: 112 } : { hx: 20, hy: 41, ang: 110 } }));
  const attack = () => (f
    ? [
        { name: '溜め', g: draw(v, { sword: { hx: 18, hy: 20, ang: -125 }, lean: -2, bob: 3, step: 4, back: 5, sway: 2 }) },
        { name: '振りかぶり', g: draw(v, { sword: { hx: 20, hy: -2, ang: 198 }, lean: -4, step: 1, back: 3, sway: 3, bladeBehind: true }) },
        { name: '踏み込み斬り', g: draw(v, { sword: { hx: 34, hy: 31, ang: 38 }, lean: 6, bob: 3, step: 9, back: 5, sway: -1, arc: [-150, 38, 5] }) },
        { name: '振り抜き', g: draw(v, { sword: { hx: 32, hy: 38, ang: 62 }, lean: 7, bob: 4, step: 9, back: 7, sway: -2, arc: [-30, 62, 3] }) },
        { name: '残心', g: draw(v, { sword: { hx: 31, hy: 32, ang: 22 }, lean: 3, bob: 2, step: 8, back: 5 }) },
      ]
    : [
        { name: '溜め', g: draw(v, { sword: { hx: 19, hy: 20, ang: -124 }, lean: -2, bob: 3, step: 4, back: 5, sway: 2 }) },
        { name: '振りかぶり', g: draw(v, { sword: { hx: 26, hy: -3, ang: 160 }, lean: -4, step: 1, back: 3, sway: 3, raised: true }) },
        { name: '踏み込み斬り', g: draw(v, { sword: { hx: 36, hy: 24, ang: 8 }, lean: 6, bob: 3, step: 9, back: 5, sway: 2, raised: true, arc: [-160, 8, 5] }) },
        { name: '振り抜き', g: draw(v, { sword: { hx: 35, hy: 30, ang: 42 }, lean: 7, bob: 4, step: 9, back: 7, sway: 3, raised: true }) },
        { name: '残心', g: draw(v, { sword: { hx: 34, hy: 26, ang: -8 }, lean: 3, bob: 2, step: 8, back: 5, sway: 1, raised: true }) },
      ]);
  return { 待機: stance(), 歩き: walk(), 攻撃: attack(), 被弾: hurt(), 倒れ: fall() };
}

// 槍（信長・光義）：sp.hx・hy は握る手、ang は穂先の向き、grip は握る手が手前（near）か奥（far）か。
// two なら、もう一方の手も柄の後ろ（握る手から石突きの側へ）を握る。そうでなければ rest の所に下ろす
const SPEAR_FWD = 20, SPEAR_BACK = 13, SPEAR_TIP = 5; // 握る手から穂先の側（柄の先まで）と石突きの側の長さ、穂先の長さ（縮める前のドット）
function spearKit(k, sp) {
  const { SC, TW, lineA, armIK, nearSh, farSh } = k;
  const hand = k.at(sp.hx, sp.hy), dir = [Math.cos(rad(sp.ang)), Math.sin(rad(sp.ang))];
  let other = null;
  if (sp.two) other = [hand[0] - dir[0] * 7 * SC, hand[1] - dir[1] * 7 * SC];
  else if (sp.rest) other = k.T(...sp.rest);
  const far = sp.grip === 'far';
  let tip = null; // 穂先の先の端（突いた残像を引く所）
  // 柄は y の素材（信長は木、光義は弓と同じ竹）、穂先は白い帯の色（w。色の数を増やさないため。書き出しの色は英字の数まで）
  const spear = () => {
    const b = [hand[0] - dir[0] * SPEAR_BACK * SC, hand[1] - dir[1] * SPEAR_BACK * SC];
    const t = [hand[0] + dir[0] * SPEAR_FWD * SC, hand[1] + dir[1] * SPEAR_FWD * SC];
    const e = [t[0] + dir[0] * SPEAR_TIP * SC, t[1] + dir[1] * SPEAR_TIP * SC];
    lineA(b[0], b[1], t[0], t[1], 'y', TW(2));
    lineA(t[0], t[1], e[0], e[1], 'w', TW(2));
    k.fix.push([Math.round(e[0]), Math.round(e[1]), '#ffffff']);
    tip = e;
  };
  // 体より先に描く奥の側：斜め前は奥の腕（握る手か、もう一方の手）。斜め後ろで奥の手で握るときは、槍と奥の腕を体の陰に描く
  const farSide = () => {
    if (k.front) { const h = far ? hand : other; if (h) armIK(farSh, h, 'f', 'n', 4); }
    else if (far) { armIK(farSh, hand, 'f', 'n', 4); spear(); }
    else if (other) armIK(farSh, other, 'f', 'n', 4);
  };
  // 頭のあとに描く手前の側：槍と手前の腕
  const nearSide = () => {
    if (k.front) { spear(); const h = far ? other : hand; if (h) armIK(nearSh, h, 'f', 'n'); }
    else if (!far) { spear(); armIK(nearSh, hand, 'f', 'n'); }
    else if (other && sp.two) armIK(nearSh, other, 'f', 'n');
  };
  // 突いた槍の残像：穂先から、突いた向きと逆へ伸びる細い筋（common.js の thrustTrail）
  const trail = (out, len) => { if (len && tip) thrustTrail(out, tip, dir, len); };
  return { hand, dir, spear, farSide, nearSide, trail };
}
// 槍のコマ（スキルを除く）：待機は槍を画面の左に立てて持つ（斜め前は手前の手、斜め後ろは奥の手）。もう一方の手は腰に下ろす。
// 攻撃は両手で中段に構える → 引く → 突く → 伸ばす → 戻す。穂先は盤面の「前」（斜め前は右下、斜め後ろは右上）へ向ける。
// 前の手は、斜め前は奥の手、斜め後ろは手前の手
function spearPoses(draw, v) {
  const f = v === 'front';
  const holdSpear = (dy = 0, da = 0) => (f
    ? { hx: 12, hy: 31 + dy, ang: -95 + da, grip: 'near', rest: [33, 34] }
    : { hx: 11, hy: 31 + dy, ang: -93 + da, grip: 'far', rest: [34, 34] });
  const stance = () => {
    const base = { lean: 1, step: 4, back: 4 };
    return [
      draw(v, { ...base, bob: 2, spear: holdSpear(), sway: 0 }),
      draw(v, { ...base, bob: 2, spear: holdSpear(0, -1), sway: 1 }),
      draw(v, { ...base, bob: 3, spear: holdSpear(1, -1), sway: 1 }),
      draw(v, { ...base, bob: 3, spear: holdSpear(1, 1), sway: 0 }),
    ];
  };
  const walk = () => {
    const base = { lean: 2 };
    return [
      draw(v, { ...base, step: 7, back: 6, bob: 1, spear: holdSpear(1, 3), sway: 1 }),
      draw(v, { ...base, step: 0, back: -1, farLift: 3, bob: 0, spear: holdSpear(0, 0), sway: 2 }),
      draw(v, { ...base, step: -5, back: -7, bob: 1, spear: holdSpear(1, -3), sway: 1 }),
      draw(v, { ...base, step: 1, back: 0, nearLift: 3, bob: 0, spear: holdSpear(0, 0), sway: 0 }),
    ];
  };
  const attack = () => {
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
  const hurt = () => [
    draw(v, { lean: -5, bob: 1, step: 1, back: 3, sway: 2, spark: f ? [27, 24] : [33, 19], spear: holdSpear(-1, -16) }),
    draw(v, { lean: -2, bob: 2, step: 2, back: 4, sway: 1, spear: holdSpear(0, -8) }),
  ];
  const fall = () => bushoFall(draw(v, { lean: 3, bob: 7, step: 3, back: 2, sway: 1, spear: { ...holdSpear(7, 0), ang: f ? -150 : -30 } }));
  return { 待機: stance(), 歩き: walk(), 攻撃: attack(), 被弾: hurt(), 倒れ: fall() };
}

// 軍配（家康・昌幸・信玄）：fn.hx・hy は柄を握る手、ang は柄から板への向き、hand は握る手が手前（near）か奥（far）か。
// もう一方の手は rest の所（腰）に下ろす。腕は、上腕を袖（o）、前腕を籠手（n）で描く
const FAN_HANDLE = 4, FAN_RU = 6, FAN_RV = 4.6; // 握る手から板の付け根までの柄の長さ、板の縦と横の半径（縮める前のドット）
function fanKit(k, fn) {
  const { SC, TW, lineA, set, armIK, nearSh, farSh } = k;
  const hand = k.at(fn.hx, fn.hy), dir = [Math.cos(rad(fn.ang)), Math.sin(rad(fn.ang))];
  // 柄（木）と、柄の先の黒い板。板は金の縁と、真ん中の日の丸（軍の色）。武器のマスにする
  const fan = () => k.weapon(() => {
    const base = [hand[0] + dir[0] * FAN_HANDLE * SC, hand[1] + dir[1] * FAN_HANDLE * SC];
    lineA(hand[0] - dir[0] * 1.5 * SC, hand[1] - dir[1] * 1.5 * SC, base[0], base[1], 't', TW(1.5));
    const c = [base[0] + dir[0] * FAN_RU * SC, base[1] + dir[1] * FAN_RU * SC];
    const ru = FAN_RU * SC, rv = FAN_RV * SC;
    for (let y = Math.floor(c[1] - ru - 1); y <= c[1] + ru + 1; y++) for (let x = Math.floor(c[0] - ru - 1); x <= c[0] + ru + 1; x++) {
      const dx = x + 0.5 - c[0], dy = y + 0.5 - c[1], u = dx * dir[0] + dy * dir[1], v = -dx * dir[1] + dy * dir[0];
      // 付け根の側を細くした瓢箪の形
      const kk = (u / ru) ** 2 + (v / (rv * (u < 0 ? 0.8 + 0.2 * (1 + u / ru) : 1))) ** 2;
      if (kk > 1) continue;
      set(x, y, Math.hypot(u * 0.8, v) < rv * 0.34 ? 'r' : kk > 0.62 ? 'g' : 'd');
    }
  });
  const far = fn.hand === 'far';
  const rest = fn.rest ? k.T(...fn.rest) : null;
  // 体より先に描く奥の腕：軍配を奥の手で持つなら軍配を握り、そうでなければ腰に下ろす
  const farSide = () => {
    if (far) { armIK(farSh, hand, 'o', 'n', 4); fan(); }
    else if (rest) armIK(farSh, rest, 'o', 'n', 4);
  };
  // 頭のあとに描く手前の腕：軍配を手前の手で持つなら軍配を握り、そうでなければ腰に下ろす
  const nearSide = () => {
    if (!far) { armIK(nearSh, hand, 'o', 'n'); fan(); }
    else if (rest) armIK(nearSh, rest, 'o', 'n');
  };
  // 軍配の板の先（弧と白い筋を引く所）
  const tip = [hand[0] + dir[0] * (FAN_HANDLE + FAN_RU * 2) * SC, hand[1] + dir[1] * (FAN_HANDLE + FAN_RU * 2) * SC];
  // 打った軍配の通った弧（刀の弧と同じ色。common.js の swingArc）：手前の肩を中心に、軍配の先が通った所。
  // swing は [振った角度の幅（度）, 太さ]。今の軍配の向きで終わる。軍配は刀より短く、弧が体に隠れるので、板の先より少し外を通す
  const swing = (out, [width, wid]) => {
    const a1 = (Math.atan2(tip[1] - nearSh[1], tip[0] - nearSh[0]) * 180) / Math.PI;
    swingArc(out, nearSh[0], nearSh[1], Math.hypot(tip[0] - nearSh[0], tip[1] - nearSh[1]) + 2, a1 - width, a1, wid * SC);
  };
  // 振り下ろした瞬間（スキルの采配）：軍配の通った跡（板の先から、振った向きと逆へ短い白い筋）
  const swish = (out, [sx, sy]) => {
    for (let kk = 1; kk <= 5; kk++) dot(out, tip[0] + sx * kk, tip[1] + sy * kk, kk < 3 ? '#ffffff' : '#c9c7c2');
  };
  return { hand, dir, fan, farSide, nearSide, tip, swing, swish };
}
// 軍配のコマ：待機は軍配を画面の左に立てて持つ（斜め前は手前の手、斜め後ろは奥の手）。もう一方の手は腰に下ろす。
// 攻撃（軍配で打つ）は、胸の前に構える → 頭の後ろへ振りかぶる → 前へ打ち下ろす → 打ち込む → 戻す。
// スキル（軍配の采配）は、胸の前に構える → 頭の上に掲げる → 振り下ろす → 指したまま → 下ろす。
// 攻撃もスキルも手前の手で、盤面の「前」（斜め前は右下、斜め後ろは右上）へ向ける
function fanPoses(draw, v) {
  const f = v === 'front';
  const holdFan = (dy = 0, da = 0) => (f
    ? { hx: 13, hy: 30 + dy, ang: -96 + da, hand: 'near', rest: [33, 34] }
    : { hx: 11, hy: 30 + dy, ang: -94 + da, hand: 'far', rest: [35, 34] });
  const stance = () => {
    const base = { lean: 1, step: 4, back: 4 };
    return [
      draw(v, { ...base, bob: 2, fan: holdFan(), sway: 0 }),
      draw(v, { ...base, bob: 2, fan: holdFan(0, -2), sway: 1 }),
      draw(v, { ...base, bob: 3, fan: holdFan(1, -2), sway: 1 }),
      draw(v, { ...base, bob: 3, fan: holdFan(1, 2), sway: 0 }),
    ];
  };
  const walk = () => {
    const base = { lean: 2 };
    return [
      draw(v, { ...base, step: 7, back: 6, bob: 1, fan: holdFan(1, 4), sway: 1 }),
      draw(v, { ...base, step: 0, back: -1, farLift: 3, bob: 0, fan: holdFan(0, 0), sway: 2 }),
      draw(v, { ...base, step: -5, back: -7, bob: 1, fan: holdFan(1, -4), sway: 1 }),
      draw(v, { ...base, step: 1, back: 0, nearLift: 3, bob: 0, fan: holdFan(0, 0), sway: 0 }),
    ];
  };
  const base = { step: 5, back: 5 };
  const A = (hx, hy, ang, more = {}) => ({ fan: { hx, hy, ang, hand: 'near', rest: f ? [33, 34] : [12, 34] }, ...more });
  const attack = () => (f
    ? [
        { name: '構える', g: draw(v, { ...base, bob: 2, lean: 0, ...A(26, 31, -50) }) },
        { name: '振りかぶる', g: draw(v, { ...base, bob: 1, lean: -4, ...A(13, 13, -155) }) },
        { name: '打ち下ろす', g: draw(v, { ...base, step: 7, bob: 3, lean: 4, ...A(33, 19, 15, { swing: [100, 8] }) }) },
        { name: '打ち込む', g: draw(v, { ...base, step: 7, bob: 4, lean: 6, ...A(33, 30, 80, { swing: [70, 6] }) }) },
        { name: '戻す', g: draw(v, { ...base, bob: 2, lean: 1, ...A(23, 29, -45) }) },
      ]
    : [
        { name: '構える', g: draw(v, { ...base, bob: 2, lean: 0, ...A(31, 24, -85) }) },
        { name: '振りかぶる', g: draw(v, { ...base, bob: 1, lean: -4, ...A(22, 9, -140) }) },
        { name: '打ち下ろす', g: draw(v, { ...base, step: 7, bob: 3, lean: 4, ...A(42, 14, -5, { swing: [100, 8] }) }) },
        { name: '打ち込む', g: draw(v, { ...base, step: 7, bob: 4, lean: 6, ...A(43, 25, 60, { swing: [70, 6] }) }) },
        { name: '戻す', g: draw(v, { ...base, bob: 2, lean: 1, ...A(37, 28, -60) }) },
      ]);
  const skill = () => (f
    ? [
        { name: '構える', g: draw(v, { ...base, aura: 1, bob: 2, lean: 0, ...A(21, 25, -70) }) },
        { name: '掲げる', g: draw(v, { ...base, aura: 2, bob: 1, lean: -2, ...A(19, 5, -100) }) },
        { name: '振り下ろす', g: draw(v, { ...base, bob: 2, lean: 3, ...A(33, 23, 12, { swish: [-0.4, -1] }) }) },
        { name: '指す', g: draw(v, { ...base, aura: 2, bob: 2, lean: 3, ...A(34, 24, 18) }) },
        { name: '下ろす', g: draw(v, { ...base, bob: 2, lean: 1, ...A(22, 30, -40) }) },
      ]
    : [
        { name: '構える', g: draw(v, { ...base, aura: 1, bob: 2, lean: 0, ...A(31, 25, -80) }) },
        { name: '掲げる', g: draw(v, { ...base, aura: 2, bob: 1, lean: -2, ...A(33, 5, -95) }) },
        { name: '振り下ろす', g: draw(v, { ...base, bob: 2, lean: 3, ...A(42, 15, -24, { swish: [-0.5, 1] }) }) },
        { name: '指す', g: draw(v, { ...base, aura: 2, bob: 2, lean: 3, ...A(43, 16, -20) }) },
        { name: '下ろす', g: draw(v, { ...base, bob: 2, lean: 1, ...A(37, 28, -60) }) },
      ]);
  const hurt = () => [
    draw(v, { lean: -5, bob: 1, step: 1, back: 3, sway: 2, spark: f ? [27, 24] : [33, 19], fan: holdFan(-1, -18) }),
    draw(v, { lean: -2, bob: 2, step: 2, back: 4, sway: 1, fan: holdFan(0, -8) }),
  ];
  const fall = () => bushoFall(draw(v, { lean: 3, bob: 7, step: 3, back: 2, sway: 1, fan: { ...holdFan(8, 0), ang: f ? 150 : 160 } }));
  return { 待機: stance(), 歩き: walk(), 攻撃: attack(), スキル: skill(), 被弾: hurt(), 倒れ: fall() };
}
