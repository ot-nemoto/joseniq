// ---- 出撃記録 -----------------------------------------------------------
// 前の形の出撃記録（配置と、出撃したティック・兵種・マスの一覧）から、出撃の一覧を読む。
// 攻城配置の出撃記録（口と予定）を読めなかったときに、こちらで読んで予定にまとめる
import type { PlanStep } from './auto';
import { H, isAttackerKind, isRemovedGeneral, W } from './defs';
import { isInt, isRecord } from './geometry';

export function parseDeploys(o: unknown): PlanStep[] | null {
  if (!isRecord(o) || !Array.isArray(o.deploys)) return null;
  const deploys: PlanStep[] = [];
  let last = 0;
  for (const d of o.deploys as unknown[]) {
    // 外した武将（前田利家・服部半蔵）の出撃は黙って飛ばす
    if (isRecord(d) && isRemovedGeneral(d.kind)) continue;
    if (!isRecord(d) || typeof d.kind !== 'string' || !isAttackerKind(d.kind)) return null;
    if (!isInt(d.tick) || !isInt(d.x) || !isInt(d.y) || d.tick < last) return null;
    if (d.x < 0 || d.y < 0 || d.x >= W || d.y >= H) return null;
    last = d.tick;
    deploys.push({ tick: d.tick, kind: d.kind, x: d.x, y: d.y });
  }
  return deploys.length ? deploys : null;
}
