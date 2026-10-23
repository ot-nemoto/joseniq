import {
  ADEF,
  type AttackerKind,
  BDEF,
  type BuildingType,
  GENERAL_ORDER,
  type GeneralKind,
  isGeneralKind,
  LIMITS,
  UNIT_ORDER,
} from '../sim';
import { $ } from './dom';

// ---- 攻撃側の比較 -------------------------------------------------------
const TRAIT: Record<AttackerKind, string> = {
  inf: '近接。守将・櫓・本丸のうち、最も近いものを狙う。安く数で押す。',
  arc: '守将を優先して遠くから撃つ。建物にはほぼ効かない。打たれ弱い。',
  cav: '守将を優先して追いかける。足が速い。建物には弱い。',
  ram: '本丸だけを狙い、本丸に最も強い。守将や兵は攻撃できない。',
  eng: '櫓・投石機・鼓楼を優先して狙い、城壁や施設を一気に壊す。本丸と兵には弱い。',
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
type Shape = 'circle' | 'square' | 'triangle' | 'diamond' | 'cross' | 'tridown' | 'hex' | 'star' | 'bar' | 'ring';
const SHAPES: Record<AttackerKind, Shape> = {
  inf: 'circle',
  arc: 'square',
  cav: 'triangle',
  ram: 'diamond',
  eng: 'tridown',
  shd: 'hex',
  scout: 'ring',
  brave: 'cross',
  archer: 'star',
  sage: 'bar',
  spear: 'tridown',
  rider: 'triangle',
  gunner: 'square',
  builder: 'diamond',
  ninja: 'ring',
  guard: 'hex',
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
  per: boolean;
  dec: number;
}
const METRICS: readonly Metric[] = [
  { id: 'hp', label: '体力', unit: '', per: true, dec: 0 },
  { id: 'dpsU', label: '対将火力', unit: '/秒', per: true, dec: 1 },
  { id: 'dpsF', label: '対施設火力', unit: '/秒', per: true, dec: 1 },
  { id: 'dpsH', label: '対本丸火力', unit: '/秒', per: true, dec: 1 },
  { id: 'range', label: '射程', unit: 'マス', per: false, dec: 1 },
  { id: 'speed', label: '移動速度', unit: 'マス/秒', per: false, dec: 1 },
];
let cmpMode: 'abs' | 'per' = 'abs';
let cmpSide: 'atk' | 'def' | 'gen' = 'atk';
const picked = new Set<AttackerKind>(UNIT_ORDER);
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
// 武将は兵力を使わないので、コスト当たりの比較はしない
const perCost = (m: Metric) => cmpMode === 'per' && cmpSide !== 'gen' && m.per;
const mval = (k: AttackerKind, m: Metric) => statsOf(k)[m.id] / (perCost(m) ? ADEF[k].cost : 1);
const fmtV = (v: number, m: Metric) => v.toFixed(perCost(m) ? Math.max(1, m.dec) : m.dec);
const shown = () => pool().filter((k) => picked.has(k));
const maxOf = (m: Metric) => Math.max(...pool().map((k) => mval(k, m)));
const chip = (k: AttackerKind, cls: string) =>
  `<span class="${cls}" style="background:var(--u-${k})">${ADEF[k].glyph}</span>`;

function marker(shape: Shape, x: number, y: number, k: AttackerKind) {
  const f = `fill="var(--u-${k})" stroke="var(--surface)" stroke-width="1.5"`;
  if (shape === 'circle') return `<circle cx="${x}" cy="${y}" r="4.6" ${f}/>`;
  if (shape === 'square') return `<rect x="${x - 4}" y="${y - 4}" width="8" height="8" ${f}/>`;
  if (shape === 'triangle') return `<polygon points="${x},${y - 5.5} ${x + 5},${y + 4} ${x - 5},${y + 4}" ${f}/>`;
  if (shape === 'diamond')
    return `<polygon points="${x},${y - 5.5} ${x + 5.5},${y} ${x},${y + 5.5} ${x - 5.5},${y}" ${f}/>`;
  if (shape === 'tridown') return `<polygon points="${x},${y + 5.5} ${x + 5},${y - 4} ${x - 5},${y - 4}" ${f}/>`;
  if (shape === 'hex')
    return `<polygon points="${x - 5},${y} ${x - 2.5},${y - 4.4} ${x + 2.5},${y - 4.4} ${x + 5},${y} ${x + 2.5},${y + 4.4} ${x - 2.5},${y + 4.4}" ${f}/>`;
  if (shape === 'star')
    return `<polygon points="${x},${y - 6} ${x + 1.8},${y - 1.8} ${x + 6},${y} ${x + 1.8},${y + 1.8} ${x},${y + 6} ${x - 1.8},${y + 1.8} ${x - 6},${y} ${x - 1.8},${y - 1.8}" ${f}/>`;
  if (shape === 'bar') return `<rect x="${x - 5.5}" y="${y - 2.5}" width="11" height="5" ${f}/>`;
  if (shape === 'ring')
    return `<circle cx="${x}" cy="${y}" r="4" fill="var(--surface)" stroke="var(--u-${k})" stroke-width="2.5"/>`;
  return `<path d="M${x - 4.5},${y - 1.6}h3v-3h3v3h3v3h-3v3h-3v-3h-3z" ${f}/>`;
}

function radarHtml() {
  const cx = 180;
  const cy = 168;
  const R = 108;
  const n = METRICS.length;
  const pt = (i: number, r: number): [number, number] => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [+(cx + Math.cos(a) * r).toFixed(1), +(cy + Math.sin(a) * r).toFixed(1)];
  };
  let g = '';
  for (let lv = 1; lv <= 4; lv++)
    g += `<polygon class="rgrid" points="${METRICS.map((_, i) => pt(i, (R * lv) / 4).join(',')).join(' ')}"/>`;
  METRICS.forEach((m, i) => {
    const [x, y] = pt(i, R);
    g += `<line class="rgrid" x1="${cx}" y1="${cy}" x2="${x}" y2="${y}"/>`;
    const [lx, ly] = pt(i, R + 20);
    const anc = Math.abs(lx - cx) < 8 ? 'middle' : lx < cx ? 'end' : 'start';
    g += `<text class="rlab" x="${lx}" y="${ly + 4}" text-anchor="${anc}">${m.label}</text>`;
    g += `<text class="rmax" x="${lx}" y="${ly + 17}" text-anchor="${anc}">最大 ${fmtV(maxOf(m), m)}${m.unit}${perCost(m) ? '/コスト' : ''}</text>`;
  });
  const maxes = METRICS.map(maxOf);
  const ks = shown();
  const ptOf = (k: AttackerKind, m: Metric, i: number) => pt(i, R * Math.max(0.025, mval(k, m) / maxes[i]));
  for (const k of ks) {
    const pts = METRICS.map((m, i) => ptOf(k, m, i));
    g += `<polygon points="${pts.map((p) => p.join(',')).join(' ')}" fill="var(--u-${k})" fill-opacity="0.13" stroke="var(--u-${k})" stroke-width="2" stroke-linejoin="round"/>`;
  }
  for (const k of ks) {
    METRICS.forEach((m, i) => {
      const p = ptOf(k, m, i);
      g += marker(SHAPES[k], p[0], p[1], k);
    });
  }
  return `<svg viewBox="-40 0 440 336" role="img" aria-label="${cmpSide === 'gen' ? '武将' : '攻城兵'}のレーダーチャート">${g}</svg>`;
}

