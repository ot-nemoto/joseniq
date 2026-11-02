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
  DETOUR_PATH_RATE,
  DT,
  GDEF,
  type GeneralKind,
  H,
  HEIGHT_RANGE_BONUS,
  isFacilityType,
  MAX_GENERALS,
  PLAN_LIMIT,
  PLAN_TICKS,
  REPAIR_RADIUS,
  SHIELD_RADIUS,
  SHOT_HIT_RADIUS,
  SHOT_SPEED,
  type ShotKind,
  SLOW_RATE,
  TIME_LIMIT,
  UNIT_ORDER,
  UPHILL_SPEED,
  W,
  WARD_RADIUS,
} from './defs';
import { clamp, inB, inRing, rectDist, tileIdx } from './geometry';
import { fpOf, isCliff, type Layout } from './layout';
import { canDeployTile } from './terrain';

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
  burnT: number; // 最後に火計を受けた時刻（まだなら -1）。戦闘の計算には使わず、画面で燃える様子を出すために記録する
  // 最後に撃った向き（まだなら、模型と同じ -x の向き）。戦闘の計算には使わず、画面で大筒の筒を向けるために記録する
  aimX: number;
  aimY: number;
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
  vx: number; // 前のティックで動いた速さ（1秒あたりのマス）。飛び道具が動く先を読むのに使う
  vy: number;
  px: number; // 前のティックの終わりの位置（vx・vy を求める）
  py: number;
  lx: number; // 最後に攻撃した位置（騎馬の武将が駆けた距離を測る）
  ly: number;
  // 最後に攻撃した時刻（まだなら -1）と、狙った位置。戦闘の計算には使わず、画面の動きのために記録する
  atkT: number;
  atkX: number;
  atkY: number;
  burnT: number; // 最後に火計を受けた時刻（まだなら -1）。画面のため
  at: number; // 最後に中心を通ったマス（坂を上る区間を決める）。わからなければ -1
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
  skip: number[]; // 道が見つからなかった施設（壁で閉じた区画の中など）。狙いから外す
  // 寄り道を始めた所（兵）。本丸への道を進んでいるあいだは今いる所。寄り道の相手は、ここから寄り道の距離の内で探す
  rx: number;
  ry: number;
}
export type Unit = Defender | Attacker;
export type Entity = BuildingEnt | Unit;

export type Effect =
  | { k: 'hit'; x: number; y: number; t: number; ttl: number }
  // 外れて地面に刺さった矢（dx・dy は飛んできた向き、side は撃った側）
  | { k: 'stuck'; x: number; y: number; dx: number; dy: number; side: Side; t: number; ttl: number }
  | { k: 'fire'; x: number; y: number; r: number; t: number; ttl: number }
  // 鉄砲・大筒を撃った所に出る火花と煙（dx・dy は撃った向き、size は大きさの倍率）。見た目だけで、戦いには関わらない
  | { k: 'smoke'; x: number; y: number; dx: number; dy: number; size: number; t: number; ttl: number };

