import {
  ADEF,
  ALARM_TTL,
  ALERT_EXTRA,
  ALERT_TIME,
  ATTACK_ENGAGED,
  type AttackerKind,
  BDEF,
  BUDGET_A,
  type BuildingType,
  DETOUR_PATH_RATE,
  DT,
  GDEF,
  type GeneralKind,
  type GeneralStats,
  gateMul,
  H,
  HEIGHT_RANGE_BONUS,
  isFacilityType,
  MAX_GENERALS,
  PLAN_LIMIT,
  PLAN_TICKS,
  REPAIR_RADIUS,
  RIVER_SPEED,
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
import { drawbridges, fpOf, isCliff, type Layout } from './layout';
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
  ward: number; // 掛かっている、傷を減らす割合
  wardEnd: number; // その効果が切れる時刻
  // 最後に撃った向き（まだなら、模型と同じ -x の向き）。戦闘の計算には使わず、画面で大筒の筒を向けるために記録する
  aimX: number;
  aimY: number;
}
// 構えの状態：never まだ一度も攻撃していない／fired 攻撃したことがある／aimed 構え終わるのを待っている
type AimState = 'never' | 'fired' | 'aimed';
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
  // 最後に攻撃した時刻（まだなら -1）と、狙った位置。戦闘の計算には使わず、画面の動きのために記録する
  atkT: number;
  aimState: AimState; // 構えの状態（構える時間 aim を持つ武将が、攻撃の前に構えるかを決める）
  // スキル：次の番がスキルか（前の番を終えた時に決める）と、次のスキルを出せる時刻
  nextSkill: boolean;
  skillAt: number;
  atkSkill: boolean; // 最後の動きがスキルだったか。戦闘の計算には使わず、画面でスキルのコマを出すために記録する
  atkX: number;
  atkY: number;
  burnT: number; // 最後に火計を受けた時刻（まだなら -1）。画面のため
  ward: number; // 掛かっている、傷を減らす割合
  wardEnd: number; // その効果が切れる時刻
  at: number; // 最後に中心を通ったマス（坂を上る区間を決める）。わからなければ -1
}
export interface Cast {
  t: number;
  x: number;
  y: number;
  band?: Band; // 騎馬の突撃の帯（x・y が帯の元）。火計にはない
  skill?: boolean; // スキル（徳川家康の軍配・上杉謙信の回転斬り）の溜め。x・y は武将の足元
}
// 騎馬の突撃の帯：ex・ey は帯の先、tx・ty は狙った位置
export interface Band {
  ex: number;
  ey: number;
  tx: number;
  ty: number;
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
  // 騎馬の突撃の帯（x・y が元、ex・ey が先、r は幅の半分、side は駆けさせた側）。
  // hits は当たった相手の位置と、帯の元から先までのどこで当たったか（k は 0〜1）。土埃を上げるため
  | {
      k: 'charge';
      x: number;
      y: number;
      ex: number;
      ey: number;
      r: number;
      side: Side;
      hits: { x: number; y: number; k: number }[];
      t: number;
      ttl: number;
    }
  // 徳川家康が軍配を振った所の、傷を減らす効果を掛けた範囲（効果の続くあいだ出す）
  | { k: 'ward'; x: number; y: number; r: number; t: number; ttl: number }
  // 上杉謙信の回転斬り（スキル）：足元から範囲のふちへ広がる白い輪。見た目だけで、傷は溜めが終わった時に入る
  | { k: 'spin'; x: number; y: number; r: number; side: Side; t: number; ttl: number }
  // 鉄砲・大筒を撃った所に出る火花と煙（dx・dy は撃った向き、size は大きさの倍率）。見た目だけで、戦いには関わらない
  | { k: 'smoke'; x: number; y: number; dx: number; dy: number; size: number; t: number; ttl: number };

// 当てたときに添えるもの（足止め）
interface HitExtra {
  slow?: number;
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
  wet: Uint8Array; // 水の中のマス（橋のかかっていない川と、堀）。攻め手も守将も入れるが、RIVER_SPEED 倍の速さになる
  water: Uint8Array; // 川のマス（橋のかかったマスも含む）。攻め手は出せない
  // 引き橋：門のすぐ外の堀のマス k。上がっているあいだは堀（wet）で、門 gate（建物の id）が壊れると下りて橋になる
  drawbridges: { k: number; gate: number; down: boolean }[];
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
// 攻め手の飛び道具が、まだ飛んでいるか（攻め手がいなくなっても、届くまでは全滅にしない）
export const attackerShotsFlying = (s: Battle) => s.shots.some((sh) => sh.side === 'a');
export const centerOf = (e: Entity): [number, number] => (e.isB ? [e.x0 + e.w / 2, e.y0 + e.h / 2] : [e.x, e.y]);
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
    wet: new Uint8Array(W * H),
    drawbridges: [],
    water: layout.water ? Uint8Array.from(layout.water) : new Uint8Array(W * H),
    height: layout.heights ? Uint8Array.from(layout.heights) : new Uint8Array(W * H),
    budgetA: BUDGET_A,
    used: {},
    hallId: 0,
    deployLog: [],
    timeLimit: TIME_LIMIT,
    stats: { aLost: 0, aLostCost: 0, dKilled: 0, gTotal: 0, tTotal: 0, tDown: 0, gateDown: 0, spent: 0 },
  };
  // 川と堀は、攻め手も守将も入れるが遅い。橋のかかったマスは普通の速さで渡れる
  for (let i = 0; i < W * H; i++) if ((layout.water?.[i] && !layout.bridge?.[i]) || layout.moat?.[i]) s.wet[i] = 1;
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
      ward: 0,
      wardEnd: 0,
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
  // 引き橋は、開戦の時には上がっている（堀のまま）
  for (const d of drawbridges(layout)) {
    const id = s.grid[tileIdx(d.gate.x, d.gate.y)];
    if (id) s.drawbridges.push({ k: d.k, gate: id, down: false });
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
      aimState: 'never',
      nextSkill: !!d.skillCd,
      skillAt: 0,
      atkSkill: false,
      burnT: -1,
      ward: 0,
      wardEnd: 0,
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
    px: x + 0.5 + jit,
    py: y + 0.5 - jit,
    vx: 0,
    vy: 0,
    hp: d.hp,
    maxHp: d.hp,
    cd: 0,
    atkT: -1,
    aimState: 'never',
    nextSkill: !!d.skillCd,
    skillAt: 0,
    atkSkill: false,
    burnT: -1,
    ward: 0,
    wardEnd: 0,
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

// 掛かっている、傷を減らす割合（切れていれば 0）
const wardOf = (s: Battle, e: Entity) => (e.wardEnd > s.t ? e.ward : 0);
// 徳川家康が軍配を振る：周りの味方（守りなら建物も）に、傷を減らす効果を掛ける。
// 効果は掛かった相手に付くので、範囲の外へ出ても、切れるまで続く
function raiseWard(s: Battle, u: Unit, d: Pick<GeneralStats, 'ward' | 'wardTime'>) {
  const give = (e: Entity) => {
    if (e.hp <= 0 || distEnt(u.x, u.y, e) > WARD_RADIUS) return;
    if (e.isB && BDEF[e.type].unbreakable) return; // 傷を受けないので、掛けても意味がない
    e.ward = d.ward ?? 0;
    e.wardEnd = s.t + (d.wardTime ?? 0);
  };
  if (u.side === 'a') s.attackers.forEach(give);
  else {
    s.defenders.forEach(give);
    s.buildings.forEach(give);
  }
  s.effects.push({ k: 'ward', x: u.x, y: u.y, r: WARD_RADIUS, t: 0, ttl: d.wardTime ?? 0 });
}

// 上がった引き橋は、門の外の面をふさぐ。(x, y) が門の外の側（引き橋の側）なら、その門に攻撃は当たらない。
// 門は、城の中の側からなら壊せる（壊れると引き橋が下りる）
function guarded(s: Battle, e: Entity, x: number, y: number) {
  if (!e.isB || e.type !== 'gate') return false;
  for (const d of s.drawbridges) {
    if (d.down || d.gate !== e.id) continue;
    const dx = (d.k % W) - e.x0;
    const dy = ((d.k / W) | 0) - e.y0;
    return (x - (e.x0 + 0.5)) * dx + (y - (e.y0 + 0.5)) * dy > 0;
  }
  return false;
}

// burn は火計の傷。実際に傷を受けた相手（盾持ちが肩代わりしたら盾持ち）に、焼かれた時刻を付ける。
// from は攻撃した位置（上がった引き橋の門に、外の側から当たらないようにするため）
function hurt(s: Battle, e: Entity, amt: number, burn = false, from?: { x: number; y: number }) {
  if (e.hp <= 0) return;
  if (e.isB && BDEF[e.type].unbreakable) return; // 城壁は壊せない（範囲攻撃でも減らない）
  if (from && guarded(s, e, from.x, from.y)) return;
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
      // 引き橋の門が壊れたら、引き橋が下りて橋になる（ふつうの速さで渡れる）
      for (const d of s.drawbridges)
        if (d.gate === e.id && !d.down) {
          d.down = true;
          s.wet[d.k] = 0;
          log(s, '引き橋が下りた', 'a');
        }
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

// from から i へ入る重み。崖（高さの差が2段以上）は通れず、坂を上るときと、川や堀に入るときは遅くなる分だけ重くする。
// 水の中から建物へは入らない
function enterCost(s: Battle, side: Side, from: number, i: number, kind: AttackerKind | GeneralKind) {
  if (isCliff(s.height[from], s.height[i])) return Infinity;
  // 水の中からは、建物（壊して進む門・大筒や、守将の通る門）へ直に入らない（水の中では攻撃できず、壊せないため）
  if (s.wet[from] && s.grid[i]) return Infinity;
  const c = groundCost(s, side, i, kind) * (s.wet[i] ? 1 / RIVER_SPEED : 1);
  return s.height[i] > s.height[from] ? c / UPHILL_SPEED : c;
}
function groundCost(s: Battle, side: Side, i: number, kind: AttackerKind | GeneralKind) {
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
    // 着く先は、水の中にしない（水の中では攻撃できないので、岸で止まって戦う）
    if (i !== start && goalFn(i) && !s.wet[i]) {
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
        // 斜めに進むときは、角を挟む2マスのどちらかが崖か水（川・堀）なら通れない（斜めに並んだ水の角を抜けて、水を渡らずに越えないように）
        if (
          diag &&
          (isCliff(s.height[i], s.height[tileIdx(x + dx, y)]) ||
            isCliff(s.height[i], s.height[tileIdx(x, y + dy)]) ||
            s.wet[tileIdx(x + dx, y)] ||
            s.wet[tileIdx(x, y + dy)])
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

// 射程：射程が2より長いもの（間合いの長い槍は入れない）は、相手より高い所に立つと、差1段につき射程が伸びる。
// 同じ高さや、相手より低い所からは伸びない
const rangeUp = (base: number, from: number, to: number) =>
  base > 2 ? base + HEIGHT_RANGE_BONUS * Math.max(0, from - to) : base;
// 相手の立つ高さ（建物は段をまたがないので、左上のマスで見る）
const heightOf = (s: Battle, e: Entity) => s.height[e.isB ? tileIdx(e.x0, e.y0) : tileOf(e.x, e.y)];
export const rangeAt = (s: Battle, base: number, x: number, y: number, tg: Entity) =>
  rangeUp(base, s.height[tileOf(x, y)], heightOf(s, tg));

// 道の着く先：相手まで射程以内のマス。range に関数を渡すと、着く先のマスごとの射程で決める（高さで射程が変わるため）
function goalNear(tg: Entity, range: number | ((i: number) => number), ranged: boolean) {
  const off = ranged ? 0.3 : 0;
  return (i: number) =>
    distEnt((i % W) + 0.5, ((i / W) | 0) + 0.5, tg) <= (typeof range === 'number' ? range : range(i)) - off;
}
// 着く先のマスと相手の高さで決まる射程
const rangeFromTile = (s: Battle, base: number, tg: Entity) => {
  const to = heightOf(s, tg);
  return (i: number) => rangeUp(base, s.height[i], to);
};

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
    // 坂を上るときは遅い：最後に中心を通ったマスより高いマスへ向かう区間は、進める道のりを UPHILL_SPEED 倍にして使う。
    // 川や堀のマスへ向かう区間は、RIVER_SPEED 倍にする（道の重みと同じく、入るマスで決める）
    const from = u.at >= 0 ? u.at : tileOf(u.x, u.y);
    const up = (s.height[ni] > s.height[from] ? UPHILL_SPEED : 1) * (s.wet[ni] ? RIVER_SPEED : 1);
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

function moveDirect(s: Battle, u: Unit, px: number, py: number, step0: number) {
  const dx = px - u.x;
  const dy = py - u.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return;
  // 川や堀の中は遅い
  const step = s.wet[tileOf(u.x, u.y)] ? step0 * RIVER_SPEED : step0;
  const k = Math.min(step, d) / d;
  const nx = u.x + dx * k;
  const ny = u.y + dy * k;
  const ti = tileOf(nx, ny);
  if (s.grid[ti] && u.side === 'a') return;
  if (isCliff(s.height[tileOf(u.x, u.y)], s.height[ti])) return; // 崖には入れない
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
  return b.type === 'hall' ? d.hall : b.type === 'gate' ? gateMul(d) : d.fac;
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
  if (d.pref === 'general') {
    const g = nearest(s.defenders, u.x, u.y);
    if (g) return g;
  }
  const cands: Entity[] = [...s.defenders, ...s.buildings.filter((b) => BDEF[b.type].tower && reachable(b)), hall];
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
  chargeGoal(s, u, ADEF[u.kind], e, goalNear(e, rangeFromTile(s, ADEF[u.kind].range, e), ADEF[u.kind].range > 1.5));
// 川や堀の中にいるあいだは、攻撃（スキルも）を始めない。渡り切ってから戦う（攻めも守りも同じ）
export const inWater = (s: Battle, u: Unit) => s.wet[tileOf(u.x, u.y)] === 1;
const inAttackRange = (s: Battle, u: Attacker, e: Entity) =>
  !inWater(s, u) && distEnt(u.x, u.y, e) <= rangeAt(s, ADEF[u.kind].range, u.x, u.y, e);

// 兵が寄り道で相手にするものの組（好みの順。前の組に寄り道できる相手がいれば、後の組は見ない）
function detourGroups(s: Battle, u: Attacker): Entity[][] {
  const towers = () => s.buildings.filter((b) => !!BDEF[b.type].tower);
  switch (ADEF[u.kind].pref) {
    case 'facility':
      return [s.buildings.filter(isFacility)];
    case 'gate':
      return [s.buildings.filter((b) => b.type === 'gate')];
    case 'any':
      return [[...s.defenders, ...towers()]];
    case 'general':
    case 'decoy':
      return [s.defenders, towers()];
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
      .filter(
        (e) =>
          e.hp > 0 &&
          !(e.isB && u.skip.includes(e.id)) &&
          !guarded(s, e, u.x, u.y) &&
          (distEnt(u.rx, u.ry, e) <= reach || here(e)),
      )
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
function markAttack(s: Battle, u: Unit, x: number, y: number, skill = false) {
  u.atkT = s.t;
  u.atkSkill = skill;
  u.atkX = x;
  u.atkY = y;
}

// 相手に当てる：傷を入れ、足止めなどを添える
function impact(s: Battle, tg: Entity, dmg: number, fx: HitExtra, from: { x: number; y: number }) {
  hurt(s, tg, dmg, false, from);
  if (fx.slow && !tg.isB && tg.side === 'd') tg.slow = Math.max(tg.slow, fx.slow); // 弓兵の足止め
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
    } else if (alive && distEnt(sh.x, sh.y, tg) <= SHOT_HIT_RADIUS) impact(s, tg, sh.dmg, sh, { x: sh.sx, y: sh.sy });
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

// 構える：まだ一度も攻撃していない駒と、しばらく攻撃していなかった駒（攻撃の待ちが終わってから AIM_IDLE より
// 長く待っていた駒）は、すぐには攻撃せず、攻撃の待ちを構える時間（aim）にして、それが過ぎてから攻撃する。
// 続けて攻撃しているあいだは、待ちが終わったティックで攻撃するので、待ちが AIM_IDLE より小さくならず、構えない。
// 戻り値が true なら、このティックは構え始めたので攻撃しない
const AIM_IDLE = DT * 3;
function startAim(u: { cd: number; aimState: AimState }, aim: number | undefined) {
  if (!aim) return false;
  if (u.cd > -AIM_IDLE && u.aimState !== 'never') {
    // 構え終わったすぐあとか、続けて攻撃しているあいだ：構えずに攻撃する
    u.aimState = 'fired';
    return false;
  }
  u.cd = aim;
  u.aimState = 'aimed';
  return true;
}

function strike(s: Battle, u: Attacker, tg: Entity) {
  if (u.cd > 0) return;
  const d = ADEF[u.kind];
  if (startAim(u, d.aim)) return;
  endTurn(s, u, d);
  let dmg = tg.isB ? d.dmg * bldMul(u, tg) : d.dmg * (d.vsGen ?? 1);
  // 築城の武将の近くにいる工兵は、施設を崩すのが速い
  if (u.kind === 'eng' && tg.isB && tg.type !== 'hall')
    for (const g of s.attackers) {
      const b = ADEF[g.kind].engBoost;
      if (b && g.hp > 0 && Math.hypot(g.x - u.x, g.y - u.y) <= REPAIR_RADIUS) {
        dmg *= b;
        break;
      }
    }
  const [cx, cy] = centerOf(tg);
  markAttack(s, u, cx, cy);
  const fx = { slow: d.slow };
  if (d.shot) shoot(s, d.shot, 'a', u.x, u.y, tg, dmg, fx);
  else {
    s.effects.push({ k: 'hit', x: cx, y: cy, t: 0, ttl: 0.22 });
    impact(s, tg, dmg, fx, u);
  }
  // 工兵が施設を崩すのは気づかれない（本丸への攻撃は知らせる）
  if (!(u.kind === 'eng' && tg.isB && tg.type !== 'hall')) s.alarms.push({ x: cx, y: cy, by: u.id, t: s.t });
}

// ---- 騎馬の突撃（武田信玄） ------------------------------------------------
// 帯は武将の足元から狙う向きへ延び、城壁・川・崖など、通れない所の手前で止まる。騎馬隊は駒ではなく、
// 火計の火と同じく一度きりの攻撃なので、溜めが終わった時に帯の中へまとめて当てる
const CHARGE_STEP = 0.25; // 帯の先を探す刻み（マス）
export const CHARGE_RIDE = 0.5; // 騎馬隊が帯を駆け抜ける時間（秒）
const CHARGE_TTL = 0.85; // 帯の演出が続く時間（秒）。駆け抜けたあと、土埃が消えるまで
type CastDef = Pick<GeneralStats, 'charge' | 'radius' | 'windup'>;

// 馬が from から to のマスへ入れるか。門は攻めには通れず、守りには通れる
function chargePasses(s: Battle, u: Unit, from: number, to: number) {
  const id = s.grid[to];
  if (id && !(u.side === 'd' && (s.byId[id] as BuildingEnt).type === 'gate')) return false;
  return enterCost(s, u.side, from, to, u.kind) !== Infinity;
}
// (x, y) から (tx, ty) の向きへ len だけ馬を進める。入れないマスの手前で止まり、止まった所を返す。
// to は入れなかったマス（止まらなければ -1、斜めの角に当たったときは -2）、from はその手前のマス
function chargeWalk(s: Battle, u: Unit, x: number, y: number, tx: number, ty: number, len: number) {
  const d = Math.hypot(tx - x, ty - y) || 1;
  const ux = (tx - x) / d;
  const uy = (ty - y) / d;
  let ex = x;
  let ey = y;
  let cx = Math.floor(x);
  let cy = Math.floor(y);
  for (let l = CHARGE_STEP; l <= len; l += CHARGE_STEP) {
    const nx = x + ux * l;
    const ny = y + uy * l;
    const fx = Math.floor(nx);
    const fy = Math.floor(ny);
    const from = tileIdx(cx, cy);
    if (!inB(fx, fy)) return { ex, ey, from, to: -2 };
    if (fx !== cx || fy !== cy) {
      const to = tileIdx(fx, fy);
      if (!chargePasses(s, u, from, to)) return { ex, ey, from, to };
      // 斜めに抜けるときは、角を挟む2マスも通れること（斜めに並んだ城壁の間を抜けないように）
      if (
        fx !== cx &&
        fy !== cy &&
        !(chargePasses(s, u, from, tileIdx(fx, cy)) && chargePasses(s, u, from, tileIdx(cx, fy)))
      )
        return { ex, ey, from, to: -2 };
      cx = fx;
      cy = fy;
    }
    ex = nx;
    ey = ny;
  }
  return { ex, ey, from: tileIdx(cx, cy), to: -1 };
}
// 帯の芯の (px, py) から、相手の所まで馬が入れるか。崖や川の向こうの相手には、帯の幅の内でも当たらない
function chargeTouches(s: Battle, u: Unit, px: number, py: number, e: Entity) {
  const [tx, ty] = centerOf(e);
  const w = chargeWalk(s, u, px, py, tx, ty, Math.hypot(tx - px, ty - py));
  if (w.to === -1) return true;
  // 建物には入れないので、崖を挟まずに面していれば当たる
  return e.isB && w.to >= 0 && s.grid[w.to] === e.id && !isCliff(s.height[w.from], s.height[w.to]);
}
// 相手が帯の中にいるか。駒は見えている帯の中だけに当たる。建物は、帯の止まった所の先にあっても当たる
function inBand(s: Battle, u: Unit, x: number, y: number, ex: number, ey: number, r: number, e: Entity) {
  const len = Math.hypot(ex - x, ey - y);
  const ux = len ? (ex - x) / len : 0;
  const uy = len ? (ey - y) / len : 0;
  const [cx, cy] = centerOf(e);
  const along = (cx - x) * ux + (cy - y) * uy;
  if (along < 0 || !len) return false;
  if (!e.isB) {
    if (along > len || Math.abs((cx - x) * uy - (cy - y) * ux) > r) return false;
    return chargeTouches(s, u, x + ux * along, y + uy * along, e);
  }
  let best = Infinity;
  let bl = 0;
  for (let l = 0; ; l += CHARGE_STEP) {
    const k = Math.min(l, len);
    const dd = distEnt(x + ux * k, y + uy * k, e);
    if (dd < best) {
      best = dd;
      bl = k;
    }
    if (l >= len) break;
  }
  return best <= r && chargeTouches(s, u, x + ux * bl, y + uy * bl, e);
}
// (x, y) から駆けさせて、帯が相手に届くか（途中に塀があれば届かない）
function chargeReaches(s: Battle, u: Unit, d: CastDef, x: number, y: number, tg: Entity) {
  const [tx, ty] = centerOf(tg);
  const { ex, ey } = chargeWalk(s, u, x, y, tx, ty, d.charge ?? 0);
  return inBand(s, u, x, y, ex, ey, d.radius ?? 0, tg);
}
// 今いる所から攻撃できるか。騎馬の突撃は、射程の内でも帯が届かなければ攻撃しない
const canCharge = (s: Battle, u: Unit, d: CastDef, tg: Entity) => !d.charge || chargeReaches(s, u, d, u.x, u.y, tg);
// 道の着く先：騎馬の突撃は、射程の内で、さらに帯が相手に届くマス
function chargeGoal(s: Battle, u: Unit, d: CastDef, tg: Entity, near: (i: number) => boolean) {
  if (!d.charge) return near;
  return (i: number) => near(i) && chargeReaches(s, u, d, (i % W) + 0.5, ((i / W) | 0) + 0.5, tg);
}
// 構えを始める：火計は相手の所に円を、騎馬の突撃は足元から帯を出す
function castOf(s: Battle, u: Unit, d: CastDef, x: number, y: number): Cast {
  const t = d.windup ?? 0;
  if (!d.charge) return { t, x, y };
  const { ex, ey } = chargeWalk(s, u, u.x, u.y, x, y, d.charge);
  return { t, x: u.x, y: u.y, band: { ex, ey, tx: x, ty: y } };
}
// 騎馬の突撃の溜めが終わった：帯の中の相手にまとめて傷を与える。守りは建物を攻めない。壊れない城壁は、
// 傷が入らないので当たりに数えない（土埃も上げない）
function fireCharge(s: Battle, u: Unit, c: Cast, band: Band, r: number, aoe: number) {
  const { ex, ey } = band;
  const hit = (e: Entity) => e.hp > 0 && inBand(s, u, c.x, c.y, ex, ey, r, e);
  const units: Unit[] = (u.side === 'a' ? s.defenders : s.attackers).filter(hit);
  const blds = u.side === 'a' ? s.buildings.filter((b) => !BDEF[b.type].unbreakable && hit(b)) : [];
  const len2 = (ex - c.x) ** 2 + (ey - c.y) ** 2 || 1;
  const hits = [...units, ...blds].map((e) => {
    const [x, y] = centerOf(e);
    return { x, y, k: clamp(((x - c.x) * (ex - c.x) + (y - c.y) * (ey - c.y)) / len2, 0, 1) };
  });
  s.effects.push({ k: 'charge', x: c.x, y: c.y, ex, ey, r, side: u.side, hits, t: 0, ttl: CHARGE_TTL });
  for (const e of units) hurt(s, e, aoe);
  if (u.side !== 'a') return;
  s.alarms.push({ x: band.tx, y: band.ty, by: u.id, t: s.t });
  for (const b of blds) hurt(s, b, aoe * bldMul(u, b), false, u);
}

function startCast(s: Battle, u: Unit, d: CastDef & SkillDef, tg: Entity, rate = 1) {
  const [x, y] = centerOf(tg);
  u.cast = castOf(s, u, d, x, y);
  endTurn(s, u, d, d.cd, rate);
  markAttack(s, u, x, y);
}

// ---- スキル ---------------------------------------------------------------
// 攻撃の番のうち、スキルが出せるものをスキルに替える。番の中身は前の番を終えた時に決めるので、
// 構えの途中で攻撃からスキルに切り替わらない（画面は、次の番の中身で構えのコマを選ぶ）
type SkillDef = Pick<GeneralStats, 'cd' | 'skillCd' | 'skillWindup' | 'ward' | 'wardTime' | 'spin' | 'spinRadius'>;
// 番を終える：次の番までの待ち（wait）を置き、次の番をスキルにするかを決める。
// 次の番が来るまでにスキルが出せるようになっていれば、次の番はスキル。rate は待ちが減る速さの倍率
// （守りは鼓楼で速まり、足止めで遅れる）で、次の番が来る時刻は、今の速さのまま減ると見込む
function endTurn(s: Battle, u: Unit, d: SkillDef, wait = d.cd, rate = 1) {
  u.cd = wait;
  u.nextSkill = !!d.skillCd && u.skillAt <= s.t + wait / rate;
}
// スキルの番なら、スキルを出す（溜めを始める）。攻撃の間隔は、溜めが終わって効いた時から数え直す。
// 出したら true を返す
function startSkill(s: Battle, u: Unit, d: SkillDef, tg: Entity, rate = 1) {
  if (u.cd > 0) return false;
  // 戦いが止んだあと（構えを解いたあと）は、構えの絵が出ていないので、番の中身を今の時刻で決め直す。
  // しばらく戦わなかった武将が、出せるスキルを攻撃の番に使ってしまわないように
  if (u.atkT >= 0 && s.t - u.atkT > d.cd + ATTACK_ENGAGED) u.nextSkill = !!d.skillCd && u.skillAt <= s.t;
  if (!u.nextSkill) return false;
  const [x, y] = centerOf(tg);
  const t = d.skillWindup ?? 0;
  u.cast = { t, x: u.x, y: u.y, skill: true };
  u.skillAt = s.t + (d.skillCd ?? 0);
  endTurn(s, u, d, t + d.cd, rate);
  markAttack(s, u, x, y, true);
  return true;
}
// スキルが効く：徳川家康の軍配（周りの味方の受ける傷を減らす）と、上杉謙信の回転斬り（周りをまとめて斬る）
function fireSkill(s: Battle, u: Unit, d: SkillDef) {
  if (d.ward) raiseWard(s, u, d);
  if (d.spin) spinSlash(s, u, d);
}
export const SPIN_TTL = 0.4; // 回転斬りの演出が続く時間（秒）
// 回転斬り：足元から範囲（spinRadius）の内の敵（武将・兵）に傷を与える。攻めは、壊せる建物にも攻めの倍率を掛けて与える
// （壊れない城壁は傷が入らないので数えない）。火計と同じく、塀や崖を挟んでも範囲の内なら当たる
function spinSlash(s: Battle, u: Unit, d: SkillDef) {
  const r = d.spinRadius ?? 0;
  const dmg = d.spin ?? 0;
  s.effects.push({ k: 'spin', x: u.x, y: u.y, r, side: u.side, t: 0, ttl: SPIN_TTL });
  for (const e of u.side === 'a' ? s.defenders : s.attackers)
    if (e.hp > 0 && Math.hypot(e.x - u.x, e.y - u.y) <= r) hurt(s, e, dmg);
  if (u.side !== 'a') return;
  s.alarms.push({ x: u.x, y: u.y, by: u.id, t: s.t });
  for (const b of s.buildings)
    if (b.hp > 0 && !BDEF[b.type].unbreakable && distEnt(u.x, u.y, b) <= r) hurt(s, b, dmg * bldMul(u, b), false, u);
}

// 攻撃側の火計と騎馬の突撃は、着弾点の周囲（突撃は帯の中）の守将と建物にまとめて当てる
function castAt(s: Battle, u: Attacker, tg: Entity) {
  if (u.cd <= 0) startCast(s, u, ADEF[u.kind], tg);
}
function fireCast(s: Battle, u: Attacker, c: Cast) {
  const d = ADEF[u.kind];
  if (c.skill) {
    fireSkill(s, u, d);
    return;
  }
  const r = d.radius ?? 0;
  const aoe = d.aoe ?? 0;
  if (c.band) {
    fireCharge(s, u, c, c.band, r, aoe);
    return;
  }
  s.effects.push({ k: 'fire', x: c.x, y: c.y, r, t: 0, ttl: 0.55 });
  s.alarms.push({ x: c.x, y: c.y, by: u.id, t: s.t });
  for (const g of s.defenders) if (g.hp > 0 && Math.hypot(g.x - c.x, g.y - c.y) <= r) hurt(s, g, aoe, true);
  for (const b of s.buildings) if (b.hp > 0 && distEnt(c.x, c.y, b) <= r) hurt(s, b, aoe * bldMul(u, b), true, u);
}
function attack(s: Battle, u: Attacker, tg: Entity) {
  const d = ADEF[u.kind];
  if (startSkill(s, u, d, tg)) return;
  if (d.aoe) castAt(s, u, tg);
  else strike(s, u, tg);
}

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
      const step = d.speed * DT * (s.wet[tileOf(u.x, u.y)] ? RIVER_SPEED : 1);
      let bx = u.x;
      let by = u.y;
      let bd = -1;
      for (let k = 0; k < 8; k++) {
        const nx = u.x + Math.cos((k * Math.PI) / 4) * step;
        const ny = u.y + Math.sin((k * Math.PI) / 4) * step;
        if (nx < 0.5 || ny < 0.5 || nx > W - 0.5 || ny > H - 0.5 || s.grid[tileOf(nx, ny)]) continue;
        if (isCliff(s.height[tileOf(u.x, u.y)], s.height[tileOf(nx, ny)])) continue;
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
  const reachable = (e: Entity) => inAttackRange(s, u, e);
  const bl = u.blocker ? (s.byId[u.blocker] as BuildingEnt) : null;
  if (bl && bl.hp > 0) {
    if (reachable(bl)) {
      attack(s, u, bl);
      return;
    }
    moveDirect(s, u, clamp(u.x, bl.x0, bl.x0 + bl.w), clamp(u.y, bl.y0, bl.y0 + bl.h), d.speed * DT);
    return;
  }
  u.blocker = 0;
  if (reachable(tg) && canCharge(s, u, d, tg)) {
    attack(s, u, tg);
    return;
  }
  // 騎馬の突撃は着く先ごとに帯を調べて重いので、道がなければ、毎ティックは探し直さない
  const wait = d.charge && !u.path.length && u.repath > 0;
  if ((!u.path.length && !wait) || u.repath <= 0) {
    const found = computePath(s, u, attackGoal(s, u)(tg));
    u.path = found || [];
    u.repath = 0.6;
    // 壊せない城壁で閉じた区画の中など、道のない施設は狙いから外し、次のティックで選び直す
    if (!found && tg.isB && tg.type !== 'hall') {
      u.skip.push(tg.id);
      u.target = 0;
      return;
    }
  }
  if (!u.path.length) {
    const px = tg.isB ? clamp(u.x, tg.x0, tg.x0 + tg.w) : tg.x;
    const py = tg.isB ? clamp(u.y, tg.y0, tg.y0 + tg.h) : tg.y;
    moveDirect(s, u, px, py, d.speed * DT);
    return;
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

// 早鐘：立っている鐘楼の見張りの範囲に攻め手がいれば鐘が鳴り、その攻め手を城じゅうの守将に知らせる
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
      if (e.hp <= 0 || Math.hypot(e.x - cx, e.y - cy) > watch) continue;
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
  const minRange = d.minRange ?? 0;
  const dmg = d.dmg ?? 0;
  const cx = b.x0 + 0.5;
  const cy = b.y0 + 0.5;
  const tg = nearest(s.attackers, cx, cy, (e) => {
    const r = Math.hypot(e.x - cx, e.y - cy);
    return r >= minRange && r <= rangeAt(s, d.range ?? 0, cx, cy, e);
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
  // 攻撃の待ちが減る速さ（鼓楼で速まり、足止めで遅れる）。次の番がスキルかの見込みにも使う
  const rate = buffOf(s, u.x, u.y) * sl;
  u.cd -= DT * rate;
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
      if (c.skill) fireSkill(s, u, d);
      else if (c.band) fireCharge(s, u, c, c.band, radius, d.aoe ?? 0);
      else {
        s.effects.push({ k: 'fire', x: c.x, y: c.y, r: radius, t: 0, ttl: 0.55 });
        for (const a of s.attackers)
          if (a.hp > 0 && Math.hypot(a.x - c.x, a.y - c.y) <= radius) hurt(s, a, d.aoe ?? 0, true);
      }
    }
    return;
  }
  if (u.alert > 0) u.alert -= DT;
  const base = d.leash + d.range + 0.5;
  const reach = base + (u.alert > 0 ? ALERT_EXTRA : 0);
  const okT = (e: Attacker | null): e is Attacker => !!e && e.hp > 0 && Math.hypot(e.x - u.hx, e.y - u.hy) <= reach;
  let tg = u.target ? (s.byId[u.target] as Attacker) : null;
  if (!okT(tg)) {
    tg = nearest(s.attackers, u.x, u.y, (e) => distEnt(u.x, u.y, e) <= d.aggro && okT(e));
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
  const reachable = (e: Entity) => !inWater(s, u) && distEnt(u.x, u.y, e) <= rangeAt(s, d.range, u.x, u.y, e);
  // 騎馬の突撃は、狙う相手に帯が届かなければ、帯の届く別の相手へ狙いを移す
  if (d.charge && !(reachable(tg) && canCharge(s, u, d, tg))) {
    const alt = nearest(s.attackers, u.x, u.y, (e) => reachable(e) && okT(e) && canCharge(s, u, d, e));
    if (alt) {
      tg = alt;
      u.target = alt.id;
      u.path = [];
    }
  }
  if (reachable(tg) && canCharge(s, u, d, tg)) {
    if (startSkill(s, u, d, tg, rate)) return;
    if (d.aoe) {
      if (u.cd <= 0) startCast(s, u, d, tg, rate);
    } else if (u.cd <= 0 && !startAim(u, d.aim)) {
      endTurn(s, u, d, d.cd, rate);
      markAttack(s, u, tg.x, tg.y);
      const dmg = d.dmg;
      const fx = {};
      if (d.shot) shoot(s, d.shot, 'd', u.x, u.y, tg, dmg, fx);
      else {
        s.effects.push({ k: 'hit', x: tg.x, y: tg.y, t: 0, ttl: 0.22 });
        impact(s, tg, dmg, fx, u);
      }
    }
    return;
  }
  // 道が見つからなくても毎ティック探し直さない（壁の向こうの敵を見つけたとき重くなるため）
  if (u.repath <= 0) {
    u.path =
      computePath(s, u, chargeGoal(s, u, d, tg, goalNear(tg, rangeFromTile(s, d.range, tg), d.range > 1.5))) || [];
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
