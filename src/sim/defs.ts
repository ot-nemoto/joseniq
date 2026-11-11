// ---- 定数 ---------------------------------------------------------------
export const W = 42;
export const H = 42;
export const RING = 1;
export const ZONE = { x0: 1, y0: 1, x1: W - 2, y1: H - 2 } as const; // 防衛を配置できる40×40マス
export const ZW = ZONE.x1 - ZONE.x0 + 1;
export const HALL = { x: W / 2 - 1, y: H / 2 - 1, w: 2, h: 2 } as const; // 本丸（2×2）の大きさと、本丸だけの配置（テストなど）で置く位置（盤面の真ん中）
// 本丸は動かせる。4マスすべてを、盤面の端からこのマス数以上内側に置く。
// 外周の出撃エリア（1マス）の内側に、さらに4マスの余白を取る（本丸を壁で囲う隙間を残すため）
export const HALL_MARGIN = 5;
// ---- 地形の高低（数値は仮） ----
export const MAX_HEIGHT = 4; // マスの高さは 0（平地）〜 MAX_HEIGHT。隣との差が2段以上なら崖で通れない
export const HEIGHT_RANGE_BONUS = 1; // 遠くを撃つものは、相手より高い所に立つと、高さの差1段につき射程がこのマスだけ伸びる
export const UPHILL_SPEED = 0.6; // 坂を上るときの速さの倍率（下りは普通）
export const RIVER_SPEED = 0.1; // 川と堀の中を進むときの速さの倍率（兵も武将も同じ）
export const DT = 1 / 30;
// 盾兵の肩代わり：この距離にいる将以外の味方が受けるダメージを、盾兵が代わりに受ける
export const SHIELD_RADIUS = 1.5;
// 弓兵の足止め：当てた守将の攻撃の間隔・移動・構えをこの割合の速さにする
export const SLOW_RATE = 0.5;
// 攻撃の知らせ：守将は、検知範囲の中で味方が攻撃されたら、攻撃した相手に向かう
export const ALARM_TTL = 1.0; // 攻撃された記録が残る秒数
export const ALERT_TIME = 3; // 知らせを受けてから、持ち場を広く離れられる秒数
export const ALERT_EXTRA = 8; // そのあいだ持ち場から追加で離れられる距離
// 武将：1つの軍に出せるのは3人まで（攻撃側・防衛側とも）
export const MAX_GENERALS = 3;
// 武将の特徴に使う距離
export const REPAIR_RADIUS = 4; // 築城：守りでは建物を直し、攻めでは工兵を強める範囲
// 次の番が来られるようになって（攻撃の待ちが0になって）から、これを過ぎても番を始めなかったら、戦いが止んだと
// みなす（画面は構えを解き、計算はスキルの番を決め直す）
export const ATTACK_ENGAGED = 1.5;
export const WARD_RADIUS = 3.5; // 守り：軍配を振ったときに、傷を減らす効果を掛ける範囲
// 兵の寄り道：寄り道の距離（AttackerDef の reach）の何倍までの道のりなら、寄り道するか。
// これを超えるもの（城壁の向こうなど）には寄らない
export const DETOUR_PATH_RATE = 2;
export const TIME_LIMIT = 150;
// 出撃できるのは、開戦からこの秒数まで（予定も、手で出すのも）。残りの時間は、出した兵と武将で攻める
export const PLAN_LIMIT = 120;
export const PLAN_TICKS = Math.round(PLAN_LIMIT / DT);
export const BUDGET_A = 60; // 攻撃側の兵力

export type BuildingType = 'wall' | 'gate' | 'tbow' | 'tgun' | 'cata' | 'drum' | 'bell' | 'hall';
export type GeneralKind = 'brave' | 'archer' | 'sage' | 'rider' | 'gunner' | 'builder' | 'guard';
export type AttackerKind = 'inf' | 'arc' | 'cav' | 'ram' | 'eng' | 'shd' | 'scout' | GeneralKind;
export type PlaceTool = BuildingType | GeneralKind;
// 堀（moat）は施設ではなく地面の層（配置データの moat）に引く。置いたものを動かすときは、道具を選ばずにつかむ
export type Tool = PlaceTool | 'moat' | 'erase';

