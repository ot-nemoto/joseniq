// 織田信長（ふだんは槍、スキル「国士無双」で鉄砲を撃つ）3頭身・背丈38ドット。斜め前（front）と斜め後ろ（back）。謙信と同じ組み立てで、頭・色・武器を差し替える。
// 槍の描き方とふだんのコマは大島光義（mitsuyoshi.js）と同じ（busho.js の spearKit・spearPoses）。鉄砲は、ふだんは背負い、スキルの時だけ構える。common.js・busho.js と一緒に読む
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
  const GUN_BACK = 6, GUN_FORE = 17; // 鉄砲：握る手から台尻まで、握る手から銃口まで（縮める前のドット）
  // 体の作りの違い（busho.js の mkBusho）：小袖・袴は茶、すね当てに金の縁、手は黒の手甲、袖は短め
  const CFG = { leg: { thigh: 'f', far: 'n', garter: [0.15, 'g'], shoe: 'd' }, hand: [2.0, 1.8, 'n'], sode: [3, 'n'], head: { pal: HP } };
  function draw(view, o = {}) {
    const k = mkBusho(view, o, CFG);
    const { front, T, SC, TW, lineA, set, poly, line, rect, armIK, sode, stampHead, nearSh, farSh } = k;
    const sway = o.sway || 0;
    // 鉄砲と腕：hand は台を握る手（引き金の手）、farHand は銃身を支える手
    const gn = o.gun;
    let hand, dir, farHand;
    if (gn) { hand = k.at(gn.hx, gn.hy); dir = [Math.cos(rad(gn.ang)), Math.sin(rad(gn.ang))]; farHand = [hand[0] + dir[0] * 7 * SC, hand[1] + dir[1] * 7 * SC]; }
    const muzzle = () => [hand[0] + dir[0] * GUN_FORE * SC, hand[1] + dir[1] * GUN_FORE * SC];
    const gun = () => k.weapon(() => gunBody(hand, dir));
    // 鉄砲の本体：hand は握る所、dir は銃口の向き
    const gunBody = (hand, dir) => {
      const b = GUN_BACK * SC, f = GUN_FORE * SC;
      // 台尻から握りまでの木の台（太め）、握りから先は木の台の上に銃身
      lineA(hand[0] - dir[0] * b, hand[1] - dir[1] * b, hand[0], hand[1], 't', TW(3));
      lineA(hand[0], hand[1], hand[0] + dir[0] * f * 0.62, hand[1] + dir[1] * f * 0.62, 't', TW(2));
      const mx = hand[0] + dir[0] * f, my = hand[1] + dir[1] * f;
      lineA(hand[0] + dir[0] * 2 * SC, hand[1] + dir[1] * 2 * SC, mx, my, 'e', TW(2));
      // 金の帯（2か所）
      for (const kk of [0.3, 0.58]) { const x = hand[0] + dir[0] * f * kk, y = hand[1] + dir[1] * f * kk; set(Math.round(x), Math.round(y), 'g'); }
    };
    // 槍（busho.js の spearKit。光義と同じ）
    const sp = o.spear && spearKit(k, o.spear);
    // 背負った鉄砲（構えていないとき）：右の腰に台尻を置き、銃口を左の肩の上へ出して斜めに負う
    const backGun = () => {
      const butt = T(...(front ? [31, 40] : [33, 41])), up = T(...(front ? [12, 4] : [12, 5]));
      const l = Math.hypot(up[0] - butt[0], up[1] - butt[1]) || 1, d = [(up[0] - butt[0]) / l, (up[1] - butt[1]) / l];
      gunBody([butt[0] + d[0] * GUN_BACK * SC, butt[1] + d[1] * GUN_BACK * SC], d);
    };

    if (front) {
      // 赤いマント（背中の側。肩から両わきに見える）
      poly([[12, 16], [34, 16], [35 + sway * 0.5, 44], [11 + sway, 44]], 'c');
      poly([[11 + sway, 43], [35 + sway * 0.5, 43], [35 + sway * 0.5, 44.5], [11 + sway, 44.5]], 'g');
      // 鉄砲を構えていないときは背負う（マントと胴のあいだ）
      if (!gn) backGun();
      k.legs();
      // 槍：奥の腕は、握る手（奥で握るとき）か、もう一方の手
      if (sp) sp.farSide();
      if (gn) armIK(farSh, farHand, 'f', 'n', 4);
      // 黒漆の胴と草摺、白い縄の帯、金の縁
      poly([[16, 17], [32, 17], [33, 42], [15, 42]], 'n');
      poly([[16, 29.5], [32, 29.5], [32.5, 31.5], [16, 31.5]], 'w');
      poly([[15, 41.5], [33, 41.5], [33, 43.5], [15, 43.5]], 'g');
      sode(33, 21, 2.5);
      // 腰の刀（左の腰に納める）
      line(29, 31, 36, 36, 'd', 2); rect(28, 30, 2, 2, 'g');
      // 黒の立て襟
      poly([[17, 13], [31, 13], [32, 17], [29, 19], [19, 19], [16, 17]], 'n');
      stampHead(HEAD_FRONT);
      // 槍と、手前の腕：握る手（手前で握るとき）か、もう一方の手
      if (sp) sp.nearSide();
      if (gn) armIK(nearSh, hand, 'f', 'n');
      sode(15, 20, 4);
      if (gn) gun();
      // 朱の飾り（軍の色）：胸の上と袖に1段ずつ。横線が重なって縞に見えないよう、ほかの線は入れない
      k.paint([20], 16, 33, 'n', R.r[2]);
      k.paint([22], 10, 20, 'n', R.r[2]);
    } else {
      k.legs();
      // 槍を奥の手で握るときは、槍と奥の腕を体の陰に描く
      if (sp) sp.farSide();
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
      if (sp) sp.nearSide();
      k.paint([22], 9, 40, 'n', R.r[2]);
    }
    // 陰影
    const out = shade(k.m, R, { skip: 'ksy', pass: 'r', light: 'cw' });
    k.putFix(out);
    k.putHead(out);
    outline(out, k.m, R, 'dnfetC');
    // 撃った瞬間：銃口の火花（前へ長く伸ばす）
    if (o.fire && gn) {
      const [mx, my] = muzzle(), px = -dir[1], py = dir[0];
      for (let kk = 1; kk <= 6; kk++) { const c = kk < 3 ? '#ffffff' : kk < 5 ? '#ffe27a' : '#f08a2a'; dot(out, mx + dir[0] * kk, my + dir[1] * kk, c); if (kk < 5) { dot(out, mx + dir[0] * kk + px, my + dir[1] * kk + py, kk < 3 ? '#ffe27a' : '#f08a2a'); dot(out, mx + dir[0] * kk - px, my + dir[1] * kk - py, kk < 3 ? '#ffe27a' : '#f08a2a'); } }
      for (const s of [-1, 1]) for (let kk = 1; kk <= 3; kk++) dot(out, mx + dir[0] * kk * 0.6 + px * s * (kk + 1), my + dir[1] * kk * 0.6 + py * s * (kk + 1), kk < 2 ? '#ffe27a' : '#f08a2a');
      dot(out, mx, my, '#ffffff');
    }
    // 煙：銃口の先に灰色の玉を重ね、時間がたつほど大きく、上へ流す
    if (o.smoke && gn) {
      const { W, H } = k;
      // 撃った場所（狙ったときの銃口）に残す。銃を動かしても煙はついて行かない
      const sf = o.smokeFrom, sh0 = sf ? k.at(sf.hx, sf.hy) : hand, sd = sf ? [Math.cos(rad(sf.ang)), Math.sin(rad(sf.ang))] : dir;
      const mx = sh0[0] + sd[0] * GUN_FORE * SC, my = sh0[1] + sd[1] * GUN_FORE * SC;
      const [n, drift] = o.smoke;
      for (let kk = 0; kk < n; kk++) {
        const cx = mx + sd[0] * (2 + kk * 2.5), cy = my + sd[1] * (2 + kk * 2.5) - drift - kk * 1.2, r = 1.5 + kk * 0.5 + drift * 0.35;
        for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy); if (d > r) continue;
          if (x >= 0 && y >= 0 && x < W && y < H && !out[y][x]) out[y][x] = d > r - 0.8 ? '#8c8a86' : '#c9c7c2';
        }
      }
    }
    // スキルの溜め：武器（鉄砲）のまわりを光らせる
    if (o.aura) weaponAura(out, k.wm, o.aura, ['#fff0a0', '#e0b84e']);
    // 突いた槍の残像
    if (sp) sp.trail(out, o.thrust);
    k.spark(out);
    return out;
  }
  // スキル（国士無双）：構える → 狙う（溜めのあいだ狙ったまま）→ 撃つ・撃つ・撃つ（1発ごとに火花。反動で少しずつ銃口が上がり、煙が重なる）。
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
  // 待機・歩き・攻撃（槍）・被弾・倒れは光義と同じ（busho.js の spearPoses）。鉄砲は背負う
  return bushoFrames(R, (v) => ({ ...spearPoses(draw, v), スキル: skill(v) }));
})();
