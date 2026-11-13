import {
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  InstancedMesh,
  type Material,
  Matrix4,
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
  centerOf,
  check,
  checkMove,
  checkPut,
  closePeers,
  type DraftRow,
  defOf,
  disarmAuraOf,
  drawbridges,
  type Effect,
  type Entity,
  type Footprint,
  fpOf,
  GATE_SPACING,
  type Gate,
  GDEF,
  type GeneralKind,
  gateGap,
  gateSpread,
  H,
  heightAt,
  ITEMS,
  isBuildingType,
  isGeneralDefender,
  isGeneralKind,
  type Layout,
  type PlacedBuilding,
  type PlaceResult,
  type Shot,
  type ShotKind,
  type Side,
  skillSpan,
  type Tool,
  tileIdx,
  type Unit,
  W,
  WARD_RADIUS,
  wardAuraOf,
  ZONE,
} from '../sim';
import {
  BIG_FLAG_H,
  BIG_FLAG_W,
  BIG_WALK_STEP,
  type BigView,
  bigBarDots,
  bigFlagAt,
  bigFlagSprite,
  bigFrame,
  bigMuzzle,
  bigScale,
  bigSize,
  bigSprite,
} from './bigBusho';
import { createIconRenderer, type IconKind } from './icons';
import {
  ART,
  buildBridge,
  buildDebris,
  buildModel,
  buildRaisedBridge,
  buildRuin,
  CATA_MUZZLE,
  HEIGHT,
  LINK,
} from './models';
import { BURN_TIME, type Dying, FALL_TIME, faceOf, type Motion, MotionTracker, SLASH_TIME } from './motion';
import { Orbit, VIEW_HALF } from './orbit';
import { FLAME_FRAMES, FLAME_H, FLAME_W, flameSprite, SPR_UNIT, shotWeapon } from './pixel';
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
  layoutRev: number; // 配置の版（配置が変わるたびに増える。置く前の影の確かめを使い回すのと、盤面を描き直すかを決めるのに使う）
}
// 攻城配置：口と、口ごとの出撃の予定
export interface SiegeView {
  gates: readonly Gate[];
  rows: readonly DraftRow[];
  // ドラッグしているか選んでいる兵種・武将を、そのマスの予定に入れられるか。口の目印をつかんでいるときは、そのマスへ口を移せるか
  canPlan: (x: number, y: number) => boolean;
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
// 置く前の確かめは塀と郭の形を盤面全体で求めるので、マス・道具・つかんでいるもの・配置の版が変わったときだけやり直す
let ghostMemo: { key: string; layout: Layout; ghost: Ghost | null } | null = null;
function ghostOf(v: View, x: number, y: number): Ghost | null {
  const d = v.drag;
  const key = `${v.layoutRev}|${v.tool}|${d ? (d.k === 'g' ? d.kind : `${d.i},${d.ox},${d.oy}`) : ''}|${x},${y}`;
  if (ghostMemo?.key === key && ghostMemo.layout === v.layout) return ghostMemo.ghost;
  // 何も選んでいないときは、つかむまで何も出さない
  const ghost = !d
    ? v.tool
      ? { tool: v.tool, r: check(v.layout, v.tool, x, y), x, y }
      : null
    : d.k === 'g'
      ? { tool: d.kind, r: checkPut(v.layout, d.kind, x, y), x, y }
      : { tool: d.type, r: checkMove(v.layout, d.i, x - d.ox, y - d.oy), x: x - d.ox, y: y - d.oy };
  ghostMemo = { key, layout: v.layout, ghost };
  return ghost;
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
// 武将と兵はドット絵をこちらに向けた板（Sprite）にする。体力のバーや数・矢は、上に重ねた canvas に描く
// 防衛の配置で門に合わせたときの、門の間かくの円の色（効果の範囲の円と見分けるため、軍の色にしない）
const GATE_RING = '#ffffff';
const ASPECT = 0.66; // 盤面の画面の縦÷横
const GPX = 32; // 地面の絵の、1マスあたりの画素数
const DOT = Math.SQRT2 / SPR_UNIT; // ドット1つの大きさ（マス）。1マスの対角に SPR_UNIT ドットが並ぶ大きさ
// 矢と弾を撃つ武器（大筒の玉は施設だけが撃つ）
const SHOT_WEAPON = { arrow: 'bow', bullet: 'gun', ball: null } as const;
const FLY = 0.58; // 飛び道具と命中を描く、地面からの高さ
// 重ねる canvas の長さの単位：1マスの対角の、画面の上の長さ（斜め表示の絵の寸法をそのまま使うため）
const HUD_UNIT = Math.SQRT2;
const calm = window.matchMedia('(prefers-reduced-motion: reduce)'); // 動きを減らす設定
// 駒の描き方の変化：向き・歩き・攻撃・倒れ
interface Pose {
  bx: number; // 盤面の上の向き（単位ベクトル）。踏み込む向き
  by: number;
  dy: number; // 画面上の向き（単位ベクトル）の縦。上を向くと負
  fall: number; // 倒れる動きの進み 0〜1（倒れていなければ -1）
  face: number; // 左右の向き（1 か -1）
  dust: number; // 足元の土ぼこりの濃さ 0〜1
  phase: number; // 歩いた歩数（ドット絵の歩くコマを選ぶ）
  cd: number; // 次に攻撃できるまでの残り（戦闘の秒）。分からなければ -1。鉄砲の大きな絵の武将が、撃つ前に構える
  cdFull: number; // 攻撃の間隔（戦闘の秒）。分からなければ 0
  since: number; // 最後に攻撃した時刻からの経過（戦闘の秒。攻撃していなければ -1）。鉄砲の大きな絵の武将が、撃ったあとのコマを選ぶ
  mv: number; // 動いている度合い 0〜1
  skillNext?: boolean; // 次の番がスキル（スキルの構えのコマを出す）
  skillLast?: boolean; // 最後の動きがスキル（スキルの発動のコマを出す）
  lag?: number; // since のうち、足止めで溜めが遅れた分（コマの区切りは、since からこれを引いて選ぶ）
  ready?: number; // 次の番が来られるようになってからの経過（戦闘の秒。待っているあいだは -1）。戦いが止んだかを見る
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
  // 体力のバー・数・矢を重ねる canvas。マウスの操作は下の盤面に通す
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
  const poses = new Map<number, Pose>(); // このコマの姿勢

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
  const wallBatch = new Group(); // まとめて描く城壁（wall3d）
  const sprites = new Group(); // 武将と兵（ドット絵の板）
  scene.add(models, wallBatch, sprites);

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

  // 堀の岸の切り石の縁：堀のマスの、水でない隣のマスの、堀に面した辺に、切り石の帯と目地を描く
  function drawMoatRim(l: Layout, x0: number, y0: number) {
    const dry = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < W && y < H && !l.moat?.[y * W + x] && !l.water?.[y * W + x];
    const band = 0.16;
    ctx.save();
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]) {
      if (!dry(x0 + dx, y0 + dy)) continue;
      // 帯の四角（堀に面した隣の陸のマスの、辺に沿った band の幅。水面の下に沈まない岸の上に描く）
      const rx = dx === 1 ? x0 + 1 : dx === -1 ? x0 - band : x0;
      const ry = dy === 1 ? y0 + 1 : dy === -1 ? y0 - band : y0;
      const rw = dx ? band : 1;
      const rh = dy ? band : 1;
      ctx.fillStyle = ART.paved;
      ctx.fillRect(rx, ry, rw, rh);
      // 目地：帯を3つの切り石に分ける
      ctx.strokeStyle = ART.pavedJoint;
      ctx.lineWidth = 0.025;
      ctx.beginPath();
      for (const t of [1 / 3, 2 / 3]) {
        if (dx) {
          ctx.moveTo(rx, y0 + t);
          ctx.lineTo(rx + rw, y0 + t);
        } else {
          ctx.moveTo(x0 + t, ry);
          ctx.lineTo(x0 + t, ry + rh);
        }
      }
      ctx.stroke();
    }
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
    // 次に攻撃できるまでの残りと攻撃の間隔（鉄砲の大きな絵の武将が、撃つ前に構える・狙うのに使う）と、
    // 次の番と最後の動きがスキルか（スキルを持つ武将が、スキルのコマを出すのに使う）
    for (const u of [...b.defenders, ...b.attackers]) {
      const p = poses.get(u.id);
      if (!p) continue;
      p.cd = u.cd;
      p.cdFull = u.side === 'd' ? defOf(u).cd : ADEF[u.kind].cd;
      p.skillNext = u.nextSkill;
      p.skillLast = u.atkSkill;
      // 攻撃の動きを始めてから、足止めで溜めが遅れた分。コマの区切りは、経過からこれを引いた溜めの進みで選ぶ
      // （効く時刻とコマを合わせる。動きを始める前に積もった分は、経過に入っていないので引かない）
      const m = tracker.motions.get(u.id);
      if (m && p.since >= 0) p.lag = Math.max(0, u.atkLag - m.lag0);
      // 次の番が来られるようになってからの経過。戦いが止んだか（構えを解くか）は、戦いの計算と同じくこれで見る
      p.ready = u.cd <= 0 && u.readyT >= 0 ? b.t - u.readyT : -1;
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
    const striking = m.atk >= 0 && t - m.atk < SLASH_TIME;
    const [bx, by] = striking ? unit(m.ax, m.ay) : unit(m.mx, m.my);
    const [dx, dy] = screenDir(bx, by);
    const step = Math.sin(m.walk * Math.PI * 2.2);
    return {
      bx,
      by,
      dy,
      fall: -1,
      face: faceOf(m.turned, dx),
      dust: m.mv * (1 - Math.abs(step)),
      phase: m.walk * BIG_WALK_STEP,
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
      bx,
      by,
      dy,
      fall: Math.min(1, (t - d.t0) / FALL_TIME),
      face: faceOf(d.turned, dx),
      dust: 0,
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

  const sideColor = (side: Side) => (side === 'd' ? pal.def : pal.atk);
  // 盤面の地面の上に描く演出の種類（ほかの種類は、それぞれ別の所で描く）
  const GROUND_FX: ReadonlySet<Effect['k']> = new Set(['fire', 'summon', 'ward', 'spin', 'disarm', 'skill', 'wardFx']);
  // b は、相手の今の位置に印を出す演出（諸行無常の×印）のための戦い
  function drawEffects(list: readonly Effect[], b?: Battle) {
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
      } else if (e.k === 'summon') {
        // 武田信玄が騎兵を呼んだ所：軍の色の輪が足元から広がって薄れる（土埃は drawSummonDust）
        ctx.strokeStyle = sideColor(e.side);
        ctx.globalAlpha = 1 - p;
        ctx.lineWidth = 0.12;
        ctx.beginPath();
        ctx.arc(e.x, e.y, calm.matches ? 1 : 0.3 + 0.9 * p, 0, 7);
        ctx.stroke();
      } else if (e.k === 'skill') {
        // スキルを出した時の光（地面）：足元から金の輪と軍の色の輪が広がって薄れる。動きを減らす設定では広げない
        const g = calm.matches ? 1 : Math.min(1, p * 1.8);
        ctx.strokeStyle = pal.gold;
        ctx.lineWidth = 0.12;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 0.3 + 1.1 * g, 0, 7);
        ctx.stroke();
        ctx.strokeStyle = sideColor(e.side);
        ctx.lineWidth = 0.07;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 0.2 + 0.8 * g, 0, 7);
        ctx.stroke();
      } else if (e.k === 'wardFx') {
        // 徳川家康の金城鉄壁が効いた時：金の光の粒が家康から掛かった相手へ飛び（前の6割）、着いた所で金の輪がはじける（後の4割）
        ctx.fillStyle = pal.gold;
        ctx.strokeStyle = pal.gold;
        ctx.globalAlpha = 1;
        for (const [tx, ty] of e.to) {
          if (p < 0.6 && !calm.matches) {
            const q = p / 0.6;
            ctx.beginPath();
            ctx.arc(e.x + (tx - e.x) * q, e.y + (ty - e.y) * q, 0.11, 0, 7);
            ctx.fill();
          } else {
            const q = calm.matches ? 1 : (p - 0.6) / 0.4;
            ctx.globalAlpha = 1 - q * 0.8;
            ctx.lineWidth = 0.08;
            ctx.beginPath();
            ctx.arc(tx, ty, 0.15 + 0.45 * q, 0, 7);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }
      } else if (e.k === 'spin') {
        // 上杉謙信の一騎当千：軍の色の円が薄れながら、太い白い輪と、少し遅れて金の輪が、足元から範囲のふちへ広がる。
        // 動きを減らす設定では、輪は広がらず、範囲のふちに出て薄れる
        ctx.fillStyle = sideColor(e.side);
        ctx.globalAlpha = 0.3 * (1 - p);
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, 7);
        ctx.fill();
        ctx.globalAlpha = 1 - p;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 0.22;
        ctx.beginPath();
        ctx.arc(e.x, e.y, calm.matches ? e.r : e.r * (0.35 + 0.65 * Math.min(1, p * 1.6)), 0, 7);
        ctx.stroke();
        ctx.strokeStyle = pal.gold;
        ctx.lineWidth = 0.1;
        ctx.beginPath();
        ctx.arc(e.x, e.y, calm.matches ? e.r * 0.9 : e.r * (0.2 + 0.8 * Math.min(1, p * 1.2)), 0, 7);
        ctx.stroke();
      } else if (e.k === 'disarm') {
        // 豊臣秀吉の諸行無常：軍の色の輪が足元から範囲のふちへ広がり（前の半分）、掛かった相手の所で、軍の色の×印がはじけて
        // 薄れる（後の半分）。動きを減らす設定では、輪は範囲のふちに出し、×印は広げない
        const col = sideColor(e.side);
        ctx.strokeStyle = col;
        ctx.globalAlpha = 1 - p;
        ctx.lineWidth = 0.18;
        ctx.beginPath();
        ctx.arc(e.x, e.y, calm.matches ? e.r : e.r * (0.25 + 0.75 * Math.min(1, p * 2)), 0, 7);
        ctx.stroke();
        if (p >= 0.5 || calm.matches) {
          const q = calm.matches ? 0.5 : (p - 0.5) / 0.5;
          const h = 0.2 + 0.18 * (calm.matches ? 0 : q);
          ctx.globalAlpha = 1 - q * 0.8;
          ctx.lineWidth = 0.1;
          ctx.lineCap = 'round';
          for (const id of e.to) {
            const tg = b?.byId[id];
            if (!tg || tg.hp <= 0) continue;
            const [tx, ty] = centerOf(tg);
            ctx.beginPath();
            ctx.moveTo(tx - h, ty - h);
            ctx.lineTo(tx + h, ty + h);
            ctx.moveTo(tx + h, ty - h);
            ctx.lineTo(tx - h, ty + h);
            ctx.stroke();
          }
        }
      } else if (e.k === 'ward') {
        // 徳川家康の金城鉄壁の範囲：金の円を効果の続くあいだ出し、切れる前に薄くする。円は家康と一緒に動く
        const cu = b?.byId[e.uid];
        const c = cu && !cu.isB ? cu : undefined;
        const ex = c ? c.x : e.x;
        const ey = c ? c.y : e.y;
        const fade = Math.min(1, (e.ttl - e.t) * 2);
        ctx.fillStyle = pal.gold;
        ctx.strokeStyle = pal.gold;
        ctx.globalAlpha = 0.16 * fade;
        ctx.beginPath();
        ctx.arc(ex, ey, e.r, 0, 7);
        ctx.fill();
        ctx.globalAlpha = 0.8 * fade;
        ctx.lineWidth = 0.07;
        ctx.setLineDash([0.3, 0.16]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }
  }
  // 飛び道具：今の位置に描き、進んだ割合（飛んだ距離÷（飛んだ距離＋残りの距離））で山なりに持ち上げる。
  // 櫓・大筒から撃ったものは、建物の上から撃ち出す
  const ARC: Record<ShotKind, number> = { arrow: 0.12, bullet: 0, ball: 0.4 }; // 山の高さ（飛ぶ距離に対する割合）
  const TAIL: Record<ShotKind, number> = { arrow: 0.35, bullet: 1.2, ball: 0 }; // 描く尾の長さ（マス）
  const PIERCE_TAIL = 1.2; // 貫通の矢の光の尾の長さ（マス）。長く太くするとビームに見えるので、控えめにする
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
  // 矢・弾・煙を撃った、大きな絵の飛び道具の駒（信長・光義・弓兵。ほかの者が撃ったものなら null）。
  // 矢・弾・煙が初めて画面に出たときに一度だけ決めて覚える（飛んでいる途中で撃った者が動いても、出る所が変わらないように）。
  // 撃った者は、撃ち出した所の近くにいて、今まさに攻撃した駒（近くにいるだけのほかの者を取り違えないように）。
  // 撃ったものと同じ武器（矢なら弓、弾と煙なら鉄砲）を持ち、軍が分かれば同じ軍の駒に限る（櫓のそばの弓兵を、櫓の矢の撃ち手と取り違えないように）
  const shooters = new WeakMap<object, Unit | null>();
  function bigShooterOf(
    b: Battle,
    key: object,
    sx: number,
    sy: number,
    weapon: 'gun' | 'bow' | null,
    side?: string,
  ): Unit | null {
    const known = shooters.get(key);
    if (known !== undefined) return known;
    let best: Unit | null = null;
    let bestD = 0.5;
    for (const u of weapon ? [...b.defenders, ...b.attackers] : []) {
      if (!bigMuzzle(u.kind) || shotWeapon(u.kind) !== weapon || (side && u.side !== side)) continue;
      // スキルの矢・弾は、溜めが終わってから出るので、溜めの分だけ待つ。続けて撃つスキル（国士無双）は、最後の1発まで待つ。
      // 足止めで溜めが遅れた分（atkLag）は、攻撃してからの経過から引く
      const late = u.atkSkill ? skillSpan(u.side === 'd' ? defOf(u) : ADEF[u.kind]) : 0;
      if (u.atkT < 0 || b.t - u.atkT - u.atkLag > 0.3 + late) continue;
      const d = Math.hypot(u.x - sx, u.y - sy);
      if (d < bestD) {
        best = u;
        bestD = d;
      }
    }
    shooters.set(key, best);
    return best;
  }
  // 撃ち出す所：撃った位置からの横のずれ（ox, oy）と、ふつうの飛ぶ高さからの持ち上げ（lift）。
  // 大筒は筒の口から、ほかの施設は建物の上から、武将・兵はその場から撃ち出す
  function muzzleOf(b: Battle, sx: number, sy: number, dx = 0, dy = 0, shooter: Unit | null = null) {
    // 大きな絵の飛び道具の駒は、構えた所から撃つ（鉄砲の信長は肩の高さの銃口、弓の光義と弓兵は引き絞った弓の握り）
    const mz = shooter && bigMuzzle(shooter.kind);
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
      const by = bigShooterOf(b, sh, sh.sx, sh.sy, SHOT_WEAPON[sh.k], sh.side);
      const { ox, oy, lift } = muzzleOf(b, sh.sx, sh.sy, sh.tx - sh.sx, sh.ty - sh.sy, by);
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
        // 貫通の矢（大島光義のスキル）：ふつうの矢より少し長い光の尾を引き、薄い金のにじみと白い芯で光らせる
        if (sh.pierce) {
          const far = Math.min(PIERCE_TAIL, done);
          const t2 = at(sh.x - ux * far, sh.y - uy * far, (done - far) / len);
          for (const [color, w, a] of [
            [pal.gold, 0.1, 0.25],
            ['#fffbe8', 0.04, 0.6],
          ] as const) {
            ctx.strokeStyle = color;
            ctx.lineWidth = w;
            ctx.globalAlpha = a;
            ctx.beginPath();
            ctx.moveTo(t2.x, t2.y);
            ctx.lineTo(head.x, head.y);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
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
      // 大きな絵の鉄砲の武将（信長）は、銃口の火花と煙を絵の側に描いているので、その煙はここでは描かない
      if (bigShooterOf(b, e, e.x, e.y, 'gun')) continue;
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
  // 徳川家康の効果の範囲：地面から金の光の筋が立ちのぼる。筋の位置は範囲の中に散らして決めておく。
  // 動きを減らす設定では、筋を止めて薄く出す
  const WARD_RISE = 1.3; // 筋が立ちのぼる周期（秒）
  const WARD_RAYS = 16;
  function drawWardRays(b: Battle) {
    ctx.save();
    ctx.strokeStyle = pal.gold;
    ctx.lineCap = 'round';
    ctx.lineWidth = 0.05;
    for (const e of b.effects) {
      if (e.k !== 'ward') continue;
      const cu = b.byId[e.uid];
      const c = cu && !cu.isB ? cu : undefined;
      const ex = c ? c.x : e.x;
      const ey = c ? c.y : e.y;
      const fade = Math.min(1, (e.ttl - e.t) * 2);
      for (let i = 0; i < WARD_RAYS; i++) {
        // 黄金角で散らすと、円の中にむらなく並ぶ
        const a = i * 2.39996;
        const o = e.r * Math.sqrt((i + 0.5) / WARD_RAYS);
        const x = ex + Math.cos(a) * o;
        const y = ey + Math.sin(a) * o;
        const q = calm.matches ? 0.5 : (e.t / WARD_RISE + i / WARD_RAYS) % 1;
        const z = groundZ(hs, x, y) + 0.05 + 0.75 * q;
        const c0 = scr(x, y, z);
        const c1 = scr(x, y, z + 0.28);
        ctx.globalAlpha = (calm.matches ? 0.35 : 0.8) * fade * Math.sin(q * Math.PI);
        ctx.beginPath();
        ctx.moveTo(c0.x, c0.y);
        ctx.lineTo(c1.x, c1.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  // 武田信玄が騎兵を呼んだ所の土埃：足元から輪になって舞い上がる。動きを減らす設定では広げない
  const DUST = ['#a8926e', '#c2ad8a', '#dbcdb2'];
  // alpha は濃さ、rise は舞い上がる高さ（マス）
  function puff(x: number, y: number, q: number, r: number, i: number, alpha = 0.85, rise = 0.42) {
    const c = scr(x, y, groundZ(hs, x, y) + 0.06 + rise * q);
    ctx.globalAlpha = alpha * (1 - q);
    ctx.fillStyle = DUST[i % DUST.length];
    ctx.beginPath();
    ctx.arc(c.x, c.y, r * (0.6 + q), 0, 7);
    ctx.fill();
  }
  function drawSummonDust(b: Battle) {
    ctx.save();
    for (const e of b.effects) {
      if (e.k !== 'summon') continue;
      const q = calm.matches ? 0.5 : e.t / e.ttl;
      // 駒の絵の上に重なるので、足元の的や騎兵を隠さないよう、薄く小さく、低く、足元より外の輪にする
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const o = 0.5 + 0.6 * q;
        puff(e.x + Math.cos(a) * o, e.y + Math.sin(a) * o, q, 0.12, i, 0.45, 0.12);
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
    disc(x + 0.5, y + 0.5, GDEF[kind].aggro, pal.def, 0.08);
  }
  function rangeRing(x: number, y: number, range: number, color = pal.def) {
    if (range <= 1.5) return;
    ring(x + 0.5, y + 0.5, range, color, 0.5, 0.05, [0.2, 0.15]);
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
  // 防衛の配置で合わせている門と、その門と近すぎる門（同じ郭の外周で GATE_SPACING より近い門）。門に合わせていなければ null
  function gatePeers(v: View): { g: PlacedBuilding; peers: PlacedBuilding[] } | null {
    const hv = v.hover;
    if (v.mode !== 'edit' || !hv || v.drag || !v.castle) return null;
    const g = v.layout.buildings.find((q) => q.type === 'gate' && q.x === hv.x && q.y === hv.y);
    if (!g) return null;
    return { g, peers: closePeers(v.castle, g) };
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
      // 守りの兵（呼ばれた騎兵）は、持ち場の範囲を出さない
      const u = b.defenders.find((d) => d.hp > 0 && isGeneralDefender(d) && Math.hypot(d.x - tx, d.y - ty) < 0.75);
      if (u && isGeneralDefender(u)) gen = { kind: u.kind, x: u.x, y: u.y, hx: u.hx, hy: u.hy };
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
    // 防衛の配置で門に合わせたら、門の間かく（GATE_SPACING）の円を出し、近すぎる門（同じ郭の外周の門）を線で結んで赤く囲む
    // 効果の範囲（塗った円）と見分けるため、塗らずに白い長めの点線だけにする。何の円かは、門の案内の札に書く
    // 相手の門を結ぶ線と印・文字は、城壁に隠れないよう、重ねる canvas に描く（drawGatePeers）
    const gp = b ? null : gatePeers(v);
    if (gp) {
      ring(gp.g.x + 0.5, gp.g.y + 0.5, GATE_SPACING, GATE_RING, 0.9, 0.08, [0.6, 0.3]);
      outline(gp.g.x, gp.g.y, 1, 1);
      return true;
    }
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
  // スキルの溜め（構え）：スキルごとに、効く所と効くまでの残りを地面に描く。飛び道具のスキルは狙った相手への点線、
  // 一騎当千・諸行無常・千軍万馬は足元の円、金城鉄壁は広がる金の輪、煙炎漲天は落ちる場所の点線の円。
  // 円の残りは、ふちを盤面の北から（盤面の上で時計回りに）なぞる太い線で示し、一周したら効く（攻め・守りとも）。
  // 円は地面の絵に描くので、画面で見える始まりの位置は、カメラの向きで変わる。b は狙った相手を引くのに使う
  const SUMMON_RING = 0.8; // 騎兵を呼ぶ溜めのあいだ、足元に出す円の半径（マス）
  function castRing(b: Battle, u: Unit) {
    if (!u.cast) return;
    const d = u.side === 'd' ? defOf(u) : ADEF[u.kind];
    // 煙炎漲天の円の半径（スキルの煙炎漲天（昌幸））
    const r = d.skillRadius ?? 0;
    // 続けて撃つスキル（国士無双）の2発目からは、溜めは終わっているので、狙いの線を濃いままにする
    const k = u.cast.fired ? 1 : Math.min(1, Math.max(0, 1 - u.cast.t / (d.skillWindup ?? 1)));
    const { x, y } = u.cast;
    ctx.save();
    // 飛び道具のスキル（光義の弓・信長の国士無双）の溜め：狙った相手へ、軍の色の細い点線を引く。溜めが進むほど濃くし、溜めが終わると矢・弾が出る
    if (u.cast.skill && d.skillShot) {
      const tg = u.cast.tg ? b.byId[u.cast.tg] : undefined;
      if (tg && tg.hp > 0) {
        const [tx, ty] = centerOf(tg);
        ctx.strokeStyle = sideColor(u.side);
        ctx.globalAlpha = 0.35 + 0.65 * k;
        ctx.lineWidth = 0.06;
        ctx.setLineDash([0.18, 0.14]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    // 上杉謙信のスキル（一騎当千）と豊臣秀吉のスキル（諸行無常）の溜め：範囲の円を軍の色で薄く塗り、ふちを点線で示す。
    // 残りは煙炎漲天と同じく、ふちをなぞる太い線で示し、一周したら斬る（諸行無常は掛かる）
    // 武田信玄の千軍万馬も、足元に小さな円（SUMMON_RING）を出し、一周したら呼ぶ
    if (u.cast.skill && (d.spin || d.disarm || d.summon)) {
      const sr = (d.spin ? d.spinRadius : d.disarm ? d.disarmRadius : SUMMON_RING) ?? 0;
      chargeRing(x, y, sr, sideColor(u.side), k);
      ctx.restore();
      return;
    }
    // 徳川家康のスキルの溜め：中から範囲のふちへ太い輪が広がり、届くと効果が掛かる
    // 動きを減らす設定では、広がらない薄い輪を範囲のふちに出す
    if (u.cast.skill && d.ward) {
      ctx.strokeStyle = pal.gold;
      ctx.lineWidth = calm.matches ? 0.08 : 0.16;
      ctx.globalAlpha = calm.matches ? 0.35 : 1;
      ctx.beginPath();
      ctx.arc(x, y, WARD_RADIUS * (calm.matches ? 1 : 0.15 + 0.85 * k), 0, 7);
      ctx.stroke();
      ctx.restore();
      return;
    }
    chargeRing(x, y, r, pal.fire, k);
    ctx.restore();
  }
  // スキルの溜めの円：円を color で薄く塗り、ふちを点線で示し、残り k（0〜1）をふちをなぞる太い線で示す
  // （一騎当千・諸行無常・千軍万馬・煙炎漲天）
  function chargeRing(x: number, y: number, r: number, color: string, k: number) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
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

  // 効果が掛かっているあいだ、足元に輪を出す。切れる直前は薄くなる。end は効果の切れる時刻、size は建物の大きさに
  // 掛ける倍率、r は武将と兵の輪の半径、dash は点線（実線なら空）
  function effectMark(
    b: Battle,
    e: Entity,
    end: number,
    color: string,
    alpha: number,
    width: number,
    size: number,
    r: number,
    dash: number[],
  ) {
    const left = end - b.t;
    if (left <= 0 || e.hp <= 0) return;
    const [x, y] = centerOf(e);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha * Math.min(1, left * 2);
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.arc(x, y, e.isB ? Math.max(e.w, e.h) * size : r, 0, 7);
    ctx.stroke();
    ctx.restore();
  }
  // 傷を減らす効果（家康の金城鉄壁）：金の輪。効果は家康の周りに付くので、今その範囲にいる相手にだけ出す
  const wardMark = (b: Battle, e: Entity) =>
    effectMark(b, e, wardAuraOf(b, e).until, pal.gold, 0.85, 0.07, 0.6, 0.42, []);

  // 与える傷を減らす効果（諸行無常）が掛かっているあいだ、足元に、掛けた側の軍の色の点線の輪を出す（家康の金の輪の内側）。
  // 切れる直前は薄くなる。施設に掛けるのは攻めの秀吉、兵と武将は掛けられた側の敵が掛けたもの
  // 諸行無常の効果は秀吉の周りに付くので、今その範囲にいる相手にだけ出す
  const disarmMark = (b: Battle, e: Entity) =>
    effectMark(
      b,
      e,
      disarmAuraOf(b, e).until,
      sideColor(e.isB || e.side === 'd' ? 'a' : 'd'),
      0.9,
      0.08,
      0.5,
      0.34,
      [0.12, 0.09],
    );

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
  let terrain: { hs: Heights; waterKey: string; g: Group } | null = null;
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
    // 川と堀は掘り下げて水を張る（橋の上は地面の高さを歩く）。堀を引くと配列ごと作り直すので、配列が変わったかで見る。
    // 防衛配置では、決まりに外れた堀（引けない所・上限を超えた分）は水を張らず、地面の高さで赤い印を見せる
    const { water, moat } = v.layout;
    const off = new Set(v.mode === 'edit' && v.castle ? [...v.castle.moatAstray, ...v.castle.moatOver] : []);
    const waterKey = `${water ? idOf(water) : 0}|${moat ? idOf(moat) : 0}|${[...off].join(',')}`;
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
    const dug = moat?.map((m, i) => (m && !off.has(i) ? 1 : 0));
    const wet = dug ? dug.map((m, i) => (m || water?.[i] ? 1 : 0)) : water;
    terrain = { hs, waterKey, g: buildTerrain(hs, groundMat, wet, waterMat, dug) };
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
    dropWalls();
    for (const g of protos.values())
      g.traverse((o) => {
        if (o instanceof Mesh) o.geometry.dispose();
      });
    protos.clear();
  }
  function protoOf(key: string, make: () => Group): Group {
    let proto = protos.get(key);
    if (!proto) {
      proto = make();
      protos.set(key, proto);
    }
    return proto;
  }
  function model(key: string, make: () => Group): Group {
    let p = pools.get(key);
    if (!p) {
      p = { list: [], n: 0 };
      pools.set(key, p);
    }
    let g = p.list[p.n];
    if (!g) {
      g = protoOf(key, make).clone();
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
  // ---- 城壁はまとめて描く ----
  // 城壁は数が多い（城域いっぱいに引くと千を超える）ので、1つずつ描くと描く回数が増えて重い。
  // 敷地の大きさ・つながる向き・濃さ（決まりに外れた城壁は半ば透かす）の組ごとに、形の部品（材質ごとに1つ）を
  // InstancedMesh にして、同じ組の城壁をまとめて1回で描く。傷を受けて光るものは、今までどおり building3d で1つずつ描く（数は少ない）。
  // 半透明のものは奥から順に描くが、まとめた組は組ごとにしか並ばない。そこで半ば透かした組は、水面（半透明で深さを書く）より
  // 後に描くよう renderOrder を上げる。水面より奥の所は、水面が書いた深さで隠れるので、前後は崩れない
  interface WallSet {
    f: Rect; // 敷地の大きさ（w・h だけを使う）
    links: number;
    alpha: number;
    parts: InstancedMesh[]; // 部品ごと（形の子の Mesh と同じ順）
    cells: Rect[]; // 置いた城壁の敷地（当たり判定で、当たった城壁のマスを求める）
    drawn: { hs: typeof hs; at: number[] } | null; // 前に写した並び（同じなら写し直さない）
  }
  const wallSets = new Map<string, WallSet>(); // `大きさ|つながる向き|濃さ` → まとめて描く城壁
  const SEE_THROUGH_ORDER = 2;
  const at4 = new Matrix4();
  function wall3d(f: Rect, links: number, alpha = 1) {
    const key = `${f.w}x${f.h}|${links}|${alpha}`;
    let ws = wallSets.get(key);
    if (!ws) {
      ws = { f, links, alpha, parts: [], cells: [], drawn: null };
      wallSets.set(key, ws);
    }
    ws.cells.push(f);
  }
  function dropParts(ws: WallSet) {
    for (const m of ws.parts) {
      wallBatch.remove(m);
      m.dispose();
    }
    ws.parts = [];
    ws.drawn = null;
  }
  // このコマで置いた城壁を、まとめて描く形へ写す。足りなければ、倍の数を入れられる形に作り直す
  function flushWalls() {
    for (const [key, ws] of wallSets) {
      const { f: size, links, alpha } = ws;
      const n = ws.cells.length;
      // 空になった組は捨てる（城壁を消したあとに、大きな入れ物を持ち続けないよう）
      if (!n) {
        dropParts(ws);
        wallSets.delete(key);
        continue;
      }
      if (n > (ws.parts[0]?.instanceMatrix.count ?? 0)) {
        dropParts(ws);
        const cap = Math.max(64, 2 ** Math.ceil(Math.log2(n)));
        const proto = protoOf(`wall|${size.w}x${size.h}|${links}`, () =>
          buildModel('wall', size.w, size.h, look(), { links }),
        );
        // 城壁の形は merged で材質ごとに1つの Mesh にまとめてあるので、材質が配列の部品はない
        proto.traverse((o) => {
          if (!(o instanceof Mesh) || Array.isArray(o.material)) return;
          const m = new InstancedMesh(o.geometry, variant(o.material as Material, alpha, false), cap);
          // 薄く出すものは、影を落とさず、マスを選ぶ当たり判定にも入れない（building3d と同じ）
          m.castShadow = alpha >= 1;
          m.receiveShadow = o.receiveShadow;
          if (alpha >= 1) m.userData.cells = ws.cells;
          else m.renderOrder = SEE_THROUGH_ORDER;
          ws.parts.push(m);
          wallBatch.add(m);
        });
      }
      for (const m of ws.parts) m.count = n;
      // 攻城では戦いの時間が進むたびに並べ直すが、城壁は動かないので、並びと地形が前と同じなら写し直さない
      const at = ws.cells.flatMap((c) => [c.x0, c.y0]);
      const d = ws.drawn;
      if (d && d.hs === hs && d.at.length === at.length && d.at.every((v, i) => v === at[i])) continue;
      ws.drawn = { hs, at };
      ws.cells.forEach((c, i) => {
        at4.makeTranslation(c.x0 + c.w / 2, footZ(hs, c.x0, c.y0, c.w, c.h), c.y0 + c.h / 2);
        for (const m of ws.parts) m.setMatrixAt(i, at4);
      });
      for (const m of ws.parts) {
        m.instanceMatrix.needsUpdate = true;
        // 映る範囲の判定と当たり判定は、この囲みの球を使うので、置き直した城壁に合わせる
        m.computeBoundingSphere();
      }
    }
  }
  // 配色が変わって形を作り直すときは、まとめて描く城壁も作り直す（形と材質を借りているので）
  function dropWalls() {
    for (const ws of wallSets.values()) dropParts(ws);
    wallSets.clear();
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
  // 武将の7人と兵の6種は、斜め前・斜め後ろの2方向を描いた大きな絵を使う（bigBusho.ts）。
  // 揺れ・踏み込み・倒れの回転・斬撃の弧は絵の側にあるので、ここでは足しない。武将は絵の幟を立てる（兵は幟を持たない）
  function bigUnit(
    kind: AttackerKind,
    x: number,
    y: number,
    side: string,
    alpha: number,
    flash = 0,
    pose?: Pose,
    hit: Hit = {},
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
    bigUnit(kind, x, y, side, alpha, flash, pose, hit);
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
    // 堀：川と同じ水の地面の絵に、岸の切り石の縁を描く（川と見分ける）
    const moat = v.layout.moat;
    if (moat)
      for (let i = 0; i < W * H; i++) {
        if (!moat[i]) continue;
        drawWater(i % W, (i / W) | 0, 1);
        drawMoatRim(v.layout, i % W, (i / W) | 0);
      }
    const b = v.mode === 'edit' ? null : v.battle;
    // 引き橋：防衛の配置では下りた橋（開戦前の確かめで橋として数えるため）。攻城では、上がっているあいだは門の前に立てた板で、
    // 門が壊れると下りた橋になる
    const lifts = b
      ? b.drawbridges.map((d) => {
          const g = b.byId[d.gate] as BuildingEnt;
          return { k: d.k, gx: g.x0, gy: g.y0, down: d.down };
        })
      : moat
        ? (v.castle?.drawbridges ?? drawbridges(v.layout)).map((d) => ({
            k: d.k,
            gx: d.gate.x,
            gy: d.gate.y,
            down: true,
          }))
        : [];
    for (const d of lifts) {
      const x = d.k % W;
      const y = (d.k / W) | 0;
      const g = d.down
        ? model(`bridge|${d.gy === y ? 'x' : 'y'}`, () => buildBridge(d.gy === y ? 'x' : 'y'))
        : model('drawbridge', buildRaisedBridge);
      g.position.set(x + 0.5, groundZ(hs, x + 0.5, y + 0.5), y + 0.5);
      // 上がった板は、門の側（模型では -x）へ向ける
      if (!d.down) g.rotation.y = Math.atan2(d.gy - y, -(d.gx - x));
      g.userData.fp = null;
      tint(g, 1, false);
    }
    // 防衛の配置では、郭を二の丸・三の丸で色分けし（広い土地は濃く）、決まりに外れた塀・施設の地面を赤くする
    const shape = v.mode === 'edit' ? v.castle : null;
    if (shape) paintCastle(shape);
    const stray = new Set(shape?.bad.map((s) => `${s.x},${s.y}`));
    if (!b) {
      const walls = new Set(
        v.layout.buildings.filter((bd) => bd.type === 'wall' || bd.type === 'gate').map((bd) => `${bd.x},${bd.y}`),
      );
      const isWall = (x: number, y: number) => walls.has(`${x},${y}`);
      v.layout.buildings.forEach((bd, i) => {
        const f = fpOf(bd);
        // 決まりに外れた塀・施設は、下の赤い地面が見えるよう、半ば透かす
        const a = Math.min(draggedB(v, i), stray.has(`${bd.x},${bd.y}`) ? STRAY_ALPHA : 1);
        if (bd.type === 'wall') {
          wall3d(f, linksAt(isWall, bd.x, bd.y), a);
        } else building3d(bd.type, f, a);
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
        } else if (bd.type === 'wall') {
          const links = linksAt(isWall, bd.x0, bd.y0);
          if (bd.fl > 0) building3d('wall', bd, 1, true, false, { links });
          else wall3d(bd, links);
        } else building3d(bd.type, bd, 1, bd.fl > 0, false, {}, bd.type === 'cata' ? cataAngle(bd) : 0);
      }
      const units = [...b.defenders, ...b.attackers];
      for (const u of units) castRing(b, u);
      if (!b.over)
        for (const e of [...units, ...b.buildings]) {
          wardMark(b, e);
          disarmMark(b, e);
        }
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
      // 地面に描く演出。戦いが終わると効果の時間が進まないので、火のほかは描かない
      drawEffects(
        b.effects.filter((e) => GROUND_FX.has(e.k) && (e.k === 'fire' || !b.over)),
        b,
      );
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
  // 塀と郭の形を、地面の絵に描く：本丸を囲む郭を内から金・緑…と交互に、出丸を橙で塗り（広い土地は濃く）、
  // 決まりに外れた塀・施設・堀の地面と、城の門へ行けない城の外を赤く
  function paintCastle(shape: CastleShape) {
    ctx.save();
    const rings = [pal.gold, pal.hp];
    for (let i = 0; i < W * H; i++) {
      const k = shape.tileKuruwa[i];
      if (!k) continue;
      const info = shape.kuruwa[k - 1];
      ctx.globalAlpha = shape.land[i] ? 0.3 : 0.1;
      ctx.fillStyle = info.surround ? rings[(k - 1) % rings.length] : pal.fire;
      ctx.fillRect(i % W, (i / W) | 0, 1, 1);
    }
    // 城の門へ行けない城の外
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = pal.bad;
    for (let i = 0; i < W * H; i++) if (shape.cutOff[i]) ctx.fillRect(i % W, (i / W) | 0, 1, 1);
    ctx.globalAlpha = 0.55;
    // 引けない所の堀と、上限を超えた堀も、決まりに外れたものと同じく赤く
    const moats = [...shape.moatAstray, ...shape.moatOver].map((k) => ({
      x: k % W,
      y: (k / W) | 0,
    }));
    for (const s of [...shape.bad, ...moats]) ctx.fillRect(s.x, s.y, 1, 1);
    ctx.restore();
    for (const s of [...shape.bad, ...moats]) badTile(s.x, s.y);
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
      // 堀は、引けるマスに水の色を薄く、引けないマスに印を出す
      if (tool === 'moat') {
        if (r.ok) drawWater(x, y, 0.6);
        else badTile(x, y);
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
      bigUnit(tool, x + 0.5, y + 0.5, pal.def, a);
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
    bigUnit(kind, x + 0.5, y + 0.5, pal.atk, ok ? 0.65 : 0.25);
    if (!ok) badTile(x, y);
  }

  // ---- 重ねる canvas（体力のバー・数・矢） ----------------------------------
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
  // 煙炎漲天を受けて燃える炎：体（建物は屋根の下）のまわりに3つの炎を重ね、揺らしながら消していく。
  // at(h) は、炎の足元から h（HUD_UNIT 単位）上の位置。size は炎の大きさ（武将の絵に対する割合）
  const FLAMES = [
    [-0.16, 0.12, 0],
    [0.15, 0.22, 1],
    [0, 0.4, 2],
  ] as const; // 横のずれ・高さ（HUD_UNIT）・コマのずらし
  // 炎：煙炎漲天を受けた時（burnT）から出し、燃え終わる時刻（burnEnd。燃え続ける傷がなければ BURN_TIME のあと）の前に薄くする
  function flames(at: (h: number) => Pt, burnT: number, size: number, now: number, burnEnd = 0) {
    const t = tracker.t - burnT;
    const len = Math.max(BURN_TIME, burnEnd - burnT);
    if (burnT < 0 || t < 0 || t >= len) return;
    const dot = (size * (0.7 + 0.3 * Math.min(1, (t / BURN_TIME) * 6))) / SPR_UNIT;
    const fade = 0.4 * BURN_TIME; // 消える前に薄くなる長さ
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = Math.min(1, (len - t) / fade);
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
      flames(lift(cx, cy, z), bd.burnT, 1.5 * Math.sqrt(Math.max(bd.w, bd.h)), now, bd.burnEnd);
    }
    for (const d of tracker.dying)
      flames(lift(d.x, d.y, groundZ(hs, d.x, d.y)), d.burn, bigScale(d.kind), now, d.burnEnd);
    for (const u of units) flames((h) => headOf(u, h), u.burnT, bigScale(u.kind), now, u.burnEnd);
  }
  // 鉤縄を持った兵：頭の上（体力のバーの上）に、巻いた縄と鉤の印を出す。掛けているあいだは、
  // 掛ける所から引き橋の門へ縄の点線を引き、印のまわりに残りの時間を弧で示す
  function drawHooks(b: Battle) {
    for (const u of b.attackers) {
      if (u.item !== 'hook' || u.hp <= 0) continue;
      const p = headOf(u, bigBarDots(u.kind) / SPR_UNIT);
      const cx = p.x;
      const cy = p.y - 0.28;
      ctx.save();
      ctx.lineCap = 'round';
      if (u.hookT > 0) {
        const g = u.hookGate ? (b.byId[u.hookGate] as BuildingEnt | undefined) : null;
        if (g) {
          const a = footOf(u.x, u.y);
          const z = groundZ(hs, g.x0 + 0.5, g.y0 + 0.5) + (HEIGHT.gate ?? 0) * 0.8;
          const t = scr(g.x0 + 0.5, g.y0 + 0.5, z);
          ctx.strokeStyle = pal.gold;
          ctx.lineWidth = 0.035;
          ctx.setLineDash([0.08, 0.06]);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y - 0.3);
          ctx.lineTo(t.x, t.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.strokeStyle = pal.gold;
        ctx.lineWidth = 0.05;
        ctx.beginPath();
        ctx.arc(cx, cy, 0.17, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * Math.min(1, u.hookT / ITEMS.hook.time));
        ctx.stroke();
      }
      // 巻いた縄（茶の輪を2重）と、上に出た鉄の鉤
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 0.075;
      ctx.beginPath();
      ctx.arc(cx, cy, 0.1, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.strokeStyle = '#a07a46';
      ctx.lineWidth = 0.04;
      for (const r of [0.1, 0.055]) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, 2 * Math.PI);
        ctx.stroke();
      }
      ctx.strokeStyle = '#d8d8d8';
      ctx.lineWidth = 0.03;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 0.1);
      ctx.lineTo(cx, cy - 0.2);
      ctx.arc(cx + 0.045, cy - 0.2, 0.045, Math.PI, 0);
      ctx.stroke();
      ctx.restore();
    }
  }
  // 重ねる canvas の文字。地面や建物の上でも読めるよう、暗い縁を付ける
  function hudLabel(str: string, x: number, y: number, color: string) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(0.01, 0.01);
    ctx.font = `800 ${0.42 * 100}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.1 * 100;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(str, 0, 0);
    ctx.fillStyle = color;
    ctx.fillText(str, 0, 0);
    ctx.restore();
  }
  // 防衛の配置で門に合わせたとき、近すぎる門の上に赤い丸と距離を出して、合わせた門の上と線で結ぶ
  // 城壁に隠れないよう、重ねる canvas に描く（何の円かは、門の案内の札に書く）
  function drawGatePeers(v: View) {
    const gp = gatePeers(v);
    if (!gp) return;
    const top = (q: PlacedBuilding) =>
      scr(q.x + 0.5, q.y + 0.5, groundZ(hs, q.x + 0.5, q.y + 0.5) + (HEIGHT.gate ?? 0));
    if (!gp.peers.length) return;
    const a = top(gp.g);
    ctx.save();
    ctx.strokeStyle = pal.bad;
    ctx.lineWidth = 0.06;
    for (const q of gp.peers) {
      const p = top(q);
      ctx.setLineDash([0.12, 0.08]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 0.32, 0, 7);
      ctx.stroke();
    }
    ctx.restore();
    // 相手の門の上に、合わせた門からの直線の距離を出す
    for (const q of gp.peers) {
      const p = top(q);
      hudLabel(gateGap(gp.g, q), p.x, p.y - 0.36, pal.bad);
    }
  }
  function drawHud(v: View) {
    hctx.setTransform(1, 0, 0, 1, 0, 0);
    hctx.clearRect(0, 0, hud.width, hud.height);
    // 長さの単位は、見る先での1マスの対角の長さ（遠近で大きさは少し変わるが、バーや数は同じ大きさで描く）
    hudScale = (hud.height / ((2 * VIEW_HALF) / orbit.zoom)) * HUD_UNIT;
    camUp.setFromMatrixColumn(camera.matrixWorld, 1);
    hctx.setTransform(hudScale, 0, 0, hudScale, 0, 0);
    const b = v.mode === 'edit' ? null : v.battle;
    if (!b) {
      drawGatePeers(v);
      return;
    }
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
    // 武将と兵の体力のバー：武将は幟の上、兵は頭の上の端の上に出す（bigBarDots）
    for (const u of units) {
      if (u.hp >= u.maxHp) continue;
      const p = headOf(u, bigBarDots(u.kind) / SPR_UNIT);
      hpBar(p.x, p.y, 0.8, u.hp / u.maxHp);
    }
    drawHooks(b);
    gateCounts(v, (x, y) => footOf(x, y));
    // 飛び道具と命中は空中に描く
    // 戦いが終わると効果の時間が進まないので、刺さった矢も描かない
    if (!b.over) {
      drawStuck(b.effects);
      drawSmoke(b);
      drawSummonDust(b);
      drawWardRays(b);
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
      // 駒の高さを追っている途中も描き直す。配置は、変わるたびに増える版（layoutRev）で見る（毎コマ JSON にしないため）
      b ? `${idOf(b)}|${b.tick}|${b.over ? now : ''}|${zBusy ? now : ''}` : `${idOf(v.layout)}|${v.layoutRev}`,
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
      for (const ws of wallSets.values()) ws.cells.length = 0;
      sprN = 0;
      zBusy = false;
      ctx = gctx;
      gctx.setTransform(GPX, 0, 0, GPX, 0, 0);
      build(v);
      flushWalls();
      groundTex.needsUpdate = true;
      for (const p of pools.values()) for (let i = p.n; i < p.list.length; i++) p.list[i].visible = false;
      for (let i = sprN; i < sprPool.length; i++) sprPool[i].visible = false;
    }
    waterNormal.offset.set((now / 1000) * 0.03, (now / 1000) * 0.017);
    gl.render(scene, camera);
    ctx = hctx;
    try {
      drawHud(v);
    } finally {
      ctx = gctx;
    }
  }
  // 画面上の位置からマスを求める。建物に当たればその建物のマス、地面に当たればそのマス。盤面の外なら null。
  // ground なら、建物や駒を素通りして地面のマスを求める（駒の陰のマスも狙えるように）
  const ray = new Raycaster();
  const ndc = new Vector2();
  function tileAt(clientX: number, clientY: number, ground = false): Tile | null {
    if (!terrain) return null;
    const r = cv.getBoundingClientRect();
    // 盤面（canvas）の外を指しているときは、映っていないマスに当たらないよう、マスを返さない
    if (clientX < r.left || clientX >= r.right || clientY < r.top || clientY >= r.bottom) return null;
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, 1 - ((clientY - r.top) / r.height) * 2);
    ray.setFromCamera(ndc, camera);
    const targets: Object3D[] = ground
      ? terrain.g.children
      : [
          ...terrain.g.children,
          ...models.children.filter((o) => o.visible && o.userData.fp),
          ...wallBatch.children.filter((o) => o.visible && o.userData.cells),
          ...sprites.children.filter((o) => o.visible && o.userData.tile),
        ];
    for (const h of ray.intersectObjects(targets, true)) {
      // 武将・兵の板に当たったら、その駒のマス
      if (h.object.userData.tile) return { ...(h.object.userData.tile as Tile) };
      // まとめて描く城壁は、当たった城壁の番号（instanceId）から敷地を引く
      const cells = h.object.userData.cells as Rect[] | undefined;
      let o: Object3D | null = h.object;
      while (o && !o.userData.fp) o = o.parent;
      const fp = cells && h.instanceId !== undefined ? cells[h.instanceId] : (o?.userData.fp as Rect | undefined);
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
    const h = Math.max(0, ...kinds.map((k) => bigBarDots(k) / SPR_UNIT));
    camUp.setFromMatrixColumn(camera.matrixWorld, 1);
    tmp
      .set(x + 0.5, groundZ(hs, x + 0.5, y + 0.5), y + 0.5)
      .addScaledVector(camUp, h * HUD_UNIT)
      .project(camera);
    return { x: ((tmp.x + 1) / 2) * r.width, y: ((1 - tmp.y) / 2) * r.height };
  }

  // パネルや比較の画面のボタンに出す施設の絵：盤面と同じ3Dの形を、斜め上から小さく写す（icons.ts）
  const iconRenderer = createIconRenderer();
  function drawIcon(target: HTMLCanvasElement, type: IconKind) {
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
    // 画面の上から時計回りに測った、北の向き（ラジアン）。方位の針を回すのに使う
    get heading() {
      return orbit.az;
    },
    // 盤面に重なる部品（方位の針）の上で右・中ボタンを押したときも、盤面と同じく回す・動かす
    orbitBegin: (e: PointerEvent, pan: boolean) => orbit.begin(e, pan),
    look: (tx: number, ty: number, zoom: number) => orbit.look(tx, ty, zoom),
    // 矢印キーの向きを、今の向きから見た盤面の向きに直す
    arrow: (dx: number, dy: number) => orbit.arrow(dx, dy),
    // カメラを回している途中か
    get busy() {
      return orbit.busy;
    },
  };
}
