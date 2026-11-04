// 兵（足軽）の大きな絵。3頭身・背丈32ドットほど（武将より一回り小さい）。斜め前（front）と斜め後ろ（back）。
// 体の作りは kenshin.js と同じ（体の位置を縮めて置き、頭は手で置いた絵）。兵は幟を持たず、胴などを軍の色にする。common.js と一緒に読む。
// 兵ごとに、頭（陣笠・鉢巻・手ぬぐい）・持ち物（槍・弓・槌・盾・なし）・胴の有無・背中の飾りと、各コマの姿勢を変える。
// 歩兵は KA、弓兵は KY、騎兵は KK、衝車は KR、工兵は KE、盾兵は KD、斥候は KS
RAMP.e = ['#5c6470', '#9aa4b2', '#dfe6ee', '#ffffff']; // 穂先・槌の金具
RAMP.h = ['#3c2414', '#6a4426', '#94663a', '#b88a56']; // 槍の柄・槌・盾の木
RAMP.u = ['#2e2a26', '#4c443c', '#6c6256', '#8c8070']; // 着物・股引（くすんだ茶）
RAMP.w = ['#6a6458', '#a49c8a', '#d2cab6', '#ece6d6']; // 脚絆
RAMP.z = ['#5a4422', '#8a6c38', '#b89a5c', '#d8c088']; // 草鞋
RAMP.j = ['#0e0e12', '#1c1c24', '#2e2e3a', '#4c4c5e']; // 陣笠（黒漆）
RAMP.y = ['#4a3418', '#7a5a2e', '#a8844e', '#d6b47a']; // 弓と矢の竹
RAMP.l = ['#e8e4d8', '#e8e4d8', '#e8e4d8', '#e8e4d8']; // 弦
RAMP.m = ['#6a4a2a', '#9a7046', '#c49a66', '#e0bc88']; // 槌の頭（白木）
RAMP.o = ['#1e1612', '#3a2a20', '#58402e', '#7a5a40']; // 馬（黒鹿毛。槍の柄と見分けやすいよう暗くする）
RAMP.R = ['#241c18', '#3a2e26', '#4e4034', '#625244']; // 衝車の屋根の奥の面（陰になった板）
RAMP.O = ['#141010', '#2a201a', '#3e3024', '#544032']; // 奥の脚（陰の黒鹿毛）

// 背丈32ドット用に1ドットずつ置いた頭。J 陣笠 j 陣笠の影 L 陣笠の光 D 笠の縁 A a 合印・手ぬぐい（軍の色）
// W w 鉢巻（白い布） k 髪 S 肌 s 肌の影 b 眉 e 白目 E 黒目 m 口
const HEAD_PAL = {
  J: RAMP.j[2], j: RAMP.j[1], L: RAMP.j[3], D: RAMP.j[0], A: RAMP.r[2], a: RAMP.r[1],
  W: '#f4f0e4', w: '#bdb6a4',
  k: '#2a1d16', S: '#ecc4a0', s: '#c98f6e', b: '#2a1d16', e: '#f8f4ee', E: '#1c120c', m: '#a04a3c',
};
// ay は頭を体に置く高さの基準の行。どの頭も目の行が ay + 1 になるようにそろえる
const HEADS = {
  jingasa: {
    front: { ax: 7.5, ay: 6, rows: [
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
    ] },
    back: { ax: 7.5, ay: 6, rows: [
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
    ] },
  },
  // 兜（騎兵）：黒い鉢と眉庇、顔の脇の吹返し、後ろに垂れる錣（軍の色の縅を2段）。兵なので前立てや金の飾りは付けず、正面に合印を入れる
  kabuto: {
    front: { ax: 7.5, ay: 7, rows: [
      '......jJJL......',
      '....jjJJJJLL....',
      '...jjJJJJJJJL...',
      '..jjJJJJAaJJJL..',
      '.jjjJJJJJJJJJJ..',
      'DDDDDDDDDDDDDDDj',
      'jjjkkkssssssjj..',
      'aaakkSbbSSbbsj..',
      'jjjkkSeESSeEs...',
      'aaakkSSSSSSSs...',
      'jjjjkSSSSmSs....',
      '.....ssSSSs.....',
    ] },
    back: { ax: 7.5, ay: 7, rows: [
      '......jJJL......',
      '....jjJJJJLL....',
      '...jjJJJJJJJL...',
      '..jjJJJJJJJJJL..',
      '.jjjJJJJJJJJJJ..',
      'DDDDDDDDDDDDDDD.',
      'jjjjjjjjjjjjjs..',
      'aaaaaaaaaaaaSs..',
      'jjjjjjjjjjjjSs..',
      'aaaaaaaaaaaaS...',
      '.jjjjjjjjjjS....',
      '.....ssssss.....',
    ] },
  },
  // 鉢巻：額に白い布を巻き、結び目の端を後ろに垂らす
  hachimaki: {
    front: { ax: 7.5, ay: 4, rows: [
      '.....kkkkkk.....',
      '...kkkkkkkkkk...',
      '..wWWWWWWWWWWW..',
      '.wwkkkSSSSSSs...',
      '.w.kkSbbSSbbs...',
      '...kkSeESSeEs...',
      '...kkSSSSSSSs...',
      '....kSSSSmSs....',
      '.....ssSSSs.....',
    ] },
    back: { ax: 7.5, ay: 4, rows: [
      '.....kkkkkk.....',
      '...kkkkkkkkkk...',
      '..WWWWWWWWWWWw..',
      '..kWkkkkkkkkSs..',
      '..wWkkkkkkkkSs..',
      '..w.kkkkkkkkSs..',
      '...kkkkkkkkkS...',
      '....kkkkkkkS....',
      '.....ssssss.....',
    ] },
  },
  // 手ぬぐい：軍の色の布を頭に被り、端を後ろに垂らす
  tenugui: {
    front: { ax: 7.5, ay: 5, rows: [
      '.....aAAAA......',
      '...aAAAAAAAA....',
      '..aaAAAAAAAAA...',
      '.aaaaAAAAAAAAa..',
      'aa.kkssssssss...',
      'a..kkSbbSSbbs...',
      '...kkSeESSeEs...',
      '...kkSSSSSSSs...',
      '....kSSSSmSs....',
      '.....ssSSSs.....',
    ] },
    back: { ax: 7.5, ay: 5, rows: [
      '.....aAAAA......',
      '...aAAAAAAAA....',
      '..aaAAAAAAAAA...',
      '.aaaaAAAAAAAAa..',
      '.aaakkkkkkkSs...',
      '..aakkkkkkkSs...',
      '...akkkkkkkSs...',
      '....kkkkkkkS....',
      '.....ssssss.....',
    ] },
  },
};

