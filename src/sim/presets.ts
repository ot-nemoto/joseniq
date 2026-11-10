import { type BuildingType, H, W } from './defs';
import type { Layout } from './layout';
import type { Draft } from './plan';
import { PRESET_DATA } from './presetData';
import { isMapId, MAPS, type MapId } from './terrain';

// ---- 編成例 -------------------------------------------------------------
// 「基本」の城。地図の型ごとの城（平城・平山城・山城。PRESET_DATA）は、地形（高さ・川・橋）と堀ごと、決まった城を再現する。
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
  if (d.moat?.length) l.moat = mask(d.moat);
  for (const [type, list] of Object.entries(d.buildings) as [BuildingType, number[]][])
    for (const i of list) l.buildings.push({ type, x: i % W, y: (i / W) | 0 });
  return l;
}

// 編成例の本丸の郭（内の囲い）の門
export function presetInnerGates(name: PresetId): { x: number; y: number }[] {
  return PRESET_DATA[name].innerGates.map((i) => ({ x: i % W, y: (i / W) | 0 }));
}

// ---- 攻城配置の編成例 -----------------------------------------------------
// 基本：城の型ごとに、その「基本」の城を攻める、決まり（兵力）に合った作戦の見本（SIEGES）。
// どの型も、探した中で落とせる作戦が見つからなかったので、本丸にいちばん迫った作戦（平城は、いちばん奥の門まで進んだ作戦）
// 開始と間隔は、軍評定の窓の刻み（開始0.1秒・間隔0.05秒）に乗る値にする（窓で触っても、丸められて変わらないように）
// 口が今の地形で出撃口にできない所（平地でない・川）なら、開戦前に近くの出撃口にできる所へ寄せる（app.ts の snapGates）。
const SIEGES: Record<PresetId, Pick<Draft, 'gates' | 'rows'>> = {
  // 衝車2 を北の口（10,0）から、盾兵10 を北の口（34,0）から出し、川を渡って橋（20,20）に上がり、本丸の郭の南の門（20,19）を割る。
  // 西の口（0,38）から、遅れて工兵2 と歩兵6 を出す。「基本（平城）」の城は、探した中で落とせる作戦が見つからず、
  // これはいちばん奥まで進んだ作戦（本丸の手前の門を割るが、本丸の傷は0%）
  flat: {
    gates: [
      { x: 10, y: 0 },
      { x: 34, y: 0 },
      { x: 0, y: 38 },
    ],
    rows: [
      { gate: 0, kind: 'ram', n: 2, t0: 0, dt: 0.05 },
      { gate: 1, kind: 'shd', n: 10, t0: 0.7, dt: 1.5 },
      { gate: 2, kind: 'eng', n: 2, t0: 94.9, dt: 0.8 },
      { gate: 2, kind: 'inf', n: 6, t0: 96.9, dt: 0.2 },
    ],
  },
  // 衝車6 と斥候2 を南東の口から出し、盾兵7 を南の口から出す。
  // 「基本（平山城）」の城は、探した中で落とせる作戦が見つからず、これは本丸にいちばん迫った作戦（本丸の傷44%）
  hirayama: {
    gates: [
      { x: W - 1, y: 36 },
      { x: 17, y: H - 1 },
    ],
    rows: [
      { gate: 0, kind: 'ram', n: 6, t0: 15.2, dt: 0.3 },
      { gate: 1, kind: 'shd', n: 7, t0: 18.7, dt: 0.8 },
      { gate: 0, kind: 'scout', n: 2, t0: 15.5, dt: 0.3 },
    ],
  },
  // 衝車4・盾兵7・工兵2 を東の口から出し、盾兵2 を南西の隅の口から遅れて出す。
  // 「基本（山城）」の城は、探した中で落とせる作戦が見つからず、これは本丸にいちばん迫った作戦（本丸の傷96%）
  yama: {
    gates: [
      { x: W - 1, y: 20 },
      { x: 0, y: 36 },
    ],
    rows: [
      { gate: 0, kind: 'shd', n: 7, t0: 3.3, dt: 1.8 },
      { gate: 0, kind: 'eng', n: 2, t0: 3, dt: 0.5 },
      { gate: 0, kind: 'ram', n: 4, t0: 1.1, dt: 0.05 },
      { gate: 1, kind: 'shd', n: 2, t0: 16.6, dt: 1.65 },
    ],
  },
};

export function basicSiege(id: PresetId): Draft {
  return structuredClone({ version: 1, ...SIEGES[id] });
}
