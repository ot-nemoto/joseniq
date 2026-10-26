import {
  ADEF,
  type AttackerKind,
  BDEF,
  type BuildingType,
  GENERAL_ORDER,
  type GeneralKind,
  isBuildingType,
  isGeneralKind,
  LIMITS,
  UNIT_ORDER,
} from '../sim';
import { $ } from './dom';
import { blitUnit, type Frame } from './pixel';

// ---- 攻撃側の比較 -------------------------------------------------------
const TRAIT: Record<AttackerKind, string> = {
  inf: '近接。守将・櫓・本丸のうち、最も近いものを狙う。安く数で押す。',
  arc: '守将を優先して遠くから撃つ。建物にはほぼ効かない。打たれ弱い。',
  cav: '守将を優先して追いかける。足が速い。建物には弱い。',
  ram: '本丸だけを狙い、本丸に最も強い。守将や兵は攻撃できない。',
  eng: '櫓・大筒・鼓楼を優先して狙い、城壁や施設を一気に壊す。本丸と兵には弱い。',
  shd: '体力が最も高い。周り1.5マスにいる将以外の味方が受けるダメージを、代わりに受ける。攻撃はほぼしない。',
  scout: '足だけ速い囮。守将や櫓に近づき、追われたり撃たれたりしたら下がる。攻撃しない。城壁は壊せない。',
  brave: '近くにいる他の守将にも、6割の追加ダメージを与える。',
  archer: '射程が長く、櫓の届かない位置から撃てる。',
  sage: '櫓を優先して狙い、範囲攻撃「火計」で守将と建物にまとめて当てる。',
  spear: '間合い1.6の近接。騎馬の武将への攻撃が2倍。',
  rider: '守将を優先して狙う。3マス以上駆けてからの一撃が2.5倍。拒馬は通れない。',
  gunner: '射程9。一撃は大きいが、撃つ間隔が長い。',
  builder: '施設を優先して狙い、施設に強い。周り4マスの工兵が施設を崩す力が1.5倍になる。',
  ninja: '2.5マスより近づかないと櫓や守将に狙われない。当てた相手の攻撃を3秒止める。攻撃は気づかれない。',
  guard: '周り3.5マスの味方が受けるダメージを3割減らす。',
};
// 武将が守りについたときの動き（能力は攻めと同じ）
const GEN_DEF_TRAIT: Record<GeneralKind, string> = {
  brave: '近接で迎え撃つ。近くの敵にも6割の追加ダメージ。',
  archer: '射程7で射る。',
  sage: '範囲攻撃「火計」。半径2マスにまとめて当てる。',
  spear: '間合い1.6の近接。騎兵・騎馬の武将への攻撃が2倍。',
  rider: '足が速く、3マス以上駆けてからの一撃が2.5倍。',
  gunner: '射程9。一撃は大きいが、撃つ間隔が長い。',
  builder: '周り4マスの建物（本丸も）を1秒に25ずつ直す。',
  ninja: '2.5マスより近づかないと狙われない。当てた相手の攻撃を3秒止める。',
  guard: '周り3.5マスの味方（建物も）が受けるダメージを3割減らす。',
};
interface UnitStats {
  cost: number;
  hp: number;
  dmg: number;
  cd: number;
  fac: number;
  hall: number;
  range: number;
  speed: number;
  dpsU: number;
  dpsF: number;
  dpsH: number;
}
interface Metric {
  id: 'hp' | 'dpsU' | 'dpsF' | 'dpsH' | 'range' | 'speed';
  label: string;
  unit: string;
  dec: number;
}
const METRICS: readonly Metric[] = [
  { id: 'hp', label: '体力', unit: '', dec: 0 },
  { id: 'dpsU', label: '対将火力', unit: '/秒', dec: 1 },
  { id: 'dpsF', label: '対施設火力', unit: '/秒', dec: 1 },
  { id: 'dpsH', label: '対本丸火力', unit: '/秒', dec: 1 },
  { id: 'range', label: '射程', unit: 'マス', dec: 1 },
  { id: 'speed', label: '移動速度', unit: 'マス/秒', dec: 1 },
];
let cmpSide: 'atk' | 'def' | 'gen' = 'atk';
let drawIcon: ((cv: HTMLCanvasElement, type: BuildingType) => void) | null = null;
const ICON_PX = 40; // 防御施設の表の絵の大きさ（CSSピクセル）
// 攻撃側の区分は兵だけ、武将の区分は武将だけを比べる。最大値もその中で取る
const SOLDIER_ORDER = UNIT_ORDER.filter((k) => !ADEF[k].general);
const pool = (): readonly AttackerKind[] => (cmpSide === 'gen' ? GENERAL_ORDER : SOLDIER_ORDER);
const nameOf = (k: AttackerKind) => ADEF[k].busho ?? ADEF[k].name;