// 兵の絵を作る。cfg.head は頭（HEADS の名前）、cfg.armor は胴と草摺を着るか、cfg.quiver は背中の矢筒、
// cfg.poses(draw) は各動きのコマ（draw(view, 姿勢) の並び）を返す
const mkTroop = (cfg) => (() => {
  const FW = 80, FH = 72; // 描く枠（謙信と同じ）。最後に CX・CY から W×H を切り出す
  const [W, H, CX, CY] = cfg.frame ?? [56, 48, 14, 24];
  const OX = 16, OY = 10, SC = 0.68;
  const RY = cfg.horse ? -12 : 0; // 馬に乗る兵は、乗り手を馬の背の高さまで上げる
  const HEAD = 14, KY = 0.68, DROP = 13;
  const Y = (y) => (y <= HEAD ? y : HEAD + (y - HEAD) * KY) + DROP;
  const AX = 39, AY = 65;
  const SP = (x, y) => [AX + (x - AX) * SC, AY + (y - AY) * SC + RY];
  const TW = (t) => Math.max(1, Math.round(t * SC));
  const rad = (a) => (a * Math.PI) / 180;
  const HD = HEADS[cfg.head];
  function draw(view, o = {}) {
    const front = view === 'front';
    const F = front ? [1, 0.5] : [1, -0.5];
    const lean = o.lean || 0, bob = o.bob || 0;
    const T = (x, y) => { const s = Math.max(0, (42 - y) / 26); return SP(x + lean * s * F[0] + OX, Y(y) + lean * s * F[1] + bob + OY); };
    const m = Array.from({ length: FH }, () => Array(FW).fill(''));
    const sg = Array.from({ length: FH }, () => Array(FW).fill(''));
    const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < FW && y < FH) { m[y][x] = v; sg[y][x] = ''; } };
    let top = null; // 頭の上の端。体力の棒を出す高さに使う
    const stampHead = (hd) => {
      const [cx, cy] = T(24, 8.5);
      const x0 = Math.round(cx - hd.ax), y0 = Math.round(cy - hd.ay);
      top = [x0 + hd.ax, y0];
      hd.rows.forEach((row, j) => [...row].forEach((ch, i) => {
        if (ch === '.') return;
        const x = x0 + i, y = y0 + j;
        if (x < 0 || y < 0 || x >= FW || y >= FH) return;
        m[y][x] = 'Ss'.includes(ch) ? 's' : 'Aa'.includes(ch) ? 'r' : 'Ww'.includes(ch) ? 'c' : 'j';
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
      if (cfg.horse) {
        horse();
        // 乗り手の脚：手前の脚だけを、馬の脇へ下ろして鐙に掛ける
        const h = SP(nearHip[0] + OX, Y(nearHip[1]) + bob + OY), k = [h[0] + F[0] * 4, h[1] + 4], f = [k[0] - 1, k[1] + 6];
        lineA(h[0], h[1], k[0], k[1], 'u', TW(5));
        lineA(k[0], k[1], f[0], f[1], 'w', TW(5));
        lineA(f[0] - 1, f[1] + 1, f[0] + 2, f[1] + 1, 'z', 2);
        return;
      }
      leg(farHip, [farFoot[0] - F[0] * back, farFoot[1] - F[1] * back - (o.farLift || 0)], 4, 6);
      leg(nearHip, [nearFoot[0] + F[0] * step, nearFoot[1] + F[1] * step - (o.nearLift || 0)], 5, 7);
    };
    // 馬：胴（楕円）・首・頭・耳・たてがみ・尾・4本の脚・鞍と障泥（軍の色）。画面の点で描き、体の向き u は右向きの水平。
    // o.gait は歩きのコマ（0〜3。なければ止まって立つ）、o.rear は前脚を上げる高さ、o.sink は膝をついて沈む深さ
    const horse = () => {
      // 胴は前の向き（斜め前は右下、斜め後ろは右上）へ少しだけ傾ける。地面も同じだけ傾けて、4本の脚の長さをそろえる。
      // 前の向きそのもの（傾き 0.5）まで傾けると、見た目で前脚と後脚の長さがそろわない
      const TILT = 0.22;
      const u = [1 / Math.hypot(1, TILT), (front ? TILT : -TILT) / Math.hypot(1, TILT)];
      const sink = o.sink || 0, rear = o.rear || 0, hb = o.hbob || 0;
      // 馬は HS の割合に縮めて描く（兵の絵の枠 56×48 に収める）
      const HS = 0.74;
      const c = [40, (front ? 63 : 64) - 17 * HS + sink + hb]; // 胴の真ん中
      const P = (a, b) => [c[0] + u[0] * a * HS, c[1] + u[1] * a * HS + b * HS - (a > 0 ? rear * (a / 14) : 0)];
      const GROUND = front ? 63 : 64; // 胴の真ん中の下の地面の高さ（斜め前は前脚が下がる分、1ドット上げて枠に収める）
      const g = o.gait;
      const swing = g == null ? [0, 0, 0, 0] : [[3, -3, -2, 2], [0, 0, 3, -3], [-3, 3, 2, -2], [0, 0, -3, 3]][g];
      const lift = g == null ? [0, 0, 0, 0] : [[0, 2, 0, 0], [0, 0, 0, 2], [2, 0, 0, 0], [0, 0, 2, 0]][g];
      // 脚：[胴の上の位置 a, 奥（far）か]。前脚・後脚の、手前と奥
      const LEGS = [[10, false], [10, true], [-10, false], [-10, true]];
      const legOf = (i) => {
        const [a, far] = LEGS[i];
        const top = P(a + (far ? 1 : 0), 5);
        const fa = a + swing[i];
        let foot = [c[0] + u[0] * fa * HS + (far ? 1 : -1), GROUND + u[1] * fa * HS + (far ? -1 : 0) - lift[i]];
        if (i < 2 && rear) foot = [top[0] + u[0] * 4, top[1] + 6 - rear * 0.3];
        if (sink) foot = [top[0] - u[0] * 3, Math.min(GROUND - 1, top[1] + 5)];
        const knee = [(top[0] + foot[0]) / 2 + (i < 2 ? 1 : -1) * u[0], (top[1] + foot[1]) / 2];
        const v = far ? 'O' : 'o';
        lineA(top[0], top[1], knee[0], knee[1], v, 4);
        lineA(knee[0], knee[1], foot[0], foot[1] - 1, v, 3);
        lineA(foot[0] - 1, foot[1], foot[0] + 1, foot[1], 'd', 2);
      };
      legOf(1); legOf(3); // 奥の脚
      // 尾
      const t0 = P(-15, -3), t1 = P(-19 - (o.tail || 0), 7 - sink * 0.6); // 沈んだ分だけ尾を短くする
      lineA(t0[0], t0[1], t1[0], t1[1], 'k', 3);
      // 胴
      const body = [];
      for (let k = 0; k < 28; k++) { const th = (k / 28) * Math.PI * 2; body.push(P(15 * Math.cos(th), 7.5 * Math.sin(th))); }
      polyA(body, 'o');
      // 首と頭：首は胴の前から斜め上へ、頭は鼻先へ向けて下がる
      const n0 = P(10, -2), n1 = P(17, -16), h1 = P(23, -10);
      polyA([P(8, -6), P(14, -6), [n1[0] + 3, n1[1] + 1], [n1[0] - 2, n1[1] - 1], P(5, 2)], 'o');
      lineA(n1[0], n1[1], h1[0], h1[1], 'o', 5);
      lineA(n1[0] - 1, n1[1] - 2, n1[0] - 1, n1[1] - 4, 'o', 2); // 耳
      // たてがみ（首の上の縁）
      lineA(n1[0] - 2, n1[1], n0[0] - 3, n0[1] - 4, 'k', 2);
      // 鞍と障泥：鞍は胴の上、障泥（軍の色）は脇に垂らす
      polyA([P(-5, -8), P(5, -8), P(5, -5), P(-5, -5)], 'h');
      polyA([P(-5, -5), P(5, -5), P(5, 4), P(-5, 4)], 'r');
      legOf(0); legOf(2); // 手前の脚
      // 目と鼻
      horseMarks.push([Math.round(n1[0] + u[0] * 2), Math.round(n1[1] + 1), '#120c08'], [Math.round(h1[0]), Math.round(h1[1]), '#2a1a10']);
    };
    const horseMarks = [];
    // 持ち物：it.hx, it.hy は持つ手の位置（体の座標）、ang は持ち物の向き（画面の角度）。
    // two を持てば、もう一方の手も、持ち物の向きに two だけ後ろを握る（槍・槌は柄、弓は弦を引く手）。
    // free は、持ち物を持たない手の位置（体の座標）。なければ体の脇に下ろす
    const it = o.hold;
    const hand = SP(it.hx + OX, Y(it.hy) + OY + bob);
    const dir = [Math.cos(rad(it.ang ?? 0)), Math.sin(rad(it.ang ?? 0))];
    const perp = [-dir[1], dir[0]];
    const nearSh = T(...(front ? [17, 20] : [31, 20])), farSh = T(...(front ? [31, 20] : [17, 20]));
    // 持つ手：by が near なら手前の腕、far なら奥の腕（決めなければ、斜め前は手前、斜め後ろは奥。どちらも画面の左の腕）
    const by = it.by ?? (front ? 'near' : 'far');
    const freeSh = by === 'near' ? farSh : nearSh;
    const otherHand = it.two != null
      ? [hand[0] - dir[0] * it.two * SC, hand[1] - dir[1] * it.two * SC]
      : it.free
        ? SP(it.free[0] + OX, Y(it.free[1]) + OY + bob)
        : [freeSh[0] + (!front && freeSh === farSh ? -1 : 1) * SC, freeSh[1] + 11 * SC];
    const armIK = (s, h, up, fore, w = 5) => {
      const e = joint(s[0], s[1], h[0], h[1], 8 * 0.8 * SC, 8 * 0.8 * SC, (a, b) => (a[1] > b[1] ? a : b));
      lineA(s[0], s[1], e[0], e[1], up, TW(w));
      lineA(e[0], e[1], h[0], h[1], fore, TW(w - 1));
      ellA(h[0] + 0.5, h[1] + 0.5, 2 * SC, 1.8 * SC, 's');
    };
    const along = (k) => [hand[0] + dir[0] * k * SC, hand[1] + dir[1] * k * SC];
    const item = () => {
      if (it.kind === 'spear') {
        const fwd = it.fwd ?? 26, bk = it.bk ?? 18;
        const a = along(-bk), b = along(fwd), c = along(fwd + 5);
        lineA(a[0], a[1], b[0], b[1], 'h', 1);
        lineA(b[0], b[1], c[0], c[1], 'e', 1);
        // 穂先の根元の口金
        set(Math.round(b[0]), Math.round(b[1]), 'd');
      } else if (it.kind === 'mallet') {
        // 槌：短い柄の先に、柄と直角の太い木の頭。頭の両端に黒い鉄の輪
        const fwd = it.fwd ?? 13, bk = it.bk ?? 3;
        const a = along(-bk), b = along(fwd);
        lineA(a[0], a[1], b[0], b[1], 'h', 1);
        const q = 4 * SC, t = 4;
        const h0 = [b[0] - perp[0] * q, b[1] - perp[1] * q], h1 = [b[0] + perp[0] * q, b[1] + perp[1] * q];
        lineA(h0[0], h0[1], h1[0], h1[1], 'm', t);
        mallets.push(h0, h1);
      } else if (it.kind === 'bow') {
        // 弓：和弓なので、握りから上の端（UP）は長く、下の端（DN）は短い。真ん中ほど射る向きへ反る。引くほど深く反る。
        // 弦は両端から、引く手（矢筈）へ折れる
        const UP = 17, DN = 10, pull = it.two ?? 0, bend = 1.8 + pull * 0.12;
        const mid = (UP - DN) / 2, half = (UP + DN) / 2;
        const ax = perp[1] < 0 ? perp : [-perp[0], -perp[1]]; // 上の端の向き（画面の上へ）
        const at = (s) => { const k = bend * (1 - ((s - mid) / half) ** 2); return [hand[0] + (ax[0] * s + dir[0] * k) * SC, hand[1] + (ax[1] * s + dir[1] * k) * SC]; };
        const L = UP;
        const t0 = at(DN * -1), t1 = at(UP);
        const nock = pull > 0 ? otherHand : [(t0[0] + t1[0]) / 2, (t0[1] + t1[1]) / 2];
        lineA(t0[0], t0[1], nock[0], nock[1], 'l');
        lineA(nock[0], nock[1], t1[0], t1[1], 'l');
        let p = at(-DN);
        for (let s = -DN + 1; s <= L; s += 1) { const q = at(s); lineA(p[0], p[1], q[0], q[1], 'y'); p = q; }
        if (it.arrow) {
          const tip = along(4);
          lineA(nock[0], nock[1], tip[0], tip[1], 'y');
          set(Math.round(tip[0]), Math.round(tip[1]), 'e');
        }
      } else if (it.kind === 'shield') {
        // 置盾：木の板を縦に並べた大きな盾。手は盾の裏の取っ手を持つ。軍の色の帯を横に引く
        const e = front ? [0.89, -0.45] : [0.89, 0.45]; // 盾の面の横の向き
        const wd = 14 * SC, ht = 28 * SC, up = 16 * SC;
        const c = [hand[0] + (it.dx ?? 0) * SC, hand[1] + (it.dy ?? 0) * SC];
        const P = (u, v) => [c[0] + e[0] * u, c[1] + e[1] * u - v];
        polyA([P(-wd / 2, up), P(wd / 2, up), P(wd / 2, up - ht), P(-wd / 2, up - ht)], 'h');
        polyA([P(-wd / 2, up - 5 * SC), P(wd / 2, up - 5 * SC), P(wd / 2, up - 7 * SC), P(-wd / 2, up - 7 * SC)], 'r');
        for (const u of [-wd / 6, wd / 6]) { const a = P(u, up - 1), b = P(u, up - ht + 1); shieldSeams.push([a, b]); }
      }
    };
    const shieldSeams = [];
    const mallets = []; // 槌の頭の両端（鉄の輪を描く）
    const grip = (h) => ellA(h[0] + 0.5, h[1] + 0.5, 2 * SC, 1.8 * SC, 's');
    // 胴（軍の色）・草摺・袖。胴を着ない兵は、着物に軍の色の帯を締める
    const body = () => {
      if (cfg.armor) {
        poly([[17, 17], [31, 17], [32, 38], [16, 38]], 'r');
        poly([[16, 37], [32, 37], [33, 44], [15, 44]], 'r');
        poly([[15, 36], [33, 36], [33, 38], [15, 38]], 'd');
      } else {
        poly([[17, 17], [31, 17], [32, 38], [16, 38]], 'u');
        poly([[16, 37], [32, 37], [32, 43], [16, 43]], 'u');
        poly([[16, 33], [32, 33], [32, 37], [16, 37]], 'r');
      }
      poly([[18, 15], [30, 15], [31, 18], [17, 18]], 'u');
    };
    // 背中の矢筒（弓兵）：矢羽を肩の上に出す
    const quiver = () => {
      const a = T(front ? 30 : 19, 16), b = T(front ? 34 : 15, 31);
      lineA(a[0], a[1], b[0], b[1], 'h', TW(4));
      const f = T(front ? 29 : 20, 13);
      lineA(f[0], f[1], f[0] + (front ? -1 : 1), f[1] - 2, 'c', 2);
    };
    const sode = (cx, cy) => { const [X, Yc] = T(cx, cy); const w = 2.5 * SC, u = 2.5 * SC; polyA([[X - w, Yc - u], [X + w, Yc - u], [X + w + 0.5, Yc + u], [X - w - 0.5, Yc + u + 0.5]], 'u'); };
    const bands = [];
    const bandRows = (rows, x0, x1) => { for (const y of rows) for (let x = x0; x < x1; x++) { const [X, Yr] = T(x, y).map(Math.round); if (m[Yr] && m[Yr][X] === 'r') bands.push([X, Yr]); } };
    const armorBands = (x0, x1) => { if (cfg.armor) bandRows([24, 31, 41], x0, x1); };

    // 斜め後ろで、持ち物を体の前（奥）に持つ間は、持ち物と手を体の後ろに隠す（盾はいつも体の向こう）
    const occl = !front && (!o.raised || it.kind === 'shield');
    const both = it.two != null;
    const farTo = by === 'far' ? hand : otherHand, nearTo = by === 'near' ? hand : otherHand;
    // 持ち物につながる腕（持つ手と、両手で持つときのもう一方の手）
    const nearOnItem = by === 'near' || both;
    // 衝車：屋根（軍の色の板）・柱・土台・4つの車輪と、屋根から縄で吊るした丸太（先に鉄の金具）。画面の点で描く。
    // u は前の向き、D は車の奥の側へのずれ。o.spin は車輪の輻の回り、o.ram は丸太を前（正）・後ろ（負）へ振った量、
    // o.crush は潰れた深さ（倒れ）、o.tilt は潰れて傾いた量
    const cart = () => {
      const u = [F[0] / Math.hypot(...F), F[1] / Math.hypot(...F)];
      const D = front ? [11, -5.5] : [-11, -5.5]; // 左右の幅（丸太が出入りする口の幅）
      const crush = o.crush || 0, tilt = o.tilt || 0, cb = o.cbob || 0;
      const c = [40 - (front ? 5 : -5), 60 + cb];
      const P = (a, h, far = 0) => [c[0] + u[0] * a + D[0] * far, c[1] + u[1] * a - h + D[1] * far + tilt * (a / 14)];
      const wheel = (a, far) => {
        const [x, y] = P(a, 0, far);
        const v = far ? 'O' : 'h';
        ellA(x, y + 1, 4.2, 4.2, v);
        ellA(x, y + 1, 1.3, 1.3, 'd');
        for (let k = 0; k < 3; k++) {
          const th = ((o.spin || 0) * 30 + k * 60) * Math.PI / 180;
          const dx = Math.cos(th) * 3.2, dy = Math.sin(th) * 3.2;
          cartLines.push([[x - dx, y + 1 - dy], [x + dx, y + 1 + dy]]);
        }
      };
      wheel(-9, 1); wheel(9, 1);
      const roofH = 20 - crush, eave = 12 - crush * 0.8;
      // 奥の柱と土台
      for (const a of [-12, 12]) { const p0 = P(a, 3, 1), p1 = P(a, eave, 1); lineA(p0[0], p0[1], p1[0], p1[1], 'O', 2); }
      { const p0 = P(-14, 3, 1), p1 = P(14, 3, 1); lineA(p0[0], p0[1], p1[0], p1[1], 'O', 2); }
      // 吊るした丸太と縄
      const sw = o.ram || 0;
      const l0 = P(-13 + sw, 8 - crush * 0.5, 0.5), l1 = P(15 + sw, 8 - crush * 0.5, 0.5);
      for (const a of [-6, 6]) { const r0 = P(a, roofH - 2, 0.5), r1 = P(a + sw, 9 - crush * 0.5, 0.5); lineA(r0[0], r0[1], r1[0], r1[1], 'l'); }
      lineA(l0[0], l0[1], l1[0], l1[1], 'm', 4);
      const l2 = P(18 + sw, 8 - crush * 0.5, 0.5);
      lineA(l1[0], l1[1], l2[0], l2[1], 'e', 4);
      ramTip = l2;
      // 手前の柱と土台
      for (const a of [-12, 12]) { const p0 = P(a, 3), p1 = P(a, eave); lineA(p0[0], p0[1], p1[0], p1[1], 'h', 2); }
      { const p0 = P(-14, 3), p1 = P(14, 3); lineA(p0[0], p0[1], p1[0], p1[1], 'h', 3); }
      // 屋根：棟（奥と手前の真ん中）から、手前の軒へ下る面と、奥の軒へ下る面
      const r0 = P(-16, roofH, 0.5), r1 = P(16, roofH, 0.5);
      polyA([r0, r1, P(16, eave, 1.3), P(-16, eave, 1.3)], 'R');
      polyA([r0, r1, P(17, eave - 1), P(-17, eave - 1)], 'r');
      for (const a of [-9, -2, 5, 12]) cartLines.push([P(a, roofH, 0.5), P(a + 1, eave - 1)]);
      top = [Math.round((r0[0] + r1[0]) / 2), Math.round(Math.min(r0[1], r1[1]))];
      wheel(-9, 0); wheel(9, 0);
    };
    const cartLines = [];
    let ramTip = null;
    if (cfg.cart) cart();
    else {
      legs();
      if (front) {
        if (cfg.quiver) quiver();
        armIK(farSh, farTo, 'u', 'u', 4);
        if (o.itemBehind) item();
        body();
        armorBands(16, 33);
        sode(31, 20);
        stampHead(HD.front);
        armIK(nearSh, nearTo, 'u', 'u');
        sode(17, 20);
        if (!o.itemBehind) item();
        grip(hand);
        if (both) grip(otherHand);
      } else {
        if (occl) {
          armIK(farSh, farTo, 'u', 'u', 4);
          if (nearOnItem) armIK(nearSh, nearTo, 'u', 'u');
          item();
          grip(hand);
        }
        body();
        armorBands(15, 34);
        if (cfg.quiver) quiver();
        if (!occl) armIK(farSh, farTo, 'u', 'u', 4);
        sode(17, 20);
        stampHead(HD.back);
        if (!(occl && nearOnItem)) armIK(nearSh, nearTo, 'u', 'u');
        sode(31, 20);
        if (!occl) { item(); grip(hand); if (both) grip(otherHand); }
      }
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
      if (v === 'e' || (v === 'h' && it.kind !== 'shield') || v === 'y') tone = 2;
      out[y][x] = RAMP[v][tone];
    }
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      const v = m[y][x]; if (!v || 'ksehyl'.includes(v)) continue;
      const r = x + 1 < FW ? m[y][x + 1] : '', d = y + 1 < FH ? m[y + 1][x] : '';
      if ((r && r !== v && !'hyl'.includes(r)) || (d && d !== v && !'hyl'.includes(d))) out[y][x] = RAMP[v][0];
    }
    for (const [x, y] of bands) out[y][x] = RAMP.r[0];
    for (const [x, y] of mallets.map((p) => p.map(Math.round))) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) if (m[y + dy]?.[x + dx] === 'm') out[y + dy][x + dx] = RAMP.d[1];
    // 盾の板の継ぎ目
    for (const [a, b] of shieldSeams) {
      const n = Math.ceil(Math.abs(b[1] - a[1]));
      for (let i = 0; i <= n; i++) { const x = Math.round(a[0] + ((b[0] - a[0]) * i) / n), y = Math.round(a[1] + ((b[1] - a[1]) * i) / n); if (m[y] && m[y][x] === 'h') out[y][x] = RAMP.h[0]; }
    }
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) if (sg[y][x]) out[y][x] = sg[y][x];
    for (const [x, y, c] of horseMarks) if (m[y]?.[x] === 'o') out[y][x] = c;
    // 衝車の車輪の輻と、屋根の板の継ぎ目
    for (const [a, b] of cartLines) {
      const n = Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))) || 1;
      for (let i = 0; i <= n; i++) { const x = Math.round(a[0] + ((b[0] - a[0]) * i) / n), y = Math.round(a[1] + ((b[1] - a[1]) * i) / n); const v = m[y]?.[x]; if (v === 'h' || v === 'O') out[y][x] = RAMP.d[1]; else if (v === 'r') out[y][x] = RAMP.r[0]; }
    }
    const add = [];
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      if (m[y][x]) continue;
      const ns = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([i, j]) => i >= 0 && j >= 0 && i < FW && j < FH && m[j][i]);
      if (!ns.length) continue;
      const [i, j] = ns[0], v = m[j][i];
      add.push([x, y, (y > 0 && m[y - 1][x]) || 'djuheylcoOkmR'.includes(v) ? LINE : RAMP[v][0]]);
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
    // 筋：持ち物の先（槍は穂先、弓は握り）の後ろに、動いた向きの白い線
    if (o.streak) {
      const s0 = it.kind === 'spear' ? (it.fwd ?? 26) + 5 : 2;
      const [tx, ty] = along(s0);
      for (let i = 2; i < o.streak; i++) for (const s of [-2, 2]) {
        const x = Math.round(tx - dir[0] * i - dir[1] * s), y = Math.round(ty - dir[1] * i + dir[0] * s);
        if (x >= 0 && y >= 0 && x < FW && y < FH && !out[y][x]) out[y][x] = i < o.streak / 2 ? '#ffffff' : '#cfe0ff';
      }
    }
    // 打ちつけた所の土ぼこりの輪（槌・盾）
    if (o.impact) {
      const [ix, iy] = (o.impact === 'tip' && ramTip ? ramTip : T(...o.impact)).map(Math.round);
      for (const [dx, dy] of [[-4, 0], [-3, -1], [-2, -2], [2, -2], [3, -1], [4, 0], [-1, -3], [1, -3]]) {
        const x = ix + dx, y = iy + dy; if (x >= 0 && y >= 0 && x < FW && y < FH && !out[y][x]) out[y][x] = '#fff3c4';
      }
    }
    out.top = top;
    out.hand = hand;
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
    if (g.hand) c.hand = [g.hand[0] - CX, g.hand[1] - CY];
    return c;
  };
  // 倒れ：膝をついた姿（kneel）を、足元を軸に傾けて倒す
  const fallOf = (kneel) => [kneel, rotate(kneel, -38, 40, 64, 6, 0), rotate(kneel, -84, 40, 64, 14, 2)];
  const P = cfg.poses(draw, fallOf);
  const C = (gs) => gs.map(crop);
  const view = (v) => ({
    歩き: C(P.walk(v)),
    被弾: C(P.hurt(v)),
    倒れ: C(P.fall(v)),
    待機: C(P.stance(v)),
    攻撃: P.attack(v).map((a) => ({ ...a, g: crop(a.g) })),
  });
  return { W, H, 斜め前: view('front'), 斜め後ろ: view('back') };
})();

