import { describe, expect, it } from 'vitest';
import { H, W } from './defs';
import { emptyLayout } from './layout';
import { preset } from './presets';
import { findRoute, type GatePos, type GateRoute, routeChoice, routesOf } from './route';

const names = (rs: readonly GateRoute[]) => rs.map((r) => r.gates.map((g) => g.join(',')).join(' → '));

describe('道筋の数え上げ（routesOf）', () => {
  it('平山城：外の門3つ × 内の門2つの6本。幟は門の入る側の前のマス', () => {
    const rs = routesOf(preset('hirayama'));
    expect(names(rs).sort()).toEqual(
      ['22,30 → 17,25', '22,30 → 26,13', '24,9 → 17,25', '24,9 → 26,13', '34,21 → 17,25', '34,21 → 26,13'].sort(),
    );
    const r = rs.find((q) => q.gates[0][0] === 24 && q.gates[1][0] === 26);
    expect(r?.entries).toEqual([
      [24, 8],
      [26, 12],
    ]);
  });
  it('平城：川や堀を渡って橋から入る道と、南の出丸を抜けて橋を渡る道を数える。出丸を逆に抜けて外へ出る遠回りは数えない', () => {
    const rs = routesOf(preset('flat'));
    expect(names(rs).sort()).toEqual(
      [
        '32,9',
        '20,19',
        '40,22 → 29,35 → 20,21 → 20,19',
        '10,40 → 29,35 → 20,21 → 20,19',
        '37,40 → 29,35 → 20,21 → 20,19',
      ].sort(),
    );
    // 川を渡る道の幟は、門の前の橋のマス
    expect(rs.find((r) => r.gates.length === 1 && r.gates[0][0] === 20)?.entries).toEqual([[20, 20]]);
  });
  it('両端が門の引き橋は、出丸の門から本丸の郭の門へ渡る1つの口。堀を渡って引き橋から入る道も数える', () => {
    // 本丸を囲む郭（北の門 20,16）と、その北の出丸（南の門 20,14・北の門 20,9）。間の帯の 20,15 だけが堀
    const l = emptyLayout();
    const ring = (x0: number, y0: number, x1: number, y1: number) => {
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++)
          if (x === x0 || x === x1 || y === y0 || y === y1) l.buildings.push({ type: 'wall', x, y });
    };
    ring(16, 16, 25, 25);
    ring(16, 9, 25, 14);
    for (const b of l.buildings) if (b.x === 20 && (b.y === 16 || b.y === 14 || b.y === 9)) b.type = 'gate';
    l.moat = new Array<number>(W * H).fill(0);
    l.moat[15 * W + 20] = 1;
    expect(names(routesOf(l)).sort()).toEqual(['20,16', '20,9 → 20,14 → 20,16'].sort());
  });
});

describe('押した門から道筋を決める（routeChoice）', () => {
  const flat = routesOf(preset('flat'));
  const pick = (...ps: GatePos[]) => routeChoice(flat, ps);
  it('押した門だけで外から本丸の郭までつながれば確定（橋の上の門だけなら、川を渡る道）', () => {
    expect(pick([20, 19]).done?.gates).toEqual([[20, 19]]);
  });
  it('つながらないうちは選択中。押した門を通る道筋が残り、1本になれば残りの門をそろえて確定', () => {
    const a = pick([20, 19], [20, 21]);
    expect(a.done).toBeNull();
    expect(a.fits).toHaveLength(3);
    expect(pick([20, 19], [20, 21], [10, 40]).done?.gates).toEqual([
      [10, 40],
      [29, 35],
      [20, 21],
      [20, 19],
    ]);
    // 外の門だけでも、その先が1通りならそろえる
    expect(pick([37, 40]).done?.gates).toHaveLength(4);
  });
  it('分かれ道があれば、外の門だけでは決まらない（平山城）。何も押さなければ決まらない', () => {
    const rs = routesOf(preset('hirayama'));
    expect(routeChoice(rs, [[34, 21]]).done).toBeNull();
    expect(routeChoice(rs, [[34, 21]]).fits).toHaveLength(2);
    expect(
      routeChoice(rs, [
        [34, 21],
        [26, 13],
      ]).done?.gates,
    ).toEqual([
      [34, 21],
      [26, 13],
    ]);
    expect(routeChoice(rs, []).done).toBeNull();
  });
  it('門の並びが数え上げた道筋と同じかを確かめる（順が違えば別の道）', () => {
    expect(findRoute(flat, [[20, 19]])?.entries).toEqual([[20, 20]]);
    expect(
      findRoute(flat, [
        [29, 35],
        [10, 40],
        [20, 21],
        [20, 19],
      ]),
    ).toBeNull();
  });
});