function statsOf(k: AttackerKind): UnitStats {
  const d = ADEF[k];
  const dmg = d.aoe ?? d.dmg; // 軍師は火計の威力
  return {
    cost: d.cost,
    hp: d.hp,
    dmg,
    cd: d.cd,
    fac: d.fac,
    hall: d.hall,
    range: d.range,
    speed: d.speed,
    dpsU: d.noUnits ? 0 : dmg / d.cd,
    dpsF: (dmg * d.fac) / d.cd,
    dpsH: (dmg * d.hall) / d.cd,
  };
}
const mval = (k: AttackerKind, m: Metric) => statsOf(k)[m.id];
const fmtV = (v: number, m: Metric) => v.toFixed(m.dec);
const maxOf = (m: Metric) => Math.max(...pool().map((k) => mval(k, m)));

function barsHtml() {
  // 棒の色：攻城兵は攻めの色、武将は攻めにも守りにも出るので金（防御施設は守りの色）
  const color = cmpSide === 'gen' ? 'var(--gold)' : 'var(--atk)';
  return METRICS.map((m) => {
    const mx = maxOf(m);
    const rows = pool()
      .map((k) => ({ k, v: mval(k, m) }))
      .sort((a, b) => b.v - a.v);
    const body = rows
      .map((r) => {
        const none = m.id === 'dpsU' && r.v === 0;
        return (
          `<div class="brow"><span class="bname">${nameOf(r.k)}</span>` +
          `<span class="btrack"><i style="width:${none ? 0 : (r.v / mx) * 100}%;background:${color}"></i></span>` +
          `<span class="bval">${none ? '攻撃不可' : `${fmtV(r.v, m)}<small>${m.unit}</small>`}</span></div>`
        );
      })
      .join('');
    return `<div class="bblock"><h3>${m.label}</h3>${body}</div>`;
  }).join('');
}