// 前の向き（盤面の「前」）の画面の角度：斜め前は右下、斜め後ろは右上
const FWD = (f) => (f ? 27 : -27);
// 持ち物を画面の左に立てて持つ姿（待機・歩き・被弾で共通）
const walkOf = (draw, v, hold) => [
  draw(v, { lean: 2, step: 7, back: 6, bob: 1, hold: hold(1, -3) }),
  draw(v, { lean: 2, step: 0, back: -1, farLift: 3, bob: 0, hold: hold(0, -4) }),
  draw(v, { lean: 2, step: -5, back: -7, bob: 1, hold: hold(1, -3) }),
  draw(v, { lean: 2, step: 1, back: 0, nearLift: 3, bob: 0, hold: hold(0, -2) }),
];
const stanceOf = (draw, v, hold) => [
  draw(v, { lean: 1, step: 2, back: 2, bob: 1, hold: hold(0, 0) }),
  draw(v, { lean: 1, step: 2, back: 2, bob: 1, hold: hold(0, -1) }),
  draw(v, { lean: 1, step: 2, back: 2, bob: 2, hold: hold(1, -1) }),
  draw(v, { lean: 1, step: 2, back: 2, bob: 2, hold: hold(1, 0) }),
];
const hurtOf = (draw, v, hold) => {
  const f = v === 'front';
  return [
    draw(v, { lean: -5, bob: 1, step: 1, back: 3, flash: 0.55, spark: f ? [29, 24] : [30, 22], hold: hold(0, -10) }),
    draw(v, { lean: -2, bob: 2, step: 2, back: 4, hold: hold(1, -6) }),
  ];
};

