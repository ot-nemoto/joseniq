import {
  ADEF,
  ALARM_TTL,
  ALERT_EXTRA,
  ALERT_TIME,
  ATTACK_ENGAGED,
  type AttackerDef,
  type AttackerKind,
  BDEF,
  BUDGET_A,
  type BuildingType,
  canCarry,
  DETOUR_PATH_RATE,
  type DefTarget,
  type DetourTarget,
  DT,
  GDEF,
  type GeneralDef,
  type GeneralKind,
  type GeneralStats,
  gateMul,
  H,
  HEIGHT_RANGE_BONUS,
  ITEMS,
  type ItemKind,
  isFacilityType,
  isGeneralKind,
  MAX_GENERALS,
  PLAN_LIMIT,
  PLAN_TICKS,
  RIVER_SPEED,
  SHIELD_RADIUS,
  SHOT_HIT_RADIUS,
  SHOT_SPEED,
  type ShotKind,
  SLOW_RATE,
  skillSpan,
  TIME_LIMIT,
  UNIT_ORDER,
  UPHILL_SPEED,
  unitCost,
  W,
  WARD_RADIUS,
} from './defs';
import { clamp, flood, inB, inRing, rectDist, tileIdx } from './geometry';
import { drawbridges, fpOf, isCliff, type Layout } from './layout';
import type { GatePos } from './route';
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
  burnT: number; // 最後に煙炎漲天を受けた時刻（まだなら -1）。戦闘の計算には使わず、画面で燃える様子を出すために記録する
  // 燃え続ける傷（煙炎漲天）：1回に入れる傷（当たった時に決める）、燃え終わる時刻、次に傷を入れる時刻
  burnDmg: number;
  burnEnd: number;
  burnNext: number;
  burnSrc?: string; // 燃やした者の記録キー（計測用。戦闘の計算には使わない）
  ward: number; // 掛かっている、傷を減らす割合
  wardEnd: number; // その効果が切れる時刻
  wardSrc?: number; // 金城鉄壁を出した武将の番号（計測用。戦闘の計算には使わない）
  disarm: number; // 掛かっている、与える傷を減らす割合（諸行無常）
  disarmEnd: number; // その効果が切れる時刻
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
  // 最後に攻撃した時刻（まだなら -1）と、狙った位置。戦闘の計算には使わず、画面の動きのために記録する
  atkT: number;
  // スキル：次の番がスキルか（前の番を終えた時に決める）と、次のスキルを出せる時刻
  nextSkill: boolean;
  skillAt: number;
  atkSkill: boolean; // 最後の動きがスキルだったか。戦闘の計算には使わず、画面でスキルのコマを出すために記録する
  // 最後の攻撃の溜めが、足止めで遅れた時間（秒）。戦闘の計算には使わず、画面で、攻撃してからの経過からこれを引いて
  // コマを選ぶ（溜めが延びても、効く時刻と絵のコマを合わせるため）
  atkLag: number;
  // 次の番が来られるようになった時刻（前の番を終えたあと、攻撃の待ち cd が0になった時刻。待っているあいだは -1）。
  // 戦いが止んだか（構えを解いたか）は、ここからの経過で見る
  readyT: number;
  // 一騎打ちの相手（武将どうしで攻撃かスキルを始めた相手の武将）。0 ならなし。どちらかが倒れるまで（道が見つからなくなるまで）狙いを変えない
  duel: number;
  atkX: number;
  atkY: number;
  burnT: number; // 最後に煙炎漲天を受けた時刻（まだなら -1）。画面のため
  // 燃え続ける傷（煙炎漲天）：1回に入れる傷（当たった時に決める）、燃え終わる時刻、次に傷を入れる時刻
  burnDmg: number;
  burnEnd: number;
  burnNext: number;
  burnSrc?: string; // 燃やした者の記録キー（計測用。戦闘の計算には使わない）
  ward: number; // 掛かっている、傷を減らす割合
  wardEnd: number; // その効果が切れる時刻
  wardSrc?: number; // 金城鉄壁を出した武将の番号（計測用。戦闘の計算には使わない）
  wardUntil: number; // 自分の金城鉄壁の効果が続く時刻（効果は自分の周りに付く。0なら効いていない）
  wardRate: number; // その効果が減らす割合（振った時に決める）
  disarm: number; // 掛かっている、与える傷を減らす割合（諸行無常）
  disarmEnd: number; // その効果が切れる時刻
  disarmUntil: number; // 自分の諸行無常の効果が続く時刻（効果は自分の周りに付く。0なら効いていない）
  disarmRate: number; // その効果が減らす割合（出した時に決める）
  disarmReach: number; // その効果の範囲（出した時に決める）
  at: number; // 最後に中心を通ったマス（坂を上る区間を決める）。わからなければ -1
}
export interface Cast {
  t: number;
  x: number;
  y: number;
  skill?: boolean; // スキルの溜め（今は溜めはどれもスキル）。x・y は武将の足元（煙炎漲天は狙った相手のいた所）
  tg?: number; // スキルで狙った相手（飛び道具のスキル）
  fired?: number; // 続けて撃つスキル（国士無双）で、もう撃った発数
}
export interface Defender extends UnitBase {
  side: 'd';
  // 武将の種類か、武将がスキルで呼んだ兵の種類（守りの兵）。能力値は defOf で引く
  kind: AttackerKind;
  // 守りの兵の動き方を決める武将（呼んだ武将の種類）。武将は自分の種類
  leader: GeneralKind;
  summoner: number; // スキルで呼ばれた兵なら、呼んだ武将の番号（武将は 0）。討ち取った数にも記録にも入れない
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
  skip: number[]; // 道が見つからなかった施設（壁で閉じた区画の中など）。狙いから外す
  // 寄り道を始めた所（兵）。本丸への道を進んでいるあいだは今いる所。寄り道の相手は、ここから寄り道の距離の内で探す
  rx: number;
  ry: number;
  // 戦っている相手（攻撃かスキルを始めた相手。狙い（target）か、道をふさぐ建物（blocker））。0 ならまだ戦っていない。
  // 戦っている相手が倒れるまでは、狙いを変えない（逃げて追える遠さを出たときは除く）
  fight: number;
  // 一騎打ちを、道が見つからずにやめた相手の武将と、その武将をまた狙えるようになる時刻（すぐ狙い直して動けなくならないように）
  lost: number;
  lostT: number;
  summoner: number; // スキルで呼ばれた兵なら、呼んだ武将の番号（ふつうの兵は 0）。生きている兵として数えず、記録にも載せない
  item?: ItemKind; // 持っているアイテム（使ったらなくなる）
  hookT: number; // 鉤縄を掛け始めてからの時間（掛けていなければ 0。掛ける所を離れると初めから）
  hookGate: number; // 鉤縄を掛けている引き橋の門の番号（掛けていなければ 0。画面で縄を引くのに使う）
  hookRetry: number; // 掛ける所へ道が見つからなかったとき、次に探すまでの残り（秒。毎ティック探し直して重くならないように）
  // 道筋：通る門のマス（外から順）。routeAt が次に通る門。空なら、おまかせ（本丸へのいちばん軽い道）
  route: number[];
  routeAt: number;
}
export type Unit = Defender | Attacker;
export type Entity = BuildingEnt | Unit;

export type Effect =
  | { k: 'hit'; x: number; y: number; t: number; ttl: number }
  // 外れて地面に刺さった矢（dx・dy は飛んできた向き、side は撃った側）
  | { k: 'stuck'; x: number; y: number; dx: number; dy: number; side: Side; t: number; ttl: number }
  | { k: 'fire'; x: number; y: number; r: number; t: number; ttl: number }
  // 武田信玄が兵を呼んだ所：足元から広がる輪と土埃。見た目だけ
  | { k: 'summon'; x: number; y: number; side: Side; t: number; ttl: number }
  // 徳川家康の金城鉄壁の、傷を減らす効果の範囲（効果の続くあいだ出す。円は家康（uid）と一緒に動く）
  | { k: 'ward'; x: number; y: number; r: number; t: number; ttl: number; uid: number }
  // 上杉謙信の一騎当千（スキル）：足元から範囲のふちへ広がる白い輪。見た目だけで、傷は溜めが終わった時に入る
  | { k: 'spin'; x: number; y: number; r: number; side: Side; t: number; ttl: number }
  // 豊臣秀吉の諸行無常（スキル）：足元から範囲のふちへ広がる輪と、掛かった相手（to は番号。印は相手の今の位置に出す）の所で
  // はじける印。見た目だけ
  | { k: 'disarm'; x: number; y: number; r: number; side: Side; to: number[]; t: number; ttl: number }
  // スキルを出した時の光（どの武将のスキルでも同じ）：足元から広がる輪。見た目だけで、戦いには関わらない
  | { k: 'skill'; x: number; y: number; side: Side; t: number; ttl: number }
  // 徳川家康の金城鉄壁が効いた時：家康（x・y）から、効果が掛かった相手（to）へ飛ぶ金の光の粒。見た目だけ
  | { k: 'wardFx'; x: number; y: number; to: [number, number][]; t: number; ttl: number }
  // 鉄砲・大筒を撃った所に出る火花と煙（dx・dy は撃った向き、size は大きさの倍率）。見た目だけで、戦いには関わらない
  | { k: 'smoke'; x: number; y: number; dx: number; dy: number; size: number; t: number; ttl: number };

