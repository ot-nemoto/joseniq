import { type BuildingType, H, W } from './defs';
import type { Layout } from './layout';
import type { Draft } from './plan';
import { EXTRA_PRESET_DATA, PRESET_DATA, type PresetData } from './presetData';
import { isMapId, MAPS, type MapId } from './terrain';

// ---- 編成例 -------------------------------------------------------------
// 「基本」の城。地図の型ごとの城（平城・平山城・山城。PRESET_DATA）は、地形（高さ・川・橋）ごと、決まった城を再現する。
// それとは別の城（平城+など。EXTRA_PRESET_DATA）は、地図の型の城の地形を借りて、配置だけを変える（データは presetData.ts）。
// 名前は PresetId（地図の型の名前と、別の城の名前）で受け取る。画面のボタンの値のように型の決まらない名前は、
// 呼ぶ側で isPresetId を確かめる（知らない名前で、今の地形や配置を消さないため）
export type PresetId = MapId | keyof typeof EXTRA_PRESET_DATA;
export const isPresetId = (v: unknown): v is PresetId =>
  isMapId(v) || (typeof v === 'string' && Object.hasOwn(EXTRA_PRESET_DATA, v));
// 「基本」の城の名前の一覧（地図の型の順に、そのあと別の城）
export const PRESET_IDS: readonly PresetId[] = [
  ...MAPS.map((m) => m.id),
  ...(Object.keys(EXTRA_PRESET_DATA) as (keyof typeof EXTRA_PRESET_DATA)[]),
];
const mapOf = (name: PresetId): MapId => (isMapId(name) ? name : EXTRA_PRESET_DATA[name].map);
// 地形は地図の型の城のもの。配置・武将・本丸の郭の門は、その城のもの
const dataOf = (name: PresetId): PresetData =>
  isMapId(name) ? PRESET_DATA[name] : { ...PRESET_DATA[mapOf(name)], ...EXTRA_PRESET_DATA[name] };

export function preset(name: PresetId): Layout {
  const d = dataOf(name);
  const mask = (list: number[]) => {
    const a = new Array<number>(W * H).fill(0);
    for (const i of list) a[i] = 1;
    return a;
  };
  const l: Layout = {
    buildings: [],
    generals: d.generals.map(([kind, i]) => ({ kind, x: i % W, y: (i / W) | 0 })),
    heights: [...d.heights].map(Number),
    water: mask(d.water),
    bridge: mask(d.bridge),
    map: mapOf(name),
  };
  for (const [type, list] of Object.entries(d.buildings) as [BuildingType, number[]][])
    for (const i of list) l.buildings.push({ type, x: i % W, y: (i / W) | 0 });
  return l;
}

// ---- 攻城配置の編成例 -----------------------------------------------------
// 基本：衝車6 と工兵14 を東の北寄りの口から、歩兵2 を東の2つの口から出す作戦。衝車が門を割り、工兵が櫓を壊しながら本丸へ向かう。
// 攻守とも武将なしの平城+に、試した作戦の中でいちばん傷を与えた、決まり（兵力）に合った作戦の見本。落とせはせず、守将がいると全滅する。
// 開始と間隔は、軍評定の窓の刻み（開始0.1秒・間隔0.05秒）に乗る値にする（窓で触っても、丸められて変わらないように）
// 口が今の地形で出撃口にできない所（平地でない・川）なら、開戦前に近くの出撃口にできる所へ寄せる（app.ts の snapGates）。
// 防衛の編成例の城は、守将を置いた形で、どの攻め方にも防衛側が勝つことを目指して組む
// 編成例の本丸の郭（内の囲い）の門
export function presetInnerGates(name: PresetId): { x: number; y: number }[] {
  return dataOf(name).innerGates.map((i) => ({ x: i % W, y: (i / W) | 0 }));
}

export function basicSiege(): Draft {
  return {
    version: 1,
    gates: [
      { x: W - 1, y: 24 },
      { x: W - 1, y: 36 },
    ],
    rows: [
      { gate: 0, kind: 'ram', n: 6, t0: 0.5, dt: 2.1 },
      { gate: 0, kind: 'eng', n: 14, t0: 2.4, dt: 1.5 },
      { gate: 1, kind: 'inf', n: 1, t0: 17.9, dt: 0.6 },
      { gate: 0, kind: 'inf', n: 1, t0: 19, dt: 0.05 },
    ],
  };
}