// 歩兵：陣笠に槍。攻撃は構える（槍を前へ下ろす）→ 引く → 突く → 伸ばす → 戻す
const KA = mkTroop({
  head: 'jingasa',
  armor: true,
  poses: (draw, fallOf) => {
    const up = (f) => (dy = 0, da = 0) => ({ kind: 'spear', hx: 16, hy: 27 + dy, ang: (f ? -97 : -95) + da, fwd: 30, bk: 18 });
    const level = (f, hx, hy, da = 0, fwd = 24, bk = 12) => ({ kind: 'spear', hx, hy, ang: FWD(f) + da, fwd, bk, two: 7 });
    return {
      stance: (v) => stanceOf(draw, v, up(v === 'front')),
      walk: (v) => walkOf(draw, v, up(v === 'front')),
      hurt: (v) => hurtOf(draw, v, up(v === 'front')),
      fall: (v) => {
        const f = v === 'front';
        return fallOf(draw(v, { lean: 3, bob: 7, step: 3, back: 2, hold: up(f)(8, f ? -28 : -24) }));
      },
      attack: (v) => {
        const f = v === 'front';
        const r = !f; // 斜め後ろで槍を前へ向けたら、体の前に出す
        const by = f ? 0 : -6;
        return [
          { name: '構える', g: draw(v, { lean: 0, bob: 2, step: 4, back: 4, raised: r, hold: level(f, 22, 32 + by) }) },
          { name: '引く', g: draw(v, { lean: -3, bob: 3, step: 4, back: 5, raised: r, hold: level(f, 18, 32 + by, -3) }) },
          { name: '突く', g: draw(v, { lean: 6, bob: 3, step: 9, back: 5, raised: r, streak: 10, hold: level(f, 30, 30 + by, 0, 26) }) },
          { name: '伸ばす', g: draw(v, { lean: 7, bob: 4, step: 9, back: 7, raised: r, hold: level(f, 32, 30 + by, 1, 26) }) },
          { name: '戻す', g: draw(v, { lean: 3, bob: 2, step: 7, back: 5, raised: r, hold: level(f, 26, 31 + by, 0) }) },
        ];
      },
    };
  },
});

