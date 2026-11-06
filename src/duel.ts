// 1対1の戦いの確かめのページ（duel.html）。開発する人が、どの時刻にどれだけ傷が入り、いつ勝負がつくかを目で見る。
// ゲームの画面からはリンクしない。戦いの計算（step）・能力値・絵はゲームと同じものを読むので、
// src/sim/defs.ts の値を直すと、このページの結果も変わる（読み直しても、選んだ組み合わせは URL に残る）
import './style.css';
import {
  ADEF,
  type AttackerKind,
  BDEF,
  type BuildingType,
  createDuel,
  DT,
  DUEL_DIST_MAX,
  DUEL_DIST_MIN,
  DUEL_FACILITIES,
  DUEL_LIMIT,
  type Duel,
  type DuelPoint,
  type DuelRight,
  type DuelSetup,
  type DuelSide,
  duelTotals,
  GDEF,
  GENERAL_ORDER,
  isAttackerKind,
  isGeneralKind,
  runDuel,
  stepDuel,
  swapDuel,
  UNIT_ORDER,
} from './sim';
import { $ } from './ui/dom';
import { createRenderer } from './ui/renderer';

const SPEEDS = [0.25, 0.5, 1, 2, 4];
const CHART_EVERY = 100; // 図と一覧を書き直す間隔（ミリ秒）
const PAD = { l: 38, r: 74, t: 10, b: 24 }; // 図の余白（右は線の名前を置く分）
const RIGHT_NAME = (r: DuelRight) => (r.k === 'gen' ? GDEF[r.kind].busho : BDEF[r.type].name);
const leftName = (k: AttackerKind) => ADEF[k].busho ?? ADEF[k].name;
const rightKey = (r: DuelRight) => (r.k === 'gen' ? `gen:${r.kind}` : `fac:${r.type}`);
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const secs = (t: number) => `${t.toFixed(2)}秒`;

function parseRight(s: string): DuelRight | null {
  const [k, v] = s.split(':');
  if (k === 'gen' && isGeneralKind(v)) return { k, kind: v };
  if (k === 'fac' && DUEL_FACILITIES.includes(v as BuildingType)) return { k, type: v as BuildingType };
  return null;
}
// URL の #left|right|距離 から、組み合わせを読む（値を直すとページが読み直されるので、同じ戦いをすぐ見られるように）
function readHash(): DuelSetup {
  const [l, r, d] = decodeURIComponent(location.hash.slice(1)).split('|');
  const dist = Number(d);
  return {
    left: isAttackerKind(l) ? l : 'brave',
    right: parseRight(r ?? '') ?? { k: 'gen', kind: 'archer' },
    dist: dist >= DUEL_DIST_MIN && dist <= DUEL_DIST_MAX ? dist : 20,
  };
}

const leftSel = $<HTMLSelectElement>('left');
const rightSel = $<HTMLSelectElement>('right');
const distIn = $<HTMLInputElement>('dist');
const swapBtn = $<HTMLButtonElement>('swap');
const playBtn = $<HTMLButtonElement>('play');
const chart = $('chart') as unknown as SVGSVGElement;
const tip = $('tip');

function group(sel: HTMLSelectElement, label: string, items: [string, string][]) {
  const g = document.createElement('optgroup');
  g.label = label;
  for (const [value, text] of items) g.append(new Option(text, value));
  sel.append(g);
}
group(
  leftSel,
  '兵',
  UNIT_ORDER.filter((k) => !ADEF[k].general).map((k) => [k, leftName(k)]),
);
group(
  leftSel,
  '武将',
  GENERAL_ORDER.map((k) => [k, leftName(k)]),
);
group(
  rightSel,
  '武将',
  GENERAL_ORDER.map((k) => [`gen:${k}`, GDEF[k].busho]),
);
group(
  rightSel,
  '施設',
  DUEL_FACILITIES.map((t) => [`fac:${t}`, BDEF[t].name]),
);
distIn.min = String(DUEL_DIST_MIN);
distIn.max = String(DUEL_DIST_MAX);

