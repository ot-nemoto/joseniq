import { describe, expect, it } from 'vitest';
import { GENERAL_ORDER, H, HALL, HALL_MARGIN, LIMITS, MAX_GENERALS, MAX_HEIGHT, W } from './defs';
import {
  checkMove,
  cloneLayout,
  countOf,
  emptyLayout,
  GATES_REQUIRED,
  isWater,
  type Layout,
  moveBuilding,
  notReady,
  occAt,
  place,
  putGeneral,
  removeGeneral,
  validate,
} from './layout';
import { preset } from './presets';
import { MAPS } from './terrain';

describe('配置の制限', () => {
  it('施設は上限までしか置けない', () => {
    const l = emptyLayout();
    // 城域の2行目に、櫓（弓）を上限まで並べる
    for (let i = 0; i < LIMITS.tbow; i++) expect(place(l, 'tbow', 2 + i, 2)).toEqual({ ok: true });
    const r = place(l, 'tbow', 2 + LIMITS.tbow, 2);
    expect(r.ok).toBe(false);
    expect(countOf(l, 'tbow')).toBe(LIMITS.tbow);
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
    expect(place(l, 'brave', 3, 5).ok).toBe(false);
    expect(countOf(l, 'brave')).toBe(1);
  });

  it('城域の外と、ほかの配置の上には置けない', () => {
    const l = emptyLayout();
    expect(place(l, 'wall', 0, 0).ok).toBe(false);
    expect(place(l, 'wall', 5, 5).ok).toBe(true);
    expect(place(l, 'tbow', 5, 5).ok).toBe(false);
  });

  it('堀は城域の外側3マスにだけ置ける', () => {
    const l = emptyLayout();
    expect(place(l, 'moat', 2, 2).ok).toBe(true);
    expect(place(l, 'moat', 8, 8).ok).toBe(false);
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
    const l = emptyLayout();
    place(l, 'tbow', 3, 3);
    place(l, 'wall', 5, 5);
    place(l, 'brave', 6, 6);
    const i = at(l, 3, 3);
    expect(moveBuilding(l, i, 4, 4)).toEqual({ ok: true });
    expect(l.buildings[i]).toEqual({ type: 'tbow', x: 4, y: 4 });
    expect(moveBuilding(l, i, 5, 5).ok).toBe(false);
    expect(moveBuilding(l, i, 6, 6).ok).toBe(false);
    expect(moveBuilding(l, i, 0, 0).ok).toBe(false);
    expect(moveBuilding(l, i, HALL.x, HALL.y).ok).toBe(false);
    // 動かせなかったときは、元の位置のまま
    expect(l.buildings[i]).toEqual({ type: 'tbow', x: 4, y: 4 });
    expect(countOf(l, 'tbow')).toBe(1);
  });

  it('上限まで置いていても、置いた施設は動かせる', () => {
    const l = emptyLayout();
    for (let i = 0; i < LIMITS.tgun; i++) place(l, 'tgun', 2 + i, 2);
    expect(moveBuilding(l, at(l, 2, 2), 2, 8).ok).toBe(true);
    expect(countOf(l, 'tgun')).toBe(LIMITS.tgun);
  });

  it('堀は外側の3マスの中でだけ動かせる', () => {
    const l = emptyLayout();
    place(l, 'moat', 1, 5);
    const i = at(l, 1, 5);
    expect(moveBuilding(l, i, 3, 5).ok).toBe(true);
    expect(moveBuilding(l, i, 8, 5).ok).toBe(false);
    expect(l.buildings[i]).toEqual({ type: 'moat', x: 3, y: 5 });
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
    place(l, 'wall', 10, 10);
    // 本丸の4マスのどれかが城壁と重なる
    expect(moveBuilding(l, 0, 9, 9)).toEqual({ ok: false, msg: '他の配置と重なります' });
    expect(l.buildings[0]).toEqual({ type: 'hall', x: HALL.x, y: HALL.y });
    // 自分の今の位置と少し重なる所へは動かせる
    expect(moveBuilding(l, 0, HALL.x + 1, HALL.y).ok).toBe(true);
  });

  it('置けるかを確かめる checkMove は、配置を書き換えない（ドラッグ中の影を描くたびに呼ぶため）', () => {
    const l = emptyLayout();
    place(l, 'tbow', 3, 3);
    place(l, 'wall', 5, 5);
    const before = cloneLayout(l);
    expect(checkMove(l, at(l, 3, 3), 4, 4).ok).toBe(true);
    expect(checkMove(l, at(l, 3, 3), 5, 5).ok).toBe(false);
    expect(l).toEqual(before);
  });

  it('動かしても、施設の並び順は変わらない', () => {
    const l = emptyLayout();
    place(l, 'wall', 2, 2);
    place(l, 'tbow', 3, 2);
    place(l, 'cata', 4, 2);
    expect(moveBuilding(l, at(l, 2, 2), 2, 9).ok).toBe(true);
    expect(l.buildings.map((b) => b.type)).toEqual(['hall', 'wall', 'tbow', 'cata']);
  });
});