// 弓兵：陣笠に弓、背中に矢筒。攻撃はつがえる → 引き絞る → 放つ → 残身 → 下ろす
const KY = mkTroop({
  head: 'jingasa',
  armor: true,
  quiver: true,
  poses: (draw, fallOf) => {
    const up = () => (dy = 0, da = 0) => ({ kind: 'bow', hx: 15, hy: 28 + dy, ang: 180 + da }); // 竹を外（画面の左）へ向けて立てる
    // 射る：光義と同じく、弓を体から前へ突き出す。握るのは、斜め前は奥の手、斜め後ろは手前の手
    const aim = (f, pull, o = {}) => ({ kind: 'bow', hx: f ? 39 : 40, hy: f ? 23 : 16, ang: f ? 14 : -32, two: pull, by: f ? 'far' : 'near', ...o });
    return {
      stance: (v) => stanceOf(draw, v, up()),
      walk: (v) => walkOf(draw, v, up()),
      hurt: (v) => hurtOf(draw, v, up()),
      fall: (v) => fallOf(draw(v, { lean: 3, bob: 7, step: 3, back: 2, hold: up()(8, -30) })),
      attack: (v) => {
        const f = v === 'front';
        const base = { step: 4, back: 4, raised: true };
        return [
          { name: 'つがえる', g: draw(v, { ...base, bob: 2, hold: aim(f, 5, { arrow: true }) }) },
          { name: '引き絞る', g: draw(v, { ...base, bob: 2, lean: 1, hold: aim(f, 12, { arrow: true }) }) },
          { name: '放つ', g: draw(v, { ...base, bob: 2, lean: 1, streak: 7, hold: aim(f, null, { free: f ? [22, 20] : [24, 16] }) }) },
          { name: '残身', g: draw(v, { ...base, bob: 2, hold: aim(f, null, { free: f ? [18, 22] : [21, 18] }) }) },
          { name: '下ろす', g: draw(v, { ...base, bob: 1, hold: { kind: 'bow', hx: f ? 34 : 36, hy: f ? 31 : 26, ang: f ? 50 : -60, by: f ? 'far' : 'near' } }) },
        ];
      },
    };
  },
});