const renderer = createRenderer($<HTMLCanvasElement>('duelCv'));
let setup = readHash();
let duel: Duel = createDuel(setup);
let playing = false;
let speed = 1;
let acc = 0;
let last = 0;
let paintAt = 0;
let shownHits = -1;
let hoverT: number | null = null;

for (const s of SPEEDS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = `${s}×`;
  b.dataset.s = String(s);
  b.addEventListener('click', () => {
    speed = s;
    paintControls();
  });
  $('speeds').append(b);
}

// 組み合わせを変えたら、最初の状態に戻して止める
function restart(next: DuelSetup) {
  setup = next;
  history.replaceState(null, '', `#${setup.left}|${rightKey(setup.right)}|${setup.dist}`);
  duel = createDuel(setup);
  playing = false;
  acc = 0;
  shownHits = -1;
  hoverT = null;
  tip.hidden = true;
  // 2人が収まるように、距離に合わせて寄せる
  const x = duel.left.x + setup.dist / 2;
  renderer.look(x, duel.left.y, Math.min(5, Math.max(1.8, 54 / (setup.dist + 6))));
  paintControls();
  paintData();
}
function paintControls() {
  leftSel.value = setup.left;
  rightSel.value = rightKey(setup.right);
  distIn.value = String(setup.dist);
  swapBtn.disabled = !swapDuel(setup);
  playBtn.textContent = playing ? '一時停止' : duel.battle.t > 0 ? '再開' : '開始';
  playBtn.disabled = !!duel.end;
  $<HTMLButtonElement>('tick').disabled = !!duel.end;
  $<HTMLButtonElement>('finish').disabled = !!duel.end;
  for (const b of $('speeds').querySelectorAll('button'))
    b.setAttribute('aria-pressed', String(Number(b.dataset.s) === speed));
}

const nameOf = (side: DuelSide) => (side === 'left' ? leftName(setup.left) : RIGHT_NAME(setup.right));
const sideLabel = (side: DuelSide) => `${side === 'left' ? '攻め' : '守り'}・${nameOf(side)}`;
const hpOf = (side: DuelSide) => (side === 'left' ? duel.left : duel.right);
const key = (side: DuelSide) => `<span class="key ${side}"></span>`;

function paintResult() {
  const e = duel.end;
  const p = duel.points[duel.points.length - 1];
  $('clock').textContent = `${secs(Math.min(p.t, DUEL_LIMIT))} ・ 距離 ${p.dist.toFixed(1)}マス`;
  $('result').textContent = !e
    ? '決着はまだです'
    : e.winner
      ? `${secs(e.t)}で${sideLabel(e.winner)}の勝ち（残り体力 ${fmt(hpOf(e.winner).hp)} / ${hpOf(e.winner).maxHp}）`
      : e.t >= DUEL_LIMIT - DT
        ? `時間切れ（${DUEL_LIMIT}秒）で決着がつきませんでした`
        : `${secs(e.t)}で相打ち`;
  const rows = (['left', 'right'] as const).map((s) => {
    const t = duelTotals(duel, s);
    const u = hpOf(s);
    return `<tr><td>${key(s)}${sideLabel(s)}</td><td>${fmt(Math.max(0, u.hp))} / ${u.maxHp}</td><td>${t.first === null ? '—' : secs(t.first)}</td><td>${t.count}</td><td>${fmt(t.total)}</td><td>${t.perSec.toFixed(1)}</td></tr>`;
  });
  $('totals').innerHTML =
    `<thead><tr><th></th><th>体力</th><th>最初に当てた</th><th>回数</th><th>傷の合計</th><th>傷/秒</th></tr></thead><tbody>${rows.join('')}</tbody>`;
}

