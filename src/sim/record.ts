// ---- 出撃記録 -----------------------------------------------------------
// 戦闘は決定的なので、配置と出撃（ティック・兵種・マス）が同じなら同じ結果になる。
import type { AutoState, PlanStep } from './auto';
import type { Battle, BattleResult } from './battle';
import { H, isAttackerKind, W } from './defs';
import { type Layout, validate } from './layout';

export interface BattleRecord {
  version: 1;
  layout: Layout;
  auto: boolean; // 自動攻城の記録か（終わり方が手動と違う）
  deploys: PlanStep[];
  result: BattleResult | null;
  endTick: number;
}

export function makeRecord(layout: Layout, s: Battle, auto: boolean): BattleRecord {
  return {
    version: 1,
    layout,
    auto,
    deploys: s.deployLog.map(({ tick, kind, x, y }) => ({ tick, kind, x, y })),
    result: s.over ? s.result : null,
    endTick: s.over ? s.tick : 0,
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isInt = (v: unknown): v is number => Number.isInteger(v);
const RESULTS: readonly (BattleResult | null)[] = ['win', 'timeout', 'wipe', null];

export function parseRecord(o: unknown): BattleRecord | null {
  if (!isRecord(o) || o.version !== 1 || !Array.isArray(o.deploys)) return null;
  const layout = validate(o.layout);
  if (!layout) return null;
  const deploys: PlanStep[] = [];
  let last = 0;
  for (const d of o.deploys as unknown[]) {
    if (!isRecord(d) || typeof d.kind !== 'string' || !isAttackerKind(d.kind)) return null;
    if (!isInt(d.tick) || !isInt(d.x) || !isInt(d.y) || d.tick < last) return null;
    if (d.x < 0 || d.y < 0 || d.x >= W || d.y >= H) return null;
    last = d.tick;
    deploys.push({ tick: d.tick, kind: d.kind, x: d.x, y: d.y });
  }
  if (!deploys.length) return null;
  const result = RESULTS.find((r) => r === o.result) ?? null;
  return { version: 1, layout, auto: o.auto === true, deploys, result, endTick: isInt(o.endTick) ? o.endTick : 0 };
}

export const replayState = (r: BattleRecord): AutoState => ({ plan: r.deploys, i: 0, waitAfterPlan: !r.auto });

// 再生した戦いが記録と同じ結末になったか
export const sameOutcome = (r: BattleRecord, s: Battle) => r.result === s.result && r.endTick === s.tick;
