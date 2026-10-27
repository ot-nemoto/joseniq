// 武将と兵の持ち物（武器・兜の前立て・幟、衝車の丸太）を立体で作る。体はドット絵の板のまま、絵から武器と前立てを外し
// （pixel.ts の bare）、代わりにこの立体を、絵の手や兜の位置に付ける。
// 座標の単位はドット絵の1ドット。原点は足元（絵の SPR_CX の列の左端・最下段の下）、x は右、y は上、z は手前（カメラの側）
import {
  BoxGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CylinderGeometry,
  DoubleSide,
  Group,
  type Material,
  Mesh,
  MeshPhongMaterial,
  NearestFilter,
  type Object3D,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  SRGBColorSpace,
  TubeGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AttackerKind } from '../sim';
import { type Frame, flagSprite, rawFrame, SPR_CX, SPR_H, specOf } from './pixel';

// ---- 材質 ------------------------------------------------------------------
// 金属や漆は、日の光の照り返し（specular）を付けて、板の絵との違いを出す
const mats = new Map<string, MeshPhongMaterial>();
function mat(color: string, shininess = 30, specular = '#222222') {
  const key = `${color}|${shininess}|${specular}`;
  let m = mats.get(key);
  if (!m) {
    m = new MeshPhongMaterial({ color, shininess, specular, flatShading: false });
    mats.set(key, m);
  }
  return m;
}
const M = {
  steel: () => mat('#e3e9f0', 90, '#ffffff'), // 刀身・穂先
  iron: () => mat('#7d8896', 60, '#cccccc'),
  gold: () => mat('#e0b84e', 70, '#fff0b0'),
  shaft: () => mat('#5b3a1e', 10), // 槍の柄・矢
  lacquer: () => mat('#1c1a18', 100, '#888888'), // 黒漆（軍配・鞘）
  grip: () => mat('#262a33', 10), // 柄巻
  bow: () => mat('#7a4a22', 40, '#664422'), // 弓
  string: () => mat('#efe6cc', 5),
  barrel: () => mat('#2b2d33', 70, '#aaaaaa'),
  stock: () => mat('#7a4a22', 25, '#443322'),
  feather: () => mat('#f4f0e4', 5),
  pole: () => mat('#4a3a28', 10),
  wood: () => mat('#9a6a3c', 15), // 槌の頭・盾
  woodDk: () => mat('#5e3d22', 15),
  log: () => mat('#7a4a22', 10), // 衝車の丸太
};

// 絵のドット (x, y)（y は下向き）の中心を、この座標に直す
const P = (x: number, y: number, z = 0) => new Vector3(x + 0.5 - SPR_CX, SPR_H - y - 0.5, z);

function add(g: Object3D, geo: BoxGeometry | CylinderGeometry | SphereGeometry | TubeGeometry, m: Material) {
  const mesh = new Mesh(geo, m);
  g.add(mesh);
  return mesh;
}
// a から b へ向けて、y 軸の向きの形を置く
function along(geo: CylinderGeometry | BoxGeometry, a: Vector3, b: Vector3) {
  const d = b.clone().sub(a);
  geo.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d.clone().normalize()));
  const c = a.clone().add(b).multiplyScalar(0.5);
  geo.translate(c.x, c.y, c.z);
  return geo;
}
// 丸い棒
const rod = (g: Object3D, a: Vector3, b: Vector3, r: number, m: Material) =>
  add(g, along(new CylinderGeometry(r, r, a.distanceTo(b), 8), a, b), m);
// 先の尖った形（a が根元、b が先）。sides が4なら菱形の穂先
const point = (g: Object3D, a: Vector3, b: Vector3, r: number, m: Material, sides = 4) =>
  add(g, along(new CylinderGeometry(0, r, a.distanceTo(b), sides), a, b), m);
const ball = (g: Object3D, c: Vector3, r: number, m: Material) => {
  const geo = new SphereGeometry(r, 10, 8);
  geo.translate(c.x, c.y, c.z);
  return add(g, geo, m);
};
// 平たい円盤（カメラの方を向く）
function disc(g: Object3D, c: Vector3, r: number, th: number, m: Material) {
  const geo = new CylinderGeometry(r, r, th, 20);
  geo.rotateX(Math.PI / 2);
  geo.translate(c.x, c.y, c.z);
  return add(g, geo, m);
}
// 曲がった棒（点を通る）
function curve(g: Object3D, pts: Vector3[], r: number, m: Material) {
  return add(g, new TubeGeometry(new CatmullRomCurve3(pts), 16, r, 6, false), m);
}

