// 1対1の戦いの確かめ（duel.html）。開発する人が、どの時刻にどれだけ傷が入り、いつ勝負がつくかを目で見る。
// 戦いの計算はふだんと同じ step を使う。左はいつも攻め手、右は守りの武将か施設。盤面は平地だけ
import {
  type Attacker,
  type Battle,
  centerOf,
  createBattle,
  deploy,
  type Entity,
  hallOf,
  isBurning,
  type Shot,
  step,
} from './battle';
import {
  type AttackerKind,
  BDEF,
  type BuildingType,
  DT,
  type GeneralKind,
  H,
  isFacilityType,
  isGeneralKind,
  TIME_LIMIT,
  W,
} from './defs';
import { emptyLayout, type Layout } from './layout';

export type DuelRight = { k: 'gen'; kind: GeneralKind } | { k: 'fac'; type: BuildingType };
export interface DuelSetup {
  left: AttackerKind;
  right: DuelRight;
  dist: number; // はじめの距離（マス）
}
export type DuelSide = 'left' | 'right';
export interface DuelHit {
  t: number;
  by: DuelSide; // 当てた側
  dmg: number;
  hp: number; // 当たった側の、当たったあとの体力
}
export interface DuelPoint {
  t: number;
  left: number;
  right: number;
  dist: number;
}
export interface DuelEnd {
  t: number; // 勝負がついた時刻（最後に倒れた時刻。時間切れなら制限の時刻）
  winner: DuelSide | null;
  reason: 'win' | 'both' | 'time'; // 勝ち・相打ち・時間切れ
}
export interface Duel {
  setup: DuelSetup;
  layout: Layout;
  battle: Battle;
  left: Attacker;
  right: Entity;
  points: DuelPoint[];
  hits: DuelHit[];
  end: DuelEnd | null;
  deadT: number; // 最後に倒れた時刻
  flying: Shot[] | null; // 倒れた時に飛んでいた弾。決着はこれが消えるまで待つ
}

const ROW = (H / 2) | 0; // 戦う行
const RIGHT_X = W - 8; // 右の相手のマス
const HALL_X = W - 5; // 本丸は戦いに関わらないよう、右の相手の後ろに置く（兵は本丸への道の途中で相手に寄り道するため）
const HALL_HP = 1e9; // 本丸が落ちて戦いが終わらないように
const AFTER = 1.5; // 決着のあと、倒れる動きを見せるために進める時間（秒）
export const DUEL_DIST_MIN = 1;
export const DUEL_DIST_MAX = RIGHT_X - 2;
export const DUEL_LIMIT = TIME_LIMIT;
// 右に置ける施設（櫓・大筒・鼓楼・鐘楼）
export const DUEL_FACILITIES = (Object.keys(BDEF) as BuildingType[]).filter(isFacilityType);

export function createDuel(setup: DuelSetup): Duel {
  const layout = emptyLayout();
  layout.buildings[0] = { type: 'hall', x: HALL_X, y: ROW };
  const r = setup.right;
  if (r.k === 'fac') layout.buildings.push({ type: r.type, x: RIGHT_X, y: ROW });
  else layout.generals.push({ kind: r.kind, x: RIGHT_X, y: ROW });
  const s = createBattle(layout);
  s.timeLimit = Number.POSITIVE_INFINITY;
  const hall = hallOf(s);
  hall.hp = hall.maxHp = HALL_HP;
  // 出撃エリアから出してから、決めた距離へ動かす
  const res = deploy(s, setup.left, 0, ROW);
  if (!res.ok) throw new Error(res.msg);
  const left = s.attackers[0];
  left.x = left.px = RIGHT_X + 0.5 - setup.dist;
  left.y = left.py = ROW + 0.5;
  left.path = [];
  const right = r.k === 'gen' ? s.defenders[0] : s.buildings.find((b) => b.type === r.type);
  if (!right) throw new Error('右の相手がいません');
  const d: Duel = { setup, layout, battle: s, left, right, points: [], hits: [], end: null, deadT: 0, flying: null };
  record(d);
  return d;
}

function distOf(d: Duel) {
  const [lx, ly] = centerOf(d.left);
  const [rx, ry] = centerOf(d.right);
  return Math.hypot(lx - rx, ly - ry);
}
function record(d: Duel) {
  d.points.push({ t: d.battle.t, left: d.left.hp, right: d.right.hp, dist: distOf(d) });
}

// 1ティック進める。1対1なので、体力の減った分は相手が与えた傷とみなす（信玄が呼んだ騎兵の与えた傷も、信玄の側に数える）。
// 倒れた時に飛んでいた弾は、残った側に当たることがあるので（相打ちになることもある）、消えるまで決着を待つ。
// 待つのはその時の弾だけ（残った側が本丸を撃ち続けると、新しい弾は途切れないため）。
// 残った側が火計で燃えていれば、同じく燃え終わるまで決着を待つ（燃えて倒れれば相打ち）
export function stepDuel(d: Duel) {
  const s = d.battle;
  if (d.end) {
    if (s.t < d.end.t + AFTER) step(s);
    return;
  }
  const l0 = d.left.hp;
  const r0 = d.right.hp;
  step(s);
  if (d.right.hp < r0) d.hits.push({ t: s.t, by: 'left', dmg: r0 - d.right.hp, hp: d.right.hp });
  if (d.left.hp < l0) d.hits.push({ t: s.t, by: 'right', dmg: l0 - d.left.hp, hp: d.left.hp });
  record(d);
  const ld = d.left.hp <= 0;
  const rd = d.right.hp <= 0;
  if ((ld && l0 > 0) || (rd && r0 > 0)) d.deadT = s.t;
  if (ld || rd) d.flying ??= [...s.shots];
  const landed = !!d.flying && !d.flying.some((x) => s.shots.includes(x)) && !isBurning(d.left) && !isBurning(d.right);
  if (landed) {
    const winner = ld && rd ? null : ld ? 'right' : 'left';
    d.end = { t: d.deadT, winner, reason: winner ? 'win' : 'both' };
  } else if (s.t >= DUEL_LIMIT - DT / 2) d.end = { t: s.t, winner: null, reason: 'time' };
  // 決着は信玄本人と相手で決めるので、決着したら、スキルで呼ばれた騎兵は去らせる（決着のあとに相手の体力を変えないため）
  if (d.end) {
    for (const a of s.attackers) if (a.summoner) delete s.byId[a.id];
    s.attackers = s.attackers.filter((a) => !a.summoner);
  }
}

// 決着まで進める（テストと、結果だけを先に見たいとき）
export function runDuel(d: Duel) {
  while (!d.end) stepDuel(d);
  return d;
}

// 側ごとのまとめ：最初に当てた時刻・当てた回数・傷の合計・1秒あたりの傷（最初に当ててから終わりまで。
// 1回しか当てていないと、割る時間が決まらないので null）
export function duelTotals(d: Duel, by: DuelSide) {
  const hits = d.hits.filter((h) => h.by === by);
  const total = hits.reduce((a, h) => a + h.dmg, 0);
  const first = hits[0]?.t ?? null;
  const end = d.end?.t ?? d.battle.t;
  const span = first === null ? 0 : end - first;
  return { first, count: hits.length, total, perSec: hits.length > 1 && span > 0 ? total / span : null };
}

// 攻守を入れ替えた組み合わせ。武将どうしだけ入れ替えられる
export function swapDuel(s: DuelSetup): DuelSetup | null {
  if (s.right.k !== 'gen' || !isGeneralKind(s.left)) return null;
  return { ...s, left: s.right.kind, right: { k: 'gen', kind: s.left } };
}
