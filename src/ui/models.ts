// 3Dの建物の形（three.js）。施設の種類ごとに一度だけ作り、置くたびに複製して使い回す。
// 座標は、敷地の中心の地面を原点に、x・z を盤面の横・縦（1マス＝1）、y を高さにとる。
// 形は斜め表示の絵（石垣・壁の層・腰屋根・寄棟の屋根）をそのまま立体にしたもので、
// 寸法は「敷地の半分を k、高さを kz 倍」にした値で書く
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  Group,
  type Material,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BuildingType } from '../sim';

// 建物の絵の色。絵として見せるため、明暗の配色によらず固定にする
export const ART = {
  plaster: '#f5f1e6',
  dust: '#b9a888', // 武将が歩くときの土ぼこり
  board: '#34302c',
  roofEdge: '#323b43',
  wood: '#9a6a3c',
  woodDk: '#5e3d22',
  drum: '#a3412b',
  drumFace: '#eadcb8',
  weight: '#4a4440',
  bow: '#8a5426',
  stakeTip: '#e2cc9f',
  gun: '#1b1b1b',
  charred: '#2b2420', // 焼け残った柱（壊れた櫓）
  hill: '#a07c44', // 高台（1段）の土
  hill2: '#7a5a2c', // 高台（2段）の土
  rock: '#6b6358', // 崖の岩肌
  bronze: '#7a6337', // 大筒の筒（青銅）
  bronzeHi: '#b39556', // 大筒の筒の上側の照り
};
// 屋根の色。櫓は種類ごとに変えて見分けやすくする（弓は緑青、鉄砲は黒い瓦）
export interface RoofColor {
  fill: string;
  edge: string;
}
export const ROOF: Record<'tile' | 'green' | 'black', RoofColor> = {
  tile: { fill: '#64737f', edge: '#323b43' },
  green: { fill: '#5c9d8b', edge: '#2c5d51' },
  black: { fill: '#363b41', edge: '#131619' },
};
export const roofOf = (type: BuildingType) => (type === 'tbow' ? ROOF.green : type === 'tgun' ? ROOF.black : ROOF.tile);

// 配色に合わせて変わる色（石垣と金）
export interface Look {
  wall: string;
  wallDk: string;
  gold: string;
}

// ---- 材質 ------------------------------------------------------------------
// 色ごとに1つ作って使い回す。面は平らに塗る（箱の面の向きで陰が付く）
const mats = new Map<string, MeshLambertMaterial>();
export function mat(color: string, opts: { stone?: boolean; double?: boolean } = {}) {
  const key = `${color}|${opts.stone ? 's' : ''}${opts.double ? 'd' : ''}`;
  let m = mats.get(key);
  if (!m) {
    m = new MeshLambertMaterial({
      color: new Color(color),
      flatShading: true,
      map: opts.stone ? stoneTexture() : null,
      side: opts.double ? DoubleSide : FrontSide,
    });
    mats.set(key, m);
  }
  return m;
}
// 石垣の目地：白地に灰色の線で石を互い違いに積んだ模様。材質の色（石垣の色）を掛けて使う
let stoneTex: CanvasTexture | null = null;
function stoneTexture() {
  if (stoneTex) return stoneTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(0,0,0,0.38)';
    g.lineWidth = 2;
    g.beginPath();
    for (let r = 0; r < 4; r++) {
      const y = r * 16;
      g.moveTo(0, y);
      g.lineTo(64, y);
      for (let x = (r % 2) * 11; x < 64; x += 22) {
        g.moveTo(x, y);
        g.lineTo(x, y + 16);
      }
    }
    g.stroke();
  }
  stoneTex = new CanvasTexture(c);
  stoneTex.colorSpace = SRGBColorSpace;
  stoneTex.wrapS = stoneTex.wrapT = RepeatWrapping;
  stoneTex.repeat.set(2, 1);
  return stoneTex;
}

