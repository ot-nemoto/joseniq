import { describe, expect, it } from 'vitest';
import { type Cell, startStroke, strokeTo } from './stroke';

// なぞりを、マウスが通ったマスの並び（[x, y, Shift]）で進め、当てたマスを、当てた順にまとめて返す
function run(start: Cell, moves: [number, number, boolean][], shift = false): string[] {
  const st = startStroke(start, shift);
  const out = [`${start.x},${start.y}`];
  for (const [x, y, sh] of moves) for (const c of strokeTo(st, { x, y }, sh)) out.push(`${c.x},${c.y}`);
  return out;
}

describe('なぞって置く・消す（stroke）', () => {
  it('隣のマスへ1つずつ動けば、通ったマスにそのまま当てる', () => {
    expect(
      run({ x: 5, y: 5 }, [
        [6, 5, false],
        [6, 6, false],
      ]),
    ).toEqual(['5,5', '6,5', '6,6']);
  });

  it('速く動かして間のマスを飛ばしても、縦横につながるように埋める', () => {
    expect(run({ x: 5, y: 5 }, [[9, 5, false]])).toEqual(['5,5', '6,5', '7,5', '8,5', '9,5']);
    // 斜めに飛んでも、斜めだけでつながる所を作らない（塀に穴が空かない）
    const diag = run({ x: 0, y: 0 }, [[2, 2, false]]);
    expect(diag).toEqual(['0,0', '1,0', '1,1', '2,1', '2,2']);
    for (let i = 1; i < diag.length; i++) {
      const [ax, ay] = diag[i - 1].split(',').map(Number);
      const [bx, by] = diag[i].split(',').map(Number);
      expect(Math.abs(ax - bx) + Math.abs(ay - by)).toBe(1);
    }
  });

  it('Shift を押しながらなぞると、始点から多く動いた向きの一直線にだけ当てる', () => {
    // 横へ多く動けば横の線。手がぶれて縦にずれても、始点の行から外れない
    expect(
      run(
        { x: 5, y: 5 },
        [
          [6, 6, true],
          [8, 4, true],
          [9, 6, true],
        ],
        true,
      ),
    ).toEqual(['5,5', '6,5', '7,5', '8,5', '9,5']);
    // 縦へ多く動けば縦の線
    expect(
      run(
        { x: 5, y: 5 },
        [
          [6, 7, true],
          [4, 8, true],
        ],
        true,
      ),
    ).toEqual(['5,5', '5,6', '5,7', '5,8']);
  });

  it('Shift のまま向きが変わったら、始点から新しい向きの線を引く（前の線は残す）', () => {
    expect(
      run(
        { x: 5, y: 5 },
        [
          [7, 5, true],
          [5, 9, true],
        ],
        true,
      ),
    ).toEqual(['5,5', '6,5', '7,5', '5,6', '5,7', '5,8', '5,9']);
  });

  it('途中で Shift を押したら、そのときのマスを始点にする。離せば、ふつうのなぞりに戻る', () => {
    expect(
      run({ x: 0, y: 0 }, [
        [0, 2, false], // ふつうに下へ
        [3, 3, true], // ここで Shift：始点は (0,2)。横へ多く動いたので、2行目の横の線
        [4, 2, true],
        [4, 4, false], // 離したので、最後のマスからそのまま下へ
      ]),
    ).toEqual(['0,0', '0,1', '0,2', '1,2', '2,2', '3,2', '4,2', '4,3', '4,4']);
  });
});
