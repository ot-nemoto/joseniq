// 3Dのカメラの向きと、マウスでの回し方。
// 右ドラッグで回す（左右で向き、上下で見下ろす角度）、中ドラッグ（または Shift＋右ドラッグ）で見る先を動かす、
// ホイールで寄る・引く。左ボタンは配置の操作に使うので、空いている所を押したときだけ app.ts から begin で回し始める
import type { PerspectiveCamera } from 'three';
import { clamp, H, W } from '../sim';

const AZ0 = Math.PI / 4; // 初めの向き：南東（盤面の右下）から見る
const EL0 = 0.58; // 初めの見下ろす角度（ラジアン）
const EL_MIN = 0.32;
const EL_MAX = 1.4;
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 4;
export const VIEW_HALF = 15.5; // 寄る・引くの倍率が1のときの、見る先での画面の縦の半分（マス）
// 画角（度）。遠いものほど小さく描き、奥がすぼまって見えるようにする。狭めにして、平行に近い見やすさを残す
const FOV = 30;

export class Orbit {
  az = AZ0;
  el = EL0;
  zoom = 1;
  tx = W / 2; // 見る先（盤面の座標）
  ty = H / 2;
  // 向きを戻すときの行き先。少しずつ近づける
  private goal: { az: number; el: number; zoom: number; tx: number; ty: number } | null = null;
  private last = 0; // 前に当てた時刻（ミリ秒）。行き先へ近づく量を、画面の速さによらず時間で決める
  private drag: { id: number; x: number; y: number; pan: boolean } | null = null;

  constructor(private readonly el0: HTMLElement) {
    el0.addEventListener('pointerdown', (e) => {
      if (e.button !== 1 && e.button !== 2) return;
      e.preventDefault();
      this.begin(e, e.button === 1 || e.shiftKey);
    });
    el0.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      d.x = e.clientX;
      d.y = e.clientY;
      if (d.pan) this.pan(dx, dy);
      else {
        this.az -= dx * 0.008;
        this.el = clamp(this.el + dy * 0.005, EL_MIN, EL_MAX);
      }
    });
    const end = (e: PointerEvent) => {
      if (this.drag?.id === e.pointerId) this.drag = null;
    };
    el0.addEventListener('pointerup', end);
    el0.addEventListener('pointercancel', end);
    // 右ボタンのメニューは出さない（回すのに使う）
    el0.addEventListener('contextmenu', (e) => e.preventDefault());
    el0.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.goal = null;
        const r = el0.getBoundingClientRect();
        // マウスの下の地面が動かないよう、寄る分だけ見る先をそちらへずらす
        const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
        const ny = 1 - ((e.clientY - r.top) / r.height) * 2;
        const z0 = this.zoom;
        const z1 = clamp(z0 * Math.exp(-e.deltaY * 0.0015), ZOOM_MIN, ZOOM_MAX);
        const half = VIEW_HALF;
        const k = 1 / z0 - 1 / z1;
        this.move(nx * half * (r.width / r.height) * k, ny * half * k);
        this.zoom = z1;
      },
      { passive: false },
    );
  }
  // 押した所からドラッグで回し始める（pan なら見る先を動かす）
  begin(e: PointerEvent, pan = false) {
    this.goal = null;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, pan };
    try {
      this.el0.setPointerCapture(e.pointerId);
    } catch {
      // 無視
    }
  }
  // 回しているか、見る先を動かしている途中か（その間は、配置の操作をしない）
  get busy() {
    return this.drag !== null;
  }
  // 画面の右へ sx、上へ sy（どちらもマス）だけ、見る先を動かす
  private move(sx: number, sy: number) {
    const c = Math.cos(this.az);
    const s = Math.sin(this.az);
    const g = sy / Math.sin(this.el);
    this.tx = clamp(this.tx + c * sx - s * g, 0, W);
    this.ty = clamp(this.ty - s * sx - c * g, 0, H);
  }
  // ドラッグした分だけ、地面をつかんで動かす
  private pan(dx: number, dy: number) {
    const per = (2 * VIEW_HALF) / this.zoom / this.el0.clientHeight; // 1ピクセルあたりのマス
    this.move(-dx * per, dy * per);
  }
  // 初めの向きに戻す
  reset() {
    const q = Math.round((this.az - AZ0) / (2 * Math.PI));
    this.goal = { az: AZ0 + q * 2 * Math.PI, el: EL0, zoom: 1, tx: W / 2, ty: H / 2 };
  }
  // 画面の矢印の向き (dx, dy)（右・下が正）を、盤面のマスの向きに直す。今の向きに近い90度ごとの向きで決める
  arrow(dx: number, dy: number): [number, number] {
    const q = (((Math.round((this.az - AZ0) / (Math.PI / 2)) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
    let x = dx;
    let y = dy;
    for (let i = 0; i < q; i++) [x, y] = [y, -x];
    return [x, y];
  }
  // カメラに今の向きを当てる。aspect は画面の横÷縦
  // now は今の時刻（ミリ秒）
  apply(cam: PerspectiveCamera, aspect: number, now = performance.now()) {
    const dt = Math.min(0.25, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const g = this.goal;
    if (g) {
      const k = 1 - Math.exp(-dt * 12); // 0.4秒ほどでほぼ着く
      this.az += (g.az - this.az) * k;
      this.el += (g.el - this.el) * k;
      this.zoom += (g.zoom - this.zoom) * k;
      this.tx += (g.tx - this.tx) * k;
      this.ty += (g.ty - this.ty) * k;
      if (Math.abs(g.az - this.az) < 1e-3 && Math.abs(g.el - this.el) < 1e-3 && Math.abs(g.zoom - this.zoom) < 1e-3) {
        Object.assign(this, { az: g.az, el: g.el, zoom: g.zoom, tx: g.tx, ty: g.ty });
        this.goal = null;
      }
    }
    // 見る先で、画面の縦の半分が VIEW_HALF ÷ 倍率 になる距離から見る
    const dist = VIEW_HALF / Math.tan((FOV * Math.PI) / 360) / this.zoom;
    cam.fov = FOV;
    cam.aspect = aspect;
    cam.near = Math.max(0.5, dist - 70);
    cam.far = dist + 70;
    const ce = Math.cos(this.el);
    cam.position.set(
      this.tx + dist * ce * Math.sin(this.az),
      dist * Math.sin(this.el),
      this.ty + dist * ce * Math.cos(this.az),
    );
    cam.up.set(0, 1, 0);
    cam.lookAt(this.tx, 0, this.ty);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }
}
