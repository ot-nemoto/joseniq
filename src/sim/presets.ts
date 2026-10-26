import { TEMPLATES } from './auto';
import { type BuildingType, H, W } from './defs';
import { emptyLayout, type Layout } from './layout';
import type { Draft } from './plan';

// ---- 編成例 -------------------------------------------------------------
// 外から 出丸の石垣 → 拒馬 → 外堀（土橋4か所）→ 外郭（櫓（弓）・門3つ）→ 二の丸（大筒）→ 本丸の郭（櫓（鉄砲）・門2つ）→ 本丸。
// 32×32の盤面で、中心に対して上下左右が対称になるように置く（門だけは、外と内で位置をずらす）。
const M = W - 1; // 反対側の座標は M - v
const ringTiles = (a: number) => {
  const b = M - a;
  const r: [number, number][] = [];
  for (let i = a; i <= b; i++) {
    r.push([i, a], [i, b]);
    if (i > a && i < b) r.push([a, i], [b, i]);
  }
  return r;
};

function basicLayout(): Layout {
  const l = emptyLayout();
  const taken = new Set<number>();
  const put = (type: BuildingType, x: number, y: number) => {
    const k = y * W + x;
    if (taken.has(k)) return;
    taken.add(k);
    l.buildings.push({ type, x, y });
  };
  const c = W / 2; // 中央の2マスは c - 1 と c
  // 櫓・施設を先に置き、同じマスの壁は置かない
  const bows = [
    [6, 6],
    [M - 6, 6],
    [6, M - 6],
    [M - 6, M - 6],
    [11, 6],
    [M - 11, 6],
    [11, M - 6],
    [M - 11, M - 6],
    [6, 11],
    [6, M - 11],
    [M - 6, 11],
    [M - 6, M - 11],
  ];
  for (const [x, y] of bows) put('tbow', x, y); // 外郭の四隅と、土橋の両脇に櫓（弓）
  const guns = [
    [11, 11],
    [M - 11, 11],
    [11, M - 11],
    [M - 11, M - 11],
  ];
  for (const [x, y] of guns) put('tgun', x, y); // 本丸の郭の四隅に櫓（鉄砲）
  for (const [x, y] of [
    [c - 1, 8],
    [c, M - 8],
    [8, c],
    [M - 8, c - 1],
  ])
    put('cata', x, y); // 二の丸に大筒
  for (const [x, y] of [
    [13, 13],
    [M - 13, M - 13],
  ])
    put('drum', x, y); // 本丸の郭の対角に鼓楼
  // 外堀（外側3マス以内）。各辺の中ほどに土橋（堀の切れ目）を2マス残す
  const bridge = (x: number, y: number) =>
    (x === 3 || x === M - 3 ? y : x) >= c - 1 && (x === 3 || x === M - 3 ? y : x) <= c;
  for (const [x, y] of ringTiles(3)) if (!bridge(x, y)) put('moat', x, y);
  // 門：外郭の北・東・西の中ほどに3つ、本丸の郭の南と東の上寄りに2つ。外の門から入っても、郭の中を回り込んで内の門へ向かう
  for (const [x, y] of [
    [c - 1, 6],
    [M - 6, c],
    [6, c - 1],
    [c, M - 11],
    [M - 11, 13],
  ])
    put('gate', x, y);
  for (const [x, y] of ringTiles(6)) put('wall', x, y); // 外郭
  for (const [x, y] of ringTiles(11)) put('wall', x, y); // 本丸の郭
  // 堀の外の四隅に、L字の出丸の石垣
  for (const sx of [false, true])
    for (const sy of [false, true])
      for (let i = 1; i <= 6; i++) {
        put('wall', sx ? M - i : i, sy ? H - 2 : 1);
        put('wall', sx ? W - 2 : 1, sy ? M - i : i);
      }
  // 堀の外、土橋の前に拒馬
  for (let i = 10; i <= M - 10; i++)
    for (const [x, y] of [
      [i, 2],
      [i, M - 2],
      [2, i],
      [M - 2, i],
    ])
      put('bar', x, y);
  // 3将は本丸の郭の中に置き、本丸を攻める敵に届くようにする
  l.generals.push(
    { kind: 'brave', x: 13, y: c - 1 },
    { kind: 'archer', x: M - 13, y: c - 2 },
    { kind: 'sage', x: c, y: M - 13 },
  );
  return l;
}

export function preset(name: string): Layout {
  return name === 'basic' ? basicLayout() : emptyLayout();
}

// ---- 攻城配置の編成例 -----------------------------------------------------
// 基本：自動攻城のひな形「盾と弓兵」を、南東の口から出す作戦。決まり（兵力・武将の人数）に合った作戦の見本。
// 「基本」の城は、どの攻め方にも防衛側が勝つことを目指して組むので、この作戦で落とせるとは限らない
export function basicSiege(): Draft {
  return {
    version: 1,
    gates: [{ x: W - 1, y: H - 3 }],
    rows: TEMPLATES[0].steps.map((s) => ({ gate: 0, kind: s.kind, n: s.n, t0: s.t0, dt: s.dt })),
  };
}
