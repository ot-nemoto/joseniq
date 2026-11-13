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

// ホイールを送れる要素を渡し、Ctrl・Cmd の有無で盤面が受けるかを見る
function wheelOrbit() {
  let wheel: (e: Partial<WheelEvent>) => void = () => {};
  const el = {
    addEventListener: (type: string, fn: typeof wheel) => {
      if (type === 'wheel') wheel = fn;
    },
    clientHeight: 500,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 500 }),
  } as unknown as HTMLElement;
  const o = new Orbit(el);
  const send = (keys: Partial<WheelEvent>) => {
    let prevented = false;
    wheel({ clientX: 250, clientY: 250, deltaY: -100, preventDefault: () => (prevented = true), ...keys });
    return prevented;
  };
  return { o, send };
}

describe('盤面のホイール（Orbit）', () => {
  it('Ctrl も Cmd も押していなければ、寄らず、ページの送りを止めない', () => {
    const { o, send } = wheelOrbit();
    expect(send({ ctrlKey: false, metaKey: false })).toBe(false);
    expect(o.zoom).toBe(1);
  });
  it.each([
    ['Ctrl', { ctrlKey: true, metaKey: false }],
    ['Cmd', { ctrlKey: false, metaKey: true }],
  ])('%s を押していれば寄り、ブラウザの拡大を止める', (_, keys) => {
    const { o, send } = wheelOrbit();
    expect(send(keys)).toBe(true);
    expect(o.zoom).toBeGreaterThan(1);
  });
});

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
  it('方位の針を押すと、回した盤面が初めの向きに戻る', () => {
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

  it('方位の針の向き（az）は、カメラから見て北（盤面の上）が画面に見える向きと合う', () => {
    // apply がカメラを置いた所を受け取り、見る先から見たカメラの向きで、北が画面の上から時計回りに何度に見えるかを求める
    const o = new Orbit(stub);
    let px = 0;
    let pz = 0;
    const cam = {
      position: {
        set(x: number, _y: number, z: number) {
          px = x;
          pz = z;
        },
      },
      up: { set() {} },
      lookAt() {},
      updateProjectionMatrix() {},
      updateMatrixWorld() {},
    };
    for (const az of [Math.PI / 4, 0, 1, -2, Math.PI + 0.3]) {
      o.az = az;
      o.apply(cam as never, 1.5, 0);
      // 画面の奥（前）は、カメラから見る先への向き。画面の右は、その前を時計回りに90度回した向き (-fy, fx)（盤面の y は南が正）
      const len = Math.hypot(o.tx - px, o.ty - pz);
      const fx = (o.tx - px) / len;
      const fy = (o.ty - pz) / len;
      const ry = fx;
      // 北 (0, -1) の、画面の上・右への成分
      const up = -fy;
      const right = -ry;
      const ang = Math.atan2(right, up);
      expect(Math.cos(ang)).toBeCloseTo(Math.cos(az));
      expect(Math.sin(ang)).toBeCloseTo(Math.sin(az));
    }
  });
});
