// ドット絵の武将（試作）：1ドットずつ色の記号で描き、小さな裏画像にして使い回す。
// 拡大はぼかさずに行うので、ドットのまま大きくなる。輪郭は自動で付ける。
// 絵は右向きで描き、左向きは貼るときに反転する
import type { GeneralKind } from '../sim';

export const SPR_W = 28; // 1コマの幅（ドット）
export const SPR_H = 28; // 1コマの高さ。最下段が足元
export const SPR_CX = 12; // 体の中心の列（反転の軸）
export const SPR_UNIT = 24; // 1マスに対するドットの数の目安（ドットの大きさを決める）
export const FLAG_W = 11;
export const FLAG_H = 20;

export type Frame = 'walk0' | 'walk1' | 'walk2' | 'walk3' | 'atk0' | 'atk1' | 'atk2' | 'down0' | 'down1';

// 色の記号。A と a は軍の色（a はその影）
const COLORS: Record<string, string> = {
  K: '#1c1a18', // 輪郭・目
  W: '#f4f0e4', // 白（頭巾・白熊）
  w: '#c9c1ad', // 白の影
  S: '#ecc9a0', // 肌
  s: '#c99f78', // 肌の影
  G: '#e0b84e', // 金
  H: '#3a3f4c', // 袴
  h: '#262a33', // 袴の影
  F: '#2a2420', // 足・蹄
  B: '#e6edf4', // 刀身
  b: '#7d8896', // 刀身の影（下側）
  T: '#5b3a1e', // 柄・槍の柄
  P: '#4a3a28', // 幟の竿
  D: '#2b2d33', // 兜の鉢・鉄砲
  I: '#c9d0d8', // 銀（鯰尾・穂先）
  i: '#8f99a5', // 銀の影
  N: '#2f3442', // 忍び装束
  n: '#1e222c', // 忍び装束の影
  M: '#8a5a34', // 馬
  m: '#5e3b20', // 馬の影
  R: '#2a1d14', // たてがみ・尾
  C: '#7a4a22', // 弓・銃床
  c: '#efe6cc', // 弦
  O: '#f08a2a', // 火花
  Y: '#ffe27a', // 火花の芯
  g: '#bdbcb4', // 煙
};
// 輪郭を付けないドット：輪郭そのもの・細い刀身・弦・火花・煙
const NO_OUTLINE = new Set(['K', 'B', 'b', 'c', 'O', 'Y', 'g']);

type Head = 'zukin' | 'hood' | 'bowl' | 'namazu' | 'eboshi';
type Crest = 'kuwagata' | 'sun' | 'shida' | 'short' | 'dot' | 'none';
type Weapon = 'sword' | 'spear' | 'kama' | 'bow' | 'gun' | 'fan' | 'star';
interface Spec {
  head: Head;
  crest: Crest;
  weapon: Weapon;
  shaguma?: boolean; // 兜の後ろに白熊
  ninja?: boolean; // 鎧ではなく忍び装束
  horse?: boolean; // 馬に乗る
  mon: string; // 幟の家紋（MON_PIX の名前）
}
const SPECS: Record<GeneralKind, Spec> = {
  brave: { head: 'zukin', crest: 'none', weapon: 'sword', mon: 'bi' }, // 上杉謙信
  archer: { head: 'bowl', crest: 'sun', weapon: 'bow', mon: 'chigaiya' }, // 大島光義
  sage: { head: 'bowl', crest: 'dot', weapon: 'fan', mon: 'rokumon' }, // 真田昌幸
  spear: { head: 'namazu', crest: 'none', weapon: 'spear', mon: 'umebachi' }, // 前田利家
  rider: { head: 'bowl', crest: 'short', weapon: 'spear', shaguma: true, horse: true, mon: 'hishi' }, // 武田信玄
  gunner: { head: 'bowl', crest: 'kuwagata', weapon: 'gun', mon: 'mokko' }, // 織田信長
  builder: { head: 'eboshi', crest: 'none', weapon: 'kama', mon: 'janome' }, // 加藤清正（片鎌槍）
  ninja: { head: 'hood', crest: 'none', weapon: 'star', ninja: true, mon: 'shuriken' }, // 服部半蔵
  guard: { head: 'bowl', crest: 'shida', weapon: 'sword', mon: 'aoi' }, // 徳川家康
};
// 斬撃の弧を重ねる武将（刀で斬る者）
export const swingsBlade = (k: GeneralKind) => SPECS[k].weapon === 'sword';

