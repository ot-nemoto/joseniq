// 大島光義（ふだんは槍、スキルで弓）3頭身・背丈38ドット。斜め前（front）と斜め後ろ（back）。謙信・信長と同じ組み立てで、頭・色・武器を差し替える。
// 目印は、金の鍬形の兜、長い白髪と白いひげ、緑の鎧、背中の矢筒。common.js と一緒に読む
const KM = (() => {
  // 素材の色（暗・影・地・明）
  const R = {
    n: ['#0d1a10', '#1b3320', '#2c4e31', '#4a7650'], // 緑の漆の鎧
    f: ['#0b130d', '#162419', '#233827', '#38543d'], // 緑の小袖・袴
    g: ['#6e4a1c', '#a8782c', '#e0b84e', '#fff0a0'], // 金
    d: ['#0b0b10', '#1e1e26', '#33333f', '#5c5c74'], // 黒（鞘）
    w: ['#8f8a80', '#c4c0b6', '#e8e5dc', '#ffffff'], // 白い帯
    r: ['#5e1414', '#9c2a24', '#d14a38', '#f08a6a'], // 朱の縁（軍の色に塗り替える）
    s: ['#8a5a44', '#c98f6e', '#ecc4a0', '#fde3c8'], // 肌
    h: ['#8f8c84', '#c4c1b8', '#e9e7e0', '#ffffff'], // 白髪（背中に垂れる髪）
    y: ['#4a3418', '#7a5a2e', '#a8844e', '#d6b47a'], // 弓と矢の竹
    l: ['#e8e4d8', '#e8e4d8', '#e8e4d8', '#e8e4d8'], // 弦
    q: ['#101c12', '#1e3522', '#2f5235', '#4a7650'], // 矢筒
    C: ['#101a12', '#1b3320', '#2c4e31', '#4a7650'], // 兜（手で置いた頭の素材）
  };
  // 手で置いた頭。K 兜の縁 N 兜 M 兜の光 n 兜の影 Y 金の光 G 金 g 金の影 W 白髪 w 白髪の影 S 肌 s 肌の影
  // b 眉 e 白目 E 黒目 B ひげ m 口 r 錣の縁（軍の色）。
  // 白髪とひげは、目印なので白く際立たせる。ひげは髪より少し明るくして、髪と分ける
  const HP = {
    K: '#101a12', N: '#2c4e31', M: '#4a7650', n: '#1b3320', Y: '#fff0a0', G: '#e0b84e', g: '#a8782c',
    W: '#e9e7e0', w: '#b9b6ac', S: '#ecc4a0', s: '#c98f6e', b: '#5a5550', e: '#f8f4ee', E: '#1c120c',
    B: '#fbfaf6', m: '#a04a3c', r: R.r[2],
  };
  const HEAD_FRONT = {
    ax: 8.5, ay: 8.5, top: 3,
    rows: [
      'Y...............Y.',
      'GG.....gYg.....GG.',
      '.GGg..KgGgK..gGG..',
      '..KGGgNNNNNgGGK...',
      '..KNNMNNNNNNNNK...',
      '.KgggggggggggggK..',
      'KNNWWWWSSSSSSSSNK.',
      'KNNWWWbbbSSSbbSNK.',
      'KNgWWWSeESSSeESNK.',
      '.KNWWWSSSSSSSSsK..',
      '..WWWWSBBBmBBBs...',
      '..WWWwSBBBBBBBS...',
      '..WWwwwSBBBBBs....',
      '...Ww...BBBBB.....',
      '.........BBB......',
      '..........B.......',
    ],
  };
  const HEAD_BACK = {
    ax: 8.5, ay: 8.5, top: 3,
    rows: [
      '...Y............Y.',
      '...GG..........GG.',
      '....GGg......gGG..',
      '.....KGgNNNNgGK...',
      '...KNNNNMNNNNNNK..',
      '..KNNNNNNNNNMNNNK.',
      '.KnNNgNNNNgNNNNNK.',
      'KnnnnnnnnnnnnnnnSK',
      'KrrrrrrrrrrrrrrrS.',
      '....wWWWWWWWw..Bs.',
      '.....WWwWWwWW..B..',
      '.....wWwWWwWw.....',
      '......WwWWwW......',
      '......wwWWww......',
      '.......wWWw.......',
      '........ww........',
    ],
  };
  const W = 80, H = 72, OX = 16, OY = 10, SC = 36 / 44;
  const HEAD = 14, KY = 0.68, DROP = 13;
  const Y = (y) => (y <= HEAD ? y : HEAD + (y - HEAD) * KY) + DROP;
  const AX = 39, AY = 65;
  const SP = (x, y) => [AX + (x - AX) * SC, AY + (y - AY) * SC];
  const TW = (t) => Math.max(1, Math.round(t * SC));
  // 弓：握りから上の端まで、下の端まで（握りは真ん中より下。縮める前のドット）、反りの深さ、矢の長さ
  const BOW_UP = 25, BOW_DN = 14, BOW_BEND = 2.4, ARROW = 19;
  // 槍：握る手から穂先の側（柄の先まで）と石突きの側の長さ、穂先の長さ（縮める前のドット）
  const SPEAR_FWD = 20, SPEAR_BACK = 13, SPEAR_TIP = 5;
  function draw(view, o = {}) {
    const front = view === 'front';
    const F = front ? [1, 0.5] : [1, -0.5];
    const lean = o.lean || 0, bob = o.bob || 0, sway = o.sway || 0;
    const T = (x, y) => { const s = Math.max(0, (42 - y) / 26); return SP(x + lean * s * F[0] + OX, Y(y) + lean * s * F[1] + bob + OY); };
    const { m, sg, wm, set, polyA, ellA, lineA, weapon } = mkCanvas(W, H);
    const fix = [];
    let top = null; // 兜の鉢の上の端（幟を立てる位置を決める）
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
      lineA(h[0], h[1], k[0], k[1], 'f', wid);
      lineA(k[0], k[1], f[0], f[1] - 1, v, wid);
      // すね当ての金の縁（1本）
      const x = k[0] + (f[0] - k[0]) * 0.15, y = k[1] + (f[1] - 1 - k[1]) * 0.15; lineA(x - wid / 2 + 0.5, y, x + wid / 2 - 0.5, y, 'g');
      lineA(f[0] - shoe / 2, f[1], f[0] + shoe / 2, f[1] + (front ? 0.5 : -0.5), 'n', 2);
    };
    const step = o.step || 0, back = o.back || 0;
    const nearHip = front ? [20.5, 40] : [26.5, 40], farHip = front ? [26, 40] : [20.5, 40];
    const nearFoot = front ? [20, 54] : [27, 54], farFoot = front ? [26, 53] : [20.5, 53];
    const legs = () => {
      leg(farHip, [farFoot[0] - F[0] * back, farFoot[1] - F[1] * back - (o.farLift || 0)], 'n', 4, 6);
      leg(nearHip, [nearFoot[0] + F[0] * step, nearFoot[1] + F[1] * step - (o.nearLift || 0)], 'n', 5, 7);
    };
    // 弓と腕：bow.hx・hy は握る手、ang は矢を向ける向き（弓は、その向きに直角に立つ）、pull は弦を引いた長さ、
    // grip は握る手が手前（near）か奥（far）か。弦を引く手は、もう一方の手。引いていないときは rest の所に下ろす
    const bw = o.bow;
    let grip, dir, axis, nock;
    if (bw) {
      grip = SP(bw.hx + OX, Y(bw.hy) + OY);
      dir = [Math.cos(rad(bw.ang)), Math.sin(rad(bw.ang))];
      axis = [dir[1], -dir[0]]; // 上の端の向き
      nock = [grip[0] - dir[0] * (bw.pull || 0) * SC, grip[1] - dir[1] * (bw.pull || 0) * SC];
    }
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
      // 柄は弓と同じ竹の色、穂先は白い帯の色（色の数を増やさないため。書き出しの色は英字の数まで）
      lineA(b[0], b[1], t[0], t[1], 'y', TW(2));
      lineA(t[0], t[1], e[0], e[1], 'w', TW(2));
      fix.push([Math.round(e[0]), Math.round(e[1]), '#ffffff']);
      spTip = e;
    };
    const spFar = sp && sp.grip === 'far';
    // 背負った弓（弓を構えていないとき）：左の肩から右の腰へ斜めに負う。弦は体の側
    const backBow = () => {
      const a = front ? [12, 6] : [13, 9], b = front ? [31, 44] : [33, 44];
      let prev = null;
      for (let i = 0; i <= 12; i++) {
        const t = i / 12, bend = 2.6 * (1 - (2 * t - 1) ** 2);
        const q = T(a[0] + (b[0] - a[0]) * t - bend * 0.5, a[1] + (b[1] - a[1]) * t + bend * 0.25);
        if (prev) lineA(prev[0], prev[1], q[0], q[1], 'y');
        prev = q;
      }
      const s0 = T(...a), s1 = T(...b);
      lineA(s0[0], s0[1], s1[0], s1[1], 'l');
    };
    const nearSh = T(...(front ? [15, 20] : [34, 20])), farSh = T(...(front ? [33, 20] : [14, 20]));
    const armIK = (s, h, up, fore, w = 5) => {
      const e = joint(s[0], s[1], h[0], h[1], 8 * 0.8 * SC, 8 * 0.8 * SC, (a, b) => (a[1] > b[1] ? a : b));
      lineA(s[0], s[1], e[0], e[1], up, TW(w));
      lineA(e[0], e[1], h[0], h[1], fore, TW(w - 1));
      ellA(h[0] + 0.5, h[1] + 0.5, 2.0 * SC, 1.8 * SC, 'n'); // 緑の手甲
    };
    const bowTip = (s) => {
      // 弓の上の端（s = BOW_UP）から下の端（s = -BOW_DN）まで。真ん中ほど矢の向きへ反らせる。引くほど深く反る
      const mid = (BOW_UP - BOW_DN) / 2, half = (BOW_UP + BOW_DN) / 2, bend = BOW_BEND + (bw.pull || 0) * 0.12;
      const k = bend * (1 - ((s - mid) / half) ** 2);
      return [grip[0] + (axis[0] * s + dir[0] * k) * SC, grip[1] + (axis[1] * s + dir[1] * k) * SC];
    };
    const bow = () => weapon(bowBody);
    const bowBody = () => {
      const t0 = bowTip(BOW_UP), t1 = bowTip(-BOW_DN);
      // 弦：引いているときは、矢筈（弦を引く手）の所で折れる
      if (bw.pull) { lineA(t0[0], t0[1], nock[0], nock[1], 'l'); lineA(nock[0], nock[1], t1[0], t1[1], 'l'); }
      else if (!bw.noString) lineA(t0[0], t0[1], t1[0], t1[1], 'l');
      // 弓の本体（竹）
      let p = t1;
      for (let s = -BOW_DN + 1; s <= BOW_UP; s += 1) { const q = bowTip(s); lineA(p[0], p[1], q[0], q[1], 'y'); p = q; }
      // 握りの革（黒）
      const g0 = bowTip(-1.5), g1 = bowTip(1.5); lineA(g0[0], g0[1], g1[0], g1[1], 'd', TW(2));
      // つがえた矢：矢筈から矢の向きへ。矢羽根は白、鏃は鉄
      if (bw.arrow) {
        const a0 = bw.pull ? nock : [grip[0] - dir[0] * 3 * SC, grip[1] - dir[1] * 3 * SC];
        // 深く引くと、矢の先が弓の握りに隠れないよう、矢を握りより先へ出す
        const al = Math.max(ARROW, (bw.pull || 0) + 4);
        const a1 = [a0[0] + dir[0] * al * SC, a0[1] + dir[1] * al * SC];
        lineA(a0[0], a0[1], a1[0], a1[1], 'y');
        fix.push([Math.round(a1[0]), Math.round(a1[1]), '#c9ccd6']);
        for (const k of [1, 2]) { const fx = a0[0] + dir[0] * k * SC * 1.6, fy = a0[1] + dir[1] * k * SC * 1.6; fix.push([Math.round(fx - axis[0]), Math.round(fy - axis[1]), '#ffffff'], [Math.round(fx + axis[0]), Math.round(fy + axis[1]), '#ffffff']); set(Math.round(fx - axis[0]), Math.round(fy - axis[1]), 'y'); set(Math.round(fx + axis[0]), Math.round(fy + axis[1]), 'y'); }
      }
    };
    // 弓を握る腕と、弦を引く（または下ろした）腕
    const drawHand = () => (bw.pull ? nock : bw.rest ? T(...bw.rest) : null);
    const sode = (cx, cy, wide) => { const [X, Yy] = T(cx, cy); const w = wide * SC, u = 3.4 * SC; polyA([[X - w, Yy - u], [X + w, Yy - u], [X + w + 0.5, Yy + u], [X - w - 0.5, Yy + u + 0.5]], 'n'); };
    const lace = [];
    const laceRows = (rows, x0, x1, t = 2) => { for (const yy of rows) for (let x = x0; x < x1; x++) { const [X, Yy] = T(x, yy).map(Math.round); if (m[Yy] && m[Yy][X] === 'n') lace.push([X, Yy, t]); } };
    const goldRows = (rows, x0, x1) => { for (const yy of rows) for (let x = x0; x < x1; x++) { const [X, Yy] = T(x, yy).map(Math.round); if (m[Yy] && m[Yy][X] === 'n') fix.push([X, Yy, R.g[1]]); } };
    const gripFar = bw && bw.grip === 'far', gripNear = bw && bw.grip !== 'far';

    if (front) {
      // 背中に垂れる白髪（頭の後ろ＝画面の左から、肩の後ろへ）
      poly([[13, 12], [18, 12], [17 - sway * 0.5, 27], [12 - sway, 26]], 'h');
      if (!bw) backBow();
      legs();
      // 槍：奥の腕は、握る手（奥で握るとき）か、もう一方の手
      if (sp) { const h = spFar ? sHand : sOther; if (h) armIK(farSh, h, 'f', 'n', 4); }
      // 奥の腕：弓を握る（攻撃）か、弦を引かずに下ろす
      if (bw && gripFar && !o.farFront) armIK(farSh, grip, 'f', 'n', 4);
      else if (bw && !gripFar && drawHand()) armIK(farSh, drawHand(), 'f', 'n', 4);
      // 緑の胴と草摺、白い帯、金の縁
      poly([[16, 17], [32, 17], [33, 42], [15, 42]], 'n');
      poly([[16, 29.5], [32, 29.5], [32.5, 31.5], [16, 31.5]], 'w');
      sode(33, 21, 2.8);
      // 腰の刀（左の腰に納める）
      line(29, 32, 36, 37, 'd', 2); rect(28, 31, 2, 2, 'g');
      if (bw && o.bowBehind) bow();
      // 緑の立て襟
      poly([[17, 13], [31, 13], [32, 17], [29, 19], [19, 19], [16, 17]], 'n');
      stampHead(HEAD_FRONT);
      if (bw && gripFar && o.farFront) armIK(farSh, grip, 'f', 'n', 4);
      if (bw && !o.bowBehind) bow();
      // 槍と、手前の腕：握る手（手前で握るとき）か、もう一方の手
      if (sp) { spear(); const h = spFar ? sOther : sHand; if (h) armIK(nearSh, h, 'f', 'n'); }
      // 手前の腕：弓を握る（待機）か、弦を引く（攻撃）
      if (bw && gripNear) armIK(nearSh, grip, 'f', 'n');
      else if (bw && drawHand()) armIK(nearSh, drawHand(), 'f', 'n');
      sode(15, 20, 4.2);
      // 金の縅を胴に1段、朱の縁（軍の色）を草摺と袖の裾に1段ずつ
      goldRows([23], 17, 32);
      laceRows([41], 15, 34);
      laceRows([23.5], 9, 21);
    } else {
      legs();
      // 槍を奥の手で握るときは、槍と奥の腕を体の陰に描く
      if (sp && spFar) { armIK(farSh, sHand, 'f', 'n', 4); spear(); }
      else if (sp && sOther) armIK(farSh, sOther, 'f', 'n', 4);
      // 奥の腕（体の陰）：弓を握る（待機）か、弦を引く（攻撃）
      if (bw && gripFar) armIK(farSh, grip, 'f', 'n', 4);
      else if (bw && drawHand()) armIK(farSh, drawHand(), 'f', 'n', 4);
      if (bw && gripFar) bow();
      // 緑の胴の背と白い帯
      poly([[14, 17], [34, 17], [35, 42], [13, 42]], 'n');
      poly([[13.5, 29.5], [34.5, 29.5], [35, 31.5], [13.5, 31.5]], 'w');
      // 腰の刀（左の腰から手前へ）
      line(17, 33, 6, 43, 'd', 2); rect(4, 43, 3, 2, 'g');
      // 矢筒：右の肩から左の腰へ斜めに負い、矢羽根を肩の上に出す
      poly([[31, 14], [35, 16], [21, 41], [17, 39]], 'q');
      line(31.5, 17, 34.5, 18.5, 'g', 1);
      for (const [x, yy] of [[31, 9], [33, 8], [35, 10]]) { line(x + 1, yy + 6, x, yy, 'y', 1); fix.push(...[[0, 0], [1, 0]].map(([dx]) => { const [X, Yy] = T(x + dx, yy).map(Math.round); set(X, Yy, 'w'); return [X, Yy, '#ffffff']; })); }
      if (!bw) backBow();
      // 背中に垂れる白髪（矢筒の上に重ねる）
      poly([[20.5, 13], [27.5, 13], [25 + sway * 0.5, 35], [23 + sway * 0.5, 35]], 'h');
      sode(13, 20, 2.8); sode(34, 20, 4.2);
      stampHead(HEAD_BACK);
      if (bw && gripNear) { armIK(nearSh, grip, 'f', 'n'); bow(); }
      if (sp && !spFar) { spear(); armIK(nearSh, sHand, 'f', 'n'); }
      else if (sp && spFar && sOther && sp.two) armIK(nearSh, sOther, 'f', 'n');
      laceRows([23.5], 9, 40);
      laceRows([41], 13, 36);
    }
    // 陰影
    const out = shade(m, R, { skip: 'ksly', pass: 'r', light: 'wh' });
    for (const [x, y, t] of lace) out[y][x] = R.r[t];
    for (const [x, y, c] of fix) if (y >= 0 && y < H && x >= 0 && x < W && m[y][x]) out[y][x] = c;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (sg[y][x]) out[y][x] = sg[y][x];
    outline(out, m, R, 'dnfqyClC');
    // 放った瞬間：弦の震え（弦の真ん中から前へ、白い短い筋）
    if (o.twang && bw) {
      const mx = (bowTip(BOW_UP)[0] + bowTip(-BOW_DN)[0]) / 2, my = (bowTip(BOW_UP)[1] + bowTip(-BOW_DN)[1]) / 2;
      for (const s of [-1, 1]) for (let k = 1; k <= 3; k++) dot(out, mx - dir[0] * 0.5 + axis[0] * s * (k + 1), my - dir[1] * 0.5 + axis[1] * s * (k + 1), k < 3 ? '#ffffff' : '#c9c7c2');
    }
    if (o.spark) spark(out, T(...o.spark).map(Math.round));
    // スキルの溜め：武器のまわりを光らせる
    if (o.aura) weaponAura(out, wm, o.aura, ['#fff0a0', '#e0b84e']);
    // 突いた槍の残像：穂先から、突いた向きと逆へ伸びる細い筋（common.js の thrustTrail）
    if (o.thrust && spTip) thrustTrail(out, spTip, sDir, o.thrust);
    out.top = top;
    return out;
  }
  // 待機：槍を画面の左に立てて持つ（斜め前は手前の手、斜め後ろは奥の手）。もう一方の手は腰に下ろす。弓は背負う
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
  // スキル（弓）：矢をつがえる → 引き絞る → 狙う（溜めのあいだ引き絞ったまま）→ 放つ（弦が震える）→ 下ろす。
  // 弓を握る手は、斜め前は奥の手、斜め後ろは手前の手で、盤面の「前」（斜め前は右下、斜め後ろは右上）へ向ける。槍は持たない
  const skill = (v) => {
    const f = v === 'front';
    const base = { step: 5, back: 5 };
    const aim = f ? 14 : -32, grip = f ? 'far' : 'near';
    const at = f ? [41, 21] : [42, 14];
    const B = (dx, dy, da, pull, more = {}) => ({ hx: at[0] + dx, hy: at[1] + dy, ang: aim + da, pull, grip, ...more });
    return [
      { name: 'つがえる', g: draw(v, { ...base, aura: 1, bob: 2, lean: 0, farFront: f, bow: B(-6, 6, -14, 3, { arrow: true }) }) },
      { name: '引き絞る', g: draw(v, { ...base, aura: 2, bob: 2, lean: 1, farFront: f, bow: B(0, 0, 0, 18, { arrow: true }) }) },
      { name: '狙う', g: draw(v, { ...base, aura: 2, bob: 2, lean: 2, farFront: f, bow: B(1, 0, 0, 19, { arrow: true }) }) },
      { name: '放つ', g: draw(v, { ...base, bob: 2, lean: 1, farFront: f, twang: true, bow: B(0, 0, 0, 0, { rest: f ? [20, 15] : [30, 18] }) }) },
      { name: '下ろす', g: draw(v, { ...base, bob: 2, lean: 0, farFront: f, bow: B(-5, 9, 40, 0, { rest: f ? [16, 30] : [31, 33] }) }) },
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
