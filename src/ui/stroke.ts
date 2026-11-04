// ---- なぞって置く・消す ---------------------------------------------------
// 城壁と消去を、盤面をなぞって続けて置く・消すときに、どのマスに当てるかを決める（画面の操作から切り離した計算）。
// - 最後に当てたマスから今のマスまでの間を、縦横につながるように埋める（速く動かして1回の動きで2マス以上進んでも、塀に穴が空かないように）
// - Shift を押しているあいだは、始点から縦か横の一直線にだけ当てる。向きは、始点から多く動いた方。
//   途中で押したら、そのときのマスを始点にする。離せば、ふつうのなぞりに戻る
export interface Cell {
  x: number;
  y: number;
}
export interface Stroke {
  from: Cell; // 始点（なぞり始めのマスか、Shift を押したときのマス）
  last: Cell; // 最後に当てたマス
  shift: boolean; // 前の動きで Shift を押していたか
}

// なぞり始め。始めのマスには、呼ぶ側が先に当てる
export const startStroke = (at: Cell, shift: boolean): Stroke => ({
  from: { x: at.x, y: at.y },
  last: { x: at.x, y: at.y },
  shift,
});

// 今のマス p まで進める。当てるマスを、順に返す（最後に当てたマスは含めない）。st を書き換える
export function strokeTo(st: Stroke, p: Cell, shift: boolean): Cell[] {
  if (shift && !st.shift) st.from = { ...st.last };
  st.shift = shift;
  let from = st.last;
  let to = p;
  if (shift) {
    const a = st.from;
    const across = Math.abs(p.x - a.x) >= Math.abs(p.y - a.y);
    to = across ? { x: p.x, y: a.y } : { x: a.x, y: p.y };
    // 最後に当てたマスが今の向きの線の上になければ（向きが変わったとき）、始点から引く
    if (across ? from.y !== a.y : from.x !== a.x) from = a;
  }
  const out: Cell[] = [];
  let { x, y } = from;
  while (x !== to.x || y !== to.y) {
    if (Math.abs(to.x - x) >= Math.abs(to.y - y)) x += Math.sign(to.x - x);
    else y += Math.sign(to.y - y);
    out.push({ x, y });
  }
  st.last = { x: to.x, y: to.y };
  return out;
}
