// 豊臣秀吉（刀）3頭身・背丈38ドット（後立てを除く）。斜め前（front）と斜め後ろ（back）。謙信と同じ刀の構えと動きで、頭・色・飾りを差し替える。
// 目印は、背の大きな金の放射状の後立て（馬藺の後立）、高い黒い兜、赤い鎧、紫の袖と袴、背中の赤い×の紐、跳ね上がった口ひげ。common.js・busho.js と一緒に読む
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
  // 後立て：兜の後ろから放射状に出す金の矢。本数、内と外の半径（横・縦。縮めたあとのドット）
  const HALO_N = 9, HALO_R0 = 6, HALO_RX = 19, HALO_RY = 13;
  // 体の作りの違い（busho.js の mkBusho）：袴は紫、すねに赤い紐、足は黒、手は素手、袖は赤い縅
  const CFG = { leg: { thigh: 'p', far: 'n', garter: [0.2, 'r'], shoe: 'd' }, hand: [2.1, 1.9, 's'], sode: [3.4, 'a'], head: { pal: HP } };
  function draw(view, o = {}) {
    const k = mkBusho(view, o, CFG);
    const { front, T, H, W, poly, line, rect, armIK, sode, stampHead, nearSh, farSh } = k;
    // 刀と腕（謙信と同じ）
    const sw = swordKit(k, o.sword);
    const { hand, farHand, blade } = sw;
    // 後立て：兜の後ろ（頭の上のほう）を中心に、上と左右へ金の矢を広げる。矢が重なって塊に見えないよう、縁取りのない
    // 1ドットの線にして、体を描いたあとに空いている所（体の奥）にだけ置く。根元は暗く、先は明るい金
    const haloPts = [];
    const halo = () => {
      const [cx, cy] = T(front ? 23.5 : 25.5, 3.5);
      for (let i = 0; i < HALO_N; i++) {
        const a = rad(170 + (200 * i) / (HALO_N - 1));
        const c = Math.cos(a), s = Math.sin(a);
        const n = Math.ceil(Math.max(HALO_RX, HALO_RY) * 1.5);
        for (let kk = 0; kk <= n; kk++) {
          const t = kk / n, rx = HALO_R0 + (HALO_RX - HALO_R0) * t, ry = HALO_R0 * 0.8 + (HALO_RY - HALO_R0 * 0.8) * t;
          haloPts.push([Math.round(cx + c * rx), Math.round(cy + s * ry), t > 0.85 ? R.g[3] : t > 0.3 ? R.g[2] : R.g[1]]);
        }
      }
    };
    // 縅の段（細かくしすぎないよう、暗い横線を数本だけ）と金の縁
    let xCords = false;
    const rows = (ys, x0, x1, c) => k.paint(ys, x0, x1, 'a', c);

    if (front) {
      halo();
      k.legs();
      armIK(farSh, farHand, 'f', 'n', 4);
      // 赤い胴と草摺、黒い胸板、黒い帯、草摺の金の縁
      poly([[16, 17], [32, 17], [33, 44], [15, 44]], 'a');
      poly([[17, 17], [31, 17], [31, 21], [17, 21]], 'n');
      poly([[15.5, 29.5], [32.5, 29.5], [33, 31.5], [15.5, 31.5]], 'd');
      line(15, 44, 33, 44, 'g', 1);
      sode(33, 21, 2.8);
      line(29, 32, 36, 37, 'd', 2); rect(28, 31, 2, 2, 'g');
      if (o.bladeBehind) blade();
      // 紫の襟
      poly([[17, 13], [31, 13], [32, 17], [29, 19], [19, 19], [16, 17]], 'f');
      stampHead(HEAD_FRONT);
      armIK(nearSh, hand, 'f', 'n');
      sode(15, 20, 4.2);
      if (!o.bladeBehind) blade();
      rows([24.5, 27, 35, 38.5], 15, 34, R.a[0]);
      rows([22], 15, 34, R.g[2]);
      rows([23.5], 9, 21, R.g[2]);
    } else {
      halo();
      k.legs();
      // 手が体の前にある間は、両腕と刀の根元が背中に隠れる
      const occl = !o.raised;
      armIK(farSh, farHand, 'f', 'n', 4);
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
      if (!occl) { armIK(nearSh, hand, 'f', 'n'); blade(); }
      rows([24.5, 35, 38.5], 13, 36, R.a[0]);
      rows([23.5], 8, 41, R.g[2]);
    }
    // 陰影
    const { m } = k;
    const out = shade(m, R, { skip: 'ksegr', pass: 'rg', adjust: (v, tone, x, y, same) => (v === 'e' ? (!same(x, y - 1, v) ? 3 : 2) : tone) });
    k.putFix(out);
    // 背中の×の紐は、赤い鎧の上でも見えるよう明るい赤にする
    if (xCords) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y][x] === 'r' && y < 50) out[y][x] = R.r[3];
    k.putHead(out);
    outline(out, m, R, 'dnfpeaC');
    for (const [x, y, c] of haloPts) if (x >= 0 && y >= 0 && x < W && y < H && !out[y][x]) out[y][x] = c;
    k.spark(out);
    // スキルの溜め：刀のまわりを金に光らせる（謙信と同じ作り。色は後立ての金）
    if (o.aura) weaponAura(out, k.wm, o.aura, [R.g[3], R.g[2]]);
    // 諸行無常：地に突き立てた刀の切っ先から、地面に金の輪（平たい楕円）を広げる。quake は輪の横の半径（ドット）
    if (o.quake) {
      const tx = sw.tip[0], ty = Math.min(H - 5, sw.tip[1]);
      const rx = o.quake, ry = o.quake * 0.36;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (out[y][x]) continue;
        const d = Math.hypot((x + 0.5 - tx) / rx, (y + 0.5 - ty) / ry);
        if (Math.abs(d - 1) < 1.1 / ry) out[y][x] = (x + y) % 2 ? R.g[3] : R.g[2];
        else if (o.quake > 8 && Math.abs(d - 0.6) < 0.8 / ry && (x + y) % 2) out[y][x] = R.g[2];
      }
    }
    // 斬撃の軌跡：手前の肩を中心に、刀の通った弧（謙信と同じ）
    if (o.arc) sw.arc(out, o.arc, nearSh);
    out.top = k.top;
    return out;
  }
  // スキル（諸行無常）：刀を胸の前に立てて構える → 頭の上へ高く掲げる（溜めのあいだ、刀が金に光る）→ 前の地面に切っ先から
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
  // 待機・歩き・攻撃・被弾・倒れは謙信と同じ（busho.js の swordPoses）
  return bushoFrames(R, (v) => ({ ...swordPoses(draw, v), スキル: skill(v) }));
})();
