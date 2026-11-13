// 計測専用フィールド（物差し）の定義。ゲーム側のプリセット（基本の城・編成例）は
// ゲームの調整で時々変わるため、計測の条件が黙って動かないよう、フィールドはここに凍結する。
// 兵・施設の能力値そのものは決めず（それは defs の値を使う）、ここで決めるのは配置だけ。
// ゲームの城としては登録しない（選べない・遊べない）。計測スクリプト（scripts/balance-* と
// field-solo）と、確かめのページ（field.html）が、同じ定義を読む。
// 版：v1（2026-11-12、平城コンパクト試作。まだ校正中で、凍結はしていない）
// 設計方針（平城コンパクト）：
// - 本丸は盤面中央。郭は二重（外郭18×18・内郭8×8）で、面積は現行の平城（基本）の約半分
// - 撃つ施設は弓櫓12・鉄砲櫓5・大筒4の計21、鼓楼4、城壁80、門3
//   （試作の教訓：面積だけでなく施設の総量まで減らすと、兵だけの軍に素通りされた。
//    弓櫓は弓兵（射程4）と撃ち合うが盾兵の肩代わりで各個撃破される。効くのは鉄砲櫓と大筒）
// - 出撃口は計測で使う東(1)・南東(7)。出撃口は最寄りの門に寄るので、門は東と南（東寄り）に置く

import { H, W } from './defs';
import type { Layout, PlacedBuilding } from './layout';

// 郭の輪を置く：(x0,y0)-(x1,y1) の外周に城壁を並べ、指定マスは門・櫓に置き換える
function ring(
  buildings: PlacedBuilding[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  replace: Map<string, PlacedBuilding['type']>,
) {
  for (let x = x0; x <= x1; x++) {
    for (const y of [y0, y1]) buildings.push({ type: replace.get(`${x},${y}`) ?? 'wall', x, y });
  }
  for (let y = y0 + 1; y <= y1 - 1; y++) {
    for (const x of [x0, x1]) buildings.push({ type: replace.get(`${x},${y}`) ?? 'wall', x, y });
  }
}

// 城の建物（平城・平山城で共通。地形による強さの差だけを見るため、構成はそろえる）
function compactBuildings(): PlacedBuilding[] {
  const buildings: PlacedBuilding[] = [];
  // 本丸（2×2、左上が (20,20)）
  buildings.push({ type: 'hall', x: 20, y: 20 });
  // 外郭 12..29 × 12..29：門は東 (29,20) と南 (25,29)。櫓は東面・南面に密に置く
  ring(
    buildings,
    12,
    12,
    29,
    29,
    new Map([
      ['29,20', 'gate'],
      ['25,29', 'gate'],
      ['29,14', 'tbow'],
      ['29,17', 'tbow'],
      ['29,23', 'tbow'],
      ['29,26', 'tbow'],
      ['14,29', 'tbow'],
      ['18,29', 'tbow'],
      ['22,29', 'tbow'],
      ['27,29', 'tbow'],
      ['20,12', 'tbow'],
      ['12,20', 'tbow'],
    ]),
  );
  // 外郭の内側：鉄砲櫓・大筒・鼓楼
  buildings.push({ type: 'tgun', x: 27, y: 20 });
  buildings.push({ type: 'tgun', x: 25, y: 26 });
  buildings.push({ type: 'tgun', x: 14, y: 14 });
  buildings.push({ type: 'tgun', x: 26, y: 13 });
  buildings.push({ type: 'cata', x: 27, y: 16 });
  buildings.push({ type: 'cata', x: 15, y: 25 });
  buildings.push({ type: 'cata', x: 20, y: 14 });
  buildings.push({ type: 'drum', x: 27, y: 24 });
  buildings.push({ type: 'drum', x: 16, y: 27 });
  buildings.push({ type: 'drum', x: 24, y: 13 });
  // 内郭 17..24 × 17..24：門は東 (24,20)
  ring(
    buildings,
    17,
    17,
    24,
    24,
    new Map([
      ['24,20', 'gate'],
      ['24,17', 'tbow'],
      ['24,23', 'tbow'],
      ['17,17', 'tgun'],
    ]),
  );
  // 内郭の内側：大筒と鼓楼
  buildings.push({ type: 'cata', x: 19, y: 23 });
  buildings.push({ type: 'drum', x: 22, y: 18 });
  return buildings;
}

// 平城コンパクトの配置（平ら）
export function compactFlatLayout(): Layout {
  const zero = new Array<number>(W * H).fill(0);
  return {
    buildings: compactBuildings(),
    generals: [],
    heights: [...zero],
    water: [...zero],
    bridge: [...zero],
    map: 'flat',
  };
}

// 平山城コンパクトの配置：建物は平城と同じで、郭に合わせて段々に高くする。
// 外は0段、外郭とその内側は1段、内郭とその内側は2段。段差はどこも1段まで
// （2段以上の差は崖で通れなくなるため）。高い所の櫓は射程が伸びる（1段につき+1、射程2超のもの）
export function compactHillLayout(): Layout {
  const zero = new Array<number>(W * H).fill(0);
  const heights = new Array<number>(W * H).fill(0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x >= 17 && x <= 24 && y >= 17 && y <= 24) heights[y * W + x] = 2;
      else if (x >= 12 && x <= 29 && y >= 12 && y <= 29) heights[y * W + x] = 1;
    }
  }
  return {
    buildings: compactBuildings(),
    generals: [],
    heights,
    water: [...zero],
    bridge: [...zero],
    map: 'hirayama',
  };
}

// 山城コンパクトの配置：建物は平城と同じで、城の外まで段々が続く。
// 外は0段、裾野（6..35）1段、中腹（9..32）2段、外郭とその内側（12..29）3段、内郭とその内側（17..24）4段。
// 段差はどこも1段まで。攻め手は城壁に届くまでに3段を登り、その間ずっと高所の櫓の射程に入る
export function compactYamaLayout(): Layout {
  const zero = new Array<number>(W * H).fill(0);
  const heights = new Array<number>(W * H).fill(0);
  const zones: readonly { from: number; to: number; h: number }[] = [
    { from: 6, to: 35, h: 1 },
    { from: 9, to: 32, h: 2 },
    { from: 12, to: 29, h: 3 },
    { from: 17, to: 24, h: 4 },
  ];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (const z of zones) if (x >= z.from && x <= z.to && y >= z.from && y <= z.to) heights[y * W + x] = z.h;
    }
  }
  return {
    buildings: compactBuildings(),
    generals: [],
    heights,
    water: [...zero],
    bridge: [...zero],
    map: 'yama',
  };
}

// フィールドの種類と、その配置を作る関数・名前
export type SimFieldId = 'flat' | 'hill' | 'yama';
export const SIM_FIELDS: readonly { id: SimFieldId; name: string; build: () => Layout }[] = [
  { id: 'flat', name: '平城コンパクト', build: compactFlatLayout },
  { id: 'hill', name: '平山城コンパクト', build: compactHillLayout },
  { id: 'yama', name: '山城コンパクト', build: compactYamaLayout },
];

// 守り計測・守りの再生で、守将ひとりを置く持ち場（出撃口の進路に当たる、門の内側）
export const COMPACT_POSTS: Record<number, { x: number; y: number }> = {
  1: { x: 26, y: 20 }, // 東口の進路
  7: { x: 25, y: 26 }, // 南東口の進路
};
