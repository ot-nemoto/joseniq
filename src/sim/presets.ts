import { type BuildingType, H, W } from './defs';
import type { Layout } from './layout';
import type { Draft } from './plan';
import { PRESET_DATA } from './presetData';
import { isMapId, MAPS, type MapId } from './terrain';

// ---- 編成例 -------------------------------------------------------------
// 「基本」の城。地図の型ごとの城（平城・平山城・山城。PRESET_DATA）は、地形（高さ・川・橋）ごと、決まった城を再現する。
// 名前は PresetId（地図の型の名前）で受け取る。画面のボタンの値のように型の決まらない名前は、
// 呼ぶ側で isPresetId を確かめる（知らない名前で、今の地形や配置を消さないため）
export type PresetId = MapId;
export const isPresetId = isMapId;
// 「基本」の城の名前の一覧（地図の型の順）
export const PRESET_IDS: readonly PresetId[] = MAPS.map((m) => m.id);

export function preset(name: PresetId): Layout {
  const d = PRESET_DATA[name];
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
    map: name,
  };
  for (const [type, list] of Object.entries(d.buildings) as [BuildingType, number[]][])
    for (const i of list) l.buildings.push({ type, x: i % W, y: (i / W) | 0 });
  return l;
}

// ---- 攻城配置の編成例 -----------------------------------------------------
// 基本：衝車5 を東の口から先に出し、工兵17 と歩兵1 を東の北寄りの口から続ける作戦。衝車が門を割り、工兵が櫓を壊しながら本丸へ向かう。
// 「基本（平城）」を落とせる、決まり（兵力）に合った作戦の見本。
// 開始と間隔は、軍評定の窓の刻み（開始0.1秒・間隔0.05秒）に乗る値にする（窓で触っても、丸められて変わらないように）
// 口が今の地形で出撃口にできない所（平地でない・川）なら、開戦前に近くの出撃口にできる所へ寄せる（app.ts の snapGates）。
// 編成例の本丸の郭（内の囲い）の門
export function presetInnerGates(name: PresetId): { x: number; y: number }[] {
  return PRESET_DATA[name].innerGates.map((i) => ({ x: i % W, y: (i / W) | 0 }));
}

export function basicSiege(): Draft {
  return {
    version: 1,
    gates: [
      { x: W - 1, y: 27 },
      { x: W - 1, y: 24 },
    ],
    rows: [
      { gate: 0, kind: 'ram', n: 5, t0: 0.7, dt: 0.9 },
      { gate: 1, kind: 'eng', n: 17, t0: 7, dt: 1 },
      { gate: 1, kind: 'inf', n: 1, t0: 25.7, dt: 0.3 },
    ],
  };
}
