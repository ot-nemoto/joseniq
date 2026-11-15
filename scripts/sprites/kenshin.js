// 上杉謙信（刀）3頭身・背丈38ドット。斜め前（front）と斜め後ろ（back）。体の組み立ては busho.js の mkBusho、構えと動きは swordPoses（秀吉と同じ）で、頭は38ドット用に手で置いた絵（HEAD_FRONT・HEAD_BACK）。common.js・busho.js と一緒に読む
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
  // 体の作りの違い（busho.js の mkBusho）：腿と奥のすねは紺の布、すねの真ん中に赤い紐、足は黒い足袋、手は素手、袖は短め。
  // 頭は、金の前立てを金の素材、ほかを頭巾の素材にする
  const CFG = {
    leg: { thigh: 'f', far: 'f', garter: [0.5, 'r'], shoe: 'd' },
    hand: [2.1, 1.9, 's'],
    sode: [3, 'n'],
    sparkDiag: true, // 斬られた所の火花は斜めにも散らす
    head: { pal: HEAD_PAL, mat: (ch) => (ch === 'S' || ch === 's' ? 's' : ch === 'G' || ch === 'g' || ch === 'Y' ? 'g' : 'C') },
  };
  function draw(view, o = {}) {
    const k = mkBusho(view, o, CFG);
    const { front, T, SC, H, W, poly, line, rect, armIK, sode, stampHead, nearSh, farSh } = k;
    const sway = o.sway || 0;
    // 刀と腕
    const sw = swordKit(k, o.sword);
    const { hand, farHand, blade } = sw;

    if (front) {
      k.legs();
      poly([[14, 14], [18, 14], [17 - sway, 30], [12 - sway, 29]], 'C');
      armIK(farSh, farHand, 'f', 'f', 4);
      poly([[15, 17], [33, 17], [34, 42], [13, 42]], 'c');
      poly([[23, 18], [29, 18], [29, 33], [23, 33]], 'n');
      poly([[23, 33], [29, 33], [30, 41], [22, 41]], 'n');
      poly([[21, 17], [23, 17], [22, 42], [20, 42]], 'g');
      poly([[29, 17], [30, 17], [31, 42], [30, 42]], 'g');
      poly([[13, 41], [34, 41], [34, 44], [13, 44]], 'g');
      sode(33, 21, 2.5);
      if (o.bladeBehind) blade();
      poly([[16, 12], [32, 12], [33, 16], [29, 19], [19, 19], [15, 16]], 'C');
      stampHead(HEAD_FRONT);
      armIK(nearSh, hand, 'f', 'n'); sode(15, 20, 4);
      if (!o.bladeBehind) blade();
      // 縅は2段、袖は1段にする（細かすぎる段を減らす）
      k.paint([24, 33], 23, 30, 'n', RAMP.r[2]);
      k.paint([20], 10, 20, 'n', RAMP.r[2]);
    } else {
      k.legs();
      // 手が体の前にある間（左肩の前で構えるときも）は、両腕と刀の根元が背中に隠れる
      const occl = !o.raised;
      armIK(farSh, farHand, 'f', 'f', 4);
      if (occl) { armIK(nearSh, hand, 'f', 'n'); blade(); }
      // 陣羽織の背と、裾の金と角の飾り
      poly([[14, 17], [34, 17], [35, 42], [12, 42]], 'c');
      poly([[12, 41], [35, 41], [35, 44], [12, 44]], 'g');
      // 鞘（左の腰から手前へ）
      line(17, 33, 6, 43, 'd', 2); rect(4, 43, 3, 2, 'g');
      sode(13, 20, 2.5); sode(34, 20, 4);
      // 頭巾（後ろ）・頬の端・前立て・結び目と垂れ
      poly([[16, 12], [32, 12], [33, 16], [30, 18], [18, 18], [15, 16]], 'C');
      stampHead(HEAD_BACK);
      poly([[17, 13], [20, 13], [19 - sway, 30], [16 - sway, 29]], 'C');
      poly([[21, 13], [24, 13], [23 - sway, 27], [21 - sway, 26]], 'C');
      k.ell(20.5, 12.5, 3, 2.2, 'C');
      if (!occl) { armIK(nearSh, hand, 'f', 'n'); blade(); }
      k.paint([20], 9, 40, 'n', RAMP.r[2]);
    }
    // 陰影（頭巾（C）は陣羽織との境目をはっきりさせるため、一番暗い色にする。刃は上の端だけ明るくする）
    const out = shade(k.m, RAMP, { skip: 'kse', pass: 'r', light: 'c', adjust: (v, tone, x, y, same) => (v === 'e' ? (!same(x, y - 1, v) ? 3 : 2) : tone) });
    k.putFix(out);
    k.putHead(out);
    outline(out, k.m, RAMP, 'dnfe');
    // 斬られた所に火花を散らす
    k.spark(out);
    // スキルの溜め：武器のまわりを光らせる
    if (o.aura) weaponAura(out, k.wm, o.aura, ['#ffd2c8', '#ff9a7a']);
    // 斬撃の軌跡：手前の肩を中心に、刀の通った弧
    if (o.arc) sw.arc(out, o.arc, nearSh);
    // 横に払う軌跡（一騎当千）：胸の下の高さで、体のまわりの平たい楕円の弧。色は通常攻撃の弧より赤みを帯びさせる。sweep は [始めの角度, 終わりの角度, 太さ, 逆向き]。
    // 角度は楕円の上の角度（0 は右、90 は手前、180 は左、270 は奥）で、逆向きなら始めの角度の側を太くする（刀の今いる側）。
    // 派手に見せるため、太い帯の外側に細い光の線を重ね、帯に沿って光の粒を散らす。
    // ghost は、それまでに通った残りの弧を細い点線で残す（1 なら弧の外を一周、刀の通った名残）
    if (o.sweep || o.ghost) {
      const [a0, a1, wid0, rev] = o.sweep ?? [0, 0, 0, false], wid = wid0 * SC, FLAT = 0.38;
      const [cx, cy] = T(24, 27);
      const tip = sw.tip;
      const rx = Math.hypot(tip[0] - cx, (tip[1] - cy) / FLAT);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (out[y][x]) continue;
        const u = x + 0.5 - cx, v = (y + 0.5 - cy) / FLAT;
        let a = (Math.atan2(v, u) * 180) / Math.PI;
        while (a < a0) a += 360;
        const d = rx - Math.hypot(u, v);
        const inSweep = o.sweep && a <= a1;
        if (inSweep) {
          let kk = (a - a0) / (a1 - a0);
          if (rev) kk = 1 - kk;
          if (d >= 0 && d < wid * kk + 0.6) out[y][x] = d < 1.2 ? '#ffffff' : kk > 0.55 ? '#ff9a7a' : '#ffd2c8';
          // 外側の細い光の線（帯の太い側だけ）
          else if (kk > 0.35 && d < -1 && d > -2.2) out[y][x] = '#ffb8a0';
          // 帯の内側に散る光の粒
          else if (kk > 0.3 && d > wid * kk + 1.2 && d < wid * kk + 3 && (x * 7 + y * 13) % 11 === 0) out[y][x] = '#ffffff';
        } else if (o.ghost && d >= 0 && d < 1.2 && (x + y) % 2 === 0) out[y][x] = '#ffc4b4';
      }
    }
    return out;
  }
  // スキル（一騎当千）：刀を胸の下の高さで後ろへ水平に引いて構える → 体をひねって溜める → 手前を通って横に払う →
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
  return bushoFrames(undefined, (v) => ({ ...swordPoses(draw, v), スキル: skill(v) }));
})();
