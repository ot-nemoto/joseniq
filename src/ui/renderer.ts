import {
  ADEF,
  type AttackerKind,
  type Battle,
  BDEF,
  type BuildingType,
  canDeploy,
  check,
  type Effect,
  fpOf,
  GDEF,
  type GeneralKind,
  H,
  inRing,
  isBuildingType,
  type Layout,
  RING,
  type Tool,
  W,
  ZONE,
} from '../sim';

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

export function createRenderer(cv: HTMLCanvasElement) {
  const c2d = cv.getContext('2d');
  if (!c2d) throw new Error('canvas 2d が使えません');
  const ctx = c2d;
  let pal = readPal();
  let frameNo = 0;

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
    cv.style.height = `${(w * H) / W}px`;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(((w * H) / W) * dpr);
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
    } else if (type === 'bar') {
      ctx.strokeStyle = pal.wallDk;
      ctx.lineWidth = 0.09;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x0 + 0.2, y0 + 0.2);
      ctx.lineTo(x0 + 0.8, y0 + 0.8);
      ctx.moveTo(x0 + 0.8, y0 + 0.2);
      ctx.lineTo(x0 + 0.2, y0 + 0.8);
      ctx.moveTo(x0 + 0.5, y0 + 0.12);
      ctx.lineTo(x0 + 0.5, y0 + 0.88);
      ctx.stroke();
    } else if (type === 'trap') {
      // 罠：縄の輪と「罠」の字
      ctx.strokeStyle = pal.def;
      ctx.globalAlpha = alpha * 0.7;
      ctx.lineWidth = 0.06;
      ctx.setLineDash([0.12, 0.08]);
      ctx.beginPath();
      ctx.arc(x0 + 0.5, y0 + 0.5, 0.38, 0, 7);
      ctx.stroke();
      ctx.setLineDash([]);
      text('罠', x0 + 0.5, y0 + 0.5, 0.42, pal.def);
    } else if (type === 'tbow' || type === 'tgun' || type === 'cata' || type === 'drum') {
      ctx.fillStyle = pal.def;
      rr(x0 + 0.06, y0 + 0.06, 0.88, 0.88, 0.12);
      ctx.fill();
      ctx.strokeStyle = pal.gold;
      ctx.lineWidth = 0.06;
      rr(x0 + 0.14, y0 + 0.14, 0.72, 0.72, 0.08);
      ctx.stroke();
      const glyph = { tbow: '櫓', tgun: '砲', cata: '投', drum: '鼓' }[type];
      text(glyph, x0 + 0.5, y0 + 0.5, 0.56, pal.defInk);
    } else if (type === 'hall') {
      ctx.fillStyle = pal.def;
      rr(x0 + 0.06, y0 + 0.06, w - 0.12, h - 0.12, 0.18);
      ctx.fill();
      ctx.strokeStyle = pal.gold;
      ctx.lineWidth = 0.09;
      rr(x0 + 0.25, y0 + 0.25, w - 0.5, h - 0.5, 0.1);
      ctx.stroke();
      const gs = w >= 4 ? 1.15 : w >= 3 ? 0.8 : 0.66;
      const go = w >= 4 ? 0.62 : w >= 3 ? 0.42 : 0.36;
      text('本', x0 + w / 2 - go, y0 + h / 2, gs, pal.defInk);
      text('丸', x0 + w / 2 + go, y0 + h / 2, gs, pal.defInk);
    }
    if (flash > 0) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#fff';
      ctx.fillRect(x0, y0, w, h);
    }
    ctx.restore();
    if (hpRatio !== undefined && hpRatio < 1) hpBar(x0 + w / 2, y0 - 0.02, Math.min(0.9 * w, 1.6), hpRatio);
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
  function drawGeneral(kind: GeneralKind, x: number, y: number, alpha: number, hpRatio?: number, flash = 0) {
    const d = GDEF[kind];
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pal.def;
    rr(x - 0.4, y - 0.4, 0.8, 0.8, 0.16);
    ctx.fill();
    ctx.strokeStyle = pal.ink;
    ctx.globalAlpha = alpha * 0.55;
    ctx.lineWidth = 0.05;
    ctx.stroke();
    ctx.globalAlpha = alpha;
    text(d.glyph, x, y, 0.56, pal.defInk);
    if (flash > 0) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#fff';
      rr(x - 0.4, y - 0.4, 0.8, 0.8, 0.16);
      ctx.fill();
    }
    ctx.restore();
    if (hpRatio !== undefined && hpRatio < 1) hpBar(x, y - 0.58, 0.8, hpRatio);
  }
  function drawAttacker(kind: AttackerKind, x: number, y: number, alpha: number, hpRatio?: number, flash = 0) {
    const d = ADEF[kind];
    const r = kind === 'ram' ? 0.44 : d.general ? 0.42 : kind === 'shd' ? 0.4 : kind === 'scout' ? 0.3 : 0.36;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pal.atk;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 7);
    ctx.fill();
    ctx.strokeStyle = pal.ink;
    ctx.globalAlpha = alpha * 0.55;
    ctx.lineWidth = 0.05;
    ctx.stroke();
    if (d.general) {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = pal.gold;
      ctx.lineWidth = 0.07;
      ctx.beginPath();
      ctx.arc(x, y, r + 0.07, 0, 7);
      ctx.stroke();
    }
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
      } else if (e.k === 'bind') {
        // 捕縛した瞬間：縄の輪が締まる
        ctx.strokeStyle = pal.gold;
        ctx.lineWidth = 0.1;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 1.1 - 0.5 * p, 0, 7);
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
      const tool = v.tool;
      if (tool === 'erase') {
        badTile(x, y);
        return;
      }
      const r = check(v.layout, tool, x, y);
      const a = r.ok ? 0.6 : 0.3;
      let range: number;
      if (isBuildingType(tool)) {
        const f = fpOf({ type: tool, x, y });
        drawBuilding(tool, f.x0, f.y0, f.w, f.h, a);
        range = BDEF[tool].range || 0;
      } else {
        drawGeneral(tool, x + 0.5, y + 0.5, a);
        range = GDEF[tool].range;
        // 守将が敵を見つける範囲（センサー）を薄く塗る
        ctx.save();
        ctx.fillStyle = pal.def;
        ctx.globalAlpha = 0.08;
        ctx.beginPath();
        ctx.arc(x + 0.5, y + 0.5, GDEF[tool].aggro, 0, 7);
        ctx.fill();
        ctx.restore();
      }
      if (range > 1.5) {
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
      if (!r.ok) badTile(x, y);
    } else if (v.battle && !v.battle.over) {
      const ok = inRing(x, y) && canDeploy(v.battle, v.unitSel);
      drawAttacker(v.unitSel, x + 0.5, y + 0.5, ok ? 0.65 : 0.25);
      if (!ok) badTile(x, y);
    }
  }

  function drawBattle(battle: Battle) {
    for (let mi = 0; mi < battle.moat.length; mi++)
      if (battle.moat[mi]) drawBuilding('moat', mi % W, (mi / W) | 0, 1, 1, 1);
    for (let mi = 0; mi < battle.abatis.length; mi++)
      if (battle.abatis[mi]) drawBuilding('bar', mi % W, (mi / W) | 0, 1, 1, 1);
    for (let mi = 0; mi < battle.trap.length; mi++)
      if (battle.trap[mi]) drawBuilding('trap', mi % W, (mi / W) | 0, 1, 1, 1);
    for (const b of battle.buildings) if (b.hp <= 0) drawRubble(b);
    for (const b of battle.buildings) if (b.hp > 0) drawBuilding(b.type, b.x0, b.y0, b.w, b.h, 1, b.hp / b.maxHp, b.fl);
    for (const u of battle.defenders) {
      if (u.cast) {
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
    }
    const units = [...battle.defenders, ...battle.attackers].sort((a, b) => a.y - b.y);
    for (const u of units) {
      if (u.side === 'd') drawGeneral(u.kind, u.x, u.y, 1, u.hp / u.maxHp, u.fl);
      else drawAttacker(u.kind, u.x, u.y, 1, u.hp / u.maxHp, u.fl);
      if (u.bound > 0) {
        // 捕縛中：金の縄の輪
        ctx.save();
        ctx.strokeStyle = pal.gold;
        ctx.lineWidth = 0.09;
        ctx.setLineDash([0.14, 0.08]);
        ctx.beginPath();
        ctx.arc(u.x, u.y, 0.56, 0, 7);
        ctx.stroke();
        ctx.restore();
      }
    }
    drawEffects(battle.effects);
  }

  function draw(v: View) {
    if (!cv.width) return;
    if (frameNo++ % 20 === 0) pal = readPal();
    const S = cv.width / W;
    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawField(v);
    if (v.mode === 'edit' || !v.battle) {
      for (const b of v.layout.buildings) {
        const f = fpOf(b);
        drawBuilding(b.type, f.x0, f.y0, f.w, f.h, 1);
      }
      for (const g of v.layout.generals) drawGeneral(g.kind, g.x + 0.5, g.y + 0.5, 1);
    } else drawBattle(v.battle);
    drawGhost(v);
  }

  resize();
  return { draw };
}
