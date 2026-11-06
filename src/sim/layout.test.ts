import { describe, expect, it } from 'vitest';
import { BDEF, GDEF, GENERAL_ORDER, H, HALL, HALL_MARGIN, LIMITS, MAX_GENERALS, MAX_HEIGHT, W, ZONE } from './defs';
import {
  blockedGates,
  castleShape,
  checkMove,
  cloneLayout,
  countOf,
  ESCAPE_ANGLE,
  ESCAPE_ROUTES,
  emptyLayout,
  gatesDone,
  hallPos,
  hallReachable,
  heightAt,
  isCliff,
  isWater,
  KURUWA_LAND,
  LAND_PER_POINT,
  type Layout,
  moveBuilding,
  notReady,
  occAt,
  type PlaceResult,
  place,
  putGeneral,
  removeGeneral,
  unmannedFacilities,
  validate,
  WALL_PER_GATE,
} from './layout';
import { isPresetId, PRESET_IDS, type PresetId, preset, presetInnerGates } from './presets';

// 郭のある城：本丸（盤面の真ん中）から8マスの塀1重で囲み、北と南に門を置く。塀の中（x 13〜28、y 13〜28）が郭になり、
// 大筒・鼓楼・鐘楼を置ける（施設は、郭の中か塀の線にしか置けないため）
function walledCastle() {
  const l = emptyLayout();
  const x1 = HALL.x - 8;
  const x2 = HALL.x + HALL.w - 1 + 8;
  const y1 = HALL.y - 8;
  const y2 = HALL.y + HALL.h - 1 + 8;
  for (let x = x1; x <= x2; x++)
    for (const y of [y1, y2])
      l.buildings.push({
        type: x === HALL.x && y === y1 ? 'gate' : x === HALL.x + 3 && y === y2 ? 'gate' : 'wall',
        x,
        y,
      });
  for (let y = y1 + 1; y < y2; y++) for (const x of [x1, x2]) l.buildings.push({ type: 'wall', x, y });
  return l;
}

// 城域の左上から、本丸を避けて城壁を n 個並べる
function fillWalls(l: Layout, n: number) {
  for (let y = ZONE.y0; y <= ZONE.y1 && countOf(l, 'wall') < n; y++)
    for (let x = ZONE.x0; x <= ZONE.x1 && countOf(l, 'wall') < n; x++) place(l, 'wall', x, y);
}

describe('配置の制限', () => {
  it('城壁には数の上限がない（城域の外周をひと回りする数より多く置ける）', () => {
    const l = emptyLayout();
    fillWalls(l, 300);
    expect(countOf(l, 'wall')).toBe(300);
    expect(place(l, 'wall', 5, 30).ok).toBe(true);
  });
  it('櫓・大筒・鼓楼・鐘楼には数の上限がなく、郭の点数まで置ける', () => {
    const l = walledCastle();
    // 郭の中の15行目・17行目に、大筒を1マスおきに、置けなくなるまで並べる
    let last: PlaceResult = { ok: true };
    for (const y of [15, 17]) for (let x = 14; x <= 28 && last.ok; x += 2) last = place(l, 'cata', x, y);
    expect(countOf(l, 'cata')).toBeGreaterThan(4);
    expect(last).toMatchObject({ ok: false, msg: expect.stringContaining('点数が足りません') });
  });

  it(`武将は全体で ${MAX_GENERALS} 人までしか置けない`, () => {
    const l = emptyLayout();
    GENERAL_ORDER.slice(0, MAX_GENERALS).forEach((k, i) => {
      expect(place(l, k, 2 + i, 5)).toEqual({ ok: true });
    });
    const r = place(l, GENERAL_ORDER[MAX_GENERALS], 2 + MAX_GENERALS, 5);
    expect(r).toEqual({ ok: false, msg: `武将は${MAX_GENERALS}人までです` });
    expect(l.generals).toHaveLength(MAX_GENERALS);
  });

  it('同じ武将は1人しか置けない', () => {
    const l = emptyLayout();
    expect(place(l, 'brave', 2, 5).ok).toBe(true);
    expect(place(l, 'brave', 3, 5)).toEqual({ ok: false, msg: `${GDEF.brave.busho}は最大${LIMITS.brave}までです` });
    expect(countOf(l, 'brave')).toBe(1);
  });

  it('城域の外と、ほかの配置の上には置けない', () => {
    const l = emptyLayout();
    expect(place(l, 'wall', 0, 0).ok).toBe(false);
    expect(place(l, 'wall', 5, 5).ok).toBe(true);
    expect(place(l, 'tbow', 5, 5).ok).toBe(false);
  });

  it('ほかの配置に重なると、なぞって置ける城壁も、ほかの施設と同じく理由を返す（黙るかは画面の側で決める）', () => {
    const l = emptyLayout();
    expect(place(l, 'wall', 2, 2).ok).toBe(true);
    expect(putGeneral(l, 'brave', 3, 2)).toEqual({ ok: true });
    for (const tool of ['wall', 'drum'] as const) {
      expect(place(l, tool, 2, 2)).toEqual({ ok: false, msg: '他の配置と重なります' });
      expect(place(l, tool, 3, 2)).toEqual({ ok: false, msg: '他の配置と重なります' });
    }
  });

  it('本丸は消せ、また置ける。2つ目は置けない', () => {
    const l = emptyLayout();
    expect(place(l, 'erase', HALL.x, HALL.y)).toEqual({ ok: true });
    expect(l.buildings.some((b) => b.type === 'hall')).toBe(false);
    expect(notReady(l)).toBe('本丸を置いてください');
    expect(place(l, 'hall', HALL.x, HALL.y)).toEqual({ ok: true });
    expect(place(l, 'hall', HALL.x - 4, HALL.y).ok).toBe(false);
    expect(countOf(l, 'hall')).toBe(1);
  });
  it('本丸は段をまたいで置けない。同じ高さの4マスなら高台にも置ける', () => {
    const heights = Array.from({ length: W * H }, (_, i) => (i % W >= HALL.x + 1 ? 1 : 0));
    const l = { ...emptyLayout(), heights, buildings: [] };
    // 左の列が高さ0、右の列が高さ1になる所
    expect(place(l, 'hall', HALL.x, HALL.y)).toEqual({ ok: false, msg: '本丸は、段をまたがない平らな所に置きます' });
    expect(place(l, 'hall', HALL.x + 2, HALL.y)).toEqual({ ok: true });
    // つかんで段をまたぐ所へ動かすこともできない
    expect(moveBuilding(l, 0, HALL.x, HALL.y).ok).toBe(false);
    // 段をまたいだ本丸のある配置は読み込まない
    expect(validate({ ...l, buildings: [{ type: 'hall', x: HALL.x, y: HALL.y }] })).toBeNull();
  });
  it('川の上には、施設も本丸も置けない', () => {
    const l = emptyLayout();
    l.water = new Array(W * H).fill(0);
    l.water[10 * W + 10] = 1;
    expect(place(l, 'wall', 10, 10)).toEqual({ ok: false, msg: '川の上には置けません' });
    l.buildings = [];
    expect(place(l, 'hall', 9, 9)).toEqual({ ok: false, msg: '川の上には置けません' });
  });
});

