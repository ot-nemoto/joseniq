import {
  ADEF,
  type AttackerKind,
  type Battle,
  BDEF,
  type BuildingType,
  canDeploy,
  check,
  checkPut,
  type Effect,
  fpOf,
  GDEF,
  type GeneralKind,
  H,
  inRing,
  isBuildingType,
  isGeneralKind,
  type Layout,
  RING,
  type Tool,
  type Unit,
  W,
  ZONE,
} from '../sim';
import { type Dying, FALL_TIME, type Motion, MotionTracker, SLASH_TIME } from './motion';
import { blitBusho, type Frame, SPR_UNIT, swingsBlade } from './pixel';

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
  tool: Tool;
  unitSel: AttackerKind;
  drag: GeneralKind | null; // ドラッグで動かしている武将（配置画面）
}

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

// ---- 斜め見下ろし（アイソメトリック）表示 ---------------------------------
// 1マスを幅1・高さ0.5のひし形にする。高さは1マスあたり ISO_ZH だけ上にずらす。
const ISO_ZH = 0.6;
const ISO_TOP = 2.2; // 高い建物と体力バーのための上の余白
const ISO_BOTTOM = 0.6;
const ISO_W = (W + H) / 2;
const ISO_H = (W + H) / 4 + ISO_TOP + ISO_BOTTOM;
const ISO_OX = H / 2;
const UNIT_LIFT = 0.35; // 兵・将の駒を地面から浮かせる量
// 建物の高さ（マス単位）。ここにないもの（堀）は地面に描く
const HEIGHT: Partial<Record<BuildingType, number>> = {
  wall: 0.7,
  tbow: 1.42,
  tgun: 1.3,
  cata: 1.3,
  drum: 1.12,
  hall: 2.46,
  bar: 0.5,
};
// 建物の絵の色。絵として見せるため、明暗の配色によらず固定にする
const ART = {
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
};
// 屋根の色。櫓は種類ごとに変えて見分けやすくする（弓は緑青、鉄砲は黒い瓦）
interface RoofColor {
  fill: string;
  edge: string;
}
const ROOF: Record<'tile' | 'green' | 'black', RoofColor> = {
  tile: { fill: '#64737f', edge: '#323b43' },
  green: { fill: '#5c9d8b', edge: '#2c5d51' },
  black: { fill: '#363b41', edge: '#131619' },
};
// 2Dの天守の高さ（鯱の先まで）。この高さが敷地の縦にちょうど収まるよう縮尺を決める
const CASTLE_TOP = 2.15;
// 駒の描き方の変化：揺れ・傾き・踏み込み・斬撃・倒れ
interface Pose {
  bob: number;
  lean: number;
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
// 斜め表示の面ごとの陰（奥・右手前・左手前・左奥）。右手前から光が当たる向き
const ISO_SHADE = [0.04, 0.16, 0.32, 0];
interface Pt {
  x: number;
  y: number;
}
const proj = (x: number, y: number, z = 0): Pt => ({
  x: ISO_OX + (x - y) / 2,
  y: ISO_TOP + (x + y) / 4 - z * ISO_ZH,
});

export function createRenderer(cv: HTMLCanvasElement) {
  const c2d = cv.getContext('2d');
  if (!c2d) throw new Error('canvas 2d が使えません');
  const ctx = c2d;
  let pal = readPal();
  let frameNo = 0;
  let iso = false;
  // 武将の動き（試作）：戦闘の計算は変えず、前のコマとの差から歩く・斬る・倒れるを読み取る
  const tracker = new MotionTracker(); // 武将の動きの記録（motion.ts）
  const poses = new Map<number, Pose>(); // このコマの姿勢（描画と斬撃の弧で使い回す）

  function readPal(): Palette {
    const cs = getComputedStyle(document.documentElement);
    const p = {} as Palette;
    for (const [k, v] of Object.entries(PAL_VARS)) p[k as keyof Palette] = cs.getPropertyValue(v).trim();
    return p;
  }
  function resize() {
    const parent = cv.parentElement;
    const w = parent ? parent.getBoundingClientRect().width : 0;
    if (!w) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const aspect = iso ? ISO_H / ISO_W : H / W;
    cv.style.height = `${w * aspect}px`;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(w * aspect * dpr);
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

  function drawBuilding(
    type: BuildingType,
    x0: number,
    y0: number,
    w: number,
    h: number,
    alpha: number,
    hpRatio?: number,
    flash = 0,
  ) {
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
    } else if (
      type === 'bar' ||
      type === 'tbow' ||
      type === 'tgun' ||
      type === 'cata' ||
      type === 'drum' ||
      type === 'hall'
    )
      drawSide(type, x0, y0, w, h);
    if (flash > 0) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#fff';
      ctx.fillRect(x0, y0, w, h);
    }
    ctx.restore();
    if (hpRatio !== undefined && hpRatio < 1) hpBar(x0 + w / 2, y0 - 0.02, Math.min(0.9 * w, 1.6), hpRatio);
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
  // 2Dの本丸：正面から見た天守。(cx, yb) を足元の中心に、横 s・縦 sy 倍の寸法で描く。v は下からの高さ。
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
  // 2Dの施設と本丸：正面から見た絵を敷地の中に描く。寸法は敷地の半分を1とした値
  function drawSide(type: BuildingType, x0: number, y0: number, w: number, h: number) {
    const s = Math.min(w, h) / 2;
    const roofColor = type === 'tbow' ? ROOF.green : type === 'tgun' ? ROOF.black : ROOF.tile;
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
      // 投石機：車輪の付いた台に三角の脚、腕の短い側におもり、長い側に石
      k.poly([P(-0.8, 0.12), P(0.8, 0.12), P(0.8, 0.3), P(-0.8, 0.3)], ART.wood, ART.woodDk);
      for (const u of [-0.52, 0.52]) k.circle(P(u, 0.12), 0.13, ART.woodDk);
      k.line(P(-0.5, 0.3), P(0, 1.05), ART.woodDk, 0.05);
      k.line(P(0.5, 0.3), P(0, 1.05), ART.woodDk, 0.05);
      k.line(P(0.56, 0.62), P(-0.7, 1.6), ART.wood, 0.06);
      k.poly([P(0.42, 0.48), P(0.7, 0.48), P(0.7, 0.72), P(0.42, 0.72)], ART.weight, ART.woodDk);
      k.circle(P(0, 1.05), 0.06, pal.gold);
      k.circle(P(-0.74, 1.68), 0.09, pal.wall, pal.wallDk);
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
  function drawRubble(b: { x0: number; y0: number; w: number; h: number }) {
    ctx.save();
    ctx.fillStyle = 'rgba(70,60,50,0.32)';
    for (let yy = b.y0; yy < b.y0 + b.h; yy++)
      for (let xx = b.x0; xx < b.x0 + b.w; xx++) {
        ctx.fillRect(xx + 0.2, yy + 0.25, 0.3, 0.22);
        ctx.fillRect(xx + 0.5, yy + 0.55, 0.28, 0.2);
      }
    ctx.restore();
  }
  // ---- 武将の駒 -------------------------------------------------------------
  // 武将はドット絵の人の姿で描く（絵は pixel.ts）。どちらの軍かは鎧と幟の帯の色で示す
  function bushoToken(kind: GeneralKind, x: number, y: number, side: string, flash: number, pose?: Pose) {
    ctx.save();
    if (pose) {
      if (pose.dust > 0.02) dust(x, y, pose);
      applyPose(x, y, pose);
    }
    pixelBusho(kind, x, y, side, pose, flash);
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
  // 盤面の向きを画面の向きに直す（斜め表示なら投影した向き）
  function screenDir(x: number, y: number): [number, number] {
    const sx = iso ? (x - y) / 2 : x;
    const sy = iso ? (x + y) / 4 : y;
    const l = Math.hypot(sx, sy);
    return l > 1e-6 ? [sx / l, sy / l] : [1, 0];
  }
  function poseFor(m: Motion, t: number): Pose {
    const slash = m.atk >= 0 && t - m.atk < SLASH_TIME ? (t - m.atk) / SLASH_TIME : -1;
    const [dx, dy] = slash >= 0 ? screenDir(m.ax, m.ay) : screenDir(m.mx, m.my);
    const step = Math.sin(m.walk * Math.PI * 2.2);
    return {
      bob: Math.abs(step) * 0.07 * m.mv,
      lean: step * 0.07 * m.mv,
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
    const [dx, dy] = screenDir(d.mx, d.my);
    return {
      bob: 0,
      lean: 0,
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
  // 揺れ・踏み込み・倒れを、足元を軸にした変形で表す
  function applyPose(x: number, y: number, p: Pose) {
    const foot = y + 0.34;
    if (p.slash >= 0) {
      const lunge = Math.sin(Math.PI * Math.min(1, p.slash * 1.4)) * 0.16;
      ctx.translate(p.dx * lunge, p.dy * lunge);
    }
    ctx.translate(0, -p.bob);
    let rot = p.lean;
    if (p.fall >= 0) {
      const k = Math.min(1, p.fall / 0.45);
      rot = p.face * (Math.PI / 2) * (1 - (1 - k) ** 3);
      // 倒れきったら少しずつ消える
      ctx.globalAlpha *= p.fall < 0.55 ? 1 : 1 - (p.fall - 0.55) / 0.45;
    }
    ctx.translate(x, foot);
    ctx.rotate(rot);
    ctx.translate(-x, -foot);
  }
  // ドット絵の武将：姿勢からコマを選び、足元を基準に貼る
  function pixelBusho(kind: GeneralKind, x: number, y: number, side: string, pose: Pose | undefined, flash: number) {
    const face = pose?.face ?? 1;
    let frame: Frame = 'walk0';
    if (pose && pose.fall >= 0) frame = pose.fall < 0.22 ? 'down0' : 'down1';
    else if (pose && pose.slash >= 0) frame = pose.slash < 0.2 ? 'atk0' : pose.slash < 0.55 ? 'atk1' : 'atk2';
    else if (pose && pose.mv > 0.3) frame = `walk${Math.floor(pose.phase * 4) % 4}` as Frame;
    const m = ctx.getTransform();
    const foot = m.transformPoint(new DOMPoint(x, y + 0.36));
    // ドット1つの大きさは、1マスに合わせてそのまま使う。整数にそろえると、画面の幅によって
    // 武将の大きさが急に倍や半分に変わるため。ぼかさずに貼るので、ドットの不ぞろいはわずか
    const dot = Math.hypot(m.a, m.b) / SPR_UNIT;
    const fx = Math.round(foot.x);
    const fy = Math.round(foot.y);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    blitBusho(ctx, kind, frame, side, fx, fy, dot, face, flash);
    ctx.restore();
  }
  // 足が着くたびに、進む向きの後ろへ小さな土ぼこりを上げる
  function dust(x: number, y: number, p: Pose) {
    ctx.save();
    ctx.globalAlpha *= 0.55 * p.dust;
    ctx.fillStyle = ART.dust;
    for (const [k, r] of [
      [0.36, 0.1],
      [0.54, 0.07],
    ]) {
      ctx.beginPath();
      ctx.ellipse(x - p.dx * k, y + 0.34 - p.dy * k * 0.5, r * 1.4, r, 0, 0, 7);
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
  function drawGeneral(
    kind: GeneralKind,
    x: number,
    y: number,
    alpha: number,
    hpRatio?: number,
    flash = 0,
    pose?: Pose,
  ) {
    ctx.save();
    ctx.globalAlpha = alpha;
    bushoToken(kind, x, y, pal.def, flash, pose);
    ctx.restore();
    if (hpRatio !== undefined && hpRatio < 1) hpBar(x + 0.12, y - 0.84, 0.8, hpRatio);
  }
  function drawAttacker(
    kind: AttackerKind,
    x: number,
    y: number,
    alpha: number,
    hpRatio?: number,
    flash = 0,
    pose?: Pose,
  ) {
    const d = ADEF[kind];
    const r = kind === 'ram' ? 0.44 : kind === 'shd' ? 0.4 : kind === 'scout' ? 0.3 : 0.36;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (isGeneralKind(kind)) {
      bushoToken(kind, x, y, pal.atk, flash, pose);
      ctx.restore();
      if (hpRatio !== undefined && hpRatio < 1) hpBar(x + 0.12, y - 0.84, 0.8, hpRatio);
      return;
    }
    ctx.fillStyle = pal.atk;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 7);
    ctx.fill();
    ctx.strokeStyle = pal.ink;
    ctx.globalAlpha = alpha * 0.55;
    ctx.lineWidth = 0.05;
    ctx.stroke();
    ctx.globalAlpha = alpha;
    text(d.glyph, x, y, r * 1.45, pal.atkInk);
    if (flash > 0) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 7);
      ctx.fill();
    }
    ctx.restore();
    if (hpRatio !== undefined && hpRatio < 1) hpBar(x, y - r - 0.2, 0.8, hpRatio);
  }

  function drawField(v: View) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        ctx.fillStyle = (x + y) % 2 ? pal.field : pal.field2;
        ctx.fillRect(x, y, 1, 1);
      }
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

  function drawGhost(v: View) {
    const hv = v.hover;
    if (!hv || hv.x < 0 || hv.y < 0 || hv.x >= W || hv.y >= H) return;
    const { x, y } = hv;
    if (v.mode === 'edit') {
      // ドラッグ中は、動かしている武将の影を出す
      const tool = v.drag ?? v.tool;
      if (tool === 'erase') {
        badTile(x, y);
        return;
      }
      const r = v.drag ? checkPut(v.layout, v.drag, x, y) : check(v.layout, tool, x, y);
      const a = r.ok ? 0.6 : 0.3;
      let range: number;
      if (isBuildingType(tool)) {
        const f = fpOf({ type: tool, x, y });
        drawBuilding(tool, f.x0, f.y0, f.w, f.h, a);
        range = BDEF[tool].range || 0;
      } else {
        drawGeneral(tool, x + 0.5, y + 0.5, a);
        range = GDEF[tool].range;
        aggroDisc(tool, x, y);
      }
      rangeRing(x, y, range);
      if (!r.ok) badTile(x, y);
    } else if (v.battle && !v.battle.over) {
      const ok = inRing(x, y) && canDeploy(v.battle, v.unitSel);
      drawAttacker(v.unitSel, x + 0.5, y + 0.5, ok ? 0.65 : 0.25);
      if (!ok) badTile(x, y);
    }
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
  // 地面に描くので、2Dでも3D（地面の変形をかけた状態）でも同じ関数を使う
  function disc(cx: number, cy: number, r: number, color: string, alpha: number) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 7);
    ctx.fill();
    ctx.restore();
  }
  function ring(cx: number, cy: number, r: number, color: string, alpha: number) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 0.06;
    ctx.setLineDash([0.22, 0.14]);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 7);
    ctx.stroke();
    ctx.restore();
  }
  function outline(x0: number, y0: number, w: number, h: number) {
    ctx.save();
    ctx.strokeStyle = pal.gold;
    ctx.lineWidth = 0.08;
    ctx.strokeRect(x0 + 0.04, y0 + 0.04, w - 0.08, h - 0.08);
    ctx.restore();
  }
  // 櫓・投石機は射程（投石機は届かない内側も）、鼓楼は効果の範囲、守将は見つける範囲・射程・持ち場から離れられる範囲
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
      ring(gen.hx, gen.hy, d.leash, pal.gold, 0.7);
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
    if (d.range) {
      disc(cx, cy, d.range, pal.def, 0.1);
      ring(cx, cy, d.range, pal.def, 0.75);
    }
    if (d.minRange) {
      disc(cx, cy, d.minRange, pal.bad, 0.16);
      ring(cx, cy, d.minRange, pal.bad, 0.6);
    }
    if (d.aura) {
      disc(cx, cy, d.aura, pal.gold, 0.14);
      ring(cx, cy, d.aura, pal.gold, 0.8);
    }
    outline(bd.x0, bd.y0, bd.w, bd.h);
    return true;
  }