// 工兵：鉢巻に槌。攻撃は構える → 振りかぶる → 打ち下ろす → 打ち込む → 戻す
const KE = mkTroop({
  head: 'hachimaki',
  armor: true,
  poses: (draw, fallOf) => {
    const up = (f) => (dy = 0, da = 0) => ({ kind: 'mallet', hx: 16, hy: 30 + dy, ang: (f ? -100 : -98) + da });
    const sw = (f, hx, hy, ang) => ({ kind: 'mallet', hx, hy, ang: f ? ang : -ang, two: 3 });
    return {
      stance: (v) => stanceOf(draw, v, up(v === 'front')),
      walk: (v) => walkOf(draw, v, up(v === 'front')),
      hurt: (v) => hurtOf(draw, v, up(v === 'front')),
      fall: (v) => {
        const f = v === 'front';
        return fallOf(draw(v, { lean: 3, bob: 7, step: 3, back: 2, hold: up(f)(8, f ? -40 : -36) }));
      },
      attack: (v) => {
        const f = v === 'front';
        return [
          { name: '構える', g: draw(v, { lean: 0, bob: 2, step: 4, back: 4, raised: true, hold: sw(f, 22, 26, -60) }) },
          { name: '振りかぶる', g: draw(v, { lean: -4, bob: 1, step: 3, back: 4, raised: true, itemBehind: f, hold: sw(f, 22, 6, -150) }) },
          { name: '打ち下ろす', g: draw(v, { lean: 6, bob: 3, step: 8, back: 5, raised: true, streak: 6, hold: sw(f, 31, 30, 50) }) },
          { name: '打ち込む', g: draw(v, { lean: 7, bob: 4, step: 8, back: 6, raised: true, impact: f ? [44, 47] : [42, 36], hold: sw(f, 31, 33, 75) }) },
          { name: '戻す', g: draw(v, { lean: 3, bob: 2, step: 6, back: 5, raised: true, hold: sw(f, 26, 28, -20) }) },
        ];
      },
    };
  },
});