describe('武将の出し入れと移動', () => {
  it('盤面にいない武将は、置いたマスに出る', () => {
    const l = emptyLayout();
    expect(putGeneral(l, 'brave', 3, 3)).toEqual({ ok: true });
    expect(l.generals).toEqual([{ kind: 'brave', x: 3, y: 3 }]);
  });

  it(`${MAX_GENERALS} 人置いたら、それ以上は置けない`, () => {
    const l = emptyLayout();
    GENERAL_ORDER.slice(0, MAX_GENERALS).forEach((k, i) => {
      expect(putGeneral(l, k, 2 + i, 5).ok).toBe(true);
    });
    expect(putGeneral(l, GENERAL_ORDER[MAX_GENERALS], 9, 5).ok).toBe(false);
    expect(l.generals).toHaveLength(MAX_GENERALS);
  });

  it('外すと盤面から消え、ほかの武将はそのまま', () => {
    const l = emptyLayout();
    putGeneral(l, 'brave', 3, 3);
    putGeneral(l, 'archer', 4, 3);
    removeGeneral(l, 'brave');
    expect(l.generals.map((g) => g.kind)).toEqual(['archer']);
  });

  it('置いた武将は、空いているマスには動かせて、ふさがったマスや城域の外には動かせない', () => {
    const l = emptyLayout();
    place(l, 'brave', 3, 3);
    place(l, 'wall', 5, 5);
    expect(putGeneral(l, 'brave', 4, 4)).toEqual({ ok: true });
    expect(l.generals).toEqual([{ kind: 'brave', x: 4, y: 4 }]);
    expect(putGeneral(l, 'brave', 5, 5).ok).toBe(false);
    expect(putGeneral(l, 'brave', 0, 0).ok).toBe(false);
    expect(putGeneral(l, 'brave', HALL.x, HALL.y).ok).toBe(false);
    // 動かせなかったときは、元の位置のまま
    expect(l.generals).toEqual([{ kind: 'brave', x: 4, y: 4 }]);
    // 同じマスに戻すのは置ける
    expect(putGeneral(l, 'brave', 4, 4).ok).toBe(true);
  });

  it('動かしても、武将の並び順は変わらない（戦闘での順番になるため）', () => {
    const l = emptyLayout();
    putGeneral(l, 'brave', 2, 5);
    putGeneral(l, 'archer', 3, 5);
    putGeneral(l, 'sage', 4, 5);
    expect(putGeneral(l, 'brave', 2, 8).ok).toBe(true);
    expect(putGeneral(l, 'archer', HALL.x, HALL.y).ok).toBe(false);
    expect(l.generals).toEqual([
      { kind: 'brave', x: 2, y: 8 },
      { kind: 'archer', x: 3, y: 5 },
      { kind: 'sage', x: 4, y: 5 },
    ]);
  });

  it(`${MAX_GENERALS} 人置いていても、置いた武将は動かせる`, () => {
    const l = emptyLayout();
    GENERAL_ORDER.slice(0, MAX_GENERALS).forEach((k, i) => {
      putGeneral(l, k, 2 + i, 5);
    });
    expect(putGeneral(l, GENERAL_ORDER[0], 2, 8).ok).toBe(true);
  });

  it('消去の道具では、武将は消えない（施設は消える）', () => {
    const l = emptyLayout();
    place(l, 'brave', 3, 3);
    place(l, 'wall', 4, 4);
    expect(place(l, 'erase', 3, 3).ok).toBe(false);
    expect(place(l, 'erase', 4, 4).ok).toBe(true);
    expect(l.generals).toHaveLength(1);
    expect(countOf(l, 'wall')).toBe(0);
  });
});

describe('施設をドラッグで動かす', () => {
  const at = (l: ReturnType<typeof emptyLayout>, x: number, y: number) =>
    l.buildings.findIndex((b) => b.x === x && b.y === y);

  it('空いているマスには動かせて、ふさがったマスや城域の外には動かせない', () => {
    const l = walledCastle();
    place(l, 'drum', 15, 15);
    place(l, 'wall', 17, 17);
    place(l, 'brave', 18, 18);
    const i = at(l, 15, 15);
    expect(moveBuilding(l, i, 16, 16)).toEqual({ ok: true });
    expect(l.buildings[i]).toEqual({ type: 'drum', x: 16, y: 16 });
    expect(moveBuilding(l, i, 17, 17).ok).toBe(false);
    expect(moveBuilding(l, i, 18, 18).ok).toBe(false);
    expect(moveBuilding(l, i, 0, 0).ok).toBe(false);
    expect(moveBuilding(l, i, HALL.x, HALL.y).ok).toBe(false);
    // 動かせなかったときは、元の位置のまま
    expect(l.buildings[i]).toEqual({ type: 'drum', x: 16, y: 16 });
    expect(countOf(l, 'drum')).toBe(1);
  });

  it('上限まで置いていても、置いた施設は動かせる（上限のある本丸で確かめる）', () => {
    const l = emptyLayout();
    expect(countOf(l, 'hall')).toBe(LIMITS.hall);
    expect(place(l, 'hall', 5, 30).ok).toBe(false);
    expect(moveBuilding(l, at(l, HALL.x, HALL.y), 10, 10).ok).toBe(true);
    expect(countOf(l, 'hall')).toBe(LIMITS.hall);
  });

  it(`本丸は、盤面の端から ${HALL_MARGIN} マス以上内側なら動かせる`, () => {
    const l = emptyLayout();
    expect(moveBuilding(l, at(l, HALL.x, HALL.y), HALL_MARGIN, HALL_MARGIN)).toEqual({ ok: true });
    expect(l.buildings).toEqual([{ type: 'hall', x: HALL_MARGIN, y: HALL_MARGIN }]);
    // 右下の端：4マスの右下が、端から HALL_MARGIN の所まで
    const far = W - HALL_MARGIN - HALL.w;
    expect(moveBuilding(l, 0, far, H - HALL_MARGIN - HALL.h).ok).toBe(true);
  });

  it('本丸は、端に近すぎる所や、ほかの配置と重なる所には動かせない（元のまま）', () => {
    const l = emptyLayout();
    const msg = `本丸は、盤面の端から${HALL_MARGIN}マス以上内側に置きます`;
    expect(moveBuilding(l, 0, HALL_MARGIN - 1, HALL.y)).toEqual({ ok: false, msg });
    expect(moveBuilding(l, 0, W - HALL_MARGIN - HALL.w + 1, HALL.y)).toEqual({ ok: false, msg });
    // 右下をつかんで盤面の端の列に離すと、左上が盤面の外になる。そこでも同じ理由を返す
    expect(moveBuilding(l, 0, -1, HALL.y)).toEqual({ ok: false, msg });
    expect(moveBuilding(l, 0, HALL.x, -1)).toEqual({ ok: false, msg });
    place(l, 'wall', 10, 10);
    // 本丸の4マスのどれかが城壁と重なる
    expect(moveBuilding(l, 0, 9, 9)).toEqual({ ok: false, msg: '他の配置と重なります' });
    expect(l.buildings[0]).toEqual({ type: 'hall', x: HALL.x, y: HALL.y });
    // 自分の今の位置と少し重なる所へは動かせる
    expect(moveBuilding(l, 0, HALL.x + 1, HALL.y).ok).toBe(true);
  });

  it('置けるかを確かめる checkMove は、配置を書き換えない（ドラッグ中の影を描くたびに呼ぶため）', () => {
    const l = walledCastle();
    place(l, 'drum', 15, 15);
    place(l, 'wall', 17, 17);
    const before = cloneLayout(l);
    expect(checkMove(l, at(l, 15, 15), 16, 16).ok).toBe(true);
    expect(checkMove(l, at(l, 15, 15), 17, 17).ok).toBe(false);
    expect(l).toEqual(before);
  });

  it('動かしても、施設の並び順は変わらない', () => {
    const l = walledCastle();
    place(l, 'wall', 15, 15);
    place(l, 'drum', 17, 15);
    place(l, 'cata', 19, 15);
    expect(moveBuilding(l, at(l, 15, 15), 15, 25).ok).toBe(true);
    expect(l.buildings.slice(-3).map((b) => b.type)).toEqual(['wall', 'drum', 'cata']);
  });
});

