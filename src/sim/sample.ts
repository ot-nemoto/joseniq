// 動作の見本：選んだ兵・武将・施設が、決まった相手と攻撃し合い続ける小さな戦い（兵種の画面の「動作」から開く窓で使う）。
// 戦いの計算はふだんと同じ step を使い、毎ティックだれの体力も満タンに戻すので、だれも倒れず、戦いは終わらない
import { type Attacker, type Battle, createBattle, deploy, step } from './battle';
import { ADEF, type AttackerKind, BDEF, type BuildingType, type GeneralKind, H, HALL, W } from './defs';
import { emptyLayout, type Layout, occAt } from './layout';

// 見本にするもの。atk は攻め手（兵と攻めの武将）、fac は撃つ施設と鼓楼・鐘楼、def は守りの武将
export type SampleOf =
  | { k: 'atk'; kind: AttackerKind }
  | { k: 'fac'; type: BuildingType }
  | { k: 'def'; kind: GeneralKind };

// 盤面のマス
interface Spot {
  x: number;
  y: number;
}

export interface Sample {
  of: SampleOf;
  layout: Layout;
  battle: Battle;
  // 動かさない的（施設と守りの武将の見本で、撃たれ役にする盾兵）と、その位置
  pin: Attacker | null;
  px: number;
  py: number;
  // 攻め手が攻める弓櫓のマス（攻め手の見本だけ。衝車は本丸を攻めるので null）
  tower: Spot | null;
  // カメラを向ける所（盤面の座標）
  focus: { x: number; y: number };
}

// 見本にできる施設：撃つ施設（櫓・大筒）と、まわりに効く施設（鼓楼・鐘楼）
export const isSampleFacility = (t: BuildingType) => !!BDEF[t].tower || !!BDEF[t].aura;

const ROW = HALL.y; // 見本は本丸と同じ行に並べる
// 施設の見本で、はじめに的を置く距離（射程の内側。大筒は撃てない近さより外）
// 鐘楼は見張りの範囲の内側で、駆けつける猛将の見つける範囲より外
const PIN_DIST: Partial<Record<BuildingType, number>> = { tbow: 5, tgun: 6, cata: 6, bell: 6 };
const GEN_PIN_DIST = 4; // 守りの武将の見本で、はじめに持ち場から的を置く距離
// 施設と守りの武将の見本で、撃つ側を置く列。的をまわりのどこへ動かしても本丸に重ならないよう、本丸から離す
const SHOOTER_X = HALL.x - 8;
const ATTACKER_X = HALL.x - 11.5; // 攻め手を出す位置（衝車のほか）
const TOWER = { x: HALL.x - 4, y: ROW }; // 攻め手の見本で、はじめに弓櫓を置くマス
const BELL_GENERAL = 'brave'; // 鐘楼の見本で、鐘を聞いて駆けつける守りの武将
const BELL_GENERAL_DX = 5; // その持ち場の、鐘楼から東への距離

// 攻め手を出す。出撃エリアから出してから、見本の位置へ動かす
function put(s: Battle, kind: AttackerKind, x: number, y: number): Attacker {
  const r = deploy(s, kind, 0, ROW);
  if (!r.ok) throw new Error(r.msg);
  const u = s.attackers[s.attackers.length - 1];
  u.x = u.lx = u.px = x;
  u.y = u.ly = u.py = y;
  return u;
}

