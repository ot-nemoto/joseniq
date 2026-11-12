// 武将と兵の見た目の表（武器・家紋）と、家紋と炎のドットの模様。駒の絵は bigBusho.ts
import type { AttackerKind } from '../sim';

export const SPR_UNIT = 24; // 1マスに対するドットの数の目安（ドットの大きさを決める）

// baton は近くを打つ軍配
type Weapon = 'sword' | 'spear' | 'bow' | 'gun' | 'baton' | 'mallet' | 'shield' | 'none';
export interface Spec {
  weapon: Weapon;
  skill?: Weapon; // スキルで使う武器（ふだんの武器と違うとき）。飛び道具のスキルは、矢・弾の出る所をこの武器で決める
  mon?: string; // 幟の家紋（MON_PIX の名前）。幟を持つのは武将だけ
  cart?: boolean; // 衝車：人の形ではなく、屋根の付いた車と丸太
}
const SPECS: Record<AttackerKind, Spec> = {
  brave: { weapon: 'sword', mon: 'bi' }, // 上杉謙信
  archer: { weapon: 'spear', skill: 'bow', mon: 'chigaiya' }, // 大島光義（ふだんは槍、スキルで弓）
  sage: { weapon: 'baton', mon: 'rokumon' }, // 真田昌幸（ふだんは軍配で打ち、スキルの火計で軍配を掲げて指す）
  rider: { weapon: 'baton', mon: 'hishi' }, // 武田信玄（ふだんは軍配で打ち、スキルで軍配を掲げて騎兵を呼ぶ）
  gunner: { weapon: 'spear', skill: 'gun', mon: 'mokko' }, // 織田信長（ふだんは槍、スキルで鉄砲）
  builder: { weapon: 'sword', mon: 'kiri' }, // 豊臣秀吉
  guard: { weapon: 'baton', mon: 'aoi' }, // 徳川家康
  inf: { weapon: 'spear' }, // 歩兵
  arc: { weapon: 'bow' }, // 弓兵
  cav: { weapon: 'spear' }, // 騎兵
  ram: { weapon: 'none', cart: true }, // 衝車
  eng: { weapon: 'mallet' }, // 工兵
  shd: { weapon: 'shield' }, // 盾兵
};
export const specOf = (k: AttackerKind): Readonly<Spec> => SPECS[k];
// 撃つ飛び道具の武器（鉄砲か弓）。ふだんの武器が飛び道具でなければ、スキルの武器を見る。どちらでもなければ null
export const shotWeapon = (k: AttackerKind): 'gun' | 'bow' | null => {
  for (const w of [SPECS[k].weapon, SPECS[k].skill]) if (w === 'gun' || w === 'bow') return w;
  return null;
};

// 幟の家紋・旗印（幅8×高さ9まで）。縮めると潰れるので、ドットで描いておく
const MON_PIX: Record<string, string[]> = {
  bi: ['KKKKK..', 'K.K.K..', 'KKKKK..', 'K.K.K..', 'KKKKK..', 'K..K...', 'KK.KK.K', 'K..K..K', 'KKKKKKK'],
  mokko: ['..KKK..', '.K...K.', 'K.KKK.K', 'K.K.K.K', 'K.KKK.K', '.K...K.', '..KKK..'],
  chigaiya: ['K.....K', '.K...K.', '..K.K..', '...K...', '..K.K..', '.K...K.', 'KK...KK'],
  rokumon: ['KK.KK.KK', 'KK.KK.KK', '........', 'KK.KK.KK', 'KK.KK.KK'],
  hishi: ['...K...', '..KKK..', '.K.K.K.', 'KKK.KKK', '.K.K.K.', '..KKK..', '...K...'],
  kiri: ['.K.K.K.', '.K.K.K.', 'K.KKK.K', '.K.K.K.', '...K...', 'KK.K.KK', 'KKKKKKK', '.KK.KK.', '...K...'], // 五七の桐
  aoi: ['..KKK..', '.K.K.K.', 'K.KKK.K', 'K..K..K', 'K.K.K.K', '.KK.KK.', '..KKK..'],
};
// 武将の幟の家紋と、その模様（兵は幟を持たないので空）
export const bushoMon = (kind: AttackerKind) => {
  const mon = SPECS[kind].mon ?? '';
  return { mon, pix: MON_PIX[mon] ?? [] };
};

// 火計を受けて燃える炎（7×10ドット）。3コマを順に替えて揺らす
const FLAME_PIX = [
  ['...E...', '...EE..', '..EOE..', '..EOOE.', '.EOYOE.', '.EOYYOE', 'EOYYYOE', 'EOYYYOE', '.EOYYE.', '..EEE..'],
  ['..E....', '..EE...', '.EOE...', '.EOOE..', '.EOYOE.', 'EOYYOE.', 'EOYYYOE', 'EOYYYOE', '.EOYOE.', '..EEE..'],
  ['....E..', '...EE..', '...EOE.', '..EOOE.', '.EOYOE.', '.EOYYOE', 'EOYYYOE', 'EOYYYOE', '.EOYOE.', '..EEE..'],
];
export const FLAME_FRAMES = FLAME_PIX.length;
export const FLAME_W = 7;
export const FLAME_H = 10;
const FLAME_COLORS: Record<string, string> = { E: '#d2401e', O: '#f08a2a', Y: '#ffe27a' }; // 外側・中・芯
const flames = new Map<number, HTMLCanvasElement>();
export function flameSprite(i: number): HTMLCanvasElement {
  let c = flames.get(i);
  if (!c) {
    c = document.createElement('canvas');
    c.width = FLAME_W;
    c.height = FLAME_H;
    const x2 = c.getContext('2d');
    FLAME_PIX[i].forEach((row, y) => {
      [...row].forEach((code, x) => {
        if (!x2 || code === '.') return;
        x2.fillStyle = FLAME_COLORS[code];
        x2.fillRect(x, y, 1, 1);
      });
    });
    flames.set(i, c);
  }
  return c;
}
