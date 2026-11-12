import { describe, expect, it } from 'vitest';
import { buildPlan, entriesOf, entryPoints, runPlan, TEMPLATES } from './auto';
import { BDEF, H, W } from './defs';
import { compactFlatLayout } from './simField';

// 計測専用フィールド（物差し）の形が崩れていないことだけを確かめる。
// 勝敗や時間はパラメータ調整で変わるので、テストにはしない（battle.test.ts の方針と同じ）
describe('計測フィールド（平城コンパクト）', () => {
  it('施設の数が設計どおりで、盤面からはみ出さず、重ならない', () => {
    const lay = compactFlatLayout();
    const cnt = new Map<string, number>();
    const tiles = new Set<string>();
    for (const b of lay.buildings) {
      cnt.set(b.type, (cnt.get(b.type) ?? 0) + 1);
      const d = BDEF[b.type];
      for (let dx = 0; dx < d.w; dx++) {
        for (let dy = 0; dy < d.h; dy++) {
          const x = b.x + dx;
          const y = b.y + dy;
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThan(W);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThan(H);
          const key = `${x},${y}`;
          expect(tiles.has(key)).toBe(false);
          tiles.add(key);
        }
      }
    }
    expect(Object.fromEntries(cnt)).toEqual({
      hall: 1,
      gate: 3,
      wall: 80,
      tbow: 12,
      tgun: 5,
      cata: 4,
      drum: 4,
    });
    expect(lay.generals).toEqual([]);
  });

  it('編成例で戦いが最後まで進み、同じ条件では結果が同じ（決定論）', () => {
    const lay = compactFlatLayout();
    const eps = entryPoints(lay);
    const tpl = TEMPLATES[0];
    const plan = buildPlan(tpl, entriesOf(tpl, eps, 1));
    const a = runPlan(lay, plan);
    const b = runPlan(lay, plan);
    expect(a.over).toBe(true);
    expect(a.result).toBe(b.result);
    expect(a.endT).toBe(b.endT);
    expect(a.stats.spent).toBeGreaterThan(0); // 出撃が起きたことだけを見る
  });
});
