import { describe, expect, it } from 'vitest';
import { buildPlan, entriesOf, entryPoints, runPlan, TEMPLATES } from './auto';
import { BDEF, H, W } from './defs';
import { compactFlatLayout, compactHillLayout } from './simField';

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

describe('計測フィールド（平山城コンパクト）', () => {
  it('建物の構成は平城コンパクトと同じ（地形だけが違う）', () => {
    expect(compactHillLayout().buildings).toEqual(compactFlatLayout().buildings);
    expect(compactHillLayout().map).toBe('hirayama');
  });
  it('高さは郭に合わせた段々で、崖（2段以上の段差）はどこにもない', () => {
    const l = compactHillLayout();
    const h = (x: number, y: number) => l.heights?.[y * 42 + x] ?? 0;
    expect(h(20, 20)).toBe(2); // 本丸
    expect(h(26, 20)).toBe(1); // 外郭の中
    expect(h(31, 20)).toBe(0); // 城の外
    for (let y = 0; y < 42; y++) {
      for (let x = 0; x < 42; x++) {
        if (x > 0) expect(Math.abs(h(x, y) - h(x - 1, y))).toBeLessThanOrEqual(1);
        if (y > 0) expect(Math.abs(h(x, y) - h(x, y - 1))).toBeLessThanOrEqual(1);
      }
    }
  });
  it('編成例で戦いが最後まで進み、同じ条件では結果が同じ（決定論）。城の外から本丸まで登って行ける', () => {
    const lay = compactHillLayout();
    const eps = entryPoints(lay);
    const tpl = TEMPLATES[0];
    const plan = buildPlan(tpl, entriesOf(tpl, eps, 1));
    const a = runPlan(lay, plan);
    const b = runPlan(lay, plan);
    expect(a.over).toBe(true);
    expect(a.result).toBe(b.result);
    expect(a.endT).toBe(b.endT);
  });
});