type Grid = string[][];
const blank = (w: number, h: number): Grid => Array.from({ length: h }, () => Array<string>(w).fill(''));

// clip は、絵の枠の外に描こうとしたドットの数を数える（テストではみ出しを見つけるため）
function painter(g: Grid, clip = { n: 0 }) {
  const h = g.length;
  const w = g[0].length;
  const set = (x: number, y: number, c: string) => {
    if (x >= 0 && y >= 0 && x < w && y < h) g[y][x] = c;
    else clip.n++;
  };
  const rect = (x: number, y: number, rw: number, rh: number, c: string) => {
    for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) set(x + i, y + j, c);
  };
  // ブレゼンハムの直線
  const line = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      set(x0, y0, c);
      if (x0 === x1 && y0 === y1) return;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  };
  // 刀身：影の線を1ドット下に重ねて、2ドットの太さにする（輪郭は付けない）
  const blade = (x0: number, y0: number, x1: number, y1: number) => {
    line(x0, y0 + 1, x1, y1 + 1, 'b');
    line(x0, y0, x1, y1, 'B');
  };
  // 文字の並びで小さな模様を置く（記号以外は空き）
  const stamp = (x: number, y: number, rows: string[]) =>
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) if (row[i] !== '.') set(x + i, y + j, row[i]);
    });
  return { set, rect, line, blade, stamp };
}
type Pen = ReturnType<typeof painter>;