// ---- 武器 ------------------------------------------------------------------
// 刀：柄・鍔・反りのある刀身。hand は握る手、a〜b は刀身（絵の刀身と同じ位置）
function katana(g: Object3D, hand: Vector3, a: Vector3, b: Vector3) {
  const dir = b.clone().sub(a).normalize();
  rod(g, hand.clone().addScaledVector(dir, -1.6), hand.clone().addScaledVector(dir, 0.6), 0.32, M.grip());
  // 鍔：刀身の根元に、刀の向きに垂直な金の円盤
  add(
    g,
    along(
      new CylinderGeometry(0.75, 0.75, 0.25, 20),
      a.clone().addScaledVector(dir, -0.72),
      a.clone().addScaledVector(dir, -0.48),
    ),
    M.gold(),
  );
  // 刀身：根元から先へ、少し反らせる（手前に向かって、刃の向きと逆へ）
  const up = new Vector3(-dir.y, dir.x, 0);
  const n = 6;
  const pts: Vector3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(
      a
        .clone()
        .lerp(b.clone().addScaledVector(dir, 0.8), t)
        .addScaledVector(up, 0.5 * t * t),
    );
  }
  for (let i = 0; i < n; i++) {
    const w = 0.75 - 0.3 * (i / n);
    const seg = along(new BoxGeometry(w, pts[i].distanceTo(pts[i + 1]) + 0.05, 0.18), pts[i], pts[i + 1]);
    add(g, seg, M.steel());
  }
}
// 槍：柄と、菱形の穂先。kama なら穂先の横に鎌（片鎌槍）。a〜b は柄、穂先は b から len だけ先
function spear(g: Object3D, a: Vector3, b: Vector3, len: number, kama: boolean) {
  const dir = b.clone().sub(a).normalize();
  rod(g, a, b, 0.3, M.shaft());
  rod(g, b.clone().addScaledVector(dir, -0.6), b.clone().addScaledVector(dir, 0.2), 0.4, M.gold()); // 口金
  const tip = b.clone().addScaledVector(dir, len);
  point(g, b.clone().addScaledVector(dir, 0.2), tip, 0.55, M.steel());
  if (kama) {
    const side = new Vector3(-dir.y, dir.x, 0);
    const root = b.clone().addScaledVector(dir, 0.8);
    curve(
      g,
      [
        root,
        root.clone().addScaledVector(side, 1.2),
        root.clone().addScaledVector(side, 1.8).addScaledVector(dir, 1.2),
      ],
      0.18,
      M.steel(),
    );
  }
}
// 弓：上下の端が後ろへ反る弓幹と弦。x は弓幹の列、pull は弦を引いた点（なければ弦はまっすぐ）、arrow なら矢をつがえる
function bow(g: Object3D, x: number, ty: number, pull: Vector3 | null, arrow: boolean) {
  const top = P(x - 1, ty - 4.5);
  const bot = P(x - 1, ty + 8.5);
  curve(g, [top, P(x + 0.2, ty - 1), P(x + 0.5, ty + 2), P(x + 0.2, ty + 5), bot], 0.28, M.bow());
  rod(g, P(x + 0.4, ty + 1.2), P(x + 0.4, ty + 2.8), 0.36, M.grip()); // 握り
  if (pull) {
    rod(g, top, pull, 0.07, M.string());
    rod(g, pull, bot, 0.07, M.string());
  } else rod(g, top, bot, 0.07, M.string());
  if (arrow && pull) {
    const tip = P(x + 4, ty + 2);
    rod(g, pull, tip, 0.12, M.shaft());
    point(g, tip, P(x + 5.2, ty + 2), 0.3, M.iron());
    for (const s of [-1, 1]) {
      const f = new BoxGeometry(1.4, 0.5, 0.05);
      f.translate(pull.x + 0.9, pull.y + s * 0.25, pull.z);
      add(g, f, M.feather());
    }
  }
}
// 火縄銃：黒い銃身と、木の台。a が台の後ろ、b が銃口
function gun(g: Object3D, a: Vector3, b: Vector3) {
  const dir = b.clone().sub(a).normalize();
  const mid = a.clone().lerp(b, 0.3);
  add(g, along(new BoxGeometry(0.9, a.distanceTo(mid) + 0.6, 0.5), a, mid), M.stock());
  rod(g, mid, b, 0.28, M.barrel());
  for (const t of [0.45, 0.75]) rod(g, a.clone().lerp(b, t - 0.02), a.clone().lerp(b, t + 0.02), 0.34, M.gold());
  // 火挟み（からくり）
  ball(g, mid.clone().addScaledVector(new Vector3(-dir.y, dir.x, 0), 0.5), 0.25, M.gold());
}
// 軍配：黒漆の団扇に金の日輪、柄。c は団扇の中心、h は柄の手元
function fan(g: Object3D, c: Vector3, h: Vector3) {
  rod(g, h, c, 0.22, M.lacquer());
  disc(g, c, 2.4, 0.25, M.lacquer());
  disc(g, c.clone().setZ(c.z + 0.14), 1, 0.06, M.gold());
  disc(g, c.clone().setZ(c.z - 0.14), 1, 0.06, M.gold());
}
// 手裏剣：4つの刃の星。r は刃の長さ
function shuriken(g: Object3D, c: Vector3, r = 1.5) {
  for (let i = 0; i < 4; i++) {
    const th = (i * Math.PI) / 2 + Math.PI / 4;
    point(g, c, c.clone().add(new Vector3(Math.cos(th) * r, Math.sin(th) * r, 0)), r * 0.23, M.steel());
  }
  ball(g, c, r * 0.2, M.iron());
}