describe('配置データの読み込み', () => {
  it.each(PRESET_IDS)('編成例「基本（%s）」は、地形ごとそのまま読み込める', (id) => {
    const l = preset(id);
    expect(validate(cloneLayout(l))).toEqual(l);
  });

  it(`武将は ${MAX_GENERALS} 人までなら読み込み、超えると読み込まない`, () => {
    const at = (n: number) => {
      const l = emptyLayout();
      l.generals = GENERAL_ORDER.slice(0, n).map((kind, i) => ({ kind, x: 2 + i, y: 5 }));
      return l;
    };
    // 同じ置き方で人数だけを変え、上限の判定だけで結果が分かれることを確かめる
    expect(validate(at(MAX_GENERALS))).toEqual(at(MAX_GENERALS));
    expect(validate(at(MAX_GENERALS + 1))).toBeNull();
  });

  it('城壁は数によらず読み込む（前の上限の160を超えても）', () => {
    const l = emptyLayout();
    fillWalls(l, 300);
    expect(validate(cloneLayout(l))).toEqual(l);
  });

  it('同じ武将が2人いる配置は読み込まない', () => {
    const twice = emptyLayout();
    twice.generals = [
      { kind: 'brave', x: 2, y: 5 },
      { kind: 'brave', x: 3, y: 5 },
    ];
    expect(validate(twice)).toBeNull();
  });

  it('本丸がない配置は読み込む（あとで置く）。本丸が2つや、端に近すぎる配置は読み込まない。中央以外でも置ける範囲なら読み込む', () => {
    expect(validate({ buildings: [], generals: [] })).toEqual({ buildings: [], generals: [] });
    // 外した武将（前田利家・服部半蔵）の入った古いデータは、その武将だけを飛ばして読む
    expect(
      validate({
        buildings: [],
        generals: [
          { kind: 'spear', x: HALL.x, y: HALL.y - 3 },
          { kind: 'ninja', x: HALL.x + 1, y: HALL.y - 3 },
          { kind: 'brave', x: HALL.x + 2, y: HALL.y - 3 },
        ],
      }),
    ).toEqual({ buildings: [], generals: [{ kind: 'brave', x: HALL.x + 2, y: HALL.y - 3 }] });
    // 堀は今は外しているので、堀の入った古いデータは、堀だけを飛ばして読む
    expect(validate({ buildings: [{ type: 'moat', x: 2, y: 2 }], generals: [] })).toEqual({
      buildings: [],
      generals: [],
    });
    expect(
      validate({
        buildings: [
          { type: 'hall', x: HALL.x, y: HALL.y },
          { type: 'hall', x: HALL.x - 4, y: HALL.y },
        ],
        generals: [],
      }),
    ).toBeNull();
    expect(validate({ buildings: [{ type: 'hall', x: HALL_MARGIN - 1, y: HALL.y }], generals: [] })).toBeNull();
    const moved = { buildings: [{ type: 'hall', x: HALL_MARGIN, y: HALL.y + 3 }], generals: [] };
    expect(validate(moved)).toEqual(moved);
  });
});

describe('地形の高さ', () => {
  it('配置データの保存と読み込みで、地形の高さと地図の型の名前がそのまま残る。高さのない配置は平らとして読む', () => {
    // 本丸の4マスは平らにし、ほかはでこぼこにする
    const onHall = (i: number) => {
      const x = i % W;
      const y = (i / W) | 0;
      return x >= HALL.x && x < HALL.x + HALL.w && y >= HALL.y && y < HALL.y + HALL.h;
    };
    const l = {
      ...emptyLayout(),
      heights: Array.from({ length: W * H }, (_, i) => (onHall(i) ? 0 : i % 3)),
      map: 'hirayama',
    };
    expect(validate(JSON.parse(JSON.stringify(l)))).toEqual(l);
    expect(validate(JSON.parse(JSON.stringify(emptyLayout())))?.heights).toBeUndefined();
  });
  it('高さが範囲の外・数が違う地形は読み込まない', () => {
    expect(validate({ ...emptyLayout(), heights: new Array(W * H).fill(MAX_HEIGHT + 1) })).toBeNull();
    expect(validate({ ...emptyLayout(), heights: [0, 1] })).toBeNull();
  });
});