// 盾兵：陣笠に置盾。攻撃は構える → 引く → 押す → 押し込む → 戻す（盾で押す）
const KD = mkTroop({
  head: 'jingasa',
  armor: true,
  poses: (draw, fallOf) => {
    const hold = () => (dy = 0, da = 0) => ({ kind: 'shield', hx: 17, hy: 30 + dy, dx: -2, dy: da * 0.2 }); // 盾を画面の左に立てる
    const push = (f, k) => ({ kind: 'shield', hx: (f ? 22 : 30) + k, hy: (f ? 30 : 26) + k * (f ? 0.5 : -0.5), dx: f ? 1 : 2, dy: 0 });
    return {
      stance: (v) => stanceOf(draw, v, hold(v === 'front')),
      walk: (v) => walkOf(draw, v, hold(v === 'front')),
      hurt: (v) => hurtOf(draw, v, hold(v === 'front')),
      fall: (v) => fallOf(draw(v, { lean: 3, bob: 7, step: 3, back: 2, hold: hold(v === 'front')(6, 0) })),
      attack: (v) => {
        const f = v === 'front';
        return [
          { name: '構える', g: draw(v, { lean: 1, bob: 2, step: 4, back: 4, raised: true, hold: push(f, 0) }) },
          { name: '引く', g: draw(v, { lean: -3, bob: 3, step: 4, back: 5, raised: true, hold: push(f, -2) }) },
          { name: '押す', g: draw(v, { lean: 6, bob: 3, step: 9, back: 5, raised: true, streak: 6, hold: push(f, 5) }) },
          { name: '押し込む', g: draw(v, { lean: 7, bob: 4, step: 9, back: 7, raised: true, impact: f ? [46, 40] : [44, 28], hold: push(f, 6) }) },
          { name: '戻す', g: draw(v, { lean: 3, bob: 2, step: 7, back: 5, raised: true, hold: push(f, 2) }) },
        ];
      },
    };
  },
});