function tableHtml() {
  const cols: {
    h: string;
    f: (k: AttackerKind) => number;
    best: 'min' | 'max';
    d: number;
    x?: string;
  }[] = [
    { h: 'コスト', f: (k) => statsOf(k).cost, best: 'min', d: 0 },
    { h: '体力', f: (k) => statsOf(k).hp, best: 'max', d: 0 },
    { h: '1撃', f: (k) => statsOf(k).dmg, best: 'max', d: 0 },
    { h: '間隔(秒)', f: (k) => statsOf(k).cd, best: 'min', d: 1 },
    { h: '対施設倍率', f: (k) => statsOf(k).fac, best: 'max', d: 1, x: '×' },
    { h: '対本丸倍率', f: (k) => statsOf(k).hall, best: 'max', d: 1, x: '×' },
    { h: '対将火力/秒', f: (k) => statsOf(k).dpsU, best: 'max', d: 1 },
    { h: '対施設火力/秒', f: (k) => statsOf(k).dpsF, best: 'max', d: 1 },
    { h: '対本丸火力/秒', f: (k) => statsOf(k).dpsH, best: 'max', d: 1 },
    { h: '射程', f: (k) => statsOf(k).range, best: 'max', d: 1 },
    { h: '速度', f: (k) => statsOf(k).speed, best: 'max', d: 1 },
  ];
  // 武将は兵力を使わないのでコストの列を除き、特徴は攻めと守りに分けて出す
  const gen = cmpSide === 'gen';
  if (gen) cols.shift();
  const ks = pool();
  const bestOf = cols.map((c) => {
    const v = ks.map(c.f);
    return c.best === 'max' ? Math.max(...v) : Math.min(...v);
  });
  const traitHead = gen ? '<th class="trait">攻めのとき</th><th class="trait">守りのとき</th>' : '<th>特徴</th>';
  let h = `<thead><tr><th>${gen ? '武将' : '兵種'}</th>${cols.map((c) => `<th>${c.h}</th>`).join('')}${traitHead}</tr></thead><tbody>`;
  for (const k of ks) {
    const cells = cols
      .map((c, i) => {
        const v = c.f(k);
        return `<td${ks.length > 1 && v === bestOf[i] ? ' class="best"' : ''}>${c.x || ''}${v.toFixed(c.d)}</td>`;
      })
      .join('');
    // 名前の左に、ドット絵の姿を動かして出す（字の印は出さない）
    h += `<tr><td><span class="tname">${motionCanvas(k)}${nameOf(k)}</span></td>${cells}<td class="trait">${TRAIT[k]}</td>${isGeneralKind(k) ? `<td class="trait">${GEN_DEF_TRAIT[k]}</td>` : ''}</tr>`;
  }
  return `${h}</tbody>`;
}

// ---- 武将の動き ---------------------------------------------------------
// ドット絵の武将をその場で、歩く・攻撃・倒れるの順に通して動かす。コマの並びと、それぞれの長さ（秒）
const WALK_SEQ: [Frame, number][] = [
  ['walk0', 0.14],
  ['walk1', 0.14],
  ['walk2', 0.14],
  ['walk3', 0.14],
];
const ATK_SEQ: [Frame, number][] = [
  ['walk0', 0.5],
  ['atk0', 0.12],
  ['atk1', 0.16],
  ['atk2', 0.22],
];
const DOWN_SEQ: [Frame, number][] = [
  ['walk0', 0.6],
  ['down0', 0.3],
  ['down1', 1.1],
];
const MOTION_SEQ: [Frame, number][] = [...WALK_SEQ, ...WALK_SEQ, ...WALK_SEQ, ...ATK_SEQ, ...ATK_SEQ, ...DOWN_SEQ];
const MOTION_DOTS = 30; // 動きの欄の1枚の大きさ（ドット）
let motionRaf = 0;
let motionKey = '';
let motionColor = ''; // 鎧の色（攻めの色）。明暗の設定が変わったときだけ読み直す