// 当てたときに添えるもの（足止め・攻撃を遅らせる・周りへの追加の傷）
interface HitExtra {
  slow?: number;
  stun?: number;
  cleave?: number;
}
// 飛んでいる矢・弾・大筒の玉。撃った時に作り、届いた時に傷を入れる。
// どれも、相手が今の向きと速さのまま進むとして、届く時にいるはずの場所へ飛ぶ。矢と鉄砲の弾は落ちた所の近くに相手がいれば当たり、
// いなければ外れる（外れた矢は地面に刺さる）。大筒の玉は落ちた所で弾け、まわりに当たる
export interface Shot extends HitExtra {
  k: ShotKind;
  side: Side; // 撃った側
  x: number; // 今の位置
  y: number;
  sx: number; // 撃った位置
  sy: number;
  tg: number; // 狙った相手
  // 飛んでいく先（撃った時に、相手の動く先を読んで決める）
  tx: number;
  ty: number;
  dmg: number;
  splash?: number; // 届いた所のまわりにまとめて当てる距離（大筒）
}

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
  gateDown: number; // 破られた門の数
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
  shots: Shot[];
  alarms: Alarm[]; // 直近に攻撃された場所と、攻撃した相手
  bell: number[]; // このティックに鐘楼が見つけている攻め手（早鐘で、城じゅうの守将に知らせる）
  ringing: number[]; // このティックに鳴っている鐘楼
  log: LogEntry[];
  byId: Record<number, Entity>;
  grid: Int32Array;
  river: Uint8Array; // 川（橋のかかっていないマス）。攻め手も守将も入れない
  water: Uint8Array; // 川のマス（橋のかかったマスも含む）。攻め手は出せない
  height: Uint8Array; // 地形の高さ（0〜MAX_HEIGHT）。隣との差が2段以上なら崖で通れない
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
// 騎兵と騎馬の武将：槍に弱い
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
// 攻め手の飛び道具が、まだ飛んでいるか（攻め手がいなくなっても、届くまでは全滅にしない）
export const attackerShotsFlying = (s: Battle) => s.shots.some((sh) => sh.side === 'a');
const centerOf = (e: Entity): [number, number] => (e.isB ? [e.x0 + e.w / 2, e.y0 + e.h / 2] : [e.x, e.y]);
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
    shots: [],
    alarms: [],
    bell: [],
    ringing: [],
    log: [],
    byId: {},
    grid: new Int32Array(W * H),
    river: new Uint8Array(W * H),
    water: layout.water ? Uint8Array.from(layout.water) : new Uint8Array(W * H),
    height: layout.heights ? Uint8Array.from(layout.heights) : new Uint8Array(W * H),
    budgetA: BUDGET_A,
    used: {},
    hallId: 0,
    deployLog: [],
    timeLimit: TIME_LIMIT,
    stats: { aLost: 0, aLostCost: 0, dKilled: 0, gTotal: 0, tTotal: 0, tDown: 0, gateDown: 0, spent: 0 },
  };
  // 川は攻め手も守将も渡れない。橋のかかったマスだけ渡れる
  if (layout.water) for (let i = 0; i < W * H; i++) if (layout.water[i] && !layout.bridge?.[i]) s.river[i] = 1;
  for (const b of layout.buildings) {
    const d = BDEF[b.type];
    const f = fpOf(b);
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
      burnT: -1,
      aimX: -1,
      aimY: 0,
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
      px: g.x + 0.5,
      py: g.y + 0.5,
      vx: 0,
      vy: 0,
      hx: g.x + 0.5,
      hy: g.y + 0.5,
      alert: 0,
      slow: 0,
      hp: d.hp,
      maxHp: d.hp,
      cd: 0,
      atkT: -1,
      burnT: -1,
      atkX: 0,
      atkY: 0,
      target: 0,
      path: [],
      at: -1,
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
// 出撃した武将の人数
export const generalsUsed = (s: Battle) => UNIT_ORDER.reduce((n, k) => n + (ADEF[k].general ? (s.used[k] ?? 0) : 0), 0);
// 兵力と上限の両方に余裕があるか（武将は全体で MAX_GENERALS 人まで）
export function canDeploy(s: Battle, kind: AttackerKind) {
  if (s.tick > PLAN_TICKS) return false;
  const d = ADEF[kind];
  if (d.general && generalsUsed(s) >= MAX_GENERALS) return false;
  return s.budgetA >= d.cost && (!d.limit || (s.used[kind] ?? 0) < d.limit);
}

export function deploy(s: Battle, kind: AttackerKind, x: number, y: number): DeployResult {
  if (s.over) return { ok: false, msg: '戦闘は終了しています' };
  if (s.tick > PLAN_TICKS) return { ok: false, msg: `出撃できるのは開戦から${PLAN_LIMIT / 60}分までです` };
  const d = ADEF[kind];
  if (!inB(x, y) || !inRing(x, y)) return { ok: false, msg: '外周の青いエリアから出撃します' };
  if (!canDeployTile(s.height, s.water, tileIdx(x, y))) return { ok: false, msg: '出撃エリアの平地から出撃します' };
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
    px: x + 0.5 + jit,
    py: y + 0.5 - jit,
    vx: 0,
    vy: 0,
    hp: d.hp,
    maxHp: d.hp,
    cd: 0,
    atkT: -1,
    burnT: -1,
    atkX: 0,
    atkY: 0,
    target: 0,
    path: [],
    at: -1,
    repath: 0,
    blocker: 0,
    cast: null,
    flee: 0,
    skip: [],
    rx: x + 0.5 + jit,
    ry: y + 0.5 - jit,
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

// burn は火計の傷。実際に傷を受けた相手（盾持ちが肩代わりしたら盾持ち）に、焼かれた時刻を付ける
function hurt(s: Battle, e: Entity, amt: number, burn = false) {
  if (e.hp <= 0) return;
  if (e.isB && BDEF[e.type].unbreakable) return; // 城壁は壊せない（範囲攻撃でも減らない）
  if (!e.isB && e.side === 'a') {
    const sh = shieldOf(s, e);
    if (sh) {
      hurt(s, sh, amt, burn);
      return;
    }
  }
  const w = wardOf(s, e);
  e.hp -= w ? amt * (1 - w) : amt;
  e.fl = 4;
  if (burn) e.burnT = s.t;
  if (!e.isB && e.side === 'a' && ADEF[e.kind].pref === 'decoy') e.flee = 1.5; // 囮は撃たれたら下がる
  if (e.hp > 0) return;
  e.hp = 0;
  if (e.isB) {
    // 門と大筒（breakThrough）は壊れたら通れる。櫓・鼓楼は壊れても石垣の台が残り、通れない（壁の並びに置いた櫓が抜け道にならないように）
    if (BDEF[e.type].breakThrough)
      for (let yy = e.y0; yy < e.y0 + e.h; yy++) for (let xx = e.x0; xx < e.x0 + e.w; xx++) s.grid[tileIdx(xx, yy)] = 0;
    if (e.type === 'gate') {
      s.stats.gateDown++;
      log(s, '門が破られた', 'a');
    } else if (BDEF[e.type].tower) {
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

// from から i へ入る重み。崖（高さの差が2段以上）は通れず、坂を上るときは遅くなる分だけ重くする
function enterCost(s: Battle, side: Side, from: number, i: number, kind: AttackerKind | GeneralKind) {
  if (isCliff(s.height[from], s.height[i])) return Infinity;
  const c = groundCost(s, side, i, kind);
  return s.height[i] > s.height[from] ? c / UPHILL_SPEED : c;
}
function groundCost(s: Battle, side: Side, i: number, kind: AttackerKind | GeneralKind) {
  if (s.river[i]) return Infinity;
  const id = s.grid[i];
  if (!id) return 1;
  const b = s.byId[id] as BuildingEnt;
  // 攻撃側は門・大筒（breakThrough）を壊して進める（斥候は壊せないので通らない）。城壁・櫓・鼓楼は通れない
  if (side === 'a') return BDEF[b.type].breakThrough && kind !== 'scout' ? 1 + b.hp / 25 : Infinity;
  // 守将は門を通れる
  return b.type === 'gate' ? 1 : Infinity;
}

// maxD を渡すと、道の重みがそれを超える所は探さない（近くだけを探すとき）
function computePath(s: Battle, u: Unit, goalFn: (i: number) => boolean, maxD = Infinity): number[] | null {
  const start = tileOf(u.x, u.y);
  const dist = new Float32Array(W * H).fill(1e9);
  const prev = new Int16Array(W * H).fill(-1);
  const done = new Uint8Array(W * H);
  const heap = new Heap();
  dist[start] = 0;
  heap.push(0, start);
  while (heap.k.length) {
    const [d, i] = heap.pop();
    if (d > maxD) break;
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
        const c = enterCost(s, u.side, i, ni, u.kind);
        if (c === Infinity) continue;
        const diag = dx && dy;
        if (diag && (s.grid[ni] || s.grid[tileIdx(x + dx, y)] || s.grid[tileIdx(x, y + dy)])) continue;
        // 斜めに進むときは、角を挟む2マスのどちらかが崖か川なら通れない
        if (
          diag &&
          (isCliff(s.height[i], s.height[tileIdx(x + dx, y)]) ||
            isCliff(s.height[i], s.height[tileIdx(x, y + dy)]) ||
            s.river[tileIdx(x + dx, y)] ||
            s.river[tileIdx(x, y + dy)])
        )
          continue;
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

// 射程：遠くを撃つもの（射程2より長いもの。間合いの長い槍は入れない）は、立っているマスの高さ1段につき伸びる
export const rangeAt = (s: Battle, base: number, x: number, y: number) =>
  base > 2 ? base + HEIGHT_RANGE_BONUS * s.height[tileOf(x, y)] : base;

// 道の着く先：相手まで射程以内のマス。range に関数を渡すと、着く先のマスごとの射程で決める（高さで射程が変わるため）
function goalNear(tg: Entity, range: number | ((i: number) => number), ranged: boolean) {
  const off = ranged ? 0.3 : 0;
  return (i: number) =>
    distEnt((i % W) + 0.5, ((i / W) | 0) + 0.5, tg) <= (typeof range === 'number' ? range : range(i)) - off;
}
// 着く先のマスの高さで決まる射程
const rangeFromTile = (s: Battle, base: number) => (i: number) => rangeAt(s, base, (i % W) + 0.5, ((i / W) | 0) + 0.5);

function advance(s: Battle, u: Unit, dist: number) {
  let step = dist;
  u.blocker = 0;
  while (step > 1e-6 && u.path.length) {
    const ni = u.path[0];
    const id = s.grid[ni];
    // 守将は門を通り抜ける
    if (id && !(u.side === 'd' && (s.byId[id] as BuildingEnt).type === 'gate')) {
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
    // 坂を上るときは遅い：最後に中心を通ったマスより高いマスへ向かう区間は、進める道のりを UPHILL_SPEED 倍にして使う
    const from = u.at >= 0 ? u.at : tileOf(u.x, u.y);
    const up = s.height[ni] > s.height[from] ? UPHILL_SPEED : 1;
    const d = Math.hypot(dx, dy) / up;
    if (d <= step) {
      u.x = cx;
      u.y = cy;
      u.at = ni;
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
  if (isCliff(s.height[tileOf(u.x, u.y)], s.height[ti]) || s.river[ti]) return; // 崖と川には入れない
  u.x = nx;
  u.y = ny;
  u.at = -1; // 道を外れて動いたので、最後に通ったマスはわからない
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
// 城壁以外の施設（撃つ櫓・大筒と、まわりに効く鼓楼・鐘楼）
const isFacility = (b: BuildingEnt) => isFacilityType(b.type);
// 建物への倍率：本丸かそれ以外の施設か
const bldMul = (u: Attacker, b: BuildingEnt) => {
  const d = ADEF[u.kind];
  return b.type === 'hall' ? d.hall : b.type === 'gate' ? (d.gate ?? d.fac) : d.fac;
};

// 攻め手の狙いを選ぶ。兵が寄り道先を選んだときは、そこへの道も返す（path が null なら、道はあとで探す）
function pickAttackerTarget(s: Battle, u: Attacker): { tg: Entity | null; path: number[] | null } {
  // 兵：寄り道の相手がいなければ、本丸への道を進む
  if (ADEF[u.kind].reach !== undefined)
    return detourTarget(s, u, attackGoal(s, u), (e) => inAttackRange(s, u, e)) ?? { tg: routeTarget(s, u), path: null };
  return { tg: pickGeneralTarget(s, u), path: null };
}
// 武将の狙い：道に関係なく、好む相手へ向かう
function pickGeneralTarget(s: Battle, u: Attacker): Entity | null {
  const d = ADEF[u.kind];
  const hall = hallOf(s);
  const reachable = (b: BuildingEnt) => !u.skip.includes(b.id);
  if (d.pref === 'facility') return nearest(s.buildings, u.x, u.y, (b) => isFacility(b) && reachable(b)) ?? hall;
  const seen = s.defenders.filter((g) => visibleFrom(u.x, u.y, g));
  if (d.pref === 'general') {
    const g = nearest(seen, u.x, u.y);
    if (g) return g;
  }
  const cands: Entity[] = [...seen, ...s.buildings.filter((b) => BDEF[b.type].tower && reachable(b)), hall];
  return nearest(cands, u.x, u.y);
}

// 狙いを変えたときの道。選ぶときに求めた道があれば使い、なければ空にして、次に動くときに探す
function setPath(u: Attacker, path: number[] | null) {
  u.path = path ?? [];
  if (path?.length) u.repath = 0.6;
}

// 兵が本丸への道の上で向かう先：衝車は、本丸への道をふさいでいる最初の門（道に門がなければ本丸）。ほかは本丸
function routeTarget(s: Battle, u: Attacker): Entity {
  const d = ADEF[u.kind];
  const hall = hallOf(s);
  if (d.pref !== 'gate') return hall;
  const path = computePath(s, u, attackGoal(s, u)(hall));
  for (const i of path ?? []) {
    const b = s.grid[i] ? (s.byId[s.grid[i]] as BuildingEnt) : null;
    if (b?.type === 'gate') return b;
  }
  return hall;
}
// 本丸への道の上で向かう先か（本丸と、衝車にとっての門）
const onRoute = (u: Attacker, e: Entity | null) =>
  !e || (e.isB && (e.type === 'hall' || (ADEF[u.kind].pref === 'gate' && e.type === 'gate')));

// 攻撃できる所（相手まで射程以内のマス）と、今いる所から攻撃できるか
const attackGoal = (s: Battle, u: Attacker) => (e: Entity) =>
  goalNear(e, rangeFromTile(s, ADEF[u.kind].range), ADEF[u.kind].range > 1.5);
const inAttackRange = (s: Battle, u: Attacker, e: Entity) =>
  distEnt(u.x, u.y, e) <= rangeAt(s, ADEF[u.kind].range, u.x, u.y);

// 兵が寄り道で相手にするものの組（好みの順。前の組に寄り道できる相手がいれば、後の組は見ない）
function detourGroups(s: Battle, u: Attacker): Entity[][] {
  const seen = () => s.defenders.filter((g) => visibleFrom(u.x, u.y, g));
  const towers = () => s.buildings.filter((b) => !!BDEF[b.type].tower);
  switch (ADEF[u.kind].pref) {
    case 'facility':
      return [s.buildings.filter(isFacility)];
    case 'gate':
      return [s.buildings.filter((b) => b.type === 'gate')];
    case 'any':
      return [[...seen(), ...towers()]];
    case 'general':
    case 'decoy':
      return [seen(), towers()];
    default:
      return [];
  }
}
// 兵の寄り道先：寄り道を始めた所から寄り道の距離（reach）の内にいる相手のうち、門などを壊さずに、
// 寄り道の距離の DETOUR_PATH_RATE 倍までの道のりで、goal（着く先のマス）まで行けるもの（近い順に調べる）。
// here は、今いる所のままで用が足りるか。用が足りる相手（射程の長い兵が今いる所から撃てる相手など）は、
// 道を離れずに済むので、寄り道の距離より遠くても選ぶ
function detourTarget(
  s: Battle,
  u: Attacker,
  goal: (e: Entity) => (i: number) => boolean,
  here: (e: Entity) => boolean,
): { tg: Entity; path: number[] } | null {
  const reach = ADEF[u.kind].reach ?? 0;
  const limit = reach * DETOUR_PATH_RATE;
  for (const group of detourGroups(s, u)) {
    const near = group
      .filter((e) => e.hp > 0 && !(e.isB && u.skip.includes(e.id)) && (distEnt(u.rx, u.ry, e) <= reach || here(e)))
      .sort((a, b) => distEnt(u.x, u.y, a) - distEnt(u.x, u.y, b));
    for (const e of near) {
      if (here(e)) return { tg: e, path: [] };
      // 坂などで重みが増えても見つかるよう、道の重みは道のりの上限の2倍まで探す
      const path = computePath(s, u, goal(e), limit * 2);
      if (path && path.length <= limit && path.every((i) => !s.grid[i])) return { tg: e, path };
    }
  }
  return null;
}

// 攻撃した時刻と狙った位置を記録する（画面の動きのため）
function markAttack(s: Battle, u: Unit, x: number, y: number) {
  u.atkT = s.t;
  u.atkX = x;
  u.atkY = y;
}

// 相手に当てる：傷を入れ、足止めなどを添える。cleave があれば、相手のまわりの敵にも6割の傷を入れる
function impact(s: Battle, side: Side, tg: Entity, dmg: number, fx: HitExtra) {
  hurt(s, tg, dmg);
  if (fx.slow && !tg.isB && tg.side === 'd') tg.slow = Math.max(tg.slow, fx.slow); // 弓兵の足止め
  if (fx.stun) stunTarget(tg, fx.stun);
  if (fx.cleave && !tg.isB) {
    const [cx, cy] = centerOf(tg);
    for (const o of side === 'a' ? s.defenders : s.attackers)
      if (o !== tg && o.hp > 0 && Math.hypot(o.x - cx, o.y - cy) <= fx.cleave) hurt(s, o, dmg * 0.6);
  }
}
// 飛び道具を撃つ。傷は届いた時に入る（moveShots）
function shoot(
  s: Battle,
  k: ShotKind,
  side: Side,
  x: number,
  y: number,
  tg: Entity,
  dmg: number,
  fx: HitExtra & { splash?: number } = {},
): Shot {
  let [tx, ty] = centerOf(tg);
  // 動く先を読む：届くまでの時間を求め、そのあいだに相手が進む分だけ先を狙う（求めた先でもう一度求め直す）
  if (!tg.isB)
    for (let i = 0; i < 2; i++) {
      const t = Math.hypot(tx - x, ty - y) / SHOT_SPEED[k];
      tx = tg.x + tg.vx * t;
      ty = tg.y + tg.vy * t;
    }
  const sh: Shot = { k, side, x, y, sx: x, sy: y, tg: tg.id, tx, ty, dmg, ...fx };
  s.shots.push(sh);
  if (k !== 'arrow') {
    // 大筒は鉄砲より大きく、長く残す
    const big = k === 'ball';
    const l = Math.hypot(tx - x, ty - y) || 1;
    s.effects.push({
      k: 'smoke',
      x,
      y,
      dx: (tx - x) / l,
      dy: (ty - y) / l,
      size: big ? 1.8 : 1,
      t: 0,
      ttl: big ? 1.6 : 1,
    });
  }
  return sh;
}
// 飛んでいる飛び道具を進め、届いたものを当てる
function moveShots(s: Battle) {
  const flying: Shot[] = [];
  for (const sh of s.shots) {
    const tg = s.byId[sh.tg];
    const alive = !!tg && tg.hp > 0;
    const dx = sh.tx - sh.x;
    const dy = sh.ty - sh.y;
    const d = Math.hypot(dx, dy);
    const stepLen = SHOT_SPEED[sh.k] * DT;
    if (d > stepLen) {
      sh.x += (dx / d) * stepLen;
      sh.y += (dy / d) * stepLen;
      flying.push(sh);
      continue;
    }
    sh.x = sh.tx;
    sh.y = sh.ty;
    if (sh.splash) {
      const r = sh.splash;
      s.effects.push({ k: 'fire', x: sh.x, y: sh.y, r, t: 0, ttl: 0.4 });
      for (const o of (sh.side === 'a' ? s.defenders : s.attackers).slice())
        if (o.hp > 0 && Math.hypot(o.x - sh.x, o.y - sh.y) <= r) hurt(s, o, sh.dmg);
    } else if (alive && distEnt(sh.x, sh.y, tg) <= SHOT_HIT_RADIUS) impact(s, sh.side, tg, sh.dmg, sh);
    else if (sh.k === 'arrow' && sh.x >= 0 && sh.y >= 0 && sh.x < W && sh.y < H && !s.grid[tileOf(sh.x, sh.y)]) {
      // 外れた矢は、飛んできた向きのまま地面に刺さって残る（盤面の外や、建物のあるマスに落ちたものは残さない）
      const l = Math.hypot(sh.x - sh.sx, sh.y - sh.sy) || 1;
      s.effects.push({
        k: 'stuck',
        x: sh.x,
        y: sh.y,
        dx: (sh.x - sh.sx) / l,
        dy: (sh.y - sh.sy) / l,
        side: sh.side,
        t: 0,
        ttl: 1.5,
      });
    }
  }
  s.shots = flying;
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
  const [cx, cy] = centerOf(tg);
  markAttack(s, u, cx, cy);
  const fx = { slow: d.slow, stun: d.stun, cleave: d.cleave };
  if (d.shot) shoot(s, d.shot, 'a', u.x, u.y, tg, dmg, fx);
  else {
    s.effects.push({ k: 'hit', x: cx, y: cy, t: 0, ttl: 0.22 });
    impact(s, 'a', tg, dmg, fx);
  }
  // 工兵が施設を崩すのは気づかれない（本丸への攻撃は知らせる）。忍びの攻撃も気づかれない
  if (!(u.kind === 'eng' && tg.isB && tg.type !== 'hall') && !d.stealth)
    s.alarms.push({ x: cx, y: cy, by: u.id, t: s.t });
}

// 攻撃側の火計：着弾点の周囲の守将と建物にまとめて当てる
function castAt(s: Battle, u: Attacker, tg: Entity) {
  if (u.cd > 0) return;
  const d = ADEF[u.kind];
  u.cd = d.cd;
  const [x, y] = centerOf(tg);
  u.cast = { t: d.windup ?? 0, x, y };
  markAttack(s, u, u.cast.x, u.cast.y);
}
function fireCast(s: Battle, u: Attacker, c: Cast) {
  const d = ADEF[u.kind];
  const r = d.radius ?? 0;
  const aoe = d.aoe ?? 0;
  s.effects.push({ k: 'fire', x: c.x, y: c.y, r, t: 0, ttl: 0.55 });
  s.alarms.push({ x: c.x, y: c.y, by: u.id, t: s.t });
  for (const g of s.defenders) if (g.hp > 0 && Math.hypot(g.x - c.x, g.y - c.y) <= r) hurt(s, g, aoe, true);
  for (const b of s.buildings) if (b.hp > 0 && distEnt(c.x, c.y, b) <= r) hurt(s, b, aoe * bldMul(u, b), true);
}
const attack = (s: Battle, u: Attacker, tg: Entity) => (ADEF[u.kind].aoe ? castAt(s, u, tg) : strike(s, u, tg));

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
        if (isCliff(s.height[tileOf(u.x, u.y)], s.height[tileOf(nx, ny)]) || s.river[tileOf(nx, ny)]) continue;
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
  // 近づく相手：寄り道の距離の内の守将を優先し、なければ櫓。どちらもいなければ、本丸への道を進む
  let tg: Entity | null = u.target ? s.byId[u.target] : null;
  if (u.repath <= 0 || (tg && tg.hp <= 0)) {
    u.repath = 0.6;
    // 守将には2.5マス、櫓には射程の0.5マス内側まで近づく
    const goal = (e: Entity) => goalNear(e, e.isB ? (BDEF[e.type].range ?? 1) - 0.5 : 2.5, false);
    const f = detourTarget(s, u, goal, (e) => goal(e)(tileOf(u.x, u.y)));
    tg = f?.tg ?? hallOf(s);
    // 斥候は門を壊せないが、門を通れるものとして本丸への道を探し、門の手前まで進んで待つ
    // （advance は、道の先が建物なら止まる。斥候の道探しのままだと、門で閉じた城では道が見つからない）
    u.path = f ? f.path : computePath(s, { ...u, kind: 'inf' }, attackGoal(s, u)(tg)) || [];
    u.target = tg ? tg.id : 0;
  }
  advance(s, u, d.speed * DT);
}

function attackerAct(s: Battle, u: Attacker) {
  const d = ADEF[u.kind];
  u.cd -= DT;
  u.repath -= DT;
  // 本丸への道を進んでいるあいだは、寄り道を始める所を今いる所にしておく
  if (d.reach !== undefined && onRoute(u, u.target ? s.byId[u.target] : null)) {
    u.rx = u.x;
    u.ry = u.y;
  }
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
    const p = pickAttackerTarget(s, u);
    tg = p.tg;
    u.target = tg ? tg.id : 0;
    setPath(u, p.path);
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
  // 兵は、本丸への道を進むあいだ、寄り道できる相手がいないか（衝車は、狙う門が変わっていないか）を見ながら進む。
  // 寄り道で追っている守将が、寄り道を始めた所から離れすぎたら、追うのをやめる
  if (
    d.reach !== undefined &&
    tg &&
    (s.tick + u.id) % 15 === 0 &&
    ((onRoute(u, tg) && !inAttackRange(s, u, tg)) || (!tg.isB && distEnt(u.rx, u.ry, tg) > d.reach * DETOUR_PATH_RATE))
  ) {
    const p = pickAttackerTarget(s, u);
    if (p.tg && p.tg !== tg) {
      tg = p.tg;
      u.target = tg.id;
      setPath(u, p.path);
      u.blocker = 0;
    }
  }
  if (!tg) return;
  const rng = rangeAt(s, d.range, u.x, u.y);
  const bl = u.blocker ? (s.byId[u.blocker] as BuildingEnt) : null;
  if (bl && bl.hp > 0) {
    if (distEnt(u.x, u.y, bl) <= rng) {
      attack(s, u, bl);
      return;
    }
    moveDirect(s, u, clamp(u.x, bl.x0, bl.x0 + bl.w), clamp(u.y, bl.y0, bl.y0 + bl.h), d.speed * DT);
    return;
  }
  u.blocker = 0;
  if (distEnt(u.x, u.y, tg) <= rng) {
    attack(s, u, tg);
    return;
  }
  if (!u.path.length || u.repath <= 0) {
    const found = computePath(s, u, attackGoal(s, u)(tg));
    u.path = found || [];
    u.repath = 0.6;
    // 壊せない城壁で閉じた区画の中など、道のない施設は狙いから外し、次のティックで選び直す
    if (!found && tg.isB && tg.type !== 'hall') {
      u.skip.push(tg.id);
      u.target = 0;
      return;
    }
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

// 早鐘：立っている鐘楼の見張りの範囲に攻め手がいれば鐘が鳴り、その攻め手を城じゅうの守将に知らせる。
// 忍びは、櫓と同じく近くまで来ないと見つからない
function ringBells(s: Battle) {
  s.bell = [];
  s.ringing = [];
  const watch = BDEF.bell.aura ?? 0;
  for (const b of s.buildings) {
    if (b.type !== 'bell' || b.hp <= 0) continue;
    const cx = b.x0 + 0.5;
    const cy = b.y0 + 0.5;
    let rung = false;
    for (const e of s.attackers) {
      if (e.hp <= 0 || Math.hypot(e.x - cx, e.y - cy) > watch || !visibleFrom(cx, cy, e)) continue;
      rung = true;
      if (!s.bell.includes(e.id)) s.bell.push(e.id);
    }
    if (rung) s.ringing.push(b.id);
  }
}

function towerAct(s: Battle, b: BuildingEnt) {
  b.cd -= DT * buffOf(s, b.x0 + 0.5, b.y0 + 0.5);
  if (b.hp <= 0 || b.cd > 0) return;
  const d = BDEF[b.type];
  const range = rangeAt(s, d.range ?? 0, b.x0 + 0.5, b.y0 + 0.5);
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
  const sh = shoot(s, d.shot ?? 'arrow', 'd', cx, cy, tg, dmg, { splash: d.splash });
  b.aimX = sh.tx - cx;
  b.aimY = sh.ty - cy;
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
      for (const a of s.attackers)
        if (a.hp > 0 && Math.hypot(a.x - c.x, a.y - c.y) <= radius) hurt(s, a, d.aoe ?? 0, true);
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
      // 鐘が鳴っていれば、見つける範囲の外でも、鐘楼が見つけた攻め手のうち近い者に向かう（追える遠さは知らせと同じ）
      if (!tg) {
        let bb = Infinity; // 守将から、鐘楼が見つけた攻め手までの距離
        for (const id of s.bell) {
          const by = s.byId[id] as Attacker | undefined;
          if (!by || by.hp <= 0 || Math.hypot(by.x - u.hx, by.y - u.hy) > base + ALERT_EXTRA) continue;
          const dd = Math.hypot(by.x - u.x, by.y - u.y);
          if (dd >= bb) continue;
          bb = dd;
          tg = by;
        }
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
          // 道がないときは持ち場へ一気に戻す。速さの記録が跳ねないよう、前の位置も合わせる
          u.x = u.px = u.hx;
          u.y = u.py = u.hy;
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
  const rng = rangeAt(s, d.range, u.x, u.y);
  if (distEnt(u.x, u.y, tg) <= rng) {
    if (d.aoe) {
      if (u.cd <= 0) {
        u.cast = { t: d.windup ?? 0, x: tg.x, y: tg.y };
        u.cd = d.cd;
        markAttack(s, u, tg.x, tg.y);
      }
    } else if (u.cd <= 0) {
      u.cd = d.cd;
      markAttack(s, u, tg.x, tg.y);
      const dmg = d.dmg * bonusOf(d, u, tg);
      const fx = { stun: d.stun, cleave: d.cleave };
      if (d.shot) shoot(s, d.shot, 'd', u.x, u.y, tg, dmg, fx);
      else {
        s.effects.push({ k: 'hit', x: tg.x, y: tg.y, t: 0, ttl: 0.22 });
        impact(s, 'd', tg, dmg, fx);
      }
      u.lx = u.x;
      u.ly = u.y;
    }
    return;
  }
  // 道が見つからなくても毎ティック探し直さない（壁の向こうの敵を見つけたとき重くなるため）
  if (u.repath <= 0) {
    u.path = computePath(s, u, goalNear(tg, rangeFromTile(s, d.range), d.range > 1.5)) || [];
    u.repath = 0.6;
  }
  advance(s, u, d.speed * DT * sl);
}

// ---- 1ティック ----------------------------------------------------------
export function step(s: Battle) {
  if (s.over || !s.started) return;
  s.t += DT;
  s.tick++;
  moveShots(s);
  ringBells(s);
  for (const b of s.buildings) if (BDEF[b.type].tower) towerAct(s, b);
  for (const u of s.defenders) if (u.hp > 0) defenderAct(s, u);
  for (const u of s.attackers) if (u.hp > 0) attackerAct(s, u);
  s.attackers = s.attackers.filter((u) => u.hp > 0);
  s.defenders = s.defenders.filter((u) => u.hp > 0);
  for (const e of s.effects) e.t += DT;
  s.effects = s.effects.filter((e) => e.t < e.ttl);
  s.alarms = s.alarms.filter((a) => s.t - a.t <= ALARM_TTL);
  // このティックで動いた速さを記録する（次のティックで、飛び道具が動く先を読むのに使う）
  for (const list of [s.attackers, s.defenders])
    for (const u of list) {
      u.vx = (u.x - u.px) / DT;
      u.vy = (u.y - u.py) / DT;
      u.px = u.x;
      u.py = u.y;
    }
  for (const e of s.attackers) if (e.fl > 0) e.fl--;
  for (const e of s.defenders) if (e.fl > 0) e.fl--;
  for (const e of s.buildings) if (e.fl > 0) e.fl--;
  if (!s.over) {
    if (s.t >= s.timeLimit) {
      s.over = true;
      s.result = 'timeout';
      s.endT = s.t;
    } else if (!s.attackers.length && !attackerShotsFlying(s) && !UNIT_ORDER.some((k) => canDeploy(s, k))) {
      s.over = true;
      s.result = 'wipe';
      s.endT = s.t;
    }
  }
}