// 斥候：手ぬぐいを被った軽装（胴を着ず、軍の色の帯を締める）。持ち物はない。
// 攻撃はしない（守将を引きつける）ので、攻撃のコマは手を振って誘う：手を上げる → 振る → 振る → 振る → 下ろす
const KS = mkTroop({
  head: 'tenugui',
  poses: (draw, fallOf) => {
    const rest = (f) => (dy = 0) => ({ kind: 'none', hx: f ? 15 : 33, hy: 33 + dy });
    const wave = (f, hx, hy) => ({ kind: 'none', hx: f ? hx : 48 - hx, hy });
    return {
      stance: (v) => stanceOf(draw, v, rest(v === 'front')),
      walk: (v) => walkOf(draw, v, rest(v === 'front')),
      hurt: (v) => hurtOf(draw, v, rest(v === 'front')),
      fall: (v) => fallOf(draw(v, { lean: 3, bob: 7, step: 3, back: 2, hold: rest(v === 'front')(4) })),
      attack: (v) => {
        const f = v === 'front';
        return [
          { name: '手を上げる', g: draw(v, { lean: -1, bob: 1, step: 3, back: 3, raised: true, hold: wave(f, 14, 14) }) },
          { name: '振る', g: draw(v, { lean: -2, bob: 1, step: 3, back: 3, raised: true, hold: wave(f, 10, 8) }) },
          { name: '振る', g: draw(v, { lean: -2, bob: 0, step: 3, back: 3, raised: true, hold: wave(f, 16, 6) }) },
          { name: '振る', g: draw(v, { lean: -2, bob: 1, step: 3, back: 3, raised: true, hold: wave(f, 10, 8) }) },
          { name: '下ろす', g: draw(v, { lean: 0, bob: 1, step: 3, back: 3, raised: true, hold: wave(f, 14, 26) }) },
        ];
      },
    };
  },
});

// 騎兵：兜に槍で、馬に乗る。乗り手の作りは歩兵と同じで、脚は馬の脇へ下ろす。絵の枠はほかの兵と同じ 56×48 に収める。
// 攻撃は構える（槍を前へ下ろす）→ 引く → 突く → 伸ばす → 戻す
const KK = mkTroop({
  head: 'kabuto',
  armor: true,
  horse: true,
  frame: [56, 48, 14, 20],
  poses: (draw) => {
    // 待機と歩きは、槍を後ろへ寝かせて肩に担ぐ（立てると、兵の絵の枠 56×48 からはみ出す）
    const up = () => (dy = 0, da = 0) => ({ kind: 'spear', hx: 18, hy: 27 + dy, ang: -132 + da, fwd: 26, bk: 12 });
    // 馬の頭より先まで届くよう、前へ出して持つ
    const level = (f, hx, hy, da = 0, fwd = 28, bk = 8) => ({ kind: 'spear', hx, hy, ang: FWD(f) + da, fwd, bk, two: 7 });
    return {
      stance: (v) => [0, 1, 2, 3].map((i) => draw(v, { bob: i > 1 ? 1 : 0, hbob: i > 1 ? 1 : 0, tail: i % 2, hold: up(v === 'front')(i > 1 ? 1 : 0, i === 1 ? -1 : 0) })),
      walk: (v) => [0, 1, 2, 3].map((i) => draw(v, { gait: i, lean: 1, bob: i % 2, hbob: i % 2, tail: i % 2 ? 1 : 0, hold: up(v === 'front')(i % 2, -3) })),
      hurt: (v) => {
        const f = v === 'front';
        return [
          draw(v, { lean: -5, bob: 1, rear: 3, flash: 0.55, spark: f ? [29, 24] : [30, 22], hold: up(f)(0, -10) }),
          draw(v, { lean: -2, bob: 1, rear: 1, hold: up(f)(1, -6) }),
        ];
      },
      // 倒れ：馬が膝をついて沈み、乗り手が前へ崩れる（横へは回さない）
      fall: (v) => [
        draw(v, { lean: 3, bob: 2, sink: 2, hold: up()(2, -6) }),
        draw(v, { lean: 7, bob: 4, sink: 4, hold: up()(4, -14) }),
        draw(v, { lean: 10, bob: 6, sink: 6, hold: up()(6, -24) }),
      ],
      attack: (v) => {
        const f = v === 'front';
        const r = !f;
        const by = f ? 0 : -6;
        return [
          { name: '構える', g: draw(v, { lean: 0, raised: r, hold: level(f, 22, 30 + by) }) },
          { name: '引く', g: draw(v, { lean: -3, bob: 1, rear: 1, raised: r, hold: level(f, 18, 30 + by, -3) }) },
          { name: '突く', g: draw(v, { lean: 6, bob: 1, hbob: 1, raised: r, streak: 10, hold: level(f, 30, 28 + by, 0, 31) }) },
          { name: '伸ばす', g: draw(v, { lean: 7, bob: 1, hbob: 1, raised: r, hold: level(f, 32, 28 + by, 1, 31) }) },
          { name: '戻す', g: draw(v, { lean: 3, raised: r, hold: level(f, 26, 29 + by, 0) }) },
        ];
      },
    };
  },
});

// 衝車：屋根の付いた車に丸太を吊るす。人の形ではないので、揺れたり倒れて転がったりせず、その場で潰れる。
// 攻撃は引く（丸太を後ろへ）→ 溜める → 突く → 打ちつける → 戻す
const KR = mkTroop({
  cart: true,
  frame: [56, 48, 13, 24],
  poses: (draw) => {
    const N = { kind: 'none', hx: 0, hy: 0 };
    return {
      stance: (v) => [0, 1, 0, -1].map((k) => draw(v, { ram: k * 0.5, hold: N })),
      walk: (v) => [0, 1, 2, 3].map((i) => draw(v, { spin: i, cbob: i % 2 ? -0.5 : 0, ram: i % 2 ? -1 : 0, hold: N })),
      hurt: (v) => [draw(v, { flash: 0.55, spark: v === 'front' ? [28, 30] : [26, 30], ram: -1, hold: N }), draw(v, { ram: -0.5, hold: N })],
      fall: (v) => [draw(v, { crush: 4, tilt: 1, hold: N }), draw(v, { crush: 8, tilt: 3, hold: N }), draw(v, { crush: 12, tilt: 2, hold: N })],
      attack: (v) => [
        { name: '引く', g: draw(v, { ram: -4, hold: N }) },
        { name: '溜める', g: draw(v, { ram: -6, hold: N }) },
        { name: '突く', g: draw(v, { ram: 5, streak: 0, hold: N }) },
        { name: '打ちつける', g: draw(v, { ram: 6, impact: 'tip', hold: N }) },
        { name: '戻す', g: draw(v, { ram: 2, hold: N }) },
      ],
    };
  },
});
