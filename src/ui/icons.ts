// パネルや比較の画面のボタンに出す施設の絵。盤面と同じ3Dの形（models.ts）を、斜め上から小さく写す。
// 盤面とは別の小さな描画を1つ持ち、施設・大きさ・配色ごとに一度だけ描いて使い回す
import {
  Box3,
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshPhongMaterial,
  OrthographicCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { BuildingType } from '../sim';
import { ART, buildModel, LINK, type Look, mat } from './models';
import { pattern } from './textures';

// 堀の絵：石の岸に囲まれた、さざ波の立つ水面（盤面では地面を掘り下げて作るので、絵のためだけに作る）
function moatModel(look: Look, water: string) {
  const g = new Group();
  const bank = mat(ART.bank, { pattern: 'stone' });
  for (const [w, d, x, z] of [
    [1, 0.12, 0, -0.44],
    [1, 0.12, 0, 0.44],
    [0.12, 0.76, -0.44, 0],
    [0.12, 0.76, 0.44, 0],
  ]) {
    const geo = new BoxGeometry(w, 0.22, d);
    geo.translate(x, 0.11, z);
    g.add(new Mesh(geo, bank));
  }
  const floor = new BoxGeometry(0.76, 0.04, 0.76);
  floor.translate(0, 0.02, 0);
  g.add(new Mesh(floor, mat(look.wallDk)));
  const surface = new BoxGeometry(0.76, 0.02, 0.76);
  surface.translate(0, 0.15, 0);
  g.add(
    new Mesh(
      surface,
      new MeshPhongMaterial({
        color: new Color(water),
        shininess: 90,
        specular: new Color('#ffffff'),
        normalMap: pattern('water').normal,
      }),
    ),
  );
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

  // 施設 type の絵を target に描く。look・water は配色（石垣と金、堀の水の色）
  return function drawIcon(target: HTMLCanvasElement, type: BuildingType, look: Look, water: string) {
    const c = target.getContext('2d');
    if (!c) return;
    const key = `${type}|${target.width}x${target.height}|${look.wall}|${look.wallDk}|${look.gold}|${water}`;
    let img = made.get(key);
    if (!img) {
      gl ??= new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      gl.setPixelRatio(1);
      gl.setSize(target.width, target.height, false);
      // 本丸は2×2、城壁は左右へつながる形で写す
      const model =
        type === 'moat'
          ? moatModel(look, water)
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
      // 写したら形は使わないので捨てる（材質は盤面と使い回すので残す。堀の水面の材質だけは、この絵のために作ったので捨てる）
      model.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        o.geometry.dispose();
        if (type === 'moat' && o.material instanceof MeshPhongMaterial) o.material.dispose();
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
