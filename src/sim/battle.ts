import {
  ADEF,
  ALARM_TTL,
  ALERT_EXTRA,
  ALERT_TIME,
  type AttackerKind,
  BDEF,
  BUDGET_A,
  type BuildingType,
  CHARGE_DIST,
  DT,
  GDEF,
  type GeneralKind,
  H,
  MAX_GENERALS,
  REPAIR_RADIUS,
  SHIELD_RADIUS,
  SLOW_RATE,
  TIME_LIMIT,
  UNIT_ORDER,
  W,
  WARD_RADIUS,
} from './defs';
import { clamp, inB, inRing, rectDist, tileIdx } from './geometry';
import { fpOf, type Layout } from './layout';

export type Side = 'a' | 'd';
export type BattleResult = 'win' | 'timeout' | 'wipe';

export interface BuildingEnt {
  id: number;
  isB: true;
  type: BuildingType;
  x0: number;
  y0: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  cd: number;
  fl: number;
}
interface UnitBase {
  id: number;
  isB: false;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  cd: number;
  target: number;
  path: number[];
  repath: number;
  blocker: number;
  fl: number;
  lx: number; // 最後に攻撃した位置（騎馬の武将が駆けた距離を測る）
  ly: number;
}
export interface Cast {
  t: number;
  x: number;
  y: number;
}
export interface Defender extends UnitBase {
  side: 'd';
  kind: GeneralKind;
  hx: number;
  hy: number;
  cast: Cast | null;
  alert: number; // 攻撃の知らせを受けて、持ち場を広く離れられる残り時間
  slow: number; // 弓兵に足止めされている残り時間
}
export interface Attacker extends UnitBase {
  side: 'a';
  kind: AttackerKind;
  cast: Cast | null;
  flee: number; // 囮が下がっている残り時間
}
export type Unit = Defender | Attacker;
export type Entity = BuildingEnt | Unit;

export type Effect =
  | { k: 'arrow'; x1: number; y1: number; x2: number; y2: number; t: number; ttl: number; side: Side }
  | { k: 'hit'; x: number; y: number; t: number; ttl: number }
  | { k: 'fire'; x: number; y: number; r: number; t: number; ttl: number };

export interface Alarm {
  x: number;
  y: number;
  by: number;
  t: number;
}
export interface LogEntry {
  t: number;
  msg: string;
  side: Side;
}
export interface DeployRecord {
  tick: number;
  t: number;
  kind: AttackerKind;
  x: number;
  y: number;
}
export interface BattleStats {
  aLost: number;
  aLostCost: number;
  dKilled: number;
  gTotal: number;
  tTotal: number;
  tDown: number;
  wDown: number;
  spent: number;
}
export interface Battle {
  t: number;
  tick: number;
  started: boolean;
  over: boolean;
  result: BattleResult | null;
  endT: number;
  nextId: number;
  buildings: BuildingEnt[];
  defenders: Defender[];
  attackers: Attacker[];
  effects: Effect[];
  alarms: Alarm[]; // 直近に攻撃された場所と、攻撃した相手
  log: LogEntry[];
  byId: Record<number, Entity>;
  grid: Int32Array;
  moat: Uint8Array;
  abatis: Uint8Array;
  budgetA: number;
  used: Partial<Record<AttackerKind, number>>; // 兵種ごとの出撃数
  hallId: number;
  deployLog: DeployRecord[];
  timeLimit: number;
  stats: BattleStats;
}
export type DeployResult = { ok: true } | { ok: false; msg: string };

function distEnt(x: number, y: number, e: Entity) {
  return e.isB ? rectDist(x, y, e.x0, e.y0, e.w, e.h) : Math.hypot(e.x - x, e.y - y);
}
export const hallOf = (s: Battle) => s.byId[s.hallId] as BuildingEnt;
// 騎兵と騎馬の武将：拒馬を通れず、槍に弱い
const isMounted = (kind: AttackerKind | GeneralKind) => kind === 'cav' || kind === 'rider';
// 忍び：stealth より遠い相手からは狙われない
const visibleFrom = (x: number, y: number, u: Unit) => {
  const st = u.side === 'a' ? ADEF[u.kind].stealth : GDEF[u.kind].stealth;
  return !st || Math.hypot(u.x - x, u.y - y) <= st;
};
// 武将の一撃の倍率：槍は騎馬に強く、騎馬は駆けてきた一撃が重い
function bonusOf(d: { vsMounted?: number; charge?: number }, u: Unit, tg: Entity) {
  let m = 1;
  if (d.vsMounted && !tg.isB && isMounted(tg.kind)) m *= d.vsMounted;
  if (d.charge && Math.hypot(u.x - u.lx, u.y - u.ly) >= CHARGE_DIST) m *= d.charge;
  return m;
}
// 忍び：当てた相手（櫓・守将・兵）の攻撃を遅らせる
function stunTarget(tg: Entity, sec: number) {
  tg.cd = Math.max(tg.cd, sec);
}
const tileOf = (x: number, y: number) => tileIdx(clamp(Math.floor(x), 0, W - 1), clamp(Math.floor(y), 0, H - 1));

