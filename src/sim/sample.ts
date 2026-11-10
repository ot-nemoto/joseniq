// 動作の見本：選んだ兵・武将・施設が、決まった相手と攻撃し合い続ける小さな戦い（兵種の画面の「動作」から開く窓で使う）。
// 戦いの計算はふだんと同じ step を使い、毎ティックだれの体力も満タンに戻すので、だれも倒れず、戦いは終わらない
import {
  type Attacker,
  type Battle,
  createBattle,
  deploy,
  dismissSummoned,
  rangedSkill,
  step,
  type Unit,
} from './battle';
import {
  ADEF,
  type AttackerKind,
  BDEF,
  type BuildingType,
  type GeneralKind,
  H,
  HALL,
  isFacilityType,
  isGeneralKind,
  W,
} from './defs';
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
  // 攻め手が攻める弓櫓のマス（攻め手の見本だけ。衝車は門を攻め、動かせないので null）
  tower: Spot | null;
  // カメラを向ける所（盤面の座標）
  focus: { x: number; y: number };
  // スキルだけの見本（武将が、毎回の番でスキルを出す）。subject は見本にした武将
  skill: boolean;
  subject: Unit | null;
  // スキルだけの見本で、スキルの射程を持つ武将（光義・信長・昌幸）を留めるか（keep）と、留める所（anchor）。撃ったあと槍の届く所まで
  // 近づくと、遠くから撃つ様子が見えないので、相手をスキルの射程に捉えたら、その場に留める。相手が射程の外にいるあいだは
  // 留めずに歩かせる（見本の中だけの扱い）
  keep: boolean;
  anchor: { x: number; y: number } | null;
  // 見本役：スキルの演出を見せるために置く、動かず攻撃もしない相手（または味方）。
  // pin なら、的からの (dx, dy) の所に留める（的を動かすと一緒に動く）。そうでなければ (dx, dy) のマスの真ん中に留める
  dummies: { u: Unit; dx: number; dy: number; pin: boolean }[];
  // スキルで呼ばれた兵（武田信玄の騎兵）が出た時刻。見本では SAMPLE_SUMMON_LIFE で去らせる
  born: Map<number, number>;
}
// 見本で、呼ばれた兵が去るまでの時間（秒）。体力を満タンに戻し続けるので倒れず、残すと呼べる上限に達して、
// スキルだけの見本でもスキルを出さなくなるため（見本の中だけの扱い）
const SAMPLE_SUMMON_LIFE = 3;

// スキルだけの見本にできるか：スキルを持つ武将だけ
export const hasSkillSample = (of: SampleOf) => of.k !== 'fac' && !!ADEF[of.kind].skillCd;

// 見本にできる施設：撃つ施設（櫓・大筒）と、まわりに効く施設（鼓楼・鐘楼）
export const isSampleFacility = isFacilityType;

const ROW = HALL.y; // 見本は本丸と同じ行に並べる
// 施設の見本で、はじめに的を置く距離（射程の内側。大筒は撃てない近さより外）
// 鐘楼は見張りの範囲の内側で、駆けつける上杉謙信の見つける範囲より外
const pinDist = (type: BuildingType) => (type === 'bell' ? 6 : (BDEF[type === 'drum' ? 'tbow' : type].range ?? 0) - 1); // 鼓楼は、隣の弓櫓の射程の内に置く
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
  u.x = u.px = x;
  u.y = u.py = y;
  return u;
}

