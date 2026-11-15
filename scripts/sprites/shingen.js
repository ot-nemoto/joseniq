// 武田信玄（軍配）3頭身・背丈38ドット（白熊の毛と鍬形を除く）。斜め前（front）と斜め後ろ（back）。家康と同じ組み立てで、ふだんは軍配で打ち、スキルで軍配を掲げて騎兵を呼ぶ。
// 目印は、兜から肩と背中へ垂れる大きな白い毛（白熊）、金の鍬形と赤い丸の武田菱、赤い陣羽織と金の広い襟、黒い鎧、黒い口ひげと豊かなあごひげ。
// common.js・busho.js と一緒に読む
const KT = (() => {
  // 素材の色（暗・影・地・明）
  const R = {
    n: ['#0c0c10', '#191920', '#2a2a34', '#46465a'], // 黒漆の胴・籠手・すね当て
    c: ['#4e0e0a', '#82180f', '#b42a1a', '#d84a30'], // 赤い陣羽織
    h: ['#8f8c84', '#c4c1b8', '#e9e7e0', '#ffffff'], // 白熊の白い毛
    b: ['#6e4a1c', '#a8782c', '#d8ac46', '#f4d47a'], // 陣羽織の金の襟・縁
    o: ['#100e14', '#1e1a26', '#2e2838', '#463e52'], // 黒い錦の袖
    p: ['#100e14', '#1c1822', '#2a2432', '#403848'], // 黒い袴
    g: ['#6e4a1c', '#a8782c', '#e0b84e', '#fff0a0'], // 金
    d: ['#0b0b10', '#1e1e26', '#33333f', '#5c5c74'], // 黒（鞘・軍配）
    t: ['#3a2010', '#5c3519', '#7e4c26', '#a3683a'], // 軍配の柄
    r: ['#5e1414', '#9c2a24', '#d14a38', '#f08a6a'], // すねの紐・軍配の日の丸・胴の縅（軍の色に塗り替える）
    s: ['#8a5a44', '#c98f6e', '#ecc4a0', '#fde3c8'], // 肌
    C: ['#0c0c10', '#191920', '#2a2a34', '#46465a'], // 兜（手で置いた頭の素材）
  };
  // 手で置いた頭。K 兜の縁 N 兜 Y 金の光 G 金 g 金の影 W 白熊の毛 w 毛の影 r 赤い丸（前立ての台） H 髪 S 肌 s 肌の影
  // b 眉 e 白目 E 黒目 B ひげ m 口。白熊の毛は兜を覆って顔の両わきから肩へ垂れ、ふちはギザギザにする。前立ての赤い丸の真ん中の黒い点は武田菱
  const HP = {
    K: '#0c0c10', N: '#2a2a34', Y: '#fff0a0', G: '#e0b84e', g: '#a8782c', W: '#eeece4', w: '#c4c1b8', r: '#c2361f',
    H: '#1a1410', S: '#d9a77c', s: '#b67c58', b: '#1a1410', e: '#f8f4ee', E: '#1c120c', B: '#4a3426', m: '#a04a3c',
  };
  const HEAD_FRONT = {
    ax: 10, ay: 10.5, top: 1,
    rows: [
      'YGGg.............gGGY',
      '.GGGg.W.WWW.W...gGGG.',
      '...gGGWWWWWWWWWGGg...',
      '..wwWgGGWWWWWGGgW....',
      '.wwwWWgGGrrrGGgWWW...',
      '..wwWWWWrrKrrWWWWWW..',
      '.wwwWWWWGrrrGWWWWWWW.',
      'wwwwWKNNNNNNNNNKWWW..',
      'wwwwKHHSSSSSSSSHKWWW.',
      'wwwwKHbbbSSSbbbHKWW..',
      '.wwwKSSeESSSeESSKWW..',
      '..wwKSSSSSSSSSsKWWW..',
      '..wwKSBBBBmBBBBsWW...',
      '..wwwBSSSSSSSSBww....',
      '...wwBBSSSSSSBBww....',
      '....w.BBBBBBBB.ww....',
      '...ww...BBBB...w.....',
      '....w....BB....w.....',
    ],
  };
  const HEAD_BACK = {
    ax: 9, ay: 10.5, top: 1,
    rows: [
      'YGGg.............gGGY',
      '.GGGg.W.WWWWW.W.gGGG.',
      '...gGGWWWWWWWWWGGg...',
      '....WgGGWWWWWGGgW....',
      '...wWWgGWWWWWGgWWW...',
      '..wwWWWWWWWWWWWWWWW..',
      '.wwwWWWWWWWWWWWWWWWW.',
      '..wwWWWWWWWWWWWWWWW..',
      '.wwwWWWWWWWWWWWWWWWW.',
      '.wwwWWWWWWWWWWWWWWWW.',
      '.wwwWWWWWWWWWWWWWWWW.',
      '..wwWWWWWWWWWWWWWWW..',
      '...wWWWWWWWWWWWWWW...',
      '...wwwwwwwwwwwwwww...',
      '...wwwwwwwwwwwwwww...',
      '....wwwwwwwwwwwww....',
      '.....wwwwwwwwwww.....',
      '....wwwwwwwwwwwww....',
    ],
  };
  const CFG = fanCfg(HP); // 体の作りは軍配の3人で同じ（busho.js）
  function draw(view, o = {}) {
    const k = mkBusho(view, o, CFG);
    const { front, poly, line, rect, sode, stampHead } = k;
    // 軍配と腕（busho.js の fanKit）
    const fk = o.fan && fanKit(k, o.fan);
    // 金の縅・鋲（体の上の横の段のうち、黒い胴のマス）
    const gold = (rows, x0, x1) => k.paint(rows, x0, x1, 'n', R.g[1]);

    if (front) {
      k.legs();
      // 奥の腕：軍配を持たない手は腰に下ろす（黒い錦の袖）
      if (fk) fk.farSide();
      // 草摺（黒）・黒い胴・赤い陣羽織と金の広い襟・腰の紐
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
      // 黒の立て襟と、肩へ垂れる白熊の毛
      poly([[17, 13], [31, 13], [32, 17], [29, 19], [19, 19], [16, 17]], 'n');
      poly([[11, 12], [19, 12], [18.5, 21], [12, 23.5]], 'h');
      poly([[29, 12], [37, 12], [36.5, 23.5], [30, 21]], 'h');
      stampHead(HEAD_FRONT);
      if (fk) fk.nearSide();
      gold([25.5], 8, 15);
      gold([24, 35], 21, 28);
      gold([43.5], 15, 34);
    } else {
      k.legs();
      // 奥の腕：待機は軍配を握る、攻撃は腰に下ろす
      if (fk) fk.farSide();
      // 草摺（黒）・赤い陣羽織の背と金の縁
      poly([[14, 40], [34, 40], [35, 45], [13, 45]], 'n');
      poly([[13, 17], [35, 17], [36, 43], [12, 43]], 'c');
      line(12, 43, 36, 43, 'b', 1);
      line(13, 17, 12, 43, 'b', 1);
      line(35, 17, 36, 43, 'b', 1);
      // 腰の刀（左の腰から手前へ）
      line(17, 33, 6, 43, 'd', 2); rect(4, 43, 3, 2, 'g');
      sode(13, 20, 2.8); sode(34, 20, 4.2);
      gold([22, 25], 8, 18);
      gold([22, 25], 30, 41);
      gold([43.5], 13, 36);
      // 背中へV字に垂れる白熊の毛（肩から腰の上まで）
      poly([[12, 12], [36, 12], [35.5, 21], [24.5, 37], [12.5, 21]], 'h');
      stampHead(HEAD_BACK);
      if (fk) fk.nearSide();
    }
    // 白熊の毛（体の部分）のふちは、外側の点を一つおきに抜いてギザギザにする
    const { m, W, H } = k;
    const furEdge = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (m[y][x] !== 'h' || (x + y) % 2) continue;
      const nb = [[x - 1, y], [x + 1, y], [x, y + 1]].some(([i, j]) => i < 0 || j >= H || i >= W || !m[j][i]);
      if (nb) furEdge.push([x, y]);
    }
    for (const [x, y] of furEdge) m[y][x] = '';
    // 仕上げ（busho.js の fanFinish）。スキルの溜めは、軍配のまわりを白熊の毛の白に光らせる（家康の金・昌幸の赤みと見分けるため）
    return fanFinish(k, fk, o, R, [R.h[3], R.h[2]]);
  }
  // 待機・歩き・攻撃・スキル・被弾・倒れは3人とも同じ（busho.js の fanPoses）
  return bushoFrames(R, (v) => fanPoses(draw, v));
})();