// 槌：木の柄と、四角い木の頭に鉄の帯。h は柄の手元、c は頭の中心
function mallet(g: Object3D, h: Vector3, c: Vector3) {
  rod(g, h, c, 0.28, M.shaft());
  const head = new BoxGeometry(4, 3, 2.4);
  head.translate(c.x, c.y, c.z);
  add(g, head, M.wood());
  for (const dx of [-1.4, 1.4]) {
    const band = new BoxGeometry(0.4, 3.1, 2.5);
    band.translate(c.x + dx, c.y, c.z);
    add(g, band, M.iron());
  }
}
// 盾：木の板を縦に並べ、横に2本・縦に1本の桟。x0 は左端の列、y0 は上端の段、高さ13ドット
function shield(g: Object3D, x0: number, y0: number) {
  const c = P(x0 + 1.5, y0 + 6, 0.8);
  const board = new BoxGeometry(4, 13, 0.8);
  board.translate(c.x, c.y, c.z);
  add(g, board, M.wood());
  // 横の桟：絵と同じく、上から4段目と9段目
  for (const row of [4, 9]) {
    const bar = new BoxGeometry(4.2, 0.8, 1.1);
    bar.translate(c.x, P(0, y0 + row).y, c.z);
    add(g, bar, M.woodDk());
  }
  const post = new BoxGeometry(0.8, 13.2, 1.1);
  post.translate(P(x0 + 2, 0).x, c.y, c.z);
  add(g, post, M.woodDk());
  ball(g, P(x0 + 1.5, y0 + 6, 1.3), 0.5, M.iron());
}
// 衝車の丸太：先に鉄の冠をはめた太い丸太。push は丸太の後ろの端の列
function ram(g: Object3D, push: number) {
  const a = P(push, 16.5, 0.4);
  const b = P(push + 15, 16.5, 0.4);
  rod(g, a, b, 1, M.log());
  for (const t of [0.25, 0.6]) rod(g, a.clone().lerp(b, t - 0.02), a.clone().lerp(b, t + 0.02), 1.1, M.woodDk()); // 縄
  rod(g, b.clone().setX(b.x - 0.2), b.clone().setX(b.x + 1.8), 1.4, M.iron());
  point(g, b.clone().setX(b.x + 1.8), b.clone().setX(b.x + 2.6), 1.2, M.iron(), 8);
}
// 同じ材質の部品を1つの形にまとめる（兵は数が多いので、描く回数を減らす）
function merged(g: Group): Group {
  const byMat = new Map<Material, ReturnType<BoxGeometry['toNonIndexed']>[]>();
  for (const o of g.children) {
    if (!(o instanceof Mesh)) continue;
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    const list = byMat.get(o.material) ?? [];
    list.push(geo);
    byMat.set(o.material, list);
  }
  const out = new Group();
  for (const [m, geos] of byMat) {
    const geo = mergeGeometries(geos);
    if (geo) out.add(new Mesh(geo, m));
  }
  return out;
}

