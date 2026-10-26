// ======================================================================
// 地図の型：城ごとの地形の高さ。施設とは別の層で、配置データの heights に入れる
// あとで、自由に変えたりランダムに作ったりできるよう、高さの並び（W×H）だけを返す形にしておく
// ======================================================================
import { H, W } from './defs';

export const MAPS = [
  { id: 'flat', name: '平城' }, // 平らな盤面
  { id: 'hirayama', name: '平山城' }, // 中央が小高い丘
] as const;
export type MapId = (typeof MAPS)[number]['id'];
export const isMapId = (v: unknown): v is MapId => MAPS.some((m) => m.id === v);

// 地図の型の高さ。平城は平らなので undefined（高さを持たない）
export function mapHeights(id: MapId): number[] | undefined {
  if (id === 'flat') return undefined;
  // 平山城：中央の10×10マスを2段、そのまわりの外郭のあたりまでを1段にする。
  // 北側だけ1段の帯をなくし、2段の高台と平地が直に接する崖にする（数値と形は仮）
  const hs: number[] = [];
  const c = W / 2 - 0.5;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = Math.max(Math.abs(x - c), Math.abs(y - c));
      const northBand = y < c && d > 5 && d <= 9.5 && Math.abs(x - c) <= 5;
      hs.push(d <= 5 ? 2 : d <= 9.5 && !northBand ? 1 : 0);
    }
  return hs;
}