// スキルだけの見本で置く見本役。武将ごとに、スキルの演出が見えるよう並べる。
// 攻めは弓櫓のマスから、守りは的からのずれ。side は見本役の側（a 攻め手、d 守将）、kind はその兵種
// （守将は武将なので、同じ側に同じ武将を置けない決まりに合わせ、見本にした武将と違う武将にする）
type DummySpec = { side: 'a' | 'd'; kind: AttackerKind; dx: number; dy: number };
function dummySpecs(of: SampleOf): DummySpec[] {
  if (of.k === 'fac') return [];
  const atk = of.k === 'atk';
  switch (of.kind) {
    // 大島光義：矢の通り道に一列に並べ、貫通する矢がまとめて当たるのを見せる。攻めは、光義と弓櫓のあいだに並べる
    // （矢はスキルの射程の端で止まるので、弓櫓の後ろには届かない）。守りは、的の後ろに並べる
    case 'archer':
      return atk
        ? [
            { side: 'd', kind: 'sage', dx: -2, dy: 0 },
            { side: 'd', kind: 'rider', dx: -4, dy: 0 },
          ]
        : [
            { side: 'a', kind: 'shd', dx: -1.5, dy: 0 },
            { side: 'a', kind: 'shd', dx: -3, dy: 0 },
          ];
    // 上杉謙信：狙う相手の上下に並べ、回転斬りの範囲にまとめて入れる。謙信は範囲のふちに相手を捉えた所で斬り、
    // 寄ってくる道によって範囲に入る相手が変わるので、見本では謙信を、見本役と相手がみな範囲に入る所（spinSpot）に留める
    case 'brave':
      return atk
        ? [
            // 弓櫓の西隣のマスの上下
            { side: 'd', kind: 'sage', dx: -1, dy: -1 },
            { side: 'd', kind: 'rider', dx: -1, dy: 1 },
          ]
        : [
            { side: 'a', kind: 'shd', dx: 0, dy: -1 },
            { side: 'a', kind: 'shd', dx: 0, dy: 1 },
          ];
    // 徳川家康：戦う所のそばに味方を置き、軍配の光の粒が味方へ飛ぶのを見せる
    case 'guard':
      return atk
        ? [
            { side: 'a', kind: 'inf', dx: -2, dy: -1 },
            { side: 'a', kind: 'inf', dx: -2, dy: 1 },
          ]
        : [
            { side: 'd', kind: 'sage', dx: 1.5, dy: -1.5 },
            { side: 'd', kind: 'rider', dx: 1.5, dy: 1.5 },
          ];
    // 豊臣秀吉：戦う所のそばに敵を置き、刀狩の印が敵に掛かるのを見せる。攻めは、秀吉が寄ってくる弓櫓の西の上下
    case 'builder':
      return atk
        ? [
            { side: 'd', kind: 'sage', dx: -2, dy: -1 },
            { side: 'd', kind: 'rider', dx: -2, dy: 1 },
          ]
        : [
            { side: 'a', kind: 'shd', dx: 0, dy: -1 },
            { side: 'a', kind: 'shd', dx: 0, dy: 1 },
          ];
    // 真田昌幸：狙う相手のそばに並べ、火計の円にまとめて入れる（円は狙った相手を中心に落ちる）
    case 'sage':
      return atk
        ? [
            { side: 'd', kind: 'archer', dx: -1, dy: -1 },
            { side: 'd', kind: 'rider', dx: -1, dy: 1 },
          ]
        : [
            { side: 'a', kind: 'shd', dx: 0, dy: -1 },
            { side: 'a', kind: 'shd', dx: 0, dy: 1 },
          ];
    // 織田信長の三段撃ちは、狙った1人（的・弓櫓）へ続けて撃つので、見本役を並べない
    default:
      return [];
  }
}