// ---- 頭 -----------------------------------------------------------------
// 頭の輪郭（ox+6 からの横の範囲）。10段
const HEAD_ROWS = [
  [3, 7],
  [1, 9],
  [0, 10],
  [0, 10],
  [0, 10],
  [0, 10],
  [0, 10],
  [0, 10],
  [1, 9],
  [2, 8],
];
function head(d: Pen, sp: Spec, ox: number, hy: number, sway: number) {
  if (sp.head === 'zukin' || sp.head === 'hood') {
    const cloth = sp.head === 'zukin' ? 'W' : 'N';
    const shade = sp.head === 'zukin' ? 'w' : 'n';
    // 背中に掛かる布
    d.rect(ox + 6 - sway, hy + 8, 2, 4, shade);
    HEAD_ROWS.forEach(([a, b], r) => {
      d.rect(ox + 6 + a, hy + r, b - a + 1, 1, cloth);
      if (r >= 6) d.rect(ox + 6 + a, hy + r, 2, 1, shade);
    });
    if (sp.head === 'zukin') {
      // 顔だけ出す
      d.rect(ox + 11, hy + 3, 5, 5, 'S');
      d.rect(ox + 11, hy + 7, 5, 1, 's');
    } else {
      // 目だけ出す
      d.rect(ox + 11, hy + 4, 5, 2, 'S');
    }
    d.rect(ox + 12, hy + 4, 1, 2, 'K');
    d.rect(ox + 14, hy + 4, 1, 2, 'K');
    return;
  }
  // 兜：上が鉢、後ろと横に軍の色の錣、前に顔
  if (sp.shaguma) {
    // 白熊：兜の後ろから背中へ垂れる白い毛
    d.rect(ox + 2 - sway, hy + 2, 5, 11, 'W');
    d.rect(ox + 2 - sway, hy + 9, 2, 4, 'w');
  }
  const metal = sp.head === 'namazu' ? 'I' : 'D';
  HEAD_ROWS.forEach(([a, b], r) => {
    const x0 = ox + 6 + a;
    const wdt = b - a + 1;
    if (r < 4) d.rect(x0, hy + r, wdt, 1, metal);
    else {
      d.rect(x0, hy + r, wdt, 1, 'S');
      // 錣（後ろ側）
      d.rect(x0, hy + r, Math.max(1, ox + 10 - x0), 1, 'A');
      d.set(x0, hy + r, 'a');
    }
  });
  d.rect(ox + 11, hy + 8, 5, 1, 's');
  // 眉庇（金の縁）
  d.rect(ox + 8, hy + 3, 9, 1, 'G');
  if (metal === 'I') d.rect(ox + 7, hy + 1, 2, 2, 'i');
  d.rect(ox + 12, hy + 5, 1, 2, 'K');
  d.rect(ox + 14, hy + 5, 1, 2, 'K');
  // 兜の形
  if (sp.head === 'namazu') {
    // 鯰尾：上へ細く高く伸びる銀の鉢
    d.stamp(ox + 8, hy - 5, ['..II..', '.IIII.', '.IIII.', 'IIIIII', 'iIIIII']);
  } else if (sp.head === 'eboshi') {
    // 長烏帽子：後ろへ反った高い鉢に、白い蛇の目
    d.stamp(ox + 6, hy - 7, ['.DDD...', '.DDDD..', 'DDDDD..', 'DWWWDD.', 'DW.WDD.', 'DWWWDDD', 'DDDDDDD']);
  }
  // 前立て
  const cx = ox + 14;
  if (sp.crest === 'kuwagata') {
    d.line(cx - 1, hy - 1, cx - 4, hy - 4, 'G');
    d.line(cx + 1, hy - 1, cx + 4, hy - 4, 'G');
    d.set(cx, hy, 'G');
  } else if (sp.crest === 'short') {
    d.line(cx - 1, hy - 1, cx - 2, hy - 2, 'G');
    d.line(cx + 1, hy - 1, cx + 2, hy - 2, 'G');
  } else if (sp.crest === 'sun') {
    d.set(cx, hy - 1, 'G');
    d.stamp(cx - 1, hy - 4, ['GGG', 'GGG', 'GGG']);
  } else if (sp.crest === 'shida') {
    // 歯朶：額から扇のように開く金の葉
    d.stamp(cx - 3, hy - 4, ['G.G.G.G', '.G.G.G.', '..GGG..', '...G...']);
  } else if (sp.crest === 'dot') {
    d.stamp(cx - 1, hy - 2, ['.G.', 'GGG']);
  }
}

// ---- 体 -----------------------------------------------------------------
function torso(d: Pen, sp: Spec, ox: number, ty: number) {
  const main = sp.ninja ? 'N' : 'A';
  const shade = sp.ninja ? 'n' : 'a';
  d.rect(ox + 8, ty, 7, 6, main);
  d.rect(ox + 8, ty, 1, 6, shade);
  if (!sp.ninja) d.rect(ox + 8, ty + 2, 7, 1, 'a');
  // 帯：鎧は金、忍びは軍の色
  d.rect(ox + 8, ty + 4, 7, 1, sp.ninja ? 'A' : 'G');
  d.rect(ox + 7, ty, 1, 3, shade);
}
// 袴と脚。st は歩幅（-1〜1）
function legs(d: Pen, sp: Spec, ox: number, st: number) {
  const main = sp.ninja ? 'N' : 'H';
  const shade = sp.ninja ? 'n' : 'h';
  const ly = SPR_H - 5;
  d.rect(ox + 8, ly, 7, 2, main);
  d.rect(ox + 8, ly, 1, 2, shade);
  const off = (i: number) => Math.round(st * (i + 1) * 0.8);
  for (let i = 0; i < 2; i++) {
    d.rect(ox + 9 - off(i), ly + 2 + i, 2, 1, shade);
    d.rect(ox + 12 + off(i), ly + 2 + i, 2, 1, main);
  }
  d.rect(ox + 9 - off(1), ly + 4, 2, 1, 'F');
  d.rect(ox + 12 + off(1), ly + 4, 3, 1, 'F');
}
// 馬：胴・首・頭・尾・4本の脚。g は脚の運び（0〜3）
function horse(d: Pen, g: number) {
  const top = SPR_H - 11;
  // 尾
  d.rect(3, top + 1, 2, 5, 'R');
  d.set(5, top, 'R');
  // 脚（後ろ・前）。駆けるコマで前後に開く
  const legOff = [
    [0, 0, 0, 0],
    [-1, 1, 1, -1],
    [0, 0, 0, 0],
    [1, -1, -1, 1],
  ][g];
  [7, 9, 16, 18].forEach((lx, i) => {
    const o = legOff[i];
    const c = i % 2 ? 'M' : 'm';
    d.rect(lx, top + 5, 2, 2, c);
    d.rect(lx + o, top + 7, 2, 2, c);
    d.rect(lx + o, top + 9, 2, 1, 'F');
  });
  // 胴
  d.rect(6, top, 14, 6, 'M');
  d.rect(6, top + 4, 14, 2, 'm');
  // 首と頭（前＝右）
  d.stamp(18, top - 6, ['..MM....', '.MMMM...', '.MMMMMM.', 'MMMMMMMM', 'MMMm.mm.', 'MMM.....', 'MMM.....']);
  d.set(20, top - 6, 'M');
  d.set(21, top - 4, 'K');
  // たてがみ
  d.line(18, top - 4, 18, top, 'R');
  d.line(19, top - 5, 19, top - 4, 'R');
  // 鞍と軍の色の掛け布
  d.rect(9, top - 1, 7, 4, 'A');
  d.rect(9, top + 2, 7, 1, 'a');
  d.rect(10, top - 1, 5, 1, 'C');
}

