// 動きの見本：選んだ兵・武将・施設が、決まった相手と攻撃し合い続ける小さな戦い（画面の「見本」で使う）。
// 戦いの計算はふだんと同じ step を使い、毎ティックだれの体力も満タンに戻すので、だれも倒れず、戦いは終わらない
import { type Attacker, type Battle, createBattle, deploy, step } from './battle';
import { ADEF, type AttackerKind, BDEF, type BuildingType, type GeneralKind, HALL } from './defs';
import { emptyLayout, type Layout } from './layout';

// 見本にするもの。atk は攻め手（兵と攻めの武将）、fac は撃つ施設、def は守りの武将
export type SampleOf =
  | { k: 'atk'; kind: AttackerKind }
  | { k: 'fac'; type: BuildingType }
  | { k: 'def'; kind: GeneralKind };

export interface Sample {
  of: SampleOf;
  layout: Layout;
  battle: Battle;
  // 動かさない的（施設と守りの武将の見本で、撃たれ役にする盾兵）と、その位置
  pin: Attacker | null;
  px: number;
  py: number;
  // カメラを向ける所（盤面の座標）
  focus: { x: number; y: number };
}

// 撃つ施設（見本にできる施設）
export const isSampleFacility = (t: BuildingType) => !!BDEF[t].tower;

const ROW = HALL.y; // 見本は本丸と同じ行に並べる
// 施設の見本で、的を置く距離（射程の内側。大筒は撃てない近さより外）
const PIN_DIST: Partial<Record<BuildingType, number>> = { tbow: 5, tgun: 6, cata: 6 };

// 攻め手を出す。出撃エリアから出してから、見本の位置へ動かす
function put(s: Battle, kind: AttackerKind, x: number, y: number): Attacker {
  const r = deploy(s, kind, 0, ROW);
  if (!r.ok) throw new Error(r.msg);
  const u = s.attackers[s.attackers.length - 1];
  u.x = u.lx = x;
  u.y = u.ly = y;
  return u;
}

export function createSample(of: SampleOf): Sample {
  const layout = emptyLayout();
  let pin: Attacker | null = null;
  let px = 0;
  let py = 0;
  let focus = { x: HALL.x - 4, y: ROW + 0.5 };
  if (of.k === 'atk') {
    // 攻め手は、櫓に向かって攻める。櫓も撃ち返す。本丸だけを狙う衝車は、本丸の近くから本丸に向かう。
    // 囮の斥候は、櫓に近づいては下がるので、カメラを下がる側へ寄せる
    const ram = of.kind === 'ram';
    if (!ram) layout.buildings.push({ type: 'tbow', x: HALL.x - 4, y: ROW });
    const s = createBattle(layout);
    put(s, of.kind, ram ? HALL.x - 6.5 : HALL.x - 11.5, ROW + 0.5);
    const decoy = ADEF[of.kind].pref === 'decoy';
    focus = { x: ram ? HALL.x - 3 : decoy ? HALL.x - 9 : HALL.x - 6.5, y: ROW + 0.5 };
    return finish({ of, layout, battle: s, pin, px, py, focus });
  }
  if (of.k === 'fac') {
    // 施設は、射程の内側に止めた盾兵を撃つ
    const bx = HALL.x - 5;
    layout.buildings.push({ type: of.type, x: bx, y: ROW });
    const s = createBattle(layout);
    px = bx + 0.5 - (PIN_DIST[of.type] ?? 5);
    py = ROW + 0.5;
    pin = put(s, 'shd', px, py);
    focus = { x: (bx + 0.5 + px) / 2, y: py };
    return finish({ of, layout, battle: s, pin, px, py, focus });
  }
  // 守りの武将は、持ち場の近くに止めた盾兵に向かって攻める
  layout.generals.push({ kind: of.kind, x: HALL.x - 5, y: ROW });
  const s = createBattle(layout);
  px = HALL.x - 8.5;
  py = ROW + 0.5;
  pin = put(s, 'shd', px, py);
  focus = { x: HALL.x - 6.5, y: py };
  return finish({ of, layout, battle: s, pin, px, py, focus });
}
function finish(sm: Sample) {
  sm.battle.timeLimit = Number.POSITIVE_INFINITY;
  return sm;
}

// 見本を1ティック進める。的は止めたまま、だれの体力も満タンに戻す
export function stepSample(sm: Sample) {
  const s = sm.battle;
  step(s);
  if (sm.pin) {
    sm.pin.x = sm.px;
    sm.pin.y = sm.py;
    sm.pin.path = [];
  }
  for (const list of [s.attackers, s.defenders, s.buildings]) for (const e of list) if (e.hp > 0) e.hp = e.maxHp;
}
