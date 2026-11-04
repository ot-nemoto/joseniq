import {
  ADEF,
  type AttackerKind,
  BDEF,
  type BuildingType,
  GATES_PER_RING,
  GENERAL_ORDER,
  type GeneralKind,
  HALL_MARGIN,
  isAttackerKind,
  isBuildingType,
  isGeneralKind,
  isSampleFacility,
  LIMITS,
  type SampleOf,
  UNIT_ORDER,
} from '../sim';
import { $ } from './dom';
import { blitUnit, type Frame } from './pixel';

// ---- 攻撃側の比較 -------------------------------------------------------
const TRAIT: Record<AttackerKind, string> = {
  inf: `近接。本丸への道を進み、道から${ADEF.inf.reach}マスまでの施設に寄って壊す。安く数で押す。`,
  arc: `本丸への道を進み、道から${ADEF.arc.reach}マスまでの守将（いなければ櫓）を遠くから撃つ。建物にはほぼ効かない。打たれ弱い。`,
  cav: `本丸への道を進み、道から${ADEF.cav.reach}マスまでの守将（いなければ櫓）を追う。足が速い。建物には弱い。`,
  ram: `本丸への道をふさぐ門と、道から${ADEF.ram.reach}マスまでの門を破る。門に最も強いが、本丸には弱い。守将や兵は攻撃できない。`,
  eng: `本丸への道を進み、道から${ADEF.eng.reach}マスまでの櫓・大筒・鼓楼・鐘楼に寄って一気に壊す。城壁は壊せない。門・本丸・兵には弱い。`,
  shd: `体力が最も高い。本丸への道を進み、周り1.5マスにいる将以外の味方が受けるダメージを、代わりに受ける。道から${ADEF.shd.reach}マスまでの守将や櫓に寄るが、攻撃はほぼしない。`,
  scout: `足だけ速い囮。本丸への道を進み、道から${ADEF.scout.reach}マスまでの守将や櫓に近づき、追われたり撃たれたりしたら下がる。攻撃しない。城壁は壊せない。`,
  brave: '近くにいる他の守将にも、6割の追加ダメージを与える。',
  archer: '射程が長く、櫓の届かない位置から撃てる。',
  sage: '櫓を優先して狙い、範囲攻撃「火計」で守将と建物にまとめて当てる。',
  rider: '守将を優先して狙う。軍配で近くを打つ。',
  gunner: '射程9。一撃は大きいが、撃つ間隔が長い。',
  builder: '施設を優先して狙い、施設に強い。周り4マスの工兵が施設を崩す力が1.5倍になる。',
  guard: '周り3.5マスの味方が受けるダメージを3割減らす。',
};
// 武将が守りについたときの動き（能力は攻めと同じ）
const GEN_DEF_TRAIT: Record<GeneralKind, string> = {
  brave: '近接で迎え撃つ。近くの敵にも6割の追加ダメージ。',
  archer: '射程7で射る。',
  sage: '範囲攻撃「火計」。半径2マスにまとめて当てる。',
  rider: '軍配で近くを打つ。',
  gunner: '射程9。一撃は大きいが、撃つ間隔が長い。',
  builder: '周り4マスの建物（本丸も）を1秒に25ずつ直す。',
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
// 動作の見本を開くボタン。data-see に「atk:兵種」か「fac:施設」を入れる（武将は攻めで開き、見本の側で守りに切り替える）
const seeBtn = (see: string, name: string) =>
  `<button type="button" class="btn mini see" data-see="${see}" title="${name}の動作の見本を盤面で見る">動作</button>`;
const ICON_PX = 40; // 防御施設の表の絵の大きさ（CSSピクセル）
// 攻撃側の区分は兵だけ、武将の区分は武将だけを比べる。最大値もその中で取る
const SOLDIER_ORDER = UNIT_ORDER.filter((k) => !ADEF[k].general);
const pool = (): readonly AttackerKind[] => (cmpSide === 'gen' ? GENERAL_ORDER : SOLDIER_ORDER);
const nameOf = (k: AttackerKind) => ADEF[k].busho ?? ADEF[k].name;

function statsOf(k: AttackerKind): UnitStats {
  const d = ADEF[k];
  const dmg = d.aoe ?? d.dmg; // 真田昌幸は火計の威力
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
    h += `<tr><td><span class="tname">${motionCanvas(k)}${nameOf(k)}${seeBtn(`atk:${k}`, nameOf(k))}</span></td>${cells}<td class="trait">${TRAIT[k]}</td>${isGeneralKind(k) ? `<td class="trait">${GEN_DEF_TRAIT[k]}</td>` : ''}</tr>`;
  }
  return `${h}</tbody>`;
}