// tower は、攻め手の見本で弓櫓を置くマス（省くと、はじめの場所）
export function createSample(of: SampleOf, tower: Spot = TOWER): Sample {
  const layout = emptyLayout();
  if (of.k === 'atk') {
    // 攻め手は、櫓に向かって攻める（歩兵は本丸へ向かう道の近くにある櫓だけを攻める）。櫓も撃ち返す。門を狙う衝車は、櫓の代わりに置いた門を破り、そのあと本丸に向かう。
    // 囮の斥候は、櫓に近づいては下がるので、カメラを下がる側へ寄せる
    const ram = of.kind === 'ram';
    layout.buildings.push({ type: ram ? 'gate' : 'tbow', x: tower.x, y: tower.y });
    const s = createBattle(layout);
    put(s, of.kind, ram ? HALL.x - 6.5 : ATTACKER_X, ROW + 0.5);
    const decoy = ADEF[of.kind].pref === 'decoy';
    const focus = { x: ram ? HALL.x - 3 : decoy ? HALL.x - 9 : HALL.x - 6.5, y: ROW + 0.5 };
    return finish({ of, layout, battle: s, pin: null, px: 0, py: 0, tower: ram ? null : tower, focus });
  }
  // 施設は、射程の内側に止めた盾兵を撃つ。守りの武将は、持ち場の近くに止めた盾兵に向かって攻める。
  // 鼓楼は、隣の弓櫓が速く撃つ。鐘楼は、見張りの範囲に止めた盾兵を見つけて鐘を鳴らし、離れた持ち場の猛将が駆けつける。
  // 的は、はじめは西に置く
  if (of.k === 'fac') layout.buildings.push({ type: of.type, x: SHOOTER_X, y: ROW });
  else layout.generals.push({ kind: of.kind, x: SHOOTER_X, y: ROW });
  if (of.k === 'fac' && of.type === 'drum') layout.buildings.push({ type: 'tbow', x: SHOOTER_X, y: ROW - 1 });
  if (of.k === 'fac' && of.type === 'bell')
    layout.generals.push({ kind: BELL_GENERAL, x: SHOOTER_X + BELL_GENERAL_DX, y: ROW });
  const s = createBattle(layout);
  const cx = SHOOTER_X + 0.5;
  const cy = ROW + 0.5;
  const px = cx - (of.k === 'fac' ? (PIN_DIST[of.type] ?? 5) : GEN_PIN_DIST);
  return finish({
    of,
    layout,
    battle: s,
    pin: put(s, 'shd', px, cy),
    px,
    py: cy,
    tower: null,
    focus: { x: cx, y: cy },
  });
}
function finish(sm: Sample) {
  sm.battle.timeLimit = Number.POSITIVE_INFINITY;
  return sm;
}

// 盤面のマス (x, y) を、見本の相手の新しい場所にする。
// 的がある見本は、的をそのマスの真ん中へ移す（戦いはそのまま続く）。
// 攻め手の見本は、そのマスに弓櫓を置き直した見本を作って返す。攻め手は最初の位置へ戻さず、今いる所から動かす。
// 置けないマス（盤面の外・建物や武将のいるマス・攻め手の体がかかるマス）と、相手を動かせない見本（衝車）では null を返す
export function retarget(sm: Sample, x: number, y: number): Sample | null {
  if (x < 0 || y < 0 || x >= W || y >= H || occAt(sm.layout, x, y)) return null;
  if (sm.pin) {
    sm.px = x + 0.5;
    sm.py = y + 0.5;
    hold(sm);
    return sm;
  }
  const u = sm.battle.attackers[0];
  // 攻め手の体（真ん中から半マス）がかかるマスには置かない
  if (!sm.tower || sm.of.k !== 'atk' || !u || (Math.abs(u.x - (x + 0.5)) < 1 && Math.abs(u.y - (y + 0.5)) < 1))
    return null;
  const next = createSample(sm.of, { x, y });
  const v = next.battle.attackers[0];
  v.x = v.lx = v.px = u.x;
  v.y = v.ly = v.py = u.y;
  return next;
}

// 的を (px, py) に止める（前の位置も合わせ、動いたとみなさない）
function hold(sm: Sample) {
  const pin = sm.pin;
  if (!pin) return;
  pin.x = pin.lx = pin.px = sm.px;
  pin.y = pin.ly = pin.py = sm.py;
  pin.vx = pin.vy = 0;
  pin.path = [];
}

// 見本を1ティック進める。的は止めたまま、だれの体力も満タンに戻す
export function stepSample(sm: Sample) {
  const s = sm.battle;
  step(s);
  hold(sm);
  for (const list of [s.attackers, s.defenders, s.buildings]) for (const e of list) if (e.hp > 0) e.hp = e.maxHp;
}