// ---- 形を作る道具 ------------------------------------------------------------
// k は敷地の半分、kz は高さの倍率。P(dx, dy, z) は、盤面の向き (dx, dy) と高さ z を、この建物の座標に直す
function kit(g: Group, k: number, kz: number) {
  const P = (dx: number, dy: number, z: number) => new Vector3(dx * k, z * kz, dy * k);
  function add(geo: BufferGeometry, m: Material | Material[]) {
    const mesh = new Mesh(geo, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  }
  // 四角い箱。横の半分は hx・hy、高さは z0〜z1、中心は (ox, oy)
  function box(hx: number, hy: number, z0: number, z1: number, color: string, ox = 0, oy = 0) {
    const geo = new BoxGeometry(2 * hx * k, (z1 - z0) * kz, 2 * hy * k);
    geo.translate(ox * k, ((z0 + z1) / 2) * kz, oy * k);
    return add(geo, mat(color));
  }
  // 上下で幅の違う四角い台（下の半分 h0、上の半分 h1）。4つの角の円柱で作る
  function frustum(h0: number, z0: number, h1: number, z1: number, m: Material, open = false) {
    const geo = new CylinderGeometry(h1 * k * Math.SQRT2, h0 * k * Math.SQRT2, (z1 - z0) * kz, 4, 1, open);
    geo.rotateY(Math.PI / 4);
    geo.translate(0, ((z0 + z1) / 2) * kz, 0);
    return add(geo, m);
  }
  // まっすぐな箱
  const prism = (h: number, z0: number, z1: number, color: string) => box(h, h, z0, z1, color);
  // 石垣：下が広く上がすぼまる。石の目地の模様を貼る
  const stoneBase = (look: Look, h0: number, h1: number, z1: number) =>
    frustum(h0, 0, h1, z1, mat(look.wall, { stone: true }));
  // 4つの面それぞれに同じ飾りを付ける。f には、面の上の横 a・高さ z・面からの出 o を、この建物の座標に直す関数を渡す
  function onFaces(h: number, f: (on: (a: number, z: number, o?: number) => Vector3, i: number) => void) {
    const dirs: [number, number, number, number][] = [
      [1, 0, 0, 1], // 右（+x）：面の横は +y の向き
      [0, 1, -1, 0], // 手前（+y）：面の横は -x の向き
      [-1, 0, 0, -1], // 左（-x）
      [0, -1, 1, 0], // 奥（-y）
    ];
    dirs.forEach(([nx, ny, ax, ay], i) => {
      f((a, z, o = 0) => P(nx * (h + o) + ax * a, ny * (h + o) + ay * a, z), i);
    });
  }
  // 面に貼る小さな板（窓や横木）。中心 c、面の横の幅 wa、高さ wz（どちらもこの建物の座標）
  function plate(c: Vector3, i: number, wa: number, wz: number, color: string, depth = 0.012) {
    const geo = i % 2 === 0 ? new BoxGeometry(depth, wz, wa) : new BoxGeometry(wa, wz, depth);
    geo.translate(c.x, c.y, c.z);
    return add(geo, mat(color));
  }
  // 壁の層：下の3割を下見板にし、窓を並べる。鉄砲櫓は壁を黒く、窓（狭間）を白くする
  function tier(h: number, z0: number, z1: number, windows: number, wall = ART.plaster, ink = ART.board) {
    prism(h, z0, z1, wall);
    box(h + 0.006, h + 0.006, z0, z0 + (z1 - z0) * 0.3, ART.board);
    const lo = z0 + (z1 - z0) * 0.48;
    const hi = z0 + (z1 - z0) * 0.82;
    onFaces(h, (on, i) => {
      for (let w = 0; w < windows; w++) {
        const a = -h + (2 * h * (w + 0.5)) / windows;
        plate(on(a, (lo + hi) / 2, 0.006), i, 0.24 * h * k, (hi - lo) * kz, ink);
      }
    });
  }
  // 腰屋根：軒（eave）から上の層の付け根（top）まで
  const skirtRoof = (rc: RoofColor, eave: number, z0: number, topH: number, z1: number) =>
    frustum(eave, z0, topH, z1, mat(rc.fill));
  // 最上段の寄棟の屋根：棟は左右（x方向）に通す。ridge が0なら尖った屋根。飾りは鯱か宝珠
  function topRoof(
    rc: RoofColor,
    look: Look,
    eave: number,
    z0: number,
    ridge: number,
    z1: number,
    ornament: 'shachi' | 'finial' | 'none',
  ) {
    const c = [P(-eave, -eave, z0), P(eave, -eave, z0), P(eave, eave, z0), P(-eave, eave, z0)];
    const r0 = P(-ridge, 0, z1);
    const r1 = P(ridge, 0, z1);
    const tris: Vector3[][] = [
      [c[0], r0, r1, c[1]], // 奥
      [c[2], r1, r0, c[3]], // 手前
      [c[3], r0, c[0]], // 左
      [c[1], r1, c[2]], // 右
      [c[0], c[1], c[2], c[3]], // 軒の裏
    ];
    add(polyGeo(tris), mat(rc.fill, { double: true }));
    if (ornament === 'shachi')
      for (const p of [r0, r1]) {
        const geo = new CylinderGeometry(0, 0.035 * k, 0.13 * kz, 5);
        geo.translate(p.x, p.y + 0.065 * kz, p.z);
        add(geo, mat(look.gold));
      }
    else if (ornament === 'finial') sphere(r0.clone().setY(r0.y + 0.02), 0.04, look.gold);
  }
  // 千鳥破風：4つの屋根の面に立つ三角の妻（off は中心からの位置、half は三角の半分の幅）
  function gables(off: number, half: number, z0: number, z1: number) {
    onFaces(off, (on) => {
      add(polyGeo([[on(-half, z0), on(half, z0), on(0, z1)]]), mat(ART.plaster, { double: true }));
    });
  }
  // 2点を結ぶ丸い棒
  function beam(a: Vector3, b: Vector3, color: string, r: number) {
    const d = b.clone().sub(a);
    const geo = new CylinderGeometry(r, r, d.length(), 6);
    geo.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d.clone().normalize()));
    const m = a.clone().add(b).multiplyScalar(0.5);
    geo.translate(m.x, m.y, m.z);
    return add(geo, mat(color));
  }
  function sphere(c: Vector3, r: number, color: string) {
    const geo = new SphereGeometry(r, 8, 6);
    geo.translate(c.x, c.y, c.z);
    return add(geo, mat(color));
  }
  // 円柱。軸は x（axis 'x'）か z（'z'）の向き
  function drum(c: Vector3, r: number, len: number, axis: 'x' | 'z', color: string, face?: string) {
    const geo = new CylinderGeometry(r, r, len, 14);
    geo.rotateZ(axis === 'x' ? Math.PI / 2 : 0);
    if (axis === 'z') geo.rotateX(Math.PI / 2);
    geo.translate(c.x, c.y, c.z);
    // 円柱の材質は、側面・上の面・下の面の順
    return add(geo, face ? [mat(color), mat(face), mat(face)] : mat(color));
  }
  return { P, box, prism, stoneBase, onFaces, plate, tier, skirtRoof, topRoof, gables, beam, sphere, drum };
}
// 多角形の面の並びから形を作る（多角形は扇形の三角に分ける）
function polyGeo(faces: Vector3[][]) {
  const pos: number[] = [];
  for (const f of faces)
    for (let i = 1; i + 1 < f.length; i++) for (const p of [f[0], f[i], f[i + 1]]) pos.push(p.x, p.y, p.z);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2)); // まとめるときにそろえる
  geo.computeVertexNormals();
  return geo;
}
// 同じ材質の部品を1つの形にまとめる（建物1つあたりの描く回数を減らす）。材質を面ごとに分けた部品（太鼓）はそのまま
function merged(g: Group): Group {
  const byMat = new Map<Material, BufferGeometry[]>();
  for (const o of [...g.children]) {
    if (!(o instanceof Mesh) || Array.isArray(o.material)) continue;
    const geo = o.geometry as BufferGeometry;
    const list = byMat.get(o.material) ?? [];
    list.push(geo.index ? geo.toNonIndexed() : geo);
    byMat.set(o.material, list);
    g.remove(o);
  }
  const out = new Group();
  for (const o of [...g.children]) out.add(o);
  for (const [m, geos] of byMat) {
    const geo = mergeGeometries(geos);
    for (const x of geos) x.dispose();
    if (!geo) continue;
    const mesh = new Mesh(geo, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    out.add(mesh);
  }
  return out;
}

// 建物の高さ（マス単位）。体力のバーをこの上に出す。ここにないもの（堀）は地面に描く
export const HEIGHT: Partial<Record<BuildingType, number>> = {
  wall: 0.7,
  gate: 0.95,
  tbow: 1.42,
  tgun: 1.3,
  cata: 1.3,
  drum: 1.12,
  hall: 2.46,
  bar: 0.5,
};

// 種類ごとの建物の形。fw・fh は敷地の大きさ、dir は拒馬の横木の向き
export function buildModel(type: BuildingType, fw: number, fh: number, look: Look, dir: 'x' | 'y' = 'x'): Group {
  const g = new Group();
  const rc = roofOf(type);
  if (type === 'hall') {
    // 本丸：石垣の上に白壁3層と瓦屋根を積んだ天守。主役なので敷地より少し大きく作る
    const k = (Math.min(fw, fh) / 2) * 1.15;
    const t = kit(g, k, k);
    t.stoneBase(look, 0.86, 0.76, 0.4);
    t.tier(0.68, 0.4, 0.9, 3);
    t.skirtRoof(rc, 0.8, 0.88, 0.52, 1.02);
    t.tier(0.5, 1.02, 1.42, 2);
    t.gables(0.66, 0.17, 0.95, 1.12);
    t.skirtRoof(rc, 0.62, 1.4, 0.38, 1.52);
    t.tier(0.38, 1.52, 1.88, 2);
    t.topRoof(rc, look, 0.5, 1.86, 0.15, 2.14, 'shachi');
    return merged(g);
  }
  // 1マスの建物：半マスを1、高さはマス単位で作る
  const t = kit(g, 0.5, 1);
  const { P } = t;
  if (type === 'wall') {
    // 城壁：石垣の上に白い塀と瓦の笠。マスいっぱいに作って隣とつなげる
    t.box(1, 1, 0, 0.42, look.wall);
    t.prism(0.96, 0.42, 0.6, ART.plaster);
    t.prism(1, 0.6, 0.7, ROOF.tile.fill);
  } else if (type === 'tbow') {
    // 櫓（弓）：緑青の屋根の二重櫓。1層目の4つの面に矢をつがえた弓
    t.stoneBase(look, 0.86, 0.74, 0.3);
    t.tier(0.62, 0.3, 0.75, 0);
    t.onFaces(0.62, (on) => {
      // 面の上の横 a・高さ z で描く。弓幹は a の正の向きへふくらませる
      const R = 0.3;
      const Rz = 0.17;
      const z0 = 0.53;
      const oa = -0.55 * R;
      const pts: Vector3[] = [];
      for (let i = 0; i <= 8; i++) {
        const th = -1.05 + (2.1 * i) / 8;
        pts.push(on(oa + R * Math.cos(th), z0 + Rz * Math.sin(th), 0.01));
      }
      t.beam(pts[0], pts[8], ART.board, 0.006);
      t.beam(on(-0.5 * R, z0, 0.012), on(0.8 * R, z0, 0.012), ART.board, 0.008);
      for (let i = 0; i < 8; i++) t.beam(pts[i], pts[i + 1], ART.bow, 0.014);
    });
    t.skirtRoof(rc, 0.84, 0.73, 0.48, 0.86);
    t.tier(0.48, 0.86, 1.14, 1);
    t.topRoof(rc, look, 0.7, 1.12, 0.18, 1.42, 'none');
  } else if (type === 'tgun') {
    // 櫓（鉄砲）：黒い瓦屋根、黒い板張りに白い狭間。狭間から銃身を突き出す
    t.stoneBase(look, 0.86, 0.74, 0.3);
    t.tier(0.66, 0.3, 0.95, 3, ART.board, ART.plaster);
    const h = 0.66;
    const zm = 0.3 + 0.65 * 0.65;
    t.onFaces(h, (on) => {
      for (let w = 0; w < 3; w++) {
        const a = -h + (2 * h * (w + 0.5)) / 3;
        t.beam(on(a, zm, 0), on(a, zm, 0.3), ART.gun, 0.02);
      }
    });
    t.topRoof(rc, look, 0.88, 0.93, 0.24, 1.3, 'none');
  } else if (type === 'gate') {
    // 門：城壁より少し高い木の扉の箱。4つの面に扉の合わせ目と横木、金の鋲。上に瓦屋根
    t.prism(1, 0, 0.6, ART.wood);
    t.onFaces(1, (on, i) => {
      t.plate(on(0, 0.3, 0.006), i, 0.012, 0.56, ART.woodDk);
      for (const z of [0.18, 0.42]) {
        t.plate(on(0, z, 0.008), i, 1, 0.03, ART.woodDk, 0.016);
        for (const a of [-0.55, -0.2, 0.2, 0.55]) t.sphere(on(a, z, 0.02), 0.014, look.gold);
      }
    });
    t.topRoof(rc, look, 0.62, 0.6, 0.22, 0.95, 'none');
  } else if (type === 'bar') {
    // 拒馬：横木（向きは dir）に、先を尖らせた杭を X 字に2組
    const Q = (a: number, b: number, z: number) => (dir === 'x' ? P(a, b, z) : P(b, a, z));
    for (const d of [-1, 1])
      for (const a of [-0.5, 0.5]) {
        const lo = Q(a, -0.45 * d, 0);
        const hi = Q(a, 0.45 * d, 0.48);
        const tip = lo.clone().lerp(hi, 0.84);
        t.beam(lo, tip, ART.woodDk, 0.025);
        t.beam(tip, hi, ART.stakeTip, 0.02);
      }
    t.beam(Q(-1, 0, 0.24), Q(1, 0, 0.24), ART.wood, 0.03);
  } else if (type === 'cata') {
    // 大筒：低い木の台の上に、青銅の筒を -x の向きへ斜めに載せる。台の両脇に車輪
    for (const y of [-0.56, 0.56])
      for (const x of [-0.3, 0.3]) {
        t.drum(P(x, y, 0.12), 0.12, 0.05, 'z', ART.woodDk);
        t.drum(P(x, y * 1.08, 0.12), 0.035, 0.03, 'z', look.gold);
      }
    t.prism(0.5, 0.04, 0.18, ART.wood);
    const base = P(0.5, 0, 0.3);
    const tip = P(-0.9, 0, 0.5);
    t.beam(base, tip, ART.bronze, 0.075);
    t.sphere(base, 0.085, ART.bronze);
    t.beam(base.clone().setY(base.y + 0.06), tip.clone().setY(tip.y + 0.06), ART.bronzeHi, 0.02);
    for (const q of [0.3, 0.72])
      t.beam(base.clone().lerp(tip, q - 0.02), base.clone().lerp(tip, q + 0.02), look.gold, 0.085);
    t.beam(tip, tip.clone().lerp(base, -0.02), ART.gun, 0.06);
  } else {
    // 鼓楼：低い石垣に4本の柱、大太鼓、尖った屋根
    t.stoneBase(look, 0.86, 0.78, 0.18);
    for (const dx of [-0.56, 0.56])
      for (const dy of [-0.56, 0.56]) t.beam(P(dx, dy, 0.18), P(dx, dy, 0.86), ART.woodDk, 0.022);
    t.drum(P(0, 0, 0.5), 0.2, 0.3, 'x', ART.drum, ART.drumFace);
    t.topRoof(rc, look, 0.76, 0.84, 0, 1.12, 'finial');
  }
  return merged(g);
}

// 壊れた櫓：石垣の台の上に、焼け残った柱と傾いた梁
export function buildRuin(look: Look): Group {
  const g = new Group();
  const t = kit(g, 0.5, 1);
  const { P } = t;
  t.stoneBase(look, 0.86, 0.74, 0.34);
  t.beam(P(-0.5, 0.5, 0.34), P(-0.44, 0.5, 1.12), ART.charred, 0.035);
  t.beam(P(0.5, -0.5, 0.34), P(0.42, -0.5, 0.82), ART.charred, 0.035);
  t.beam(P(0.5, 0.5, 0.34), P(0.5, 0.5, 0.62), ART.charred, 0.035);
  t.beam(P(-0.5, -0.5, 0.34), P(-0.5, -0.5, 0.5), ART.charred, 0.035);
  t.beam(P(-0.62, 0.5, 0.96), P(0.5, -0.5, 0.54), ART.charred, 0.028);
  // 落ちた屋根の瓦
  t.box(0.3, 0.22, 0.34, 0.38, ROOF.tile.fill, 0.2, 0.2);
  return merged(g);
}
