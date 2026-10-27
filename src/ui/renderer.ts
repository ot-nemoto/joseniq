import {
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  type Material,
  Mesh,
  MeshLambertMaterial,
  MeshPhongMaterial,
  NearestFilter,
  type Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import {
  type AttackerKind,
  type Battle,
  BDEF,
  type BuildingType,
  check,
  checkMove,
  checkPut,
  type DraftRow,
  type Effect,
  type Footprint,
  fpOf,
  type Gate,
  GDEF,
  type GeneralKind,
  gateSpread,
  H,
  heightAt,
  inRing,
  isBuildingType,
  isGeneralKind,
  type Layout,
  type PlaceResult,
  RING,
  type Tool,
  type Unit,
  W,
  ZONE,
} from '../sim';
import { buildFlag, buildGear, waveFlags } from './gear';
import { ART, buildModel, buildRuin, HEIGHT, LINK, ROOF, roofOf } from './models';
import { type Dying, FALL_TIME, type Motion, MotionTracker, SLASH_TIME } from './motion';
import { Orbit, VIEW_HALF } from './orbit';
import {
  bushoMon,
  type Frame,
  isVehicle,
  SPR_CX,
  SPR_H,
  SPR_UNIT,
  SPR_W,
  spriteScale,
  spriteTop,
  swingsBlade,
  unitSprite,
} from './pixel';
import { buildTerrain, footZ, groundZ, type Heights } from './terrain3d';

export type Mode = 'edit' | 'battle' | 'units';
export interface Tile {
  x: number;
  y: number;
}
export interface View {
  mode: Mode;
  layout: Layout;
  battle: Battle | null;
  hover: Tile | null;
  tool: Tool | null; // 選んでいる施設の道具（何も選んでいなければ null）
  unitSel: AttackerKind | null; // 攻城で選んでいる兵種・武将（何も選んでいなければ null）
  drag: Drag | null; // ドラッグで動かしている武将・施設（配置画面）
  cursor: Tile | null; // キーボードで選んでいるマス（配置画面で盤面にフォーカスがあるとき）
  siege: SiegeView | null; // 開戦前の、攻城配置の出撃の予定
  deployOk: boolean; // 選んでいる兵種を、今手動で出せるか（予定の分の兵力や武将の人数も含めて）
}
// 攻城配置：口と、口ごとの出撃の予定。drag はパネルからドラッグしている武将
export interface SiegeView {
  gates: readonly Gate[];
  rows: readonly DraftRow[];
  drag: AttackerKind | null;
  canPlan: (x: number, y: number) => boolean; // ドラッグしているか選んでいる兵種・武将を、そのマスの予定に入れられるか
}
// ドラッグで動かしているもの：武将（g）か、i番目の施設（b）
// 施設は、つかんだマスの、施設の左上からのずれ（ox, oy）も持つ（2×2の本丸を、つかんだマスのまま動かすため）
export type Drag = { k: 'g'; kind: GeneralKind } | { k: 'b'; i: number; type: BuildingType; ox: number; oy: number };
// 置こうとしているもの（ドラッグ中なら動かしているもの）と、そのマスに置けるか。
// 何も選んでおらず、まだ何もつかんでいなければ null（影は出さない）
interface Ghost {
  tool: Tool | BuildingType;
  r: PlaceResult;
  x: number; // 置く位置（施設の左上）
  y: number;
}
const fpInBoard = (f: Footprint) => f.x0 >= 0 && f.y0 >= 0 && f.x0 + f.w <= W && f.y0 + f.h <= H;
function fpTiles(f: Footprint): [number, number][] {
  const out: [number, number][] = [];
  for (let y = f.y0; y < f.y0 + f.h; y++) for (let x = f.x0; x < f.x0 + f.w; x++) out.push([x, y]);
  return out;
}
function ghostOf(v: View, x: number, y: number): Ghost | null {
  const d = v.drag;
  // 何も選んでいないときは、つかむまで何も出さない
  if (!d) return v.tool ? { tool: v.tool, r: check(v.layout, v.tool, x, y), x, y } : null;
  if (d.k === 'g') return { tool: d.kind, r: checkPut(v.layout, d.kind, x, y), x, y };
  return { tool: d.type, r: checkMove(v.layout, d.i, x - d.ox, y - d.oy), x: x - d.ox, y: y - d.oy };
}
// 動かしているものは、元の位置に薄く出す
const draggedB = (v: View, i: number) => (v.drag?.k === 'b' && v.drag.i === i ? 0.3 : 1);
const draggedG = (v: View, k: GeneralKind) => (v.drag?.k === 'g' && v.drag.kind === k ? 0.3 : 1);

const FONT = '"Shippori Mincho B1","Hiragino Mincho ProN","Yu Mincho",serif';
const PAL_VARS = {
  field: '--field',
  field2: '--field2',
  ringEdit: '--ringEdit',
  deploy: '--deploy',
  wall: '--wall',
  wallDk: '--wallDk',
  moat: '--moat',
  atk: '--atk',
  atkInk: '--atkInk',
  def: '--def',
  defInk: '--defInk',
  gold: '--gold',
  fire: '--fire',
  hp: '--hp',
  hpBack: '--hpBack',
  ink: '--ink',
  muted: '--muted',
  bad: '--bad',
} as const;
type Palette = Record<keyof typeof PAL_VARS, string>;

// ---- 3D表示 -----------------------------------------------------------------
// 盤面は three.js で描く。地面の上の平らなもの（市松・城域・堀・射程の円・影など）は、
// これまでどおり Canvas 2D で地面の絵に描き、地形の上面に貼る。建物は立体（models.ts）、
// 武将と兵はドット絵をこちらに向けた板（Sprite）にする。体力のバーや数・矢・斬撃は、上に重ねた canvas に描く
const ASPECT = 0.66; // 盤面の画面の縦÷横
const GPX = 32; // 地面の絵の、1マスあたりの画素数
const DOT = Math.SQRT2 / SPR_UNIT; // ドット1つの大きさ（マス）。1マスの対角に SPR_UNIT ドットが並ぶ大きさ
const FLY = 0.58; // 矢と命中を描く、地面からの高さ
// 重ねる canvas の長さの単位：1マスの対角の、画面の上の長さ（斜め表示の絵の寸法をそのまま使うため）
const HUD_UNIT = Math.SQRT2;
// パネルのボタンの絵の天守の高さ（鯱の先まで）。この高さが敷地の縦にちょうど収まるよう縮尺を決める
const CASTLE_TOP = 2.15;
// 駒の描き方の変化：揺れ・傾き・踏み込み・斬撃・倒れ
interface Pose {
  bob: number;
  lean: number;
  bx: number; // 盤面の上の向き（単位ベクトル）。踏み込む向き
  by: number;
  dx: number; // 画面上の向き（単位ベクトル）
  dy: number;
  slash: number; // 斬る動きの進み 0〜1（斬っていなければ -1）
  fall: number; // 倒れる動きの進み 0〜1（倒れていなければ -1）
  face: number; // 左右の向き（1 か -1）
  dust: number; // 足元の土ぼこりの濃さ 0〜1
  step: number; // 足の運び -1〜1
  phase: number; // 歩いた歩数（ドット絵の歩くコマを選ぶ）
  mv: number; // 動いている度合い 0〜1
}
interface Pt {
  x: number;
  y: number;
}
interface Rect {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

function ctx2d(c: HTMLCanvasElement) {
  const g = c.getContext('2d');
  if (!g) throw new Error('canvas 2d が使えません');
  return g;
}

export function createRenderer(cv: HTMLCanvasElement) {
  // 地面の絵。ふだんはここに描く。パネルのボタンの絵（drawIcon）や重ねる canvas を描くあいだだけ、ctx を切り替える
  const ground = document.createElement('canvas');
  ground.width = W * GPX;
  ground.height = H * GPX;
  const gctx = ctx2d(ground);
  // 体力のバー・数・矢・斬撃を重ねる canvas。マウスの操作は下の盤面に通す
  const hud = document.createElement('canvas');
  hud.className = 'hud';
  hud.setAttribute('aria-hidden', 'true');
  cv.after(hud);
  const hctx = ctx2d(hud);
  let ctx: CanvasRenderingContext2D = gctx;
  let pal = readPal();
  let frameNo = 0;
  // 武将と兵の動き：戦闘の計算は変えず、前のコマとの差から歩く・斬る・倒れるを読み取る
  const tracker = new MotionTracker(); // 武将と兵の動きの記録（motion.ts）
  const poses = new Map<number, Pose>(); // このコマの姿勢（描画と斬撃の弧で使い回す）

  // three.js の準備
  const gl = new WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = PCFShadowMap;
  const scene = new Scene();
  const camera = new PerspectiveCamera();
  const orbit = new Orbit(cv);
  // 空と地面からの光：上を向いた面は空の色、下を向いた面は土の色で照らす
  scene.add(new HemisphereLight('#f4f7ff', '#b8a684', 1.7));
  // 日の光：右手前の上から当てる。建物の影を地面に落とす
  const sun = new DirectionalLight('#fff3dc', 1.9);
  sun.position.set(W / 2 + 18, 17, H / 2 + 5);
  sun.target.position.set(W / 2, 0, H / 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 90 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const groundTex = new CanvasTexture(ground);
  groundTex.colorSpace = SRGBColorSpace;
  groundTex.anisotropy = gl.capabilities.getMaxAnisotropy();
  const groundMat = new MeshLambertMaterial({ map: groundTex });
  const models = new Group(); // 建物
  const sprites = new Group(); // 武将と兵（ドット絵の板）
  scene.add(models, sprites);

  function readPal(): Palette {
    const cs = getComputedStyle(document.documentElement);
    const p = {} as Palette;
    for (const [k, v] of Object.entries(PAL_VARS)) p[k as keyof Palette] = cs.getPropertyValue(v).trim();
    return p;
  }
  function resize() {
    const parent = cv.parentElement;
    const w = parent ? parent.clientWidth : 0; // 枠線を除いた幅
    if (!w) return;
    const h = Math.round(w * ASPECT);
    // 幅はCSSの100%のままにする（固定の幅を書き込むと、盤面の枠が狭まったときに縮まなくなる）
    gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    gl.setSize(w, h, false);
    cv.style.height = `${h}px`;
    hud.width = cv.width;
    hud.height = cv.height;
    hud.style.height = `${h}px`;
  }
  if (cv.parentElement) new ResizeObserver(resize).observe(cv.parentElement);
  window.addEventListener('resize', resize);

  function text(str: string, x: number, y: number, size: number, color: string, weight = 800) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(0.01, 0.01);
    ctx.font = `${weight} ${size * 100}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(str, 0, 0.04 * 100);
    ctx.restore();
  }
  function rr(x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }
  function hpBar(cx: number, y: number, w: number, ratio: number) {
    ctx.fillStyle = pal.hpBack;
    ctx.fillRect(cx - w / 2, y, w, 0.09);
    ctx.fillStyle = pal.hp;
    ctx.fillRect(cx - w / 2, y, w * Math.max(0, ratio), 0.09);
  }
  function badTile(x: number, y: number) {
    ctx.save();
    ctx.strokeStyle = pal.bad;
    ctx.lineWidth = 0.08;
    ctx.strokeRect(x + 0.06, y + 0.06, 0.88, 0.88);
    ctx.restore();
  }
  function face(pts: Pt[], color: string, shade: number) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    if (shade > 0) {
      ctx.fillStyle = `rgba(0,0,0,${shade})`;
      ctx.fill();
    }
  }

  // 施設の2Dの絵（パネルのボタンの絵）。堀は地面の絵にもこれで描く
  function drawBuilding(type: BuildingType, x0: number, y0: number, w: number, h: number, alpha: number) {
    ctx.save();
    ctx.globalAlpha = alpha;
    if (type === 'wall') {
      ctx.fillStyle = pal.wall;
      ctx.fillRect(x0 + 0.03, y0 + 0.03, 0.94, 0.94);
      ctx.strokeStyle = pal.wallDk;
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.moveTo(x0, y0 + 0.5);
      ctx.lineTo(x0 + 1, y0 + 0.5);
      ctx.moveTo(x0 + 0.5, y0);
      ctx.lineTo(x0 + 0.5, y0 + 0.5);
      ctx.moveTo(x0 + 0.25, y0 + 0.5);
      ctx.lineTo(x0 + 0.25, y0 + 1);
      ctx.moveTo(x0 + 0.75, y0 + 0.5);
      ctx.lineTo(x0 + 0.75, y0 + 1);
      ctx.stroke();
    } else if (type === 'moat') {
      ctx.fillStyle = pal.moat;
      ctx.fillRect(x0, y0, 1, 1);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.moveTo(x0 + 0.15, y0 + 0.4);
      ctx.quadraticCurveTo(x0 + 0.32, y0 + 0.25, x0 + 0.5, y0 + 0.4);
      ctx.quadraticCurveTo(x0 + 0.68, y0 + 0.55, x0 + 0.85, y0 + 0.4);
      ctx.moveTo(x0 + 0.15, y0 + 0.75);
      ctx.quadraticCurveTo(x0 + 0.32, y0 + 0.6, x0 + 0.5, y0 + 0.75);
      ctx.quadraticCurveTo(x0 + 0.68, y0 + 0.9, x0 + 0.85, y0 + 0.75);
      ctx.stroke();
    } else drawSide(type, x0, y0, w, h);
    ctx.restore();
  }
  // 正面から見た建物の絵を描く道具。(cx, yb) を足元の中心に、s 倍の寸法で描く。v は下からの高さ
  function sideKit(cx: number, yb: number, s: number, roofColor = ROOF.tile) {
    const P = (u: number, v: number): Pt => ({ x: cx + u * s, y: yb - v * s });
    const EDGE = 0.025;
    function poly(pts: Pt[], color: string, edge?: string) {
      face(pts, color, 0);
      if (edge) {
        ctx.strokeStyle = edge;
        ctx.lineWidth = EDGE;
        ctx.stroke();
      }
    }
    function line(a: Pt, b: Pt, color: string, width: number) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    function circle(c: Pt, r: number, color: string, edge?: string) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, r * s, 0, 7);
      ctx.fillStyle = color;
      ctx.fill();
      if (edge) {
        ctx.strokeStyle = edge;
        ctx.lineWidth = EDGE;
        ctx.stroke();
      }
    }
    // 地面の影
    function shadow() {
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.beginPath();
      ctx.ellipse(cx, yb, 0.95 * s, 0.1 * s, 0, 0, 7);
      ctx.fill();
    }
    // 石垣：下の幅 bottom・上の幅 top の台形に目地を入れる
    function stone(bottom: number, top: number, v1: number) {
      poly([P(-bottom, 0), P(bottom, 0), P(top, v1), P(-top, v1)], pal.wall, pal.wallDk);
      ctx.strokeStyle = pal.wallDk;
      ctx.lineWidth = EDGE * 0.8;
      ctx.beginPath();
      for (const t of [1 / 3, 2 / 3]) {
        const half = bottom + (top - bottom) * t;
        const a = P(-half, v1 * t);
        const b = P(half, v1 * t);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    }
    // 壁の層：下に下見板、上に窓。鉄砲櫓は壁を黒く、窓（狭間）を白くする
    function tier(half: number, v0: number, v1: number, windows: number, wall = ART.plaster, ink = ART.board) {
      poly([P(-half, v0), P(half, v0), P(half, v1), P(-half, v1)], wall, ART.roofEdge);
      const vb = v0 + (v1 - v0) * 0.3;
      poly([P(-half, v0), P(half, v0), P(half, vb), P(-half, vb)], ART.board);
      for (let i = 0; i < windows; i++) {
        const u = -half + ((i + 0.5) * 2 * half) / windows;
        const wv0 = v0 + (v1 - v0) * 0.46;
        const wv1 = v0 + (v1 - v0) * 0.82;
        poly([P(u - 0.07, wv0), P(u + 0.07, wv0), P(u + 0.07, wv1), P(u - 0.07, wv1)], ink);
      }
    }
    // 屋根：軒先は両端が反り上がる曲線、上は次の層の幅（0なら尖る）まで
    function roof(eave: number, v0: number, top: number, v1: number) {
      const l = P(-eave, v0 + 0.06);
      const r = P(eave, v0 + 0.06);
      const m = P(0, v0 - 0.03);
      ctx.beginPath();
      ctx.moveTo(l.x, l.y);
      ctx.quadraticCurveTo(m.x, m.y, r.x, r.y);
      for (const q of [P(top, v1), P(-top, v1)]) ctx.lineTo(q.x, q.y);
      ctx.closePath();
      ctx.fillStyle = roofColor.fill;
      ctx.fill();
      ctx.strokeStyle = roofColor.edge;
      ctx.lineWidth = EDGE;
      ctx.stroke();
      // 軒の裏の影
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = EDGE * 2;
      ctx.beginPath();
      ctx.moveTo(l.x, l.y);
      ctx.quadraticCurveTo(m.x, m.y, r.x, r.y);
      ctx.stroke();
    }
    // 金の鯱を棟の両端に
    function shachi(half: number, v: number) {
      ctx.fillStyle = pal.gold;
      for (const d of [-1, 1]) {
        const base = P(half * d, v);
        const tip = P((half + 0.04) * d, v + 0.14);
        ctx.beginPath();
        ctx.moveTo(base.x - 0.04 * s, base.y);
        ctx.quadraticCurveTo(base.x - 0.05 * s * d, tip.y, tip.x, tip.y);
        ctx.lineTo(base.x + 0.04 * s, base.y);
        ctx.closePath();
        ctx.fill();
      }
    }
    return { P, poly, line, circle, shadow, stone, tier, roof, shachi };
  }
  // ボタンの絵の本丸：正面から見た天守。(cx, yb) を足元の中心に、横 s・縦 sy 倍の寸法で描く。v は下からの高さ。
  // 横は u=±1、縦は鯱の先 v=CASTLE_TOP までで、敷地いっぱいに収める
  function drawCastleSide(cx: number, yb: number, s: number, sy: number) {
    const P = (u: number, v: number): Pt => ({ x: cx + u * s, y: yb - v * sy });
    const moveTo = (p: Pt) => ctx.moveTo(p.x, p.y);
    const lineTo = (p: Pt) => ctx.lineTo(p.x, p.y);
    const quadTo = (c: Pt, p: Pt) => ctx.quadraticCurveTo(c.x, c.y, p.x, p.y);
    const bezTo = (c1: Pt, c2: Pt, p: Pt) => ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p.x, p.y);
    const rect = (u0: number, v0: number, u1: number, v1: number) => {
      ctx.beginPath();
      moveTo(P(u0, v0));
      lineTo(P(u1, v0));
      lineTo(P(u1, v1));
      lineTo(P(u0, v1));
      ctx.closePath();
    };
    const stroke = (color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width * s;
      ctx.stroke();
    };
    // 今の形に、左から光が当たる陰（横）や上が明るい陰（縦）を重ねる
    const shadeX = (u0: number, u1: number, a0: number, a1: number) => {
      const g = ctx.createLinearGradient(P(u0, 0).x, 0, P(u1, 0).x, 0);
      g.addColorStop(0, `rgba(255,255,255,${a0})`);
      g.addColorStop(1, `rgba(0,0,0,${a1})`);
      ctx.fillStyle = g;
      ctx.fill();
    };
    const shadeY = (v0: number, v1: number, top: number, bottom: number) => {
      const g = ctx.createLinearGradient(0, P(0, v1).y, 0, P(0, v0).y);
      g.addColorStop(0, `rgba(255,255,255,${top})`);
      g.addColorStop(1, `rgba(0,0,0,${bottom})`);
      ctx.fillStyle = g;
      ctx.fill();
    };
    const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

    // 石垣：裾が広がる反りのある台に、石を互い違いに積む
    function base(bottom: number, top: number, v1: number) {
      const path = () => {
        ctx.beginPath();
        moveTo(P(-bottom, 0));
        lineTo(P(bottom, 0));
        quadTo(P(top + 0.05, v1 * 0.25), P(top, v1));
        lineTo(P(-top, v1));
        quadTo(P(-top - 0.05, v1 * 0.25), P(-bottom, 0));
        ctx.closePath();
      };
      path();
      ctx.fillStyle = pal.wall;
      ctx.fill();
      shadeX(-bottom, bottom, 0.18, 0.22);
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = pal.wallDk;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 0.012 * s;
      ctx.beginPath();
      const rows = 4;
      for (let r = 0; r < rows; r++) {
        const va = (v1 * r) / rows;
        const vb = (v1 * (r + 1)) / rows;
        moveTo(P(-bottom, vb));
        lineTo(P(bottom, vb));
        for (let u = -bottom + (r % 2) * 0.11; u < bottom; u += 0.22) {
          moveTo(P(u, va));
          lineTo(P(u, vb));
        }
      }
      ctx.stroke();
      ctx.restore();
      path();
      stroke(pal.wallDk, 0.025);
    }
    // 白壁の層：下に黒い下見板、上に窓（格子窓、または上が丸い花頭窓）
    function tier(half: number, v0: number, v1: number, windows: number, bell = false) {
      rect(-half, v0, half, v1);
      ctx.fillStyle = ART.plaster;
      ctx.fill();
      shadeX(-half, half, 0.3, 0.12);
      const vb = v0 + (v1 - v0) * 0.32;
      rect(-half, v0, half, vb);
      ctx.fillStyle = ART.board;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.13)';
      ctx.lineWidth = 0.008 * s;
      ctx.beginPath();
      for (let u = -half + 0.06; u < half; u += 0.07) {
        moveTo(P(u, v0));
        lineTo(P(u, vb));
      }
      ctx.stroke();
      const w0 = v0 + (v1 - v0) * 0.46;
      const w1 = v0 + (v1 - v0) * 0.86;
      for (let i = 0; i < windows; i++) {
        const u = -half + ((i + 0.5) * 2 * half) / windows;
        const hw = 0.065;
        ctx.beginPath();
        moveTo(P(u - hw, w0));
        lineTo(P(u + hw, w0));
        if (bell) {
          lineTo(P(u + hw, w1 - hw));
          quadTo(P(u + hw, w1), P(u, w1 + 0.02));
          quadTo(P(u - hw, w1), P(u - hw, w1 - hw));
        } else {
          lineTo(P(u + hw, w1));
          lineTo(P(u - hw, w1));
        }
        ctx.closePath();
        ctx.fillStyle = ART.board;
        ctx.fill();
        if (!bell) {
          ctx.strokeStyle = ART.plaster;
          ctx.lineWidth = 0.012 * s;
          ctx.beginPath();
          for (const d of [-0.022, 0.022]) {
            moveTo(P(u + d, w0));
            lineTo(P(u + d, w1));
          }
          ctx.stroke();
        }
      }
      rect(-half, v0, half, v1);
      stroke(ART.roofEdge, 0.018);
    }
    // 屋根：軒先は強く反り上がり、瓦の筋・軒の裏の影・棟の線を入れる
    function roof(eave: number, v0: number, top: number, v1: number) {
      const l = P(-eave - 0.04, v0 + 0.1);
      const r = P(eave + 0.04, v0 + 0.1);
      const m = P(0, v0 - 0.06);
      const path = () => {
        ctx.beginPath();
        moveTo(l);
        quadTo(m, r);
        lineTo(P(top, v1));
        lineTo(P(-top, v1));
        ctx.closePath();
      };
      path();
      ctx.fillStyle = ROOF.tile.fill;
      ctx.fill();
      shadeY(v0, v1, 0.22, 0.14);
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.lineWidth = 0.01 * s;
      ctx.beginPath();
      const n = Math.round(eave * 18);
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const e = {
          x: (1 - t) ** 2 * l.x + 2 * (1 - t) * t * m.x + t * t * r.x,
          y: (1 - t) ** 2 * l.y + 2 * (1 - t) * t * m.y + t * t * r.y,
        };
        moveTo(e);
        lineTo(lerp(P(-top, v1), P(top, v1), t));
      }
      ctx.stroke();
      ctx.restore();
      path();
      stroke(ROOF.tile.edge, 0.022);
      // 軒の裏の影
      ctx.beginPath();
      moveTo({ x: l.x, y: l.y + 0.02 * s });
      quadTo({ x: m.x, y: m.y + 0.02 * s }, { x: r.x, y: r.y + 0.02 * s });
      stroke('rgba(0,0,0,0.45)', 0.035);
      // 棟
      ctx.beginPath();
      moveTo(P(-top - 0.02, v1));
      lineTo(P(top + 0.02, v1));
      stroke(ROOF.tile.edge, 0.04);
    }
    // 金の懸魚（破風の飾り）
    const gegyo = (u: number, v: number) => {
      ctx.beginPath();
      moveTo(P(u, v + 0.035));
      lineTo(P(u + 0.03, v));
      lineTo(P(u, v - 0.04));
      lineTo(P(u - 0.03, v));
      ctx.closePath();
      ctx.fillStyle = pal.gold;
      ctx.fill();
    };
    // 千鳥破風・入母屋の妻：三角の白壁に、屋根の縁を太く
    function gable(u: number, hw: number, vb: number, vt: number) {
      ctx.beginPath();
      moveTo(P(u - hw, vb));
      lineTo(P(u + hw, vb));
      lineTo(P(u, vt));
      ctx.closePath();
      ctx.fillStyle = ART.plaster;
      ctx.fill();
      shadeX(u - hw, u + hw, 0.2, 0.1);
      ctx.beginPath();
      moveTo(P(u - hw - 0.03, vb - 0.02));
      lineTo(P(u, vt + 0.02));
      lineTo(P(u + hw + 0.03, vb - 0.02));
      stroke(ROOF.tile.edge, 0.04);
      gegyo(u, vt - 0.06);
    }
    // 唐破風：中央が盛り上がる曲線の破風
    function karahafu(hw: number, vb: number, vt: number) {
      ctx.beginPath();
      moveTo(P(-hw, vb));
      bezTo(P(-hw * 0.55, vb), P(-hw * 0.45, vt), P(0, vt));
      bezTo(P(hw * 0.45, vt), P(hw * 0.55, vb), P(hw, vb));
      ctx.closePath();
      ctx.fillStyle = ART.plaster;
      ctx.fill();
      shadeX(-hw, hw, 0.2, 0.1);
      ctx.beginPath();
      moveTo(P(-hw - 0.04, vb - 0.02));
      bezTo(P(-hw * 0.55, vb - 0.02), P(-hw * 0.45, vt + 0.03), P(0, vt + 0.03));
      bezTo(P(hw * 0.45, vt + 0.03), P(hw * 0.55, vb - 0.02), P(hw + 0.04, vb - 0.02));
      stroke(ROOF.tile.edge, 0.045);
      gegyo(0, vt - 0.07);
    }
    // 高欄（最上階の手すり）
    function balcony(half: number, v0: number, v1: number) {
      rect(-half, v0, half, v1);
      ctx.fillStyle = ART.board;
      ctx.fill();
      ctx.strokeStyle = ART.plaster;
      ctx.lineWidth = 0.008 * s;
      ctx.beginPath();
      moveTo(P(-half, (v0 + v1) / 2));
      lineTo(P(half, (v0 + v1) / 2));
      for (let u = -half + 0.07; u < half; u += 0.09) {
        moveTo(P(u, v0));
        lineTo(P(u, v1));
      }
      ctx.stroke();
    }
    // 金の鯱：棟の両端で尾を外へ反らせる
    function shachi(half: number, v: number) {
      for (const d of [-1, 1]) {
        const b0 = P((half - 0.04) * d, v);
        const b1 = P((half + 0.04) * d, v);
        const tip = P((half + 0.07) * d, v + 0.15);
        ctx.beginPath();
        moveTo(b0);
        quadTo(P((half - 0.04) * d, v + 0.1), tip);
        quadTo(P((half + 0.02) * d, v + 0.06), b1);
        ctx.closePath();
        ctx.fillStyle = pal.gold;
        ctx.fill();
        stroke('rgba(90,60,10,0.6)', 0.01);
        ctx.beginPath();
        moveTo(P((half - 0.01) * d, v + 0.03));
        quadTo(P((half - 0.02) * d, v + 0.08), lerp(tip, b0, 0.25));
        stroke('rgba(255,240,190,0.85)', 0.012);
      }
    }

    // 地面の影
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(cx, yb - 0.02, 0.98 * s, 0.03, 0, 0, 7);
    ctx.fill();
    base(0.99, 0.82, 0.42);
    tier(0.74, 0.42, 0.8, 5);
    roof(0.95, 0.78, 0.58, 0.96);
    tier(0.58, 0.96, 1.26, 4);
    for (const u of [-0.38, 0.38]) gable(u, 0.14, 0.86, 1.05);
    roof(0.8, 1.24, 0.44, 1.4);
    balcony(0.5, 1.4, 1.46);
    tier(0.42, 1.46, 1.72, 3, true);
    karahafu(0.23, 1.27, 1.45);
    roof(0.66, 1.7, 0.22, 2.0);
    gable(0, 0.16, 1.8, 2.0);
    shachi(0.22, 2.0);
    // 何の建物か分かるよう、石垣に「本丸」の扁額を掛ける
    const lc = P(0, 0.2);
    ctx.fillStyle = ART.board;
    rr(lc.x - 0.3 * s, lc.y - 0.11 * s, 0.6 * s, 0.22 * s, 0.03 * s);
    ctx.fill();
    ctx.strokeStyle = pal.gold;
    ctx.lineWidth = 0.02 * s;
    ctx.stroke();
    text('本丸', lc.x, lc.y, 0.16 * s, pal.gold);
  }
  // ボタンの絵の施設と本丸：正面から見た絵を敷地の中に描く。寸法は敷地の半分を1とした値
  function drawSide(type: BuildingType, x0: number, y0: number, w: number, h: number) {
    const s = Math.min(w, h) / 2;
    const roofColor = roofOf(type);
    const k = sideKit(x0 + w / 2, y0 + h - 0.06 * s, s, roofColor);
    const { P } = k;
    if (type !== 'bar' && type !== 'hall') k.shadow();
    if (type === 'hall') drawCastleSide(x0 + w / 2, y0 + h - 0.03, s * 0.99, (h - 0.06) / CASTLE_TOP);
    else if (type === 'tbow') {
      // 櫓（弓）：緑青の屋根の二重櫓。1層目の壁に矢をつがえた弓
      k.stone(0.9, 0.76, 0.3);
      k.tier(0.62, 0.3, 0.78, 0);
      // 弓幹は右へふくらませ、弦は左、矢は右向き
      const c = P(0, 0.56);
      const r = 0.24 * s;
      const ox = c.x - 0.55 * r;
      const ex = ox + r * Math.cos(1.05);
      const ey = r * Math.sin(1.05);
      ctx.lineCap = 'round';
      ctx.strokeStyle = ART.board;
      ctx.lineWidth = 0.012;
      ctx.beginPath();
      ctx.moveTo(ex, c.y - ey);
      ctx.lineTo(ex, c.y + ey);
      ctx.moveTo(c.x - 0.5 * r, c.y);
      ctx.lineTo(c.x + 0.75 * r, c.y);
      ctx.stroke();
      ctx.strokeStyle = ART.bow;
      ctx.lineWidth = 0.035;
      ctx.beginPath();
      ctx.arc(ox, c.y, r, -1.05, 1.05);
      ctx.stroke();
      k.poly(
        [
          { x: c.x + 0.95 * r, y: c.y },
          { x: c.x + 0.7 * r, y: c.y - 0.13 * r },
          { x: c.x + 0.7 * r, y: c.y + 0.13 * r },
        ],
        ART.board,
      );
      k.roof(0.88, 0.76, 0.48, 0.94);
      k.tier(0.46, 0.94, 1.28, 1);
      k.roof(0.72, 1.26, 0.14, 1.62);
    } else if (type === 'tgun') {
      // 櫓（鉄砲）：黒い瓦屋根、黒い板張りに白い狭間を並べた一重の櫓
      k.stone(0.9, 0.76, 0.3);
      k.tier(0.66, 0.3, 1.08, 3, ART.board, ART.plaster);
      // 狭間に銃口、両脇の壁から銃身を突き出す
      const vm = 0.3 + 0.78 * 0.64;
      for (const u of [-0.44, 0, 0.44]) k.circle(P(u, vm), 0.045, ART.gun);
      for (const d of [-1, 1]) k.line(P(0.66 * d, vm), P(0.98 * d, vm + 0.03), ART.gun, 0.045);
      k.roof(0.92, 1.06, 0.22, 1.55);
    } else if (type === 'bar') {
      // 拒馬：マスを2×2に分け、それぞれに横木と X 字の杭を1組ずつ描く
      for (const [qx, qy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]) {
        const q = sideKit(x0 + (w * (qx + 0.5)) / 2, y0 + (h * (qy + 1)) / 2 - 0.03, s / 2);
        q.shadow();
        q.line(q.P(-0.95, 0.42), q.P(0.95, 0.42), ART.wood, 0.035);
        for (const d of [-1, 1]) {
          const lo = q.P(-0.5 * d, 0.04);
          const hi = q.P(0.5 * d, 0.88);
          q.line(lo, hi, ART.woodDk, 0.04);
          q.line({ x: lo.x + (hi.x - lo.x) * 0.8, y: lo.y + (hi.y - lo.y) * 0.8 }, hi, ART.stakeTip, 0.032);
        }
      }
    } else if (type === 'cata') {
      // 大筒：木の台に載せた青銅の筒を、左上へ向ける。筒には上側の照りと金の帯、台には車輪
      k.poly([P(-0.62, 0.14), P(0.66, 0.14), P(0.66, 0.36), P(-0.3, 0.5), P(-0.62, 0.5)], ART.wood, ART.woodDk);
      for (const u of [-0.4, 0.4]) {
        k.circle(P(u, 0.16), 0.17, ART.woodDk);
        k.circle(P(u, 0.16), 0.05, pal.gold);
      }
      k.line(P(0.6, 0.5), P(-0.78, 1.08), ART.bronze, 0.15);
      k.circle(P(0.62, 0.49), 0.12, ART.bronze);
      k.line(P(0.52, 0.61), P(-0.62, 1.09), ART.bronzeHi, 0.03);
      for (const t of [0.3, 0.72])
        k.line(P(0.6 - 1.38 * t, 0.5 + 0.58 * t - 0.12), P(0.6 - 1.38 * t, 0.5 + 0.58 * t + 0.12), pal.gold, 0.035);
      k.circle(P(-0.8, 1.09), 0.1, ART.gun, ART.bronze);
    } else if (type === 'gate') {
      // 門：両脇の柱のあいだに、横木を渡した観音開きの扉。金の鋲を打ち、上に瓦屋根を載せる
      for (const u of [-0.82, 0.82]) k.line(P(u, 0), P(u, 1.02), ART.woodDk, 0.07);
      k.poly([P(-0.74, 0), P(0.74, 0), P(0.74, 0.92), P(-0.74, 0.92)], ART.wood, ART.woodDk);
      k.line(P(0, 0), P(0, 0.92), ART.woodDk, 0.025);
      for (const v of [0.28, 0.64]) k.line(P(-0.74, v), P(0.74, v), ART.woodDk, 0.04);
      for (const u of [-0.5, -0.2, 0.2, 0.5]) for (const v of [0.28, 0.64]) k.circle(P(u, v), 0.035, pal.gold);
      k.roof(0.98, 0.98, 0.32, 1.34);
    } else if (type === 'drum') {
      // 鼓楼：低い石垣に柱を立て、大太鼓を吊った楼
      k.stone(0.9, 0.8, 0.2);
      for (const u of [-0.6, 0.6]) k.line(P(u, 0.2), P(u, 1.12), ART.woodDk, 0.05);
      k.circle(P(0, 0.66), 0.34, ART.drum, ART.woodDk);
      k.circle(P(0, 0.66), 0.23, ART.drumFace, ART.woodDk);
      k.roof(0.86, 1.1, 0, 1.58);
      k.circle(P(0, 1.6), 0.06, pal.gold);
    }
  }
  // 壊れた施設の跡。門と大筒は破片を散らし（通れる）、櫓・鼓楼は壊れた櫓の絵が残る（石垣の台があり、通れない）
  const leavesBase = (t: BuildingType) => !BDEF[t].breakThrough && t !== 'hall';
  // 門と大筒の跡：破片を地面に散らす（通れる）
  function drawRubble(b: Rect) {
    ctx.save();
    ctx.fillStyle = 'rgba(70,60,50,0.32)';
    for (let yy = b.y0; yy < b.y0 + b.h; yy++)
      for (let xx = b.x0; xx < b.x0 + b.w; xx++) {
        ctx.fillRect(xx + 0.2, yy + 0.25, 0.3, 0.22);
        ctx.fillRect(xx + 0.5, yy + 0.55, 0.28, 0.2);
      }
    ctx.restore();
  }
  // ---- 武将の動き ----
  // 動きを記録し、このコマの姿勢を決める。戻り値は動きの時計の値
  function trackMotion(b: Battle) {
    const t = tracker.update(b, performance.now());
    poses.clear();
    for (const [id, m] of tracker.motions) poses.set(id, poseFor(m, t));
    return t;
  }
  // 盤面の向き (x, y) を、単位ベクトルにする
  function unit(x: number, y: number): [number, number] {
    const l = Math.hypot(x, y);
    return l > 1e-6 ? [x / l, y / l] : [1, 0];
  }
  // 盤面の向きを、今のカメラで見た画面の向き（右・下が正）に直す
  const camRight = new Vector3();
  const camUp = new Vector3();
  function screenDir(x: number, y: number): [number, number] {
    camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    camUp.setFromMatrixColumn(camera.matrixWorld, 1);
    return unit(camRight.x * x + camRight.z * y, -(camUp.x * x + camUp.z * y));
  }
  function poseFor(m: Motion, t: number): Pose {
    const slash = m.atk >= 0 && t - m.atk < SLASH_TIME ? (t - m.atk) / SLASH_TIME : -1;
    const [bx, by] = slash >= 0 ? unit(m.ax, m.ay) : unit(m.mx, m.my);
    const [dx, dy] = screenDir(bx, by);
    const step = Math.sin(m.walk * Math.PI * 2.2);
    return {
      bob: Math.abs(step) * 0.07 * m.mv,
      lean: step * 0.07 * m.mv,
      bx,
      by,
      dx,
      dy,
      slash,
      fall: -1,
      face: dx < 0 ? -1 : 1,
      dust: m.mv * (1 - Math.abs(step)),
      step,
      phase: m.walk * 1.1,
      mv: m.mv,
    };
  }
  function dyingPose(d: Dying, t: number): Pose {
    const [bx, by] = unit(d.mx, d.my);
    const [dx, dy] = screenDir(bx, by);
    return {
      bob: 0,
      lean: 0,
      bx,
      by,
      dx,
      dy,
      slash: -1,
      fall: Math.min(1, (t - d.t0) / FALL_TIME),
      face: dx < 0 ? -1 : 1,
      dust: 0,
      step: 0,
      phase: 0,
      mv: 0,
    };
  }
  // 足が着くたびに、進む向きの後ろへ小さな土ぼこりを上げる（地面の絵に描く）
  function dust(x: number, y: number, p: Pose) {
    ctx.save();
    ctx.globalAlpha *= 0.55 * p.dust;
    ctx.fillStyle = ART.dust;
    for (const [k, r] of [
      [0.36, 0.1],
      [0.54, 0.07],
    ]) {
      ctx.beginPath();
      ctx.ellipse(x - p.bx * k, y - p.by * k, r * 1.4, r * 1.4, 0, 0, 7);
      ctx.fill();
    }
    ctx.restore();
  }
  // 斬撃：向いた側に刀を振り下ろし、白い弧の残像を残す。ほかの駒に隠れないよう、駒をすべて描いたあとに描く
  function slashArc(x0: number, y0: number, p: Pose) {
    const lunge = Math.sin(Math.PI * Math.min(1, p.slash * 1.4)) * 0.16;
    const x = x0 + p.dx * lunge;
    const y = y0 + p.dy * lunge;
    const base = Math.atan2(p.dy, p.dx);
    const k = Math.min(1, p.slash / 0.45); // 刀が振り切るまで
    const a0 = base - 1.5 * p.face;
    const a1 = a0 + 3 * p.face * (1 - (1 - k) ** 2);
    const cx = x + p.dx * 0.12;
    const cy = y - 0.1 + p.dy * 0.12;
    const r = 0.58;
    // 残像の弧
    ctx.save();
    ctx.globalAlpha *= p.slash < 0.5 ? 0.95 : 0.95 * (1 - (p.slash - 0.5) / 0.5);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a1, p.face < 0);
    ctx.arc(cx, cy, r * 0.62, a1, a0, p.face > 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,160,220,0.95)';
    ctx.lineWidth = 0.04;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a1, p.face < 0);
    ctx.stroke();
    ctx.restore();
  }

  // 地形の高低：高台のマスは段ごとに土の色を重ねる（2段はさらに濃く）。段差そのものは3Dの形で見せる
  function drawTerrain(l: Layout) {
    if (!l.heights) return;
    ctx.save();
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const h = heightAt(l, x, y);
        if (!h) continue;
        ctx.fillStyle = h >= 2 ? ART.hill2 : ART.hill;
        ctx.globalAlpha = h >= 2 ? 0.42 : 0.3;
        ctx.fillRect(x, y, 1, 1);
      }
    ctx.restore();
  }
  // 市松・地形の色・城域・見出しは、配色・地形・画面が変わったときだけ別の canvas に描いておき、毎コマはそれを貼る
  let fieldCache: { key: string; heights: Layout['heights']; cv: HTMLCanvasElement } | null = null;
  function drawField(v: View) {
    const title = v.mode === 'edit' ? 'edit' : v.mode === 'battle' && v.battle && !v.battle.over ? 'battle' : '';
    // 見出しの字は、字体を読み込み終えたら描き直す
    const key = `${title}|${pal.field}|${pal.field2}|${pal.ringEdit}|${pal.deploy}|${pal.muted}|${pal.atk}|${document.fonts?.status}`;
    if (!fieldCache || fieldCache.key !== key || fieldCache.heights !== v.layout.heights) {
      const c = fieldCache?.cv ?? document.createElement('canvas');
      c.width = W * GPX;
      c.height = H * GPX;
      const c2 = ctx2d(c);
      const board = ctx;
      ctx = c2;
      try {
        c2.setTransform(GPX, 0, 0, GPX, 0, 0);
        paintField(v);
      } finally {
        ctx = board;
      }
      fieldCache = { key, heights: v.layout.heights, cv: c };
    }
    ctx.drawImage(fieldCache.cv, 0, 0, W, H);
  }
  function paintField(v: View) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        ctx.fillStyle = (x + y) % 2 ? pal.field : pal.field2;
        ctx.fillRect(x, y, 1, 1);
      }
    drawTerrain(v.layout);
    const zx = ZONE.x0;
    const zy = ZONE.y0;
    const zw = ZONE.x1 - ZONE.x0 + 1;
    const zh = ZONE.y1 - ZONE.y0 + 1;
    if (v.mode === 'edit') {
      // 配置できない場所（城域の外）を少し暗くする
      ctx.fillStyle = pal.ringEdit;
      ctx.fillRect(0, 0, W, zy);
      ctx.fillRect(0, zy + zh, W, H - zy - zh);
      ctx.fillRect(0, zy, zx, zh);
      ctx.fillRect(zx + zw, zy, W - zx - zw, zh);
    } else {
      ctx.fillStyle = pal.deploy;
      ctx.fillRect(0, 0, W, RING);
      ctx.fillRect(0, H - RING, W, RING);
      ctx.fillRect(0, RING, RING, H - 2 * RING);
      ctx.fillRect(W - RING, RING, RING, H - 2 * RING);
    }
    ctx.save();
    ctx.strokeStyle = pal.muted;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 0.05;
    ctx.setLineDash([0.18, 0.14]);
    ctx.strokeRect(zx, zy, zw, zh);
    ctx.restore();
    if (v.mode === 'edit') text(`城域 ${zw}×${zh}`, W / 2, 0.55, 0.45, pal.muted, 700);
    if (v.mode === 'battle' && v.battle && !v.battle.over) text('出撃エリア', W / 2, 0.55, 0.45, pal.atk, 700);
  }

  function drawEffects(list: readonly Effect[]) {
    for (const e of list) {
      const p = e.t / e.ttl;
      ctx.save();
      ctx.globalAlpha = 1 - p;
      if (e.k === 'arrow') {
        const q = Math.min(1, p * 2 + 0.3);
        ctx.strokeStyle = e.side === 'a' ? pal.atk : pal.def;
        ctx.lineWidth = 0.07;
        ctx.beginPath();
        ctx.moveTo(e.x1, e.y1);
        ctx.lineTo(e.x1 + (e.x2 - e.x1) * q, e.y1 + (e.y2 - e.y1) * q);
        ctx.stroke();
      } else if (e.k === 'hit') {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 0.07;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 0.12 + 0.3 * p, 0, 7);
        ctx.stroke();
      } else {
        ctx.fillStyle = pal.fire;
        ctx.globalAlpha = 0.45 * (1 - p);
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, 7);
        ctx.fill();
        ctx.globalAlpha = 1 - p;
        ctx.strokeStyle = pal.fire;
        ctx.lineWidth = 0.08;
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  // 攻城配置の口：兵が出るマス（辺に沿って±2）を薄く、口そのものを濃く塗る。地面の絵に描く
  function drawGates(v: View) {
    const sg = v.siege;
    if (!sg) return;
    ctx.save();
    ctx.fillStyle = pal.atk;
    for (const g of sg.gates) {
      ctx.globalAlpha = 0.16;
      for (const c of gateSpread(g)) ctx.fillRect(c.x, c.y, 1, 1);
      ctx.globalAlpha = 0.4;
      ctx.fillRect(g.x, g.y, 1, 1);
    }
    ctx.restore();
  }
  // 口ごとの予定の武将と兵。重ねて置いたものは少しずつずらして、3つまで描く。2体以上なら合計の数を出す
  function eachGateUnit(v: View, f: (kind: AttackerKind, x: number, y: number) => void) {
    const sg = v.siege;
    if (!sg) return;
    sg.gates.forEach((g, gi) => {
      const ks = sg.rows
        .filter((r) => r.gate === gi)
        .map((r) => r.kind)
        .slice(0, 3);
      ks.forEach((k, i) => {
        f(k, g.x + 0.5 + (i - (ks.length - 1) / 2) * 0.22, g.y + 0.5);
      });
    });
  }
  function gateCounts(v: View, at: (x: number, y: number) => Pt) {
    const sg = v.siege;
    if (!sg) return;
    sg.gates.forEach((g, gi) => {
      const n = sg.rows.filter((r) => r.gate === gi).reduce((a, r) => a + r.n, 0);
      if (n < 2) return;
      const p = at(g.x + 0.85, g.y + 0.15);
      text(`×${n}`, p.x, p.y, 0.42, pal.atk, 800);
    });
  }

  // 守将が敵を見つける範囲（センサー）を薄く塗る
  function aggroDisc(kind: GeneralKind, x: number, y: number) {
    ctx.save();
    ctx.fillStyle = pal.def;
    ctx.globalAlpha = 0.08;
    ctx.beginPath();
    ctx.arc(x + 0.5, y + 0.5, GDEF[kind].aggro, 0, 7);
    ctx.fill();
    ctx.restore();
  }
  function rangeRing(x: number, y: number, range: number) {
    if (range <= 1.5) return;
    ctx.save();
    ctx.strokeStyle = pal.def;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 0.05;
    ctx.setLineDash([0.2, 0.15]);
    ctx.beginPath();
    ctx.arc(x + 0.5, y + 0.5, range, 0, 7);
    ctx.stroke();
    ctx.restore();
  }

  // ---- カーソルの下の防衛の範囲 ---------------------------------------------
  // 地面の絵に描く
  // 半径 r の円を塗る。inner を渡すと、その内側は塗らずに透かす（大筒の撃てない近さ）
  function disc(cx: number, cy: number, r: number, color: string, alpha: number, inner = 0) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 7);
    if (inner > 0) {
      ctx.moveTo(cx + inner, cy);
      ctx.arc(cx, cy, inner, 0, 7);
    }
    ctx.fill('evenodd');
    ctx.restore();
  }
  // 点線の円。width・dash を変えると、ほかの円と点線の形でも見分けられる
  function ring(cx: number, cy: number, r: number, color: string, alpha: number, width = 0.06, dash = [0.22, 0.14]) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 7);
    ctx.stroke();
    ctx.restore();
  }
  // キーボードで選んでいるマスの枠（地面の絵に描く）
  function drawCursor(v: View) {
    const c = v.cursor;
    if (!c) return;
    ctx.save();
    ctx.strokeStyle = pal.atk;
    ctx.lineWidth = 0.14;
    ctx.strokeRect(c.x + 0.07, c.y + 0.07, 0.86, 0.86);
    ctx.restore();
  }
  function outline(x0: number, y0: number, w: number, h: number) {
    ctx.save();
    ctx.strokeStyle = pal.gold;
    ctx.lineWidth = 0.08;
    ctx.strokeRect(x0 + 0.04, y0 + 0.04, w - 0.08, h - 0.08);
    ctx.restore();
  }
  // 櫓・大筒は射程（大筒は届かない内側も）、鼓楼は効果の範囲、守将は見つける範囲・射程・持ち場から離れられる範囲
  // 何か見つけたら true を返す
  function drawHoverRange(v: View): boolean {
    const hv = v.hover;
    if (!hv || v.drag) return false;
    const b = v.mode === 'edit' ? null : v.battle;
    const tx = hv.x + 0.5;
    const ty = hv.y + 0.5;
    // 守将：配置画面では置いたマス、戦闘中は今いる位置の近く
    let gen: { kind: GeneralKind; x: number; y: number; hx: number; hy: number } | null = null;
    if (b) {
      const u = b.defenders.find((d) => d.hp > 0 && Math.hypot(d.x - tx, d.y - ty) < 0.75);
      if (u) gen = { kind: u.kind, x: u.x, y: u.y, hx: u.hx, hy: u.hy };
    } else {
      const g = v.layout.generals.find((q) => q.x === hv.x && q.y === hv.y);
      if (g) gen = { kind: g.kind, x: tx, y: ty, hx: tx, hy: ty };
    }
    if (gen) {
      const d = GDEF[gen.kind];
      disc(gen.x, gen.y, d.aggro, pal.def, 0.07);
      ring(gen.x, gen.y, d.aggro, pal.def, 0.35);
      disc(gen.x, gen.y, d.range, pal.def, 0.12);
      ring(gen.x, gen.y, d.range, pal.def, 0.7);
      // 持ち場から離れられる範囲：攻撃の範囲（赤）とは別の線なので、墨色の点線にする
      ring(gen.hx, gen.hy, d.leash, pal.ink, 0.35, 0.06, [0.28, 0.18]);
      return true;
    }
    let bd: { type: BuildingType; x0: number; y0: number; w: number; h: number } | null = null;
    const inside = (f: { x0: number; y0: number; w: number; h: number }) =>
      hv.x >= f.x0 && hv.y >= f.y0 && hv.x < f.x0 + f.w && hv.y < f.y0 + f.h;
    if (b) bd = b.buildings.find((q) => q.hp > 0 && inside(q)) ?? null;
    else
      for (const q of v.layout.buildings) {
        const f = fpOf(q);
        if (inside(f)) bd = { type: q.type, ...f };
      }
    if (!bd) return false;
    const d = BDEF[bd.type];
    if (!d.range && !d.aura) return false;
    const cx = bd.x0 + bd.w / 2;
    const cy = bd.y0 + bd.h / 2;
    // 撃てる所だけを塗る。大筒の撃てない近さ（minRange）の内側は塗らずに透かし、境目に点線を引く
    if (d.range) {
      disc(cx, cy, d.range, pal.def, 0.1, d.minRange ?? 0);
      ring(cx, cy, d.range, pal.def, 0.75);
    }
    if (d.minRange) ring(cx, cy, d.minRange, pal.bad, 0.6);
    if (d.aura) {
      disc(cx, cy, d.aura, pal.gold, 0.14);
      ring(cx, cy, d.aura, pal.gold, 0.8);
    }
    outline(bd.x0, bd.y0, bd.w, bd.h);
    return true;
  }
  // 斬撃の弧は、刀で斬る武将だけに重ねる（刀身は絵の側にある）
  function drawSlashes(units: Unit[], at: (u: Unit) => Pt) {
    ctx.save();
    ctx.lineCap = 'round';
    for (const u of units) {
      const pose = poses.get(u.id);
      if (!pose || pose.slash < 0 || !swingsBlade(u.kind)) continue;
      const p = at(u);
      slashArc(p.x, p.y - pose.bob, pose);
    }
    ctx.restore();
  }
  // 軍師の火計の構え：落ちる場所の円
  function castRing(u: Battle['defenders'][number]) {
    if (!u.cast) return;
    const d = GDEF[u.kind];
    ctx.save();
    ctx.strokeStyle = pal.fire;
    ctx.lineWidth = 0.07;
    ctx.setLineDash([0.16, 0.12]);
    ctx.beginPath();
    ctx.arc(u.cast.x, u.cast.y, d.radius ?? 0, 0, 7);
    ctx.stroke();
    ctx.globalAlpha = 0.25 * (1 - u.cast.t / (d.windup ?? 1));
    ctx.fillStyle = pal.fire;
    ctx.fill();
    ctx.restore();
  }

  // ---- 3Dの地面 -------------------------------------------------------------
  // 地形が変わったときだけ、地面の形を作り直す
  let hs: Heights; // 今の盤面の高さ
  let terrain: { hs: Heights; g: Group } | null = null;
  function syncTerrain(v: View) {
    hs = v.mode !== 'edit' && v.battle ? v.battle.height : v.layout.heights;
    if (terrain && terrain.hs === hs) return;
    if (terrain) {
      scene.remove(terrain.g);
      // 上面の材質（地面の絵）は使い回すので、側面の材質だけを捨てる
      terrain.g.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        o.geometry.dispose();
        if (o.material !== groundMat) (o.material as Material).dispose();
      });
    }
    terrain = { hs, g: buildTerrain(hs, groundMat) };
    scene.add(terrain.g);
  }

  // ---- 3Dの建物 -------------------------------------------------------------
  // 形は種類（と大きさ・拒馬の向き）ごとに1つ作り、置くたびに複製する。複製はコマをまたいで使い回し、
  // そのコマで使わなかったものは隠す。配色が変わったら作り直す
  const protos = new Map<string, Group>();
  const pools = new Map<string, { list: Group[]; n: number }>();
  let lookKey = '';
  function syncLook() {
    const key = `${pal.wall}|${pal.wallDk}|${pal.gold}`;
    if (key === lookKey) return;
    lookKey = key;
    for (const p of pools.values()) for (const g of p.list) models.remove(g);
    pools.clear();
    for (const g of protos.values())
      g.traverse((o) => {
        if (o instanceof Mesh) o.geometry.dispose();
      });
    protos.clear();
  }
  function model(key: string, make: () => Group): Group {
    let p = pools.get(key);
    if (!p) {
      p = { list: [], n: 0 };
      pools.set(key, p);
    }
    let g = p.list[p.n];
    if (!g) {
      let proto = protos.get(key);
      if (!proto) {
        proto = make();
        protos.set(key, proto);
      }
      g = proto.clone();
      models.add(g);
      p.list.push(g);
    }
    p.n++;
    g.visible = true;
    return g;
  }
  // 薄く出す（alpha）・傷を受けて光る（flash）ときは、材質を写した別の材質に差し替える
  const baseMat = new WeakMap<Mesh, Material | Material[]>();
  const variants = new WeakMap<Material, Map<string, Material>>();
  function variant(m: Material, alpha: number, flash: boolean): Material {
    if (alpha >= 1 && !flash) return m;
    const key = `${alpha}|${flash}`;
    let vs = variants.get(m);
    if (!vs) {
      vs = new Map();
      variants.set(m, vs);
    }
    let r = vs.get(key);
    if (!r) {
      r = m.clone();
      if (alpha < 1) {
        r.transparent = true;
        r.opacity = alpha;
        r.depthWrite = false;
      }
      if (flash && (r instanceof MeshLambertMaterial || r instanceof MeshPhongMaterial))
        r.emissive = new Color(0.5, 0.5, 0.5);
      vs.set(key, r);
    }
    return r;
  }
  function tint(g: Object3D, alpha: number, flash: boolean) {
    g.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      let base = baseMat.get(o);
      if (!base) {
        base = o.material as Material | Material[];
        baseMat.set(o, base);
      }
      o.material = Array.isArray(base) ? base.map((m) => variant(m, alpha, flash)) : variant(base, alpha, flash);
      o.castShadow = alpha >= 1;
    });
  }
  const look = () => ({ wall: pal.wall, wallDk: pal.wallDk, gold: pal.gold });
  // 施設を置く。ghost（置こうとしている影）と、薄く出しているもの（ドラッグで動かしている施設の元の位置）は、
  // マスを選ぶ当たり判定に入れない
  // opt は形の違い（拒馬の横木の向き・城壁がつながる向き）
  function building3d(
    type: BuildingType,
    f: Rect,
    alpha: number,
    flash = false,
    ghost = false,
    opt: { dir?: 'x' | 'y'; links?: number } = {},
  ) {
    const key = `${type}|${f.w}x${f.h}|${opt.dir ?? ''}|${opt.links ?? ''}`;
    const g = model(key, () => buildModel(type, f.w, f.h, look(), opt));
    g.position.set(f.x0 + f.w / 2, footZ(hs, f.x0, f.y0, f.w, f.h), f.y0 + f.h / 2);
    g.userData.fp = ghost || alpha < 1 ? null : { x0: f.x0, y0: f.y0, w: f.w, h: f.h };
    tint(g, alpha, flash);
  }
  // 壊れた櫓・鼓楼の跡（石垣の台が残る）
  function ruin3d(f: Rect) {
    const g = model('ruin', () => buildRuin(look()));
    g.position.set(f.x0 + f.w / 2, footZ(hs, f.x0, f.y0, f.w, f.h), f.y0 + f.h / 2);
    g.userData.fp = { x0: f.x0, y0: f.y0, w: f.w, h: f.h };
    tint(g, 1, false);
  }
  // 拒馬の横木は、左右に拒馬が並んでいれば x 向き、上下なら y 向きにする
  function bar3d(isBar: (x: number, y: number) => boolean, x: number, y: number, alpha = 1) {
    const dir = !isBar(x - 1, y) && !isBar(x + 1, y) && (isBar(x, y - 1) || isBar(x, y + 1)) ? 'y' : 'x';
    building3d('bar', { x0: x, y0: y, w: 1, h: 1 }, alpha, false, false, { dir });
  }
  // 城壁が隣の城壁・門へつながる向き（isLinked はそのマスに城壁か門があるか）
  function linksAt(isLinked: (x: number, y: number) => boolean, x: number, y: number) {
    return (
      (isLinked(x, y - 1) ? LINK.n : 0) |
      (isLinked(x + 1, y) ? LINK.e : 0) |
      (isLinked(x, y + 1) ? LINK.s : 0) |
      (isLinked(x - 1, y) ? LINK.w : 0)
    );
  }

  // ---- 武将と兵の板 ---------------------------------------------------------
  // ドット絵の canvas ごとに、ぼかさない貼り絵を作って使い回す
  const texOf = new WeakMap<HTMLCanvasElement, CanvasTexture>();
  function tex(c: HTMLCanvasElement) {
    let t = texOf.get(c);
    if (!t) {
      t = new CanvasTexture(c);
      t.colorSpace = SRGBColorSpace;
      t.magFilter = NearestFilter;
      t.minFilter = NearestFilter;
      t.generateMipmaps = false;
      texOf.set(c, t);
    }
    return t;
  }
  const sprPool: Sprite[] = [];
  let sprN = 0;
  // 武将の持ち物（武器・前立て）の形。コマごとに一度だけ作る
  const gears = new Map<string, Group | null>();
  function gearOf(kind: AttackerKind, frame: Frame) {
    const key = `${kind}|${frame}`;
    if (!gears.has(key)) gears.set(key, buildGear(kind, frame));
    return gears.get(key) ?? null;
  }
  // このコマに置いた持ち物と幟（カメラを回したら、毎コマ向きを合わせ直す）
  let gearRoots: Group[] = [];
  function sprite(img: HTMLCanvasElement): Sprite {
    let s = sprPool[sprN];
    if (!s) {
      // 透けたドットだけを捨てる。捨てる判定は薄さ（opacity）を掛けたあとの値で行うので、
      // 値を大きくすると、薄く出す影（0.25 など）がまるごと消えてしまう
      s = new Sprite(new SpriteMaterial({ map: tex(img), alphaTest: 0.01, transparent: true }));
      sprites.add(s);
      sprPool.push(s);
    }
    sprN++;
    s.material.map = tex(img);
    s.visible = true;
    s.renderOrder = 0;
    s.userData.tile = null;
    return s;
  }
  // 武将・兵の足元の高さ。段を移ると高さが跳ぶので、駒ごとに今の高さを覚え、少しずつ追わせる
  const zShown = new Map<number, number>();
  let zOf: Battle | null = null; // zShown を記録している戦闘
  let zStep = 1; // このコマで追う割合
  let zBusy = false; // 高さを追っている途中の駒があるか（あれば、戦闘が止まっていても描き直す）
  function unitZ(id: number, x: number, y: number) {
    const target = groundZ(hs, x, y);
    const prev = zShown.get(id);
    let z = prev === undefined ? target : prev + (target - prev) * zStep;
    if (Math.abs(target - z) < 0.002) z = target;
    else zBusy = true;
    zShown.set(id, z);
    return z;
  }
  // 板を描いた駒の、マスを選ぶ当たり判定のための持ち物
  interface Hit {
    tile?: Tile; // 押したときに選ぶマス（なければ当たり判定に入れない）
    id?: number; // 高さを少しずつ追わせる駒の番号
  }
  // ドット絵の武将と兵：姿勢からコマを選び、足元を基準に立てる。幟は背中の側に立てる（字が裏返らないよう反転しない）
  function unit3d(
    kind: AttackerKind,
    x: number,
    y: number,
    side: string,
    alpha: number,
    flash = 0,
    pose?: Pose,
    hit: Hit = {},
  ) {
    let frame: Frame = 'walk0';
    if (pose && pose.fall >= 0) frame = pose.fall < 0.22 ? 'down0' : 'down1';
    else if (pose && pose.slash >= 0) frame = pose.slash < 0.2 ? 'atk0' : pose.slash < 0.55 ? 'atk1' : 'atk2';
    else if (pose && pose.mv > 0.3) frame = `walk${Math.floor(pose.phase * 4) % 4}` as Frame;
    const face = pose?.face ?? 1;
    // 揺れ・踏み込み・倒れ。車（衝車）は人のように揺れたり、倒れて回ったりしない
    const upright = isVehicle(kind);
    let px = x;
    let py = y;
    let rot = 0;
    let bob = 0;
    let a = alpha;
    if (pose) {
      if (pose.slash >= 0) {
        const lunge = Math.sin(Math.PI * Math.min(1, pose.slash * 1.4)) * 0.16 * HUD_UNIT;
        px += pose.bx * lunge;
        py += pose.by * lunge;
      }
      if (!upright) {
        bob = pose.bob * HUD_UNIT;
        rot = pose.lean;
      }
      if (pose.fall >= 0) {
        const k = Math.min(1, pose.fall / 0.45);
        if (!upright) rot = face * (Math.PI / 2) * (1 - (1 - k) ** 3);
        // 倒れきったら少しずつ消える
        a *= pose.fall < 0.55 ? 1 : 1 - (pose.fall - 0.55) / 0.45;
      }
    }
    const z = hit.id === undefined ? groundZ(hs, px, py) : unitZ(hit.id, px, py);
    // 板の中心（center）を足元にとり、そこを軸に回す。画面の回転は時計回りが正なので、板では向きを逆にする
    const put = (img: HTMLCanvasElement, w: number, h: number, cx: number, cy: number, sx: number, order: number) => {
      const s = sprite(img);
      s.material.opacity = a;
      s.material.rotation = -rot;
      s.center.set(cx, cy - bob / h);
      s.scale.set(w * sx, h, 1);
      s.position.set(px, z, py);
      s.renderOrder = order;
      s.userData.tile = hit.tile ?? null;
      return s;
    };
    // 武将の持ち物（武器・前立て）と幟は立体で付ける。体の絵からは、立体で付ける武器と前立てを外す
    const { mon } = bushoMon(kind);
    const gear = mon ? gearOf(kind, frame) : null;
    const bare = !!gear;
    const d = DOT * spriteScale(kind);
    put(unitSprite(kind, frame, side, false, bare), SPR_W * d, SPR_H * d, SPR_CX / SPR_W, 0, face, 1);
    if (flash > 0)
      put(
        unitSprite(kind, frame, side, true, bare),
        SPR_W * d,
        SPR_H * d,
        SPR_CX / SPR_W,
        0,
        face,
        2,
      ).material.opacity = a * 0.55;
    // 立体の持ち物は、板と同じくカメラの方を向けた枠に置き、足元を軸に傾ける
    const attach = (key: string, make: () => Group, sx: number, x: number, zo: number) => {
      const root = model(key, () => {
        const r = new Group();
        const tilt = new Group();
        tilt.add(make());
        r.add(tilt);
        return r;
      });
      root.userData.fp = null;
      root.position.set(px, z, py);
      root.quaternion.copy(camera.quaternion);
      const tilt = root.children[0];
      tilt.position.y = bob;
      tilt.rotation.z = -rot;
      const body = tilt.children[0];
      body.scale.set(DOT * sx, DOT, DOT);
      body.position.set(x, 0, zo);
      tint(root, Math.round(a * 10) / 10, flash > 0);
      // 体の板は影を落とさないので、持ち物と幟だけが影を落とすとちぐはぐに見える。影は落とさない
      root.traverse((o) => {
        o.castShadow = false;
      });
      gearRoots.push(root);
    };
    if (gear) attach(`gear|${kind}|${frame}`, () => gearOf(kind, frame)?.clone() ?? new Group(), face, 0, 0.02);
    // 幟は背中の側に立てる（字が裏返らないよう反転しない）。竿の位置は、今までの幟の絵と同じ
    if (mon && frame !== 'down1')
      attach(`flag|${side}|${mon}`, () => buildFlag(side, mon), 1, (face > 0 ? -11.5 : 4.5) * DOT, -0.06);
  }
  // 駒の影を地面に落とす（地面の絵に描く）
  function shadow(x: number, y: number, alpha: number) {
    ctx.save();
    ctx.globalAlpha = 0.22 * alpha;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(x, y, 0.32, 0.32, 0, 0, 7);
    ctx.fill();
    ctx.restore();
  }
  // 武将・兵を、影と土ぼこり（地面）と板（3D）で置く
  function token(
    kind: AttackerKind,
    x: number,
    y: number,
    side: string,
    alpha: number,
    flash = 0,
    pose?: Pose,
    hit: Hit = {},
  ) {
    shadow(x, y, alpha);
    // 土ぼこりは武将だけ（兵は数が多いので、描く量を減らす）
    if (pose && pose.dust > 0.02 && isGeneralKind(kind)) dust(x, y, pose);
    unit3d(kind, x, y, side, alpha, flash, pose, hit);
  }

  // ---- 1コマの組み立て --------------------------------------------------------
  // 地面の絵を描きながら、建物と武将・兵を並べる
  function build(v: View) {
    drawField(v);
    const b = v.mode === 'edit' ? null : v.battle;
    if (!b) {
      const bars = new Set(v.layout.buildings.filter((bd) => bd.type === 'bar').map((bd) => `${bd.x},${bd.y}`));
      const isBar = (x: number, y: number) => bars.has(`${x},${y}`);
      const walls = new Set(
        v.layout.buildings.filter((bd) => bd.type === 'wall' || bd.type === 'gate').map((bd) => `${bd.x},${bd.y}`),
      );
      const isWall = (x: number, y: number) => walls.has(`${x},${y}`);
      v.layout.buildings.forEach((bd, i) => {
        const f = fpOf(bd);
        const a = draggedB(v, i);
        if (bd.type === 'bar') bar3d(isBar, bd.x, bd.y, a);
        else if (bd.type === 'wall') building3d('wall', f, a, false, false, { links: linksAt(isWall, bd.x, bd.y) });
        else if (HEIGHT[bd.type]) building3d(bd.type, f, a);
        else drawBuilding(bd.type, f.x0, f.y0, f.w, f.h, a);
      });
      for (const g of v.layout.generals) {
        // ドラッグで動かしている武将の元の位置（薄く出す）は、当たり判定に入れない
        const a = draggedG(v, g.kind);
        token(g.kind, g.x + 0.5, g.y + 0.5, pal.def, a, 0, undefined, a < 1 ? {} : { tile: { x: g.x, y: g.y } });
      }
    } else {
      for (let mi = 0; mi < b.moat.length; mi++) if (b.moat[mi]) drawBuilding('moat', mi % W, (mi / W) | 0, 1, 1, 1);
      const isBar = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && b.abatis[y * W + x] === 1;
      for (let mi = 0; mi < b.abatis.length; mi++) if (b.abatis[mi]) bar3d(isBar, mi % W, (mi / W) | 0);
      const walls = new Set(
        b.buildings
          .filter((bd) => bd.hp > 0 && (bd.type === 'wall' || bd.type === 'gate'))
          .map((bd) => `${bd.x0},${bd.y0}`),
      );
      const isWall = (x: number, y: number) => walls.has(`${x},${y}`);
      for (const bd of b.buildings) {
        // 櫓・鼓楼の跡には石垣の台が残り、門と大筒は破片を散らす
        if (bd.hp <= 0 && leavesBase(bd.type)) ruin3d(bd);
        else if (bd.hp <= 0) drawRubble(bd);
        else if (bd.type === 'wall')
          building3d('wall', bd, 1, bd.fl > 0, false, { links: linksAt(isWall, bd.x0, bd.y0) });
        else building3d(bd.type, bd, 1, bd.fl > 0);
      }
      for (const u of b.defenders) castRing(u);
      const mt = trackMotion(b);
      for (const d of tracker.dying)
        token(d.kind, d.x, d.y, d.side === 'd' ? pal.def : pal.atk, 1, 0, dyingPose(d, mt));
      if (zOf !== b) {
        zShown.clear();
        zOf = b;
      }
      for (const u of [...b.defenders, ...b.attackers])
        token(u.kind, u.x, u.y, u.side === 'd' ? pal.def : pal.atk, 1, u.fl, poses.get(u.id), {
          tile: { x: Math.floor(u.x), y: Math.floor(u.y) },
          id: u.id,
        });
      drawEffects(b.effects.filter((e) => e.k === 'fire'));
      drawGates(v);
      eachGateUnit(v, (k, x, y) =>
        token(k, x, y, pal.atk, 0.85, 0, undefined, { tile: { x: Math.floor(x), y: Math.floor(y) } }),
      );
    }
    const shown = drawHoverRange(v);
    if (!(shown && v.mode === 'edit' && v.tool !== 'erase')) drawGhost(v);
    drawCursor(v);
  }
  // 置こうとしているものの影。地面の部分（置けない印・射程の円）は地面の絵に描き、高さのあるものは薄く3Dで置く
  function drawGhost(v: View) {
    const hv = v.hover;
    if (!hv || hv.x < 0 || hv.y < 0 || hv.x >= W || hv.y >= H) return;
    const { x, y } = hv;
    if (v.mode === 'edit') {
      // ドラッグ中は、動かしているものの影を出す。何も選んでいなければ、つかむまで何も出さない
      const gh = ghostOf(v, x, y);
      if (!gh) return;
      const { tool, r } = gh;
      if (tool === 'erase') {
        badTile(x, y);
        return;
      }
      const a = r.ok ? 0.6 : 0.3;
      if (isBuildingType(tool)) {
        const f = fpOf({ type: tool, x: gh.x, y: gh.y });
        // つかんだマスのずれで、置き先が盤面の外に出るなら影は描かない
        if (!fpInBoard(f)) {
          badTile(x, y);
          return;
        }
        if (HEIGHT[tool]) building3d(tool, f, a, false, true);
        else drawBuilding(tool, f.x0, f.y0, f.w, f.h, a);
        rangeRing(x, y, BDEF[tool].range || 0);
        // 置けない印は、影のマスすべてに付ける（2×2の本丸でも、どこが重なるかわかるように）
        if (!r.ok) for (const [tx, ty] of fpTiles(f)) badTile(tx, ty);
        return;
      }
      unit3d(tool, x + 0.5, y + 0.5, pal.def, a);
      aggroDisc(tool, x, y);
      rangeRing(x, y, GDEF[tool].range);
      if (!r.ok) badTile(x, y);
      return;
    }
    if (!v.battle || v.battle.over) return;
    // 開戦前：パネルからドラッグしている武将・兵か、選んでいる兵種を、そのマスの予定に入れられるか
    const kind = v.siege?.drag ?? v.unitSel;
    if (!kind) return;
    const ok = v.siege ? v.siege.canPlan(x, y) : inRing(x, y) && v.deployOk;
    unit3d(kind, x + 0.5, y + 0.5, pal.atk, ok ? 0.65 : 0.25);
    if (!ok) badTile(x, y);
  }

  // ---- 重ねる canvas（体力のバー・数・斬撃・矢） ----------------------------------
  // 盤面の位置 (x, y)・高さ z の、重ねる canvas の上の位置（長さの単位は HUD_UNIT マスぶんの画面の長さ）
  const tmp = new Vector3();
  let hudScale = 1; // 重ねる canvas の、長さの単位あたりのピクセル
  // 3Dの位置 p を、重ねる canvas の上の位置に直す
  function toHud(p: Vector3): Pt {
    p.project(camera);
    return { x: (((p.x + 1) / 2) * hud.width) / hudScale, y: (((1 - p.y) / 2) * hud.height) / hudScale };
  }
  const scr = (x: number, y: number, z: number) => toHud(tmp.set(x, z, y));
  const footOf = (x: number, y: number) => scr(x, y, groundZ(hs, x, y));
  // 駒の足元から、画面の上の向きへ h（HUD_UNIT 単位）だけ上の位置。遠くの武将ほど小さく見えるので、3Dの位置で求める
  const headOf = (u: Unit, h: number) =>
    toHud(tmp.set(u.x, zShown.get(u.id) ?? groundZ(hs, u.x, u.y), u.y).addScaledVector(camUp, h * HUD_UNIT));
  function drawHud(v: View) {
    hctx.setTransform(1, 0, 0, 1, 0, 0);
    hctx.clearRect(0, 0, hud.width, hud.height);
    const b = v.mode === 'edit' ? null : v.battle;
    if (!b) return;
    // 長さの単位は、見る先での1マスの対角の長さ（遠近で大きさは少し変わるが、バーや数は同じ大きさで描く）
    hudScale = (hud.height / ((2 * VIEW_HALF) / orbit.zoom)) * HUD_UNIT;
    camUp.setFromMatrixColumn(camera.matrixWorld, 1);
    hctx.setTransform(hudScale, 0, 0, hudScale, 0, 0);
    // 施設の体力のバーは、建物の上に出す
    for (const bd of b.buildings) {
      if (bd.hp <= 0 || bd.hp >= bd.maxHp) continue;
      const cx = bd.x0 + bd.w / 2;
      const cy = bd.y0 + bd.h / 2;
      const top = scr(cx, cy, footZ(hs, bd.x0, bd.y0, bd.w, bd.h) + (HEIGHT[bd.type] ?? 0));
      hpBar(top.x, top.y - 0.15, Math.min(0.9 * bd.w, 1.6), bd.hp / bd.maxHp);
    }
    // 武将と兵の体力のバーは頭の上に出す。武将は幟の上、兵は絵の上端（貼る大きさに合わせて求める）の上
    const units = [...b.defenders, ...b.attackers];
    for (const u of units) {
      if (u.hp >= u.maxHp) continue;
      const ratio = u.hp / u.maxHp;
      if (u.side === 'd' || isGeneralKind(u.kind)) {
        const p = headOf(u, 1.2);
        hpBar(p.x + 0.12, p.y, 0.8, ratio);
      } else {
        const p = headOf(u, ((SPR_H - spriteTop(u.kind)) * spriteScale(u.kind)) / SPR_UNIT + 0.14);
        hpBar(p.x, p.y, 0.7, ratio);
      }
    }
    gateCounts(v, (x, y) => footOf(x, y));
    drawSlashes(units, (u) => headOf(u, 0.35));
    // 矢と命中は空中に描く
    const fly: Effect[] = [];
    for (const e of b.effects) {
      if (e.k === 'arrow') {
        const p1 = scr(e.x1, e.y1, groundZ(hs, e.x1, e.y1) + FLY);
        const p2 = scr(e.x2, e.y2, groundZ(hs, e.x2, e.y2) + FLY);
        fly.push({ ...e, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
      } else if (e.k === 'hit') {
        const p = scr(e.x, e.y, groundZ(hs, e.x, e.y) + FLY);
        fly.push({ ...e, x: p.x, y: p.y });
      }
    }
    drawEffects(fly);
  }

  // 1コマで描くものを決める値をまとめた文字列。前のコマと同じなら、地面の絵や並びを作り直さない
  let lastKey = '';
  let lastDraw = 0;
  // 戦闘ごとの番号（別の戦闘に変わったら描き直す）
  const ids = new WeakMap<object, number>();
  let idN = 0;
  const idOf = (o: object) => {
    let n = ids.get(o);
    if (n === undefined) {
      n = ++idN;
      ids.set(o, n);
    }
    return n;
  };
  function sceneKey(v: View, now: number) {
    const b = v.mode === 'edit' ? null : v.battle;
    return [
      lookKey,
      pal.field,
      pal.def,
      pal.atk,
      pal.moat,
      document.fonts?.status,
      v.mode,
      v.hover ? `${v.hover.x},${v.hover.y}` : '',
      v.cursor ? `${v.cursor.x},${v.cursor.y}` : '',
      v.tool,
      v.unitSel,
      v.deployOk,
      JSON.stringify(v.drag),
      // 武将・兵の左右の向きは、カメラの向きで変わる
      Math.round(orbit.az * 50),
      // 戦闘は時間が進めば描き直す。終わったあとは倒れる動きを実際の時間で見せるので、毎コマ描き直す
      // 駒の高さを追っている途中も描き直す
      b ? `${idOf(b)}|${b.tick}|${b.over ? now : ''}|${zBusy ? now : ''}` : JSON.stringify(v.layout),
      v.siege ? JSON.stringify([v.siege.rows, v.siege.gates, v.siege.drag]) : '',
    ].join('|');
  }
  function draw(v: View) {
    if (!cv.width) return;
    if (frameNo++ % 20 === 0) pal = readPal();
    const now = performance.now();
    zStep = 1 - Math.exp(-Math.min(0.25, (now - lastDraw) / 1000) * 14); // 0.2秒ほどで追いつく
    lastDraw = now;
    orbit.apply(camera, cv.width / cv.height, now);
    syncLook();
    syncTerrain(v);
    // 地面の絵と、建物・板の並びは、何か変わったときだけ作り直す（地面の絵を GPU へ送り直すのは重いので）
    const key = sceneKey(v, now);
    if (key !== lastKey) {
      lastKey = key;
      // 建物と板は、使ったものだけを見せる
      for (const p of pools.values()) p.n = 0;
      sprN = 0;
      gearRoots = [];
      zBusy = false;
      ctx = gctx;
      gctx.setTransform(GPX, 0, 0, GPX, 0, 0);
      build(v);
      groundTex.needsUpdate = true;
      for (const p of pools.values()) for (let i = p.n; i < p.list.length; i++) p.list[i].visible = false;
      for (let i = sprN; i < sprPool.length; i++) sprPool[i].visible = false;
    }
    // 幟をなびかせ、持ち物をカメラの方へ向け直す（作り直さないコマでも、カメラは動くので）
    waveFlags(now / 1000);
    for (const r of gearRoots) r.quaternion.copy(camera.quaternion);
    gl.render(scene, camera);
    ctx = hctx;
    try {
      drawHud(v);
    } finally {
      ctx = gctx;
    }
  }
  // 画面上の位置からマスを求める。建物に当たればその建物のマス、地面に当たればそのマス。盤面の外なら null
  const ray = new Raycaster();
  const ndc = new Vector2();
  function tileAt(clientX: number, clientY: number): Tile | null {
    if (!terrain) return null;
    const r = cv.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, 1 - ((clientY - r.top) / r.height) * 2);
    ray.setFromCamera(ndc, camera);
    const targets: Object3D[] = [
      ...terrain.g.children,
      ...models.children.filter((o) => o.visible && o.userData.fp),
      ...sprites.children.filter((o) => o.visible && o.userData.tile),
    ];
    for (const h of ray.intersectObjects(targets, true)) {
      // 武将・兵の板に当たったら、その駒のマス
      if (h.object.userData.tile) return { ...(h.object.userData.tile as Tile) };
      let o: Object3D | null = h.object;
      while (o && !o.userData.fp) o = o.parent;
      const fp = o?.userData.fp as Rect | undefined;
      if (fp) {
        const x = Math.min(fp.x0 + fp.w - 1, Math.max(fp.x0, Math.floor(h.point.x)));
        const y = Math.min(fp.y0 + fp.h - 1, Math.max(fp.y0, Math.floor(h.point.z)));
        return { x, y };
      }
      // 段の側面に当たったときは、その奥の（高い側の）マスにする
      const p = h.point.clone().addScaledVector(ray.ray.direction, 0.01);
      const x = Math.floor(p.x);
      const y = Math.floor(p.z);
      return x >= 0 && y >= 0 && x < W && y < H ? { x, y } : null;
    }
    return null;
  }

  // マスの中心の、盤面の左上からの位置（CSSピクセル）。ポップアップを出す位置に使う
  function tileCenter(x: number, y: number): Pt {
    const r = cv.getBoundingClientRect();
    tmp.set(x + 0.5, groundZ(hs, x + 0.5, y + 0.5), y + 0.5).project(camera);
    return { x: ((tmp.x + 1) / 2) * r.width, y: ((1 - tmp.y) / 2) * r.height };
  }

  // パネルのボタンに出す施設の絵：正面から見た絵を、1マスぶんの大きさで target に描く
  function drawIcon(target: HTMLCanvasElement, type: BuildingType) {
    const c = target.getContext('2d');
    if (!c) return;
    pal = readPal();
    const board = ctx;
    ctx = c;
    // 描き終えたら（途中で失敗しても）盤面に戻す
    try {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, target.width, target.height);
      // 縁に少し余白を残す
      const pad = 0.06;
      c.setTransform(
        target.width * (1 - 2 * pad),
        0,
        0,
        target.height * (1 - 2 * pad),
        target.width * pad,
        target.height * pad,
      );
      drawBuilding(type, 0, 0, 1, 1, 1);
    } finally {
      ctx = board;
    }
  }

  resize();
  return {
    draw,
    tileAt,
    tileCenter,
    drawIcon,
    // 空いている所を左ボタンで押したとき、ドラッグで見る先を動かし始める（Shift を押していれば回す）
    orbitFrom: (e: PointerEvent) => orbit.begin(e, !e.shiftKey),
    resetView: () => orbit.reset(),
    // 矢印キーの向きを、今の向きから見た盤面の向きに直す
    arrow: (dx: number, dy: number) => orbit.arrow(dx, dy),
    // カメラを回している途中か
    get busy() {
      return orbit.busy;
    },
  };
}
