import { describe, expect, it } from 'vitest';
import { Orbit } from './orbit';

// マウスの操作はここでは使わないので、受け付けるだけの要素を渡す
const stub = { addEventListener: () => {}, clientHeight: 500 } as unknown as HTMLElement;

// 盤面の向き (x, y) が、今の向きのカメラで画面のどちらを向くか（右・上が正）
function onScreen(o: Orbit, x: number, y: number): [number, number] {
  const c = Math.cos(o.az);
  const s = Math.sin(o.az);
  return [Math.round((x * c - y * s) * 100) / 100, Math.round(-(x * s + y * c) * 100) / 100];
}

describe('盤面の向き（Orbit）', () => {
  it('90度ずつ回しても、矢印キーは画面の上で同じ向きにマスを動かす', () => {
    const o = new Orbit(stub);
    const arrows: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    const base = arrows.map(([dx, dy]) => onScreen(o, ...o.arrow(dx, dy)));
    const az0 = o.az;
    for (let q = -3; q <= 5; q++) {
      o.az = az0 + (q * Math.PI) / 2;
      expect(arrows.map(([dx, dy]) => onScreen(o, ...o.arrow(dx, dy)))).toEqual(base);
    }
  });
  it('90度に近い向きなら、ずれていても一番近い向きで決める', () => {
    const o = new Orbit(stub);
    const at = (az: number) => {
      o.az = az;
      return o.arrow(0, -1);
    };
    const a0 = o.az;
    expect(at(a0 + 0.3)).toEqual(at(a0));
    expect(at(a0 + Math.PI / 2 - 0.3)).toEqual(at(a0 + Math.PI / 2));
  });
  it('向きを戻すボタンで、回した盤面が初めの向きに戻る', () => {
    const o = new Orbit(stub);
    const cam = {
      position: { set() {} },
      up: { set() {} },
      lookAt() {},
      updateProjectionMatrix() {},
      updateMatrixWorld() {},
    };
    let t = 0;
    const settle = () => {
      for (let i = 0; i < 200; i++) {
        t += 16;
        o.apply(cam as never, 1.5, t);
      }
    };
    const a0 = o.az;
    o.az = a0 + Math.PI + 0.4;
    o.el = 1;
    o.zoom = 2;
    o.reset();
    settle();
    // 近い方へ回って戻すので、1周（360度）違っていても同じ向き
    expect(Math.cos(o.az)).toBeCloseTo(Math.cos(a0));
    expect(Math.sin(o.az)).toBeCloseTo(Math.sin(a0));
    expect(o.zoom).toBe(1);
  });
});