// ---- 武器 ---------------------------------------------------------------
// state は 'idle' か攻撃のコマ（0〜2）。ty は胴の上端
function weapon(d: Pen, sp: Spec, ox: number, ty: number, state: 'idle' | 0 | 1 | 2) {
  const arm = sp.ninja ? 'N' : 'A';
  const hand = (x: number, y: number) => d.set(x, y, 'S');
  const armDown = () => {
    d.rect(ox + 15, ty + 1, 1, 3, arm);
    hand(ox + 15, ty + 4);
  };
  const armForward = (y: number, len = 3) => {
    d.rect(ox + 15, ty + y, len, 1, arm);
    hand(ox + 15 + len, ty + y);
  };
  const w = sp.weapon;
  if (w === 'sword') {
    if (state === 'idle') {
      armDown();
      d.set(ox + 14, ty + 5, 'T');
      d.set(ox + 16, ty + 3, 'G');
      d.blade(ox + 17, ty + 2, ox + 21, ty - 6);
    } else if (state === 0) {
      // 刀を体の後ろへ引く（脇構え）
      d.line(ox + 14, ty + 1, ox + 9, ty + 3, arm);
      hand(ox + 8, ty + 3);
      d.set(ox + 7, ty + 3, 'G');
      d.blade(ox + 6, ty + 3, ox + 0, ty + 6);
    } else if (state === 1) {
      // 前へ水平に振り抜く
      armForward(1);
      d.set(ox + 19, ty + 1, 'G');
      d.blade(ox + 20, ty + 1, ox + 26, ty);
    } else {
      // 振り下ろしたあと
      d.line(ox + 15, ty + 1, ox + 17, ty + 3, arm);
      hand(ox + 18, ty + 4);
      d.set(ox + 19, ty + 5, 'G');
      d.blade(ox + 20, ty + 5, ox + 25, ty + 9);
    }
  } else if (w === 'spear' || w === 'kama') {
    // 槍（片鎌槍は穂先の横に鎌が付く）
    const tip = (x: number, y: number, horiz: boolean) => {
      if (horiz) {
        d.rect(x, y, 3, 1, 'I');
        d.set(x + 3, y, 'i');
        if (w === 'kama') d.line(x, y - 1, x - 1, y - 2, 'I');
      } else {
        d.rect(x, y - 3, 1, 3, 'I');
        d.set(x, y - 4, 'i');
        if (w === 'kama') d.line(x + 1, y - 2, x + 2, y - 3, 'I');
      }
    };
    if (state === 'idle') {
      armDown();
      if (sp.horse) {
        d.line(ox + 13, ty + 6, ox + 21, ty - 6, 'T');
        d.stamp(ox + 22, ty - 9, ['..I', '.I.', 'I..']);
      } else {
        d.line(ox + 16, ty + 8, ox + 16, ty - 11, 'T');
        tip(ox + 16, ty - 11, false);
      }
    } else {
      // 引いて、突いて、戻す。引くときは手を肩より後ろ（胴の前）まで下げる
      const reach = state === 1 ? 3 : state === 0 ? -3 : 1;
      const y = ty + 2;
      const hx = ox + 15 + reach;
      if (reach > 0) d.rect(ox + 15, y, reach, 1, arm);
      else d.line(ox + 15, ty + 1, hx + 1, y, arm);
      hand(hx, y);
      d.line(hx - 9, y, hx + 4, y, 'T');
      tip(hx + 5, y, true);
    }
  } else if (w === 'bow') {
    // 弓：竹の弓を前に立てる
    const bow = (x: number) => {
      d.line(x, ty - 3, x, ty + 7, 'C');
      d.set(x - 1, ty - 4, 'C');
      d.set(x - 1, ty + 8, 'C');
    };
    if (state === 0) {
      // 引き絞る：矢をつがえ、弦を後ろへ
      armForward(2, 3);
      bow(ox + 19);
      d.line(ox + 18, ty - 4, ox + 12, ty + 2, 'c');
      d.line(ox + 12, ty + 2, ox + 18, ty + 8, 'c');
      d.line(ox + 12, ty + 2, ox + 22, ty + 2, 'T');
      d.set(ox + 23, ty + 2, 'I');
      d.line(ox + 9, ty + 1, ox + 11, ty + 2, arm);
      hand(ox + 12, ty + 2);
    } else if (state === 1) {
      // 放つ：弦が戻り、引いた手は後ろへ開く
      armForward(2, 3);
      bow(ox + 19);
      d.line(ox + 18, ty - 4, ox + 18, ty + 8, 'c');
      d.line(ox + 9, ty + 1, ox + 10, ty, arm);
      hand(ox + 10, ty - 1);
    } else {
      armForward(2, 2);
      bow(ox + 18);
      d.line(ox + 17, ty - 4, ox + 17, ty + 8, 'c');
    }
  } else if (w === 'gun') {
    // 火縄銃
    if (state === 'idle') {
      armDown();
      d.line(ox + 14, ty + 6, ox + 20, ty - 2, 'D');
      d.rect(ox + 12, ty + 6, 2, 2, 'C');
    } else {
      // 構えて、撃って、煙
      const kick = state === 2 ? -1 : 0;
      const y = ty + 1;
      d.rect(ox + 12 + kick, y, 3, 2, 'C');
      d.rect(ox + 15 + kick, y, 9, 1, 'D');
      hand(ox + 15 + kick, y + 1);
      hand(ox + 19 + kick, y + 1);
      if (state === 1) {
        d.stamp(ox + 24, y - 1, ['.O.', 'OYO', '.O.']);
        d.set(ox + 26, y, 'Y');
      } else if (state === 2) d.stamp(ox + 23, y - 3, ['.gg.', 'gggg', '.gg.']);
    }
  } else if (w === 'fan') {
    // 軍配：黒い団扇に金の丸
    const fan = (x: number, y: number) => d.stamp(x - 2, y - 2, ['.KKK.', 'KKKKK', 'KKGKK', 'KKKKK', '.KKK.']);
    if (state === 0) {
      // 高く掲げる
      d.rect(ox + 15, ty - 2, 1, 3, arm);
      hand(ox + 15, ty - 3);
      d.line(ox + 15, ty - 4, ox + 15, ty - 5, 'T');
      fan(ox + 15, ty - 8);
    } else if (state === 1) {
      // 前へ振り下ろす
      armForward(1);
      d.rect(ox + 19, ty + 1, 2, 1, 'T');
      fan(ox + 23, ty + 1);
    } else {
      armDown();
      d.line(ox + 16, ty + 3, ox + 17, ty + 1, 'T');
      fan(ox + 19, ty - 1);
    }
  } else if (w === 'star') {
    // 手裏剣
    const star = (x: number, y: number) => d.stamp(x - 1, y - 1, ['I.I', '.i.', 'I.I']);
    if (state === 'idle') {
      armDown();
      d.line(ox + 16, ty + 5, ox + 17, ty + 6, 'I');
    } else if (state === 0) {
      // 肩の後ろへ振りかぶる
      d.line(ox + 14, ty + 1, ox + 12, ty - 2, arm);
      hand(ox + 12, ty - 3);
      star(ox + 11, ty - 4);
    } else if (state === 1) {
      armForward(1);
      star(ox + 23, ty);
    } else {
      d.line(ox + 15, ty + 1, ox + 17, ty + 3, arm);
      hand(ox + 18, ty + 4);
      star(ox + 25, ty);
    }
  }
}
// 倒れたときに落ちている武器
function droppedWeapon(d: Pen, sp: Spec, x: number, y: number) {
  const w = sp.weapon;
  if (w === 'sword') d.blade(x, y, x + 7, y - 1);
  else if (w === 'spear' || w === 'kama') {
    d.line(x - 2, y, x + 9, y - 1, 'T');
    d.rect(x + 10, y - 1, 2, 1, 'I');
  } else if (w === 'bow') d.line(x, y, x + 9, y - 1, 'C');
  else if (w === 'gun') d.line(x, y, x + 8, y - 1, 'D');
  else if (w === 'fan') d.stamp(x + 2, y - 2, ['.KK.', 'KGKK', '.KK.']);
  else d.set(x + 3, y, 'I');
}

