// 大島光義（ふだんは槍、スキルで弓）3頭身・背丈38ドット。斜め前（front）と斜め後ろ（back）。謙信・信長と同じ組み立てで、頭・色・武器を差し替える。
// 目印は、金の鍬形の兜、長い白髪と白いひげ、緑の鎧、背中の矢筒。common.js・busho.js と一緒に読む
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
  // 弓：握りから上の端まで、下の端まで（握りは真ん中より下。縮める前のドット）、反りの深さ、矢の長さ
  const BOW_UP = 25, BOW_DN = 14, BOW_BEND = 2.4, ARROW = 19;
  // 体の作りの違い（busho.js の mkBusho）：小袖・袴は緑、すね当てに金の縁、足は緑、手は緑の手甲
  const CFG = { leg: { thigh: 'f', far: 'n', garter: [0.15, 'g'], shoe: 'n' }, hand: [2.0, 1.8, 'n'], sode: [3.4, 'n'], head: { pal: HP } };
  function draw(view, o = {}) {
    const k = mkBusho(view, o, CFG);
    const { front, T, SC, TW, lineA, set, fix, poly, line, rect, armIK, sode, stampHead, nearSh, farSh } = k;
    const sway = o.sway || 0;
    // 弓と腕：bow.hx・hy は握る手、ang は矢を向ける向き（弓は、その向きに直角に立つ）、pull は弦を引いた長さ、
    // grip は握る手が手前（near）か奥（far）か。弦を引く手は、もう一方の手。引いていないときは rest の所に下ろす
    const bw = o.bow;
    let grip, dir, axis, nock;
    if (bw) {
      grip = k.at(bw.hx, bw.hy);
      dir = [Math.cos(rad(bw.ang)), Math.sin(rad(bw.ang))];
      axis = [dir[1], -dir[0]]; // 上の端の向き
      nock = [grip[0] - dir[0] * (bw.pull || 0) * SC, grip[1] - dir[1] * (bw.pull || 0) * SC];
    }
    // 槍（busho.js の spearKit。信長と同じ。柄は弓と同じ竹の色）
    const sp = o.spear && spearKit(k, o.spear);
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
    const bowTip = (s) => {
      // 弓の上の端（s = BOW_UP）から下の端（s = -BOW_DN）まで。真ん中ほど矢の向きへ反らせる。引くほど深く反る
      const mid = (BOW_UP - BOW_DN) / 2, half = (BOW_UP + BOW_DN) / 2, bend = BOW_BEND + (bw.pull || 0) * 0.12;
      const kk = bend * (1 - ((s - mid) / half) ** 2);
      return [grip[0] + (axis[0] * s + dir[0] * kk) * SC, grip[1] + (axis[1] * s + dir[1] * kk) * SC];
    };
    const bow = () => k.weapon(() => {
      const t0 = bowTip(BOW_UP), t1 = bowTip(-BOW_DN);
      // 弦：引いているときは、矢筈（弦を引く手）の所で折れる
      if (bw.pull) { lineA(t0[0], t0[1], nock[0], nock[1], 'l'); lineA(nock[0], nock[1], t1[0], t1[1], 'l'); }
      else lineA(t0[0], t0[1], t1[0], t1[1], 'l');
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
        for (const kk of [1, 2]) { const fx = a0[0] + dir[0] * kk * SC * 1.6, fy = a0[1] + dir[1] * kk * SC * 1.6; fix.push([Math.round(fx - axis[0]), Math.round(fy - axis[1]), '#ffffff'], [Math.round(fx + axis[0]), Math.round(fy + axis[1]), '#ffffff']); set(Math.round(fx - axis[0]), Math.round(fy - axis[1]), 'y'); set(Math.round(fx + axis[0]), Math.round(fy + axis[1]), 'y'); }
      }
    });
    // 弦を引く（または下ろした）手
    const drawHand = () => (bw.pull ? nock : bw.rest ? T(...bw.rest) : null);
    const gripFar = bw && bw.grip === 'far', gripNear = bw && bw.grip !== 'far';

    if (front) {
      // 背中に垂れる白髪（頭の後ろ＝画面の左から、肩の後ろへ）
      poly([[13, 12], [18, 12], [17 - sway * 0.5, 27], [12 - sway, 26]], 'h');
      if (!bw) backBow();
      k.legs();
      // 槍：奥の腕は、握る手（奥で握るとき）か、もう一方の手
      if (sp) sp.farSide();
      // 奥の腕：弓を握る（攻撃）か、弦を引かずに下ろす
      if (bw && gripFar && !o.farFront) armIK(farSh, grip, 'f', 'n', 4);
      else if (bw && !gripFar && drawHand()) armIK(farSh, drawHand(), 'f', 'n', 4);
      // 緑の胴と草摺、白い帯、金の縁
      poly([[16, 17], [32, 17], [33, 42], [15, 42]], 'n');
      poly([[16, 29.5], [32, 29.5], [32.5, 31.5], [16, 31.5]], 'w');
      sode(33, 21, 2.8);
      // 腰の刀（左の腰に納める）
      line(29, 32, 36, 37, 'd', 2); rect(28, 31, 2, 2, 'g');
      // 緑の立て襟
      poly([[17, 13], [31, 13], [32, 17], [29, 19], [19, 19], [16, 17]], 'n');
      stampHead(HEAD_FRONT);
      if (bw && gripFar && o.farFront) armIK(farSh, grip, 'f', 'n', 4);
      if (bw) bow();
      // 槍と、手前の腕：握る手（手前で握るとき）か、もう一方の手
      if (sp) sp.nearSide();
      // 手前の腕：弓を握る（待機）か、弦を引く（攻撃）
      if (bw && gripNear) armIK(nearSh, grip, 'f', 'n');
      else if (bw && drawHand()) armIK(nearSh, drawHand(), 'f', 'n');
      sode(15, 20, 4.2);
      // 金の縅を胴に1段、朱の縁（軍の色）を草摺と袖の裾に1段ずつ。重なる所は金にするため、金をあとに塗る
      k.paint([41], 15, 34, 'n', R.r[2]);
      k.paint([23.5], 9, 21, 'n', R.r[2]);
      k.paint([23], 17, 32, 'n', R.g[1]);
    } else {
      k.legs();
      // 槍を奥の手で握るときは、槍と奥の腕を体の陰に描く
      if (sp) sp.farSide();
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
      if (sp) sp.nearSide();
      k.paint([23.5], 9, 40, 'n', R.r[2]);
      k.paint([41], 13, 36, 'n', R.r[2]);
    }
    // 陰影
    const out = shade(k.m, R, { skip: 'ksly', pass: 'r', light: 'wh' });
    k.putFix(out);
    k.putHead(out);
    outline(out, k.m, R, 'dnfqyClC');
    // 放った瞬間：弦の震え（弦の真ん中から前へ、白い短い筋）
    if (o.twang && bw) {
      const mx = (bowTip(BOW_UP)[0] + bowTip(-BOW_DN)[0]) / 2, my = (bowTip(BOW_UP)[1] + bowTip(-BOW_DN)[1]) / 2;
      for (const s of [-1, 1]) for (let kk = 1; kk <= 3; kk++) dot(out, mx - dir[0] * 0.5 + axis[0] * s * (kk + 1), my - dir[1] * 0.5 + axis[1] * s * (kk + 1), kk < 3 ? '#ffffff' : '#c9c7c2');
    }
    k.spark(out);
    // スキルの溜め：武器のまわりを光らせる
    if (o.aura) weaponAura(out, k.wm, o.aura, ['#fff0a0', '#e0b84e']);
    // 突いた槍の残像
    if (sp) sp.trail(out, o.thrust);
    out.top = k.top;
    return out;
  }
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
  // 待機・歩き・攻撃（槍）・被弾・倒れは信長と同じ（busho.js の spearPoses）。弓は背負う
  return bushoFrames(R, (v) => ({ ...spearPoses(draw, v), スキル: skill(v) }));
})();
