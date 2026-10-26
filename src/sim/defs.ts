// ---- 定数 ---------------------------------------------------------------
export const W = 32;
export const H = 32;
export const RING = 1;
export const ZONE = { x0: 1, y0: 1, x1: W - 2, y1: H - 2 } as const; // 防衛を配置できる30×30マス
export const ZW = ZONE.x1 - ZONE.x0 + 1;
export const HALL = { x: W / 2 - 1, y: H / 2 - 1, w: 2, h: 2 } as const; // 本丸（2×2）の初めの位置（中央）
// 本丸は動かせる。4マスすべてを、盤面の端からこのマス数以上内側に置く（外周の出撃エリアと堀の帯より内側）
export const HALL_MARGIN = 5;
export const MOAT_BAND = 3; // 堀は城域の外側3マスにだけ置ける
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
export const CHARGE_DIST = 3; // 騎馬：この距離を駆けてからの一撃が重くなる
export const REPAIR_RADIUS = 4; // 築城：守りでは建物を直し、攻めでは工兵を強める範囲
export const WARD_RADIUS = 3.5; // 守り：味方の傷を減らす範囲
export const TIME_LIMIT = 150;
export const BUDGET_A = 60; // 攻撃側の兵力

export type BuildingType = 'wall' | 'gate' | 'moat' | 'bar' | 'tbow' | 'tgun' | 'cata' | 'drum' | 'hall';
export type GeneralKind = 'brave' | 'archer' | 'sage' | 'spear' | 'rider' | 'gunner' | 'builder' | 'ninja' | 'guard';
export type AttackerKind = 'inf' | 'arc' | 'cav' | 'ram' | 'eng' | 'shd' | 'scout' | GeneralKind;
export type PlaceTool = Exclude<BuildingType, 'hall'> | GeneralKind;
export type Tool = PlaceTool | 'erase'; // 置いたものを動かすときは、道具を選ばずにつかむ

// 種別ごとの配置上限
export const LIMITS: Record<PlaceTool, number> = {
  wall: 160,
  gate: 5,
  moat: 100,
  bar: 60,
  tbow: 12,
  tgun: 4,
  cata: 4,
  drum: 2,
  brave: 1,
  archer: 1,
  sage: 1,
  spear: 1,
  rider: 1,
  gunner: 1,
  builder: 1,
  ninja: 1,
  guard: 1,
};

export interface BuildingDef {
  name: string;
  hp: number;
  w: number;
  h: number;
  terrain?: boolean;
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
  aura?: number;
  rate?: number;
}
// 武将の特徴（攻撃側・防衛側で共通）
export interface GeneralTraits {
  vsMounted?: number; // 騎兵・騎馬の武将への倍率（槍）
  charge?: number; // CHARGE_DIST 以上駆けてからの一撃の倍率（騎馬）
  repair?: number; // 守り：周りの建物を1秒に直す量（築城）
  engBoost?: number; // 攻め：周りの工兵の、施設への倍率（築城）
  stealth?: number; // この距離より近づかないと狙われない（忍び）
  stun?: number; // 当てた相手を止める秒数。櫓・守将・兵の攻撃を遅らせる（忍び）
  ward?: number; // 周りの味方が受ける傷を減らす割合（守り）
}
// 将（武将）の能力は攻撃側・防衛側で共通
export interface GeneralStats extends GeneralTraits {
  name: string; // 型の名前（猛将・槍将など）
  busho: string; // 見立てている武将
  glyph: string;
  hp: number;
  dmg: number;
  cd: number;
  speed: number;
  range: number;
  cleave?: number; // 周囲への追加ダメージ（6割）が届く距離
  aoe?: number; // 範囲攻撃（火計）
  radius?: number;
  windup?: number;
}
// 防衛側の将：持ち場から動ける範囲を足したもの
export interface GeneralDef extends GeneralStats {
  aggro: number; // 今いる位置から敵を見つける距離
  leash: number; // 持ち場から離れられる距離
}
export interface AttackerDef extends GeneralTraits {
  name: string;
  busho?: string; // 武将のとき、見立てている人物
  glyph: string;
  cost: number;
  hp: number;
  dmg: number;
  cd: number;
  speed: number;
  range: number;
  fac: number; // 対施設（門・櫓・大筒・鼓楼）への倍率
  gate?: number; // 門への倍率（なければ fac）。衝車と工兵は門に強い
  hall: number; // 対本丸への倍率
  // any: 一番近い守将・櫓・本丸 / general: 守将を優先 / hall: 本丸だけ / facility: 櫓などの施設を優先
  // decoy: 囮
  pref: 'any' | 'general' | 'hall' | 'facility' | 'decoy';
  limit?: number; // 出撃できる上限（将は1人ずつ）
  general?: boolean;
  noUnits?: boolean;
  cleave?: number;
  vsGen?: number; // 守将への倍率
  slow?: number; // 当てた守将を遅くする秒数
  aoe?: number; // 範囲攻撃（火計）。守将と建物の両方に当たる
  radius?: number;
  windup?: number;
}

