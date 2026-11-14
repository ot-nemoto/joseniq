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
// 平山城・山城は、その城を落とせる作戦。平城は、探した中で落とせる作戦が見つからなかったので、いちばん本丸に迫った作戦
// 開始と間隔は、軍評定の窓の刻み（開始0.1秒・間隔0.05秒）に乗る値にする（窓で触っても、丸められて変わらないように）
// 口が今の地形で出撃口にできない所（平地でない・川）なら、開戦前に近くの出撃口にできる所へ寄せる（app.ts の snapGates）。
const SIEGES: Record<PresetId, Pick<Draft, 'gates' | 'rows'>> = {
  // 衝車5・盾兵5・鉤縄を持たせた工兵1・工兵3 を北西の口（0,3）から出し、口の道筋で北の出丸を通る（17,2 → 32,7 → 32,9）。
  // 北の出丸の外の門（17,2）と、引き橋の手前の門（32,7）を割り、鉤縄で引き橋を下ろして、出島の北の門（32,9）を割るが、
  // 本丸を削り切る前に全滅する（本丸の傷67%）。「基本（平城）」の城は、探した中で落とせる作戦が見つからず、これはいちばん本丸に迫った作戦。
  // 兵力は59で1余る（歩兵1を足すと、どの時刻に出しても本丸の傷が減るので、足していない）。
  // 行の並びは探した作戦のまま。同じ口から出す順番で出撃位置のずれ方が変わり、結果に効くので、並べ替えたりまとめたりしない
  // （同じ「衝車2・2秒から1秒おき」の行が2つあるのも探した形のままで、2秒・3秒に2体ずつ出る。まとめると 2〜5秒に1体ずつになり、結果が変わる）。
  // 先に盾兵1と工兵2・衝車4・盾兵2が出て北の出丸の門を割り、11〜13秒に鉤縄の工兵と衝車1・工兵1が続き、36秒に盾兵2が出る
  flat: {
    gates: [
      {
        x: 0,
        y: 3,
        route: [
          [17, 2],
          [32, 7],
          [32, 9],
        ],
      },
    ],
    rows: [
      { gate: 0, kind: 'shd', n: 1, t0: 0, dt: 0.5 },
      { gate: 0, kind: 'eng', n: 1, t0: 11, dt: 1, item: 'hook' },
      { gate: 0, kind: 'eng', n: 2, t0: 2, dt: 1.5 },
      { gate: 0, kind: 'shd', n: 2, t0: 36, dt: 1 },
      { gate: 0, kind: 'ram', n: 2, t0: 2, dt: 1 },
      { gate: 0, kind: 'ram', n: 1, t0: 12, dt: 0.5 },
      { gate: 0, kind: 'ram', n: 2, t0: 2, dt: 1 },
      { gate: 0, kind: 'eng', n: 1, t0: 13, dt: 1.5 },
      { gate: 0, kind: 'shd', n: 2, t0: 2, dt: 0.5 },
    ],
  },
  // 衝車5・工兵7・歩兵4 を北の口（15,0）から出し、盾兵4 を東の口（41,24）から口の道筋（24,9 → 17,25）で出す。
  // 北の外の門（24,9）と内の門（26,13）を割り、「基本（平山城）」の城を時間内に落とす。
  // 守りと攻めを交互に探した中で、この城をいちばん速く落とした作戦（前の基本の作戦をもとにした形）。兵力は59で1余る。
  // 同じ口から出す順番で出撃位置のずれ方が変わり、結果に効くので、行は並べ替えたりまとめたりしない
  hirayama: {
    gates: [
      { x: 15, y: 0 },
      {
        x: W - 1,
        y: 24,
        route: [
          [24, 9],
          [17, 25],
        ],
      },
    ],
    rows: [
      { gate: 0, kind: 'inf', n: 1, t0: 12, dt: 0.25 },
      { gate: 0, kind: 'inf', n: 2, t0: 50.9, dt: 0.5 },
      { gate: 0, kind: 'ram', n: 5, t0: 20.7, dt: 0.25 },
      { gate: 1, kind: 'shd', n: 4, t0: 5.5, dt: 1.1 },
      { gate: 0, kind: 'inf', n: 1, t0: 45.3, dt: 1.6 },
      { gate: 0, kind: 'eng', n: 7, t0: 29.9, dt: 0.4 },
    ],
  },
  // 衝車6・工兵2・盾兵5・歩兵1 を東の口から出し、騎兵1 を南西の隅の口から出す。
  // 東の外の門（35,16）と南の内の門（21,32）を割り、「基本（山城）」の城を時間内に落とす。
  // 行の並びは探した作戦のまま（平山城と同じく、並べ替えたりまとめたりしない）
  yama: {
    gates: [
      { x: W - 1, y: 21 },
      { x: 0, y: 39 },
    ],
    rows: [
      { gate: 0, kind: 'ram', n: 6, t0: 0, dt: 0.05 },
      { gate: 0, kind: 'shd', n: 3, t0: 53.4, dt: 0.15 },
      { gate: 0, kind: 'eng', n: 2, t0: 1.3, dt: 0.9 },
      { gate: 1, kind: 'cav', n: 1, t0: 50.3, dt: 0.7 },
      { gate: 0, kind: 'shd', n: 2, t0: 5.8, dt: 2 },
      { gate: 0, kind: 'inf', n: 1, t0: 56.6, dt: 0.2 },
    ],
  },
};

export function basicSiege(id: PresetId): Draft {
  return structuredClone({ version: 1, ...SIEGES[id] });
}