function paintHits() {
  if (duel.hits.length === shownHits) return;
  shownHits = duel.hits.length;
  const box = $('hits');
  const end = box.scrollTop + box.clientHeight >= box.scrollHeight - 4;
  if (!duel.hits.length) {
    box.textContent = 'まだ傷は入っていません';
    return;
  }
  const rows = duel.hits.map((h) => {
    const to: DuelSide = h.by === 'left' ? 'right' : 'left';
    return `<tr><td>${secs(h.t)}</td><td style="text-align:left">${key(h.by)}${nameOf(h.by)}</td><td>${fmt(h.dmg)}</td><td>${fmt(Math.max(0, h.hp))} / ${hpOf(to).maxHp}</td></tr>`;
  });
  box.innerHTML = `<table><thead><tr><th>時刻</th><th style="text-align:left">当てた</th><th>傷</th><th>相手の残り</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  if (end) box.scrollTop = box.scrollHeight;
}

// 図の横の長さ（秒）：今の時刻を含む、切りのよい長さ
const spanOf = () => Math.min(DUEL_LIMIT, Math.max(30, Math.ceil(duel.points[duel.points.length - 1].t / 30) * 30));
function chartBox() {
  const r = chart.getBoundingClientRect();
  return { w: r.width, h: r.height, pw: r.width - PAD.l - PAD.r, ph: r.height - PAD.t - PAD.b };
}
function paintChart() {
  const { w, h, pw, ph } = chartBox();
  if (pw <= 0) return;
  chart.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const span = spanOf();
  const px = (t: number) => PAD.l + (t / span) * pw;
  const py = (rate: number) => PAD.t + (1 - rate) * ph;
  let g = '';
  for (const r of [0, 0.25, 0.5, 0.75, 1]) {
    g += `<line class="grid" x1="${PAD.l}" x2="${PAD.l + pw}" y1="${py(r)}" y2="${py(r)}"/>`;
    g += `<text x="${PAD.l - 6}" y="${py(r) + 4}" text-anchor="end">${r * 100}%</text>`;
  }
  const step = span <= 30 ? 5 : span <= 60 ? 10 : 30;
  for (let t = 0; t <= span; t += step) g += `<text x="${px(t)}" y="${h - 6}" text-anchor="middle">${t}秒</text>`;
  const p = duel.points;
  const end = p[p.length - 1];
  for (const side of ['left', 'right'] as const) {
    const max = hpOf(side).maxHp;
    // 値が変わる所だけを、階段の形でつなぐ
    let d = `M${px(0)} ${py(p[0][side] / max)}`;
    for (let i = 1; i < p.length; i++)
      if (p[i][side] !== p[i - 1][side])
        d += `L${px(p[i].t)} ${py(p[i - 1][side] / max)}L${px(p[i].t)} ${py(Math.max(0, p[i][side]) / max)}`;
    const rate = Math.max(0, end[side]) / max;
    d += `L${px(end.t)} ${py(rate)}`;
    g += `<path class="line ${side}" d="${d}"/>`;
  }
  // 線の名前は右の端に置く。2本が近いときは重ならないよう離す
  let ly = py(Math.max(0, end.left) / hpOf('left').maxHp);
  let ry = py(Math.max(0, end.right) / hpOf('right').maxHp);
  if (Math.abs(ly - ry) < 15) {
    const mid = (ly + ry) / 2;
    ly = mid - 8;
    ry = mid + 8;
  }
  g += `<text class="name" x="${PAD.l + pw + 6}" y="${ly + 4}">攻め</text>`;
  g += `<text class="name" x="${PAD.l + pw + 6}" y="${ry + 4}">守り</text>`;
  if (hoverT !== null)
    g += `<line class="cross" x1="${px(hoverT)}" x2="${px(hoverT)}" y1="${PAD.t}" y2="${PAD.t + ph}"/>`;
  chart.innerHTML = g;
}
// 時刻 t の記録（記録はティックごとに並ぶ）
function pointAt(t: number): DuelPoint {
  const p = duel.points;
  return p[Math.min(p.length - 1, Math.max(0, Math.round(t / DT)))];
}
function paintTip() {
  if (hoverT === null) {
    tip.hidden = true;
    return;
  }
  const { pw } = chartBox();
  const q = pointAt(hoverT);
  tip.innerHTML = `${secs(q.t)} ・ 距離 ${q.dist.toFixed(1)}<br>${key('left')}${nameOf('left')} ${fmt(Math.max(0, q.left))}<br>${key('right')}${nameOf('right')} ${fmt(Math.max(0, q.right))}`;
  tip.hidden = false;
  // 線を隠さないよう、十字の線の左右の空いている側に出す
  const x = PAD.l + (hoverT / spanOf()) * pw;
  const right = x < pw / 2 + PAD.l;
  tip.style.left = right ? `${x + 10}px` : '';
  tip.style.right = right ? '' : `${chart.getBoundingClientRect().width - x + 10}px`;
}
chart.addEventListener('pointermove', (e) => {
  const { pw } = chartBox();
  const end = duel.points[duel.points.length - 1].t;
  const rate = (e.clientX - chart.getBoundingClientRect().left - PAD.l) / pw;
  hoverT = Math.min(end, Math.max(0, rate * spanOf()));
  paintChart();
  paintTip();
});
chart.addEventListener('pointerleave', () => {
  hoverT = null;
  paintChart();
  paintTip();
});

function paintData() {
  paintResult();
  paintHits();
  paintChart();
  paintTip();
  const legend = (['left', 'right'] as const).map((s) => `<span>${key(s)}${sideLabel(s)}</span>`);
  $('legend').innerHTML = legend.join('');
}

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const ended = !!duel.end;
  // 決着のあとも少しだけ進めて、倒れる動きを見せる
  if (playing || duel.end) {
    acc += dt * speed;
    while (acc >= DT) {
      stepDuel(duel);
      acc -= DT;
    }
  }
  if (duel.end && !ended) {
    playing = false;
    paintControls();
    paintData();
  }
  if (playing && now - paintAt > CHART_EVERY) {
    paintAt = now;
    paintData();
  }
  renderer.draw({
    mode: 'sample',
    layout: duel.layout,
    battle: duel.battle,
    hover: null,
    tool: null,
    unitSel: null,
    drag: null,
    cursor: null,
    siege: null,
    deployOk: false,
    castle: null,
    layoutRev: 0,
  });
  requestAnimationFrame(frame);
}

leftSel.addEventListener('change', () => {
  if (isAttackerKind(leftSel.value)) restart({ ...setup, left: leftSel.value });
});
rightSel.addEventListener('change', () => {
  const r = parseRight(rightSel.value);
  if (r) restart({ ...setup, right: r });
});
distIn.addEventListener('change', () => {
  const v = Math.round(Number(distIn.value));
  restart({ ...setup, dist: Math.min(DUEL_DIST_MAX, Math.max(DUEL_DIST_MIN, v || DUEL_DIST_MIN)) });
});
swapBtn.addEventListener('click', () => {
  const s = swapDuel(setup);
  if (s) restart(s);
});
playBtn.addEventListener('click', () => {
  playing = !playing;
  paintControls();
  paintData();
});
$('tick').addEventListener('click', () => {
  playing = false;
  stepDuel(duel);
  paintControls();
  paintData();
});
$('finish').addEventListener('click', () => {
  runDuel(duel);
  playing = false;
  paintControls();
  paintData();
});
$('reset').addEventListener('click', () => restart(setup));
window.addEventListener('resize', paintChart);

restart(setup);
last = performance.now();
requestAnimationFrame(frame);

// 確かめのスクリプトが読むため。公開の版では取り除かれる
if (import.meta.env.DEV) (window as unknown as { duelPage: unknown }).duelPage = { duel: () => duel };