// 数の上限があるのは、本丸と武将だけ。ほかの施設には上限を置かない。
// - 門は、本丸から城の外への逃げ道と外の門の数（layout.ts の escapeShort）と、門の間かく（GATE_SPACING）の決まりだけにする
// - 櫓・大筒・鼓楼・鐘楼は、郭の点数（BDEF の cost）で数を抑える
// - 城壁は、塀の線にしか引けず、郭ごとに広い土地が要り、仕切ると土地（点数）が減るので、それで抑える
export type LimitedTool = 'hall' | GeneralKind;
export const LIMITS: Record<LimitedTool, number> = {
  hall: 1,
  brave: 1,
  archer: 1,
  sage: 1,
  rider: 1,
  gunner: 1,
  builder: 1,
  guard: 1,
};
// 置くものの数の上限。上限のないものは 0
export const limitOf = (t: PlaceTool): number => (Object.hasOwn(LIMITS, t) ? LIMITS[t as LimitedTool] : 0);

// 飛び道具の種類と、飛ぶ速さ（1秒に進むマス）。撃った時に飛ばし、届いた時に傷を入れる
// 攻めで寄り道して狙う相手の種類（優先の順 detour に並べる）：施設（櫓・大筒・鼓楼・鐘楼）・門・武将（守将と守りの兵）。
// 本丸は寄り道の相手ではなく、道の行き先（目標）
export type DetourTarget = 'facility' | 'gate' | 'general';
// 守りで狙う相手の種類（優先の順 defOrder に並べる）：攻めの武将・攻めの兵
export type DefTarget = 'general' | 'troop';
export type ShotKind = 'arrow' | 'bullet' | 'ball';
export const SHOT_SPEED: Record<ShotKind, number> = { arrow: 14, bullet: 40, ball: 9 };
// 飛び道具は動く先を読んで、その場所へ飛ぶので、相手が向きや速さを変えると外れる
export const SHOT_HIT_RADIUS = 0.5; // 矢と鉄砲の弾は、落ちた所からこの距離の内にいる相手に当たる