  function drawBattle(battle: Battle) {
    for (let mi = 0; mi < battle.moat.length; mi++)
      if (battle.moat[mi]) drawBuilding('moat', mi % W, (mi / W) | 0, 1, 1, 1);
    for (let mi = 0; mi < battle.abatis.length; mi++)
      if (battle.abatis[mi]) drawBuilding('bar', mi % W, (mi / W) | 0, 1, 1, 1);
    for (const b of battle.buildings) if (b.hp <= 0) drawRubble(b);
    for (const b of battle.buildings) if (b.hp > 0) drawBuilding(b.type, b.x0, b.y0, b.w, b.h, 1, b.hp / b.maxHp, b.fl);
    for (const u of battle.defenders) castRing(u);
    const t = trackMotion(battle);
    for (const d of tracker.dying) drawDying(d, d.x, d.y, t);
    const units = [...battle.defenders, ...battle.attackers].sort((a, b) => a.y - b.y);
    for (const u of units) {
      const pose = poses.get(u.id);
      if (u.side === 'd') drawGeneral(u.kind, u.x, u.y, 1, u.hp / u.maxHp, u.fl, pose);
      else drawAttacker(u.kind, u.x, u.y, 1, u.hp / u.maxHp, u.fl, pose);
    }
    drawSlashes(units, (u) => ({ x: u.x, y: u.y }));
    drawEffects(battle.effects);
  }
  // 斬撃の弧は、刀で斬る武将だけに重ねる（刀身は絵の側にある）
  function drawSlashes(units: Unit[], at: (u: Unit) => Pt) {
    ctx.save();
    ctx.lineCap = 'round';
    for (const u of units) {
      const pose = poses.get(u.id);
      if (!pose || pose.slash < 0 || !isGeneralKind(u.kind) || !swingsBlade(u.kind)) continue;
      const p = at(u);
      slashArc(p.x, p.y - pose.bob, pose);
    }
    ctx.restore();
  }
  // 倒れていく武将（兵の駒は描かない）
  function drawDying(d: Dying, x: number, y: number, t: number) {
    const pose = dyingPose(d, t);
    ctx.save();
    bushoToken(d.kind, x, y, d.side === 'd' ? pal.def : pal.atk, 0, pose);
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

  // ---- 斜め見下ろしの描画 ---------------------------------------------------
  // 地面は平行四辺形への変形で表せるので、平らなもの（盤面・堀・射程の円など）は2Dと同じ関数で描く。
  // 高さのあるもの（城壁・櫓・本丸・兵）だけ、奥から順に箱や駒として描く。
  let scale = 1;
  const groundTf = () => ctx.setTransform(scale / 2, scale / 4, -scale / 2, scale / 4, scale * ISO_OX, scale * ISO_TOP);
  const screenTf = () => ctx.setTransform(scale, 0, 0, scale, 0, 0);

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
  // 斜めから見た建物の絵を描く道具。(cx, cy) を中心に、横は k 倍、高さは kz 倍の寸法で描く。
  // 四隅の番号：0 奥・1 右・2 手前・3 左（画面上の位置）
  function isoKit(cx: number, cy: number, k: number, kz: number, flash: number, roofColor = ROOF.tile) {
    const P = (dx: number, dy: number, z: number) => proj(cx + dx * k, cy + dy * k, z * kz);
    const ring = (h: number, z: number) => [P(-h, -h, z), P(h, -h, z), P(h, h, z), P(-h, h, z)];
    const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    const flashed: Pt[][] = [];
    const fill = (pts: Pt[], color: string, shade: number) => {
      face(pts, color, shade);
      if (flash > 0) flashed.push(pts);
    };
    function beam(a: Pt, b: Pt, color: string, width: number) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    function dot(c: Pt, r: number, color: string, edge?: string) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, 7);
      ctx.fillStyle = color;
      ctx.fill();
      if (edge) {
        ctx.strokeStyle = edge;
        ctx.lineWidth = 0.02;
        ctx.stroke();
      }
    }
    // まっすぐな箱：手前の2面と上面
    function prism(h: number, z0: number, z1: number, color: string, edge?: string) {
      const a = ring(h, z0);
      const b = ring(h, z1);
      for (const i of [1, 2]) fill([a[i], a[i + 1], b[i + 1], b[i]], color, ISO_SHADE[i]);
      fill(b, color, 0);
      if (edge) {
        ctx.strokeStyle = edge;
        ctx.lineWidth = 0.018;
        ctx.stroke();
      }
    }
    // 石垣：下が広く上がすぼまる。手前の2面に石の目地を入れる
    function stoneBase(h0: number, h1: number, z1: number) {
      const a = ring(h0, 0);
      const b = ring(h1, z1);
      for (const i of [1, 2]) {
        const q = [a[i], a[i + 1], b[i + 1], b[i]];
        fill(q, pal.wall, ISO_SHADE[i]);
        ctx.strokeStyle = pal.wallDk;
        ctx.lineWidth = 0.018;
        ctx.beginPath();
        for (const t of [0.3, 0.62]) {
          const l = lerp(q[0], q[3], t);
          const r = lerp(q[1], q[2], t);
          ctx.moveTo(l.x, l.y);
          ctx.lineTo(r.x, r.y);
        }
        ctx.stroke();
      }
      fill(b, pal.wall, 0);
    }
    // 壁の層：下の3割を下見板にし、窓を並べる。鉄砲櫓は壁を黒く、窓（狭間）を白くする
    function tier(h: number, z0: number, z1: number, windows: number, wall = ART.plaster, ink = ART.board) {
      const a = ring(h, z0);
      const b = ring(h, z1);
      const m = ring(h, z0 + (z1 - z0) * 0.3);
      const lo = ring(h, z0 + (z1 - z0) * 0.48);
      const hi = ring(h, z0 + (z1 - z0) * 0.82);
      for (const i of [1, 2]) {
        fill([a[i], a[i + 1], b[i + 1], b[i]], wall, ISO_SHADE[i]);
        fill([a[i], a[i + 1], m[i + 1], m[i]], ART.board, ISO_SHADE[i] / 2);
        for (let w = 0; w < windows; w++) {
          const t0 = (w + 0.5) / windows - 0.06;
          const t1 = t0 + 0.12;
          fill(
            [
              lerp(lo[i], lo[i + 1], t0),
              lerp(lo[i], lo[i + 1], t1),
              lerp(hi[i], hi[i + 1], t1),
              lerp(hi[i], hi[i + 1], t0),
            ],
            ink,
            0,
          );
        }
      }
    }
    // 屋根の1面。軒先は中ほどを少し下げ、隅が反り上がって見えるようにする
    function roofFace(a1: Pt, a2: Pt, top: Pt[], shade: number) {
      const mid = lerp(a1, a2, 0.5);
      ctx.beginPath();
      ctx.moveTo(a1.x, a1.y);
      ctx.quadraticCurveTo(mid.x, mid.y + 0.05 * k, a2.x, a2.y);
      for (const p of top) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      ctx.fillStyle = roofColor.fill;
      ctx.fill();
      ctx.fillStyle = `rgba(0,0,0,${shade})`;
      ctx.fill();
      ctx.strokeStyle = roofColor.edge;
      ctx.lineWidth = 0.025;
      ctx.stroke();
      if (flash > 0) flashed.push([a1, a2, ...top]);
    }
    // 腰屋根：軒（eave）から上の層の付け根（top）までの4面。奥の面から描く
    function skirtRoof(eave: number, z0: number, topH: number, z1: number) {
      const a = ring(eave, z0);
      const b = ring(topH, z1);
      for (const i of [0, 3, 1, 2]) {
        const j = (i + 1) % 4;
        roofFace(a[i], a[j], [b[j], b[i]], ISO_SHADE[i] * 0.6);
      }
    }
    // 最上段の屋根：棟は左右（x方向）に通す。ridge が0なら尖った屋根。飾りは鯱か宝珠
    function topRoof(eave: number, z0: number, ridge: number, z1: number, ornament: 'shachi' | 'finial' | 'none') {
      const a = ring(eave, z0);
      const r0 = P(-ridge, 0, z1);
      const r1 = P(ridge, 0, z1);
      roofFace(a[0], a[1], [r1, r0], ISO_SHADE[0] * 0.6);
      roofFace(a[3], a[0], [r0], ISO_SHADE[3] * 0.6);
      roofFace(a[1], a[2], [r1], ISO_SHADE[1] * 0.6);
      roofFace(a[2], a[3], [r0, r1], ISO_SHADE[2] * 0.6);
      if (ornament === 'shachi') {
        ctx.fillStyle = pal.gold;
        for (const p of [r0, r1]) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - 0.13 * k);
          ctx.lineTo(p.x - 0.035 * k, p.y);
          ctx.lineTo(p.x + 0.035 * k, p.y);
          ctx.closePath();
          ctx.fill();
        }
        return r0.y - 0.13 * k;
      }
      if (ornament === 'finial') dot({ x: r0.x, y: r0.y - 0.03 }, 0.035, pal.gold);
      return r0.y - 0.05;
    }
    // 千鳥破風：手前の2面の屋根に立つ三角の妻
    function gables(off: number, half: number, z0: number, z1: number) {
      const tris = [
        [P(off, -half, z0), P(off, half, z0), P(off, 0, z1)],
        [P(-half, off, z0), P(half, off, z0), P(0, off, z1)],
      ];
      for (const [i, t] of tris.entries()) {
        fill(t, ART.plaster, ISO_SHADE[i + 1]);
        ctx.strokeStyle = ART.roofEdge;
        ctx.lineWidth = 0.05 * k;
        ctx.beginPath();
        ctx.moveTo(t[0].x, t[0].y);
        ctx.lineTo(t[2].x, t[2].y);
        ctx.lineTo(t[1].x, t[1].y);
        ctx.stroke();
      }
    }
    // 傷を受けた瞬間：描いた面を白く光らせる
    function flashAll() {
      if (!flashed.length) return;
      ctx.globalAlpha = 0.4;
      for (const pts of flashed) face(pts, '#fff', 0);
    }
    return { P, ring, beam, dot, prism, stoneBase, tier, skirtRoof, topRoof, gables, flashAll };
  }

  // 3Dの建物。戻り値は絵のいちばん上の画面座標（体力バーの位置に使う）
  function drawBox(
    type: BuildingType,
    fx0: number,
    fy0: number,
    fw: number,
    fh: number,
    alpha: number,
    hpRatio?: number,
    flash = 0,
    dir: 'x' | 'y' = 'x', // 拒馬の横木の向き
  ) {
    const cx = fx0 + fw / 2;
    const cy = fy0 + fh / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    let topY: number;
    if (type === 'hall') {
      // 本丸：石垣の上に白壁3層と瓦屋根を積んだ天守。主役なので敷地より少し大きく描く
      const k = (Math.min(fw, fh) / 2) * 1.15;
      const t = isoKit(cx, cy, k, k, flash);
      t.stoneBase(0.86, 0.76, 0.4);
      t.tier(0.68, 0.4, 0.9, 3);
      t.skirtRoof(0.8, 0.88, 0.52, 1.02);
      t.tier(0.5, 1.02, 1.42, 2);
      t.gables(0.66, 0.17, 0.95, 1.12);
      t.skirtRoof(0.62, 1.4, 0.38, 1.52);
      t.tier(0.38, 1.52, 1.88, 2);
      topY = t.topRoof(0.5, 1.86, 0.15, 2.14, 'shachi');
      t.flashAll();
    } else {
      // 1マスの建物：半マスを1、高さはマス単位で描く
      const roofColor = type === 'tbow' ? ROOF.green : type === 'tgun' ? ROOF.black : ROOF.tile;
      const t = isoKit(cx, cy, 0.5, 1, flash, roofColor);
      const { P } = t;
      if (type === 'wall') {
        // 城壁：石垣の上に白い塀と瓦の笠。マスいっぱいに描いて隣とつなげる
        t.prism(1, 0, 0.42, pal.wall, pal.wallDk);
        t.prism(1, 0.42, 0.6, ART.plaster);
        t.prism(1, 0.6, 0.7, ROOF.tile.fill, ROOF.tile.edge);
        topY = t.ring(1, 0.7)[0].y;
      } else if (type === 'tbow') {
        // 櫓（弓）：緑青の屋根の二重櫓。1層目の手前の2面に矢をつがえた弓
        t.stoneBase(0.86, 0.74, 0.3);
        t.tier(0.62, 0.3, 0.75, 0);
        const h = 0.62;
        for (const onFace of [(a: number, z: number) => P(h, a, z), (a: number, z: number) => P(-a, h, z)]) {
          // 面の上の横 a・高さ z で描く。弓幹は a の正の向きへふくらませる
          const R = 0.3;
          const Rz = 0.17;
          const a0 = 0;
          const z0 = 0.53;
          const oa = a0 - 0.55 * R;
          const pts: Pt[] = [];
          for (let i = 0; i <= 8; i++) {
            const th = -1.05 + (2.1 * i) / 8;
            pts.push(onFace(oa + R * Math.cos(th), z0 + Rz * Math.sin(th)));
          }
          t.beam(pts[0], pts[8], ART.board, 0.01);
          t.beam(onFace(a0 - 0.5 * R, z0), onFace(a0 + 0.8 * R, z0), ART.board, 0.012);
          ctx.strokeStyle = ART.bow;
          ctx.lineWidth = 0.03;
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (const q of pts.slice(1)) ctx.lineTo(q.x, q.y);
          ctx.stroke();
        }
        t.skirtRoof(0.84, 0.73, 0.48, 0.86);
        t.tier(0.48, 0.86, 1.14, 1);
        topY = t.topRoof(0.7, 1.12, 0.18, 1.42, 'none');
      } else if (type === 'tgun') {
        // 櫓（鉄砲）：黒い瓦屋根、黒い板張りに白い狭間。狭間から銃身を突き出す
        t.stoneBase(0.86, 0.74, 0.3);
        t.tier(0.66, 0.3, 0.95, 3, ART.board, ART.plaster);
        const h = 0.66;
        const zm = 0.3 + 0.65 * 0.65;
        for (let w = 0; w < 3; w++) {
          const a = -h + (2 * h * (w + 0.5)) / 3;
          t.beam(P(h, a, zm), P(h + 0.3, a, zm), ART.gun, 0.035);
          t.beam(P(-a, h, zm), P(-a, h + 0.3, zm), ART.gun, 0.035);
        }
        topY = t.topRoof(0.88, 0.93, 0.24, 1.3, 'none');
      } else if (type === 'bar') {
        // 拒馬：横木（向きは dir）に、先を尖らせた杭を X 字に2組。奥へ傾く杭から描く
        const Q = (a: number, b: number, z: number) => (dir === 'x' ? P(a, b, z) : P(b, a, z));
        const stake = (a: number, d: number) => {
          const lo = Q(a, -0.45 * d, 0);
          const hi = Q(a, 0.45 * d, 0.48);
          t.beam(lo, hi, ART.woodDk, 0.045);
          t.beam({ x: lo.x + (hi.x - lo.x) * 0.84, y: lo.y + (hi.y - lo.y) * 0.84 }, hi, ART.stakeTip, 0.035);
        };
        for (const a of [-0.5, 0.5]) stake(a, -1);
        t.beam(Q(-1, 0, 0.24), Q(1, 0, 0.24), ART.wood, 0.05);
        for (const a of [-0.5, 0.5]) stake(a, 1);
        topY = Q(0, 0, 0.48).y;
      } else if (type === 'cata') {
        // 投石機：台の上に三角の脚。腕の短い側におもり、長い側に石。奥の脚から描く
        t.prism(0.72, 0, 0.12, ART.wood, ART.woodDk);
        const leg = (y: number, color: string) => {
          t.beam(P(-0.5, y, 0.12), P(0, y, 0.78), color, 0.05);
          t.beam(P(0.5, y, 0.12), P(0, y, 0.78), color, 0.05);
        };
        leg(-0.42, ART.woodDk);
        t.beam(P(0, -0.42, 0.78), P(0, 0.42, 0.78), ART.woodDk, 0.035);
        const tip = P(-0.55, 0, 1.3);
        t.beam(P(0.5, 0, 0.45), tip, ART.wood, 0.06);
        const w = P(0.5, 0, 0.45);
        face(
          [
            { x: w.x - 0.07, y: w.y - 0.06 },
            { x: w.x + 0.07, y: w.y - 0.06 },
            { x: w.x + 0.07, y: w.y + 0.06 },
            { x: w.x - 0.07, y: w.y + 0.06 },
          ],
          ART.weight,
          0,
        );
        t.dot({ x: tip.x, y: tip.y - 0.02 }, 0.05, pal.wall, pal.wallDk);
        leg(0.42, ART.wood);
        topY = tip.y - 0.08;
      } else {
        // 鼓楼：低い石垣に4本の柱、大太鼓、尖った屋根。手前の柱は太鼓のあとに描く
        t.stoneBase(0.86, 0.78, 0.18);
        const post = (dx: number, dy: number) => t.beam(P(dx, dy, 0.18), P(dx, dy, 0.86), ART.woodDk, 0.045);
        post(-0.56, -0.56);
        post(0.56, -0.56);
        post(-0.56, 0.56);
        const c = P(0, 0, 0.5);
        t.dot(c, 0.16, ART.drum, ART.woodDk);
        t.dot(c, 0.11, ART.drumFace, ART.woodDk);
        post(0.56, 0.56);
        topY = t.topRoof(0.76, 0.84, 0, 1.12, 'finial');
      }
      t.flashAll();
    }
    ctx.restore();
    if (hpRatio !== undefined && hpRatio < 1) hpBar(proj(cx, cy).x, topY - 0.15, Math.min(0.9 * fw, 1.6), hpRatio);
  }
  // 駒の影を地面に落とし、少し浮かせて駒を描く
  function token(x: number, y: number, alpha: number, drawAt: (p: Pt) => void) {
    const p = proj(x, y);
    ctx.save();
    ctx.globalAlpha = 0.22 * alpha;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 0.32, 0.16, 0, 0, 7);
    ctx.fill();
    ctx.restore();
    drawAt({ x: p.x, y: p.y - UNIT_LIFT });
  }

  function drawIso(v: View) {
    const S = cv.width / ISO_W;
    scale = S;
    screenTf();
    ctx.clearRect(0, 0, ISO_W, ISO_H);
    groundTf();
    drawField(v);
    // 高さのあるものは奥（x+y が小さい）から順に描く
    const tall: { d: number; f: () => void }[] = [];
    // 拒馬の横木は、左右に拒馬が並んでいれば x 向き、上下なら y 向きにする
    const barDir = (isBar: (x: number, y: number) => boolean, x: number, y: number): 'x' | 'y' =>
      !isBar(x - 1, y) && !isBar(x + 1, y) && (isBar(x, y - 1) || isBar(x, y + 1)) ? 'y' : 'x';
    const pushBar = (isBar: (x: number, y: number) => boolean, x: number, y: number) => {
      const dir = barDir(isBar, x, y);
      tall.push({ d: x + y + 1, f: () => drawBox('bar', x, y, 1, 1, 1, undefined, 0, dir) });
    };
    const b = v.mode === 'edit' ? null : v.battle;
    if (!b) {
      const bars = new Set(v.layout.buildings.filter((bd) => bd.type === 'bar').map((bd) => `${bd.x},${bd.y}`));
      const isBar = (x: number, y: number) => bars.has(`${x},${y}`);
      for (const bd of v.layout.buildings) {
        const f = fpOf(bd);
        if (bd.type === 'bar') pushBar(isBar, bd.x, bd.y);
        else if (HEIGHT[bd.type])
          tall.push({ d: f.x0 + f.y0 + (f.w + f.h) / 2, f: () => drawBox(bd.type, f.x0, f.y0, f.w, f.h, 1) });
        else drawBuilding(bd.type, f.x0, f.y0, f.w, f.h, 1);
      }
      for (const g of v.layout.generals)
        tall.push({
          d: g.x + g.y + 1,
          f: () => {
            // 動かしている武将は、元の位置に薄く出す
            const a = g.kind === v.drag ? 0.3 : 1;
            token(g.x + 0.5, g.y + 0.5, a, (p) => drawGeneral(g.kind, p.x, p.y, a));
          },
        });
    } else {
      for (let mi = 0; mi < b.moat.length; mi++) if (b.moat[mi]) drawBuilding('moat', mi % W, (mi / W) | 0, 1, 1, 1);
      const isBar = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && b.abatis[y * W + x] === 1;
      for (let mi = 0; mi < b.abatis.length; mi++) if (b.abatis[mi]) pushBar(isBar, mi % W, (mi / W) | 0);
      for (const bd of b.buildings) {
        if (bd.hp <= 0) drawRubble(bd);
        else
          tall.push({
            d: bd.x0 + bd.y0 + (bd.w + bd.h) / 2,
            f: () => drawBox(bd.type, bd.x0, bd.y0, bd.w, bd.h, 1, bd.hp / bd.maxHp, bd.fl),
          });
      }
      for (const u of b.defenders) castRing(u);
      const mt = trackMotion(b);
      for (const dd of tracker.dying)
        tall.push({
          d: dd.x + dd.y,
          f: () => {
            const p = proj(dd.x, dd.y);
            drawDying(dd, p.x, p.y - UNIT_LIFT, mt);
          },
        });
      for (const u of [...b.defenders, ...b.attackers]) {
        const hp = u.hp / u.maxHp;
        const pose = poses.get(u.id);
        tall.push({
          d: u.x + u.y,
          f: () =>
            token(u.x, u.y, 1, (p) =>
              u.side === 'd'
                ? drawGeneral(u.kind, p.x, p.y, 1, hp, u.fl, pose)
                : drawAttacker(u.kind, p.x, p.y, 1, hp, u.fl, pose),
            ),
        });
      }
      drawEffects(b.effects.filter((e) => e.k === 'fire'));
    }
    const shown = drawHoverRange(v);
    const ghost = shown && v.mode === 'edit' && v.tool !== 'erase' ? null : drawGhostIso(v);
    if (ghost) tall.push(ghost);
    screenTf();
    tall.sort((a, c) => a.d - c.d);
    for (const t of tall) t.f();
    if (b) {
      drawSlashes([...b.defenders, ...b.attackers], (u) => {
        const p = proj(u.x, u.y);
        return { x: p.x, y: p.y - UNIT_LIFT };
      });
      // 矢と命中は空中に描く
      const fly: Effect[] = [];
      for (const e of b.effects) {
        if (e.k === 'arrow') {
          const p1 = proj(e.x1, e.y1, UNIT_LIFT / ISO_ZH);
          const p2 = proj(e.x2, e.y2, UNIT_LIFT / ISO_ZH);
          fly.push({ ...e, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
        } else if (e.k === 'hit') {
          const p = proj(e.x, e.y, UNIT_LIFT / ISO_ZH);
          fly.push({ ...e, x: p.x, y: p.y });
        }
      }
      drawEffects(fly);
    }
  }
  // 置こうとしているものの影。地面の部分はここで描き、高さのある部分は並べ替えに回す
  function drawGhostIso(v: View): { d: number; f: () => void } | null {
    const hv = v.hover;
    if (!hv || hv.x < 0 || hv.y < 0 || hv.x >= W || hv.y >= H) return null;
    const { x, y } = hv;
    const d = x + y + 1.01;
    if (v.mode === 'edit') {
      const tool = v.drag ?? v.tool;
      // 消しゴムと地面のもの（堀）は2Dと同じ
      if (tool === 'erase' || (isBuildingType(tool) && !HEIGHT[tool])) {
        drawGhost(v);
        return null;
      }
      const r = v.drag ? checkPut(v.layout, v.drag, x, y) : check(v.layout, tool, x, y);
      const a = r.ok ? 0.6 : 0.3;
      if (!r.ok) badTile(x, y);
      if (isBuildingType(tool)) {
        rangeRing(x, y, BDEF[tool].range || 0);
        const f = fpOf({ type: tool, x, y });
        return { d, f: () => drawBox(tool, f.x0, f.y0, f.w, f.h, a) };
      }
      aggroDisc(tool, x, y);
      rangeRing(x, y, GDEF[tool].range);
      return { d, f: () => token(x + 0.5, y + 0.5, a, (p) => drawGeneral(tool, p.x, p.y, a)) };
    }
    if (!v.battle || v.battle.over) return null;
    const ok = inRing(x, y) && canDeploy(v.battle, v.unitSel);
    if (!ok) badTile(x, y);
    const a = ok ? 0.65 : 0.25;
    return { d, f: () => token(x + 0.5, y + 0.5, a, (p) => drawAttacker(v.unitSel, p.x, p.y, a)) };
  }

  function draw(v: View) {
    if (!cv.width) return;
    if (frameNo++ % 20 === 0) pal = readPal();
    if (iso) {
      drawIso(v);
      return;
    }
    const S = cv.width / W;
    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawField(v);
    if (v.mode === 'edit' || !v.battle) {
      for (const b of v.layout.buildings) {
        const f = fpOf(b);
        drawBuilding(b.type, f.x0, f.y0, f.w, f.h, 1);
      }
      // 動かしている武将は、元の位置に薄く出す
      for (const g of v.layout.generals) drawGeneral(g.kind, g.x + 0.5, g.y + 0.5, g.kind === v.drag ? 0.3 : 1);
    } else drawBattle(v.battle);
    const shown = drawHoverRange(v);
    if (!(shown && v.mode === 'edit' && v.tool !== 'erase')) drawGhost(v);
  }
  // 画面上の位置からマスを求める。盤面の外なら null
  function tileAt(clientX: number, clientY: number): Tile | null {
    const r = cv.getBoundingClientRect();
    const u = (clientX - r.left) / r.width;
    const w = (clientY - r.top) / r.height;
    let x: number;
    let y: number;
    if (iso) {
      // proj の逆変換（高さは0として地面のマスを選ぶ）
      const px = u * ISO_W - ISO_OX;
      const py = w * ISO_H - ISO_TOP;
      x = Math.floor(px + 2 * py);
      y = Math.floor(2 * py - px);
    } else {
      x = Math.floor(u * W);
      y = Math.floor(w * H);
    }
    return x >= 0 && y >= 0 && x < W && y < H ? { x, y } : null;
  }
  function setIso(on: boolean) {
    iso = on;
    resize();
  }

  resize();
  return { draw, tileAt, setIso };
}