// 当てたときに添えるもの（足止め）。src・skill は計測用の記録（だれの・スキルの傷か）で、戦闘の計算には使わない
interface HitExtra {
  slow?: number;
  src?: string;
  skill?: boolean;
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
  // 貫通（大島光義のスキルの矢）：飛ぶ先まで止まらず、飛びながら通り道の敵に1度ずつ当てる。hit は当てた相手、
  // mul は攻めが建物に当てるときの倍率（撃った時の撃ち手の倍率。撃ち手が倒れても変わらない）
  pierce?: { hit: number[]; mul?: BldMuls };
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
  item?: ItemKind;
  route?: GatePos[]; // 道筋（通る門の並び）
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
  // 計測用の記録（戦闘の計算には使わない）。キーは「側:種類」（例 a:gunner、d:tgun）
  dmgBy: Record<string, { tot: number; unit: number; gen: number; bld: number; hall: number; skill: number }>; // 与えた傷（実際に減らした体力。相手の種類別と、スキルの傷）
  killBy: Record<string, number>; // 倒した兵・武将の数
  bKillBy: Record<string, number>; // 壊した建物の数
  takenBy: Record<string, number>; // 受けた傷（実際に減らした体力）
  castsBy: Record<string, number>; // スキルを出した回数
  genDeathT: Record<string, number>; // 武将が倒れた時刻（秒）
  wardSavedBy: Record<string, number>; // 金城鉄壁で防いだ傷の合計（出した武将ごと）
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
  // 引き橋：門のすぐ外の堀のマス k。上がっているあいだは堀（wet）で、門 gate（建物の id）が壊れると下りて橋になる。
  // inside は、門の中の側の郭のマス（ここから攻撃したときだけ、その門に当たる）
  drawbridges: { k: number; gate: number; down: boolean; inside: Uint8Array }[];
  // 作戦でこれから出す、鉤縄を持った兵の数（deployDue が書く）。道筋で上がった引き橋の前で待つ兵が、待ち続けるかを決める
  hookPlanned: number;
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
    hookPlanned: 0,
    water: layout.water ? Uint8Array.from(layout.water) : new Uint8Array(W * H),
    height: layout.heights ? Uint8Array.from(layout.heights) : new Uint8Array(W * H),
    budgetA: BUDGET_A,
    used: {},
    hallId: 0,
    deployLog: [],
    timeLimit: TIME_LIMIT,
    stats: {
      aLost: 0,
      aLostCost: 0,
      dKilled: 0,
      gTotal: 0,
      tTotal: 0,
      tDown: 0,
      gateDown: 0,
      spent: 0,
      dmgBy: {},
      killBy: {},
      bKillBy: {},
      takenBy: {},
      castsBy: {},
      genDeathT: {},
      wardSavedBy: {},
    },
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
      burnDmg: 0,
      burnEnd: 0,
      burnNext: 0,
      ward: 0,
      wardEnd: 0,
      disarm: 0,
      disarmEnd: 0,
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
    if (id) s.drawbridges.push({ k: d.k, gate: id, down: false, inside: insideOf(s, d.gate.x, d.gate.y, d.k) });
  }
  for (const g of layout.generals) {
    addDefender(s, g.kind, g.kind, g.x + 0.5, g.y + 0.5, g.x + 0.5, g.y + 0.5, 0);
    s.stats.gTotal++;
  }
  return s;
}
// 守り手と攻め手に共通の、出した時の値（番号を振り、体力を満たし、攻撃やスキルの番・効果をまだ何もない形にする）。
// スキルを持つ駒は、開戦の時点ですぐスキルを出せる
function unitBase(s: Battle, x: number, y: number, hp: number, skillCd: number | undefined) {
  return {
    id: s.nextId++,
    isB: false as const,
    x,
    y,
    px: x,
    py: y,
    vx: 0,
    vy: 0,
    hp,
    maxHp: hp,
    cd: 0,
    atkT: -1,
    nextSkill: !!skillCd,
    skillAt: 0,
    atkSkill: false,
    atkLag: 0,
    readyT: -1,
    duel: 0,
    burnT: -1,
    burnDmg: 0,
    burnEnd: 0,
    burnNext: 0,
    ward: 0,
    wardEnd: 0,
    wardUntil: 0,
    wardRate: 0,
    disarm: 0,
    disarmEnd: 0,
    disarmUntil: 0,
    disarmRate: 0,
    disarmReach: 0,
    atkX: 0,
    atkY: 0,
    target: 0,
    path: [] as number[],
    at: -1,
    repath: 0,
    blocker: 0,
    cast: null as Cast | null,
    fl: 0,
  } satisfies UnitBase & { cast: Cast | null };
}
// 守り手を (x, y) に置く。持ち場は (hx, hy)。武将は kind と leader が同じで summoner は 0。
// 守りの兵は、呼んだ武将の種類を leader に、番号を summoner に持つ
function addDefender(
  s: Battle,
  kind: AttackerKind,
  leader: GeneralKind,
  x: number,
  y: number,
  hx: number,
  hy: number,
  summoner: number,
): Defender {
  const d = defOf({ kind, leader });
  const u: Defender = {
    ...unitBase(s, x, y, d.hp, d.skillCd),
    side: 'd',
    kind,
    leader,
    summoner,
    hx,
    hy,
    alert: 0,
    slow: 0,
  };
  s.defenders.push(u);
  s.byId[u.id] = u;
  return u;
}
// 守り手の能力値。武将は GDEF。守りの兵は、兵の能力値（ADEF）に、呼んだ武将と同じ見つける範囲と持ち場から離れられる距離を
// 足したもの（持ち場は呼んだ武将の今いる所なので、武将のまわりを一緒に守る）。守りの兵はスキルを持たない
const troopDefs = new Map<string, GeneralDef>();
// 守り手のうち武将か（守りの兵を除く）
export const isGeneralDefender = (d: Defender): d is Defender & { kind: GeneralKind } => isGeneralKind(d.kind);
export function defOf(u: Pick<Defender, 'kind' | 'leader'>): GeneralDef {
  if (isGeneralKind(u.kind)) return GDEF[u.kind];
  const key = `${u.kind}:${u.leader}`;
  let d = troopDefs.get(key);
  if (!d) {
    const a = ADEF[u.kind];
    const g = GDEF[u.leader];
    // 兵の能力値は攻めの兵と同じ（武将への倍率 vsGen も持つ）。攻めにしか意味のない値（施設への倍率・寄り道など）は持たない
    d = {
      busho: a.name,
      hp: a.hp,
      dmg: a.dmg,
      cd: a.cd,
      speed: a.speed,
      range: a.range,
      shot: a.shot,
      vsGen: a.vsGen,
      aggro: g.aggro,
      // 武将を好む兵（騎兵）は、攻めの武将を兵より先に狙う。ほかの兵は近い者
      defOrder: a.pref === 'general' ? ['general', 'troop'] : [],
    };
    troopDefs.set(key, d);
  }
  return d;
}

function log(s: Battle, msg: string, side: Side) {
  s.log.push({ t: s.t, msg, side });
  if (s.log.length > 60) s.log.shift();
}

// 出撃した武将の人数
export const generalsUsed = (s: Battle) => UNIT_ORDER.reduce((n, k) => n + (ADEF[k].general ? (s.used[k] ?? 0) : 0), 0);
// 兵力と上限の両方に余裕があるか（武将は全体で MAX_GENERALS 人まで）
export function canDeploy(s: Battle, kind: AttackerKind) {
  if (s.tick > PLAN_TICKS) return false;
  const d = ADEF[kind];
  if (d.general && generalsUsed(s) >= MAX_GENERALS) return false;
  return s.budgetA >= d.cost && (!d.limit || (s.used[kind] ?? 0) < d.limit);
}