// ---- 戦闘の生成 ---------------------------------------------------------
export function createBattle(layout: Layout): Battle {
  const s: Battle = {
    t: 0,
    tick: 0,
    started: false,
    over: false,
    result: null,
    endT: 0,
    nextId: 1,
    buildings: [],
    defenders: [],
    attackers: [],
    effects: [],
    alarms: [],
    log: [],
    byId: {},
    grid: new Int32Array(W * H),
    moat: new Uint8Array(W * H),
    abatis: new Uint8Array(W * H),
    budgetA: BUDGET_A,
    used: {},
    hallId: 0,
    deployLog: [],
    timeLimit: TIME_LIMIT,
    stats: { aLost: 0, aLostCost: 0, dKilled: 0, gTotal: 0, tTotal: 0, tDown: 0, wDown: 0, spent: 0 },
  };
  for (const b of layout.buildings) {
    const d = BDEF[b.type];
    const f = fpOf(b);
    if (d.terrain) {
      (b.type === 'moat' ? s.moat : s.abatis)[tileIdx(f.x0, f.y0)] = 1;
      continue;
    }
    const e: BuildingEnt = {
      id: s.nextId++,
      isB: true,
      type: b.type,
      x0: f.x0,
      y0: f.y0,
      w: f.w,
      h: f.h,
      hp: d.hp,
      maxHp: d.hp,
      cd: 0,
      fl: 0,
    };
    s.buildings.push(e);
    s.byId[e.id] = e;
    for (let yy = f.y0; yy < f.y0 + f.h; yy++)
      for (let xx = f.x0; xx < f.x0 + f.w; xx++) s.grid[tileIdx(xx, yy)] = e.id;
    if (b.type === 'hall') s.hallId = e.id;
    if (d.tower) s.stats.tTotal++;
  }
  for (const g of layout.generals) {
    const d = GDEF[g.kind];
    const u: Defender = {
      id: s.nextId++,
      isB: false,
      side: 'd',
      kind: g.kind,
      x: g.x + 0.5,
      y: g.y + 0.5,
      lx: g.x + 0.5,
      ly: g.y + 0.5,
      hx: g.x + 0.5,
      hy: g.y + 0.5,
      alert: 0,
      slow: 0,
      hp: d.hp,
      maxHp: d.hp,
      cd: 0,
      target: 0,
      path: [],
      repath: 0,
      blocker: 0,
      cast: null,
      fl: 0,
    };
    s.defenders.push(u);
    s.byId[u.id] = u;
    s.stats.gTotal++;
  }
  return s;
}

function log(s: Battle, msg: string, side: Side) {
  s.log.push({ t: s.t, msg, side });
  if (s.log.length > 60) s.log.shift();
}

// 出撃した武将の数
const generalsUsed = (s: Battle) => UNIT_ORDER.reduce((n, k) => n + (ADEF[k].general ? (s.used[k] ?? 0) : 0), 0);
// 兵力と上限の両方に余裕があるか（武将は全体で MAX_GENERALS 人まで）
export function canDeploy(s: Battle, kind: AttackerKind) {
  const d = ADEF[kind];
  if (d.general && generalsUsed(s) >= MAX_GENERALS) return false;
  return s.budgetA >= d.cost && (!d.limit || (s.used[kind] ?? 0) < d.limit);
}