export interface BuildingDef {
  name: string;
  hp: number;
  w: number;
  h: number;
  unbreakable?: boolean; // 壊せない（城壁）。攻撃でも範囲攻撃でも体力が減らない
  // 壊せば通れる（門・大筒）。攻め手は壊して通る道も探し、壊れたら空きマスになる。
  // ほかの施設（櫓・鼓楼）は壊れても石垣の台が残り、通れない
  breakThrough?: boolean;
  tower?: boolean;
  range?: number;
  minRange?: number;
  dmg?: number;
  cd?: number;
  splash?: number;
  shot?: ShotKind; // 撃つ飛び道具（櫓・大筒）
  // 撃つ相手の優先の順（櫓・大筒）。射程の内に前の種類の攻め手がいれば、後の種類より先に撃つ（同じ種類なら近い者）。
  // 並べていない種類は、並べた種類より後
  defOrder?: readonly DefTarget[];
  aura?: number;
  rate?: number;
  cost?: number; // 施設（櫓・大筒・鼓楼・鐘楼）が使う、郭の点数（数値は仮）
}
// 武将の特徴（攻撃側・防衛側で共通）
export interface GeneralTraits {
  repair?: number; // 守り：周りの建物を1秒に直す量（築城）
  engBoost?: number; // 攻め：周りの工兵の、施設への倍率（築城）
  // スキル：攻撃の番のうち、スキルが出せるものをスキルに替える（番の初めに決める）。出したら、溜めのあとに効き、
  // 効いた時から攻撃の間隔を数え直して、次の番から攻撃に戻る。開戦の時点ですぐ出せる
  skillCd?: number; // スキルの間隔（秒）。前のスキルを出してから、これだけ経つと次を出せる
  skillWindup?: number; // スキルの溜め（秒）
  ward?: number; // スキル（軍配）：周りの味方（守りなら建物も）が受ける傷を減らす割合
  wardTime?: number; // その効果が続く時間（秒）
  // スキルの射程。持つ武将は、スキルが出せる番に、相手がこの射程に入ったら立ち止まってスキルを出す
  // （持たない武将は、通常攻撃の射程に入ってから出す）。射程が2より長いので、高い所から伸びる
  skillRange?: number;
  skillShot?: ShotKind; // スキル（飛び道具）：溜めのあと、狙った相手へ撃つ飛び道具。届いた時に当たる
  skillDmg?: number; // その傷（攻めの建物には攻めの倍率を掛ける）
  // スキルの飛び道具が貫通する：狙った相手を貫いてスキルの射程の端まで飛び、通り道の敵（攻めは壊せる建物も）すべてに当たる
  skillPierce?: boolean;
  // スキルの飛び道具を続けて撃つ数（なければ1）と、撃つ間（秒）。溜めのあと1発目を撃ち、撃つ間ごとに残りを撃つ。
  // 途中で相手が倒れても狙いを移さず、残りは倒れた相手のいた所へ撃つ（織田信長の三段撃ち）
  skillVolley?: number;
  skillVolleyGap?: number;
  spin?: number; // スキル（回転斬り）：溜めのあと、周りの敵と壊せる建物に与える傷（建物には攻めの倍率を掛ける）
  spinRadius?: number; // 回転斬りが届く範囲（半径・マス）
  // スキル（刀狩）：溜めのあと、周りの敵（兵・武将・施設）が与える傷を減らす割合と、その効果が続く時間（秒）・届く範囲（半径・マス）
  disarm?: number;
  disarmTime?: number;
  disarmRadius?: number;
  // スキル（火計）：溜めのあと、狙った相手のいた所（溜めを始めた時の位置）を中心に、半径 skillRadius の円の内に skillDmg の傷を
  // まとめて与え、当たった相手を燃やす（burn・burnTime）。出す距離は skillRange（高い所からは伸びる）
  skillFire?: boolean;
  skillRadius?: number;
  // スキル（兵を呼ぶ）：溜めのあと、そばに呼ぶ兵の種類と、生きている呼んだ兵の上限。呼んだ兵は兵力を使わない。
  // 出す距離は skillRange（敵がこの内に入った番で出す。高い所でも伸びない）
  summon?: AttackerKind;
  summonMax?: number;
  // 相手の武将への倍率（攻めの兵の騎兵が持つ。守りの兵の騎兵も、攻めの武将に掛ける）。武将に持たせるときは GENERALS に書く
  vsGen?: number;
}
// 将（武将）の能力は攻撃側・防衛側で共通
export interface GeneralStats extends GeneralTraits {
  busho: string; // 見立てている武将（役目の名前は持たず、画面には武将の名前だけを出す）
  hp: number;
  dmg: number;
  cd: number;
  speed: number;
  range: number;
  shot?: ShotKind; // 飛び道具で撃つ（なければ、近くで当てる）
  // スキルの火計に当たった相手が燃え続ける：1秒ごとに入る傷と、燃える時間（秒）
  burn?: number;
  burnTime?: number;
}
// 防衛側の将：持ち場から動ける範囲を足したもの
export interface GeneralDef extends GeneralStats {
  // 今いる位置から敵を見つける距離。この内に狙う相手がいるあいだは追い（追った先からも同じく見る）、いなければ持ち場へ戻る
  aggro: number;
  // 狙う相手の優先の順。索敵範囲の内に前の種類の相手がいれば、後の種類より先に狙う（同じ種類なら近い者）。
  // 並べていない種類は、並べた種類より後
  defOrder: readonly DefTarget[];
}
// 守りの武将の索敵範囲（GDEF の aggro）。今は武将一律（数値は仮）
export const GENERAL_AGGRO = 5;
export interface AttackerDef extends GeneralTraits {
  name: string;
  glyph: string;
  cost: number;
  hp: number;
  dmg: number;
  cd: number;
  speed: number;
  range: number;
  shot?: ShotKind; // 飛び道具で撃つ（なければ、近くで当てる）
  fac: number; // 対施設（櫓・大筒・鼓楼・鐘楼）への倍率。門への倍率（gate）がなければ、門にも使う
  gate?: number; // 門への倍率（なければ fac）。衝車は門に強い
  hall: number; // 対本丸への倍率
  // 役目。any：ふつう / gate：衝車（本丸への道をふさいでいる門を、本丸の代わりに目指す） / decoy：囮（斥候） /
  // general：武将を好む（守りの兵になったとき、攻めの武将を兵より先に狙う）
  pref: 'any' | 'general' | 'gate' | 'decoy';
  // 寄り道の距離。本丸への道を進み、今いる場所からこの距離の内にある、detour に並べた相手にだけ寄り道する
  reach?: number;
  // 寄り道で狙う相手の優先の順。目標（本丸。衝車は道をふさぐ門）への道を進み、寄り道の距離の内に前の種類の相手がいれば、
  // 後の種類より先に寄る（同じ種類なら近い者）。並べていない種類には寄り道しない。だれもいなければ目標への道を進む
  detour: readonly DetourTarget[];
  limit?: number; // 出撃できる上限（将は1人ずつ）
  general?: boolean;
  noUnits?: boolean;
  slow?: number; // 当てた守将を遅くする秒数
  burn?: number; // スキルの火計に当たった相手が燃え続ける：1秒ごとに入る傷
  burnTime?: number; // 燃える時間（秒）
}