export const BDEF: Record<BuildingType, BuildingDef> = {
  wall: { name: '城壁', hp: 360, w: 1, h: 1, unbreakable: true }, // 攻め手は門を通る
  gate: { name: '門', hp: 1500, w: 1, h: 1, breakThrough: true }, // 守将は通れる。攻め手は壊さないと通れない
  moat: { name: '堀', hp: 0, w: 1, h: 1, terrain: true },
  bar: { name: '拒馬', hp: 0, w: 1, h: 1, terrain: true },
  tbow: { name: '櫓（弓）', hp: 480, w: 1, h: 1, range: 6.5, dmg: 26, cd: 1.0, tower: true },
  tgun: { name: '櫓（鉄砲）', hp: 420, w: 1, h: 1, range: 9, dmg: 70, cd: 3.0, tower: true },
  cata: {
    name: '大筒',
    hp: 400,
    w: 1,
    h: 1,
    range: 11,
    minRange: 3.5,
    dmg: 55,
    cd: 4.0,
    splash: 1.6,
    tower: true,
    breakThrough: true, // 郭の中に置くもので、壁に組み込むものではない
  },
  drum: { name: '鼓楼', hp: 380, w: 1, h: 1, aura: 6.5, rate: 1.3 },
  hall: { name: '本丸', hp: 5200, w: HALL.w, h: HALL.h },
};
// 将は兵より大幅に強い。3将をどう使うかが勝敗の鍵
const GENERALS: Record<GeneralKind, GeneralStats> = {
  brave: {
    name: '猛将',
    busho: '上杉謙信',
    glyph: '猛',
    hp: 2600,
    dmg: 80,
    cd: 0.8,
    speed: 2.0,
    range: 0.9,
    cleave: 1.2,
  },
  archer: { name: '弓将', busho: '大島光義', glyph: '弓', hp: 1300, dmg: 60, cd: 0.9, speed: 1.8, range: 7.0 },
  sage: {
    name: '軍師',
    busho: '真田昌幸',
    glyph: '謀',
    hp: 1100,
    dmg: 0,
    cd: 4.0,
    speed: 1.5,
    range: 8.0,
    aoe: 180,
    radius: 2.0,
    windup: 0.6,
  },
  // 長い間合いの近接。騎兵・騎馬の武将に強い
  spear: {
    name: '槍将',
    busho: '前田利家',
    glyph: '槍',
    hp: 2300,
    dmg: 70,
    cd: 0.9,
    speed: 1.9,
    range: 1.6,
    vsMounted: 2,
  },
  // 足が速く、駆けてきた最初の一撃が重い
  rider: {
    name: '騎馬大将',
    busho: '武田信玄',
    glyph: '騎',
    hp: 2000,
    dmg: 70,
    cd: 1.0,
    speed: 3.2,
    range: 0.9,
    charge: 2.5,
  },
  // 射程が長く一撃も大きいが、撃つ間隔が長い
  gunner: { name: '鉄砲大将', busho: '織田信長', glyph: '銃', hp: 1000, dmg: 160, cd: 3.0, speed: 1.5, range: 9.0 },
  // 守りでは周りの建物を直し、攻めでは周りの工兵の作業を速める
  builder: {
    name: '築城名人',
    busho: '加藤清正',
    glyph: '築',
    hp: 1800,
    dmg: 45,
    cd: 0.9,
    speed: 1.8,
    range: 0.9,
    repair: 25,
    engBoost: 1.5,
  },
  // 近づかないと見つからず、当てた相手を止める
  ninja: {
    name: '忍び',
    busho: '服部半蔵',
    glyph: '忍',
    hp: 900,
    dmg: 45,
    cd: 0.8,
    speed: 2.6,
    range: 0.9,
    stealth: 2.5,
    stun: 3,
  },
  // 周りの味方が受ける傷を減らす
  guard: {
    name: '堅守',
    busho: '徳川家康',
    glyph: '守',
    hp: 2600,
    dmg: 50,
    cd: 1.0,
    speed: 1.6,
    range: 0.9,
    ward: 0.3,
  },
};
export const GDEF: Record<GeneralKind, GeneralDef> = {
  brave: { ...GENERALS.brave, aggro: 10.0, leash: 9 },
  archer: { ...GENERALS.archer, aggro: 12.0, leash: 5 },
  sage: { ...GENERALS.sage, aggro: 13.0, leash: 4 },
  spear: { ...GENERALS.spear, aggro: 10.0, leash: 8 },
  rider: { ...GENERALS.rider, aggro: 12.0, leash: 10 },
  gunner: { ...GENERALS.gunner, aggro: 13.0, leash: 4 },
  builder: { ...GENERALS.builder, aggro: 9.0, leash: 5 },
  ninja: { ...GENERALS.ninja, aggro: 11.0, leash: 9 },
  guard: { ...GENERALS.guard, aggro: 9.0, leash: 5 },
};
// 兵は用途ごとに尖らせ、将はどれにも強い主力にする
export const ADEF: Record<AttackerKind, AttackerDef> = {
  // 数で押す。何でも少しずつ
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
    range: 5.0,
    fac: 0.1,
    hall: 0.1,
    pref: 'general',
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
    vsGen: 3,
  },
  // 本丸を落とす
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
    hall: 1.5,
    pref: 'hall',
    noUnits: true,
  },
  // 門と櫓を壊して道を開く。本丸には弱い
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
    gate: 3,
    hall: 0.3,
    pref: 'facility',
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
    noUnits: true,
  },
  // 攻撃側の将：兵力を使わず1人ずつ出せる
  brave: { ...GENERALS.brave, cost: 0, limit: 1, general: true, fac: 1.0, hall: 1.0, pref: 'any' },
  archer: { ...GENERALS.archer, cost: 0, limit: 1, general: true, fac: 0.8, hall: 0.8, pref: 'any' },
  sage: { ...GENERALS.sage, cost: 0, limit: 1, general: true, fac: 1.0, hall: 0.6, pref: 'facility' },
  spear: { ...GENERALS.spear, cost: 0, limit: 1, general: true, fac: 0.8, hall: 0.8, pref: 'any' },
  rider: { ...GENERALS.rider, cost: 0, limit: 1, general: true, fac: 0.4, hall: 0.4, pref: 'general' },
  gunner: { ...GENERALS.gunner, cost: 0, limit: 1, general: true, fac: 0.8, hall: 0.6, pref: 'any' },
  builder: { ...GENERALS.builder, cost: 0, limit: 1, general: true, fac: 3.0, hall: 0.5, pref: 'facility' },
  ninja: { ...GENERALS.ninja, cost: 0, limit: 1, general: true, fac: 1.0, hall: 0.3, pref: 'facility' },
  guard: { ...GENERALS.guard, cost: 0, limit: 1, general: true, fac: 0.6, hall: 0.8, pref: 'any' },
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
  'spear',
  'rider',
  'gunner',
  'builder',
  'ninja',
  'guard',
];
// 武将（兵力を使わず、1つの軍に MAX_GENERALS 人まで）
export const GENERAL_ORDER: readonly GeneralKind[] = [
  'brave',
  'archer',
  'sage',
  'spear',
  'rider',
  'gunner',
  'builder',
  'ninja',
  'guard',
];

export const isBuildingType = (t: string): t is BuildingType => Object.hasOwn(BDEF, t);
export const isGeneralKind = (t: string): t is GeneralKind => Object.hasOwn(GDEF, t);
export const isAttackerKind = (t: string): t is AttackerKind => Object.hasOwn(ADEF, t);
