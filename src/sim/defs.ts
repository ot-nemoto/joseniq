// ---- 定数 ---------------------------------------------------------------
export const W = 32;
export const H = 32;
export const RING = 1;
export const ZONE = { x0: 1, y0: 1, x1: W - 2, y1: H - 2 } as const; // 防衛を配置できる30×30マス
export const ZW = ZONE.x1 - ZONE.x0 + 1;
export const HALL = { x: W / 2 - 1, y: H / 2 - 1, w: 2, h: 2 } as const; // 本丸（2×2）は中央に固定
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
export const TIME_LIMIT = 150;
export const BUDGET_A = 60; // 攻撃側の兵力

export type BuildingType = 'wall' | 'moat' | 'bar' | 'tbow' | 'tgun' | 'cata' | 'drum' | 'hall';
export type GeneralKind = 'brave' | 'archer' | 'sage';
export type AttackerKind = 'inf' | 'arc' | 'cav' | 'ram' | 'eng' | 'shd' | 'scout' | 'brave' | 'archer' | 'sage';
export type PlaceTool = Exclude<BuildingType, 'hall'> | GeneralKind;
export type Tool = PlaceTool | 'erase';

// 種別ごとの配置上限
export const LIMITS: Record<PlaceTool, number> = {
  wall: 160,
  moat: 100,
  bar: 60,
  tbow: 16,
  tgun: 6,
  cata: 4,
  drum: 3,
  brave: 1,
  archer: 1,
  sage: 1,
};

export interface BuildingDef {
  name: string;
  hp: number;
  w: number;
  h: number;
  terrain?: boolean;
  tower?: boolean;
  range?: number;
  minRange?: number;
  dmg?: number;
  cd?: number;
  splash?: number;
  aura?: number;
  rate?: number;
}
// 将（猛将・弓将・軍師）の能力は攻撃側・防衛側で共通
export interface GeneralStats {
  name: string;
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
export interface AttackerDef {
  name: string;
  glyph: string;
  cost: number;
  hp: number;
  dmg: number;
  cd: number;
  speed: number;
  range: number;
  fac: number; // 対施設（城壁・櫓・投石機・鼓楼）への倍率
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
  wall: { name: '城壁', hp: 360, w: 1, h: 1 },
  moat: { name: '堀', hp: 0, w: 1, h: 1, terrain: true },
  bar: { name: '拒馬', hp: 0, w: 1, h: 1, terrain: true },
  tbow: { name: '櫓（弓）', hp: 480, w: 1, h: 1, range: 6.5, dmg: 26, cd: 1.0, tower: true },
  tgun: { name: '櫓（鉄砲）', hp: 420, w: 1, h: 1, range: 9, dmg: 70, cd: 3.0, tower: true },
  cata: { name: '投石機', hp: 400, w: 1, h: 1, range: 11, minRange: 3.5, dmg: 55, cd: 4.0, splash: 1.6, tower: true },
  drum: { name: '鼓楼', hp: 380, w: 1, h: 1, aura: 6.5, rate: 1.3 },
  hall: { name: '本丸', hp: 5200, w: HALL.w, h: HALL.h },
};
// 将は兵より大幅に強い。3将をどう使うかが勝敗の鍵
const GENERALS: Record<GeneralKind, GeneralStats> = {
  brave: { name: '猛将', glyph: '猛', hp: 2600, dmg: 80, cd: 0.8, speed: 2.0, range: 0.9, cleave: 1.2 },
  archer: { name: '弓将', glyph: '弓', hp: 1300, dmg: 60, cd: 0.9, speed: 1.8, range: 7.0 },
  sage: {
    name: '軍師',
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
};
export const GDEF: Record<GeneralKind, GeneralDef> = {
  brave: { ...GENERALS.brave, aggro: 10.0, leash: 9 },
  archer: { ...GENERALS.archer, aggro: 12.0, leash: 5 },
  sage: { ...GENERALS.sage, aggro: 13.0, leash: 4 },
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
    hall: 1.5,
    pref: 'hall',
    noUnits: true,
  },
  // 城壁と櫓を壊して道を開く。本丸には弱い
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
];

export const isBuildingType = (t: string): t is BuildingType => Object.hasOwn(BDEF, t);
export const isGeneralKind = (t: string): t is GeneralKind => Object.hasOwn(GDEF, t);
export const isAttackerKind = (t: string): t is AttackerKind => Object.hasOwn(ADEF, t);