export function deploy(s: Battle, kind: AttackerKind, x: number, y: number): DeployResult {
  if (s.over) return { ok: false, msg: '戦闘は終了しています' };
  const d = ADEF[kind];
  if (!inB(x, y) || !inRing(x, y)) return { ok: false, msg: '外周の青いエリアから出撃します' };
  if (d.limit && (s.used[kind] ?? 0) >= d.limit)
    return { ok: false, msg: `${d.busho ?? d.name}はすでに出撃しています` };
  if (d.general && generalsUsed(s) >= MAX_GENERALS) return { ok: false, msg: `武将は${MAX_GENERALS}人までです` };
  if (s.budgetA < d.cost) return { ok: false, msg: '兵力が足りません' };
  s.budgetA -= d.cost;
  s.used[kind] = (s.used[kind] ?? 0) + 1;
  s.stats.spent += d.cost;
  const jit = (((s.nextId * 7) % 5) - 2) * 0.05;
  const u: Attacker = {
    id: s.nextId++,
    isB: false,
    side: 'a',
    kind,
    x: x + 0.5 + jit,
    y: y + 0.5 - jit,
    lx: x + 0.5 + jit,
    ly: y + 0.5 - jit,
    hp: d.hp,
    maxHp: d.hp,
    cd: 0,
    target: 0,
    path: [],
    repath: 0,
    blocker: 0,
    cast: null,
    flee: 0,
    fl: 0,
  };
  s.attackers.push(u);
  s.byId[u.id] = u;
  s.started = true;
  s.deployLog.push({ tick: s.tick, t: +s.t.toFixed(3), kind, x, y });
  return { ok: true };
}

// ---- ダメージ -----------------------------------------------------------
// 将以外の攻め手が近くの盾兵に守られていれば、体力の多い盾兵が代わりに受ける
function shieldOf(s: Battle, u: Attacker): Attacker | null {
  if (u.kind === 'shd' || ADEF[u.kind].general) return null;
  let best: Attacker | null = null;
  for (const o of s.attackers) {
    if (o.kind !== 'shd' || o.hp <= 0 || Math.hypot(o.x - u.x, o.y - u.y) > SHIELD_RADIUS) continue;
    if (!best || o.hp > best.hp) best = o;
  }
  return best;
}

// 守りの武将：近くの味方（防衛側なら建物も）が受ける傷を減らす割合
function wardOf(s: Battle, e: Entity) {
  let w = 0;
  if (!e.isB && e.side === 'a') {
    for (const g of s.attackers) {
      const r = ADEF[g.kind].ward;
      if (r && g.hp > 0 && Math.hypot(g.x - e.x, g.y - e.y) <= WARD_RADIUS) w = Math.max(w, r);
    }
  } else {
    for (const g of s.defenders) {
      const r = GDEF[g.kind].ward;
      if (r && g.hp > 0 && distEnt(g.x, g.y, e) <= WARD_RADIUS) w = Math.max(w, r);
    }
  }
  return w;
}

function hurt(s: Battle, e: Entity, amt: number) {
  if (e.hp <= 0) return;
  if (!e.isB && e.side === 'a') {
    const sh = shieldOf(s, e);
    if (sh) {
      hurt(s, sh, amt);
      return;
    }
  }
  const w = wardOf(s, e);
  e.hp -= w ? amt * (1 - w) : amt;
  e.fl = 4;
  if (!e.isB && e.side === 'a' && ADEF[e.kind].pref === 'decoy') e.flee = 1.5; // 囮は撃たれたら下がる
  if (e.hp > 0) return;
  e.hp = 0;
  if (e.isB) {
    for (let yy = e.y0; yy < e.y0 + e.h; yy++) for (let xx = e.x0; xx < e.x0 + e.w; xx++) s.grid[tileIdx(xx, yy)] = 0;
    if (e.type === 'wall') s.stats.wDown++;
    else if (BDEF[e.type].tower) {
      s.stats.tDown++;
      log(s, '矢倉が陥落', 'a');
    } else if (e.type === 'hall') {
      log(s, '本丸が陥落', 'a');
      if (!s.over) {
        s.over = true;
        s.result = 'win';
        s.endT = s.t;
      }
    }
  } else if (e.side === 'd') {
    s.stats.dKilled++;
    log(s, `${GDEF[e.kind].busho}を討ち取った`, 'a');
  } else {
    s.stats.aLost++;
    s.stats.aLostCost += ADEF[e.kind].cost;
    const d = ADEF[e.kind];
    if (d.general || d.cost >= 3) log(s, `${d.busho ?? d.name}が倒れた`, 'd');
  }
}