// ---- 前立て -------------------------------------------------------------------
// 兜の前に立てる金の飾り。cx は前立ての列、hy は頭の上端の段
function crest(g: Object3D, kind: AttackerKind, cx: number, hy: number) {
  const c = specOf(kind).crest;
  const gold = M.gold();
  if (c === 'kuwagata') {
    // 鍬形：2本の角を、外へ開いて反らせる
    for (const s of [-1, 1])
      curve(g, [P(cx, hy), P(cx + s * 1.6, hy - 1.6, s * 0.6), P(cx + s * 3.6, hy - 4.6, s)], 0.28, gold);
    ball(g, P(cx, hy - 0.2), 0.5, gold);
  } else if (c === 'short') {
    for (const s of [-1, 1])
      curve(g, [P(cx, hy), P(cx + s * 1, hy - 1, s * 0.4), P(cx + s * 2, hy - 2.4, s * 0.6)], 0.25, gold);
  } else if (c === 'sun') {
    // 日輪：細い竿の先に金の円盤
    rod(g, P(cx, hy + 0.3), P(cx, hy - 1.8), 0.15, gold);
    disc(g, P(cx, hy - 3), 1.5, 0.25, gold);
  } else if (c === 'shida') {
    // 歯朶：額から扇のように開く金の葉
    for (const [dx, dy] of [
      [-3.2, -3.4],
      [-1.7, -4.3],
      [0, -4.7],
      [1.7, -4.3],
      [3.2, -3.4],
    ]) {
      const tip = P(cx + dx, hy + dy);
      rod(g, P(cx, hy), tip, 0.13, gold);
      ball(g, tip, 0.35, gold);
    }
  } else if (c === 'dot') {
    disc(g, P(cx, hy - 1.6), 0.9, 0.2, gold);
  }
}

// 武将と兵の1コマの持ち物（武器と前立て、衝車は丸太）。持ち物がない（斥候）・倒れたコマなら null（絵のまま）
export function buildGear(kind: AttackerKind, frame: Frame): Group | null {
  const g = gearParts(kind, frame);
  return g?.children.length ? merged(g) : null;
}
function gearParts(kind: AttackerKind, frame: Frame): Group | null {
  const sp = specOf(kind);
  if (frame.startsWith('down')) return null;
  if (sp.cart) {
    // 衝車：構えて引き、突き、戻す（絵の丸太と同じ位置）
    const atk = frame.startsWith('atk') ? Number(frame[3]) : -1;
    const g = new Group();
    ram(g, atk === 0 ? 2 : atk === 1 ? 9 : atk === 2 ? 7 : 5);
    return g;
  }
  const { at } = rawFrame(kind, frame);
  if (at.pose !== 'stand' && at.pose !== 'horse') return null;
  const g = new Group();
  const { ox, ty, hy } = at;
  const atk = at.atk;
  // 絵の座標（ox・ty からの位置）で点を作る
  const Q = (x: number, y: number, z = 0.6) => P(ox + x, ty + y, z);
  crest(g, kind, ox + 14, hy);
  const w = sp.weapon;
  if (w === 'sword') {
    if (atk < 0) katana(g, Q(15, 4), Q(17, 2), Q(21, -6));
    else if (atk === 0) katana(g, Q(8, 3, -0.6), Q(6, 3, -0.6), Q(0, 6, -0.6));
    else if (atk === 1) katana(g, Q(18, 1), Q(20, 1), Q(26, 0));
    else katana(g, Q(18, 4), Q(20, 5), Q(25, 9));
  } else if (w === 'spear' || w === 'kama') {
    const kama = w === 'kama';
    if (atk < 0) {
      if (sp.horse) spear(g, Q(13, 6), Q(21, -6), 3.5, kama);
      else spear(g, Q(16, 8), Q(16, -11), 4, kama);
    } else {
      const reach = atk === 1 ? 3 : atk === 0 ? -3 : 1;
      const hx = 15 + reach;
      spear(g, Q(hx - 9, 2), Q(hx + 3, 2), 4, kama);
    }
  } else if (w === 'bow') {
    if (atk === 0) bow(g, ox + 19, ty, Q(12, 2), true);
    else if (atk === 1) bow(g, ox + 19, ty, null, false);
    else bow(g, ox + 18, ty, null, false);
  } else if (w === 'gun') {
    if (atk < 0) gun(g, Q(12.5, 7), Q(20, -2));
    else {
      const k = atk === 2 ? -1 : 0;
      gun(g, Q(12 + k, 1.5), Q(24 + k, 1));
    }
  } else if (w === 'fan') {
    if (atk === 0) fan(g, Q(15, -8), Q(15, -3));
    else if (atk === 1) fan(g, Q(23, 1), Q(18.5, 1));
    else fan(g, Q(19, -1), Q(16, 3));
  } else if (w === 'star') {
    // 構えていないときは、下ろした手に小さく持つ
    if (atk < 0) shuriken(g, Q(16.5, 5.5), 1);
    else if (atk === 0) shuriken(g, Q(11, -4));
    else if (atk === 1) shuriken(g, Q(23, 0));
    else if (atk === 2) shuriken(g, Q(24, 0));
  } else if (w === 'mallet') {
    // 槌：下げて持ち、頭の後ろへ振りかぶり、前へ振り下ろし、地面を叩く（頭は絵の4×3の中心）
    if (atk < 0) mallet(g, Q(16, 4), Q(17.5, -4));
    else if (atk === 0) mallet(g, Q(12, -4), Q(8.5, -8));
    else if (atk === 1) mallet(g, Q(19, 2), Q(22.5, 5));
    else mallet(g, Q(19, 5), Q(21.5, 7));
  } else if (w === 'shield') {
    // 盾：前に立て、攻撃では押し出す
    const push = atk < 0 ? 0 : atk === 0 ? -1 : atk === 1 ? 2 : 1;
    shield(g, ox + 16 + push, ty - 4);
  }
  return g;
}