describe('配置データの読み込み', () => {
  it.each(MAPS.map((m) => m.id))('編成例「基本（%s）」は、地形ごとそのまま読み込める', (id) => {
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

  it('本丸がない配置は読み込む（あとで置く）。本丸が2つや、端に近すぎる配置は読み込まない。中央以外でも置ける範囲なら読み込む', () => {
    expect(validate({ buildings: [], generals: [] })).toEqual({ buildings: [], generals: [] });
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

describe('攻城を始められるか（門と本丸への道）', () => {
  const swap = (l: Layout, f: (b: Layout['buildings'][number]) => boolean, type: 'wall' | 'gate') => ({
    ...l,
    buildings: l.buildings.map((b) => (f(b) ? { ...b, type } : b)),
  });
  // 本丸からの近さ（チェビシェフ距離）。編成例の門のうち、近い2つが本丸の郭の門、遠い3つが外郭の門
  const hallOfL = (l: Layout) => l.buildings.find((b) => b.type === 'hall') ?? { x: HALL.x, y: HALL.y };
  const fromHall = (l: Layout, x: number, y: number) => {
    const h = hallOfL(l);
    return Math.max(Math.abs(x - (h.x + 0.5)), Math.abs(y - (h.y + 0.5)));
  };
  const gatesByDist = (l: Layout) =>
    l.buildings.filter((b) => b.type === 'gate').sort((a, b) => fromHall(l, a.x, a.y) - fromHall(l, b.x, b.y));
  // 城域のいちばん外側の列（堀の帯より外）で、何も置いていない陸のマス（囲いの外）。門を置き直す先にする
  const outsideSpots = (l: Layout, n: number) => {
    const out: [number, number][] = [];
    for (let y = 2; y < H - 2 && out.length < n; y += 2) if (!occAt(l, 1, y) && !isWater(l, 1, y)) out.push([1, y]);
    return out;
  };
  it.each(MAPS.map((m) => m.id))(
    `「基本（%s）」の城は、門が ${GATES_REQUIRED} つあり、本丸まで門を通る道がある`,
    (id) => {
      const l = preset(id);
      expect(countOf(l, 'gate')).toBe(GATES_REQUIRED);
      expect(notReady(l)).toBeNull();
    },
  );
  it('門が足りなければ始められない', () => {
    const l = preset('flat');
    const i = l.buildings.findIndex((b) => b.type === 'gate');
    l.buildings.splice(i, 1);
    expect(notReady(l)).toMatch(`${GATES_REQUIRED - 1} / ${GATES_REQUIRED}`);
  });
  it.each(MAPS.map((m) => m.id))('「基本（%s）」：門を壁にし、門を囲いの外に置き直すと始められない', (id) => {
    const walled = swap(preset(id), (b) => b.type === 'gate', 'wall');
    const l = {
      ...walled,
      buildings: [
        ...walled.buildings,
        ...outsideSpots(walled, GATES_REQUIRED).map(([x, y]) => ({ type: 'gate' as const, x, y })),
      ],
    };
    expect(countOf(l, 'gate')).toBe(GATES_REQUIRED);
    expect(notReady(l)).toMatch('本丸へ通じる道がありません');
  });
  it.each(MAPS.map((m) => m.id))('「基本（%s）」：外の囲いに門があっても、内の囲いに門がなければ始められない', (id) => {
    const base = preset(id);
    // 本丸に近い2つの門（本丸の郭の門）を壁にし、その分を囲いの外に置く
    const inner = gatesByDist(base).slice(0, 2);
    const l = swap(base, (b) => inner.includes(b), 'wall');
    l.buildings.push(...outsideSpots(l, inner.length).map(([x, y]) => ({ type: 'gate' as const, x, y })));
    expect(countOf(l, 'gate')).toBe(GATES_REQUIRED);
    expect(notReady(l)).toMatch('本丸へ通じる道がありません');
  });
  // 外郭は川や崖に面した所で城壁を省くので、閉じているとは限らない。閉じている本丸の郭の門で確かめる
  it.each(MAPS.map((m) => m.id))('「基本（%s）」：本丸の郭の門のまわりを壁で塞ぐと始められない', (id) => {
    const l = preset(id);
    // 本丸に近い2つの門（本丸の郭の門）の、空いた隣をすべて壁で塞ぐ
    for (const g of gatesByDist(l).slice(0, 2))
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const x = g.x + dx;
        const y = g.y + dy;
        if (!occAt(l, x, y) && !isWater(l, x, y)) l.buildings.push({ type: 'wall', x, y });
      }
    expect(notReady(l)).toMatch('本丸へ通じる道がありません');
  });
});