// ---- コマ ---------------------------------------------------------------
function draw(kind: GeneralKind, frame: Frame, clip = { n: 0 }): Grid {
  const sp = SPECS[kind];
  const g = blank(SPR_W, SPR_H);
  const d = painter(g, clip);
  const ground = SPR_H - 1;
  if (frame === 'down1') {
    // 仰向けに倒れた姿：頭が後ろ、足が前
    const y = ground - 6;
    const top = sp.head === 'zukin' ? 'W' : sp.head === 'hood' ? 'N' : sp.head === 'namazu' ? 'I' : 'D';
    d.rect(1, y + 1, 9, 6, top);
    d.rect(2, y, 7, 1, top);
    d.rect(4, y, 5, 3, 'S');
    d.rect(4, y + 1, 2, 1, 'K');
    d.rect(7, y + 1, 1, 1, 'K');
    const main = sp.ninja ? 'N' : 'A';
    d.rect(10, y + 2, 6, 5, main);
    d.rect(10, y + 5, 6, 2, sp.ninja ? 'n' : 'a');
    d.rect(14, y + 2, 1, 5, sp.ninja ? 'A' : 'G');
    d.rect(16, y + 3, 5, 4, sp.ninja ? 'N' : 'H');
    d.rect(16, y + 5, 5, 2, sp.ninja ? 'n' : 'h');
    d.rect(21, y + 3, 1, 2, 'F');
    d.rect(21, y + 5, 2, 2, 'F');
    droppedWeapon(d, sp, 15, y - 1);
    return g;
  }
  if (frame === 'down0') {
    // 膝をつき、前に崩れる。武器は落ちる
    const ox = 1;
    const hy = SPR_H - 18;
    torso(d, sp, ox, hy + 10);
    d.rect(ox + 7, ground - 3, 9, 3, sp.ninja ? 'N' : 'H');
    d.rect(ox + 7, ground - 3, 1, 3, sp.ninja ? 'n' : 'h');
    d.rect(ox + 6, ground, 3, 1, 'F');
    d.rect(ox + 14, ground, 3, 1, 'F');
    head(d, sp, ox + 1, hy + 1, 0);
    d.rect(ox + 15, hy + 11, 1, 3, sp.ninja ? 'N' : 'A');
    d.set(ox + 15, hy + 14, 'S');
    droppedWeapon(d, sp, ox + 15, ground - 1);
    return g;
  }
  const walk = frame.startsWith('walk') ? Number(frame[4]) : -1;
  const atk = frame.startsWith('atk') ? Number(frame[3]) : -1;
  const bob = walk === 1 || walk === 3 ? 1 : 0;
  const st = walk === 1 ? 1 : walk === 3 ? -1 : 0;
  if (sp.horse) {
    // 騎馬：馬の上に上半身。馬は歩くコマで脚を運ぶ
    const ox = 0;
    const hy = 3 + bob;
    const ty = hy + 10;
    d.rect(ox + 6, ty + 1, 1, 3, 'a');
    torso(d, sp, ox, ty);
    horse(d, Math.max(0, walk));
    // 鐙にかけた脚
    d.rect(ox + 11, ty + 5, 2, 5, 'H');
    d.rect(ox + 11, ty + 10, 3, 1, 'F');
    head(d, sp, ox, hy, bob);
    weapon(d, sp, ox, ty, atk >= 0 ? (atk as 0 | 1 | 2) : 'idle');
    return g;
  }
  const ox = atk >= 1 ? 1 : 0;
  const hy = SPR_H - 21 + bob;
  const ty = hy + 10;
  // 奥の腕（歩くと前後に振る）
  const sw = atk >= 0 ? -1 : -st;
  d.rect(ox + 7 + sw, ty + 1, 1, 3, sp.ninja ? 'n' : 'a');
  d.set(ox + 7 + sw, ty + 4, 's');
  legs(d, sp, ox, st);
  torso(d, sp, ox, ty);
  head(d, sp, ox, hy, bob);
  weapon(d, sp, ox, ty, atk >= 0 ? (atk as 0 | 1 | 2) : 'idle');
  return g;
}

