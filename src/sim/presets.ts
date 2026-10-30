import { TEMPLATES } from './auto';
import { type BuildingType, H, W } from './defs';
import type { Layout } from './layout';
import type { Draft } from './plan';
import { PRESET_DATA } from './presetData';
import type { MapId } from './terrain';

// ---- 編成例 -------------------------------------------------------------
// 地形の型ごとの「基本」の城（平城・平山城・山城）。地形（高さ・川・橋）ごと、決まった城を再現する（データは presetData.ts）
// 名前は地図の型（MapId）で受け取る。画面のボタンの値のように型の決まらない名前は、呼ぶ側で isMapId を確かめる
// （知らない名前で、今の地形や配置を消さないため）
export function preset(name: MapId): Layout {
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
// 基本：編成例（auto.ts の TEMPLATES）の「盾と弓兵」を、南東の角の近くの口から出す作戦。決まり（兵力・武将の人数）に合った作戦の見本。
// 口が今の地形で出撃口にできない所（平地でない・川）なら、開戦前に近くの出撃口にできる所へ寄せる（app.ts の snapGates）。
// 防衛の編成例の城は、どの攻め方にも防衛側が勝つことを目指して組むので、この作戦で落とせるとは限らない
// 編成例の本丸の郭（内の囲い）の門
export function presetInnerGates(name: MapId): { x: number; y: number }[] {
  return PRESET_DATA[name].innerGates.map((i) => ({ x: i % W, y: (i / W) | 0 }));
}

export function basicSiege(): Draft {
  return {
    version: 1,
    gates: [{ x: W - 1, y: H - 3 }],
    rows: TEMPLATES[0].steps.map((s) => ({ gate: 0, kind: s.kind, n: s.n, t0: s.t0, dt: s.dt })),
  };
}