// ---- 経路探索 -----------------------------------------------------------
class Heap {
  k: number[] = [];
  v: number[] = [];
  push(key: number, val: number) {
    const k = this.k;
    const v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): [number, number] {
    const k = this.k;
    const v = this.v;
    const tk = k[0];
    const tv = v[0];
    const lk = k.pop() as number;
    const lv = v.pop() as number;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return [tk, tv];
  }
}

function enterCost(s: Battle, side: Side, i: number, kind: AttackerKind | GeneralKind) {
  if (s.moat[i]) return side === 'a' ? 4 : Infinity;
  if (s.abatis[i]) return side === 'a' ? (isMounted(kind) ? Infinity : 1.8) : 1;
  const id = s.grid[i];
  if (!id) return 1;
  const b = s.byId[id] as BuildingEnt;
  // 攻撃側は城壁を壊して進める（斥候は壊せないので通らない）
  if (side === 'a') return b.type === 'wall' && kind !== 'scout' ? 1 + b.hp / 25 : Infinity;
  return Infinity;
}

function computePath(s: Battle, u: Unit, goalFn: (i: number) => boolean): number[] | null {
  const start = tileOf(u.x, u.y);
  const dist = new Float32Array(W * H).fill(1e9);
  const prev = new Int16Array(W * H).fill(-1);
  const done = new Uint8Array(W * H);
  const heap = new Heap();
  dist[start] = 0;
  heap.push(0, start);
  while (heap.k.length) {
    const [d, i] = heap.pop();
    if (done[i]) continue;
    done[i] = 1;
    if (i !== start && goalFn(i)) {
      const path: number[] = [];
      for (let c = i; c !== start; c = prev[c]) path.push(c);
      return path.reverse();
    }
    const x = i % W;
    const y = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (!inB(nx, ny)) continue;
        const ni = tileIdx(nx, ny);
        if (done[ni]) continue;
        const c = enterCost(s, u.side, ni, u.kind);
        if (c === Infinity) continue;
        const diag = dx && dy;
        if (diag && (s.grid[ni] || s.grid[tileIdx(x + dx, y)] || s.grid[tileIdx(x, y + dy)])) continue;
        // biome-ignore lint/suspicious/noApproximativeNumericConstant: 戦闘結果を変えないため元の値を保つ
        const nd = d + c * (diag ? 1.4142 : 1);
        if (nd < dist[ni]) {
          dist[ni] = nd;
          prev[ni] = i;
          heap.push(nd, ni);
        }
      }
  }
  return null;
}

function goalNear(tg: Entity, range: number, ranged: boolean) {
  const r = ranged ? range - 0.3 : range;
  return (i: number) => distEnt((i % W) + 0.5, ((i / W) | 0) + 0.5, tg) <= r;
}

function advance(s: Battle, u: Unit, dist: number) {
  let step = dist;
  u.blocker = 0;
  if (u.side === 'a' && s.moat[tileOf(u.x, u.y)])
    step *= 0.5; // 堀の中は半分の速さ
  else if (u.side === 'a' && s.abatis[tileOf(u.x, u.y)]) step *= 0.6; // 拒馬の中は遅い
  while (step > 1e-6 && u.path.length) {
    const ni = u.path[0];
    const id = s.grid[ni];
    if (id) {
      if (u.side === 'a') {
        u.blocker = id;
        return;
      }
      u.path = [];
      return;
    }
    const cx = (ni % W) + 0.5;
    const cy = ((ni / W) | 0) + 0.5;
    const dx = cx - u.x;
    const dy = cy - u.y;
    const d = Math.hypot(dx, dy);
    if (d <= step) {
      u.x = cx;
      u.y = cy;
      u.path.shift();
      step -= d;
    } else {
      u.x += (dx / d) * step;
      u.y += (dy / d) * step;
      step = 0;
    }
  }
}

function moveDirect(s: Battle, u: Unit, px: number, py: number, step: number) {
  const dx = px - u.x;
  const dy = py - u.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return;
  const k = Math.min(step, d) / d;
  const nx = u.x + dx * k;
  const ny = u.y + dy * k;
  const ti = tileOf(nx, ny);
  if (s.grid[ti] && u.side === 'a') return;
  if (u.side === 'a' && isMounted(u.kind) && s.abatis[ti]) return;
  u.x = nx;
  u.y = ny;
}