const NEXT4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
// 斜めを含む8つの隣
const NEXT8 = [...NEXT4, [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
describe('塀と郭（塀の線・広い土地・施設）', () => {
  // 本丸（盤面の真ん中）から d マス外の四角の周りに城壁を巡らせ、gates の位置（周りの番号）を門にする
  const ring = (l: Layout, d: number, gates: number[]) => {
    const x1 = HALL.x - d;
    const x2 = HALL.x + HALL.w - 1 + d;
    const y1 = HALL.y - d;
    const y2 = HALL.y + HALL.h - 1 + d;
    const tiles: [number, number][] = [];
    for (let x = x1; x <= x2; x++) tiles.push([x, y1]);
    for (let y = y1 + 1; y <= y2; y++) tiles.push([x2, y]);
    for (let x = x2 - 1; x >= x1; x--) tiles.push([x, y2]);
    for (let y = y2 - 1; y > y1; y--) tiles.push([x1, y]);
    for (const [i, [x, y]] of tiles.entries()) l.buildings.push({ type: gates.includes(i) ? 'gate' : 'wall', x, y });
  };
  // 二の丸（本丸から5マスの塀の内）と三の丸（本丸から11マスの塀との間）を持つ城。門は内に2つ、外に3つ
  const twoRings = () => {
    const l = emptyLayout();
    ring(l, 5, [3, 30]);
    ring(l, 11, [6, 30, 54]);
    return l;
  };

  it('平城+ は、塀が2重で、郭ごとの広い土地・施設・門が決まりを満たす', () => {
    const c = castleShape(preset('flatPlus'));
    expect(c.kuruwa).toHaveLength(2);
    for (const info of c.kuruwa) {
      expect(info.land).toBeGreaterThanOrEqual(KURUWA_LAND);
      expect(info.used).toBeLessThanOrEqual(info.points);
      expect(info.points).toBe(Math.floor(info.land / LAND_PER_POINT));
    }
    expect(c.bad).toEqual([]);
    expect(notReady(preset('flatPlus'))).toBeNull();
  });
  it('本丸が塀の中になければ始められない', () => {
    // 平城から城壁をすべて外す（門は野原に残る）
    const l = preset('flat');
    l.buildings = l.buildings.filter((b) => b.type !== 'wall');
    expect(castleShape(l).hallOutside).toBe(true);
    expect(notReady(l)).toMatch('本丸が塀の中にありません');
  });
  it('両側が同じ郭（城の外）の城壁は、塀の線にない', () => {
    // 平城+ の城の外（西の野原）に、城壁を1つ置く
    const l = preset('flatPlus');
    l.buildings.push({ type: 'wall', x: 5, y: 35 });
    expect(castleShape(l).offLine).toEqual([{ type: 'wall', x: 5, y: 35 }]);
    expect(notReady(l)).toMatch('塀の線にない城壁・門・櫓があります（1か所');
  });
  it('塀に隙間があると、外の塀は両側が城の外になり、塀の線にない', () => {
    // 平城の外郭は、西の橋 (4,25) の出口 (5,24〜26) を城壁でふさいで閉じている。ふさぎを外すと、外郭の中が城の外になる
    const l = preset('flat');
    l.buildings = l.buildings.filter((b) => !(b.type === 'wall' && b.x === 5 && b.y >= 24 && b.y <= 26));
    expect(castleShape(l).offLine).toContainEqual({ type: 'gate', x: 10, y: 7 });
  });
  it('塀の線に置いた大筒・鼓楼・鐘楼は、外れる', () => {
    // 平城+ の外の塀（西）の城壁を1つ、鼓楼にする
    const l = preset('flatPlus');
    const i = l.buildings.findIndex((b) => b.type === 'wall' && b.x === 6 && b.y === 33);
    expect(i).toBeGreaterThanOrEqual(0);
    l.buildings[i] = { type: 'drum', x: 6, y: 33 };
    expect(castleShape(l).onLine).toEqual([{ type: 'drum', x: 6, y: 33 }]);
    expect(notReady(l)).toMatch('塀の線に置いた大筒・鼓楼・鐘楼があります');
  });
  it('塀の重ねの数は決めない。1重の城も、郭の決まりを満たせば始められる', () => {
    // 本丸から8マスの塀1重。門は2つ
    const one = emptyLayout();
    ring(one, 8, [5, 40]);
    expect(castleShape(one).kuruwa).toHaveLength(1);
    expect(notReady(one)).toBeNull();
  });
  it('片側が郭で、もう片側が川の城壁（川岸の塀）は、塀の線と認める', () => {
    // 平城+ の二の丸の北（川に面する）に、川岸の城壁を1つ置く
    const l = preset('flatPlus');
    expect(l.water?.[20 * W + 16]).toBe(1);
    l.buildings.push({ type: 'wall', x: 16, y: 21 });
    expect(castleShape(l).offLine).toEqual([]);
  });
  it('崖や川だけで閉じた台地は、郭に数えず、開戦を止めない', () => {
    // 平城+ の城の外（西の野原）に、まわりが崖の高さ2の台地を作る。施設には面していない
    const l = preset('flatPlus');
    l.heights = Array.from({ length: W * H }, (_, i) => {
      const x = i % W;
      const y = (i / W) | 0;
      return x >= 1 && x <= 4 && y >= 30 && y <= 34 ? 2 : 0;
    });
    const c = castleShape(l);
    expect(c.pockets).toBe(0);
    expect(c.kuruwa).toHaveLength(2);
    expect(notReady(l)).toBeNull();
  });
  it('櫓を置くと、ほかの櫓の点数を払う郭が入れ替わって点数を超えるなら、置けない', () => {
    // 二の丸の外を南北の仕切りの塀で東西の出丸に分ける。どちらも二の丸の門から入るので、深さは同じ
    const l = emptyLayout();
    const box = (d: number, gates: [number, number][]) => {
      const x1 = HALL.x - d;
      const x2 = HALL.x + 1 + d;
      const y1 = HALL.y - d;
      const y2 = HALL.y + 1 + d;
      for (let x = x1; x <= x2; x++)
        for (let y = y1; y <= y2; y++)
          if (x === x1 || x === x2 || y === y1 || y === y2)
            l.buildings.push({ type: gates.some(([gx, gy]) => gx === x && gy === y) ? 'gate' : 'wall', x, y });
    };
    box(5, [
      [HALL.x - 5, HALL.y],
      [HALL.x + 6, HALL.y],
    ]);
    box(11, [
      [HALL.x - 11, HALL.y],
      [HALL.x - 11, HALL.y + 1],
      [HALL.x + 12, HALL.y],
      [HALL.x + 12, HALL.y + 1],
    ]);
    for (let y = HALL.y - 10; y <= HALL.y - 6; y++) l.buildings.push({ type: 'wall', x: HALL.x, y });
    for (let y = HALL.y + 7; y <= HALL.y + 11; y++) l.buildings.push({ type: 'wall', x: HALL.x, y });
    const at = () => {
      const c = castleShape(l);
      return Object.fromEntries(c.kuruwa.map((k) => [k.name, k.points - k.used]));
    };
    expect(at()).toEqual({ 二の丸: 9, 出丸一: 16, 出丸二: 17 });
    // 外側の塀の櫓で、残りの点数を西（出丸一）2・東（出丸二）4 にする
    for (let y = HALL.y - 9; y <= HALL.y - 3; y++) expect(place(l, 'tbow', HALL.x - 11, y).ok).toBe(true);
    for (let y = HALL.y - 9; y <= HALL.y - 7; y++) expect(place(l, 'tgun', HALL.x + 12, y).ok).toBe(true);
    for (let y = HALL.y - 6; y <= HALL.y - 5; y++) expect(place(l, 'tbow', HALL.x + 12, y).ok).toBe(true);
    expect(at()).toEqual({ 二の丸: 9, 出丸一: 2, 出丸二: 4 });
    // 南の仕切りの鉄砲櫓は、残りの多い東が払う
    expect(place(l, 'tgun', HALL.x, HALL.y + 9).ok).toBe(true);
    expect(at()).toEqual({ 二の丸: 9, 出丸一: 2, 出丸二: 1 });
    // 北の仕切りは配置の並びで南より前にある。弓櫓を置くと、弓櫓が先に東を使い、鉄砲櫓が西に移って西が足りなくなる
    const r = place(l, 'tbow', HALL.x, HALL.y - 8);
    expect(r).toMatchObject({ ok: false, msg: expect.stringContaining('出丸一の点数が足りなくなります') });
    expect(l.buildings.find((b) => b.x === HALL.x && b.y === HALL.y - 8)?.type).toBe('wall');
  });
  it('出撃できるのに城の門へ行けない城の外があると、始められない', () => {
    // 平城+ の北に、盤面の西の端から東の端まで城壁を一本引く。その北は城の外のまま切り離され、城の門がない
    const l = preset('flatPlus');
    for (let x = 0; x < W; x++) l.buildings.push({ type: 'wall', x, y: 5 });
    const c = castleShape(l);
    expect(c.cutOffs).toBe(1);
    // 北の端の出撃口のそばは、城の門へ行けない城の外
    expect(c.cutOff[0 * W + 27]).toBe(1);
    expect(notReady(l)).toMatch('城の門へ歩いて行けない城の外があります');
    expect(castleShape(preset('flatPlus')).cutOffs).toBe(0);
  });
  it('本丸を囲まない郭（出丸）も、郭の決まりを満たせば認める', () => {
    // 郭のある城（塀は x 12〜29）の東に、x 29〜40・y 14〜26 の塀で出丸を作る。城との間の塀と、外の塀に門を1つずつ
    const l = walledCastle();
    for (let x = 30; x <= 40; x++) l.buildings.push({ type: 'wall', x, y: 14 }, { type: 'wall', x, y: 26 });
    for (let y = 15; y <= 25; y++) l.buildings.push({ type: 'wall', x: 40, y });
    for (const [x, y] of [
      [29, 20],
      [40, 20],
    ]) {
      const i = l.buildings.findIndex((b) => b.type === 'wall' && b.x === x && b.y === y);
      l.buildings[i] = { type: 'gate', x, y };
    }
    const c = castleShape(l);
    expect(c.kuruwa.map((info) => [info.name, info.surround])).toEqual([
      ['二の丸', true],
      ['出丸', false],
    ]);
    expect(c.kuruwa[1].land).toBeGreaterThanOrEqual(KURUWA_LAND);
    expect(c.bad).toEqual([]);
    expect(notReady(l)).toBeNull();
  });
  it('一本道を門で仕切ると、仕切りの奥の小部屋も郭として数え、門や土地の決まりに外れる', () => {
    // 二の丸・三の丸の城の三の丸に、二の丸の塀から南へ続く一本道を作り（南の端は三の丸に開ける）、門で仕切ると、
    // 仕切りの奥の小部屋が、門を通って入る3つ目の郭になる
    const l = twoRings();
    for (let y = HALL.y + 7; y <= HALL.y + 10; y++)
      l.buildings.push({ type: 'wall', x: HALL.x - 1, y }, { type: 'wall', x: HALL.x + 2, y });
    l.buildings.push({ type: 'gate', x: HALL.x, y: HALL.y + 9 }, { type: 'wall', x: HALL.x + 1, y: HALL.y + 9 });
    const c = castleShape(l);
    // 小部屋は、三の丸から門を通って入る、本丸を囲まない郭（出丸）。門は入る門の1つだけで、広い土地もない
    expect(c.kuruwa).toHaveLength(3);
    expect(c.kuruwa[2]).toMatchObject({ name: '出丸', surround: false, land: 0 });
  });
  // 平城+ の外の塀の西（x=6）の城壁のうち、門や櫓から離れた1つ
  const westWall = (l: Layout) => {
    const w = l.buildings.find((b) => b.type === 'wall' && b.x === 6 && b.y >= 32 && b.y <= 38);
    if (!w) throw new Error('外の塀の西に城壁がない');
    return w;
  };
  it('門・櫓は、塀の城壁の上に置き、その城壁を置き換える。塀の線にない城壁の上には置けない', () => {
    const l = preset('flatPlus');
    // 城壁のない野原には置けない
    expect(place(l, 'gate', 5, 35)).toEqual({
      ok: false,
      msg: '門は、塀（城壁）の上に置きます。先に城壁で塀を作ってください',
    });
    // 帯曲輪の中に置いた城壁（塀の線にない）の上にも置けない
    l.buildings.push({ type: 'wall', x: 17, y: 38 });
    expect(place(l, 'gate', 17, 38)).toEqual({
      ok: false,
      msg: '門は、郭を囲む塀の線（両側が別の郭か城の外になる所）に置きます',
    });
    // 外の塀の西の城壁の上なら置け、その城壁が門に変わる
    const w = westWall(l);
    const walls = countOf(l, 'wall');
    expect(place(l, 'gate', w.x, w.y)).toEqual({ ok: true });
    expect(occAt(l, w.x, w.y)).toMatchObject({ k: 'b' });
    expect(countOf(l, 'wall')).toBe(walls - 1);
    expect(l.buildings).toContainEqual({ type: 'gate', x: w.x, y: w.y });
  });
  it('塀の上の門・櫓は、消すと城壁に戻り、動かすと動かした先の城壁と入れ替わる', () => {
    // 郭はあるが施設のない城の、西の塀の城壁
    const l = walledCastle();
    const w = { x: HALL.x - 8, y: HALL.y };
    expect(place(l, 'tbow', w.x, w.y)).toEqual({ ok: true });
    expect(l.buildings).toContainEqual({ type: 'tbow', x: w.x, y: w.y });
    // 消すと城壁に戻る
    expect(place(l, 'erase', w.x, w.y)).toEqual({ ok: true });
    expect(l.buildings).toContainEqual({ type: 'wall', x: w.x, y: w.y });
    // 弓櫓を置き直して、同じ塀の2つ南の城壁へ動かすと、元の所は城壁に戻る
    place(l, 'tbow', w.x, w.y);
    const i = l.buildings.findIndex((b) => b.type === 'tbow' && b.x === w.x && b.y === w.y);
    const to = l.buildings.find((b) => b.type === 'wall' && b.x === w.x && b.y === w.y + 2);
    if (!to) throw new Error('動かす先の城壁がない');
    expect(moveBuilding(l, i, to.x, to.y)).toEqual({ ok: true });
    expect(l.buildings).toContainEqual({ type: 'wall', x: w.x, y: w.y });
    expect(l.buildings).toContainEqual({ type: 'tbow', x: to.x, y: to.y });
  });
  it('櫓は塀の線に、大筒・鼓楼・鐘楼は郭の中にだけ置け、郭の施設の数を超えては置けない', () => {
    const l = preset('flatPlus');
    expect(place(l, 'tbow', 5, 35).ok).toBe(false);
    // 郭（塀で囲んだ中）の外には、大筒も置けない
    const bare = emptyLayout();
    expect(place(bare, 'cata', 5, 5)).toEqual({ ok: false, msg: '施設は、郭（塀で囲んだ中）に置きます' });
    // 平城+ の二の丸は、点数をもう使い切っている
    expect(place(l, 'cata', 29, 31)).toMatchObject({
      ok: false,
      msg: expect.stringContaining(`二の丸の点数が足りません（大筒は ${BDEF.cata.cost} 点`),
    });
    // 外の塀の西の城壁を外して、その隙間に大筒を置くと、塀の線になるので置けない
    const w = westWall(l);
    l.buildings.splice(l.buildings.indexOf(w), 1);
    expect(place(l, 'cata', w.x, w.y)).toEqual({
      ok: false,
      msg: '大筒・鼓楼・鐘楼は、塀の線ではなく郭の中に置きます',
    });
  });
  it('郭ごとに、広い土地・施設の点数を数える', () => {
    const l = twoRings();
    const c = castleShape(l);
    expect(c.kuruwa.map((info) => info.name)).toEqual(['二の丸', '三の丸']);
    // 二の丸は、本丸から5マスの塀の内なので、本丸のまわりに3×3の空き地がとれる
    expect(c.kuruwa[0].land).toBeGreaterThan(0);
    // 三の丸の広い土地は、二の丸とは別に数える
    expect(c.kuruwa[1].land).toBeGreaterThan(0);
    expect(c.kuruwa[0].land + c.kuruwa[1].land).toBe(c.land.reduce((a, b) => a + b, 0));
    // 二の丸の塀（内側の塀）の上の櫓は、二の丸の点数を使う
    const i = l.buildings.findIndex((b) => b.type === 'wall' && b.x === HALL.x - 5 && b.y === HALL.y);
    l.buildings[i] = { type: 'tbow', x: HALL.x - 5, y: HALL.y };
    expect(castleShape(l).kuruwa.map((info) => info.used)).toEqual([BDEF.tbow.cost, 0]);
  });
  it('郭の広い土地が足りない、施設が点数を超えた郭があると始められない', () => {
    // 本丸から5マスの塀の二の丸は、広い土地が KURUWA_LAND に届かない
    expect(notReady(twoRings())).toMatch(`二の丸の広い土地が足りません`);
    // 平城+ の二の丸の中に、大筒を足すと、二の丸の点数を超える
    const l = preset('flatPlus');
    l.buildings.push({ type: 'cata', x: 29, y: 31 });
    const c = castleShape(l);
    expect(c.kuruwa[0].used).toBeGreaterThan(c.kuruwa[0].points);
    expect(c.over).toContainEqual({ type: 'cata', x: 29, y: 31 });
    expect(notReady(l)).toMatch('二の丸の施設が点数を超えています');
  });
  it('崖や川だけで閉じた、本丸を囲まない台地は、郭の土地に数えない', () => {
    // 平城+ の城の外（西の野原）に、まわりを崖で閉じた5×5の台地を作る
    const l = preset('flatPlus');
    l.heights = Array.from({ length: W * H }, (_, i) => {
      const x = i % W;
      const y = (i / W) | 0;
      return x >= 1 && x <= 4 && y >= 30 && y <= 34 ? 2 : 0;
    });
    expect(castleShape(l).kuruwa.map((info) => info.land)).toEqual(
      castleShape(preset('flatPlus')).kuruwa.map((info) => info.land),
    );
  });
  it('崖の上の本丸は、崖の下の城の外に面していても、塀の中にある。崖の下の城壁は、塀の線にない', () => {
    // 本丸と、その北・東・南の郭を高さ2の台地にし、北・東・南を城壁で囲む。西は崖（高さ0）で、外につながる
    const hx = HALL.x;
    const hy = HALL.y;
    const l = emptyLayout();
    l.heights = Array.from({ length: W * H }, (_, i) => {
      const x = i % W;
      const y = (i / W) | 0;
      if (x < hx) return 0;
      return x <= hx + 3 && y >= hy - 2 && y <= hy + 3 ? 2 : 1;
    });
    for (let x = hx; x <= hx + 3; x++) l.buildings.push({ type: 'wall', x, y: hy - 2 }, { type: 'wall', x, y: hy + 3 });
    for (let y = hy - 1; y <= hy + 2; y++) l.buildings.push({ type: 'wall', x: hx + 3, y });
    expect(castleShape(l).hallOutside).toBe(false);
    expect(castleShape(l).offLine).toEqual([]);
    // 崖の下（高さ0）に置いた城壁は、崖の上の郭と隣り合っていても、両側とも城の外
    l.buildings.push({ type: 'wall', x: hx - 1, y: hy - 1 });
    expect(castleShape(l).offLine).toEqual([{ type: 'wall', x: hx - 1, y: hy - 1 }]);
  });
});

describe('逃げ道と外の門', () => {
  // 本丸から d マス外の四角の塀。gates は門にするマス
  const wallAt = (l: Layout, d: number, gates: [number, number][]) => {
    const x1 = HALL.x - d;
    const x2 = HALL.x + HALL.w - 1 + d;
    const y1 = HALL.y - d;
    const y2 = HALL.y + HALL.h - 1 + d;
    const isGate = (x: number, y: number) => gates.some(([gx, gy]) => gx === x && gy === y);
    const put = (x: number, y: number) => l.buildings.push({ type: isGate(x, y) ? 'gate' : 'wall', x, y });
    for (let x = x1; x <= x2; x++) for (const y of [y1, y2]) put(x, y);
    for (let y = y1 + 1; y < y2; y++) for (const x of [x1, x2]) put(x, y);
  };
  const N = (d: number, dx = 0): [number, number] => [HALL.x + dx, HALL.y - d];
  const S = (d: number, dx = 0): [number, number] => [HALL.x + dx, HALL.y + HALL.h - 1 + d];

  it('平城+ は、別々の門を通る2本の逃げ道を持つ', () => {
    const c = castleShape(preset('flatPlus'));
    expect(c).toMatchObject({ routes: 2, routesApart: true, outerGates: 2, gatesNeed: 2 });
    expect(c.outerWall).toBeGreaterThan(WALL_PER_GATE);
  });
  it('外の門が1つなら、内の門が2つあっても、最後の門が同じなので1本', () => {
    const l = preset('flatPlus');
    const i = l.buildings.findIndex((b) => b.x === 40 && b.y === 21);
    l.buildings[i] = { type: 'wall', x: 40, y: 21 };
    expect(castleShape(l).routes).toBe(1);
    expect(notReady(l)).toMatch('逃げ道が足りません（今は 1 / 2 本）');
  });
  it('途中まで同じ門を通るなら、外の門が2つあっても1本', () => {
    const l = emptyLayout();
    wallAt(l, 5, [N(5)]);
    wallAt(l, 11, [N(11), S(11)]);
    expect(castleShape(l)).toMatchObject({ routes: 1, outerGates: 2 });
  });
  it('2本が同じ郭の中を通るのは認める', () => {
    const l = emptyLayout();
    wallAt(l, 5, [N(5), S(5)]);
    wallAt(l, 11, [N(11), S(11)]);
    expect(castleShape(l)).toMatchObject({ routes: 2, routesApart: true });
  });
  it('外の門が隣り合わせなら、2本あっても開いていないので始められない', () => {
    const l = emptyLayout();
    wallAt(l, 8, [N(8), N(8, 2)]);
    expect(castleShape(l)).toMatchObject({ routes: 2, routesApart: false });
    expect(gatesDone(l)).toBe(false);
    expect(notReady(l)).toMatch(`本丸から見て ${ESCAPE_ANGLE} 度以上開いた2か所`);
  });
  it('開いた外の門の組が同じ門を通るなら、ほかの組で2本取れても認めない', () => {
    // 帯を北東の角で仕切る。北東の小部屋には内の門 Q から入り、外の門 B がある。
    // 残りの帯には内の門（南）から入り、外の門 A（北）と C（東）がある。A と C は開いているが、同じ内の門を通る。
    // A と B、B と C は別の道だが、開いていない
    const l = emptyLayout();
    wallAt(l, 5, [S(5), [HALL.x + 5, HALL.y - 5]]);
    wallAt(l, 11, [N(11, -1), [HALL.x + 9, HALL.y - 11], [HALL.x + HALL.w - 1 + 11, HALL.y + 1]]);
    for (let y = HALL.y - 10; y <= HALL.y - 6; y++) l.buildings.push({ type: 'wall', x: HALL.x + 3, y });
    for (let x = HALL.x + 7; x <= HALL.x + 11; x++) l.buildings.push({ type: 'wall', x, y: HALL.y - 2 });
    expect(castleShape(l)).toMatchObject({ routes: 2, routesApart: false, outerGates: 3 });
  });
  it('出撃できない城の外へ出る門は、外の門にも逃げ道にも数えない', () => {
    // 南の門の先を川で仕切り、盤面の端まで高くする（城の外の区画だが、高い所には出撃できない）
    const l = emptyLayout();
    wallAt(l, 8, [N(8), S(8)]);
    const water = new Array<number>(W * H).fill(0);
    const heights = new Array<number>(W * H).fill(0);
    for (let y = HALL.y + HALL.h + 8; y < H; y++) {
      for (const x of [HALL.x - 3, HALL.x + 4]) water[y * W + x] = 1;
      for (let x = HALL.x - 2; x <= HALL.x + 3; x++) heights[y * W + x] = 1;
    }
    Object.assign(l, { water, heights });
    expect(castleShape(l)).toMatchObject({ routes: 1, outerGates: 1 });
  });
  it('出撃できない城の外を通り抜ける道は、逃げ道に数えない', () => {
    // 南の門の先は出撃できない高い土地。その西の仕切りの門から、出撃できる城の外へ抜けられる形
    const l = emptyLayout();
    wallAt(l, 8, [N(8), S(8)]);
    const water = new Array<number>(W * H).fill(0);
    const heights = new Array<number>(W * H).fill(0);
    const top = HALL.y + HALL.h + 8;
    for (let y = top; y < H; y++) {
      water[y * W + HALL.x + 4] = 1;
      l.buildings.push({ type: y === top + 2 ? 'gate' : 'wall', x: HALL.x - 3, y });
      for (let x = HALL.x - 2; x <= HALL.x + 3; x++) heights[y * W + x] = 1;
    }
    Object.assign(l, { water, heights });
    expect(castleShape(l)).toMatchObject({ routes: 1, outerGates: 1 });
  });
  it('出撃できない城の外に面した塀は、外の塀の長さに数えない', () => {
    const open = emptyLayout();
    wallAt(open, 8, [N(8), S(8)]);
    const l = emptyLayout();
    wallAt(l, 8, [N(8), S(8)]);
    const water = new Array<number>(W * H).fill(0);
    const heights = new Array<number>(W * H).fill(0);
    for (let y = HALL.y + HALL.h + 8; y < H; y++) {
      for (const x of [HALL.x - 3, HALL.x + 4]) water[y * W + x] = 1;
      for (let x = HALL.x - 2; x <= HALL.x + 3; x++) heights[y * W + x] = 1;
    }
    Object.assign(l, { water, heights });
    expect(castleShape(l).outerWall).toBeLessThan(castleShape(open).outerWall);
  });
  it('本丸とつながっていない区画の門は、外の門に数えない。門があっても入れない郭として止まる', () => {
    // 平城+ の北の川の向こうに、城の外から門で入れるだけの区画を足す
    const l = preset('flatPlus');
    for (let x = 25; x <= 31; x++) l.buildings.push({ type: 'wall', x, y: 11 });
    for (let y = 11; y <= 19; y++) l.buildings.push({ type: 'wall', x: 24, y }, { type: 'wall', x: 32, y });
    const g = l.buildings.find((b) => b.x === 24 && b.y === 16);
    if (!g) throw new Error('塀がない');
    g.type = 'gate';
    const c = castleShape(l);
    expect(c).toMatchObject({ pockets: 1, outerGates: 2 });
    expect(notReady(l, c)).toMatch('本丸から門を通って入れない郭があります（1つ）');
  });
  it('行き止まりの郭は、門1つでも、外の門がなくても作れる', () => {
    // 二の丸の北西の隅を塀で仕切った郭。入口は二の丸からの門1つだけ
    const l = walledCastle();
    const x2 = HALL.x - 3;
    const y2 = HALL.y - 3;
    for (let x = HALL.x - 7; x <= x2; x++) l.buildings.push({ type: 'wall', x, y: y2 });
    for (let y = HALL.y - 7; y < y2; y++) l.buildings.push({ type: 'wall', x: x2, y });
    const g = l.buildings.find((b) => b.x === x2 && b.y === y2 - 2);
    if (!g) throw new Error('仕切りがない');
    g.type = 'gate';
    const c = castleShape(l);
    expect(c.pockets).toBe(0);
    expect(c).toMatchObject({ routes: 2, routesApart: true });
    expect(c.kuruwa).toHaveLength(2);
    expect(gatesDone(l, c)).toBe(true);
  });
  it(`城の外に面した塀 ${WALL_PER_GATE} マスにつき1つ、外の門が要る`, () => {
    const l = emptyLayout();
    wallAt(l, 15, [N(15), S(15)]);
    const c = castleShape(l);
    expect(c.outerWall).toBeGreaterThan(WALL_PER_GATE * 2);
    expect(c).toMatchObject({ outerGates: 2, gatesNeed: 3 });
    expect(gatesDone(l, c)).toBe(false);
    expect(notReady(l)).toMatch('城の外へ出る門が足りません（今は 2 / 3）');
  });
});

describe('門を置き終えたか（gatesDone。パネルの門の「必須」の印）', () => {
  // 四角い塀（周りを城壁で囲む）
  const ring = (l: Layout, x1: number, y1: number, x2: number, y2: number) => {
    for (let x = x1; x <= x2; x++) for (const y of [y1, y2]) l.buildings.push({ type: 'wall', x, y });
    for (let y = y1 + 1; y < y2; y++) for (const x of [x1, x2]) l.buildings.push({ type: 'wall', x, y });
  };

  // 門に関わる理由で止まる配置は、どれも開戦前の確かめ（notReady）と印が食い違わないことを見る
  const agrees = (l: Layout, want: RegExp) => {
    expect(gatesDone(l)).toBe(false);
    expect(notReady(l)).toMatch(want);
  };

  it(`逃げ道が ${ESCAPE_ROUTES} 本あれば、置き終えた`, () => {
    expect(gatesDone(walledCastle())).toBe(true);
  });
  it('開戦できる城（平城+）は、置き終えた', () => {
    const l = preset('flatPlus');
    expect(notReady(l)).toBeNull();
    expect(gatesDone(l)).toBe(true);
  });
  it('郭がなければ、まだ', () => {
    expect(gatesDone(emptyLayout())).toBe(false);
  });
  it(`逃げ道が ${ESCAPE_ROUTES} 本に足りなければ、まだ（1つ置いただけでは置き終えない）`, () => {
    const l = walledCastle();
    // 北の門を城壁に戻す
    const north = l.buildings.find((b) => b.type === 'gate');
    if (north) north.type = 'wall';
    expect(countOf(l, 'gate')).toBe(1);
    expect(gatesDone(l)).toBe(false);
  });
  it('外の塀に門がなく、本丸へ通じる道がなければ、まだ', () => {
    const l = walledCastle();
    ring(l, ZONE.x0 + 3, ZONE.y0 + 3, ZONE.x1 - 3, ZONE.y1 - 3);
    const cs = castleShape(l);
    expect(hallReachable(l)).toBe(false);
    expect(gatesDone(l, cs)).toBe(false);
  });
  it('門から入れない郭があれば、まだ。城の中の郭なら、門を置けば置き終える', () => {
    // 二の丸の中を塀で仕切った、門のない郭（x 14〜18、y 14〜18。本丸は囲まない）
    const l = walledCastle();
    ring(l, HALL.x - 6, HALL.y - 6, HALL.x - 2, HALL.y - 2);
    expect(castleShape(l).pockets).toBe(1);
    agrees(l, /本丸から門を通って入れない郭があります/);
    // 仕切りの南と東に門を置くと、二の丸から入れる出丸になる
    for (const [x, y] of [
      [HALL.x - 4, HALL.y - 2],
      [HALL.x - 2, HALL.y - 4],
    ])
      expect(place(l, 'gate', x, y).ok).toBe(true);
    const cs = castleShape(l);
    expect(cs.pockets).toBe(0);
    expect(gatesDone(l, cs)).toBe(true);
  });
  it('城の外の野原に塀で囲った区画（門から入れない郭）があっても、まだ（開戦前の確かめも門を置くよう言う）', () => {
    const l = walledCastle();
    ring(l, ZONE.x0 + 1, ZONE.y0 + 1, ZONE.x0 + 9, ZONE.y0 + 9);
    expect(castleShape(l).pockets).toBe(1);
    agrees(l, /本丸から門を通って入れない郭があります/);
  });
  it('門の数がそろっていても、前後がふさがった門（塀の角の門）があれば、まだ', () => {
    // 南の門を、塀の角へ移す
    const l = walledCastle();
    const south = l.buildings.find((b) => b.type === 'gate' && b.y === HALL.y + HALL.h - 1 + 8);
    const corner = l.buildings.find((b) => b.x === HALL.x - 8 && b.y === HALL.y + HALL.h - 1 + 8);
    if (!south || !corner) throw new Error('塀の形が違う');
    south.type = 'wall';
    corner.type = 'gate';
    agrees(l, /前後がふさがった門があります/);
  });
  it('門へ行けない城の外があれば、まだ', () => {
    // 平城+ の北に、盤面の西の端から東の端まで城壁を一本引く（上の「始められない」と同じ形）
    const l = preset('flatPlus');
    for (let x = 0; x < W; x++) l.buildings.push({ type: 'wall', x, y: 5 });
    agrees(l, /城の門へ歩いて行けない城の外があります/);
  });
  it('本丸が塀の中になければ、郭の門がそろっていても、まだ', () => {
    // 本丸の東の側だけを郭に向け、ほかの3方は城の外のままにする（本丸の東の列が、塀の線に入る）
    const l = emptyLayout();
    const x1 = HALL.x + 1;
    const x2 = HALL.x + 12;
    const y1 = HALL.y - 5;
    const y2 = HALL.y + 6;
    ring(l, x1, y1, x2, y2);
    l.buildings = l.buildings.filter((b) => !(b.x === x1 && b.y >= HALL.y && b.y <= HALL.y + 1));
    for (const y of [y1, y2]) expect(place(l, 'gate', x1 + 5, y).ok).toBe(true);
    const cs = castleShape(l);
    expect(cs.kuruwa.map((k) => k.name)).toEqual(['出丸']);
    expect(cs.hallOutside).toBe(true);
    agrees(l, /本丸が塀の中にありません/);
  });
  it('本丸がなければ、まだ', () => {
    const l = walledCastle();
    l.buildings = l.buildings.filter((b) => b.type !== 'hall');
    expect(gatesDone(l)).toBe(false);
  });
});

describe('攻城を始められるか（門と本丸への道）', () => {
  const swap = (l: Layout, f: (b: Layout['buildings'][number]) => boolean, type: 'wall' | 'gate') => ({
    ...l,
    buildings: l.buildings.map((b) => (f(b) ? { ...b, type } : b)),
  });
  // 編成例の本丸の郭（内の囲い）の門。どれが内の囲いの門かは、編成例のデータが持っている
  const innerOf = (id: PresetId, l: Layout) => {
    const at = presetInnerGates(id);
    return l.buildings.filter((b) => b.type === 'gate' && at.some((g) => g.x === b.x && g.y === b.y));
  };
  // 本丸の郭の中のマス：本丸から、施設（門も）と川と崖をよけて、縦横に歩いて行けるマス
  const insideInner = (l: Layout) => {
    const h = hallPos(l);
    const seen = new Set<number>();
    const q: number[] = [];
    for (let y = h.y; y < h.y + HALL.h; y++)
      for (let x = h.x; x < h.x + HALL.w; x++) {
        seen.add(y * W + x);
        q.push(y * W + x);
      }
    for (let k = 0; k < q.length; k++) {
      const x = q[k] % W;
      const y = (q[k] / W) | 0;
      for (const [dx, dy] of NEXT4) {
        const nx = x + dx;
        const ny = y + dy;
        const j = ny * W + nx;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen.has(j)) continue;
        if (occAt(l, nx, ny) || isWater(l, nx, ny) || isCliff(heightAt(l, x, y), heightAt(l, nx, ny))) continue;
        seen.add(j);
        q.push(j);
      }
    }
    return seen;
  };
  // 城域のいちばん外側の列で、何も置いていない陸のマス（囲いの外）。門を置き直す先にする
  const outsideSpots = (l: Layout, n: number) => {
    const out: [number, number][] = [];
    for (let y = 2; y < H - 2 && out.length < n; y += 2) if (!occAt(l, 1, y) && !isWater(l, 1, y)) out.push([1, y]);
    return out;
  };
  // 塀と郭の決まり（郭ごとの門・広い土地・施設の点数）に合わせて作り直すまで、開戦できない城。
  // 作り直したら、ここから外す
  const REBUILD: PresetId[] = ['flat', 'hirayama', 'yama'];
  it.each(PRESET_IDS.filter((id) => !REBUILD.includes(id)))('「基本（%s）」の城は、開戦できる', (id) => {
    expect(notReady(preset(id))).toBeNull();
  });
  it.each(REBUILD)('「基本（%s）」の城は、作り直すまで開戦できない', (id) => {
    expect(notReady(preset(id))).not.toBeNull();
  });
  it.each(PRESET_IDS)('「基本（%s）」の門は、どれも前後が空いている', (id) => {
    expect(blockedGates(preset(id))).toEqual([]);
  });
  it('門の前後のマスが、門との間で崖になっていれば、空いていないとみなす', () => {
    // 平城の北の門（10,7）の北（10,6）だけを高くする。1段なら通れ、2段なら崖で通れない
    const at = (h: number) => {
      const l = preset('flat');
      l.heights = Array.from({ length: W * H }, (_, i) => (i === 6 * W + 10 ? h : 0));
      return blockedGates(l);
    };
    expect(at(1)).toEqual([]);
    expect(at(2)).toEqual([{ type: 'gate', x: 10, y: 7 }]);
  });
  it('門の前後がふさがっていると始められない。縦か横のどちらかの向きで前後が空いていれば始められる', () => {
    // 平城の北の門（10,7）は、城壁の並びにあり、北（10,6）と南（10,8）が空いている
    const gate = { type: 'gate' as const, x: 10, y: 7 };
    expect(preset('flat').buildings).toContainEqual(gate);
    // 南に弓櫓を置くと、縦の向きの前後がふさがる（横の向きは城壁なので、もとからふさがっている）
    const front = preset('flat');
    front.buildings.push({ type: 'tbow', x: 10, y: 8 });
    expect(blockedGates(front)).toEqual([gate]);
    expect(notReady(front)).toMatch('前後がふさがった門があります（1つ）');
    // 北の外（10,6）を城壁でふさいでも同じ
    const back = preset('flat');
    back.buildings.push({ type: 'wall', x: 10, y: 6 });
    expect(blockedGates(back)).toEqual([gate]);
  });

  it('まわりを城壁で閉じた櫓（守り手が入れない）があると始められない。外に面した櫓には守り手が入れる', () => {
    // 平城の城の外（東の野原）に、弓櫓を1つ足す
    const open = preset('flat');
    open.buildings.push({ type: 'tbow', x: 38, y: 10 });
    expect(unmannedFacilities(open)).toEqual([]);
    // まわり8マスを城壁で閉じると、守り手が入れない
    const closed = preset('flat');
    closed.buildings.push({ type: 'tbow', x: 38, y: 10 });
    for (const [dx, dy] of NEXT8) closed.buildings.push({ type: 'wall', x: 38 + dx, y: 10 + dy });
    expect(unmannedFacilities(closed)).toEqual([{ type: 'tbow', x: 38, y: 10 }]);
    expect(notReady(closed)).toMatch('守り手が入れない施設があります（弓櫓など1つ）');
    // 縦横の4マスだけを閉じても入れない（斜めの隣からは出入りできない）
    const cross = preset('flat');
    cross.buildings.push({ type: 'tbow', x: 38, y: 10 });
    for (const [dx, dy] of NEXT4) cross.buildings.push({ type: 'wall', x: 38 + dx, y: 10 + dy });
    expect(unmannedFacilities(cross)).toHaveLength(1);
  });
  it('櫓が本丸から行けるマスに面していても、その間が崖なら、守り手は入れない', () => {
    // 平城の東の野原の弓櫓を、東（39,10）だけを空けて城壁で囲い、櫓のマスだけを高くする
    const at = (h: number) => {
      const l = preset('flat');
      l.buildings.push({ type: 'tbow', x: 38, y: 10 });
      for (const [dx, dy] of NEXT8)
        if (dx !== 1 || dy !== 0) l.buildings.push({ type: 'wall', x: 38 + dx, y: 10 + dy });
      l.heights = Array.from({ length: W * H }, (_, i) => (i === 10 * W + 38 ? h : 0));
      return unmannedFacilities(l);
    };
    expect(at(1)).toEqual([]);
    expect(at(2)).toHaveLength(1);
  });
  it('櫓が面している空きマスがあっても、そこに本丸から行けなければ、守り手は入れない', () => {
    // 櫓と、その東の1マス（39,10）だけを城壁で囲った小部屋にする。櫓は空きマスに面しているが、小部屋には本丸から行けない
    const l = preset('flat');
    l.buildings.push({ type: 'tbow', x: 38, y: 10 });
    for (let x = 37; x <= 40; x++) for (const y of [9, 11]) l.buildings.push({ type: 'wall', x, y });
    l.buildings.push({ type: 'wall', x: 37, y: 10 }, { type: 'wall', x: 40, y: 10 });
    expect(unmannedFacilities(l)).toHaveLength(1);
  });

  it('「基本（平城+）」は、平城の地形のまま配置だけが違う', () => {
    expect(isPresetId('flatPlus')).toBe(true);
    expect(isPresetId('flat9')).toBe(false);
    const l = preset('flatPlus');
    const flat = preset('flat');
    expect(l.map).toBe('flat');
    expect([l.heights, l.water, l.bridge]).toEqual([flat.heights, flat.water, flat.bridge]);
    expect(l.buildings).not.toEqual(flat.buildings);
    // 本丸の郭（二の丸）の門は、二の丸の塀の西と南の2つ（読み込み・開戦などは「基本」の城の共通のテストで見る）
    expect(presetInnerGates('flatPlus')).toEqual([
      { x: 11, y: 24 },
      { x: 26, y: 35 },
    ]);
  });
  it('内の門を1つにすると、外の門が2つあっても、逃げ道が足りず始められない', () => {
    // 平城+ の二の丸の塀の門2つのうち1つを、城壁にする
    const l = preset('flatPlus');
    const [g] = presetInnerGates('flatPlus');
    const i = l.buildings.findIndex((b) => b.type === 'gate' && b.x === g.x && b.y === g.y);
    l.buildings[i] = { type: 'wall', x: g.x, y: g.y };
    expect(notReady(l)).toMatch(`逃げ道が足りません（今は 1 / ${ESCAPE_ROUTES} 本）`);
  });
  it.each(PRESET_IDS)('「基本（%s）」：門を壁にし、門を囲いの外に置き直すと始められない', (id) => {
    const walled = swap(preset(id), (b) => b.type === 'gate', 'wall');
    const l = {
      ...walled,
      buildings: [
        ...walled.buildings,
        ...outsideSpots(walled, countOf(preset(id), 'gate')).map(([x, y]) => ({ type: 'gate' as const, x, y })),
      ],
    };
    expect(notReady(l)).toMatch('本丸へ通じる道がありません');
  });
  it.each(PRESET_IDS)('「基本（%s）」：外の囲いに門があっても、内の囲いに門がなければ始められない', (id) => {
    const base = preset(id);
    // 本丸の郭の門を壁にし、その分を囲いの外に置く
    const inner = innerOf(id, base);
    expect(inner.length).toBeGreaterThan(0);
    const l = swap(base, (b) => inner.includes(b), 'wall');
    l.buildings.push(...outsideSpots(l, inner.length).map(([x, y]) => ({ type: 'gate' as const, x, y })));
    expect(notReady(l)).toMatch('本丸へ通じる道がありません');
  });
  // 外郭は川や崖に面した所で城壁を省くので、閉じているとは限らない。閉じている本丸の郭の門で確かめる
  it.each(PRESET_IDS)('「基本（%s）」：本丸の郭の門の前（外側）だけを壁で塞ぐと始められない', (id) => {
    // 門の隣のうち、郭の外側にある空いたマスだけを塞ぐ（郭の内側の隣はそのまま）。gates で塞ぐ門を選ぶ
    const blockOutside = (gates: number) => {
      const l = preset(id);
      const inside = insideInner(l);
      let blocked = 0;
      for (const g of innerOf(id, l).slice(0, gates))
        for (const [dx, dy] of NEXT4) {
          const x = g.x + dx;
          const y = g.y + dy;
          if (inside.has(y * W + x) || occAt(l, x, y) || isWater(l, x, y)) continue;
          l.buildings.push({ type: 'wall', x, y });
          blocked++;
        }
      expect(blocked).toBeGreaterThan(0);
      return l;
    };
    // 郭の門が2つ以上なら、1つの門の前だけを塞いでも、ほかの門から入れる（前をふさいだ門があるので、開戦はその決まりで止まる）。
    // 郭の門の前をすべて塞ぐと、本丸へ通じる道がなくなる
    const n = presetInnerGates(id).length;
    if (n > 1) expect(hallReachable(blockOutside(1))).toBe(true);
    expect(notReady(blockOutside(n))).toMatch('本丸へ通じる道がありません');
  });
});