// 色のあるドットの上下左右の空きに、輪郭を付ける
function outline(g: Grid) {
  const h = g.length;
  const w = g[0].length;
  const add: [number, number][] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (g[y][x]) continue;
      const near = (i: number, j: number) =>
        i >= 0 && j >= 0 && i < w && j < h && g[j][i] !== '' && !NO_OUTLINE.has(g[j][i]);
      if (near(x - 1, y) || near(x + 1, y) || near(x, y - 1) || near(x, y + 1)) add.push([x, y]);
    }
  for (const [x, y] of add) g[y][x] = 'K';
}

function paint(g: Grid, side: string, white: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = g[0].length;
  c.height = g.length;
  const x2 = c.getContext('2d');
  if (!x2) return c;
  g.forEach((row, y) => {
    row.forEach((code, x) => {
      if (!code) return;
      x2.fillStyle = white ? '#fff' : code === 'A' || code === 'a' ? side : COLORS[code];
      x2.fillRect(x, y, 1, 1);
      if (!white && code === 'a') {
        x2.fillStyle = 'rgba(0,0,0,0.3)';
        x2.fillRect(x, y, 1, 1);
      }
    });
  });
  return c;
}

// 1コマの色の記号の並び（輪郭付き）と、絵の枠からはみ出したドットの数。canvas を使わないのでテストで確かめられる
export function spriteGrid(kind: GeneralKind, frame: Frame): { grid: string[][]; clipped: number } {
  const clip = { n: 0 };
  const grid = draw(kind, frame, clip);
  outline(grid);
  return { grid, clipped: clip.n };
}
// 武将の幟の家紋と、その模様（なければ空）
export const bushoMon = (kind: GeneralKind) => ({ mon: SPECS[kind].mon, pix: MON_PIX[SPECS[kind].mon] ?? [] });

