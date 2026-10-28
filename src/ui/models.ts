// 3Dの建物の形（three.js）。施設の種類ごとに一度だけ作り、置くたびに複製して使い回す。
// 座標は、敷地の中心の地面を原点に、x・z を盤面の横・縦（1マス＝1）、y を高さにとる。
// 形は斜め表示の絵（石垣・壁の層・腰屋根・寄棟の屋根）を立体にし、寄ったときに見えるよう、
// 軒の反り・棟・格子窓・破風・鯱・石垣の反りなどを付けて作り込む。瓦や石の模様は貼り絵（textures.ts）で付ける。
// 寸法は「敷地の半分を k、高さを kz 倍」にした値で書く
import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
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
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BuildingType } from '../sim';
import { PATTERN_SPAN, type Pattern, pattern, rng } from './textures';

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
  bank: '#8a857a', // 堀の岸の石垣
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
// 色（と模様）ごとに1つ作って使い回す。面は平らに塗る（面の向きで陰が付く）。
// 模様を貼る材質は、模様の大きさ（userData.span）を持たせ、まとめるときに面に沿って貼る向きを決める
const mats = new Map<string, MeshLambertMaterial>();
export function mat(color: string, opts: { pattern?: Pattern; double?: boolean } = {}) {
  const key = `${color}|${opts.pattern ?? ''}|${opts.double ? 'd' : ''}`;
  let m = mats.get(key);
  if (!m) {
    const t = opts.pattern ? pattern(opts.pattern) : null;
    m = new MeshLambertMaterial({
      color: new Color(color),
      flatShading: true,
      map: t?.map ?? null,
      normalMap: t?.normal ?? null,
      side: opts.double ? DoubleSide : FrontSide,
    });
    if (opts.pattern) m.userData.span = PATTERN_SPAN[opts.pattern];
    mats.set(key, m);
  }
  return m;
}