// tower は、攻め手の見本で弓櫓を置くマス（省くと、はじめの場所）。skill なら、スキルだけの見本にする
// （スキルを持つ武将だけ。見本役を並べ（信長は並べない）、武将が毎回の番でスキルを出す）
export function createSample(of: SampleOf, tower: Spot = TOWER, skill = false): Sample {
  const layout = emptyLayout();
  const specs = skill && hasSkillSample(of) ? dummySpecs(of) : [];
  if (of.k === 'atk') {
    // 攻め手は、櫓に向かって攻める（歩兵は本丸へ向かう道の近くにある櫓だけを攻める）。櫓も撃ち返す。門を狙う衝車は、櫓の代わりに置いた門を叩き続ける（見本は体力を満タンに戻すので、門は壊れない）。
    // 囮の斥候は、櫓に近づいては下がるので、カメラを下がる側へ寄せる
    const ram = of.kind === 'ram';
    layout.buildings.push({ type: ram ? 'gate' : 'tbow', x: tower.x, y: tower.y });
    // 守りの見本役は、守将として持ち場に置く（弓櫓のマスからのずれ）
    for (const d of specs)
      if (d.side === 'd' && isGeneralKind(d.kind))
        layout.generals.push({ kind: d.kind, x: tower.x + Math.floor(d.dx), y: tower.y + Math.floor(d.dy) });
    const s = createBattle(layout);
    const subject = put(s, of.kind, ram ? HALL.x - 6.5 : ATTACKER_X, ROW + 0.5);
    const decoy = ADEF[of.kind].pref === 'decoy';
    const focus = { x: ram ? HALL.x - 3 : decoy ? HALL.x - 9 : HALL.x - 6.5, y: ROW + 0.5 };
    const dummies = specs.map((d, i) => ({
      u:
        d.side === 'a'
          ? put(s, d.kind, tower.x + d.dx + 0.5, tower.y + d.dy + 0.5)
          : s.defenders[specs.slice(0, i).filter((e) => e.side === 'd').length],
      dx: tower.x + d.dx + 0.5,
      dy: tower.y + d.dy + 0.5,
      pin: false,
    }));
    return finish({
      of,
      layout,
      battle: s,
      pin: null,
      px: 0,
      py: 0,
      tower: ram ? null : tower,
      focus,
      skill: skill && hasSkillSample(of),
      subject,
      dummies,
      keep: false,
      born: new Map(),
      anchor: null,
    });
  }
  // 施設は、射程の内側に止めた盾兵を撃つ。守りの武将は、持ち場の近くに止めた盾兵に向かって攻める。
  // 鼓楼は、隣の弓櫓が速く撃つ。鐘楼は、見張りの範囲に止めた盾兵を見つけて鐘を鳴らし、離れた持ち場の上杉謙信が駆けつける。
  // 的は、はじめは西に置く
  if (of.k === 'fac') layout.buildings.push({ type: of.type, x: SHOOTER_X, y: ROW });
  else layout.generals.push({ kind: of.kind, x: SHOOTER_X, y: ROW });
  const gen0 = layout.generals.length;
  // 守りの見本役のうち守将は、持ち場に置く（的からのずれ。的は持ち場の西に置く）
  const px0 = SHOOTER_X + 0.5 - (of.k === 'fac' ? pinDist(of.type) : GEN_PIN_DIST);
  for (const d of specs)
    if (d.side === 'd' && isGeneralKind(d.kind))
      layout.generals.push({ kind: d.kind, x: Math.floor(px0 + d.dx), y: ROW + Math.floor(d.dy) });
  if (of.k === 'fac' && of.type === 'drum') layout.buildings.push({ type: 'tbow', x: SHOOTER_X, y: ROW - 1 });
  if (of.k === 'fac' && of.type === 'bell')
    layout.generals.push({ kind: BELL_GENERAL, x: SHOOTER_X + BELL_GENERAL_DX, y: ROW });
  const s = createBattle(layout);
  const cx = SHOOTER_X + 0.5;
  const cy = ROW + 0.5;
  const px = cx - (of.k === 'fac' ? pinDist(of.type) : GEN_PIN_DIST);
  const pin = put(s, 'shd', px, cy);
  let nd = gen0;
  const dummies = specs.map((d) => ({
    u: d.side === 'a' ? put(s, d.kind, px + d.dx, cy + d.dy) : s.defenders[nd++],
    dx: d.dx,
    dy: d.dy,
    pin: true,
  }));
  return finish({
    of,
    layout,
    battle: s,
    pin,
    px,
    py: cy,
    tower: null,
    focus: { x: cx, y: cy },
    skill: skill && hasSkillSample(of),
    subject: of.k === 'def' ? s.defenders[0] : null,
    dummies,
    keep: false,
    born: new Map(),
    anchor: null,
  });
}
function finish(sm: Sample) {
  sm.battle.timeLimit = Number.POSITIVE_INFINITY;
  const u = sm.subject;
  sm.keep = sm.skill && !!u && sm.of.k !== 'fac' && rangedSkill(ADEF[sm.of.kind]);
  hold(sm);
  return sm;
}