const cache = new Map<string, HTMLCanvasElement>();
// 1コマの画像。white なら、傷を受けたときに重ねる白い形
export function bushoSprite(kind: GeneralKind, frame: Frame, side: string, white = false): HTMLCanvasElement {
  const key = `${kind}|${frame}|${white ? 'w' : side}`;
  let c = cache.get(key);
  if (!c) {
    const g = draw(kind, frame);
    outline(g);
    c = paint(g, side, white);
    cache.set(key, c);
  }
  return c;
}

// 幟の家紋・旗印（幅8×高さ9まで）。縮めると潰れるので、ドットで描いておく
const MON_PIX: Record<string, string[]> = {
  bi: ['KKKKK..', 'K.K.K..', 'KKKKK..', 'K.K.K..', 'KKKKK..', 'K..K...', 'KK.KK.K', 'K..K..K', 'KKKKKKK'],
  mokko: ['..KKK..', '.K...K.', 'K.KKK.K', 'K.K.K.K', 'K.KKK.K', '.K...K.', '..KKK..'],
  chigaiya: ['K.....K', '.K...K.', '..K.K..', '...K...', '..K.K..', '.K...K.', 'KK...KK'],
  rokumon: ['KK.KK.KK', 'KK.KK.KK', '........', 'KK.KK.KK', 'KK.KK.KK'],
  umebachi: ['...K...', '.KK.KK.', '.KK.KK.', 'K..K..K', '.KK.KK.', '.KK.KK.', '...K...'],
  hishi: ['...K...', '..KKK..', '.K.K.K.', 'KKK.KKK', '.K.K.K.', '..KKK..', '...K...'],
  janome: ['..KKK..', '.KKKKK.', 'KK...KK', 'KK...KK', 'KK...KK', '.KKKKK.', '..KKK..'],
  shuriken: ['...K...', '...K...', '..KKK..', 'KKK.KKK', '..KKK..', '...K...', '...K...'],
  aoi: ['..KKK..', '.K.K.K.', 'K.KKK.K', 'K..K..K', 'K.K.K.K', '.KK.KK.', '..KKK..'],
};
// 幟：竿と白い旗、上に軍の色の帯、家紋
export function flagSprite(side: string, mon: string): HTMLCanvasElement {
  const key = `flag|${side}|${mon}`;
  let c = cache.get(key);
  if (!c) {
    const g = blank(FLAG_W, FLAG_H);
    const d = painter(g);
    d.rect(0, 0, 1, FLAG_H, 'P');
    d.rect(0, 0, 10, 1, 'P');
    d.rect(1, 1, 9, 14, 'W');
    d.rect(9, 3, 1, 12, 'w');
    d.rect(1, 1, 9, 2, 'A');
    const pix = MON_PIX[mon] ?? [];
    const pw = Math.max(0, ...pix.map((r) => r.length));
    d.stamp(1 + Math.floor((8 - pw) / 2), 4 + Math.floor((9 - pix.length) / 2), pix);
    outline(g);
    c = paint(g, side, false);
    cache.set(key, c);
  }
  return c;
}