function barsHtml() {
  return METRICS.map((m) => {
    const mx = maxOf(m);
    const rows = shown()
      .map((k) => ({ k, v: mval(k, m) }))
      .sort((a, b) => b.v - a.v);
    const body = rows
      .map((r) => {
        const none = m.id === 'dpsU' && r.v === 0;
        return (
          `<div class="brow">${chip(r.k, 'bchip')}<span class="bname">${nameOf(r.k)}</span>` +
          `<span class="btrack"><i style="width:${none ? 0 : (r.v / mx) * 100}%;background:var(--u-${r.k})"></i></span>` +
          `<span class="bval">${none ? '攻撃不可' : `${fmtV(r.v, m)}<small>${m.unit}</small>`}</span></div>`
        );
      })
      .join('');
    return `<div class="bblock"><h3>${m.label}${perCost(m) ? '<em>コスト当たり</em>' : ''}</h3>${body}</div>`;
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
  const ks = shown();
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
    h += `<tr><td><span class="tname">${chip(k, 'bchip')}${nameOf(k)}</span></td>${cells}<td class="trait">${TRAIT[k]}</td>${isGeneralKind(k) ? `<td class="trait">${GEN_DEF_TRAIT[k]}</td>` : ''}</tr>`;
  }
  return `${h}</tbody>`;
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
const DEF_GLYPH: Record<DefId, string> = {
  wall: '壁',
  moat: '堀',
  bar: '拒',
  cata: '投',
  drum: '鼓',
  tbow: '櫓',
  tgun: '砲',
  hall: '本',
};
const DEF_ORDER: readonly DefId[] = ['wall', 'moat', 'bar', 'tbow', 'tgun', 'cata', 'drum', 'hall'];
interface DefRow {
  id: DefId;
  name: string;
  g: string;
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
    g: DEF_GLYPH[id],
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
  const chipD = (r: DefRow) => `<span class="bchip" style="background:var(--def);color:var(--defInk)">${r.g}</span>`;
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
            `<div class="brow">${chipD(r)}<span class="bname" style="width:auto;white-space:nowrap">${r.name}</span>` +
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
        `<tr><td><span class="tname">${chipD(r)}${r.name}</span></td><td>${r.kind}</td><td>${r.limit}</td>` +
        `<td>${dash(r.hp, 0)}</td><td>${dash(r.dmg, 0)}</td><td>${dash(r.cd, 1)}</td><td>${dash(r.dps, 1)}</td>` +
        `<td>${dash(r.range, 1)}</td><td class="trait">${DEF_TRAIT[r.id]}</td></tr>`,
    )
    .join('');
  return { bars, table: `${head}<tbody>${body}</tbody>` };
}

export function renderCompare() {
  const def = cmpSide === 'def';
  const gen = cmpSide === 'gen';
  $('atkCmp').hidden = def;
  $('defCmp').hidden = !def;
  $('cmpMode').hidden = cmpSide !== 'atk';
  $('cmpTitle').textContent = gen ? '武将の比較' : def ? '防衛側の比較' : '攻城兵の比較';
  $('cmpDesc').textContent = gen
    ? '武将は兵力を使わず、攻撃側・防衛側とも3人まで出せます。能力は攻めでも守りでも同じです。選ぶと重ねて比べられます。'
    : def
      ? '配置できる建物と地形の数値と上限です（武将は「武将」で比べられます）。数値は戦闘計算でそのまま使っています。'
      : '数値は戦闘計算でそのまま使っている値です。兵種を選ぶと重ねて比べられます（武将は「武将」で比べられます）。';
  for (const b of $('cmpSide').querySelectorAll<HTMLButtonElement>('button'))
    b.setAttribute('aria-pressed', String(b.dataset.s === cmpSide));
  if (def) {
    const h = defCompareHtml();
    $('defBars').innerHTML = h.bars;
    $('defTable').innerHTML = h.table;
    return;
  }
  $('unitChips').innerHTML = pool()
    .map(
      (k) =>
        `<button type="button" class="chip" data-k="${k}" aria-pressed="${picked.has(k)}">${chip(k, 'sw')}${nameOf(k)}` +
        `<span class="cc">${gen ? ADEF[k].name : `コスト${ADEF[k].cost}`}</span></button>`,
    )
    .join('');
  $('radar').innerHTML = radarHtml();
  $('bars').innerHTML = barsHtml();
  $('bars').classList.toggle('gen', gen);
  $('unitTable').classList.toggle('gen', gen);
  $('unitTable').innerHTML = tableHtml();
  $('radarNote').textContent =
    cmpMode === 'per' && !gen
      ? 'コスト当たりに直した比較です。体力と火力は1コストあたり、射程と速度はそのままの値です。'
      : `各軸は、全${gen ? '武将' : '兵種'}のうち最大の値を外周としています。`;
  for (const b of $('cmpMode').querySelectorAll<HTMLButtonElement>('button'))
    b.setAttribute('aria-pressed', String(b.dataset.m === cmpMode));
}

export function initCompare() {
  $('unitChips').addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('.chip');
    if (!b) return;
    const k = b.dataset.k as AttackerKind;
    if (picked.has(k)) {
      // 区分の中で、最低1つは選んだままにする
      if (pool().filter((x) => picked.has(x)).length > 1) picked.delete(k);
    } else picked.add(k);
    renderCompare();
  });
  for (const b of $('cmpSide').querySelectorAll<HTMLButtonElement>('button'))
    b.addEventListener('click', () => {
      cmpSide = b.dataset.s === 'def' ? 'def' : b.dataset.s === 'gen' ? 'gen' : 'atk';
      renderCompare();
    });
  for (const b of $('cmpMode').querySelectorAll<HTMLButtonElement>('button'))
    b.addEventListener('click', () => {
      cmpMode = b.dataset.m === 'per' ? 'per' : 'abs';
      renderCompare();
    });
}
