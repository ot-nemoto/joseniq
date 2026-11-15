// 道筋：攻め手が外から本丸の郭まで通る門の並び。城壁は壊せないので、道筋は門で決まり、選べる道は数本しかない。
// 作戦の行（部隊）ごとに道筋を選べるようにするため、配置から道筋を数え上げ、押した門から道筋を決める
import { H, W } from './defs';
import { inB, inRing, isInt } from './geometry';
import { fpOf, heightAt, isCliff, type Layout } from './layout';

export type GatePos = readonly [number, number]; // 門のマス (x, y)
export interface GateRoute {
  gates: GatePos[]; // 外から順に通る門
  entries: GatePos[]; // 門ごとの、入る側の前のマス（幟を立てる所）
  from: number; // 最初の門の前の区画（城の外）。行の口がこの区画になければ、その行には選べない（regionAt で比べる）
}

const NEXT4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
const AXES = [
  [-1, 0, 1, 0],
  [0, -1, 0, 1],
] as const;
// 数え上げる道筋の上限（門の多い城で、組み合わせが増えすぎないように）
export const ROUTE_LIMIT = 300;
// 数え上げで門をたどる回数の上限（本丸の郭に着かない道が多い城で、探すのが長引かないように）
const ROUTE_STEPS = 20000;

// 区画：建物（門も）と崖で区切った、縦横に歩いてつながるマスのまとまり。川と堀は渡れるので区切らない。
// edge は外周の出撃口のマスを含む区画（城の外）、hall は本丸に崖をはさまずに面した区画
function regionsOf(l: Layout) {
  const blocked = new Uint8Array(W * H);
  let hall: { x0: number; y0: number; w: number; h: number } | null = null;
  for (const b of l.buildings) {
    const f = fpOf(b);
    if (b.type === 'hall') hall = f;
    for (let y = f.y0; y < f.y0 + f.h; y++) for (let x = f.x0; x < f.x0 + f.w; x++) blocked[y * W + x] = 1;
  }
  const region = new Int32Array(W * H).fill(-1);
  const edge: boolean[] = [];
  const hallSide: boolean[] = [];
  for (let i = 0; i < W * H; i++) {
    if (blocked[i] || region[i] >= 0) continue;
    const r = edge.length;
    edge.push(false);
    hallSide.push(false);
    region[i] = r;
    const queue = [i];
    for (let q = 0; q < queue.length; q++) {
      const k = queue[q];
      const x = k % W;
      const y = (k / W) | 0;
      if (inRing(x, y)) edge[r] = true;
      for (const [dx, dy] of NEXT4) {
        const nx = x + dx;
        const ny = y + dy;
        const n = ny * W + nx;
        if (!inB(nx, ny) || blocked[n] || region[n] >= 0) continue;
        if (isCliff(heightAt(l, x, y), heightAt(l, nx, ny))) continue;
        region[n] = r;
        queue.push(n);
      }
    }
  }
  if (hall)
    for (let y = hall.y0; y < hall.y0 + hall.h; y++)
      for (let x = hall.x0; x < hall.x0 + hall.w; x++)
        for (const [dx, dy] of NEXT4) {
          const nx = x + dx;
          const ny = y + dy;
          if (!inB(nx, ny) || blocked[ny * W + nx] || isCliff(heightAt(l, x, y), heightAt(l, nx, ny))) continue;
          hallSide[region[ny * W + nx]] = true;
        }
  return { region, edge, hallSide };
}