// ---- 形を作る道具 ------------------------------------------------------------
// k は敷地の半分、kz は高さの倍率。P(dx, dy, z) は、盤面の向き (dx, dy) と高さ z を、この建物の座標に直す
function kit(g: Group, k: number, kz: number) {
  const P = (dx: number, dy: number, z: number) => new Vector3(dx * k, z * kz, dy * k);
  function add(geo: BufferGeometry, m: Material) {
    const mesh = new Mesh(geo, m);
    g.add(mesh);
    return mesh;
  }
  // 四角い箱。横の半分は hx・hy、高さは z0〜z1、中心は (ox, oy)
  function box(hx: number, hy: number, z0: number, z1: number, m: Material, ox = 0, oy = 0) {
    const geo = new BoxGeometry(2 * hx * k, (z1 - z0) * kz, 2 * hy * k);
    geo.translate(ox * k, ((z0 + z1) / 2) * kz, oy * k);
    return add(geo, m);
  }
  // まっすぐな箱
  const prism = (h: number, z0: number, z1: number, m: Material) => box(h, h, z0, z1, m);
  // 石垣：上は切り立ち、裾へ向かって反りながら広がる（扇の勾配）。下の半分 h0、上の半分 h1、高さ z1
  function stoneBase(look: Look, h0: number, h1: number, z1: number) {
    const rows = 6;
    const geo = new CylinderGeometry(Math.SQRT2, Math.SQRT2, 1, 4, rows);
    geo.rotateY(Math.PI / 4);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) + 0.5; // 下が0、上が1
      const s = h1 + (h0 - h1) * (1 - t) ** 2;
      pos.setXYZ(i, pos.getX(i) * s * k, t * z1 * kz, pos.getZ(i) * s * k);
    }
    // 角の石（算木積み）を、少し明るい石の帯で示す
    for (const [dx, dy] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ])
      for (let r = 0; r < 3; r++) {
        const t0 = r / 3;
        const t1 = (r + 1) / 3;
        const s0 = h1 + (h0 - h1) * (1 - t0) ** 2;
        const s1 = h1 + (h0 - h1) * (1 - t1) ** 2;
        beam(P(dx * s0, dy * s0, z1 * t0 + 0.01), P(dx * s1, dy * s1, z1 * t1), look.wallDk, 0.012 * (k / 0.5));
      }
    return add(geo, mat(look.wall, { pattern: 'stone' }));
  }
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
  function plate(c: Vector3, i: number, wa: number, wz: number, m: Material, depth = 0.012) {
    const geo = i % 2 === 0 ? new BoxGeometry(depth, wz, wa) : new BoxGeometry(wa, wz, depth);
    geo.translate(c.x, c.y, c.z);
    return add(geo, m);
  }
  // 壁の層：下の3割を下見板にし、上に長押（横の帯）、窓を並べる。窓には格子を入れる。
  // 鉄砲櫓は壁を黒い板張りにし、窓（狭間）を白くする
  function tier(h: number, z0: number, z1: number, windows: number, dark = false) {
    const wall = dark ? mat(ART.board, { pattern: 'board' }) : mat(ART.plaster, { pattern: 'plaster' });
    prism(h, z0, z1, wall);
    if (!dark) box(h + 0.008, h + 0.008, z0, z0 + (z1 - z0) * 0.3, mat(ART.board, { pattern: 'board' }));
    // 長押：窓の上を回る細い帯
    box(h + 0.006, h + 0.006, z0 + (z1 - z0) * 0.86, z0 + (z1 - z0) * 0.9, mat(dark ? ART.woodDk : '#e4ddcc'));
    const lo = z0 + (z1 - z0) * 0.46;
    const hi = z0 + (z1 - z0) * 0.8;
    const ink = mat(dark ? ART.plaster : ART.board);
    const bar = mat(ART.plaster);
    onFaces(h, (on, i) => {
      for (let w = 0; w < windows; w++) {
        const a = -h + (2 * h * (w + 0.5)) / windows;
        const ww = 0.24 * h * k;
        plate(on(a, (lo + hi) / 2, 0.006), i, ww, (hi - lo) * kz, ink);
        if (dark) continue;
        // 格子：縦の桟を3本
        for (const d of [-0.3, 0, 0.3])
          plate(on(a + (d * ww) / k, (lo + hi) / 2, 0.014), i, 0.012 * k, (hi - lo) * kz, bar);
      }
    });
  }
  // 屋根の1面。軒の線 eave(s) と上の線 top(s)（s は -1〜1）を結び、中ほどを sag だけ下げて照りを付ける
  function roofSheet(eave: (s: number) => Vector3, top: (s: number) => Vector3, sag: number, m: Material) {
    const S = 8;
    const R = 4;
    const pt = (i: number, j: number) => {
      const s = -1 + (2 * i) / S;
      const r = j / R;
      const p = eave(s).lerp(top(s), r);
      p.y -= sag * kz * Math.sin(Math.PI * r);
      return p;
    };
    const faces: Vector3[][] = [];
    for (let i = 0; i < S; i++)
      for (let j = 0; j < R; j++) faces.push([pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)]);
    return add(polyGeo(faces), m);
  }
  // 屋根の軒の線：角を lift だけ反り上げる
  const eaveLine = (a: Vector3, b: Vector3, lift: number) => (s: number) => {
    const p = a.clone().lerp(b, (s + 1) / 2);
    p.y += lift * kz * s * s;
    return p;
  };
  // 軒先の厚み（鼻隠し）：軒の線から下へ th だけの帯
  function fascia(line: (s: number) => Vector3, th: number, m: Material) {
    roofSheet(line, (s) => line(s).setY(line(s).y - th * kz), 0, m);
  }
  // 屋根の4つの軒の角（奥左・奥右・手前右・手前左）
  const corners = (e: number, z: number) => [P(-e, -e, z), P(e, -e, z), P(e, e, z), P(-e, e, z)];
  // 腰屋根：軒（eave）から上の層の付け根（top）まで。角は反り上げ、隅棟を付ける
  function skirtRoof(rc: RoofColor, eave: number, z0: number, topH: number, z1: number) {
    const E = corners(eave, z0);
    const T = corners(topH, z1);
    const lift = 0.05;
    const tile = mat(rc.fill, { pattern: 'tile', double: true });
    const edge = mat(rc.edge, { double: true });
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const line = eaveLine(E[i], E[j], lift);
      roofSheet(line, (s) => T[i].clone().lerp(T[j], (s + 1) / 2), 0.025, tile);
      fascia(line, 0.035, edge);
      // 隅棟
      const c = E[i].clone();
      c.y += lift * kz;
      beam(c, T[i], rc.edge, 0.016 * (k / 0.5));
    }
  }
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
    const E = corners(eave, z0);
    const r0 = P(-ridge, 0, z1);
    const r1 = P(ridge, 0, z1);
    const lift = 0.06;
    const tile = mat(rc.fill, { pattern: 'tile', double: true });
    const edge = mat(rc.edge, { double: true });
    // 各面の上の線：奥と手前は棟、左右は棟の端
    const tops: [Vector3, Vector3][] = [
      [r0, r1],
      [r1, r1],
      [r1, r0],
      [r0, r0],
    ];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const line = eaveLine(E[i], E[j], lift);
      const [ta, tb] = tops[i];
      roofSheet(line, (s) => ta.clone().lerp(tb, (s + 1) / 2), 0.03, tile);
      fascia(line, 0.04, edge);
      const c = E[i].clone();
      c.y += lift * kz;
      beam(c, i === 0 || i === 3 ? r0 : r1, rc.edge, 0.018 * (k / 0.5));
    }
    // 大棟と鬼瓦
    if (ridge > 0) {
      beam(r0, r1, rc.edge, 0.028 * (k / 0.5));
      for (const p of [r0, r1]) box(0.03, 0.03, z1 - 0.02, z1 + 0.06, edge, p.x / k, 0);
    }
    if (ornament === 'shachi') for (const [p, d] of [[r0, -1] as const, [r1, 1] as const]) shachi(p, d, look);
    else if (ornament === 'finial') {
      sphere(r0.clone().setY(r0.y + 0.02 * kz), 0.035 * (k / 0.5), look.gold);
      beam(r0, r0.clone().setY(r0.y + 0.08 * kz), look.gold, 0.008);
    }
  }
  // 鯱：棟の端から、尾を内側へ反らせて立てる金の飾り（d は外向きの x の向き）
  function shachi(p: Vector3, d: number, look: Look) {
    const u = k / 1.1;
    const curve = new CatmullRomCurve3(
      [
        [0, 0],
        [0.03 * d, 0.05],
        [0.01 * d, 0.1],
        [-0.035 * d, 0.13],
        [-0.05 * d, 0.11],
      ].map(([x, y]) => new Vector3(p.x + x * u, p.y + y * u, p.z)),
    );
    add(new TubeGeometry(curve, 12, 0.016 * u, 6, false), mat(look.gold));
    sphere(p.clone().setY(p.y + 0.015 * u), 0.024 * u, look.gold);
  }
  // 千鳥破風：4つの屋根の面に立つ三角の妻。屋根の縁（破風板）と、頂に金の懸魚を付ける
  function gables(rc: RoofColor, look: Look, off: number, half: number, z0: number, z1: number) {
    onFaces(off, (on) => {
      const a = on(-half, z0);
      const b = on(half, z0);
      const c = on(0, z1);
      add(polyGeo([[a, b, c]]), mat(ART.plaster, { pattern: 'plaster', double: true }));
      const out = on(0, z0, 0.02).sub(on(0, z0));
      for (const q of [a, b]) beam(q.clone().add(out), c.clone().add(out), rc.edge, 0.018 * (k / 0.5));
      sphere(
        c
          .clone()
          .add(out)
          .setY(c.y - 0.05 * kz),
        0.02 * (k / 0.5),
        look.gold,
      );
    });
  }
  // 2点を結ぶ丸い棒
  function beam(a: Vector3, b: Vector3, color: string, r: number, m = mat(color)) {
    const d = b.clone().sub(a);
    const geo = new CylinderGeometry(r, r, d.length(), 6);
    geo.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d.clone().normalize()));
    const c = a.clone().add(b).multiplyScalar(0.5);
    geo.translate(c.x, c.y, c.z);
    return add(geo, m);
  }
  // 太さの変わる棒（a で ra、b で rb）
  function taper(a: Vector3, b: Vector3, ra: number, rb: number, m: Material) {
    const d = b.clone().sub(a);
    const geo = new CylinderGeometry(rb, ra, d.length(), 12);
    geo.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d.clone().normalize()));
    const c = a.clone().add(b).multiplyScalar(0.5);
    geo.translate(c.x, c.y, c.z);
    return add(geo, m);
  }
  function sphere(c: Vector3, r: number, color: string) {
    const geo = new SphereGeometry(r, 8, 6);
    geo.translate(c.x, c.y, c.z);
    return add(geo, mat(color));
  }
  // 輪。中心 c、半径 r、太さ tube。軸は x か z の向き
  function ring(c: Vector3, r: number, tube: number, axis: 'x' | 'z', color: string) {
    const geo = new TorusGeometry(r, tube, 6, 20);
    if (axis === 'x') geo.rotateY(Math.PI / 2);
    geo.translate(c.x, c.y, c.z);
    return add(geo, mat(color));
  }
  // 円柱。軸は x（axis 'x'）か z（'z'）の向き。face を渡すと、両端の面をその色にする
  function drum(c: Vector3, r: number, len: number, axis: 'x' | 'z', color: string, face?: string) {
    const geo = new CylinderGeometry(r, r, len, 16, 1, !!face);
    geo.rotateZ(axis === 'x' ? Math.PI / 2 : 0);
    if (axis === 'z') geo.rotateX(Math.PI / 2);
    geo.translate(c.x, c.y, c.z);
    add(geo, mat(color));
    if (!face) return;
    for (const d of [-1, 1]) {
      const cap = new CircleGeometry(r, 16);
      if (axis === 'x') cap.rotateY((d * Math.PI) / 2);
      else if (d < 0) cap.rotateY(Math.PI);
      const o = (d * len) / 2;
      cap.translate(c.x + (axis === 'x' ? o : 0), c.y, c.z + (axis === 'z' ? o : 0));
      add(cap, mat(face));
    }
  }
  return {
    P,
    box,
    prism,
    stoneBase,
    onFaces,
    plate,
    tier,
    skirtRoof,
    topRoof,
    gables,
    beam,
    taper,
    sphere,
    ring,
    drum,
  };
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
// 模様を面に沿って貼る向き（uv）を、三角ごとに決め直す。壁や屋根は、横を軒に沿う向き、縦を高さ（屋根は勾配）に沿う向きにし、
// 上を向いた面は盤面の横・縦にする。span は1枚の模様が覆う大きさ（マス）
function worldUV(geo: BufferGeometry, span: number) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  for (let i = 0; i + 2 < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(a.clone().sub(b)).normalize();
    const flat = Math.abs(n.y) > 0.9;
    const hl = Math.hypot(n.x, n.z) || 1;
    // 軒に沿う向き（面の水平な向きに直交する）
    const ex = -n.z / hl;
    const ez = n.x / hl;
    for (let v = 0; v < 3; v++) {
      const p = [a, b, c][v];
      const u = flat ? p.x : p.x * ex + p.z * ez;
      const w = flat ? p.z : p.y / hl;
      uv.setXY(i + v, u / span, w / span);
    }
  }
  uv.needsUpdate = true;
}
// 同じ材質の部品を1つの形にまとめる（建物1つや持ち物1つあたりの描く回数を減らす）。模様を貼る材質は、まとめたあとに貼る向きを決める
export function merged(g: Group): Group {
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
  for (const [m, geos] of byMat) {
    for (const x of geos) if (!x.attributes.normal) x.computeVertexNormals();
    const geo = mergeGeometries(geos);
    for (const x of geos) x.dispose();
    if (!geo) continue;
    if (m.userData.span) worldUV(geo, m.userData.span);
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

// 城壁がつながる向き（ビットの和）：奥（-y）・右（+x）・手前（+y）・左（-x）
export const LINK = { n: 1, e: 2, s: 4, w: 8 } as const;
// 種類ごとの建物の形。fw・fh は敷地の大きさ。dir は拒馬の横木の向き、links は城壁がつながる向き
export function buildModel(
  type: BuildingType,
  fw: number,
  fh: number,
  look: Look,
  opt: { dir?: 'x' | 'y'; links?: number } = {},
): Group {
  const dir = opt.dir ?? 'x';
  const g = new Group();
  const rc = roofOf(type);
  const wood = mat(ART.wood, { pattern: 'wood' });
  const woodDk = mat(ART.woodDk, { pattern: 'wood' });
  if (type === 'hall') {
    // 本丸：石垣の上に白壁3層と瓦屋根を積んだ天守。主役なので敷地より少し大きく作る
    const k = (Math.min(fw, fh) / 2) * 1.15;
    const t = kit(g, k, k);
    t.stoneBase(look, 0.86, 0.76, 0.4);
    t.tier(0.68, 0.4, 0.9, 3);
    t.skirtRoof(rc, 0.8, 0.88, 0.52, 1.02);
    t.tier(0.5, 1.02, 1.42, 2);
    t.gables(rc, look, 0.66, 0.17, 0.95, 1.12);
    t.skirtRoof(rc, 0.62, 1.4, 0.38, 1.52);
    t.tier(0.38, 1.52, 1.88, 2);
    t.topRoof(rc, look, 0.5, 1.86, 0.15, 2.14, 'shachi');
    return merged(g);
  }
  // 1マスの建物：半マスを1、高さはマス単位で作る
  const t = kit(g, 0.5, 1);
  const { P } = t;
  if (type === 'wall') {
    // 城壁：石垣の上に白い塀と瓦の笠。マスいっぱいに作って隣とつなげる。塀には狭間（鉄砲・矢を射る穴）
    t.box(1, 1, 0, 0.42, mat(look.wall, { pattern: 'stone' }));
    t.prism(0.96, 0.42, 0.6, mat(ART.plaster, { pattern: 'plaster' }));
    t.prism(0.97, 0.42, 0.45, mat(ART.board));
    t.onFaces(0.96, (on, i) => {
      t.plate(on(-0.45, 0.52, 0.004), i, 0.05, 0.05, mat(ART.board));
      t.plate(on(0.45, 0.52, 0.004), i, 0.05, 0.05, mat(ART.board));
    });
    t.prism(1, 0.6, 0.67, mat(ROOF.tile.fill, { pattern: 'tile' }));
    // 笠の棟：隣の城壁・門へつながる向きにだけ、中心から通す（つながりがなければ、左右に短く）
    const links = opt.links ?? 0;
    const ridge = mat(ROOF.tile.edge);
    const arms: [number, number, number][] = [
      [LINK.n, 0, -1],
      [LINK.e, 1, 0],
      [LINK.s, 0, 1],
      [LINK.w, -1, 0],
    ];
    for (const [bit, dx, dy] of arms)
      if (links & bit) t.box(dx ? 0.5 : 0.06, dy ? 0.5 : 0.06, 0.67, 0.71, ridge, dx * 0.5, dy * 0.5);
    if (!links) t.box(0.6, 0.06, 0.67, 0.71, ridge);
    else t.box(0.06, 0.06, 0.67, 0.71, ridge);
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
    t.tier(0.66, 0.3, 0.95, 3, true);
    const h = 0.66;
    const zm = 0.3 + 0.65 * 0.63;
    t.onFaces(h, (on) => {
      for (let w = 0; w < 3; w++) {
        const a = -h + (2 * h * (w + 0.5)) / 3;
        t.beam(on(a, zm, 0), on(a, zm, 0.3), ART.gun, 0.016);
        t.beam(on(a, zm, 0.06), on(a, zm - 0.05, -0.05), ART.wood, 0.012);
      }
    });
    t.topRoof(rc, look, 0.88, 0.93, 0.24, 1.3, 'none');
  } else if (type === 'gate') {
    // 門：両脇の柱に冠木を渡し、観音開きの扉。扉には横木と金の鋲、乳金物。上に瓦屋根
    t.prism(1, 0, 0.6, wood);
    t.onFaces(1, (on, i) => {
      t.plate(on(0, 0.29, 0.006), i, 0.012, 0.56, woodDk);
      for (const a of [-0.92, 0.92]) t.plate(on(a, 0.3, 0.02), i, 0.08, 0.6, woodDk, 0.04);
      t.plate(on(0, 0.56, 0.025), i, 1, 0.05, woodDk, 0.05);
      for (const z of [0.16, 0.4]) {
        t.plate(on(0, z, 0.01), i, 0.9, 0.03, woodDk, 0.02);
        for (const a of [-0.7, -0.45, -0.2, 0.2, 0.45, 0.7]) t.sphere(on(a, z, 0.024), 0.011, look.gold);
      }
      for (const a of [-0.08, 0.08]) t.sphere(on(a, 0.3, 0.012), 0.018, look.gold);
    });
    t.topRoof(rc, look, 0.62, 0.6, 0.22, 0.95, 'none');
  } else if (type === 'bar') {
    // 拒馬：横木（向きは dir）に、先を尖らせた杭を X 字に2組。杭を縄で縛る
    const Q = (a: number, b: number, z: number) => (dir === 'x' ? P(a, b, z) : P(b, a, z));
    for (const d of [-1, 1])
      for (const a of [-0.5, 0.5]) {
        const lo = Q(a, -0.45 * d, 0);
        const hi = Q(a, 0.45 * d, 0.48);
        const tip = lo.clone().lerp(hi, 0.84);
        t.beam(lo, tip, ART.woodDk, 0.025, woodDk);
        t.taper(tip, hi, 0.025, 0.002, mat(ART.stakeTip));
      }
    t.beam(Q(-1, 0, 0.24), Q(1, 0, 0.24), ART.wood, 0.03, wood);
    for (const a of [-0.5, 0.5]) t.ring(Q(a, 0, 0.24), 0.034, 0.008, dir === 'x' ? 'x' : 'z', '#c9b48a');
  } else if (type === 'cata') {
    // 大筒：低い木の台の上に、青銅の筒を -x の向きへ斜めに載せる。台の両脇に、輻（スポーク）のある車輪
    for (const y of [-0.56, 0.56])
      for (const x of [-0.3, 0.3]) {
        const c = P(x, y, 0.12);
        t.ring(c, 0.11, 0.018, 'z', ART.woodDk);
        t.drum(c, 0.03, 0.06, 'z', look.gold);
        for (let s = 0; s < 6; s++) {
          const th = (s * Math.PI) / 3;
          t.beam(c, c.clone().add(new Vector3(Math.cos(th) * 0.11, Math.sin(th) * 0.11, 0)), ART.woodDk, 0.008);
        }
      }
    t.prism(0.5, 0.04, 0.18, wood);
    const base = P(0.5, 0, 0.3);
    const tip = P(-0.9, 0, 0.5);
    const bronze = mat(ART.bronze);
    t.taper(base, tip, 0.085, 0.06, bronze);
    t.sphere(base, 0.085, ART.bronze);
    t.sphere(base.clone().lerp(tip, -0.07), 0.035, ART.bronze);
    for (const q of [0.25, 0.55, 0.85]) {
      const c = base.clone().lerp(tip, q);
      t.taper(
        c.clone().lerp(tip, -0.015),
        c.clone().lerp(tip, 0.015),
        0.09 - q * 0.025,
        0.09 - q * 0.025,
        mat(look.gold),
      );
    }
    t.taper(tip, tip.clone().lerp(base, -0.03), 0.07, 0.07, bronze);
    t.taper(tip.clone().lerp(base, -0.031), tip.clone().lerp(base, -0.032), 0.045, 0.045, mat(ART.gun));
  } else {
    // 鼓楼：低い石垣に4本の柱と貫、大太鼓（鋲を打った革の面）、尖った屋根
    t.stoneBase(look, 0.86, 0.78, 0.18);
    for (const dx of [-0.56, 0.56])
      for (const dy of [-0.56, 0.56]) t.beam(P(dx, dy, 0.18), P(dx, dy, 0.86), ART.woodDk, 0.022, woodDk);
    for (const z of [0.3, 0.78])
      t.onFaces(0.56, (on) => {
        t.beam(on(-0.56, z), on(0.56, z), ART.woodDk, 0.012, woodDk);
      });
    t.drum(P(0, 0, 0.5), 0.2, 0.3, 'x', ART.drum, ART.drumFace);
    for (const d of [-1, 1])
      for (let s = 0; s < 12; s++) {
        const th = (s * Math.PI) / 6;
        t.sphere(P(d * 0.3, Math.cos(th) * 0.38, 0.5 + Math.sin(th) * 0.19), 0.01, look.gold);
      }
    t.topRoof(rc, look, 0.76, 0.84, 0, 1.12, 'finial');
  }
  return merged(g);
}

// 壊れた櫓：石垣の台の上に、焼け残った柱と傾いた梁
export function buildRuin(look: Look): Group {
  const g = new Group();
  const t = kit(g, 0.5, 1);
  const { P } = t;
  const ch = mat(ART.charred, { pattern: 'wood' });
  t.stoneBase(look, 0.86, 0.74, 0.34);
  t.beam(P(-0.5, 0.5, 0.34), P(-0.44, 0.5, 1.12), ART.charred, 0.035, ch);
  t.beam(P(0.5, -0.5, 0.34), P(0.42, -0.5, 0.82), ART.charred, 0.035, ch);
  t.beam(P(0.5, 0.5, 0.34), P(0.5, 0.5, 0.62), ART.charred, 0.035, ch);
  t.beam(P(-0.5, -0.5, 0.34), P(-0.5, -0.5, 0.5), ART.charred, 0.035, ch);
  t.beam(P(-0.62, 0.5, 0.96), P(0.5, -0.5, 0.54), ART.charred, 0.028, ch);
  // 落ちた屋根の瓦
  t.box(0.3, 0.22, 0.34, 0.38, mat(ROOF.tile.fill, { pattern: 'tile' }), 0.2, 0.2);
  t.box(0.16, 0.2, 0.34, 0.37, mat(ROOF.tile.fill, { pattern: 'tile' }), -0.3, -0.2);
  return merged(g);
}

// ---- 壊れた門・大筒・本丸の跡 ---------------------------------------------------
// 傾けた箱を置く道具。大きさ (w, h, d)、中心 (x, y, z)、回転 (rx, ry, rz)
function piece(
  g: Group,
  m: Material,
  [w, h, d]: [number, number, number],
  [x, y, z]: [number, number, number],
  [rx, ry, rz]: [number, number, number] = [0, 0, 0],
) {
  const geo = new BoxGeometry(w, h, d);
  geo.rotateX(rx);
  geo.rotateY(ry);
  geo.rotateZ(rz);
  geo.translate(x, y, z);
  g.add(new Mesh(geo, m));
}
// 瓦の欠片を、中心 (cx, cz) のまわり r の範囲に n 個散らす
function shards(g: Group, n: number, cx: number, cz: number, r: number, seed: number, y = 0.02) {
  const rnd = rng(seed);
  const m = mat(ROOF.tile.fill, { pattern: 'tile' });
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = r * Math.sqrt(rnd());
    piece(
      g,
      m,
      [0.08 + rnd() * 0.06, 0.025, 0.06 + rnd() * 0.05],
      [cx + Math.cos(a) * d, y, cz + Math.sin(a) * d],
      [rnd() * 0.5, rnd() * 3, rnd() * 0.5],
    );
  }
}
// 壊れたあとに破片が残る施設（門・大筒・本丸）の跡。大きさは敷地 fw×fh
export function buildDebris(type: BuildingType, fw: number, fh: number, look: Look): Group {
  const g = new Group();
  const wood = mat(ART.wood, { pattern: 'wood' });
  const woodDk = mat(ART.woodDk, { pattern: 'wood' });
  const charred = mat(ART.charred, { pattern: 'wood' });
  const tile = mat(ROOF.tile.fill, { pattern: 'tile' });
  if (type === 'gate') {
    // 門：折れた柱の根元、倒れた扉の板（横木と鋲つき）、落ちた屋根の一部と瓦の欠片
    for (const x of [-0.42, 0.42]) {
      piece(g, woodDk, [0.13, 0.26, 0.13], [x, 0.13, 0]);
      piece(g, woodDk, [0.1, 0.12, 0.1], [x + 0.02, 0.3, 0.01], [0.3, 0, 0.4]);
    }
    // 倒れた扉：1枚は平らに、1枚は柱に寄りかかる
    piece(g, wood, [0.42, 0.04, 0.55], [-0.18, 0.03, 0.18], [0, 0.3, 0]);
    piece(g, wood, [0.42, 0.04, 0.5], [0.2, 0.18, -0.12], [0.75, -0.2, 0]);
    for (const [x, y, z, rx, ry] of [
      [-0.18, 0.06, 0.05, 0, 0.3],
      [-0.18, 0.06, 0.32, 0, 0.3],
      [0.2, 0.1, -0.04, 0.75, -0.2],
    ])
      piece(g, woodDk, [0.44, 0.03, 0.04], [x, y, z], [rx, ry, 0]);
    const gold = mat(look.gold);
    for (const [x, z] of [
      [-0.3, 0.05],
      [-0.06, 0.12],
      [-0.25, 0.32],
    ]) {
      const s = new SphereGeometry(0.018, 6, 4);
      s.translate(x, 0.06, z);
      g.add(new Mesh(s, gold));
    }
    // 落ちた屋根
    piece(g, tile, [0.6, 0.05, 0.38], [0.05, 0.1, 0.3], [0.25, 0.4, 0.2]);
    shards(g, 9, 0, 0, 0.5, 17);
  } else if (type === 'cata') {
    // 大筒：横倒しの筒、外れて倒れた車輪、割れた台
    const bronze = mat(ART.bronze);
    const barrel = new CylinderGeometry(0.06, 0.085, 0.7, 12);
    barrel.rotateZ(Math.PI / 2);
    barrel.rotateY(0.5);
    barrel.translate(0.05, 0.08, 0.05);
    g.add(new Mesh(barrel, bronze));
    const bandGold = mat(look.gold);
    for (const t of [-0.15, 0.15]) {
      const band = new CylinderGeometry(0.09, 0.09, 0.03, 12);
      band.rotateZ(Math.PI / 2);
      band.rotateY(0.5);
      band.translate(0.05 + Math.cos(0.5) * t, 0.08, 0.05 - Math.sin(0.5) * t);
      g.add(new Mesh(band, bandGold));
    }
    // 車輪：1つは平らに倒れ、1つは台に寄りかかる
    for (const [x, y, z, rx, rz] of [
      [-0.28, 0.02, -0.22, Math.PI / 2, 0],
      [0.3, 0.1, -0.25, 0.3, 0.2],
    ]) {
      const w = new Group();
      const rim = new TorusGeometry(0.11, 0.018, 6, 16);
      w.add(new Mesh(rim, woodDk));
      for (let s = 0; s < 6; s++) {
        const sp = new BoxGeometry(0.012, 0.11, 0.012);
        sp.translate(0, 0.055, 0);
        sp.rotateZ((s * Math.PI) / 3);
        w.add(new Mesh(sp, woodDk));
      }
      w.rotation.set(rx, 0, rz);
      w.position.set(x, y + 0.11 * Math.cos(rx), z);
      w.updateMatrixWorld();
      for (const c of w.children as Mesh[]) {
        const geo = c.geometry.clone();
        geo.applyMatrix4(c.matrixWorld);
        g.add(new Mesh(geo, c.material as Material));
      }
    }
    // 割れた台の板
    piece(g, wood, [0.45, 0.07, 0.2], [-0.15, 0.04, 0.25], [0, 0.4, 0.1]);
    piece(g, wood, [0.3, 0.07, 0.18], [0.25, 0.06, 0.3], [0.2, -0.3, -0.3]);
    shards(g, 3, 0, 0, 0.4, 5);
  } else {
    // 本丸：崩れた石垣の台の上に、焼けた梁と白壁・瓦の山
    const k = (Math.min(fw, fh) / 2) * 1.15;
    const t = kit(g, k, k);
    t.stoneBase(look, 0.86, 0.8, 0.22);
    const top = 0.22 * k;
    const rnd = rng(29);
    const plaster = mat(ART.plaster, { pattern: 'plaster' });
    const board = mat(ART.board, { pattern: 'board' });
    for (let i = 0; i < 14; i++) {
      const m = [plaster, board, tile, tile][i % 4];
      const s = 0.15 + rnd() * 0.25;
      piece(
        g,
        m,
        [s * k, 0.05 * k, s * 0.7 * k],
        [(rnd() - 0.5) * 1.2 * k, top + 0.03 * k + rnd() * 0.15 * k, (rnd() - 0.5) * 1.2 * k],
        [rnd() * 0.8, rnd() * 3, rnd() * 0.8],
      );
    }
    for (let i = 0; i < 5; i++)
      piece(
        g,
        charred,
        [0.9 * k, 0.05 * k, 0.05 * k],
        [(rnd() - 0.5) * 0.8 * k, top + 0.1 * k + rnd() * 0.1 * k, (rnd() - 0.5) * 0.8 * k],
        [0, rnd() * 3, (rnd() - 0.5) * 0.6],
      );
    // 欠片は石垣の台の上（半分の幅 0.8）に収める
    shards(g, 12, 0, 0, 0.7 * k, 41, top + 0.01);
  }
  return merged(g);
}

// ---- 橋 ----------------------------------------------------------------------
// 川にかかった木の橋（1マス）。床の上面を地面の高さ（原点）に合わせ、両脇に欄干、床の下に川へ下りる橋脚を付ける。
// dir は渡る向き（x なら盤面の横へ渡る）
export function buildBridge(dir: 'x' | 'y'): Group {
  const g = new Group();
  const wood = mat(ART.wood, { pattern: 'wood' });
  const dark = mat(ART.woodDk, { pattern: 'wood' });
  // 渡る向きの長さ L、幅 Wd。dir が y なら x と z を入れ替える
  const put = (m: Material, [w, h, d]: [number, number, number], [x, y, z]: [number, number, number]) =>
    piece(g, m, dir === 'x' ? [w, h, d] : [d, h, w], dir === 'x' ? [x, y, z] : [z, y, x]);
  // 床：渡る向きに長く、両岸へ少しかける
  put(wood, [1.1, 0.06, 0.62], [0, -0.03, 0]);
  // 床板の目地
  for (let k = -4; k <= 4; k++) put(dark, [0.012, 0.062, 0.62], [k * 0.11, -0.03, 0]);
  // 欄干：両脇に、柱と横木
  for (const s of [-1, 1]) {
    put(dark, [1.1, 0.04, 0.04], [0, 0.2, s * 0.29]);
    put(dark, [1.1, 0.03, 0.03], [0, 0.1, s * 0.29]);
    for (const x of [-0.5, -0.17, 0.17, 0.5]) put(dark, [0.05, 0.24, 0.05], [x, 0.1, s * 0.29]);
  }
  // 橋脚：川の中へ下りる2組の柱
  for (const x of [-0.25, 0.25]) for (const s of [-1, 1]) put(dark, [0.06, 0.4, 0.06], [x, -0.25, s * 0.22]);
  return merged(g);
}