export const BDEF: Record<BuildingType, BuildingDef> = {
  wall: { name: '城壁', hp: 360, w: 1, h: 1, unbreakable: true }, // 攻め手は門を通る
  gate: { name: '門', hp: 1500, w: 1, h: 1, breakThrough: true }, // 守将は通れる。攻め手は壊さないと通れない
  tbow: {
    name: '弓櫓',
    hp: 480,
    w: 1,
    h: 1,
    range: 4,
    dmg: 26,
    cd: 1.0,
    tower: true,
    shot: 'arrow',
    defOrder: ['general', 'troop'],
    cost: 2,
  },
  tgun: {
    name: '鉄砲櫓',
    hp: 420,
    w: 1,
    h: 1,
    range: 7,
    dmg: 70,
    cd: 3.0,
    tower: true,
    shot: 'bullet',
    defOrder: ['general', 'troop'],
    cost: 3,
  },
  cata: {
    name: '大筒',
    hp: 400,
    w: 1,
    h: 1,
    range: 9,
    minRange: 3.5,
    dmg: 55,
    cd: 4.0,
    splash: 1.6,
    tower: true,
    shot: 'ball',
    defOrder: ['general', 'troop'],
    breakThrough: true, // 郭の中に置くもので、壁に組み込むものではない
    cost: 3,
  },
  drum: { name: '鼓楼', hp: 380, w: 1, h: 1, aura: 6.5, rate: 1.3, cost: 2 },
  // 早鐘：見張りの範囲（aura）に攻め手が入ると鳴り、城じゅうの守将に知らせる
  bell: { name: '鐘楼', hp: 380, w: 1, h: 1, aura: 8, cost: 1 },
  hall: { name: '本丸', hp: 5200, w: HALL.w, h: HALL.h },
};
// 将は兵より大幅に強い。3将をどう使うかが勝敗の鍵
const GENERALS: Record<GeneralKind, GeneralStats> = {
  brave: {
    busho: '上杉謙信',
    hp: 2000,
    dmg: 50,
    cd: 0.8,
    speed: 1.5,
    range: 0.9,
    skillCd: 10.0,
    skillWindup: 0.3,
    spin: 160,
    spinRadius: 2.0,
  },
  // ふだんは槍で突く。スキルで弓を引き、弓兵と同じ射程（4）まで届く強い矢を1本放つ
  archer: {
    busho: '大島光義',
    hp: 2000,
    dmg: 50,
    cd: 0.8,
    speed: 1.5,
    range: 0.9,
    skillCd: 10.0,
    skillWindup: 0.36, // 矢をつがえて引き絞り、狙う
    skillRange: 4.0,
    skillShot: 'arrow',
    skillDmg: 240,
    skillPierce: true,
  },
  // ふだんは軍配で近くを打つ。6秒ごとにスキル「火計」で、離れた所の円の内にまとめて傷を与え、当たった相手を燃やす
  sage: {
    busho: '真田昌幸',
    hp: 2000,
    dmg: 50,
    cd: 0.8,
    speed: 1.5,
    range: 0.9,
    skillCd: 10.0,
    skillWindup: 0.6,
    skillFire: true,
    skillRange: 8.0,
    skillDmg: 180,
    skillRadius: 2.0,
    burn: 20,
    burnTime: 3.0,
  },
  // ふだんは軍配で近くを打つ。10秒ごとにスキルで、そばに騎兵を1体呼ぶ（生きている呼んだ騎兵は3体まで）
  rider: {
    busho: '武田信玄',
    hp: 2000,
    dmg: 50,
    cd: 0.8,
    speed: 1.5,
    range: 0.9,
    skillCd: 10.0,
    skillWindup: 0.6,
    skillRange: 6.0,
    summon: 'cav',
    summonMax: 3,
  },
  // ふだんは槍で突く。スキルで鉄砲を構え、鉄砲櫓と同じ射程（7）から、狙った相手へ3発続けて撃つ（三段撃ち）
  gunner: {
    busho: '織田信長',
    hp: 2000,
    dmg: 50,
    cd: 0.8,
    speed: 1.5,
    range: 0.9,
    skillCd: 10.0,
    skillWindup: 0.7, // 鉄砲を構えて狙う
    skillRange: 7.0,
    skillShot: 'bullet',
    skillDmg: 160,
    skillVolley: 3,
    skillVolleyGap: 0.2,
  },
  // 守りでは周りの建物を直し、攻めでは周りの工兵の作業を速める。ふだんは刀で斬り、8秒ごとにスキル「刀狩」で、
  // 溜めのあと、周りの敵（兵・武将・櫓・大筒）の与える傷を4秒のあいだ減らす
  builder: {
    busho: '豊臣秀吉',
    hp: 2000,
    dmg: 50,
    cd: 0.8,
    speed: 1.5,
    range: 0.9,
    repair: 25,
    engBoost: 1.5,
    skillCd: 10.0,
    skillWindup: 0.4,
    disarm: 0.4,
    disarmTime: 4.0,
    disarmRadius: 3.5,
  },
  // ふだんは軍配で近くを打つ。8秒ごとにスキルで軍配を振り、溜めのあと、周りの味方が受ける傷を4秒のあいだ減らす
  guard: {
    busho: '徳川家康',
    hp: 2000,
    dmg: 50,
    cd: 0.8,
    speed: 1.5,
    range: 0.9,
    skillCd: 10.0,
    skillWindup: 0.6,
    ward: 0.3,
    wardTime: 4.0,
  },
};
export const GDEF: Record<GeneralKind, GeneralDef> = {
  brave: { ...GENERALS.brave, aggro: GENERAL_AGGRO, defOrder: ['general', 'troop'] },
  archer: { ...GENERALS.archer, aggro: GENERAL_AGGRO, defOrder: ['general', 'troop'] },
  sage: { ...GENERALS.sage, aggro: GENERAL_AGGRO, defOrder: ['general', 'troop'] },
  rider: { ...GENERALS.rider, aggro: GENERAL_AGGRO, defOrder: ['general', 'troop'] },
  gunner: { ...GENERALS.gunner, aggro: GENERAL_AGGRO, defOrder: ['general', 'troop'] },
  builder: { ...GENERALS.builder, aggro: GENERAL_AGGRO, defOrder: ['general', 'troop'] },
  guard: { ...GENERALS.guard, aggro: GENERAL_AGGRO, defOrder: ['general', 'troop'] },
};
// 兵は用途ごとに尖らせ、将はどれにも強い主力にする
// 攻め手の表の武将の行：能力値（GENERALS）を広げ、表示の名前と印（武将の名前とその1字目）と、武将としての扱い（兵力を使わず1人まで）を付ける。
// 寄り道の距離は、今は武将一律（歩兵と同じ3マス）。
// 施設・門・本丸への倍率（fac・gate・hall）は、今は7人とも1。寄り道で狙う相手の優先の順（detour）を、武将ごとに渡す
export const GENERAL_REACH = 3;
const attackerGeneral = (k: GeneralKind, o: Pick<AttackerDef, 'detour'> & Partial<AttackerDef>): AttackerDef => ({
  ...GENERALS[k],
  name: GENERALS[k].busho,
  glyph: GENERALS[k].busho[0],
  cost: 0,
  limit: 1,
  general: true,
  pref: 'any',
  reach: GENERAL_REACH,
  fac: 1,
  hall: 1,
  ...o,
});
export const ADEF: Record<AttackerKind, AttackerDef> = {
  // 数で押す。本丸へ道なりに進み、通りがかりの施設を壊す
  inf: {
    name: '歩兵',
    glyph: '歩',
    cost: 1,
    hp: 130,
    dmg: 11,
    cd: 0.8,
    speed: 1.8,
    range: 0.8,
    fac: 0.4,
    hall: 0.4,
    pref: 'any',
    reach: 3,
    detour: ['facility'],
  },
  // 守将を遠くから射て足止めする（当てた守将の動きを2秒遅くする）。建物にはほぼ効かない
  arc: {
    name: '弓兵',
    glyph: '弓',
    cost: 2,
    hp: 70,
    dmg: 12,
    cd: 0.9,
    speed: 1.7,
    range: 4,
    shot: 'arrow',
    fac: 0.1,
    hall: 0.1,
    pref: 'general',
    reach: 3,
    detour: ['general', 'facility'],
    slow: 2,
  },
  // 守将狩り。守将への攻撃が3倍
  cav: {
    name: '騎兵',
    glyph: '騎',
    cost: 5,
    hp: 400,
    dmg: 26,
    cd: 0.9,
    speed: 3.4,
    range: 0.8,
    fac: 0.2,
    hall: 0.2,
    pref: 'general',
    reach: 3,
    detour: ['general', 'facility'],
    vsGen: 3,
  },
  // 門を破る。本丸には弱い
  ram: {
    name: '衝車',
    glyph: '車',
    cost: 5,
    hp: 600,
    dmg: 100,
    cd: 1.6,
    speed: 1.0,
    range: 0.8,
    fac: 0.5,
    gate: 3,
    hall: 0.2,
    pref: 'gate',
    reach: 1,
    detour: ['gate'],
    noUnits: true,
  },
  // 櫓などの施設を壊して道を開く。門と本丸には弱い
  eng: {
    name: '工兵',
    glyph: '工',
    cost: 2,
    hp: 180,
    dmg: 12,
    cd: 0.8,
    speed: 1.8,
    range: 0.8,
    fac: 10,
    gate: 1,
    hall: 0.3,
    pref: 'any',
    reach: 6,
    detour: ['facility'],
  },
  // 周りの兵の傷を肩代わりする
  shd: {
    name: '盾兵',
    glyph: '盾',
    cost: 4,
    hp: 2000,
    dmg: 5,
    cd: 1.0,
    speed: 1.8,
    range: 0.8,
    fac: 0.1,
    hall: 0.1,
    pref: 'any',
    reach: 1,
    detour: ['general', 'facility'],
  },
  // 足だけ速い囮。守将を誘い出し、櫓に空撃ちさせる
  scout: {
    name: '斥候',
    glyph: '斥',
    cost: 1,
    hp: 150,
    dmg: 0,
    cd: 1.0,
    speed: 4.0,
    range: 0.8,
    fac: 0,
    hall: 0,
    pref: 'decoy',
    reach: 3,
    detour: ['general', 'facility'],
    noUnits: true,
  },
  // 攻撃側の将：兵力を使わず1人ずつ出せる
  brave: attackerGeneral('brave', { detour: ['general', 'facility', 'gate'] }),
  archer: attackerGeneral('archer', { detour: ['general', 'facility', 'gate'] }),
  sage: attackerGeneral('sage', { detour: ['general', 'facility', 'gate'] }),
  rider: attackerGeneral('rider', { detour: ['general', 'facility', 'gate'] }),
  gunner: attackerGeneral('gunner', { detour: ['general', 'facility', 'gate'] }),
  builder: attackerGeneral('builder', { detour: ['general', 'facility', 'gate'] }),
  guard: attackerGeneral('guard', { detour: ['general', 'facility', 'gate'] }),
};
export const UNIT_ORDER: readonly AttackerKind[] = [
  'inf',
  'arc',
  'cav',
  'ram',
  'eng',
  'shd',
  'scout',
  'brave',
  'archer',
  'sage',
  'rider',
  'gunner',
  'builder',
  'guard',
];
// 武将（兵力を使わず、1つの軍に MAX_GENERALS 人まで）
export const GENERAL_ORDER: readonly GeneralKind[] = ['brave', 'archer', 'sage', 'rider', 'gunner', 'builder', 'guard'];
// 兵（武将でないもの）の並び
export const TROOP_ORDER: readonly AttackerKind[] = UNIT_ORDER.filter((k) => !ADEF[k].general);