// item は、持たせるアイテム（持てる兵だけ。点数は兵力から払う）
export function deploy(
  s: Battle,
  kind: AttackerKind,
  x: number,
  y: number,
  item?: ItemKind,
  route?: readonly GatePos[],
): DeployResult {
  if (s.over) return { ok: false, msg: '戦闘は終了しています' };
  if (s.tick > PLAN_TICKS) return { ok: false, msg: `出撃できるのは開戦から${PLAN_LIMIT / 60}分までです` };
  const d = ADEF[kind];
  if (!inB(x, y) || !inRing(x, y)) return { ok: false, msg: '外周の青いエリアから出撃します' };
  if (!canDeployTile(s.height, s.water, tileIdx(x, y))) return { ok: false, msg: '出撃エリアの平地から出撃します' };
  if (d.limit && (s.used[kind] ?? 0) >= d.limit) return { ok: false, msg: `${d.name}はすでに出撃しています` };
  if (d.general && generalsUsed(s) >= MAX_GENERALS) return { ok: false, msg: `武将は${MAX_GENERALS}人までです` };
  if (item && !canCarry(kind, item)) return { ok: false, msg: `${d.name}は${ITEMS[item].name}を持てません` };
  const cost = unitCost(kind, item);
  if (s.budgetA < cost) return { ok: false, msg: '兵力が足りません' };
  s.budgetA -= cost;
  s.used[kind] = (s.used[kind] ?? 0) + 1;
  s.stats.spent += cost;
  const jit = (((s.nextId * 7) % 5) - 2) * 0.05;
  const u = addAttacker(s, kind, x + 0.5 + jit, y + 0.5 - jit, 0);
  if (item) u.item = item;
  if (route?.length) u.route = route.map(([gx, gy]) => tileIdx(gx, gy));
  s.started = true;
  const rec: DeployRecord = { tick: s.tick, t: +s.t.toFixed(3), kind, x, y };
  if (item) rec.item = item;
  if (route?.length) rec.route = route.map(([gx, gy]) => [gx, gy] as const);
  s.deployLog.push(rec);
  return { ok: true };
}
// 攻め手を (x, y) に置く。summoner は、スキルで呼んだ武将の番号（ふつうの出撃は 0）
function addAttacker(s: Battle, kind: AttackerKind, x: number, y: number, summoner: number): Attacker {
  const d = ADEF[kind];
  const u: Attacker = {
    ...unitBase(s, x, y, d.hp, d.skillCd),
    side: 'a',
    kind,
    skip: [],
    rx: x,
    ry: y,
    fight: 0,
    lost: 0,
    lostT: 0,
    summoner,
    hookT: 0,
    hookGate: 0,
    hookRetry: 0,
    route: [],
    routeAt: 0,
  };
  s.attackers.push(u);
  s.byId[u.id] = u;
  return u;
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

// 軍配が効いているか：軍配を持つ武将の効果が続いていて、その周り（WARD_RADIUS）にいる相手は、受ける傷が減る。
// 効果は掛けた相手ではなく家康自身に付くので、家康が動けば効く範囲も一緒に動き、範囲の外へ出た相手は
// その時点で効かなくなる（前は、掛かった相手に付いて切れるまで続いた）
export function wardAuraOf(s: Battle, e: Entity): { rate: number; until: number; src?: Unit } {
  const casters = !e.isB && e.side === 'a' ? s.attackers : s.defenders;
  for (const c of casters) {
    if (c.wardUntil <= s.t || !c.wardRate) continue;
    if (distEnt(c.x, c.y, e) <= WARD_RADIUS) return { rate: c.wardRate, until: c.wardUntil, src: c };
  }
  return { rate: 0, until: 0 };
}
// 徳川家康の金城鉄壁：自分の周りに、味方（守りなら建物も）の受ける傷を減らす効果を出す。
// 効果は家康に付くので、範囲は家康と一緒に動く。光の粒は、効き始めた時に周りにいた味方へ飛ばす（見た目だけ）
function raiseWard(s: Battle, u: Unit, d: Pick<GeneralStats, 'ward' | 'wardTime'>) {
  u.wardUntil = s.t + (d.wardTime ?? 0);
  u.wardRate = d.ward ?? 0;
  const to: [number, number][] = [];
  const see = (e: Entity) => {
    if (e.hp <= 0 || distEnt(u.x, u.y, e) > WARD_RADIUS) return;
    if (e.isB && BDEF[e.type].unbreakable) return; // 傷を受けないので、印を飛ばしても意味がない
    if (e !== u) to.push(centerOf(e));
  };
  if (u.side === 'a') s.attackers.forEach(see);
  else {
    s.defenders.forEach(see);
    s.buildings.forEach(see);
  }
  s.effects.push({ k: 'ward', x: u.x, y: u.y, r: WARD_RADIUS, t: 0, ttl: d.wardTime ?? 0, uid: u.id });
  s.effects.push({ k: 'wardFx', x: u.x, y: u.y, to, t: 0, ttl: WARD_FX_TTL });
}
// 掛かっている、与える傷を減らす割合（切れていれば 0）から、与える傷の倍率を出す
// 諸行無常が効いているか：諸行無常を持つ敵の武将の効果が続いていて、その周り（disarmRadius）にいる相手は、与える傷が減る。
// 金城鉄壁と同じく、効果は秀吉自身に付くので、秀吉が動けば効く範囲も一緒に動き、範囲の外へ出た相手は
// その時点で効かなくなる（前は、掛かった相手に付いて切れるまで続いた）
export function disarmAuraOf(s: Battle, e: Entity): { rate: number; until: number; src?: Unit } {
  if (e.isB && !BDEF[e.type].tower) return { rate: 0, until: 0 }; // 撃たない施設には効かない（攻撃しないので、効いたように見せない）
  const casters = e.isB || e.side === 'd' ? s.attackers : s.defenders;
  for (const c of casters) {
    if (c.disarmUntil <= s.t || !c.disarmRate) continue;
    if (distEnt(c.x, c.y, e) <= c.disarmReach) return { rate: c.disarmRate, until: c.disarmUntil, src: c };
  }
  return { rate: 0, until: 0 };
}
const dealtOf = (s: Battle, e: Entity) => 1 - disarmAuraOf(s, e).rate;
// 豊臣秀吉の諸行無常：自分の周りに、敵（兵・武将・撃つ施設）の与える傷を減らす効果を出す。効果は秀吉に付くので、
// 範囲は秀吉と一緒に動く。施設は、撃つもの（櫓・大筒）だけが傷を出すので、効くのはその2つだけ（門・本丸などは
// 攻撃しない）。煙炎漲天や一騎当千と同じく、塀や崖を挟んでも範囲の内なら効く。金城鉄壁と同じく傷を与えないので、
// 守りに知らせない。×印は、効き始めた時に周りにいた敵へ出す（見た目だけ）
function disarmFoes(s: Battle, u: Unit, d: Pick<GeneralStats, 'disarm' | 'disarmTime' | 'disarmRadius'>) {
  const r = d.disarmRadius ?? 0;
  u.disarmUntil = s.t + (d.disarmTime ?? 0);
  u.disarmRate = d.disarm ?? 0;
  u.disarmReach = r;
  const to: number[] = [];
  const see = (e: Entity) => {
    if (e.hp <= 0 || distEnt(u.x, u.y, e) > r) return;
    if (e.isB && !BDEF[e.type].tower) return;
    to.push(e.id);
  };
  if (u.side === 'a') {
    s.defenders.forEach(see);
    s.buildings.forEach(see);
  } else s.attackers.forEach(see);
  s.effects.push({ k: 'disarm', x: u.x, y: u.y, r, side: u.side, to, t: 0, ttl: DISARM_FX_TTL });
}
// 武田信玄が兵を呼ぶ：溜めのあと、足元に兵（summon）を1体出す。兵力を使わず、出撃の記録にも載せない。
// 溜めのあいだに上限に達することはない（呼ぶのはこのスキルだけ）が、念のため上限なら出さない
// 守りでは、呼んだ兵は呼んだ武将の今いる所を持ち場にし、武将と同じ見つける範囲・離れられる距離で守る（defOf・defenderAct）
function summonTroop(s: Battle, u: Unit, d: Pick<GeneralStats, 'summon' | 'summonMax'>) {
  if (!d.summon || skillBlocked(s, u, d as SkillDef)) return;
  if (u.side === 'a') addAttacker(s, d.summon, u.x, u.y, u.id);
  else if (isGeneralKind(u.kind)) addDefender(s, d.summon, u.kind, u.x, u.y, u.hx, u.hy, u.id);
  s.effects.push({ k: 'summon', x: u.x, y: u.y, side: u.side, t: 0, ttl: SUMMON_FX_TTL });
}
// スキルで呼ばれた兵を去らせる（1対1の決着のあとや、見本で使う。戦いの中では去らせない）。who を省くと、呼ばれた兵をみな去らせる
export function dismissSummoned(s: Battle, who: (a: Unit) => boolean = () => true) {
  const gone: Unit[] = [...s.attackers, ...s.defenders].filter((a) => a.summoner && who(a));
  if (!gone.length) return gone;
  for (const a of gone) delete s.byId[a.id];
  s.attackers = s.attackers.filter((a) => !gone.includes(a));
  s.defenders = s.defenders.filter((a) => !gone.includes(a));
  return gone;
}
export const SUMMON_FX_TTL = 0.6; // 兵を呼んだ時の輪と土埃が消えるまで（秒）
// 守りの兵が、狙う敵のないとき、呼んだ武将からこれより離れたら、そばまで歩いて戻る距離（マス）
export const TROOP_FOLLOW = 1.5;
export const DISARM_FX_TTL = 0.6; // 諸行無常の輪が広がり、掛かった相手の所で印がはじけ終わるまで（秒）
export const WARD_FX_TTL = 0.7; // 金城鉄壁の光の粒が飛んで、相手の所ではじけ終わるまで（秒）
export const SKILL_FX_TTL = 0.6; // スキルを出した時の光が消えるまで（秒）

// 引き橋の門 (gx, gy) の中の側の郭：門から引き橋 k と反対の向きの隣のマスから、縦横に、施設・崖をよけて塗る
// （開戦前の確かめの郭と同じく、川と堀はまたぐ）。戦いの中で壊れて通れるようになる大筒のマスと、
// 郭に面した門のマス（壊れた門の上に立って撃つ攻め手のため）も中に数える
function insideOf(s: Battle, gx: number, gy: number, k: number): Uint8Array {
  const inside = new Uint8Array(W * H);
  const sx = 2 * gx - (k % W);
  const sy = 2 * gy - ((k / W) | 0);
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return inside;
  const open = (i: number) => {
    const id = s.grid[i];
    return !id || (s.byId[id] as BuildingEnt).type === 'cata';
  };
  const start = tileIdx(sx, sy);
  if (!open(start)) return inside;
  const gateSide: number[] = [];
  flood(
    [start],
    (x, y, nx, ny) => {
      const i = tileIdx(x, y);
      const j = tileIdx(nx, ny);
      if (isCliff(s.height[i], s.height[j])) return false;
      if (open(j)) return true;
      if ((s.byId[s.grid[j]] as BuildingEnt).type === 'gate' && j !== tileIdx(gx, gy)) gateSide.push(j);
      return false;
    },
    inside,
  );
  for (const j of gateSide) inside[j] = 1;
  return inside;
}
// 上がった引き橋は、門の外の面をふさぐ。(x, y) が門の中の側の郭にないなら、その門に攻撃は当たらない
// （引き橋の側のほか、斜め前や、塀の外の川・堀から撃っても当たらない）。門は、中の側からなら壊せる（壊れると引き橋が下りる）
function guarded(s: Battle, e: Entity, x: number, y: number) {
  if (!e.isB || e.type !== 'gate') return false;
  for (const d of s.drawbridges) {
    if (d.down || d.gate !== e.id) continue;
    return !d.inside[tileOf(x, y)];
  }
  return false;
}
// 上がった引き橋のマスか（守り手は、上がった引き橋へ出ない。自分で引き橋を下ろすことはないため）
const raised = (s: Battle, i: number) => s.drawbridges.some((d) => !d.down && d.k === i);
type Drawbridge = Battle['drawbridges'][number];
// 引き橋を下ろして橋にする（ふつうの速さで渡れ、門には外からも攻撃が当たる）
function lowerBridge(s: Battle, d: Drawbridge, msg: string) {
  d.down = true;
  s.wet[d.k] = 0;
  log(s, msg, 'a');
}
// 鉤縄を掛ける所：上がった引き橋の、門と反対の側の隣のマス。陸で、門のほかの建物がなく、引き橋と崖で隔たっていないこと（でなければ -1）。
// 門が立っていれば（両端が門の引き橋の、反対の門）、鉤縄の工兵はまずその門を壊し、壊れた跡から掛ける
export function hookSpot(s: Battle, d: Drawbridge) {
  const g = s.byId[d.gate] as BuildingEnt;
  const kx = d.k % W;
  const ky = (d.k / W) | 0;
  const x = 2 * kx - g.x0;
  const y = 2 * ky - g.y0;
  if (!inB(x, y)) return -1;
  const i = tileIdx(x, y);
  const b = s.grid[i] ? (s.byId[s.grid[i]] as BuildingEnt) : null;
  return s.wet[i] || (b && b.type !== 'gate') || isCliff(s.height[i], s.height[d.k]) ? -1 : i;
}

export const BURN_TICK = 1; // 燃え続ける傷を入れる間（秒）
// 煙炎漲天が当たった相手を燃やす：燃える時間を初めから数え直し、BURN_TICK ごとに per の傷を入れる（重ねない）。
// per は当たった時に決める（諸行無常で減った煙炎漲天なら、燃える傷も減る）。
// e は、煙炎漲天の傷を実際に受けた相手（hurt の返り値。壊れない城壁には null を返すので、城壁は燃えない）。盾兵が肩代わりしたら、燃えるのも盾兵（炎も盾兵に出るので、炎と燃える傷を受ける者がそろう）。
// 煙炎漲天が当たらなかった相手（上がった引き橋の門に外から落とした時など）は燃えない。肩代わりした盾兵がその傷で倒れたら、だれも燃えない
function ignite(s: Battle, e: Entity | null, per: number, time: number, srcK?: string) {
  if (!e || !per || !time || e.hp <= 0) return;
  e.burnDmg = per;
  e.burnEnd = s.t + time;
  e.burnNext = s.t + BURN_TICK;
  e.burnSrc = srcK;
}
// まだ燃える傷が残っているか（燃え終わる時刻ちょうどの回まで入れる）
export const isBurning = (e: Entity) => e.hp > 0 && e.burnDmg > 0 && e.burnNext <= e.burnEnd + 1e-9;
// 攻め手の傷がまだ残っているか：攻め手の矢や弾が飛んでいるか、攻め手が燃やした守り手（守将・守りの兵・建物）が燃えている。
// 攻め手がいなくなっても、これが残るあいだは全滅にしない（残りの傷で本丸が落ちることがある）
const attackerHarmPending = (s: Battle) =>
  attackerShotsFlying(s) || s.defenders.some(isBurning) || s.buildings.some(isBurning);
// 攻め手が尽きたか：スキルで呼んだ兵のほかに攻め手がおらず、攻め手の傷も残っていない（攻め手の矢や弾が届くまで、
// 攻め手が燃やした守り手が燃え終わるまで待つ）。出撃できるかは見ない。step と autoStep の全滅の判定が同じものを使う
export const attackersSpent = (s: Battle) => !s.attackers.some((a) => !a.summoner) && !attackerHarmPending(s);
// 燃えている相手に、BURN_TICK ごとに傷を入れる。受ける傷は、ふつうの傷と同じく金城鉄壁で減り、盾兵が代わりに受ける。
// 燃え終わる時刻ちょうどの回まで入れる（3秒なら3回）
function burnTick(s: Battle) {
  for (const list of [s.defenders, s.attackers, s.buildings] as Entity[][])
    for (const e of list) {
      if (s.over) return; // 燃える傷で本丸が落ちたら、残りの燃える傷は入れない
      if (e.hp <= 0 || !e.burnDmg || s.t < e.burnNext - 1e-9) continue;
      if (!isBurning(e)) {
        e.burnDmg = 0;
        continue;
      }
      e.burnNext += BURN_TICK;
      hurt(s, e, e.burnDmg, false, undefined, e.burnSrc ? { k: e.burnSrc, skill: true } : undefined);
    }
}
// 傷の記録（計測用）：だれの傷か（「側:種類」）と、スキルの傷か。呼ばれた兵の傷は、呼んだ武将のスキルの傷として数える
export interface DmgSrc {
  k: string;
  skill?: boolean;
}
const srcOfUnit = (s: Battle, u: Unit): DmgSrc => {
  if (u.summoner) {
    const m = s.byId[u.summoner];
    if (m && !m.isB) return { k: `${m.side}:${m.kind}`, skill: true };
  }
  return { k: `${u.side}:${u.kind}` };
};
const shotSrc = (sh: Shot): DmgSrc | undefined => (sh.src ? { k: sh.src, skill: sh.skill } : undefined);

// burn は煙炎漲天の傷。実際に傷を受けた相手（盾持ちが肩代わりしたら盾持ち）に、焼かれた時刻を付ける。
// from は攻撃した位置（上がった引き橋の門に、外の側から当たらないようにするため）。
// 実際に傷を受けた相手を返す（当たらなかったら null。煙炎漲天で燃やす相手を、傷を受けた相手にそろえるため）
function hurt(
  s: Battle,
  e: Entity,
  amt: number,
  burn = false,
  from?: { x: number; y: number },
  src?: DmgSrc,
): Entity | null {
  // 決着したら（本丸が落ちたら）、同じティックのうちでも、もう傷は入れない（飛んでいた矢や大筒の玉・燃える傷なども）
  if (s.over) return null;
  if (e.hp <= 0) return null;
  if (e.isB && BDEF[e.type].unbreakable) return null; // 城壁は壊せない（範囲攻撃でも減らない）
  if (from && guarded(s, e, from.x, from.y)) return null;
  if (!e.isB && e.side === 'a') {
    const sh = shieldOf(s, e);
    if (sh) return hurt(s, sh, amt, burn, undefined, src);
  }
  const au = wardAuraOf(s, e);
  const w = au.rate;
  // 計測用の記録：金城鉄壁で防いだ傷を、出した武将に積む
  if (w && au.src) {
    const k = `${au.src.side}:${au.src.kind}`;
    s.stats.wardSavedBy[k] = (s.stats.wardSavedBy[k] ?? 0) + amt * w;
  }
  const before = e.hp;
  e.hp -= w ? amt * (1 - w) : amt;
  // 計測用の記録：実際に減らした体力を、与えた側・受けた側の両方に積む（戦闘の計算には使わない）
  const lost = before - Math.max(0, e.hp);
  if (lost > 0) {
    if (!e.isB) {
      const tk = `${e.side}:${e.kind}`;
      s.stats.takenBy[tk] = (s.stats.takenBy[tk] ?? 0) + lost;
    }
    if (src) {
      let rec = s.stats.dmgBy[src.k];
      if (!rec) rec = s.stats.dmgBy[src.k] = { tot: 0, unit: 0, gen: 0, bld: 0, hall: 0, skill: 0 };
      rec.tot += lost;
      if (e.isB) {
        if (e.type === 'hall') rec.hall += lost;
        else rec.bld += lost;
      } else if (isGeneralKind(e.kind)) rec.gen += lost;
      else rec.unit += lost;
      if (src.skill) rec.skill += lost;
    }
  }
  e.fl = 4;
  if (burn) e.burnT = s.t;
  if (e.hp > 0) return e;
  e.hp = 0;
  // 計測用の記録：倒した・壊した数と、武将が倒れた時刻
  if (src) {
    if (e.isB) s.stats.bKillBy[src.k] = (s.stats.bKillBy[src.k] ?? 0) + 1;
    else s.stats.killBy[src.k] = (s.stats.killBy[src.k] ?? 0) + 1;
  }
  if (!e.isB && isGeneralKind(e.kind)) {
    const tk = `${e.side}:${e.kind}`;
    if (s.stats.genDeathT[tk] === undefined) s.stats.genDeathT[tk] = s.t;
  }
  if (e.isB) {
    // 門と大筒（breakThrough）は壊れたら通れる。櫓・鼓楼は壊れても石垣の台が残り、通れない（壁の並びに置いた櫓が抜け道にならないように）
    if (BDEF[e.type].breakThrough)
      for (let yy = e.y0; yy < e.y0 + e.h; yy++) for (let xx = e.x0; xx < e.x0 + e.w; xx++) s.grid[tileIdx(xx, yy)] = 0;
    if (e.type === 'gate') {
      s.stats.gateDown++;
      log(s, '門が破られた', 'a');
      // 引き橋の門が壊れたら、引き橋が下りて橋になる（ふつうの速さで渡れる）
      for (const d of s.drawbridges) if (d.gate === e.id && !d.down) lowerBridge(s, d, '引き橋が下りた');
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
    // 守りの兵（呼ばれた兵）は、討ち取った数にも記録にも入れない
    if (!e.summoner) {
      s.stats.dKilled++;
      log(s, `${defOf(e).busho}を討ち取った`, 'a');
    }
  } else {
    if (!e.summoner) {
      s.stats.aLost++;
      // 使う前のアイテムを持って倒れたら、その点数も失う
      s.stats.aLostCost += unitCost(e.kind, e.item);
    }
    const d = ADEF[e.kind];
    // 呼んだ兵は失った数に入れないので、記録にも出さない
    if (!e.summoner && (d.general || d.cost >= 3)) log(s, `${d.name}が倒れた`, 'd');
  }
  return e;
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
// only は、道筋を持つ攻め手が通ってよい門のマス（道筋の残りの門）。ほかの門は通らない（null なら、どの門も壊して通れる）
function enterCost(s: Battle, side: Side, from: number, i: number, only: ReadonlySet<number> | null = null) {
  if (isCliff(s.height[from], s.height[i])) return Infinity;
  if (only && s.grid[i] && !only.has(i) && (s.byId[s.grid[i]] as BuildingEnt).type === 'gate') return Infinity;
  // 攻め手は、水の中から建物（壊して進む門・大筒）へ直に入らない（水の中では攻撃できず、壊せないため）
  if (side === 'a' && s.wet[from] && s.grid[i]) return Infinity;
  // 守り手は、上がった引き橋へ出ない
  if (side === 'd' && s.wet[i] && raised(s, i)) return Infinity;
  const c = groundCost(s, side, i) * (s.wet[i] ? 1 / RIVER_SPEED : 1);
  return s.height[i] > s.height[from] ? c / UPHILL_SPEED : c;
}
function groundCost(s: Battle, side: Side, i: number) {
  const id = s.grid[i];
  if (!id) return 1;
  const b = s.byId[id] as BuildingEnt;
  // 攻撃側は門・大筒（breakThrough）を壊して進める。城壁・櫓・鼓楼は通れない
  if (side === 'a') return BDEF[b.type].breakThrough ? 1 + b.hp / 25 : Infinity;
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
  const only = u.side === 'a' && u.route.length ? new Set(u.route.slice(u.routeAt)) : null;
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
        const c = enterCost(s, u.side, i, ni, only);
        if (c === Infinity) continue;
        const diag = dx && dy;
        // 斜めに進むときは、行き先が建物でなく、角を挟む2マスのどちらも建物・崖・水（川・堀）でないこと
        if (diag && (s.grid[ni] || cornerShut(s, i, ni))) continue;
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
    // 川や堀のマスへ向かう区間は、RIVER_SPEED 倍にする（道の重みと同じく、入るマスで決める。moveRate）
    const from = u.at >= 0 ? u.at : tileOf(u.x, u.y);
    const d = Math.hypot(dx, dy) / moveRate(s, from, ni);
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

// 道を外れて from のマスから to のマスへ動くときの速さの倍率。advance と同じく、入るマスで決める
// （高いマスへ上るときは UPHILL_SPEED 倍、川や堀のマスは RIVER_SPEED 倍。同じマスの中を動くときは、そのマスで決める）
const moveRate = (s: Battle, from: number, to: number) =>
  (s.height[to] > s.height[from] ? UPHILL_SPEED : 1) * (s.wet[to] ? RIVER_SPEED : 1);
// from のマスから斜めに隣の to のマスへ抜けるとき、角を挟む2マスのどちらかが建物・崖・水（川・堀）なら通れない
// （斜めに並んだ城壁や水の角を抜けて、水を渡らずに越えないように）。道を探すとき（computePath）に使う。
// moveDirect（門に寄る最後の一歩・道が見つからないときの直進）では見ない（ほかの向きを選べず、角の前で止まり続けるため）
function cornerShut(s: Battle, from: number, to: number) {
  const fx = from % W;
  const fy = (from / W) | 0;
  const tx = to % W;
  const ty = (to / W) | 0;
  if (fx === tx || fy === ty) return false;
  return [tileIdx(tx, fy), tileIdx(fx, ty)].some((c) => s.grid[c] || s.wet[c] || isCliff(s.height[from], s.height[c]));
}
function moveDirect(s: Battle, u: Unit, px: number, py: number, step0: number) {
  const dx = px - u.x;
  const dy = py - u.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return;
  // 坂を上るときと、川や堀の中は遅い（入るマスで決める）
  const from = tileOf(u.x, u.y);
  const k0 = Math.min(step0, d) / d;
  const step = step0 * moveRate(s, from, tileOf(u.x + dx * k0, u.y + dy * k0));
  const k = Math.min(step, d) / d;
  const nx = u.x + dx * k;
  const ny = u.y + dy * k;
  const ti = tileOf(nx, ny);
  if (s.grid[ti] && u.side === 'a') return;
  if (u.side === 'd' && s.wet[ti] && raised(s, ti)) return; // 守り手は、上がった引き橋へ出ない
  if (isCliff(s.height[from], s.height[ti])) return; // 崖には入れない
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
// 攻め手の建物への倍率（本丸・門・ほかの施設）
type BldMuls = { fac: number; gate: number; hall: number };
const mulsOf = (d: AttackerDef): BldMuls => ({ fac: d.fac, gate: gateMul(d), hall: d.hall });
const mulFor = (m: BldMuls, b: BuildingEnt) => (b.type === 'hall' ? m.hall : b.type === 'gate' ? m.gate : m.fac);
// 毎ティック建物ごとに呼ぶので、倍率をまとめた物は作らずに直に読む
const bldMul = (u: Attacker, b: BuildingEnt) => {
  const d = ADEF[u.kind];
  return b.type === 'hall' ? d.hall : b.type === 'gate' ? gateMul(d) : d.fac;
};

// 攻め手の狙いを選ぶ。寄り道先を選んだときは、そこへの道も返す（path が null なら、道はあとで探す）。
// 寄り道の相手がいなければ、本丸への道を進む（武将も兵と同じ）
function pickAttackerTarget(s: Battle, u: Attacker): { tg: Entity | null; path: number[] | null } {
  return detourTarget(s, u, attackGoal(s, u), (e) => hitsFromHere(s, u, e)) ?? { tg: routeTarget(s, u), path: null };
}
// 今いる所から相手に手が届くか：攻撃の射程の内か、スキルの番で、射程で出すスキル（光義の弓・信長の国士無双・
// 昌幸の煙炎漲天）を出す距離の内。届く相手は道を離れずに済むので、寄り道の距離より遠くても狙う。
// 傷を与えないスキル（信玄の千軍万馬など）は、相手に手が届くわけではないので数えない
const hitsFromHere = (s: Battle, u: Attacker, e: Entity) => {
  const d = ADEF[u.kind];
  return inAttackRange(s, u, e) || (rangedSkill(d) && skillReady(s, u, d) && inSkillRange(s, u, d, e));
};

// 狙いを変えたときの道。選ぶときに求めた道があれば使い、なければ空にして、次に動くときに探す
function setPath(u: Attacker, path: number[] | null) {
  u.path = path ?? [];
  if (path?.length) u.repath = 0.6;
}

// 兵が本丸への道の上で向かう先：衝車は、本丸への道をふさいでいる最初の門（道に門がなければ本丸）。ほかは本丸
function routeTarget(s: Battle, u: Attacker): Entity {
  // 道筋を持つ兵は、どの兵種も、道筋の次の門へ向かって壊す
  const next = routeGate(s, u);
  if (next) return next;
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
// 本丸への道の上で向かう先か（本丸と、衝車にとっての門と、道筋の次の門）
const onRoute = (u: Attacker, e: Entity | null) =>
  !e || (e.isB && (e.type === 'hall' || (e.type === 'gate' && (ADEF[u.kind].pref === 'gate' || isRouteGate(u, e)))));
// 道筋の次の門か
const isRouteGate = (u: Attacker, e: Entity) =>
  e.isB && u.route.length > 0 && u.route[u.routeAt] === tileIdx(e.x0, e.y0);
// 道筋の次の門（建物）。壊れた門は通れるので飛ばす。通り終えたら道筋を消して、おまかせ（本丸へのいちばん軽い道）にする
function routeGate(s: Battle, u: Attacker): BuildingEnt | null {
  while (u.routeAt < u.route.length) {
    const id = s.grid[u.route[u.routeAt]];
    const b = id ? (s.byId[id] as BuildingEnt) : null;
    if (b && b.type === 'gate' && b.hp > 0) return b;
    u.routeAt++;
  }
  if (u.route.length) {
    u.route = [];
    u.routeAt = 0;
  }
  return null;
}
// 道筋で上がった引き橋の前で待つときの、引き橋からの遠さ（マス）。この内の陸で待つ。
// 待てる所へ道がなければ、遠さを広げて探す（堀を渡ってきた兵が、堀の岸で待てるように）
const BRIDGE_WAIT = [2.5, 5, 8, 12];
// 鉤縄で引き橋が下りる見込みがあるか（鉤縄を持った兵が生きているか、作戦でこれから出すか）
const hookComing = (s: Battle) => s.hookPlanned > 0 || s.attackers.some((a) => a.hp > 0 && a.item === 'hook');

// 攻撃できる所（相手まで射程以内のマス）と、今いる所から攻撃できるか
const attackGoal = (s: Battle, u: Attacker) => (e: Entity) =>
  goalNear(e, rangeFromTile(s, ADEF[u.kind].range, e), ADEF[u.kind].range > 1.5);
// 川や堀の中にいるあいだは、攻撃（スキルも）を始めない。渡り切ってから戦う（攻めも守りも同じ）
export const inWater = (s: Battle, u: Unit) => s.wet[tileOf(u.x, u.y)] === 1;
const inAttackRange = (s: Battle, u: Attacker, e: Entity) =>
  !inWater(s, u) && distEnt(u.x, u.y, e) <= rangeAt(s, ADEF[u.kind].range, u.x, u.y, e);

// 兵が寄り道で相手にするものの組（好みの順。前の組に寄り道できる相手がいれば、後の組は見ない）
function detourGroups(s: Battle, u: Attacker): Entity[][] {
  const groups = ADEF[u.kind].detour.map((t) => atkGroup(s, t));
  if (!u.route.length) return groups;
  // 道筋を持つ兵は、道筋の外の門には寄らない（壊して、道筋にない郭へ入ってしまわないように）
  const rest = new Set(u.route.slice(u.routeAt));
  return groups.map((g) => g.filter((e) => !(e.isB && e.type === 'gate') || rest.has(tileIdx(e.x0, e.y0))));
}
// 寄り道で狙う相手の種類ごとの一覧（detour の1つ分）
function atkGroup(s: Battle, t: DetourTarget): Entity[] {
  switch (t) {
    case 'facility':
      return s.buildings.filter(isFacility);
    case 'gate':
      return s.buildings.filter((b) => b.type === 'gate');
    case 'general':
      return s.defenders;
  }
}
// 相手が、寄り道の優先の順（detour）の何番目の種類か。並べていない種類（本丸・城壁など）は、並べた種類より後
function atkRank(d: AttackerDef, e: Entity): number {
  return typeRank(d, !e.isB ? 'general' : e.type === 'gate' ? 'gate' : isFacility(e) ? 'facility' : null);
}
function typeRank(d: AttackerDef, t: DetourTarget | null): number {
  const i = t ? d.detour.indexOf(t) : -1;
  return i < 0 ? d.detour.length : i;
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
  u.atkLag = 0;
  u.atkX = x;
  u.atkY = y;
}

// 相手に当てる：傷を入れ、足止めなどを添える
function impact(s: Battle, tg: Entity, dmg: number, fx: HitExtra, from: { x: number; y: number }) {
  const src: DmgSrc | undefined = fx.src
    ? { k: fx.src, skill: fx.skill }
    : 'kind' in from
      ? srcOfUnit(s, from as Unit)
      : undefined;
  hurt(s, tg, dmg, false, from, src);
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
  // 動く先を読む：届くまでの時間を求め、そのあいだに相手が進む分だけ先を狙う（求めた先でもう一度求め直す）。
  // 倒れた相手（国士無双の残りの弾）は動かないので読まず、いた所へ撃つ
  if (!tg.isB && tg.hp > 0)
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
// 線分 (ax, ay)-(bx, by) の上で、点 (px, py) にいちばん近い所
function segNearest(px: number, py: number, ax: number, ay: number, bx: number, by: number): [number, number] {
  const vx = bx - ax;
  const vy = by - ay;
  const l2 = vx * vx + vy * vy;
  const t = l2 ? clamp(((px - ax) * vx + (py - ay) * vy) / l2, 0, 1) : 0;
  return [ax + vx * t, ay + vy * t];
}
// 矢を放った所（sh.sx, sh.sy）より後ろか（矢の向きと逆の側。放った瞬間に、撃ち手の背中の相手に当てないため）
function behindShot(sh: Shot, x: number, y: number) {
  return (x - sh.sx) * (sh.tx - sh.sx) + (y - sh.sy) * (sh.ty - sh.sy) < 0;
}
// 貫通の矢が (ax, ay) から (bx, by) まで進むあいだに、通り道の近く（矢の当たる幅）にいる敵に、1度ずつ当てる。
// 攻めの矢は、壊せる建物にも倍率を掛けて当てる（壊れない城壁は傷が入らないので数えない）
function pierceHits(s: Battle, sh: Shot, ax: number, ay: number, bx: number, by: number) {
  const p = sh.pierce;
  if (!p) return;
  for (const o of sh.side === 'a' ? s.defenders : s.attackers) {
    if (o.hp <= 0 || p.hit.includes(o.id) || behindShot(sh, o.x, o.y)) continue;
    const [nx, ny] = segNearest(o.x, o.y, ax, ay, bx, by);
    if (Math.hypot(o.x - nx, o.y - ny) > SHOT_HIT_RADIUS) continue;
    p.hit.push(o.id);
    hurt(s, o, sh.dmg, false, undefined, shotSrc(sh));
    s.effects.push({ k: 'hit', x: o.x, y: o.y, t: 0, ttl: 0.22 });
  }
  if (sh.side !== 'a' || !p.mul) return;
  const m = p.mul;
  for (const b of s.buildings) {
    if (b.hp <= 0 || BDEF[b.type].unbreakable || p.hit.includes(b.id)) continue;
    // 建物は、線分の上で建物にいちばん近い所から、建物のふちまでの距離で見る
    const [cx, cy] = centerOf(b);
    if (behindShot(sh, cx, cy)) continue;
    const [nx, ny] = segNearest(cx, cy, ax, ay, bx, by);
    if (distEnt(nx, ny, b) > SHOT_HIT_RADIUS) continue;
    p.hit.push(b.id);
    hurt(
      s,
      b,
      sh.dmg * mulFor(m, b),
      false,
      {
        x: sh.sx,
        y: sh.sy,
      },
      shotSrc(sh),
    );
    s.effects.push({ k: 'hit', x: cx, y: cy, t: 0, ttl: 0.22 });
  }
}
// 矢を、飛んできた向きのまま地面に刺して残す（盤面の外や、建物のあるマスに落ちたものは残さない）
function stick(s: Battle, sh: Shot) {
  if (sh.x < 0 || sh.y < 0 || sh.x >= W || sh.y >= H || s.grid[tileOf(sh.x, sh.y)]) return;
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
// 飛んでいる飛び道具を進め、届いたものを当てる。貫通の矢は、飛びながら通り道の敵に当てる
function moveShots(s: Battle) {
  const flying: Shot[] = [];
  for (const sh of s.shots) {
    const tg = s.byId[sh.tg];
    const alive = !!tg && tg.hp > 0;
    const dx = sh.tx - sh.x;
    const dy = sh.ty - sh.y;
    const d = Math.hypot(dx, dy);
    const stepLen = SHOT_SPEED[sh.k] * DT;
    const [ax, ay] = [sh.x, sh.y];
    if (d > stepLen) {
      sh.x += (dx / d) * stepLen;
      sh.y += (dy / d) * stepLen;
      pierceHits(s, sh, ax, ay, sh.x, sh.y);
      flying.push(sh);
      continue;
    }
    sh.x = sh.tx;
    sh.y = sh.ty;
    if (sh.pierce) {
      pierceHits(s, sh, ax, ay, sh.x, sh.y);
      // 射程の端まで飛んだ矢は、地面に刺さって残る
      stick(s, sh);
    } else if (sh.splash) {
      const r = sh.splash;
      s.effects.push({ k: 'fire', x: sh.x, y: sh.y, r, t: 0, ttl: 0.4 });
      for (const o of (sh.side === 'a' ? s.defenders : s.attackers).slice())
        if (o.hp > 0 && Math.hypot(o.x - sh.x, o.y - sh.y) <= r) hurt(s, o, sh.dmg, false, undefined, shotSrc(sh));
    } else if (alive && distEnt(sh.x, sh.y, tg) <= SHOT_HIT_RADIUS) impact(s, tg, sh.dmg, sh, { x: sh.sx, y: sh.sy });
    // 外れた矢は、飛んできた向きのまま地面に刺さって残る
    else if (sh.k === 'arrow') stick(s, sh);
  }
  s.shots = flying;
}

function strike(s: Battle, u: Attacker, tg: Entity) {
  if (u.cd > 0) return;
  const d = ADEF[u.kind];
  endTurn(s, u, d);
  const dmg = (tg.isB ? d.dmg * bldMul(u, tg) : d.dmg * (d.vsGen ?? 1)) * dealtOf(s, u);
  const [cx, cy] = centerOf(tg);
  markAttack(s, u, cx, cy);
  const ds = srcOfUnit(s, u);
  const fx = { slow: d.slow, src: ds.k, skill: ds.skill };
  if (d.shot) shoot(s, d.shot, 'a', u.x, u.y, tg, dmg, fx);
  else {
    s.effects.push({ k: 'hit', x: cx, y: cy, t: 0, ttl: 0.22 });
    impact(s, tg, dmg, fx, u);
  }
  // 工兵が施設を崩すのは気づかれない（本丸への攻撃は知らせる）
  if (!(u.kind === 'eng' && tg.isB && tg.type !== 'hall')) s.alarms.push({ x: cx, y: cy, by: u.id, t: s.t });
}

// ---- まっすぐ進めるか（一騎当千の確かめ） --------------------------------------
// 一騎当千を出す前に、相手までまっすぐ進めるかを見る（前は武田信玄の騎馬の突撃の帯にも使っていた）
const STRAIGHT_STEP = 0.25; // 進める刻み（マス）

// from から to のマスへ入れるか。門は攻めには通れず、守りには通れる
function straightPasses(s: Battle, u: Unit, from: number, to: number) {
  const id = s.grid[to];
  if (id && !(u.side === 'd' && (s.byId[id] as BuildingEnt).type === 'gate')) return false;
  return enterCost(s, u.side, from, to) !== Infinity;
}
// (x, y) から (tx, ty) までまっすぐ進める。入れないマスの手前で止まる。
// to は入れなかったマス（止まらなければ -1、斜めの角に当たったときは -2）、from はその手前のマス（止まらなければ着いたマス）
function straightWalk(s: Battle, u: Unit, x: number, y: number, tx: number, ty: number) {
  const len = Math.hypot(tx - x, ty - y);
  const ux = (tx - x) / (len || 1);
  const uy = (ty - y) / (len || 1);
  let cx = Math.floor(x);
  let cy = Math.floor(y);
  // 刻みごとに進め、最後は相手の所そのもの（len）を見る（刻みの端数の区間にある、相手のマスへ入る境目を見落とさないため）
  const n = Math.ceil(len / STRAIGHT_STEP - 1e-9);
  for (let i = 1; i <= n; i++) {
    const l = Math.min(i * STRAIGHT_STEP, len);
    const nx = x + ux * l;
    const ny = y + uy * l;
    const fx = Math.floor(nx);
    const fy = Math.floor(ny);
    const from = tileIdx(cx, cy);
    if (!inB(fx, fy)) return { from, to: -2 };
    if (fx !== cx || fy !== cy) {
      const to = tileIdx(fx, fy);
      if (!straightPasses(s, u, from, to)) return { from, to };
      // 斜めに抜けるときは、角を挟む2マスも通れること（斜めに並んだ城壁の間を抜けないように）
      if (
        fx !== cx &&
        fy !== cy &&
        !(straightPasses(s, u, from, tileIdx(fx, cy)) && straightPasses(s, u, from, tileIdx(cx, fy)))
      )
        return { from, to: -2 };
      cx = fx;
      cy = fy;
    }
  }
  return { from: tileIdx(cx, cy), to: -1 };
}
// (px, py) から、相手の所までまっすぐ進めるか（城壁・崖などで止まらないか）
function straightTouches(s: Battle, u: Unit, px: number, py: number, e: Entity) {
  const [tx, ty] = centerOf(e);
  const w = straightWalk(s, u, px, py, tx, ty);
  if (w.to === -1) return true;
  // 建物と、建物（門など）のマスに立つ相手には入れないので、崖を挟まずに面していれば当たる
  const at = e.isB ? s.grid[w.to] === e.id : w.to === tileOf(tx, ty);
  return w.to >= 0 && at && !isCliff(s.height[w.from], s.height[w.to]);
}
// ---- スキル ---------------------------------------------------------------
// 攻撃の番のうち、スキルが出せるものをスキルに替える。番の中身は前の番を終えた時に決めるので、
// 構えの途中で攻撃からスキルに切り替わらない（画面は、次の番の中身で構えのコマを選ぶ）
type SkillDef = Pick<
  GeneralStats,
  | 'cd'
  | 'skillCd'
  | 'skillWindup'
  | 'skillRange'
  | 'skillShot'
  | 'skillDmg'
  | 'skillPierce'
  | 'skillVolley'
  | 'skillVolleyGap'
  | 'ward'
  | 'wardTime'
  | 'spin'
  | 'spinRadius'
  | 'disarm'
  | 'disarmTime'
  | 'disarmRadius'
  | 'skillFire'
  | 'skillRadius'
  | 'summon'
  | 'summonMax'
  | 'burn'
  | 'burnTime'
>;
// 番を終える：次の番までの待ち（溜め cast と、そのあとの wait）を置き、次の番をスキルにするかを決める。
// 次の番が来るまでにスキルが出せるようになっていれば、次の番はスキル。rate は wait が減る速さの倍率
// （守りは鼓楼で速まり、足止めで遅れる）、castRate は溜めの分が減る速さの倍率（溜めと同じく、足止めでだけ遅れる）。
// 次の番が来る時刻は、今の速さのまま減ると見込む
function endTurn(s: Battle, u: Unit, d: SkillDef, wait = d.cd, rate = 1, cast = 0, castRate = 1) {
  u.cd = cast + wait;
  u.readyT = -1;
  u.nextSkill = !!d.skillCd && u.skillAt <= s.t + cast / castRate + wait / rate && !skillBlocked(s, u, d);
}
// 兵を呼ぶスキルで、生きている呼んだ兵が上限に達しているか（攻めは攻め手の、守りは守り手の、自分が呼んだ兵を数える）
function skillBlocked(s: Battle, u: Unit, d: SkillDef) {
  if (!d.summon) return false;
  const mine = (e: Unit) => e.summoner === u.id && e.hp > 0;
  return (u.side === 'a' ? s.attackers.filter(mine) : s.defenders.filter(mine)).length >= (d.summonMax ?? 0);
}
// 攻撃の待ちを減らす。待ちが0になったら、次の番が来られるようになった時刻を記録する
function drainTurn(s: Battle, u: Unit, by: number) {
  const was = u.cd;
  u.cd -= by;
  if (was > 0 && u.cd <= 0) u.readyT = s.t;
}
// 戦いが止んだか（構えを解いたか）：次の番が来られるようになってから、ATTACK_ENGAGED を過ぎても番を始めていないか。
// 待ちが延びた訳（スキルの長さ・足止め・鼓楼）に関わらず、番が来られるようになってからの経過で見る
// （待ちを外から書き換える所（見本の的など）で readyT が古いまま残っても、待っているあいだは見ない）
const disengaged = (t: number, u: Unit) => u.atkT >= 0 && u.cd <= 0 && u.readyT >= 0 && t - u.readyT > ATTACK_ENGAGED;
// 次の番でスキルを出せるか（startSkill と同じ決め方。番の中身は変えずに見るだけ）
function skillReady(s: Battle, u: Unit, d: SkillDef) {
  if (!d.skillCd) return false;
  if (skillBlocked(s, u, d)) return false;
  if (disengaged(s.t, u)) return u.skillAt <= s.t;
  return u.nextSkill;
}
// スキルの番なら、スキルを出す（溜めを始める）。攻撃の間隔は、溜めが終わって効いた時から数え直す。
// rate は攻撃の待ちが減る速さ、castRate は溜めが減る速さ（守りは足止めの倍率。鼓楼では速まらない）。
// 出したら true を返す
function startSkill(s: Battle, u: Unit, d: SkillDef, tg: Entity, rate = 1, castRate = 1) {
  if (u.cd > 0) return false;
  // 戦いが止んだあと（構えを解いたあと）は、構えの絵が出ていないので、番の中身を今の時刻で決め直す。
  // しばらく戦わなかった武将が、出せるスキルを攻撃の番に使ってしまわないように
  u.nextSkill = skillReady(s, u, d);
  if (!u.nextSkill) return false;
  // 一騎当千は、相手までまっすぐ歩いて行ける時だけ出す（inSkillRange と同じ。刀の届く所から出すときも見る）。
  // 出せなければ、この番は通常攻撃になる（崖の縁や斜めの城壁の角を挟んだ、狭い形だけ）
  if (d.spin && !straightTouches(s, u, u.x, u.y, tg)) return false;
  const [x, y] = centerOf(tg);
  const t = d.skillWindup ?? 0;
  // 煙炎漲天は、狙った相手のいた所に落とす（溜めのあいだに相手が動いても、落ちる所は変わらない）。ほかのスキルは足元から効く
  u.cast = d.skillFire ? { t, x, y, skill: true, tg: tg.id } : { t, x: u.x, y: u.y, skill: true, tg: tg.id };
  s.effects.push({ k: 'skill', x: u.x, y: u.y, side: u.side, t: 0, ttl: SKILL_FX_TTL });
  u.skillAt = s.t + (d.skillCd ?? 0);
  // 続けて撃つスキルは、最後の1発を撃った時から攻撃の間隔を数える
  endTurn(s, u, d, d.cd, rate, skillSpan(d), castRate);
  markAttack(s, u, x, y, true);
  return true;
}
// 射程で出すスキル（飛び道具のスキルと煙炎漲天）か。出す距離はスキルの射程で、高い所からは伸びる
export const rangedSkill = (d: Pick<SkillDef, 'skillShot' | 'skillFire'>) => !!d.skillShot || !!d.skillFire;
// スキルを出す距離：飛び道具のスキル（光義の弓・信長の国士無双）と煙炎漲天（昌幸）はスキルの射程、一騎当千（謙信）は
// 斬る範囲、金城鉄壁（家康）と諸行無常（秀吉）は効く範囲、千軍万馬（信玄）はスキルの射程。スキルを持たない武将は 0
export function skillReach(d: SkillDef) {
  if (!d.skillCd) return 0;
  if (rangedSkill(d)) return d.skillRange ?? 0;
  if (d.spin) return d.spinRadius ?? 0;
  if (d.ward) return WARD_RADIUS;
  if (d.disarm) return d.disarmRadius ?? 0;
  if (d.summon) return d.skillRange ?? 0;
  return 0;
}
// 相手を、スキルを出す距離に捉えているか。飛び道具のスキルは、高い所からは射程が伸びる。
// 一騎当千・金城鉄壁・諸行無常は、効く範囲が高さで変わらないので伸びない。千軍万馬も伸びない。
// 川や堀の中にいるあいだは出さない（攻撃と同じく、渡り切ってから出す）。
// 一騎当千は、相手までまっすぐ歩いて行ける時だけ出す（straightTouches。城壁・崖の向こうの相手には
// 出さない。川と堀は歩いて渡れるので、向こうの相手にも出す）。斬った時は塀を越えて当たるので、塀越しに出すと、塀の外から塀の内の櫓を斬れてしまうため。
// 金城鉄壁・諸行無常・千軍万馬は傷を与えないので確かめない（守りでは、塀の外で門を叩く攻め手を見て、掛けられる）
function inSkillRange(s: Battle, u: Unit, d: SkillDef, tg: Entity) {
  if (inWater(s, u)) return false;
  // 金城鉄壁と諸行無常は、スキルが溜まったら、敵の有無や距離に関わらず出す（効果は本人の周りに付くので、敵に会う
  // 前に出しても、範囲が本人と一緒に進んで無駄にならない）
  if (d.ward || d.disarm) return true;
  const r = skillReach(d);
  if (!r || distEnt(u.x, u.y, tg) > (rangedSkill(d) ? rangeAt(s, r, u.x, u.y, tg) : r)) return false;
  return !d.spin || straightTouches(s, u, u.x, u.y, tg);
}
// スキルが効く：徳川家康の金城鉄壁（周りの味方の受ける傷を減らす）、上杉謙信の一騎当千（周りをまとめて斬る）、
// 大島光義の弓（狙った相手へ強い矢を放つ）、織田信長の国士無双（狙った相手へ続けて撃つ）、豊臣秀吉の諸行無常（周りの敵の
// 与える傷を減らす）、真田昌幸の煙炎漲天（離れた所の円の内を燃やす）、武田信玄の千軍万馬（足元に騎兵を出す）
function fireSkill(s: Battle, u: Unit, d: SkillDef, c: Cast) {
  // 計測用の記録：スキルを出した回数（続けて撃つスキルは、撃ち始めだけ数える）
  if ((c.fired ?? 0) === 0) {
    const k = `${u.side}:${u.kind}`;
    s.stats.castsBy[k] = (s.stats.castsBy[k] ?? 0) + 1;
  }
  if (d.ward) raiseWard(s, u, d);
  if (d.disarm) disarmFoes(s, u, d);
  if (d.skillFire) blaze(s, u, c.x, c.y, d.skillRadius ?? 0, d.skillDmg ?? 0, d.burn ?? 0, d.burnTime ?? 0);
  if (d.summon) summonTroop(s, u, d);
  if (d.spin) spinSlash(s, u, d);
  if (d.skillShot) skillShot(s, u, d, c);
}
// 飛び道具のスキル：溜めが終わった時に、狙った相手へ撃つ。傷は届いた時に入り、相手が動けば外れることもある。
// 溜めのあいだに相手が倒れていたら撃たない。攻めは、建物に攻めの倍率を掛ける。
// 続けて撃つスキル（国士無双）は、撃つ間をおいて残りを撃つ。そのあいだは溜めを続けて動かず、
// 途中で相手が倒れても狙いを移さず、倒れた相手のいた所へ撃つ
function skillShot(s: Battle, u: Unit, d: SkillDef, c: Cast) {
  const tg = c.tg ? s.byId[c.tg] : undefined;
  const fired = c.fired ?? 0;
  if (!tg || !d.skillShot) return;
  if (tg.hp <= 0 && !fired) {
    // 溜めのあいだに相手が倒れて1発も撃たなかった：使わなかった撃つ間の分だけ、次の番を早める
    drainTurn(s, u, ((d.skillVolley ?? 1) - 1) * (d.skillVolleyGap ?? 0));
    return;
  }
  // 撃つ間は、前の溜めがティックの途中で終わったはみ出しを持ち越して数える（捨てると、撃ち終える時刻が1発ごとに遅れ、
  // 最後の1発から次の番までが攻撃の間隔より短くなるため）
  if (fired + 1 < (d.skillVolley ?? 1))
    u.cast = { ...c, t: (d.skillVolleyGap ?? 0) + Math.min(0, c.t), fired: fired + 1 };
  if (d.skillPierce) {
    // 貫通：狙った相手の動く先を読んだ向きのまま、スキルの射程の端（相手がそれより遠ければ相手の先）まで飛ばす
    const sh = shoot(s, d.skillShot, u.side, u.x, u.y, tg, (d.skillDmg ?? 0) * dealtOf(s, u), {
      src: `${u.side}:${u.kind}`,
      skill: true,
    });
    const dx = sh.tx - u.x;
    const dy = sh.ty - u.y;
    const l = Math.hypot(dx, dy) || 1;
    const len = Math.max(l, rangeAt(s, d.skillRange ?? 0, u.x, u.y, tg));
    sh.tx = u.x + (dx / l) * len;
    sh.ty = u.y + (dy / l) * len;
    const a = u.side === 'a' ? ADEF[u.kind] : null;
    sh.pierce = { hit: [], mul: a ? mulsOf(a) : undefined };
  } else {
    const dmg = (d.skillDmg ?? 0) * (u.side === 'a' && tg.isB ? bldMul(u, tg) : 1) * dealtOf(s, u);
    shoot(s, d.skillShot, u.side, u.x, u.y, tg, dmg, { src: `${u.side}:${u.kind}`, skill: true });
  }
  if (u.side === 'a') {
    const [x, y] = centerOf(tg);
    s.alarms.push({ x, y, by: u.id, t: s.t });
  }
}
export const SPIN_TTL = 0.4; // 一騎当千の演出が続く時間（秒）
// 一騎当千：足元から範囲（spinRadius）の内の敵（武将・兵）に傷を与える。攻めは、壊せる建物にも攻めの倍率を掛けて与える
// （壊れない城壁は傷が入らないので数えない）。煙炎漲天と同じく、塀や崖を挟んでも範囲の内なら当たる
function spinSlash(s: Battle, u: Unit, d: SkillDef) {
  const r = d.spinRadius ?? 0;
  const dmg = (d.spin ?? 0) * dealtOf(s, u);
  s.effects.push({ k: 'spin', x: u.x, y: u.y, r, side: u.side, t: 0, ttl: SPIN_TTL });
  const src: DmgSrc = { k: `${u.side}:${u.kind}`, skill: true };
  for (const e of u.side === 'a' ? s.defenders : s.attackers)
    if (e.hp > 0 && Math.hypot(e.x - u.x, e.y - u.y) <= r) hurt(s, e, dmg, false, undefined, src);
  if (u.side !== 'a') return;
  s.alarms.push({ x: u.x, y: u.y, by: u.id, t: s.t });
  for (const b of s.buildings)
    if (b.hp > 0 && !BDEF[b.type].unbreakable && distEnt(u.x, u.y, b) <= r)
      hurt(s, b, dmg * bldMul(u, b), false, u, src);
}

// 煙炎漲天の火：(x, y) を中心に半径 r の円の内にまとめて aoe の傷を与え、当たった相手を燃やす（1回 per を time 秒）。
// 攻めは守将と建物（建物には攻めの倍率）に当て、守りに知らせる。守りは攻め手に当てる。傷は、諸行無常が掛かっていれば減る
function blaze(s: Battle, u: Unit, x: number, y: number, r: number, aoe0: number, per0: number, time: number) {
  const aoe = aoe0 * dealtOf(s, u);
  const per = per0 * dealtOf(s, u);
  s.effects.push({ k: 'fire', x, y, r, t: 0, ttl: 0.55 });
  const src: DmgSrc = { k: `${u.side}:${u.kind}`, skill: true };
  if (u.side === 'd') {
    for (const a of s.attackers)
      if (a.hp > 0 && Math.hypot(a.x - x, a.y - y) <= r)
        ignite(s, hurt(s, a, aoe, true, undefined, src), per, time, src.k);
    return;
  }
  s.alarms.push({ x, y, by: u.id, t: s.t });
  for (const g of s.defenders)
    if (g.hp > 0 && Math.hypot(g.x - x, g.y - y) <= r)
      ignite(s, hurt(s, g, aoe, true, undefined, src), per, time, src.k);
  for (const b of s.buildings)
    if (b.hp > 0 && distEnt(x, y, b) <= r)
      ignite(s, hurt(s, b, aoe * bldMul(u, b), true, u, src), per * bldMul(u, b), time, src.k);
}
// 守りの武将か（守りの兵は含めない）・攻めの武将か
const isDefGeneral = (e: Entity): e is Defender => !e.isB && e.side === 'd' && isGeneralKind(e.kind);
const isAtkGeneral = (e: Entity): e is Attacker => !e.isB && e.side === 'a' && !!ADEF[e.kind].general;
// 一騎打ちを、道が見つからずにやめたあと、同じ武将をまた狙えるようになるまでの秒数
const DUEL_LOST_TIME = 3;
function attack(s: Battle, u: Attacker, tg: Entity) {
  u.fight = tg.id;
  // 武将が守りの武将と戦い始めたら、一騎打ちになる
  if (ADEF[u.kind].general && isDefGeneral(tg)) u.duel = tg.id;
  if (startSkill(s, u, ADEF[u.kind], tg)) return;
  strike(s, u, tg);
}

// 鉤縄を持った兵：ほかの相手には寄らず、いちばん近い（道のりで）上がった引き橋の、鉤縄を掛ける所へ向かい、
// 着いたら ITEMS.hook.time 秒かけて掛け、引き橋を下ろす（門は割らない）。使ったら鉤縄はなくなり、ふつうの兵に戻る。
// 掛けられる引き橋がない（どれも下りた・掛ける所へ道がない）ときは、ふつうの兵と同じく動く（鉤縄は持ったまま）。
// 道をふさぐ門などは、ふつうの兵と同じく壊して進む。動いたら true
// 道をふさぐ建物（u.blocker）が残っていれば、届けば叩き、届かなければ寄る（叩いたか寄ったなら true）
function hitBlocker(s: Battle, u: Attacker, speed: number): boolean {
  const bl = u.blocker ? (s.byId[u.blocker] as BuildingEnt) : null;
  if (!bl || bl.hp <= 0) return false;
  if (inAttackRange(s, u, bl)) attack(s, u, bl);
  else moveDirect(s, u, clamp(u.x, bl.x0, bl.x0 + bl.w), clamp(u.y, bl.y0, bl.y0 + bl.h), speed);
  return true;
}
function hookAct(s: Battle, u: Attacker): boolean {
  const spots = new Map<number, Drawbridge>();
  for (const d of s.drawbridges) {
    if (d.down) continue;
    const i = hookSpot(s, d);
    if (i >= 0) spots.set(i, d);
  }
  // 掛ける所に門が立っているあいだは、その門を壊しに行く（道の上の建物として壊す）
  const at = tileOf(u.x, u.y);
  const here = s.grid[at] ? undefined : spots.get(at);
  if (here) {
    u.target = 0;
    u.fight = 0;
    u.path = [];
    u.blocker = 0;
    u.hookGate = here.gate;
    u.hookT += DT;
    if (u.hookT >= ITEMS.hook.time - 1e-9) {
      u.item = undefined;
      u.hookT = 0;
      u.hookGate = 0;
      lowerBridge(s, here, '鉤縄で引き橋が下りた');
    }
    return true;
  }
  u.hookT = 0;
  u.hookGate = 0;
  if (!spots.size) return false;
  // 道が見つからなかったあとは、しばらくふつうの工兵として動き、間をおいて探し直す
  if (u.hookRetry > 0) {
    u.hookRetry -= DT;
    return false;
  }
  // 掛ける所への道でなければ（ふつうの工兵として動いていたあとなど）、道を探し直し、前に壊していた建物は手放す
  // （道の上の建物は、advance がまた壊す相手にする）
  const last = u.path.at(-1);
  if (u.target || last === undefined || !spots.has(last) || u.repath <= 0) {
    const found = computePath(s, u, (i) => spots.has(i));
    if (!found) {
      u.hookRetry = 0.6;
      return false;
    }
    if (u.target || last === undefined || !spots.has(last)) u.blocker = 0;
    u.target = 0;
    u.fight = 0;
    u.path = found;
    u.repath = 0.6;
  }
  const speed = ADEF[u.kind].speed * DT;
  if (hitBlocker(s, u, speed)) return true;
  advance(s, u, speed);
  return true;
}

function attackerAct(s: Battle, u: Attacker) {
  const d = ADEF[u.kind];
  drainTurn(s, u, DT);
  u.repath -= DT;
  // 本丸への道を進んでいるあいだは、寄り道を始める所を今いる所にしておく
  if (d.reach !== undefined && onRoute(u, u.target ? s.byId[u.target] : null)) {
    u.rx = u.x;
    u.ry = u.y;
  }
  if (u.cast) {
    u.cast.t -= DT;
    if (u.cast.t <= 0) {
      const c = u.cast;
      u.cast = null;
      fireSkill(s, u, ADEF[u.kind], c);
    }
    return;
  }
  if (u.item === 'hook' && hookAct(s, u)) return;
  // 一騎打ちのあいだは、相手の武将だけを狙う（相手が倒れたら終わる）
  if (u.duel) {
    const f = s.byId[u.duel];
    if (!f || f.hp <= 0) u.duel = 0;
    else if (u.target !== u.duel) {
      u.target = u.duel;
      u.path = [];
      u.blocker = 0;
    }
  }
  let tg: Entity | null = u.target ? s.byId[u.target] : null;
  // 戦いを始めた相手（狙いか、道をふさぐ建物）が倒れるまでは、ほかの相手へ狙いを変えない
  const foe = u.fight ? s.byId[u.fight] : null;
  const engaged = !!foe && foe.hp > 0 && (u.fight === u.target || u.fight === u.blocker);
  if (!tg || tg.hp <= 0) {
    const p = pickAttackerTarget(s, u);
    tg = p.tg;
    u.target = tg ? tg.id : 0;
    setPath(u, p.path);
    u.blocker = 0;
  } else if (
    !u.duel &&
    !engaged &&
    !d.noUnits &&
    tg.isB &&
    (s.tick + u.id) % 15 === 0 &&
    (!d.general || typeRank(d, 'general') < atkRank(d, tg))
  ) {
    // 建物へ向かっているとき（まだ戦い始めていないとき）は、すぐそばの守将へ移る（身を守るため。武将は、優先の順で武将のほうが前のときだけ）
    const near = nearest(s.defenders, u.x, u.y, (e) => distEnt(u.x, u.y, e) <= 2.5);
    if (near) {
      tg = near;
      u.target = near.id;
      u.path = [];
      u.blocker = 0;
    }
  }
  // 兵は、本丸への道を進むあいだ、寄り道できる相手がいないか（衝車は、狙う門が変わっていないか）を見ながら進む。
  // 寄り道で追っている守将が、寄り道を始めた所から離れすぎたら、追うのをやめる（スキルの番で、スキルを出す距離の内にいれば続ける）。
  // 戦い始めたあと（道をふさぐ門を壊しているときも）は、相手が倒れるか、こうして逃げられるまで、探し直さない
  if (
    !u.duel &&
    d.reach !== undefined &&
    tg &&
    (s.tick + u.id) % 15 === 0 &&
    ((!engaged && onRoute(u, tg) && !inAttackRange(s, u, tg)) ||
      (!tg.isB &&
        distEnt(u.rx, u.ry, tg) > d.reach * DETOUR_PATH_RATE &&
        !(skillReady(s, u, d) && inSkillRange(s, u, d, tg))))
  ) {
    const p = pickAttackerTarget(s, u);
    if (p.tg && p.tg !== tg) {
      tg = p.tg;
      u.target = tg.id;
      setPath(u, p.path);
      u.blocker = 0;
    }
  }
  // 武将は、近く（今いる所から寄り道の距離の内）に守りの武将が来たら、戦っている途中でも、優先してその武将を狙う
  if (d.general && !u.duel && !(tg && isDefGeneral(tg))) {
    const g = nearest(
      s.defenders,
      u.x,
      u.y,
      (e) => isDefGeneral(e) && distEnt(u.x, u.y, e) <= (d.reach ?? 0) && !(e.id === u.lost && s.t < u.lostT),
    );
    if (g) {
      tg = g;
      u.target = g.id;
      u.path = [];
      u.blocker = 0;
    }
  }
  if (!tg) return;
  // 道筋の次の門が上がった引き橋の門なら、引き橋が下りるまで手前の陸で待つ（待つあいだも、寄り道の相手とは戦う）。
  // 鉤縄で下りる見込みがなければ、道筋を捨てて、おまかせにする
  const raisedBy = isRouteGate(u, tg) ? s.drawbridges.find((q) => q.gate === tg.id && !q.down) : undefined;
  if (raisedBy) {
    // 鉤縄を掛けられない引き橋（掛ける所が陸でないなど）なら、待っても下りないので、道筋を捨てる
    if (!hookComing(s) || hookSpot(s, raisedBy) < 0) {
      u.route = [];
      u.routeAt = 0;
      u.target = 0;
      u.path = [];
      return;
    }
    const kx = (raisedBy.k % W) + 0.5;
    const ky = ((raisedBy.k / W) | 0) + 0.5;
    const near = (i: number, r: number) => Math.hypot((i % W) + 0.5 - kx, ((i / W) | 0) + 0.5 - ky) <= r;
    if (hitBlocker(s, u, d.speed * DT)) return;
    // 近い順に、もうその遠さの内（陸）にいれば待ち、そこへ道があれば向かう。0.6秒ごとに見直す（手前の門が壊れて近づけるようになったときのため）
    // 待っているあいだは道が空なので、道の有無ではなく、0.6秒の間引きだけで探し直す（毎ティック探すと重いため）
    if (u.repath <= 0) {
      const here = tileOf(u.x, u.y);
      u.path = [];
      u.repath = 0.6;
      for (const r of BRIDGE_WAIT) {
        if (!inWater(s, u) && near(here, r)) break;
        const found = computePath(s, u, (i) => near(i, r));
        if (found) {
          u.path = found;
          break;
        }
      }
    }
    advance(s, u, d.speed * DT);
    return;
  }
  // スキルを持つ武将は、スキルが出せる番に、相手をスキルを出す距離に捉えたら、その場で立ち止まってスキルを出す
  if (inSkillRange(s, u, d, tg) && startSkill(s, u, d, tg)) {
    u.fight = tg.id;
    if (d.general && isDefGeneral(tg)) u.duel = tg.id;
    return;
  }
  const reachable = (e: Entity) => inAttackRange(s, u, e);
  if (hitBlocker(s, u, d.speed * DT)) return;
  u.blocker = 0;
  if (reachable(tg)) {
    attack(s, u, tg);
    return;
  }
  if (!u.path.length || u.repath <= 0) {
    const found = computePath(s, u, attackGoal(s, u)(tg));
    u.path = found || [];
    u.repath = 0.6;
    // 一騎打ちの相手や、近くに来て乗り換えた守りの武将へ道が見つからなければ、一騎打ちをやめる
    // （しばらくその武将を狙い直さない。崖の上などの武将に張り付いて、本丸へ進まなくならないため）
    if (!found && (u.duel === tg.id || (d.general && isDefGeneral(tg)))) {
      u.duel = 0;
      u.lost = tg.id;
      u.lostT = s.t + DUEL_LOST_TIME;
      u.target = 0;
      return;
    }
    // 道筋の次の門へ道がなければ（配置と道筋が合わないなど）、道筋を捨てて、おまかせにする
    if (!found && isRouteGate(u, tg)) {
      u.route = [];
      u.routeAt = 0;
      u.target = 0;
      return;
    }
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

// 攻め手が、守りの優先の順（defOrder）の何番目の種類か。並べていない種類は、並べた種類より後（空なら、みな同じ順位）
function defRank(order: readonly DefTarget[], e: Attacker): number {
  const i = order.indexOf(ADEF[e.kind].general ? 'general' : 'troop');
  return i < 0 ? order.length : i;
}
function towerAct(s: Battle, b: BuildingEnt) {
  b.cd -= DT * buffOf(s, b.x0 + 0.5, b.y0 + 0.5);
  if (b.hp <= 0 || b.cd > 0) return;
  const d = BDEF[b.type];
  const minRange = d.minRange ?? 0;
  const dmg = (d.dmg ?? 0) * dealtOf(s, b);
  const cx = b.x0 + 0.5;
  const cy = b.y0 + 0.5;
  // 射程の内の攻め手を、優先の順（defOrder）の前の種類から撃つ（同じ種類なら近い者）
  const order = d.defOrder ?? [];
  let tg: Attacker | null = null;
  let br = Infinity;
  let bd = Infinity;
  for (const e of s.attackers) {
    if (e.hp <= 0) continue;
    const r = Math.hypot(e.x - cx, e.y - cy);
    if (r < minRange || r > rangeAt(s, d.range ?? 0, cx, cy, e)) continue;
    const k = defRank(order, e);
    const dd = distEnt(cx, cy, e);
    if (k < br || (k === br && dd < bd)) {
      tg = e;
      br = k;
      bd = dd;
    }
  }
  if (!tg) return;
  b.cd = d.cd ?? 0;
  const sh = shoot(s, d.shot ?? 'arrow', 'd', cx, cy, tg, dmg, { splash: d.splash, src: `d:${b.type}` });
  b.aimX = sh.tx - cx;
  b.aimY = sh.ty - cy;
}

function defenderAct(s: Battle, u: Defender) {
  const d = defOf(u);
  // 守りの兵の持ち場は、呼んだ武将の今いる所（武将が動けば一緒に動く）。武将が倒れたら、倒れた所に残る
  if (u.summoner) {
    const ld = s.byId[u.summoner];
    if (ld && !ld.isB && ld.hp > 0) {
      u.hx = ld.x;
      u.hy = ld.y;
    }
  }
  // 足止めされているあいだは、攻撃の間隔・移動・構えが遅くなる
  const sl = u.slow > 0 ? SLOW_RATE : 1;
  if (u.slow > 0) u.slow -= DT;
  // 攻撃の待ちが減る速さ（鼓楼で速まり、足止めで遅れる）。次の番がスキルかの見込みにも使う。
  // スキルの溜めのあいだは、待ちも溜めと同じ速さで減る（鼓楼で速まるのは、効いた時から数える攻撃の間隔だけ）
  const rate = buffOf(s, u.x, u.y) * sl;
  drainTurn(s, u, DT * (u.cast ? sl : rate));
  u.repath -= DT;
  if (u.cast) {
    u.cast.t -= DT * sl;
    u.atkLag += DT * (1 - sl); // 足止めで溜めが遅れた分（画面のため）
    if (u.cast.t <= 0) {
      const c = u.cast;
      u.cast = null;
      fireSkill(s, u, d, c);
    }
    return;
  }
  if (u.alert > 0) u.alert -= DT;
  // 狙える遠さ：今いる所から、索敵範囲（aggro）の内。追った先からも同じく見るので、相手が下がり続ければどこまでも追う
  // （攻め手は、守将をつり出せる）。範囲の内に相手がいなくなれば、持ち場へ戻る。
  // スキルを持つ武将は、スキルが出せるあいだだけ、スキルを出す距離まで狙う（出したあとは元に戻る）。
  // 攻撃の知らせや鐘を受けたあとしばらくは、ALERT_EXTRA だけ遠くまで狙う
  const sr = skillReach(d);
  const look = sr && skillReady(s, u, d) ? Math.max(d.aggro, sr) : d.aggro;
  const reach = look + (u.alert > 0 ? ALERT_EXTRA : 0);
  const okT = (e: Attacker | null): e is Attacker => !!e && e.hp > 0 && distEnt(u.x, u.y, e) <= reach;
  let tg = u.target ? (s.byId[u.target] as Attacker) : null;
  // 一騎打ちのあいだは、相手の武将だけを狙い、索敵範囲の外へ出ても追う（相手が倒れたら終わる）
  if (u.duel) {
    const f = s.byId[u.duel] as Attacker | undefined;
    if (!f || f.hp <= 0) u.duel = 0;
    else {
      tg = f;
      if (u.target !== f.id) {
        u.target = f.id;
        u.path = [];
        u.repath = 0;
      }
    }
  }
  // 狙う相手の優先の順（defOrder）：見つける範囲の内に前の種類の攻め手がいれば、後の種類より先に狙う（同じ種類なら近い者）。
  // 前の種類の相手がいるかは、攻め手全体を見るので、狙いがないとき（なくなったとき）のほかは、攻めの兵の寄り道の見直しと同じく間をおいて見る
  const order = d.defOrder;
  const rank = (e: Attacker) => defRank(order, e);
  if (!u.duel && order.length && !(okT(tg) && rank(tg) === 0) && (!okT(tg) || (s.tick + u.id) % 15 === 0)) {
    const cur = okT(tg) ? rank(tg) : Infinity; // 今の相手がいれば、それより前の種類だけを探す
    let best: Attacker | null = null;
    let br = Infinity;
    let bd = Infinity;
    for (const e of s.attackers) {
      if (!okT(e)) continue;
      const dd = distEnt(u.x, u.y, e);
      const r = rank(e);
      if (dd > look || r >= cur) continue;
      if (r < br || (r === br && dd < bd)) {
        best = e;
        br = r;
        bd = dd;
      }
    }
    if (best) {
      tg = best;
      u.target = best.id;
      u.path = [];
      u.repath = 0; // 相手が変わったらすぐに道を探す
    }
  }
  if (!u.duel && !okT(tg)) {
    tg = nearest(s.attackers, u.x, u.y, (e) => distEnt(u.x, u.y, e) <= look && okT(e));
    if (!tg) {
      // 近くに攻め手がいなくても、検知範囲の中で味方が攻撃されていたら、攻撃した相手に向かう
      let bd = Infinity;
      for (const a of s.alarms) {
        const dd = Math.hypot(a.x - u.x, a.y - u.y);
        if (dd > d.aggro || dd >= bd) continue;
        const by = s.byId[a.by] as Attacker | undefined;
        if (!by || by.hp <= 0 || distEnt(u.x, u.y, by) > look + ALERT_EXTRA) continue;
        bd = dd;
        tg = by;
      }
      // 鐘が鳴っていれば、見つける範囲の外でも、鐘楼が見つけた攻め手のうち近い者に向かう（狙える遠さは知らせと同じ）
      if (!tg) {
        let bb = Infinity; // 守将から、鐘楼が見つけた攻め手までの距離
        for (const id of s.bell) {
          const by = s.byId[id] as Attacker | undefined;
          if (!by || by.hp <= 0) continue;
          const dd = distEnt(u.x, u.y, by);
          if (dd > look + ALERT_EXTRA || dd >= bb) continue;
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
    // 守りの兵の持ち場は呼んだ武将の今いる所で、いつも動くので、そばにいれば戻らず、離れすぎたら武将のそばまで歩く
    // （持ち場のマスそのものを目指すと、武将と同じマスで道が見つからず、武将の上へ跳んで重なってしまうため）
    if (u.summoner) {
      if (Math.hypot(u.x - u.hx, u.y - u.hy) <= TROOP_FOLLOW) return;
      if (!u.path.length || u.repath <= 0) {
        const near = (i: number) => Math.hypot((i % W) + 0.5 - u.hx, ((i / W) | 0) + 0.5 - u.hy) <= TROOP_FOLLOW - 0.5;
        u.path = computePath(s, u, near) || [];
        u.repath = 0.6;
      }
      advance(s, u, d.speed * DT * sl);
      return;
    }
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
  // 守りの武将が攻めの武将と戦い始めたら、一騎打ちになる（守りの兵は含めない）
  const duelOn = (e: Attacker) => {
    if (isDefGeneral(u) && isAtkGeneral(e)) u.duel = e.id;
  };
  // スキルを持つ武将は、スキルが出せる番に、相手をスキルを出す距離に捉えたら、その場で立ち止まってスキルを出す
  if (inSkillRange(s, u, d, tg) && startSkill(s, u, d, tg, rate, sl)) {
    duelOn(tg);
    return;
  }
  const reachable = (e: Entity) => !inWater(s, u) && distEnt(u.x, u.y, e) <= rangeAt(s, d.range, u.x, u.y, e);
  if (reachable(tg)) {
    duelOn(tg);
    if (startSkill(s, u, d, tg, rate, sl)) return;
    if (u.cd <= 0) {
      endTurn(s, u, d, d.cd, rate);
      markAttack(s, u, tg.x, tg.y);
      // 守りの兵（騎兵）は、攻めの騎兵と同じく、武将に武将への倍率を掛ける（守りの武将は持たない）
      const dmg = d.dmg * (ADEF[tg.kind].general ? (d.vsGen ?? 1) : 1) * dealtOf(s, u);
      const ds = srcOfUnit(s, u);
      const fx = { src: ds.k, skill: ds.skill };
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
    const found = computePath(s, u, goalNear(tg, rangeFromTile(s, d.range, tg), d.range > 1.5));
    u.path = found || [];
    u.repath = 0.6;
    // 一騎打ちの相手へ道が見つからなければ、一騎打ちをやめる（索敵範囲の内でなければ、次のティックで狙いを選び直す）
    if (!found && u.duel === tg.id) u.duel = 0;
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
  // 本丸が落ちて決着したら、同じティックのうちでも、それより後の者は動かない（勝ったあとに攻め手を失わないように。傷は hurt でも止める）
  for (const b of s.buildings) if (!s.over && BDEF[b.type].tower) towerAct(s, b);
  for (const u of s.defenders) if (!s.over && u.hp > 0) defenderAct(s, u);
  for (const u of s.attackers) if (!s.over && u.hp > 0) attackerAct(s, u);
  // 決着したら（本丸が落ちたら）、燃える傷は入れない
  if (!s.over) burnTick(s);
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
    } else if (attackersSpent(s) && !UNIT_ORDER.some((k) => canDeploy(s, k))) {
      s.over = true;
      s.result = 'wipe';
      s.endT = s.t;
    }
  }
}
