// 徳川家康（軍配）3頭身・背丈38ドット。斜め前（front）と斜め後ろ（back）。昌幸と同じ組み立てで、頭・色を差し替える。
// 目印は、黒い兜の金の歯朶の前立て（2本の弧と真ん中の黒い玉）、赤い鉢巻（軍の色）、白い陣羽織と金の広い襟、紺黒の鎧、茶の袖、灰色の口ひげとあごひげ。
// 軍配は、昌幸と同じように采配して、周りの味方に傷を減らす効果を掛ける。common.js・busho.js と一緒に読む
const KI = (() => {
  // 素材の色（暗・影・地・明）
  const R = {
    n: ['#0a0e18', '#151c2c', '#222c42', '#3a4762'], // 紺黒の漆の胴・籠手・すね当て
    c: ['#8a8578', '#c4bfb2', '#ebe8de', '#fbfaf4'], // 白い陣羽織
    b: ['#6e4a1c', '#a8782c', '#d8ac46', '#f4d47a'], // 陣羽織の金の襟・縁
    o: ['#2a1a10', '#44301e', '#5e452e', '#7a5e42'], // 茶の袖
    p: ['#121828', '#1e2840', '#2e3a58', '#465476'], // 紺の袴
    g: ['#6e4a1c', '#a8782c', '#e0b84e', '#fff0a0'], // 金
    d: ['#0b0b10', '#1e1e26', '#33333f', '#5c5c74'], // 黒（鞘・軍配）
    t: ['#3a2010', '#5c3519', '#7e4c26', '#a3683a'], // 軍配の柄
    r: ['#5e1414', '#9c2a24', '#d14a38', '#f08a6a'], // 赤い鉢巻・すねの紐・軍配の日の丸（軍の色に塗り替える）
    s: ['#8a5a44', '#c98f6e', '#ecc4a0', '#fde3c8'], // 肌
    C: ['#0c0c10', '#191920', '#2a2a34', '#46465a'], // 兜（手で置いた頭の素材）
  };
  // 手で置いた頭。K 兜の縁 N 兜 M 兜の光 n 兜の影 Y 金の光 G 金 g 金の影 H 髪（白髪まじり） S 肌 s 肌の影
  // b 眉 e 白目 E 黒目 B ひげ（灰色） m 口 r 赤い鉢巻（軍の色）
  const HP = {
    K: '#0a0e18', N: '#222c42', M: '#3a4762', n: '#151c2c', Y: '#fff0a0', G: '#e0b84e', g: '#a8782c',
    H: '#4a4642', S: '#e6bb94', s: '#c08a68', b: '#2a2420', e: '#f8f4ee', E: '#1c120c', B: '#6e6a66', m: '#a04a3c',
    r: R.r[2],
  };
  // 歯朶の前立ては、2本の羽が兜の上でほぼ閉じた輪になる（下で合わさり、上の先が少し開く）。羽の外側は一つおきに抜いて葉のギザギザにし、
  // 付け根（下）は太いまま合わせる。輪の内側の下のほうに、とがった黒い鉢と、羽の付け根の黒い玉がのぞく
  const HEAD_FRONT = {
    ax: 11.5, ay: 17.5, top: 0,
    rows: [
      '.......Y.Y...G.G.......',
      '....Y.GGGG...GGGG.G....',
      '...Y.GGggg...gggGG.G...',
      '..Y.Gggg.......gggG.G..',
      '.Y.Ggg...........ggG.G.',
      '..GGgg...........ggGG..',
      '.YGGg.............gGGG.',
      '..GGg.............gGG..',
      '.GGGgg....KNK....ggGGG.',
      '..GGgg...KNMNK...ggGG..',
      '...GGgg.KNNNNNK.ggGG...',
      '....GGGggNgGgNggGGG....',
      '.....GGGGgGKGgGGGG.....',
      '......GGGggGgGGgGG.....',
      '........gGGGGGg........',
      '...KnnrrrrrrrrrrrrnK...',
      '...KnNHHHbbbSSSbbSnK...',
      '...KnNHHHSeESSSeESnK...',
      '....KnHHSSSSSSSSSsK....',
      '.....KnSSSBBBmBBBs.....',
      '......nSSSSSSSSSSs.....',
      '.......SSSSSBBBSs......',
      '.........SSSBBBS.......',
      '............BB.........',
    ],
  };
  const HEAD_BACK = {
    ax: 10, ay: 17.5, top: 0,
    rows: [
      '.......Y.Y...G.G.......',
      '....Y.GGGG...GGGG.G....',
      '...Y.GGggg...gggGG.G...',
      '..Y.Gggg.......gggG.G..',
      '.Y.Ggg...........ggG.G.',
      '..GGgg...........ggGG..',
      '.YGGg.............gGGG.',
      '..GGg.............gGG..',
      '.GGGgg....KNK....ggGGG.',
      '..GGgg...KNMNK...ggGG..',
      '...GGgg.KNNNNNK.ggGG...',
      '....GGGggNNNNNggGGG....',
      '.....GGGGgggggGGGG.....',
      '......GGGgGGGGGgGG.....',
      '........gGGGGGg........',
      '.....KNNNNNNNNNNNNNK...',
      '....KnNNNNNNNNNNNNNK...',
      '...KnggggggggggggggSK..',
      '...KnnnnnnnnnnnnnnnS...',
      '....KnnnnnnnnnnnnnK.s..',
    ],
  };
  // 体の作りの違い（busho.js の mkBusho）：袴の腿、すねに赤い紐（軍の色）、手は黒の手甲
  const CFG = { leg: { thigh: 'p', far: 'n', garter: [0.2, 'r'], shoe: 'p' }, hand: [2.0, 1.8, 'n'], sode: [3.4, 'n'], head: { pal: HP } };
  function draw(view, o = {}) {
    const k = mkBusho(view, o, CFG);
    const { front, T, poly, line, rect, sode, stampHead } = k;
    // 軍配と腕（busho.js の fanKit）
    const fk = o.fan && fanKit(k, o.fan);
    // 金の縅・鋲（体の上の横の段のうち、黒い胴のマス）
    const gold = (rows, x0, x1) => { for (const [X, Yy] of k.cells(rows, x0, x1, 'n')) k.fix.push([X, Yy, R.g[1]]); };

    let seam = false;

    if (front) {
      k.legs();
      // 奥の腕：軍配を持たない手は腰に下ろす（橙の袖）
      if (fk) fk.farSide();
      // 草摺（紺黒）・紺黒の胴・白い陣羽織と金の広い襟・腰の紐
      poly([[16, 40], [32, 40], [33, 45], [15, 45]], 'n');
      poly([[16, 17], [32, 17], [33, 41], [15, 41]], 'n');
      // 大袖は陣羽織の下（肩を陣羽織が覆い、袖の下の段だけが見える）
      sode(33, 22, 2.4);
      sode(14.5, 22, 3);
      poly([[12.5, 16.5], [21, 16.5], [20.5, 42.5], [12, 42.5]], 'c');
      poly([[28, 16.5], [35.5, 16.5], [36, 42.5], [28.5, 42.5]], 'c');
      poly([[18.5, 17], [21.5, 17], [21, 42.5], [18, 42.5]], 'b');
      poly([[27.5, 17], [30.5, 17], [31, 42.5], [28, 42.5]], 'b');
      line(12, 42.5, 36, 42.5, 'b', 1);
      poly([[21.5, 29.5], [27.5, 29.5], [28, 31.5], [21, 31.5]], 'o');
      // 腰の刀
      line(29, 32, 36, 37, 'd', 2); rect(28, 31, 2, 2, 'g');
      // 黒の立て襟
      poly([[17, 13], [31, 13], [32, 17], [29, 19], [19, 19], [16, 17]], 'n');
      stampHead(HEAD_FRONT);
      if (fk) fk.nearSide();
      gold([25.5], 8, 15);
      gold([24, 35], 21, 28);
      gold([43.5], 15, 34);
    } else {
      k.legs();
      // 奥の腕：待機は軍配を握る、攻撃は腰に下ろす
      if (fk) fk.farSide();
      // 草摺（紺黒）・白い陣羽織の背と金の縁・背の縫い目
      poly([[14, 40], [34, 40], [35, 45], [13, 45]], 'n');
      poly([[13, 17], [35, 17], [36, 43], [12, 43]], 'c');
      line(12, 43, 36, 43, 'b', 1);
      line(13, 17, 12, 43, 'b', 1);
      line(35, 17, 36, 43, 'b', 1);
      seam = true;
      // 腰の刀（左の腰から手前へ）
      line(17, 33, 6, 43, 'd', 2); rect(4, 43, 3, 2, 'g');
      sode(13, 20, 2.8); sode(34, 20, 4.2);
      gold([22, 25], 8, 18);
      gold([22, 25], 30, 41);
      gold([43.5], 13, 36);
      // 首の後ろ（錣の下）を紺黒の襟で埋める
      poly([[17, 12], [31, 12], [33, 17], [15, 17]], 'n');
      stampHead(HEAD_BACK);
      if (fk) fk.nearSide();
    }
    // 陰影
    const { m } = k;
    const out = shade(m, R, { skip: 'ksbr', pass: 'br' });
    k.putFix(out);
    // 陣羽織の背の縫い目（白い背中が平たい板に見えないよう、真ん中に薄い線を1本）
    if (seam) for (let yy = 18; yy < 42; yy++) { const [X, Yy] = T(24, yy).map(Math.round); if (m[Yy] && m[Yy][X] === 'c') out[Yy][X] = R.c[1]; }
    k.putHead(out);
    outline(out, m, R, 'dncpgtC');
    // 打った軍配の通った弧と、振り下ろした瞬間（スキルの采配）の白い筋
    if (o.swing && fk) fk.swing(out, o.swing);
    if (o.swish && fk) fk.swish(out, o.swish);
    if (o.spark) spark(out, T(...o.spark).map(Math.round));
    // スキルの溜め：武器のまわりを光らせる
    if (o.aura) weaponAura(out, k.wm, o.aura, ['#fff0a0', '#e0b84e']);
    out.top = k.top;
    return out;
  }
  // 待機・歩き・攻撃・スキル・被弾・倒れは3人とも同じ（busho.js の fanPoses）
  return bushoFrames(R, (v) => fanPoses(draw, v));
})();