// 幟と体を貼る。fx・fy は足元（画面のピクセル）、dot はドット1つの大きさ、face は向き（1 が右）。
// 呼ぶ側は変換をなくしておく（ctx.setTransform(1, 0, 0, 1, 0, 0)）
export function blitBusho(
  ctx: CanvasRenderingContext2D,
  kind: GeneralKind,
  frame: Frame,
  side: string,
  fx: number,
  fy: number,
  dot: number,
  face: number,
  flash = 0,
) {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  // 幟は背中の側に立てる（字が裏返らないよう、幟は反転しない）
  if (frame !== 'down1') {
    const px = face > 0 ? fx - 12 * dot : fx + 4 * dot;
    ctx.drawImage(flagSprite(side, SPECS[kind].mon), px, fy - (SPR_UNIT + 3) * dot, FLAG_W * dot, FLAG_H * dot);
  }
  ctx.translate(fx, fy);
  ctx.scale(face, 1);
  const draw = (img: HTMLCanvasElement) => ctx.drawImage(img, -SPR_CX * dot, -SPR_H * dot, SPR_W * dot, SPR_H * dot);
  draw(bushoSprite(kind, frame, side));
  if (flash > 0) {
    ctx.globalAlpha *= 0.55;
    draw(bushoSprite(kind, frame, side, true));
  }
  ctx.restore();
}