function frameAt(seq: [Frame, number][], t: number): Frame {
  const total = seq.reduce((n, [, d]) => n + d, 0);
  let r = t % total;
  for (const [f, d] of seq) {
    if (r < d) return f;
    r -= d;
  }
  return seq[0][0];
}
function drawMotions(now: number) {
  // 区分やタブを離れたら止める（戻ったときに renderCompare から再開する）
  if (cmpSide === 'def' || !$('unitTable').offsetParent) {
    motionRaf = 0;
    return;
  }
  const frame = frameAt(MOTION_SEQ, now / 1000);
  const side = motionColor;
  const key = `${frame}|${side}`;
  if (key !== motionKey) {
    motionKey = key;
    for (const cv of $('unitTable').querySelectorAll<HTMLCanvasElement>('canvas.tmotion')) {
      const ctx = cv.getContext('2d');
      if (!ctx) continue;
      const dot = cv.width / MOTION_DOTS;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      blitUnit(ctx, cv.dataset.k as AttackerKind, frame, side, 13 * dot, 29 * dot, dot, 1);
    }
  }
  motionRaf = requestAnimationFrame(drawMotions);
}
function readMotionColor() {
  motionColor = getComputedStyle(document.documentElement).getPropertyValue('--atk').trim();
  motionKey = ''; // 次のコマで描き直す
}
// 表の武将名・兵種名の左に置く、動きを描く小さな画面
function motionCanvas(k: AttackerKind) {
  const dpr = Math.min(Math.round(window.devicePixelRatio || 1), 2);
  const size = 2 * MOTION_DOTS * dpr;
  return `<canvas class="tmotion" data-k="${k}" width="${size}" height="${size}" role="img" aria-label="${nameOf(k)}の動き"></canvas>`;
}
// 動きを（止まっていれば）始める。表を描いたあとに呼ぶ
function renderMotions() {
  readMotionColor();
  if (!motionRaf) motionRaf = requestAnimationFrame(drawMotions);
}

// ---- 防衛側の比較 -------------------------------------------------------
type DefId = BuildingType;
const DEF_TRAIT: Record<DefId, string> = {
  wall: '通行を阻む。攻撃側は壊して進む。',
  moat: '城域の外周3マス以内にだけ置ける。守将は渡れず、攻撃側は半分の速さで渡れる。壊せない。',
  bar: '騎兵は通れない。他の兵は通れるが遅くなる。壊せない。',
  cata: '射程が長く、着弾点の周囲にまとめてダメージ。近くの敵は撃てない。',
  drum: '周囲6.5マスの守将と櫓の攻撃間隔が短くなる（×1.3の速さ）。',
  tbow: '連射できる弓の櫓。',
  tgun: '射程が長く一撃が重いが、撃つ間隔が長い。',
  hall: '中央に固定。落とされたら負け。',
};
const DEF_ORDER: readonly DefId[] = ['wall', 'moat', 'bar', 'tbow', 'tgun', 'cata', 'drum', 'hall'];
interface DefRow {
  id: DefId;
  name: string;
  kind: string;
  limit: string;
  hp: number;
  dmg: number;
  cd: number;
  dps: number;
  range: number;
}
function defStats(id: DefId): DefRow {
  const d: {
    name: string;
    hp: number;
    dmg?: number;
    aoe?: number;
    cd?: number;
    range?: number;
    terrain?: boolean;
  } = BDEF[id];
  const dmg = d.aoe || d.dmg || 0;
  return {
    id,
    name: d.name,
    kind: d.terrain ? '地形' : '建物',
    limit: id === 'hall' ? '固定' : String(LIMITS[id]),
    hp: d.hp || 0,
    dmg,
    cd: d.cd || 0,
    dps: d.cd ? dmg / d.cd : 0,
    range: d.range || 0,
  };
}
function defCompareHtml() {
  const rows = DEF_ORDER.map(defStats);
  // 表の名前の左には、防衛配置のボタンと同じ施設の絵を出す（描くのは表を入れたあと）
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = Math.round(ICON_PX * dpr);
  const icon = (r: DefRow) =>
    `<canvas class="ticon" data-b="${r.id}" width="${size}" height="${size}" aria-hidden="true"></canvas>`;
  const dash = (v: number, dec: number) => (v ? v.toFixed(dec) : '—');
  const metrics: { label: string; key: 'hp' | 'dps' | 'range'; unit: string; dec: number }[] = [
    { label: '体力', key: 'hp', unit: '', dec: 0 },
    { label: '秒間火力', key: 'dps', unit: '/秒', dec: 1 },
    { label: '射程', key: 'range', unit: 'マス', dec: 1 },
  ];
  const bars = metrics
    .map((m) => {
      const list = rows.filter((r) => r.id !== 'hall' && r[m.key] > 0).sort((a, b) => b[m.key] - a[m.key]);
      const mx = Math.max(...list.map((r) => r[m.key]));
      const body = list
        .map(
          (r) =>
            `<div class="brow"><span class="bname" style="width:auto;white-space:nowrap">${r.name}</span>` +
            `<span class="btrack"><i style="width:${(r[m.key] / mx) * 100}%;background:var(--def)"></i></span>` +
            `<span class="bval">${r[m.key].toFixed(m.dec)}<small>${m.unit}</small></span></div>`,
        )
        .join('');
      return `<div class="bblock"><h3>${m.label}</h3>${body}</div>`;
    })
    .join('');
  const head =
    '<thead><tr><th>配置物</th><th>分類</th><th>上限</th><th>体力</th><th>1撃</th><th>間隔(秒)</th><th>秒間火力</th><th>射程</th><th>特徴</th></tr></thead>';
  const body = rows
    .map(
      (r) =>
        `<tr><td><span class="tname">${icon(r)}${r.name}</span></td><td>${r.kind}</td><td>${r.limit}</td>` +
        `<td>${dash(r.hp, 0)}</td><td>${dash(r.dmg, 0)}</td><td>${dash(r.cd, 1)}</td><td>${dash(r.dps, 1)}</td>` +
        `<td>${dash(r.range, 1)}</td><td class="trait">${DEF_TRAIT[r.id]}</td></tr>`,
    )
    .join('');
  return { bars, table: `${head}<tbody>${body}</tbody>` };
}
// 表の施設の絵を描く（配色が変わったときも描き直す）
function drawDefIcons() {
  if (!drawIcon) return;
  for (const cv of $('defTable').querySelectorAll<HTMLCanvasElement>('canvas.ticon')) {
    const t = cv.dataset.b ?? '';
    if (isBuildingType(t)) drawIcon(cv, t);
  }
}

