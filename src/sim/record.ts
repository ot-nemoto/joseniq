// ---- 出撃記録 -----------------------------------------------------------
// 前の形の出撃記録（配置と、出撃したティック・兵種・マスの一覧）から、出撃の一覧を読む。
// 攻城配置の出撃記録（口と予定）を読めなかったときに、こちらで読んで予定にまとめる
import type { PlanStep } from './auto';
import { canCarry, H, isAttackerKind, isItemKind, W } from './defs';
import { isInt, isRecord } from './geometry';

export function parseDeploys(o: unknown): PlanStep[] | null {
  if (!isRecord(o) || !Array.isArray(o.deploys)) return null;
  const deploys: PlanStep[] = [];
  let last = 0;
  for (const d of o.deploys as unknown[]) {
    if (!isRecord(d) || typeof d.kind !== 'string' || !isAttackerKind(d.kind)) return null;
    if (!isInt(d.tick) || !isInt(d.x) || !isInt(d.y) || d.tick < last) return null;
    if (d.x < 0 || d.y < 0 || d.x >= W || d.y >= H) return null;
    // アイテムは、知らない種類や、持てない兵に持たせていれば読み込まない
    if (d.item !== undefined && (typeof d.item !== 'string' || !isItemKind(d.item) || !canCarry(d.kind, d.item)))
      return null;
    last = d.tick;
    const p: PlanStep = { tick: d.tick, kind: d.kind, x: d.x, y: d.y };
    if (d.item) p.item = d.item;
    deploys.push(p);
  }
  return deploys.length ? deploys : null;
}
