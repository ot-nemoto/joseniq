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
  ADEF,
  type AttackerKind,
  type Battle,
  BDEF,
  type BuildingEnt,
  type BuildingType,
  type CastleShape,
  canDeployAt,
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
  isBuildingType,
  isGeneralKind,
  type Layout,
  type PlaceResult,
  type Shot,
  type ShotKind,
  type Tool,
  tileIdx,
  type Unit,
  W,
  ZONE,
} from '../sim';
import {
  BIG_FLAG_H,
  BIG_FLAG_W,
  type BigView,
  bigBarDots,
  bigFlagAt,
  bigFlagSprite,
  bigFrame,
  bigMuzzle,
  bigSize,
  bigSprite,
  hasBig,
} from './bigBusho';
import { buildFlag, buildGear, waveFlags } from './gear';
import { createIconRenderer } from './icons';
import { ART, buildBridge, buildDebris, buildModel, buildRuin, CATA_MUZZLE, HEIGHT, LINK } from './models';
import { BURN_TIME, type Dying, FALL_TIME, faceOf, type Motion, MotionTracker, SLASH_TIME } from './motion';
import { Orbit, VIEW_HALF } from './orbit';
import {
  bushoMon,
  FLAME_FRAMES,
  FLAME_H,
  FLAME_W,
  type Frame,
  flameSprite,
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
import { pattern } from './textures';

// sample は動作の見本の窓の盤面（sampleDialog.ts。戦いと同じく描く）
export type Mode = 'edit' | 'battle' | 'units' | 'sample';
export interface Tile {
  x: number;
  y: number;
}
export interface View {
  mode: Mode;
  layout: Layout;
  battle: Battle | null;
  hover: Tile | null;
  tool: Tool | null; // 選んでいる道具（施設か武将。パネルからドラッグしている施設も。何も選んでいなければ null）
  unitSel: AttackerKind | null; // 攻城で選んでいる兵種・武将（何も選んでいなければ null）
  drag: Drag | null; // ドラッグで動かしている武将・施設（配置画面）
  cursor: Tile | null; // キーボードで選んでいるマス（配置画面で盤面にフォーカスがあるとき）
  siege: SiegeView | null; // 開戦前の、攻城配置の出撃の予定
  deployOk: boolean; // 選んでいる兵種を、今手動で出せるか（予定の分の兵力や武将の人数も含めて）
  castle: CastleShape | null; // 防衛配置の塀と土地の形（castleShape の結果。防衛配置のときだけ）
}
// 攻城配置：口と、口ごとの出撃の予定
export interface SiegeView {
  gates: readonly Gate[];
  rows: readonly DraftRow[];
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
// 本丸を囲まない塀（城壁・門）を透かして描くときの濃さ
const STRAY_ALPHA = 0.45;
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
  water: '--water',
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
// 盤面は three.js で描く。地面の上の平らなもの（市松・城域・川・射程の円・影など）は、
// これまでどおり Canvas 2D で地面の絵に描き、地形の上面に貼る。建物は立体（models.ts）、
// 武将と兵はドット絵をこちらに向けた板（Sprite）にする。体力のバーや数・矢・斬撃は、上に重ねた canvas に描く
const ASPECT = 0.66; // 盤面の画面の縦÷横
const GPX = 32; // 地面の絵の、1マスあたりの画素数
const DOT = Math.SQRT2 / SPR_UNIT; // ドット1つの大きさ（マス）。1マスの対角に SPR_UNIT ドットが並ぶ大きさ
const FLY = 0.58; // 飛び道具と命中を描く、地面からの高さ
// 重ねる canvas の長さの単位：1マスの対角の、画面の上の長さ（斜め表示の絵の寸法をそのまま使うため）
const HUD_UNIT = Math.SQRT2;
const calm = window.matchMedia('(prefers-reduced-motion: reduce)'); // 動きを減らす設定
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
  cd: number; // 次に攻撃できるまでの残り（戦闘の秒）。分からなければ -1。鉄砲の大きな絵の武将が、撃つ前に構える
  cdFull: number; // 攻撃の間隔（戦闘の秒）。分からなければ 0
  since: number; // 最後に攻撃した時刻からの経過（戦闘の秒。攻撃していなければ -1）。鉄砲の大きな絵の武将が、撃ったあとのコマを選ぶ
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
  sun.position.set(W / 2 + W * 0.56, W * 0.53, H / 2 + W * 0.16);
  sun.target.position.set(W / 2, 0, H / 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const sr = W * 0.82;
  Object.assign(sun.shadow.camera, { left: -sr, right: sr, top: sr, bottom: -sr, near: 1, far: W * 3 });
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

  // 川の地面の絵（水の色とさざ波）。立体の水面の下に見える
  function drawWater(x0: number, y0: number, alpha: number) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pal.water;
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
    ctx.restore();
  }
  // 壊れた施設の跡。門と大筒は破片を散らし（通れる）、櫓・鼓楼・鐘楼は壊れた櫓の絵が残る（石垣の台があり、通れない）
  const leavesBase = (t: BuildingType) => !BDEF[t].breakThrough && t !== 'hall';
  // 門と大筒（と本丸）の跡の地面：破片の下を土で汚す（破片そのものは debris3d で立体に置く）
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
    // 次に攻撃できるまでの残りと攻撃の間隔（鉄砲の大きな絵の武将が、撃つ前に構える・狙うのに使う）
    for (const u of [...b.defenders, ...b.attackers]) {
      const p = poses.get(u.id);
      if (!p) continue;
      p.cd = u.cd;
      p.cdFull = u.side === 'd' ? GDEF[u.kind].cd : ADEF[u.kind].cd;
    }
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
      face: faceOf(m.turned, dx),
      dust: m.mv * (1 - Math.abs(step)),
      step,
      phase: m.walk * 1.1,
      mv: m.mv,
      since: m.atk >= 0 ? t - m.atk : -1,
      cd: -1,
      cdFull: 0,
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
      face: faceOf(d.turned, dx),
      dust: 0,
      step: 0,
      phase: 0,
      mv: 0,
      since: -1,
      cd: -1,
      cdFull: 0,
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
      // 攻め手を出せるマス（外周の出撃エリアの平地）だけを塗る
      ctx.fillStyle = pal.deploy;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (canDeployAt(v.layout, x, y)) ctx.fillRect(x, y, 1, 1);
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
      if (e.k === 'hit') {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 0.07;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 0.12 + 0.3 * p, 0, 7);
        ctx.stroke();
      } else if (e.k === 'fire') {
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
  // 飛び道具：今の位置に描き、進んだ割合（飛んだ距離÷（飛んだ距離＋残りの距離））で山なりに持ち上げる。
  // 櫓・大筒から撃ったものは、建物の上から撃ち出す
  const ARC: Record<ShotKind, number> = { arrow: 0.12, bullet: 0, ball: 0.4 }; // 山の高さ（飛ぶ距離に対する割合）
  const TAIL: Record<ShotKind, number> = { arrow: 0.35, bullet: 1.2, ball: 0 }; // 描く尾の長さ（マス）
  // 撃ち出す高さの、ふつう（地面＋FLY）からの上乗せ
  // 撃った所にある撃つ施設（なければ null）
  function launcherAt(b: Battle, sx: number, sy: number) {
    const fx = Math.floor(sx);
    const fy = Math.floor(sy);
    if (fx < 0 || fy < 0 || fx >= W || fy >= H) return null;
    const e = b.byId[b.grid[tileIdx(fx, fy)]];
    return e?.isB && BDEF[e.type].tower ? e : null;
  }
  // 大筒の模型を、最後に撃った向きへ回す角度。模型の筒は -x を向いているので、その向きのときに 0
  const cataAngle = (e: BuildingEnt) => Math.atan2(e.aimY, -e.aimX);
  // 撃ち出す所：撃った位置からの横のずれ（ox, oy）と、ふつうの飛ぶ高さからの持ち上げ（lift）。
  // 大筒は筒の口から、ほかの施設は建物の上から、武将・兵はその場から撃ち出す
  function muzzleOf(b: Battle, sx: number, sy: number, dx = 0, dy = 0) {
    // 試作の大きな絵の飛び道具の武将は、構えた所から撃つ（鉄砲の信長は肩の高さの銃口、弓の光義は引き絞った弓の握り）
    const big = [...b.defenders, ...b.attackers].find((u) => bigMuzzle(u.kind) && Math.hypot(u.x - sx, u.y - sy) < 0.3);
    const mz = big && bigMuzzle(big.kind);
    if (mz) {
      const l = Math.hypot(dx, dy) || 1;
      const f = mz.fwd * DOT;
      return { ox: (dx / l) * f, oy: (dy / l) * f, lift: mz.up * DOT - FLY, cata: false };
    }
    const e = launcherAt(b, sx, sy);
    if (!e) return { ox: 0, oy: 0, lift: 0, cata: false };
    const cata = e.type === 'cata';
    const h = cata ? CATA_MUZZLE.z : (HEIGHT[e.type] ?? 0);
    // 大筒の筒は、最後に撃った向きへ回してある（cataAngle）ので、筒の口もその向きにある
    const l = Math.hypot(e.aimX, e.aimY) || 1;
    return {
      ox: cata ? (-CATA_MUZZLE.dx * e.aimX) / l : 0,
      oy: cata ? (-CATA_MUZZLE.dx * e.aimY) / l : 0,
      lift: footZ(hs, e.x0, e.y0, e.w, e.h) + h - (groundZ(hs, sx, sy) + FLY),
      cata,
    };
  }
  // 矢の形：tail（矢羽根の側）から head（鏃の側）へ。矢柄は木の色、鏃は鉄の色、矢羽根は撃った側の色
  function arrowShape(tail: Pt, head: Pt, color: string) {
    const l = Math.hypot(head.x - tail.x, head.y - tail.y);
    if (l < 1e-6) return;
    // 撃った直後で矢が短く見えるときは、鏃と羽根も小さくする
    const s = Math.min(1, l / 0.2);
    const ux = (head.x - tail.x) / l;
    const uy = (head.y - tail.y) / l;
    const nx = -uy;
    const ny = ux;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#a5804c';
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.lineTo(head.x, head.y);
    ctx.stroke();
    // 鏃：先の尖った三角
    ctx.fillStyle = '#34343a';
    ctx.beginPath();
    ctx.moveTo(head.x + ux * 0.05 * s, head.y + uy * 0.05 * s);
    ctx.lineTo(head.x - ux * 0.04 * s + nx * 0.035 * s, head.y - uy * 0.04 * s + ny * 0.035 * s);
    ctx.lineTo(head.x - ux * 0.04 * s - nx * 0.035 * s, head.y - uy * 0.04 * s - ny * 0.035 * s);
    ctx.fill();
    // 矢羽根：矢柄の両側に、後ろへ流れる羽根を1枚ずつ
    const f = Math.min(0.1, l * 0.4);
    const w = 0.05 * s;
    ctx.fillStyle = color;
    for (const sgn of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(tail.x + ux * f, tail.y + uy * f);
      ctx.lineTo(tail.x + ux * f * 0.3 + nx * sgn * w, tail.y + uy * f * 0.3 + ny * sgn * w);
      ctx.lineTo(tail.x - ux * 0.01 + nx * sgn * w, tail.y - uy * 0.01 + ny * sgn * w);
      ctx.lineTo(tail.x, tail.y);
      ctx.fill();
    }
  }
  function drawShots(b: Battle) {
    ctx.save();
    ctx.lineCap = 'round';
    for (const sh of b.shots) {
      const done = Math.hypot(sh.x - sh.sx, sh.y - sh.sy);
      const rest = Math.hypot(sh.tx - sh.x, sh.ty - sh.y);
      const len = done + rest;
      if (len < 1e-6) continue;
      // 撃ち出す所のずれは、飛ぶにつれて0に近づける
      const { ox, oy, lift } = muzzleOf(b, sh.sx, sh.sy, sh.tx - sh.sx, sh.ty - sh.sy);
      const at = (x: number, y: number, p: number) => {
        const px = x + ox * (1 - p);
        const py = y + oy * (1 - p);
        return scr(px, py, groundZ(hs, px, py) + FLY + lift * (1 - p) + 4 * ARC[sh.k] * len * p * (1 - p));
      };
      const head = at(sh.x, sh.y, done / len);
      if (sh.k === 'ball') {
        // 大筒の玉：高い山なりに飛ぶ黒い玉（影は地面の絵に描く）
        ctx.fillStyle = '#26221e';
        ctx.beginPath();
        ctx.arc(head.x, head.y, 0.09, 0, 7);
        ctx.fill();
        continue;
      }
      // 矢は矢の形、鉄砲の弾は光る長い筋。尾は、進む向きの後ろへ伸ばす
      const [ux, uy] = rest > 1e-6 ? [(sh.tx - sh.x) / rest, (sh.ty - sh.y) / rest] : [0, 0];
      const back = Math.min(TAIL[sh.k], done);
      const tail = at(sh.x - ux * back, sh.y - uy * back, (done - back) / len);
      if (sh.k === 'arrow') {
        arrowShape(tail, head, sh.side === 'a' ? pal.atk : pal.def);
        continue;
      }
      // 弾：まわりの橙のにじみに、白い芯を重ねる
      for (const [color, w] of [
        ['rgba(255,170,60,0.45)', 0.11],
        ['#fffbe8', 0.045],
      ] as const) {
        ctx.strokeStyle = color;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(tail.x, tail.y);
        ctx.lineTo(head.x, head.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  // 矢と大筒の玉の影（地面の絵に描く）。落ちる場所へ向かって地面を進むので、どこに落ちるかの予告になる
  function drawShotShadows(list: readonly Shot[]) {
    ctx.save();
    ctx.fillStyle = '#000';
    for (const sh of list) {
      if (sh.k === 'bullet') continue;
      const ball = sh.k === 'ball';
      ctx.globalAlpha = ball ? 0.3 : 0.18;
      ctx.beginPath();
      ctx.arc(sh.x, sh.y, ball ? 0.14 : 0.07, 0, 7);
      ctx.fill();
    }
    ctx.restore();
  }
  // 外れて地面に刺さった矢：鏃を少し地面に埋め、飛んできた向きの後ろへ斜めに立てる。終わりの3割で薄れる
  function drawStuck(list: readonly Effect[]) {
    ctx.save();
    for (const e of list) {
      if (e.k !== 'stuck') continue;
      const p = e.t / e.ttl;
      ctx.globalAlpha = p < 0.7 ? 1 : (1 - p) / 0.3;
      const g = groundZ(hs, e.x, e.y);
      const head = scr(e.x, e.y, g + 0.02);
      const tail = scr(e.x - e.dx * 0.25, e.y - e.dy * 0.25, g + 0.24);
      arrowShape(tail, head, e.side === 'a' ? pal.atk : pal.def);
    }
    ctx.restore();
  }
  const SMOKE = ['#bdb8ae', '#d6d2c9', '#ece9e2'];
  // 鉄砲・大筒を撃った所：はじめの一瞬に火花を出し、白い煙を広げながら上へ流して薄れさせる
  function drawSmoke(b: Battle) {
    ctx.save();
    for (const e of b.effects) {
      if (e.k !== 'smoke') continue;
      // 試作の大きな絵の武将（信長）は、銃口の火花と煙を絵の側に描いているので、ここでは描かない
      if ([...b.defenders, ...b.attackers].some((u) => hasBig(u.kind) && Math.hypot(u.x - e.x, u.y - e.y) < 0.3))
        continue;
      const p = e.t / e.ttl;
      // 銃口は、撃った者から撃った向きへ少し前（櫓なら建物の上）。大筒は、模型の筒の口
      const k = e.size;
      const mz = muzzleOf(b, e.x, e.y);
      const mx = mz.cata ? e.x + mz.ox : e.x + e.dx * 0.3 * k;
      const my = mz.cata ? e.y + mz.oy : e.y + e.dy * 0.3 * k;
      const z = groundZ(hs, e.x, e.y) + FLY + mz.lift;
      // 火花は短いが、4×でも少なくとも1コマは描かれる長さにする
      if (e.t < 0.15 * k) {
        const c = scr(mx, my, z);
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffb347';
        ctx.beginPath();
        ctx.arc(c.x, c.y, 0.13 * k, 0, 7);
        ctx.fill();
        ctx.fillStyle = '#fffbe8';
        ctx.beginPath();
        ctx.arc(c.x, c.y, 0.06 * k, 0, 7);
        ctx.fill();
      }
      // 煙は3つの玉を、撃った向きへ少しずらして重ねる。明るい地面でも見えるよう、根もとの玉ほど灰色を濃くする
      for (let i = 0; i < 3; i++) {
        const q = Math.min(1, p * (1 + i * 0.25));
        const o = (0.1 + i * 0.12 + 0.25 * q) * k;
        const c = scr(mx + e.dx * o, my + e.dy * o, z + (0.05 + 0.25 * q + i * 0.04) * k);
        ctx.globalAlpha = 0.9 * (1 - p);
        ctx.fillStyle = SMOKE[i];
        ctx.beginPath();
        ctx.arc(c.x, c.y, (0.08 + 0.18 * q - i * 0.02) * k, 0, 7);
        ctx.fill();
      }
    }
    ctx.restore();
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
  function rangeRing(x: number, y: number, range: number, color = pal.def) {
    if (range <= 1.5) return;
    ctx.save();
    ctx.strokeStyle = color;
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
  // 櫓・大筒は射程（大筒は届かない内側も）、鼓楼は効果の範囲、鐘楼は見張りの範囲、守将は見つける範囲・射程・持ち場から離れられる範囲
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
      // 試作の大きな絵の武将（謙信・秀吉）は、弧を絵の側に描いている
      if (!pose || pose.slash < 0 || !swingsBlade(u.kind) || hasBig(u.kind)) continue;
      const p = at(u);
      slashArc(p.x, p.y - pose.bob, pose);
    }
    ctx.restore();
  }
  // 真田昌幸の火計の構え：落ちる場所の点線の円と、火が出るまでの残り。
  // 残りは、ふちを盤面の北から（盤面の上で時計回りに）なぞる太い線で示し、一周したら火が出る（攻め・守りとも）。
  // 円は地面の絵に描くので、画面で見える始まりの位置は、カメラの向きで変わる
  function castRing(u: Unit) {
    if (!u.cast) return;
    const d = u.side === 'd' ? GDEF[u.kind] : ADEF[u.kind];
    const r = d.radius ?? 0;
    const k = Math.min(1, Math.max(0, 1 - u.cast.t / (d.windup ?? 1)));
    const { x, y } = u.cast;
    ctx.save();
    ctx.strokeStyle = pal.fire;
    ctx.fillStyle = pal.fire;
    ctx.globalAlpha = 0.15;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 7);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 0.07;
    ctx.setLineDash([0.16, 0.12]);
    ctx.stroke();
    if (k > 0) {
      ctx.setLineDash([]);
      ctx.lineWidth = 0.16;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 波紋：施設から、効き目の範囲のふちまで輪が広がって消える（戦闘の時間で進むので、一時停止で止まる）。
  // 鼓楼は立っている間ずっと金の輪をゆっくり、鐘楼は鐘が鳴っている間だけ赤い輪を速く出す。
  // 動きを減らす設定では、広がらない薄い輪を範囲のふちに出す
  const WAVES = 2; // 同時に広がる輪の数
  function waves(bd: BuildingEnt, t: number, beat: number, color: string) {
    const aura = BDEF[bd.type].aura ?? 0;
    const cx = bd.x0 + bd.w / 2;
    const cy = bd.y0 + bd.h / 2;
    if (calm.matches) {
      ring(cx, cy, aura, color, 0.35, 0.08, []);
      return;
    }
    ctx.save();
    ctx.strokeStyle = color;
    for (let k = 0; k < WAVES; k++) {
      const p = (t / beat + k / WAVES) % 1;
      ctx.globalAlpha = 0.6 * (1 - p);
      ctx.lineWidth = 0.18 * (1 - p) + 0.04;
      ctx.beginPath();
      ctx.arc(cx, cy, 0.5 + (aura - 0.5) * p, 0, 7);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- 3Dの地面 -------------------------------------------------------------
  // 地形が変わったときだけ、地面の形を作り直す
  let hs: Heights; // 今の盤面の高さ
  let terrain: { hs: Heights; waterKey: number; g: Group } | null = null;
  // 川の水面：半透明にし、さざ波の凹凸を少しずつ流して揺らす
  const waterNormal = pattern('water').normal.clone();
  const waterMat = new MeshPhongMaterial({
    transparent: true,
    opacity: 0.8,
    shininess: 90,
    specular: new Color('#ffffff'),
    normalMap: waterNormal,
  });
  function syncTerrain(v: View) {
    const battle = v.mode !== 'edit' && v.battle;
    hs = battle ? battle.height : v.layout.heights;
    // 川は掘り下げて水を張る。川は渡れない（橋の上は地面の高さを歩く）
    const water = v.layout.water;
    const waterKey = water ? idOf(water) : 0;
    waterMat.color.set(pal.water || '#4f86a8');
    if (terrain && terrain.hs === hs && terrain.waterKey === waterKey) return;
    if (terrain) {
      scene.remove(terrain.g);
      // 上面の材質（地面の絵）は使い回すので、側面の材質だけを捨てる
      terrain.g.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        o.geometry.dispose();
        if (o.material !== groundMat && o.material !== waterMat) (o.material as Material).dispose();
      });
    }
    terrain = { hs, waterKey, g: buildTerrain(hs, groundMat, water, waterMat) };
    scene.add(terrain.g);
  }

  // ---- 3Dの建物 -------------------------------------------------------------
  // 形は種類（と大きさ・城壁のつながる向き）ごとに1つ作り、置くたびに複製する。複製はコマをまたいで使い回し、
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
  // opt は形の違い（城壁がつながる向き）
  function building3d(
    type: BuildingType,
    f: Rect,
    alpha: number,
    flash = false,
    ghost = false,
    opt: { links?: number } = {},
    rot = 0, // 縦の軸まわりに回す角度（大筒の筒を向けるのに使う）
  ) {
    const key = `${type}|${f.w}x${f.h}|${opt.links ?? ''}`;
    const g = model(key, () => buildModel(type, f.w, f.h, look(), opt));
    g.position.set(f.x0 + f.w / 2, footZ(hs, f.x0, f.y0, f.w, f.h), f.y0 + f.h / 2);
    g.rotation.y = rot;
    g.userData.fp = ghost || alpha < 1 ? null : { x0: f.x0, y0: f.y0, w: f.w, h: f.h };
    tint(g, alpha, flash);
  }
  // 壊れた櫓・鼓楼・鐘楼の跡（石垣の台が残る）
  function ruin3d(f: Rect) {
    const g = model('ruin', () => buildRuin(look()));
    g.position.set(f.x0 + f.w / 2, footZ(hs, f.x0, f.y0, f.w, f.h), f.y0 + f.h / 2);
    g.userData.fp = { x0: f.x0, y0: f.y0, w: f.w, h: f.h };
    tint(g, 1, false);
  }
  // 門・大筒・本丸の跡の破片
  function debris3d(type: BuildingType, f: Rect) {
    const g = model(`debris|${type}|${f.w}x${f.h}`, () => buildDebris(type, f.w, f.h, look()));
    g.position.set(f.x0 + f.w / 2, footZ(hs, f.x0, f.y0, f.w, f.h), f.y0 + f.h / 2);
    g.userData.fp = { x0: f.x0, y0: f.y0, w: f.w, h: f.h };
    tint(g, 1, false);
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
  // 武将と兵の持ち物（武器・前立て・衝車の丸太）の形。コマごとに一度だけ作る
  const gears = new Map<string, Group | null>();
  function gearOf(kind: AttackerKind, frame: Frame) {
    const key = `${kind}|${frame}`;
    if (!gears.has(key)) gears.set(key, buildGear(kind, frame));
    return gears.get(key) ?? null;
  }
  // このコマに置いた持ち物と幟（カメラを回したら、毎コマ向きを合わせ直す）
  let gearRoots: Group[] = [];
  // 左右に返した絵（元の絵ごとに1度だけ作る）
  const mirrors = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
  function mirrored(img: HTMLCanvasElement) {
    let m = mirrors.get(img);
    if (!m) {
      m = document.createElement('canvas');
      m.width = img.width;
      m.height = img.height;
      const c = m.getContext('2d');
      if (c) {
        c.translate(img.width, 0);
        c.scale(-1, 1);
        c.drawImage(img, 0, 0);
      }
      mirrors.set(img, m);
    }
    return m;
  }
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
    if (hasBig(kind)) {
      bigUnit(kind, x, y, side, alpha, flash, pose, hit);
      return;
    }
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
    // 板の中心（center）を足元にとり、そこを軸に回す。画面の回転は時計回りが正なので、板では向きを逆にする。
    // 板は横の大きさをマイナスにしても左右に返らない（three.js は大きさの長さだけを使う）ので、
    // 左を向くとき（sx < 0）は、左右に返した絵を貼り、中心も返す
    const put = (img: HTMLCanvasElement, w: number, h: number, cx: number, cy: number, sx: number, order: number) => {
      const s = sprite(sx < 0 ? mirrored(img) : img);
      s.material.opacity = a;
      s.material.rotation = -rot;
      s.center.set(sx < 0 ? 1 - cx : cx, cy - bob / h);
      s.scale.set(w * Math.abs(sx), h, 1);
      s.position.set(px, z, py);
      s.renderOrder = order;
      s.userData.tile = hit.tile ?? null;
      return s;
    };
    // 武将と兵の持ち物（武器・前立て・衝車の丸太）と幟は立体で付ける。体の絵からは、立体で付けるものを外す
    const { mon } = bushoMon(kind);
    const gear = gearOf(kind, frame);
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
    // sc は貼る大きさ（兵は武将より小さい）
    const attach = (key: string, make: () => Group, sx: number, x: number, zo: number, sc = 1) => {
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
      // 板と同じく足元を軸に傾け、揺れ（bob）は傾けたあとの上の向きへ持ち上げる
      tilt.rotation.z = -rot;
      const body = tilt.children[0];
      body.scale.set(DOT * sc * sx, DOT * sc, DOT * sc);
      body.position.set(x, bob, zo);
      tint(root, Math.round(a * 10) / 10, flash > 0);
      // 体の板は影を落とさないので、持ち物と幟だけが影を落とすとちぐはぐに見える。影は落とさない
      root.traverse((o) => {
        o.castShadow = false;
      });
      gearRoots.push(root);
    };
    if (gear)
      attach(
        `gear|${kind}|${frame}`,
        () => gearOf(kind, frame)?.clone() ?? new Group(),
        face,
        0,
        0.02,
        spriteScale(kind),
      );
    // 幟は背中の側に立てる（字が裏返らないよう反転しない）。竿の位置は、今までの幟の絵と同じ
    if (mon && frame !== 'down1')
      attach(`flag|${side}|${mon}`, () => buildFlag(side, mon), 1, (face > 0 ? -11.5 : 4.5) * DOT, -0.06);
  }
  // 試作：上杉謙信・織田信長・大島光義・真田昌幸・豊臣秀吉・徳川家康は、3頭身で斜め前・斜め後ろの2方向を描いた絵を使う（bigBusho.ts）。
  // 揺れ・踏み込み・倒れの回転・斬撃の弧は絵の側にあるので、ここでは足しない。持ち物の立体は付けず、幟は絵の幟を立てる
  function bigUnit(
    kind: AttackerKind,
    x: number,
    y: number,
    side: string,
    alpha: number,
    flash: number,
    pose: Pose | undefined,
    hit: Hit,
  ) {
    const view: BigView = pose && pose.dy < -0.05 ? 'back' : 'front';
    const face = pose?.face ?? 1;
    const size = bigSize(kind);
    // コマの選び方は、モーションの確かめのページと同じ関数（bigBusho.ts の bigFrame）
    const { action, i, fade } = bigFrame(kind, pose, flash, performance.now());
    const a = alpha * fade;
    const z = hit.id === undefined ? groundZ(hs, x, y) : unitZ(hit.id, x, y);
    const put = (img: HTMLCanvasElement, order: number) => {
      const s = sprite(face < 0 ? mirrored(img) : img);
      s.material.opacity = a;
      s.material.rotation = 0;
      s.center.set(face < 0 ? 1 - size.cx : size.cx, size.cy);
      s.scale.set(size.w * DOT, size.h * DOT, 1);
      s.position.set(x, z, y);
      s.renderOrder = order;
      s.userData.tile = hit.tile ?? null;
      return s;
    };
    put(bigSprite(kind, view, action, i, side), 1);
    if (flash > 0) put(bigSprite(kind, view, action, i, side, true), 2).material.opacity = a * 0.55;
    // 背中の幟：字が裏返らないよう反転せず、左を向くときは立てる位置だけを返す。
    // 斜め前では背中が奥にあるので体の後ろに、斜め後ろでは体の手前に描く
    const at = bigFlagAt(kind, view, action, i);
    if (at) {
      const left = face < 0 ? size.w - 1 - at[0] : at[0];
      const fs = sprite(bigFlagSprite(kind, side));
      fs.material.opacity = a;
      fs.material.rotation = 0;
      fs.center.set((size.cx * size.w - left) / BIG_FLAG_W, 1 - (size.h * (1 - size.cy) - at[1]) / BIG_FLAG_H);
      fs.scale.set(BIG_FLAG_W * DOT, BIG_FLAG_H * DOT, 1);
      fs.position.set(x, z, y);
      fs.renderOrder = view === 'front' ? 0.5 : 1.5;
      fs.userData.tile = hit.tile ?? null;
    }
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
    // 川：水の地面の絵（立体の水面の下に見える）と、川にかかった橋
    const water = v.layout.water;
    if (water)
      for (let i = 0; i < W * H; i++) {
        if (!water[i]) continue;
        const x = i % W;
        const y = (i / W) | 0;
        drawWater(x, y, 1);
        if (!v.layout.bridge?.[i]) continue;
        // 橋は、両側が陸になっている向きへ渡す
        const dir = x > 0 && x < W - 1 && !water[i - 1] && !water[i + 1] ? 'x' : 'y';
        const g = model(`bridge|${dir}`, () => buildBridge(dir));
        g.position.set(x + 0.5, groundZ(hs, x + 0.5, y + 0.5), y + 0.5);
        g.userData.fp = null;
        tint(g, 1, false);
      }
    const b = v.mode === 'edit' ? null : v.battle;
    // 防衛の配置では、塀の中の広い土地（数に入るマス）を薄く色付けし、本丸を囲まない塀（城壁・門）の地面を赤くする
    const shape = v.mode === 'edit' ? v.castle : null;
    if (shape) paintCastle(shape);
    const stray = new Set(shape?.strays.map((s) => `${s.x},${s.y}`));
    if (!b) {
      const walls = new Set(
        v.layout.buildings.filter((bd) => bd.type === 'wall' || bd.type === 'gate').map((bd) => `${bd.x},${bd.y}`),
      );
      const isWall = (x: number, y: number) => walls.has(`${x},${y}`);
      v.layout.buildings.forEach((bd, i) => {
        const f = fpOf(bd);
        // 本丸を囲まない塀は、下の赤い地面が見えるよう、半ば透かす
        const a = Math.min(draggedB(v, i), stray.has(`${bd.x},${bd.y}`) ? STRAY_ALPHA : 1);
        if (bd.type === 'wall') building3d('wall', f, a, false, false, { links: linksAt(isWall, bd.x, bd.y) });
        else building3d(bd.type, f, a);
      });
      for (const g of v.layout.generals) {
        // ドラッグで動かしている武将の元の位置（薄く出す）は、当たり判定に入れない
        const a = draggedG(v, g.kind);
        token(g.kind, g.x + 0.5, g.y + 0.5, pal.def, a, 0, undefined, a < 1 ? {} : { tile: { x: g.x, y: g.y } });
      }
    } else {
      const walls = new Set(
        b.buildings
          .filter((bd) => bd.hp > 0 && (bd.type === 'wall' || bd.type === 'gate'))
          .map((bd) => `${bd.x0},${bd.y0}`),
      );
      const isWall = (x: number, y: number) => walls.has(`${x},${y}`);
      for (const bd of b.buildings) {
        // 櫓・鼓楼の跡には石垣の台が残り、門と大筒（と本丸）は破片を散らす。破片の下の地面は土で汚す
        if (bd.hp <= 0 && leavesBase(bd.type)) ruin3d(bd);
        else if (bd.hp <= 0) {
          drawRubble(bd);
          debris3d(bd.type, bd);
        } else if (bd.type === 'wall')
          building3d('wall', bd, 1, bd.fl > 0, false, { links: linksAt(isWall, bd.x0, bd.y0) });
        else building3d(bd.type, bd, 1, bd.fl > 0, false, {}, bd.type === 'cata' ? cataAngle(bd) : 0);
      }
      const units = [...b.defenders, ...b.attackers];
      for (const u of units) castRing(u);
      // 開戦前は時間が進まず、輪が広がる途中で止まって範囲を取り違えるので、波紋は開戦してから出す
      for (const bd of b.started ? b.buildings : []) {
        if (bd.type === 'drum' && bd.hp > 0) waves(bd, b.t, 2.4, pal.gold);
        // 戦いが終わると ringing は更新されないので、鳴り続けて見えないよう止める
        else if (bd.type === 'bell' && !b.over && b.ringing.includes(bd.id)) waves(bd, b.t, 1.5, pal.bad);
      }
      const mt = trackMotion(b);
      for (const d of tracker.dying)
        token(d.kind, d.x, d.y, d.side === 'd' ? pal.def : pal.atk, 1, 0, dyingPose(d, mt));
      if (zOf !== b) {
        zShown.clear();
        zOf = b;
      }
      for (const u of units)
        token(u.kind, u.x, u.y, u.side === 'd' ? pal.def : pal.atk, 1, u.fl, poses.get(u.id), {
          tile: { x: Math.floor(u.x), y: Math.floor(u.y) },
          id: u.id,
        });
      drawEffects(b.effects.filter((e) => e.k === 'fire'));
      // 戦いが終わると飛び道具は止まるので、描かない
      if (!b.over) drawShotShadows(b.shots);
      drawGates(v);
      eachGateUnit(v, (k, x, y) =>
        token(k, x, y, pal.atk, 0.85, 0, undefined, { tile: { x: Math.floor(x), y: Math.floor(y) } }),
      );
    }
    const shown = drawHoverRange(v);
    if (!(shown && v.mode === 'edit' && v.tool !== 'erase')) drawGhost(v);
    drawCursor(v);
  }
  // 塀と土地の形を、地面の絵に描く：塀の中の広い土地を薄い金色に、本丸を囲まない塀の地面を赤く
  function paintCastle(shape: CastleShape) {
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = pal.gold;
    for (let i = 0; i < W * H; i++) if (shape.land[i]) ctx.fillRect(i % W, (i / W) | 0, 1, 1);
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = pal.bad;
    for (const s of shape.strays) ctx.fillRect(s.x, s.y, 1, 1);
    ctx.restore();
    for (const s of shape.strays) badTile(s.x, s.y);
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
        building3d(tool, f, a, false, true);
        rangeRing(x, y, BDEF[tool].range || 0);
        // 鼓楼の効き目の範囲・鐘楼の見張りの範囲
        rangeRing(x, y, BDEF[tool].aura || 0, pal.gold);
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
    const kind = v.unitSel;
    if (!kind) return;
    const ok = v.siege ? v.siege.canPlan(x, y) : canDeployAt(v.layout, x, y) && v.deployOk;
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
  // 火計を受けて燃える炎：体（建物は屋根の下）のまわりに3つの炎を重ね、揺らしながら消していく。
  // at(h) は、炎の足元から h（HUD_UNIT 単位）上の位置。size は炎の大きさ（武将の絵に対する割合）
  const FLAMES = [
    [-0.16, 0.12, 0],
    [0.15, 0.22, 1],
    [0, 0.4, 2],
  ] as const; // 横のずれ・高さ（HUD_UNIT）・コマのずらし
  function flames(at: (h: number) => Pt, burnT: number, size: number, now: number) {
    const k = (tracker.t - burnT) / BURN_TIME;
    if (burnT < 0 || k < 0 || k >= 1) return;
    const dot = (size * (0.7 + 0.3 * Math.min(1, k * 6))) / SPR_UNIT;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = k < 0.6 ? 1 : (1 - k) / 0.4;
    for (const [dx, h, n] of FLAMES) {
      const p = at(h * size);
      const img = flameSprite((Math.floor(now / 90) + n) % FLAME_FRAMES);
      ctx.drawImage(img, p.x + dx * size - (FLAME_W * dot) / 2, p.y - FLAME_H * dot, FLAME_W * dot, FLAME_H * dot);
    }
    ctx.restore();
  }
  function drawBurns(b: Battle, units: readonly Unit[]) {
    const now = performance.now();
    const lift = (x: number, y: number, z: number) => (h: number) =>
      toHud(tmp.set(x, z, y).addScaledVector(camUp, h * HUD_UNIT));
    for (const bd of b.buildings) {
      const cx = bd.x0 + bd.w / 2;
      const cy = bd.y0 + bd.h / 2;
      const z = footZ(hs, bd.x0, bd.y0, bd.w, bd.h) + (HEIGHT[bd.type] ?? 0) * 0.5;
      // 大きな建物（本丸など）は、大きな炎にする
      flames(lift(cx, cy, z), bd.burnT, 1.5 * Math.sqrt(Math.max(bd.w, bd.h)), now);
    }
    for (const d of tracker.dying) flames(lift(d.x, d.y, groundZ(hs, d.x, d.y)), d.burn, spriteScale(d.kind), now);
    for (const u of units) flames((h) => headOf(u, h), u.burnT, spriteScale(u.kind), now);
  }
  function drawHud(v: View) {
    hctx.setTransform(1, 0, 0, 1, 0, 0);
    hctx.clearRect(0, 0, hud.width, hud.height);
    const b = v.mode === 'edit' ? null : v.battle;
    if (!b) return;
    // 長さの単位は、見る先での1マスの対角の長さ（遠近で大きさは少し変わるが、バーや数は同じ大きさで描く）
    hudScale = (hud.height / ((2 * VIEW_HALF) / orbit.zoom)) * HUD_UNIT;
    camUp.setFromMatrixColumn(camera.matrixWorld, 1);
    hctx.setTransform(hudScale, 0, 0, hudScale, 0, 0);
    const units = [...b.defenders, ...b.attackers];
    drawBurns(b, units);
    // 施設の体力のバーは、建物の上に出す
    for (const bd of b.buildings) {
      if (bd.hp <= 0 || bd.hp >= bd.maxHp) continue;
      const cx = bd.x0 + bd.w / 2;
      const cy = bd.y0 + bd.h / 2;
      const top = scr(cx, cy, footZ(hs, bd.x0, bd.y0, bd.w, bd.h) + (HEIGHT[bd.type] ?? 0));
      hpBar(top.x, top.y - 0.15, Math.min(0.9 * bd.w, 1.6), bd.hp / bd.maxHp);
    }
    // 武将と兵の体力のバーは頭の上に出す。武将は幟の上、兵は絵の上端（貼る大きさに合わせて求める）の上
    for (const u of units) {
      if (u.hp >= u.maxHp) continue;
      const ratio = u.hp / u.maxHp;
      if (hasBig(u.kind)) {
        // 試作の大きな絵の武将（謙信・信長）は、今の武将と同じく幟の上に出す
        const p = headOf(u, bigBarDots(u.kind) / SPR_UNIT);
        hpBar(p.x, p.y, 0.8, ratio);
      } else if (u.side === 'd' || isGeneralKind(u.kind)) {
        const p = headOf(u, 1.2);
        hpBar(p.x + 0.12, p.y, 0.8, ratio);
      } else {
        const p = headOf(u, ((SPR_H - spriteTop(u.kind)) * spriteScale(u.kind)) / SPR_UNIT + 0.14);
        hpBar(p.x, p.y, 0.7, ratio);
      }
    }
    gateCounts(v, (x, y) => footOf(x, y));
    drawSlashes(units, (u) => headOf(u, 0.35));
    // 飛び道具と命中は空中に描く
    // 戦いが終わると効果の時間が進まないので、刺さった矢も描かない
    if (!b.over) {
      drawStuck(b.effects);
      drawSmoke(b);
      drawShots(b);
    }
    const fly: Effect[] = [];
    for (const e of b.effects) {
      if (e.k === 'hit') {
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
      pal.water,
      // 波紋の色と、動きを減らす設定（波紋を広げずに止まった輪にする）
      pal.gold,
      pal.bad,
      calm.matches,
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
      v.siege ? JSON.stringify([v.siege.rows, v.siege.gates]) : '',
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
    // 地形・地面の絵・建物と板の並びは、何か変わったときだけ作り直す（地面の絵を GPU へ送り直すのは重いので）。
    // 描くものを決める値（配置・戦闘の時間・配色など）はすべて sceneKey に入っている
    const key = sceneKey(v, now);
    if (key !== lastKey) {
      lastKey = key;
      syncTerrain(v);
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
    waterNormal.offset.set((now / 1000) * 0.03, (now / 1000) * 0.017);
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
    // 盤面（canvas）の外を指しているときは、映っていないマスに当たらないよう、マスを返さない
    if (clientX < r.left || clientX >= r.right || clientY < r.top || clientY >= r.bottom) return null;
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

  // 口に並ぶ駒（kinds）の頭の上の、盤面の左上からの位置（CSSピクセル）。口の目印を出す位置に使う。
  // 高さは体力のバーと同じ：兵は絵の上の端、武将は幟の上まで。いちばん背の高い駒に合わせる
  function gateTop(x: number, y: number, kinds: readonly AttackerKind[]): Pt {
    const r = cv.getBoundingClientRect();
    const h = Math.max(
      0,
      ...kinds.map((k) => (isGeneralKind(k) ? 1.2 : ((SPR_H - spriteTop(k)) * spriteScale(k)) / SPR_UNIT + 0.14)),
    );
    camUp.setFromMatrixColumn(camera.matrixWorld, 1);
    tmp
      .set(x + 0.5, groundZ(hs, x + 0.5, y + 0.5), y + 0.5)
      .addScaledVector(camUp, h * HUD_UNIT)
      .project(camera);
    return { x: ((tmp.x + 1) / 2) * r.width, y: ((1 - tmp.y) / 2) * r.height };
  }

  // パネルや比較の画面のボタンに出す施設の絵：盤面と同じ3Dの形を、斜め上から小さく写す（icons.ts）
  const iconRenderer = createIconRenderer();
  function drawIcon(target: HTMLCanvasElement, type: BuildingType) {
    pal = readPal();
    iconRenderer(target, type, look());
  }

  resize();
  return {
    draw,
    tileAt,
    tileCenter,
    gateTop,
    drawIcon,
    // 空いている所を左ボタンで押したとき、ドラッグで見る先を動かし始める（Shift を押していれば回す）
    orbitFrom: (e: PointerEvent) => orbit.begin(e, !e.shiftKey),
    resetView: () => orbit.reset(),
    look: (tx: number, ty: number, zoom: number) => orbit.look(tx, ty, zoom),
    // 矢印キーの向きを、今の向きから見た盤面の向きに直す
    arrow: (dx: number, dy: number) => orbit.arrow(dx, dy),
    // カメラを回している途中か
    get busy() {
      return orbit.busy;
    },
  };
}