// 配置から道筋を数え上げる。門には、縦か横の向きで、前のマスから入って後ろのマスへ抜ける（門の前後は空いたマスで、崖をはさまない）。
// 外の区画（城の外）から最初の門に入り、門を抜けた区画から次の門に入り…と進み、本丸に面した区画へ抜けたら1本。
// 同じ門・同じ区画は2度通らない（外へ出て戻る遠回りや、本丸から離れていく道を数えないため）
export function routesOf(l: Layout, limit = ROUTE_LIMIT): GateRoute[] {
  const { region, edge, hallSide } = regionsOf(l);
  const gates = l.buildings.filter((b) => b.type === 'gate');
  // 両端が門の橋（川の橋・堀）：縦か横の向きで、前後がどちらも門の、水のマスか橋のマス。開戦前の確かめと同じく、
  // 2つの門を、郭から郭へ渡る1つの口とみなす。橋のマスは城の外の区画にあるが、門を抜けてこの橋に出たら、反対の門へ渡るだけにする
  // （区画の番号のあとに、橋ごとの番号を振る）
  const gateAt = new Set(gates.map((b) => b.y * W + b.x));
  const spanOf = new Map<number, number>();
  for (let k = 0; k < W * H; k++) {
    if (region[k] < 0 || !(l.water?.[k] || l.moat?.[k] || l.bridge?.[k])) continue;
    const x = k % W;
    const y = (k / W) | 0;
    if (AXES.some(([ax, ay, bx, by]) => gateAt.has((y + ay) * W + x + ax) && gateAt.has((y + by) * W + x + bx)))
      spanOf.set(k, edge.length + spanOf.size);
  }
  // 門ごとの通り方（入る前のマス・抜けた後のマスと、それぞれの区画）。rspan は、入る前のマスが両端が門の橋なら、その橋の番号
  const ways: { g: number; entry: number; rin: number; rspan: number; rout: number }[] = [];
  gates.forEach((b, g) => {
    for (const [ax, ay, bx, by] of AXES) {
      const ends = [
        [b.x + ax, b.y + ay],
        [b.x + bx, b.y + by],
      ];
      if (
        ends.some(([x, y]) => !inB(x, y) || region[y * W + x] < 0 || isCliff(heightAt(l, b.x, b.y), heightAt(l, x, y)))
      )
        continue;
      const [p, q] = ends.map(([x, y]) => y * W + x);
      const way = (a: number, b: number) => ({
        g,
        entry: a,
        rin: region[a],
        rspan: spanOf.get(a) ?? -1,
        rout: spanOf.get(b) ?? region[b],
      });
      ways.push(way(p, q), way(q, p));
    }
  });
  // 区画（または橋）ごとの、そこから入れる門の通り方
  const from = new Map<number, (typeof ways)[number][]>();
  for (const n of ways) {
    const k = n.rspan >= 0 ? n.rspan : n.rin;
    from.set(k, [...(from.get(k) ?? []), n]);
  }
  const out: GateRoute[] = [];
  const pos = (k: number): GatePos => [k % W, (k / W) | 0];
  const usedGate = new Set<number>();
  const usedRegion = new Set<number>();
  const stack: (typeof ways)[number][] = [];
  let steps = 0;
  const walk = (w: (typeof ways)[number]) => {
    if (out.length >= limit || ++steps > ROUTE_STEPS || usedGate.has(w.g) || usedRegion.has(w.rout)) return;
    usedGate.add(w.g);
    usedRegion.add(w.rout);
    stack.push(w);
    if (w.rout < hallSide.length && hallSide[w.rout])
      out.push({
        gates: stack.map((s) => [gates[s.g].x, gates[s.g].y]),
        entries: stack.map((s) => pos(s.entry)),
        from: stack[0].rin,
      });
    else for (const n of from.get(w.rout) ?? []) walk(n);
    stack.pop();
    usedRegion.delete(w.rout);
    usedGate.delete(w.g);
  };
  for (const w of ways) {
    if (!edge[w.rin] || hallSide[w.rin]) continue;
    usedRegion.add(w.rin);
    walk(w);
    usedRegion.delete(w.rin);
  }
  return out;
}

const keyOf = (p: GatePos) => `${p[0]},${p[1]}`;
// 押した門から、道筋を決める。道筋は「押した門だけを通る道」で、押した門だけで外から本丸の郭までつながれば確定。
// つながらなくても、押した門を通る道筋が1本しかなければ、残りの門をそろえて確定する。
// fits は押した門をみな通る道筋（選択中に、次に押せる門を出すのに使う）
// fill が false なら、残りの門をそろえない（押した門を外したとき。そろえると、外した門がまた入ってしまうため）
export function routeChoice(routes: readonly GateRoute[], picked: readonly GatePos[], fill = true) {
  const want = new Set(picked.map(keyOf));
  const fits = routes.filter((r) => [...want].every((k) => r.gates.some((g) => keyOf(g) === k)));
  const exact = fits.find((r) => r.gates.length === want.size);
  const done = want.size ? (exact ?? (fill && fits.length === 1 ? fits[0] : null)) : null;
  return { done, fits };
}
// 門の並びが、数え上げた道筋のどれかと同じなら、その道筋（作戦の読み込みや、配置を変えたあとの確かめに使う）
export function findRoute(routes: readonly GateRoute[], gates: readonly GatePos[]) {
  return (
    routes.find((r) => r.gates.length === gates.length && r.gates.every((g, i) => keyOf(g) === keyOf(gates[i]))) ?? null
  );
}

// 記録から道筋（門の並び）を読む。なければ undefined、形が違えば null（読み込みを止める）。
// 配置と合うかは、読み込んだあとで確かめる（findRoute。合わなければ、おまかせに戻す）
export function parseRoute(o: unknown): GatePos[] | null | undefined {
  if (o === undefined) return undefined;
  if (!Array.isArray(o) || !o.length || o.length > W * H) return null;
  const out: GatePos[] = [];
  for (const p of o as unknown[]) {
    if (!Array.isArray(p) || p.length !== 2 || !isInt(p[0]) || !isInt(p[1]) || !inB(p[0], p[1])) return null;
    out.push([p[0], p[1]]);
  }
  return out;
}

// 盤面の (x, y) のマスの区画（道筋の from と比べ、行の口から行ける道筋かを見る。建物のマスなら -1）
export function regionAt(l: Layout, x: number, y: number) {
  return inB(x, y) ? regionsOf(l).region[y * W + x] : -1;
}