function nearest<T extends Entity>(list: readonly T[], x: number, y: number, filter?: (e: T) => boolean): T | null {
  let best: T | null = null;
  let bd = 1e9;
  for (const e of list) {
    if (e.hp <= 0) continue;
    if (filter && !filter(e)) continue;
    const d = distEnt(x, y, e);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

// ---- 攻撃側のAI ---------------------------------------------------------
// 城壁以外の施設（櫓・投石機・鼓楼）
const isFacility = (b: BuildingEnt) => !!BDEF[b.type].tower || b.type === 'drum';
// 建物への倍率：本丸かそれ以外の施設か
const bldMul = (u: Attacker, b: BuildingEnt) => (b.type === 'hall' ? ADEF[u.kind].hall : ADEF[u.kind].fac);

function pickAttackerTarget(s: Battle, u: Attacker): Entity | null {
  const d = ADEF[u.kind];
  const hall = hallOf(s);
  if (d.pref === 'hall') return hall;
  if (d.pref === 'facility') return nearest(s.buildings, u.x, u.y, isFacility) ?? hall;
  const seen = s.defenders.filter((g) => visibleFrom(u.x, u.y, g));
  if (d.pref === 'general') {
    const g = nearest(seen, u.x, u.y);
    if (g) return g;
  }
  const cands: Entity[] = [...seen, ...s.buildings.filter((b) => BDEF[b.type].tower), hall];
  return nearest(cands, u.x, u.y);
}

function strike(s: Battle, u: Attacker, tg: Entity) {
  if (u.cd > 0) return;
  const d = ADEF[u.kind];
  u.cd = d.cd;
  let dmg = tg.isB ? d.dmg * bldMul(u, tg) : d.dmg * (d.vsGen ?? 1) * bonusOf(d, u, tg);
  if (d.charge && tg.isB) dmg *= bonusOf(d, u, tg);
  // 築城の武将の近くにいる工兵は、施設を崩すのが速い
  if (u.kind === 'eng' && tg.isB && tg.type !== 'hall')
    for (const g of s.attackers) {
      const b = ADEF[g.kind].engBoost;
      if (b && g.hp > 0 && Math.hypot(g.x - u.x, g.y - u.y) <= REPAIR_RADIUS) {
        dmg *= b;
        break;
      }
    }
  u.lx = u.x;
  u.ly = u.y;
  const cx = tg.isB ? tg.x0 + tg.w / 2 : tg.x;
  const cy = tg.isB ? tg.y0 + tg.h / 2 : tg.y;
  if (d.range > 1.5) s.effects.push({ k: 'arrow', x1: u.x, y1: u.y, x2: cx, y2: cy, t: 0, ttl: 0.18, side: 'a' });
  else s.effects.push({ k: 'hit', x: cx, y: cy, t: 0, ttl: 0.22 });
  hurt(s, tg, dmg);
  if (d.slow && !tg.isB && tg.side === 'd') tg.slow = Math.max(tg.slow, d.slow); // 弓兵の足止め
  if (d.stun) stunTarget(tg, d.stun);
  // 工兵が施設を崩すのは気づかれない（本丸への攻撃は知らせる）。忍びの攻撃も気づかれない
  if (!(u.kind === 'eng' && tg.isB && tg.type !== 'hall') && !d.stealth)
    s.alarms.push({ x: cx, y: cy, by: u.id, t: s.t });
  if (d.cleave && !tg.isB) {
    for (const o of s.defenders) {
      if (o !== tg && o.hp > 0 && Math.hypot(o.x - tg.x, o.y - tg.y) <= d.cleave) hurt(s, o, dmg * 0.6);
    }
  }
}

// 攻撃側の火計：着弾点の周囲の守将と建物にまとめて当てる
function castAt(u: Attacker, tg: Entity) {
  if (u.cd > 0) return;
  const d = ADEF[u.kind];
  u.cd = d.cd;
  u.cast = { t: d.windup ?? 0, x: tg.isB ? tg.x0 + tg.w / 2 : tg.x, y: tg.isB ? tg.y0 + tg.h / 2 : tg.y };
}
function fireCast(s: Battle, u: Attacker, c: Cast) {
  const d = ADEF[u.kind];
  const r = d.radius ?? 0;
  const aoe = d.aoe ?? 0;
  s.effects.push({ k: 'fire', x: c.x, y: c.y, r, t: 0, ttl: 0.55 });
  s.alarms.push({ x: c.x, y: c.y, by: u.id, t: s.t });
  for (const g of s.defenders) if (g.hp > 0 && Math.hypot(g.x - c.x, g.y - c.y) <= r) hurt(s, g, aoe);
  for (const b of s.buildings) if (b.hp > 0 && distEnt(c.x, c.y, b) <= r) hurt(s, b, aoe * bldMul(u, b));
}
const attack = (s: Battle, u: Attacker, tg: Entity) => (ADEF[u.kind].aoe ? castAt(u, tg) : strike(s, u, tg));

// 囮（斥候）：守将や櫓に近づき、追われたり撃たれたりしたら下がる。下がり終えたらまた近づく
function decoyAct(s: Battle, u: Attacker) {
  const d = ADEF[u.kind];
  u.flee -= DT;
  const chaser = nearest(s.defenders, u.x, u.y, (g) => g.target === u.id && Math.hypot(g.x - u.x, g.y - u.y) <= 3);
  if (chaser) u.flee = Math.max(u.flee, 0.5);
  if (u.flee > 0) {
    const threat: Entity | null =
      chaser ?? nearest<Entity>([...s.defenders, ...s.buildings.filter((b) => BDEF[b.type].tower)], u.x, u.y);
    if (threat) {
      const tx = threat.isB ? threat.x0 + 0.5 : threat.x;
      const ty = threat.isB ? threat.y0 + 0.5 : threat.y;
      // 8方向のうち、通れて、相手から一番遠ざかる向きへ逃げる（端では端に沿って逃げる）
      const step = d.speed * DT;
      let bx = u.x;
      let by = u.y;
      let bd = -1;
      for (let k = 0; k < 8; k++) {
        const nx = u.x + Math.cos((k * Math.PI) / 4) * step;
        const ny = u.y + Math.sin((k * Math.PI) / 4) * step;
        if (nx < 0.5 || ny < 0.5 || nx > W - 0.5 || ny > H - 0.5 || s.grid[tileOf(nx, ny)]) continue;
        const dd = Math.hypot(nx - tx, ny - ty);
        if (dd > bd) {
          bd = dd;
          bx = nx;
          by = ny;
        }
      }
      u.x = bx;
      u.y = by;
    }
    u.path = [];
    u.target = 0;
    return;
  }
  // 近づく相手：道のある守将を優先し、なければ一番近い櫓
  let tg: Entity | null = u.target ? s.byId[u.target] : null;
  if (u.repath <= 0 || (tg && tg.hp <= 0)) {
    u.repath = 0.6;
    tg = null;
    u.path = [];
    for (const g of [...s.defenders].sort(
      (a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y),
    )) {
      const path = computePath(s, u, goalNear(g, 2.5, false));
      if (path?.length) {
        tg = g;
        u.path = path;
        break;
      }
    }
    if (!tg) {
      const tw = nearest(s.buildings, u.x, u.y, (b) => !!BDEF[b.type].tower);
      if (tw) {
        tg = tw;
        u.path = computePath(s, u, goalNear(tw, (BDEF[tw.type].range ?? 1) - 0.5, false)) || [];
      }
    }
    u.target = tg ? tg.id : 0;
  }
  advance(s, u, d.speed * DT);
}

function attackerAct(s: Battle, u: Attacker) {
  const d = ADEF[u.kind];
  u.cd -= DT;
  u.repath -= DT;
  if (d.pref === 'decoy') {
    decoyAct(s, u);
    return;
  }
  if (u.cast) {
    u.cast.t -= DT;
    if (u.cast.t <= 0) {
      const c = u.cast;
      u.cast = null;
      fireCast(s, u, c);
    }
    return;
  }
  let tg: Entity | null = u.target ? s.byId[u.target] : null;
  if (!tg || tg.hp <= 0) {
    tg = pickAttackerTarget(s, u);
    u.target = tg ? tg.id : 0;
    u.path = [];
    u.blocker = 0;
  } else if (!d.noUnits && tg.isB && (s.tick + u.id) % 15 === 0) {
    const near = nearest(s.defenders, u.x, u.y, (e) => distEnt(u.x, u.y, e) <= 2.5);
    if (near) {
      tg = near;
      u.target = near.id;
      u.path = [];
      u.blocker = 0;
    }
  }
  if (!tg) return;
  const bl = u.blocker ? (s.byId[u.blocker] as BuildingEnt) : null;
  if (bl && bl.hp > 0) {
    if (distEnt(u.x, u.y, bl) <= d.range) {
      attack(s, u, bl);
      return;
    }
    moveDirect(s, u, clamp(u.x, bl.x0, bl.x0 + bl.w), clamp(u.y, bl.y0, bl.y0 + bl.h), d.speed * DT);
    return;
  }
  u.blocker = 0;
  if (distEnt(u.x, u.y, tg) <= d.range) {
    attack(s, u, tg);
    return;
  }
  if (!u.path.length || u.repath <= 0) {
    u.path = computePath(s, u, goalNear(tg, d.range, d.range > 1.5)) || [];
    u.repath = 0.6;
    if (!u.path.length) {
      const px = tg.isB ? clamp(u.x, tg.x0, tg.x0 + tg.w) : tg.x;
      const py = tg.isB ? clamp(u.y, tg.y0, tg.y0 + tg.h) : tg.y;
      moveDirect(s, u, px, py, d.speed * DT);
      return;
    }
  }
  advance(s, u, d.speed * DT);
}

// ---- 防衛側のAI ---------------------------------------------------------
function buffOf(s: Battle, x: number, y: number) {
  const aura = BDEF.drum.aura ?? 0;
  for (const d of s.buildings) {
    if (d.type === 'drum' && d.hp > 0 && Math.hypot(d.x0 + 0.5 - x, d.y0 + 0.5 - y) <= aura) return BDEF.drum.rate ?? 1;
  }
  return 1;
}

function towerAct(s: Battle, b: BuildingEnt) {
  b.cd -= DT * buffOf(s, b.x0 + 0.5, b.y0 + 0.5);
  if (b.hp <= 0 || b.cd > 0) return;
  const d = BDEF[b.type];
  const range = d.range ?? 0;
  const minRange = d.minRange ?? 0;
  const dmg = d.dmg ?? 0;
  const cx = b.x0 + 0.5;
  const cy = b.y0 + 0.5;
  const tg = nearest(s.attackers, cx, cy, (e) => {
    const r = Math.hypot(e.x - cx, e.y - cy);
    return r <= range && r >= minRange && visibleFrom(cx, cy, e);
  });
  if (!tg) return;
  b.cd = d.cd ?? 0;
  s.effects.push({ k: 'arrow', x1: cx, y1: cy, x2: tg.x, y2: tg.y, t: 0, ttl: 0.18, side: 'd' });
  if (d.splash) {
    s.effects.push({ k: 'fire', x: tg.x, y: tg.y, r: d.splash, t: 0, ttl: 0.4 });
    for (const a of s.attackers.slice())
      if (a.hp > 0 && Math.hypot(a.x - tg.x, a.y - tg.y) <= d.splash) hurt(s, a, dmg);
  } else hurt(s, tg, dmg);
}

function defenderAct(s: Battle, u: Defender) {
  const d = GDEF[u.kind];
  // 足止めされているあいだは、攻撃の間隔・移動・構えが遅くなる
  const sl = u.slow > 0 ? SLOW_RATE : 1;
  if (u.slow > 0) u.slow -= DT;
  u.cd -= DT * buffOf(s, u.x, u.y) * sl;
  if (d.repair)
    for (const b of s.buildings)
      if (b.hp > 0 && b.hp < b.maxHp && distEnt(u.x, u.y, b) <= REPAIR_RADIUS)
        b.hp = Math.min(b.maxHp, b.hp + d.repair * DT);
  u.repath -= DT;
  if (u.cast) {
    u.cast.t -= DT * sl;
    if (u.cast.t <= 0) {
      const c = u.cast;
      const radius = d.radius ?? 0;
      u.cast = null;
      s.effects.push({ k: 'fire', x: c.x, y: c.y, r: radius, t: 0, ttl: 0.55 });
      for (const a of s.attackers) if (a.hp > 0 && Math.hypot(a.x - c.x, a.y - c.y) <= radius) hurt(s, a, d.aoe ?? 0);
    }
    return;
  }
  if (u.alert > 0) u.alert -= DT;
  const base = d.leash + d.range + 0.5;
  const reach = base + (u.alert > 0 ? ALERT_EXTRA : 0);
  const okT = (e: Attacker | null): e is Attacker => !!e && e.hp > 0 && Math.hypot(e.x - u.hx, e.y - u.hy) <= reach;
  let tg = u.target ? (s.byId[u.target] as Attacker) : null;
  if (!okT(tg)) {
    tg = nearest(s.attackers, u.x, u.y, (e) => distEnt(u.x, u.y, e) <= d.aggro && okT(e) && visibleFrom(u.x, u.y, e));
    if (!tg) {
      // 近くに攻め手がいなくても、検知範囲の中で味方が攻撃されていたら、攻撃した相手に向かう
      let bd = Infinity;
      for (const a of s.alarms) {
        const dd = Math.hypot(a.x - u.x, a.y - u.y);
        if (dd > d.aggro || dd >= bd) continue;
        const by = s.byId[a.by] as Attacker | undefined;
        if (!by || by.hp <= 0 || Math.hypot(by.x - u.hx, by.y - u.hy) > base + ALERT_EXTRA) continue;
        bd = dd;
        tg = by;
      }
      if (tg) u.alert = ALERT_TIME;
    }
    u.target = tg ? tg.id : 0;
    u.path = [];
    u.repath = 0; // 相手が変わったらすぐに道を探す
  }
  if (!tg) {
    if (Math.hypot(u.x - u.hx, u.y - u.hy) > 0.08) {
      if (!u.path.length || u.repath <= 0) {
        const hi = tileIdx(Math.floor(u.hx), Math.floor(u.hy));
        u.path = computePath(s, u, (i) => i === hi) || [];
        u.repath = 0.6;
        if (!u.path.length) {
          u.x = u.hx;
          u.y = u.hy;
          return;
        }
      }
      advance(s, u, d.speed * DT * sl);
      if (!u.path.length) {
        u.x = u.hx;
        u.y = u.hy;
      }
    }
    return;
  }
  if (distEnt(u.x, u.y, tg) <= d.range) {
    if (d.aoe) {
      if (u.cd <= 0) {
        u.cast = { t: d.windup ?? 0, x: tg.x, y: tg.y };
        u.cd = d.cd;
      }
    } else if (u.cd <= 0) {
      u.cd = d.cd;
      if (d.range > 1.5)
        s.effects.push({ k: 'arrow', x1: u.x, y1: u.y, x2: tg.x, y2: tg.y, t: 0, ttl: 0.18, side: 'd' });
      else s.effects.push({ k: 'hit', x: tg.x, y: tg.y, t: 0, ttl: 0.22 });
      hurt(s, tg, d.dmg * bonusOf(d, u, tg));
      u.lx = u.x;
      u.ly = u.y;
      if (d.stun) stunTarget(tg, d.stun);
      if (d.cleave) {
        for (const o of s.attackers) {
          if (o !== tg && o.hp > 0 && Math.hypot(o.x - tg.x, o.y - tg.y) <= d.cleave) hurt(s, o, d.dmg * 0.6);
        }
      }
    }
    return;
  }
  // 道が見つからなくても毎ティック探し直さない（壁の向こうの敵を見つけたとき重くなるため）
  if (u.repath <= 0) {
    u.path = computePath(s, u, goalNear(tg, d.range, d.range > 1.5)) || [];
    u.repath = 0.6;
  }
  advance(s, u, d.speed * DT * sl);
}

// ---- 1ティック ----------------------------------------------------------
export function step(s: Battle) {
  if (s.over || !s.started) return;
  s.t += DT;
  s.tick++;
  for (const b of s.buildings) if (BDEF[b.type].tower) towerAct(s, b);
  for (const u of s.defenders) if (u.hp > 0) defenderAct(s, u);
  for (const u of s.attackers) if (u.hp > 0) attackerAct(s, u);
  s.attackers = s.attackers.filter((u) => u.hp > 0);
  s.defenders = s.defenders.filter((u) => u.hp > 0);
  for (const e of s.effects) e.t += DT;
  s.effects = s.effects.filter((e) => e.t < e.ttl);
  s.alarms = s.alarms.filter((a) => s.t - a.t <= ALARM_TTL);
  for (const e of s.attackers) if (e.fl > 0) e.fl--;
  for (const e of s.defenders) if (e.fl > 0) e.fl--;
  for (const e of s.buildings) if (e.fl > 0) e.fl--;
  if (!s.over) {
    if (s.t >= s.timeLimit) {
      s.over = true;
      s.result = 'timeout';
      s.endT = s.t;
    } else if (!s.attackers.length && !UNIT_ORDER.some((k) => canDeploy(s, k))) {
      s.over = true;
      s.result = 'wipe';
      s.endT = s.t;
    }
  }
}