// ---- 幟 ----------------------------------------------------------------------
// 布は全部の幟で1つの形を使い回し、毎コマ少しずつ揺らす（風になびく）
const CLOTH_W = 9;
const CLOTH_H = 14;
const cloth = new PlaneGeometry(CLOTH_W, CLOTH_H, 12, 6);
cloth.translate(CLOTH_W / 2 + 0.5, 19, 0);
const rest = Float32Array.from(cloth.attributes.position.array as Float32Array);
export function waveFlags(t: number) {
  const pos = cloth.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = rest[i * 3];
    const y = rest[i * 3 + 1];
    const u = Math.max(0, x - 0.5) / CLOTH_W; // 竿からの離れ具合 0〜1
    // 奥（体の板と反対の側）にだけ揺らす。手前にふくらむと、体の板より前に出て顔に重なる
    pos.setZ(i, -(1 + Math.sin(x * 0.8 - t * 4 + y * 0.15)) * 0.6 * u);
  }
  pos.needsUpdate = true;
  cloth.computeVertexNormals();
}
// 幟の布の絵：幟のドット絵から、竿と横木を除いた旗の部分を切り出す
const texCache = new Map<string, CanvasTexture>();
function clothTexture(side: string, mon: string) {
  const key = `${side}|${mon}`;
  let t = texCache.get(key);
  if (!t) {
    const src = flagSprite(side, mon);
    const c = document.createElement('canvas');
    c.width = CLOTH_W + 1;
    c.height = CLOTH_H + 1;
    c.getContext('2d')?.drawImage(src, 1, 1, c.width, c.height, 0, 0, c.width, c.height);
    t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.magFilter = NearestFilter;
    t.minFilter = NearestFilter;
    t.generateMipmaps = false;
    texCache.set(key, t);
  }
  return t;
}
// 幟：竿・横木・金の竿頭と、なびく布。原点は竿の根元の列（足元の高さ）
export function buildFlag(side: string, mon: string): Group {
  const g = new Group();
  rod(g, new Vector3(0, 7, 0), new Vector3(0, 27.8, 0), 0.42, M.pole());
  rod(g, new Vector3(0, 26.6, 0), new Vector3(CLOTH_W + 0.6, 26.6, 0), 0.3, M.pole());
  ball(g, new Vector3(0, 28.2, 0), 0.6, M.gold());
  const m = new MeshPhongMaterial({ map: clothTexture(side, mon), side: DoubleSide, shininess: 5 });
  g.add(new Mesh(cloth, m));
  return g;
}
