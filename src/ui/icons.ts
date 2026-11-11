// パネルや比較の画面のボタンに出す施設の絵。盤面と同じ3Dの形（models.ts）を、斜め上から小さく写す。
// 盤面とは別の小さな描画を1つ持ち、施設・大きさ・配色ごとに一度だけ描いて使い回す
import {
  Box3,
  BoxGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  type Object3D,
  OrthographicCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { BuildingType } from '../sim';
import { ART, buildModel, LINK, type Look } from './models';

// ボタンに絵を出す道具：施設と堀
export type IconKind = BuildingType | 'moat';

// 堀の絵の形：両岸の地面のあいだを掘り下げて水を張り、岸を切り石で舗装して縁石を立てる（盤面の堀と同じ見た目）
const ground = new MeshLambertMaterial({ color: '#cfc6a4' });
const paved = new MeshLambertMaterial({ color: ART.paved });
const bed = new MeshLambertMaterial({ color: ART.bank });
const water = new MeshLambertMaterial({ color: '#4f86a8', transparent: true, opacity: 0.85 });
function buildMoatIcon(): Object3D {
  const g = new Group();
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: MeshLambertMaterial) => {
    const b = new Mesh(new BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    g.add(b);
  };
  // 水路は z の向きに流れる。幅1マス、長さ1.4マス。両岸は幅0.45の地面
  const len = 1.4;
  box(0.45, 0.3, len, -0.725, -0.15, 0, ground);
  box(0.45, 0.3, len, 0.725, -0.15, 0, ground);
  box(1, 0.05, len, 0, -0.325, 0, bed);
  // 岸の切り石の壁と、陸の側の縁石
  for (const sx of [-1, 1]) {
    box(0.04, 0.3, len, sx * 0.48, -0.15, 0, paved);
    box(0.16, 0.07, len, sx * 0.58, 0.035, 0, paved);
  }
  box(0.92, 0.04, len, 0, -0.12, 0, water);
  return g;
}

export function createIconRenderer() {
  let gl: WebGLRenderer | null = null;
  const scene = new Scene();
  scene.add(new HemisphereLight('#f4f7ff', '#b8a684', 1.7));
  const sun = new DirectionalLight('#fff3dc', 1.9);
  sun.position.set(6, 6, 3);
  scene.add(sun);
  const camera = new OrthographicCamera();
  const made = new Map<string, HTMLCanvasElement>();

  // 施設（または堀）type の絵を target に描く。look は配色（石垣と金）
  return function drawIcon(target: HTMLCanvasElement, type: IconKind, look: Look) {
    const c = target.getContext('2d');
    if (!c) return;
    const key = `${type}|${target.width}x${target.height}|${look.wall}|${look.wallDk}|${look.gold}`;
    let img = made.get(key);
    if (!img) {
      gl ??= new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      gl.setPixelRatio(1);
      gl.setSize(target.width, target.height, false);
      // 本丸は2×2、城壁は左右へつながる形で写す。堀は水路の形
      const model =
        type === 'moat'
          ? buildMoatIcon()
          : buildModel(type, type === 'hall' ? 2 : 1, type === 'hall' ? 2 : 1, look, {
              links: type === 'wall' ? LINK.e | LINK.w : 0,
            });
      scene.add(model);
      // 斜め上（盤面の初めの向き）から見て、絵の大きさに収まるよう写す範囲を決める
      const dir = new Vector3(1, 0.85, 1).normalize();
      const box = new Box3().setFromObject(model);
      const center = box.getCenter(new Vector3());
      camera.position.copy(center).addScaledVector(dir, 20);
      camera.up.set(0, 1, 0);
      camera.lookAt(center);
      camera.updateMatrixWorld();
      const inv = camera.matrixWorldInverse;
      const lo = new Vector3(Infinity, Infinity, Infinity);
      const hi = new Vector3(-Infinity, -Infinity, -Infinity);
      for (let i = 0; i < 8; i++) {
        const p = new Vector3(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z,
        ).applyMatrix4(inv);
        lo.min(p);
        hi.max(p);
      }
      const half = Math.max(hi.x - lo.x, hi.y - lo.y) / 2 / 0.9; // 縁に少し余白を残す
      const mx = (hi.x + lo.x) / 2;
      const my = (hi.y + lo.y) / 2;
      Object.assign(camera, { left: mx - half, right: mx + half, top: my + half, bottom: my - half, near: 1, far: 60 });
      camera.updateProjectionMatrix();
      gl.render(scene, camera);
      scene.remove(model);
      // 写したら形は使わないので捨てる（材質は盤面と使い回すので残す）
      model.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        o.geometry.dispose();
      });
      img = document.createElement('canvas');
      img.width = target.width;
      img.height = target.height;
      img.getContext('2d')?.drawImage(gl.domElement, 0, 0);
      made.set(key, img);
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, target.width, target.height);
    c.drawImage(img, 0, 0);
  };
}