export function renderCompare() {
  const def = cmpSide === 'def';
  const gen = cmpSide === 'gen';
  $('atkCmp').hidden = def;
  $('defCmp').hidden = !def;
  $('cmpTitle').textContent = gen ? '武将の比較' : def ? '防御施設の比較' : '攻城兵の比較';
  $('cmpDesc').textContent = gen
    ? '武将は兵力を使わず、攻撃側・防衛側とも3人まで出せます。能力は攻めでも守りでも同じです。'
    : def
      ? '配置できる建物と地形の数値と上限です（武将は「武将」で比べられます）。数値は戦闘計算でそのまま使っています。'
      : '数値は戦闘計算でそのまま使っている値です（武将は「武将」で比べられます）。';
  for (const b of $('cmpSide').querySelectorAll<HTMLButtonElement>('button'))
    b.setAttribute('aria-pressed', String(b.dataset.s === cmpSide));
  if (def) {
    const h = defCompareHtml();
    $('defBars').innerHTML = h.bars;
    $('defTable').innerHTML = h.table;
    drawDefIcons();
    return;
  }
  // 攻城兵も武将も、項目ごとのランキング（開閉でき、最初は閉じている）と一覧の表だけを出す
  $('bars').innerHTML = barsHtml();
  $('bars').classList.toggle('gen', gen);
  $('unitTable').classList.toggle('gen', gen);
  $('unitTable').innerHTML = tableHtml();
  renderMotions();
}

// draw：施設の絵を描く関数（盤面と同じ絵。renderer の drawIcon）
export function initCompare(draw: (cv: HTMLCanvasElement, type: BuildingType) => void) {
  drawIcon = draw;
  for (const b of $('cmpSide').querySelectorAll<HTMLButtonElement>('button'))
    b.addEventListener('click', () => {
      cmpSide = b.dataset.s === 'def' ? 'def' : b.dataset.s === 'gen' ? 'gen' : 'atk';
      renderCompare();
    });
  // 明暗の設定が変わると、軍の色も変わる
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    readMotionColor();
    drawDefIcons();
  });
}