// ---- 攻城兵と武将の動き -------------------------------------------------
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
// 動きを減らす設定のときは、立ち姿のまま止める（防衛配置のパネルと同じ）
const still = window.matchMedia('(prefers-reduced-motion: reduce)');

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
  const frame = still.matches ? 'walk0' : frameAt(MOTION_SEQ, now / 1000);
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
      const k = cv.dataset.k ?? '';
      if (isAttackerKind(k)) blitUnit(ctx, k, frame, side, 13 * dot, 29 * dot, dot, 1);
    }
  }
  // 止めるときは描いたところで終える（設定が変わったら renderMotions から再開する）
  motionRaf = still.matches ? 0 : requestAnimationFrame(drawMotions);
}
function readMotionColor() {
  motionColor = getComputedStyle(document.documentElement).getPropertyValue('--atk').trim();
  motionKey = ''; // 次のコマで描き直す
}
// 表の武将名・兵種名の左に置く、動きを描く小さな画面
function motionCanvas(k: AttackerKind) {
  const dpr = Math.min(Math.round(window.devicePixelRatio || 1), 2);
  const size = 2 * MOTION_DOTS * dpr;
  return `<canvas class="tmotion" data-k="${k}" width="${size}" height="${size}" role="img" aria-label="${nameOf(k)}の姿"></canvas>`;
}
// 動きを（止まっていれば）始める。表を描いたあとに呼ぶ
function renderMotions() {
  readMotionColor();
  if (!motionRaf) motionRaf = requestAnimationFrame(drawMotions);
}

// ---- 防衛側の比較 -------------------------------------------------------
type DefId = BuildingType;
const DEF_TRAIT: Record<DefId, string> = {
  wall: '通行を阻む。壊せないので、攻撃側は門を通って進む。',
  gate: `守将は通れる。攻撃側は壊さないと通れない（衝車が強い）。郭を囲む塀の線にだけ置け、郭ごとに、その郭の塀に${GATES_PER_RING}つ以上置く（郭どうしの間の塀の門は、両方の郭の門として数える）。`,
  cata: '射程が長く、着弾点の周囲にまとめてダメージ。近くの敵は撃てない。',
  drum: '周囲6.5マスの守将と櫓の攻撃間隔が短くなる（×1.3の速さ）。',
  bell: `早鐘：周囲${BDEF.bell.aura}マスに攻め手が入ると鐘が鳴り、離れた守将も駆けつける（持ち場から追える遠さは、攻撃の知らせを受けたときと同じ）。`,
  tbow: '連射できる弓の櫓。',
  tgun: '射程が長く一撃が重いが、撃つ間隔が長い。',
  hall: `落とされたら負け。必須（1つ）で、置く・消す・動かすことができる（盤面の端から${HALL_MARGIN}マス以上内側、段をまたがない所）。`,
};
const DEF_ORDER: readonly DefId[] = ['wall', 'gate', 'tbow', 'tgun', 'cata', 'drum', 'bell', 'hall'];
interface DefRow {
  id: DefId;
  name: string;
  cost: number; // 郭の点数を使う数（施設だけ。城壁・門・本丸は 0）
  must: boolean; // 置かないと攻城を始められない
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
    unbreakable?: boolean;
    cost?: number;
  } = BDEF[id];
  const dmg = d.aoe || d.dmg || 0;
  return {
    id,
    name: d.name,
    cost: d.cost ?? 0,
    must: id === 'hall' || id === 'gate',
    // 壊せない城壁は、体力を比べない（表では「—」）
    hp: d.unbreakable ? 0 : d.hp || 0,
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
    `<canvas class="ticon" data-b="${r.id}" width="${size}" height="${size}" style="width:${ICON_PX}px;height:${ICON_PX}px" aria-hidden="true"></canvas>`;
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
    '<thead><tr><th>配置物</th><th>点数</th><th class="must">必須</th><th>体力</th><th>1撃</th><th>間隔(秒)</th><th>秒間火力</th><th>射程</th><th>特徴</th></tr></thead>';
  const body = rows
    .map(
      (r) =>
        `<tr><td><span class="tname">${icon(r)}${r.name}${isSampleFacility(r.id) ? seeBtn(`fac:${r.id}`, r.name) : ''}</span></td><td>${r.cost || '—'}</td><td class="must">${r.must ? '○' : ''}</td>` +
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
      ? `配置できる建物と地形の数値です（武将は「武将」で比べられます）。数値は戦闘計算でそのまま使っています。本丸は${LIMITS.hall}つです。城壁・門・櫓・大筒・鼓楼・鐘楼は数の上限がなく、櫓・大筒・鼓楼・鐘楼は郭の点数の内で置けます。`
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
  // 攻城兵も武将も、項目ごとの番付（開閉でき、最初は閉じている）と一覧の表だけを出す
  $('bars').innerHTML = barsHtml();
  $('bars').classList.toggle('gen', gen);
  $('unitTable').classList.toggle('gen', gen);
  $('unitTable').innerHTML = tableHtml();
  renderMotions();
}

// draw：施設の絵を描く関数（盤面と同じ絵。renderer の drawIcon）
// see：動作の見本を開く関数
export function initCompare(draw: (cv: HTMLCanvasElement, type: BuildingType) => void, see: (of: SampleOf) => void) {
  drawIcon = draw;
  $('unitsView').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-see]');
    const [k, id] = (b?.dataset.see ?? '').split(':');
    if (k === 'atk' && isAttackerKind(id)) see({ k: 'atk', kind: id });
    else if (k === 'fac' && isBuildingType(id)) see({ k: 'fac', type: id });
  });
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
  still.addEventListener('change', () => {
    motionKey = '';
    if (cmpSide !== 'def') renderMotions();
  });
}