// 門への倍率（門への倍率がなければ、施設と同じ）
export const gateMul = (d: { gate?: number; fac: number }) => d.gate ?? d.fac;
// スキルを出してから、最後に効くまでの時間（秒）：溜めに、続けて撃つ残りの発数の撃つ間を足したもの。
// このあいだは動かず、次の番は、これに攻撃の間隔を足したあとに来る
export const skillSpan = (d: GeneralTraits) =>
  (d.skillWindup ?? 0) + ((d.skillVolley ?? 1) - 1) * (d.skillVolleyGap ?? 0);
export const isBuildingType = (t: string): t is BuildingType => Object.hasOwn(BDEF, t);
// 城壁・門・本丸のほかの施設：撃つ施設（櫓・大筒）と、まわりに効く施設（鼓楼・鐘楼）。
// 守り手が入る建物で、攻め手の工兵が狙い、動作の見本にもできる
export const isFacilityType = (t: BuildingType) => !!BDEF[t].tower || !!BDEF[t].aura;
export const isGeneralKind = (t: string): t is GeneralKind => Object.hasOwn(GDEF, t);
// 外した武将（前田利家・服部半蔵）。外す前に書き出した配置や出撃の予定も読めるよう、読み込むときに黙って飛ばす
const REMOVED_GENERALS: readonly string[] = ['spear', 'ninja'];
export const isRemovedGeneral = (kind: unknown) => typeof kind === 'string' && REMOVED_GENERALS.includes(kind);
export const isAttackerKind = (t: string): t is AttackerKind => Object.hasOwn(ADEF, t);