// 盤面のマス (x, y) を、見本の相手の新しい場所にする。
// 的がある見本は、的をそのマスの真ん中へ移す（戦いはそのまま続く）。
// 攻め手の見本は、そのマスに弓櫓を置き直した見本を作って返す。攻め手は最初の位置へ戻さず、今いる所から動かす。
// 置けないマス（盤面の外・建物や武将のいるマス・攻め手の体がかかるマス）と、相手を動かせない見本（衝車）では null を返す
export function retarget(sm: Sample, x: number, y: number): Sample | null {
  if (x < 0 || y < 0 || x >= W || y >= H || occAt(sm.layout, x, y) || !dummiesFit(sm, x, y)) return null;
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
  const next = createSample(sm.of, { x, y }, sm.skill);
  const v = next.battle.attackers[0];
  v.x = v.px = u.x;
  v.y = v.py = u.y;
  next.anchor = null;
  return next;
}
// 弓櫓・的をマス (x, y) へ動かしたとき、スキルだけの見本の見本役が、盤面の内の建物のないマスに収まるか
// （動かす弓櫓のマスは、建物とみなさない）
function dummiesFit(sm: Sample, x: number, y: number) {
  if (!sm.skill) return true;
  const others = sm.layout.buildings.filter((b) => !(sm.tower && b.type === 'tbow'));
  return dummySpecs(sm.of).every((d) => {
    const atkGen = sm.tower && d.side === 'd' && isGeneralKind(d.kind);
    const tx = atkGen ? x + Math.floor(d.dx) : Math.floor(x + 0.5 + d.dx);
    const ty = atkGen ? y + Math.floor(d.dy) : Math.floor(y + 0.5 + d.dy);
    return tx >= 0 && ty >= 0 && tx < W && ty < H && !occAt({ buildings: others, generals: [] }, tx, ty);
  });
}

// 的を (px, py) に止める（前の位置も合わせ、動いたとみなさない）。見本役も、決めた所に止め、攻撃させない
function hold(sm: Sample) {
  const stay = (u: Unit, x: number, y: number) => {
    u.x = u.px = x;
    u.y = u.py = y;
    u.vx = u.vy = 0;
    u.path = [];
  };
  if (sm.pin) stay(sm.pin, sm.px, sm.py);
  const u = sm.subject;
  // スキルだけの見本の上杉謙信：見本役と相手がみな回転斬りの範囲に入る所に留める（攻めは弓櫓の西隣のマスの真ん中、守りは的の東1マス）
  if (sm.skill && u && ADEF[u.kind].spin) {
    if (sm.tower) stay(u, sm.tower.x - 0.5, sm.tower.y + 0.5);
    else stay(u, sm.px + 1, sm.py);
  }
  if (sm.keep && u) {
    const [tx, ty] = sm.tower ? [sm.tower.x + 0.5, sm.tower.y + 0.5] : [sm.px, sm.py];
    if (Math.hypot(u.x - tx, u.y - ty) > (ADEF[u.kind].skillRange ?? 0)) sm.anchor = null;
    else {
      sm.anchor ??= { x: u.x, y: u.y };
      stay(u, sm.anchor.x, sm.anchor.y);
    }
  }
  for (const d of sm.dummies) {
    stay(d.u, d.pin ? sm.px + d.dx : d.dx, d.pin ? sm.py + d.dy : d.dy);
    d.u.cd = Math.max(d.u.cd, 0.5);
    d.u.cast = null;
  }
}

// 見本を1ティック進める。的は止めたまま、だれの体力も満タンに戻す。
// スキルだけの見本では、武将の次のスキルを出せる時刻をいつも「今」にして、毎回の番をスキルにする（見本の中だけの扱い）
export function stepSample(sm: Sample) {
  const s = sm.battle;
  const u = sm.subject;
  if (sm.skill && u) {
    u.skillAt = Number.NEGATIVE_INFINITY;
    if (!u.cast) u.nextSkill = true;
  }
  step(s);
  hold(sm);
  for (const list of [s.attackers, s.defenders, s.buildings]) for (const e of list) if (e.hp > 0) e.hp = e.maxHp;
  // 呼ばれた兵は、しばらくしたら去らせる
  for (const a of [...s.attackers, ...s.defenders]) if (a.summoner && !sm.born.has(a.id)) sm.born.set(a.id, s.t);
  for (const a of dismissSummoned(s, (a) => s.t - (sm.born.get(a.id) ?? s.t) >= SAMPLE_SUMMON_LIFE))
    sm.born.delete(a.id);
}
