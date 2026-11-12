import {
  ADEF,
  ALERT_EXTRA,
  type AttackerKind,
  BDEF,
  BURN_TICK,
  type BuildingType,
  ESCAPE_ROUTES,
  GDEF,
  GENERAL_ORDER,
  type GeneralKind,
  gateMul,
  HALL_MARGIN,
  isAttackerKind,
  isBuildingType,
  isGeneralKind,
  isSampleFacility,
  type SampleOf,
  SHIELD_RADIUS,
  TROOP_ORDER,
  WARD_RADIUS,
} from '../sim';
import { BIG_STAND, type BigAction, type BigPick, drawBigBody } from './bigBusho';
import { $ } from './dom';

// ---- 攻撃側の比較 -------------------------------------------------------
// 武将のスキルの説明（簡潔に。数値は能力値から作る）
const tenths = (v: number | undefined) => `${Math.round((v ?? 0) * 10)}割`;
const SKILL: Record<GeneralKind, string> = {
  brave: `周り${ADEF.brave.spinRadius}マスの敵と建物に${ADEF.brave.spin}のダメージ`,
  archer: `射程${ADEF.archer.skillRange}の貫通する矢で、通り道の敵と建物に${ADEF.archer.skillDmg}のダメージ`,
  gunner: `射程${ADEF.gunner.skillRange}から1人に${ADEF.gunner.skillVolley}発、1発${ADEF.gunner.skillDmg}のダメージ`,
  sage: `射程${ADEF.sage.skillRange}の所の周り${ADEF.sage.skillRadius}マスの敵と建物に${ADEF.sage.skillDmg}のダメージ、${ADEF.sage.burnTime}秒燃やす（${BURN_TICK}秒に${ADEF.sage.burn}）`,
  rider: `そばに騎兵を1体呼ぶ（${ADEF.rider.summonMax}体まで）`,
  builder: `周り${ADEF.builder.disarmRadius}マスの敵の与えるダメージを${ADEF.builder.disarmTime}秒${tenths(ADEF.builder.disarm)}減らす`,
  guard: `周り${WARD_RADIUS}マスの味方（守りでは建物も）の受けるダメージを${ADEF.guard.wardTime}秒${tenths(ADEF.guard.ward)}減らす`,
};
const TRAIT: Record<Exclude<AttackerKind, GeneralKind>, string> = {
  inf: `近接。本丸への道を進み、道から${ADEF.inf.reach}マスまでの施設に寄って壊す。安く数で押す。`,
  arc: `本丸への道を進み、道から${ADEF.arc.reach}マスまでの武将（いなければ施設）を遠くから撃つ。建物にはほぼ効かない。打たれ弱い。`,
  cav: `本丸への道を進み、道から${ADEF.cav.reach}マスまでの武将（いなければ施設）を追う。足が速い。建物には弱い。`,
  ram: `本丸への道をふさぐ門と、道から${ADEF.ram.reach}マスまでの門を破る。門に最も強いが、本丸には弱い。武将や兵は攻撃できない。`,
  eng: `本丸への道を進み、道から${ADEF.eng.reach}マスまでの櫓・大筒・鼓楼・鐘楼に寄って一気に壊す。城壁は壊せない。門・本丸・兵には弱い。`,
  shd: `体力が最も高い。本丸への道を進み、周り${SHIELD_RADIUS}マスにいる将以外の味方が受けるダメージを、代わりに受ける。道から${ADEF.shd.reach}マスまでの武将（いなければ施設）に寄るが、攻撃はほぼしない。`,
};
interface UnitStats {
  cost: number;
  hp: number;
  dmg: number;
  cd: number;
  vsU: number;
  fac: number;
  gate: number;
  hall: number;
  range: number;
  speed: number;
  dpsU: number;
  dpsF: number;
  dpsG: number;
  dpsH: number;
  skillCd: number; // スキルの間隔（秒）。スキルを持たないものは 0
  aggro: number; // 守りのときに敵を見つける範囲（武将だけ。兵は 0）
  reach: number; // 寄り道の距離（本丸への道から、この距離の内の相手に寄る）
}
// 番付の1項目。R は行の値の型（攻城兵と武将は UnitStats、防御施設は DefRow）
interface Metric<R> {
  label: string;
  f: (r: R) => number;
  unit: string;
  dec: number;
  dps?: boolean; // 火力。傷を与えないもの（0）は「攻撃不可」と出す
  perCost?: boolean; // コストあたりの番付にも出す
}
const METRICS: readonly Metric<UnitStats>[] = [
  { label: '体力', f: (s) => s.hp, unit: '', dec: 0, perCost: true },
  { label: '対武将火力', f: (s) => s.dpsU, unit: '/秒', dec: 1, dps: true, perCost: true },
  { label: '対施設火力', f: (s) => s.dpsF, unit: '/秒', dec: 1, dps: true, perCost: true },
  { label: '対門火力', f: (s) => s.dpsG, unit: '/秒', dec: 1, dps: true, perCost: true },
  { label: '対本丸火力', f: (s) => s.dpsH, unit: '/秒', dec: 1, dps: true, perCost: true },
  { label: '射程', f: (s) => s.range, unit: 'マス', dec: 1 },
  { label: '移動速度', f: (s) => s.speed, unit: 'マス/秒', dec: 1 },
];
// perCost の付いた項目を、コストで割った番付の項目にする（コストが 0 なら 0）
function perCostMetrics<R>(metrics: readonly Metric<R>[], cost: (r: R) => number): Metric<R>[] {
  return metrics
    .filter((m) => m.perCost)
    .map((m) => ({
      ...m,
      label: `コストあたりの${m.label}`,
      f: (r: R) => (cost(r) ? m.f(r) / cost(r) : 0),
      dec: m.dec + 1,
    }));
}
let cmpSide: 'atk' | 'def' | 'gen' = 'atk';
let drawIcon: ((cv: HTMLCanvasElement, type: BuildingType) => void) | null = null;
// 動作の見本を開くボタン。data-see に「atk:兵種」か「fac:施設」を入れる（武将は攻めで開き、見本の側で守りに切り替える）
const seeBtn = (see: string, name: string) =>
  `<button type="button" class="btn mini see" data-see="${see}" title="${name}の動作の見本を盤面で見る">動作</button>`;
const ICON_PX = 40; // 防御施設の表の絵の大きさ（CSSピクセル）
// 攻撃側の区分は兵だけ、武将の区分は武将だけを比べる。最大値もその中で取る
const pool = (): readonly AttackerKind[] => (cmpSide === 'gen' ? GENERAL_ORDER : TROOP_ORDER);
const nameOf = (k: AttackerKind) => ADEF[k].name;

function statsOf(k: AttackerKind): UnitStats {
  const d = ADEF[k];
  const dmg = d.dmg;
  const s = {
    cost: d.cost,
    hp: d.hp,
    dmg,
    cd: d.cd,
    vsU: dmg && !d.noUnits ? (d.vsGen ?? 1) : 0,
    fac: dmg ? d.fac : 0, // 傷を与えないものの倍率は意味がないので、0 として「—」で出す
    gate: dmg ? gateMul(d) : 0,
    hall: dmg ? d.hall : 0,
    range: d.range,
    speed: d.speed,
    skillCd: d.skillCd ?? 0,
    aggro: isGeneralKind(k) ? GDEF[k].aggro : 0,
    reach: d.reach ?? 0,
  };
  // 火力は倍率から作る（「—」にする条件を倍率の側だけに置く）
  return {
    ...s,
    dpsU: (dmg * s.vsU) / d.cd,
    dpsF: (dmg * s.fac) / d.cd,
    dpsG: (dmg * s.gate) / d.cd,
    dpsH: (dmg * s.hall) / d.cd,
  };
}
// 番付を描く（攻城兵・武将・防御施設で共通）。dropZero のときは値が 0 の行を除く（施設）。
// 除かないときは、火力が 0 の行を「攻撃不可」と出す
function barsHtml<R>(
  metrics: readonly Metric<R>[],
  items: readonly { name: string; r: R }[],
  color: string,
  dropZero = false,
) {
  return metrics
    .map((m) => {
      const rows = items
        .map(({ name, r }) => ({ name, v: m.f(r) }))
        .filter((x) => !dropZero || x.v > 0)
        .sort((a, b) => b.v - a.v);
      const mx = Math.max(...rows.map((x) => x.v));
      const body = rows
        .map((x) => {
          const none = m.dps && x.v === 0;
          return (
            `<div class="brow"><span class="bname">${x.name}</span>` +
            `<span class="btrack"><i style="width:${none || !mx ? 0 : (x.v / mx) * 100}%;background:${color}"></i></span>` +
            `<span class="bval">${none ? '攻撃不可' : `${x.v.toFixed(m.dec)}<small>${m.unit}</small>`}</span></div>`
          );
        })
        .join('');
      return body ? `<div class="bblock"><h4>${m.label}</h4>${body}</div>` : '';
    })
    .join('');
}

function tableHtml() {
  const all: {
    h: string;
    f: (s: UnitStats) => number;
    best: 'min' | 'max' | 'none'; // none：良し悪しのない値（動かし方の設定）で、1位を付けない
    d: number;
    x?: string;
    none?: boolean; // 0 のときは「—」と出す
    cost?: boolean; // コストを使う列。武将は兵力を使わないので出さない
    gen?: boolean; // 武将だけの列
    tip?: string; // 見出しにマウスを合わせたときの説明
  }[] = [
    { h: 'コスト', f: (s) => s.cost, best: 'min', d: 0, cost: true },
    { h: '体力', f: (s) => s.hp, best: 'max', d: 0 },
    { h: '体力/コスト', f: (s) => s.hp / s.cost, best: 'max', d: 1, cost: true },
    { h: '攻撃', f: (s) => s.dmg, best: 'max', d: 0, none: true },
    { h: '間隔(秒)', f: (s) => s.cd, best: 'min', d: 1 },
    { h: '射程', f: (s) => s.range, best: 'max', d: 1 },
    { h: '速度', f: (s) => s.speed, best: 'max', d: 1 },
    {
      h: 'スキル間隔(秒)',
      f: (s) => s.skillCd,
      best: 'min',
      d: 1,
      gen: true,
      tip: '前のスキルを出してから、次を出せるまでの秒数',
    },
    {
      h: '寄り道(マス)',
      f: (s) => s.reach,
      best: 'none',
      d: 0,
      tip: '本丸への道を進みながら、道からこの距離の内にいる相手に寄って攻撃する',
    },
    {
      h: '索敵範囲(守り)',
      f: (s) => s.aggro,
      best: 'none',
      d: 1,
      gen: true,
      tip: '守りのとき、今いる所からこの距離の内の敵を狙って追う。追った先からも同じく見て、いなければ持ち場へ戻る',
    },
  ];
  // 武将はコストの列を除き、武将だけの列を足す。特徴は攻めと守りに分けて出す
  const gen = cmpSide === 'gen';
  const cols = all.filter((c) => (gen ? !c.cost : !c.gen));
  const ks = pool();
  const rows = ks.map((k) => ({ k, s: statsOf(k) }));
  // 1位の値。差のない列（武将一律の値など）は付けない
  const bestOf = cols.map((c) => {
    const v = rows.map((r) => c.f(r.s));
    const mx = Math.max(...v);
    const mn = Math.min(...v);
    if (c.best === 'none' || mx === mn) return Number.NaN;
    return c.best === 'max' ? mx : mn;
  });
  const traitHead = gen ? '<th class="trait">スキル</th>' : '<th>特徴</th>';
  let h = `<thead><tr><th>${gen ? '武将' : '兵種'}</th>${cols.map((c) => `<th${c.tip ? ` title="${c.tip}"` : ''}>${c.h}</th>`).join('')}${traitHead}</tr></thead><tbody>`;
  for (const { k, s } of rows) {
    const cells = cols
      .map((c, i) => {
        const v = c.f(s);
        const text = c.none && !v ? '—' : `${c.x || ''}${v.toFixed(c.d)}`;
        return `<td${ks.length > 1 && v === bestOf[i] ? ' class="best"' : ''}>${text}</td>`;
      })
      .join('');
    // 名前の左に、ドット絵の姿を動かして出す（字の印は出さない）
    h += `<tr><td><span class="tname">${motionCanvas(k)}${nameOf(k)}${seeBtn(`atk:${k}`, nameOf(k))}</span></td>${cells}<td class="trait">${isGeneralKind(k) ? SKILL[k] : TRAIT[k]}</td></tr>`;
  }
  return `${h}</tbody>`;
}

// ---- 火力の表 -----------------------------------------------------------
// 倍率・火力/秒・コストあたりの火力/秒を、相手ごとに横に並べる。武将は兵力を使わないので、コストあたりを出さない
const TARGETS = [
  { h: '対武将', mul: 'vsU', dps: 'dpsU' },
  { h: '対施設', mul: 'fac', dps: 'dpsF' },
  { h: '対門', mul: 'gate', dps: 'dpsG' },
  { h: '対本丸', mul: 'hall', dps: 'dpsH' },
] as const;
const HEAT_MAX = 45; // いちばん濃いマスの色の割合（％）。上に載せる字が読める濃さまで

// 列の濃さの基準。0（「—」）は比べない。差のない列は、濃さも太字も付けない
interface Heat {
  max: number;
  flat: boolean;
}
function heatOf(vals: readonly number[]): Heat {
  const hit = vals.filter((v) => v > 0);
  const max = Math.max(...hit);
  return { max, flat: !hit.length || max === Math.min(...hit) };
}
// 列の中での大きさをマスの濃さにし、列の1位を太字にする（攻城兵・武将・防御施設の表で共通）
function heatTd(v: number, h: Heat, color: string, text: string, cls: readonly string[] = []) {
  const peak = v > 0 && !h.flat && v === h.max;
  const names = peak ? [...cls, 'peak'] : cls;
  const attr = names.length ? ` class="${names.join(' ')}"` : '';
  if (!v) return `<td${attr}>—</td>`;
  const pct = h.flat ? 0 : Math.round((v / h.max) * HEAT_MAX);
  const style = pct ? ` style="background:color-mix(in srgb, ${color} ${pct}%, transparent)"` : '';
  return `<td${attr}${style}>${text}</td>`;
}

interface PowerGroup {
  h: string;
  f: (s: UnitStats, t: (typeof TARGETS)[number]) => number;
  d: number;
  x?: string;
}

function powerHtml() {
  const gen = cmpSide === 'gen';
  const groups: PowerGroup[] = [
    { h: '倍率', f: (s, t) => s[t.mul], d: 1, x: '×' },
    { h: '火力/秒', f: (s, t) => s[t.dps], d: 1 },
  ];
  if (!gen) groups.push({ h: 'コストあたりの火力/秒', f: (s, t) => s[t.dps] / s.cost, d: 2 });
  const ks = pool();
  const rows = ks.map((k) => ({ k, s: statsOf(k) }));
  const color = gen ? 'var(--gold)' : 'var(--atk)';
  const cols = groups.flatMap((g) =>
    TARGETS.map((t, i) => ({ g, t, first: i === 0, heat: heatOf(rows.map((r) => g.f(r.s, t))) })),
  );
  const cell = (c: (typeof cols)[number], s: UnitStats) => {
    const v = c.g.f(s, c.t);
    return heatTd(v, c.heat, color, `${c.g.x || ''}${v.toFixed(c.g.d)}`, c.first ? ['grp'] : []);
  };
  const head1 = groups.map((g) => `<th class="grp vsHead" colspan="${TARGETS.length}">${g.h}</th>`).join('');
  const head2 = cols.map((c) => `<th class="vs${c.first ? ' grp' : ''}">${c.t.h}</th>`).join('');
  const body = rows
    .map((r) => `<tr><td><span class="tname">${nameOf(r.k)}</span></td>${cols.map((c) => cell(c, r.s)).join('')}</tr>`)
    .join('');
  return `<thead><tr><th rowspan="2">${gen ? '武将' : '兵種'}</th>${head1}</tr><tr>${head2}</tr></thead><tbody>${body}</tbody>`;
}

// ---- 攻城兵と武将の動き -------------------------------------------------
// 大きな絵の武将と兵をその場で、歩く・攻撃・倒れるの順に通して動かす。コマの並びと、それぞれの長さ（秒）
type Step = [BigAction, number, number];
const WALK_SEQ: Step[] = [
  ['walk', 0, 0.14],
  ['walk', 1, 0.14],
  ['walk', 2, 0.14],
  ['walk', 3, 0.14],
];
const ATK_SEQ: Step[] = [
  ['idle', 0, 0.5],
  ['attack', 1, 0.12],
  ['attack', 2, 0.16],
  ['attack', 3, 0.22],
];
const DOWN_SEQ: Step[] = [
  ['idle', 0, 0.6],
  ['fall', 1, 0.3],
  ['fall', 2, 1.1],
];
const MOTION_SEQ: Step[] = [...WALK_SEQ, ...WALK_SEQ, ...WALK_SEQ, ...ATK_SEQ, ...ATK_SEQ, ...DOWN_SEQ];
const MOTION_DOTS = 60; // 動きの欄の1枚の大きさ（ドット）
let motionRaf = 0;
let motionKey = '';
let motionColor = ''; // 鎧の色（攻めの色）。明暗の設定が変わったときだけ読み直す
// 動きを減らす設定のときは、立ち姿のまま止める（防衛配置のパネルと同じ）
const still = window.matchMedia('(prefers-reduced-motion: reduce)');

function frameAt(seq: Step[], t: number): BigPick {
  const total = seq.reduce((n, s) => n + s[2], 0);
  let r = t % total;
  for (const [action, i, d] of seq) {
    if (r < d) return { action, i };
    r -= d;
  }
  return BIG_STAND;
}
function drawMotions(now: number) {
  // 区分やタブを離れたら止める（戻ったときに renderCompare から再開する）
  if (cmpSide === 'def' || !$('unitTable').offsetParent) {
    motionRaf = 0;
    return;
  }
  const f = still.matches ? BIG_STAND : frameAt(MOTION_SEQ, now / 1000);
  const side = motionColor;
  const key = `${f.action}${f.i}|${side}`;
  if (key !== motionKey) {
    motionKey = key;
    for (const cv of $('unitTable').querySelectorAll<HTMLCanvasElement>('canvas.tmotion')) {
      const ctx = cv.getContext('2d');
      if (!ctx) continue;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      const k = cv.dataset.k ?? '';
      if (!isAttackerKind(k)) continue;
      // 全身を等倍（1ドットを画面の1点）で、欄いっぱいの MOTION_DOTS ドット四方に切り出す
      drawBigBody(ctx, cv, k, f, side, MOTION_DOTS);
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
  const size = MOTION_DOTS * dpr;
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
  gate: `開戦に必要。守りの武将は通れる。攻撃側は壊さないと通れない（衝車が強い）。郭を囲む塀の線にだけ置け、本丸から城の外へ、同じ門を通らない逃げ道を${ESCAPE_ROUTES}本作る。`,
  cata: '射程が長く、着弾点の周囲にまとめてダメージ。近くの敵は撃てない。',
  drum: `周囲${BDEF.drum.aura}マスの守りの武将と櫓・大筒の攻撃間隔が短くなる（×${BDEF.drum.rate}の速さ）。2つの範囲に入っても重ならない。`,
  bell: `早鐘：周囲${BDEF.bell.aura}マスに攻め手が入ると鐘が鳴り、離れた武将も駆けつける（今いる所から索敵範囲に${ALERT_EXTRA}マスを足した距離の内の武将）。`,
  tbow: '連射できる弓の櫓。',
  tgun: '射程が長く一撃が重いが、撃つ間隔が長い。',
  hall: `落とされたら負け。必須（1つ）で、置く・消す・動かすことができる（盤面の端から${HALL_MARGIN}マス以上内側、段をまたがない所）。`,
};
const DEF_ORDER: readonly DefId[] = ['wall', 'gate', 'tbow', 'tgun', 'cata', 'drum', 'bell', 'hall'];
interface DefRow {
  id: DefId;
  name: string;
  cost: number; // 郭の点数を使う数（施設だけ。城壁・門・本丸は 0）
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
    cd?: number;
    range?: number;
    unbreakable?: boolean;
    cost?: number;
  } = BDEF[id];
  const dmg = d.dmg || 0;
  return {
    id,
    name: d.name,
    cost: d.cost ?? 0,
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
  // コストあたりは、点数を使う施設だけ出す（城壁・門・本丸は 0 なので「—」）
  const per = (v: number, r: DefRow) => (r.cost ? v / r.cost : 0);
  const defMetrics: readonly Metric<DefRow>[] = [
    { label: '体力', f: (r) => r.hp, unit: '', dec: 0, perCost: true },
    { label: '秒間火力', f: (r) => r.dps, unit: '/秒', dec: 1, dps: true, perCost: true },
    { label: '射程', f: (r) => r.range, unit: 'マス', dec: 1 },
  ];
  // 本丸は比べるものがないので番付に入れない。施設は、値のないもの（攻撃しない・壊れない）を除く
  const items = rows.filter((r) => r.id !== 'hall').map((r) => ({ name: r.name, r }));
  const bars = barsHtml(defMetrics, items, 'var(--def)', true);
  const costBars = barsHtml(
    perCostMetrics(defMetrics, (r) => r.cost),
    items,
    'var(--def)',
    true,
  );
  const dpsHeat = heatOf(rows.map((r) => r.dps));
  const perHeat = heatOf(rows.map((r) => per(r.dps, r)));
  const heatCell = (v: number, h: Heat, dec: number) => heatTd(v, h, 'var(--def)', v.toFixed(dec));
  const head =
    '<thead><tr><th>配置物</th><th>コスト</th><th>体力</th><th>体力/コスト</th><th>攻撃</th><th>間隔(秒)</th>' +
    '<th>火力/秒</th><th>コストあたりの火力/秒</th><th>射程</th><th>特徴</th></tr></thead>';
  const body = rows
    .map(
      (r) =>
        `<tr><td><span class="tname">${icon(r)}${r.name}${isSampleFacility(r.id) ? seeBtn(`fac:${r.id}`, r.name) : ''}</span></td><td>${r.cost || '—'}</td>` +
        `<td>${dash(r.hp, 0)}</td><td>${dash(per(r.hp, r), 1)}</td><td>${dash(r.dmg, 0)}</td><td>${dash(r.cd, 1)}</td>` +
        `${heatCell(r.dps, dpsHeat, 1)}${heatCell(per(r.dps, r), perHeat, 2)}` +
        `<td>${dash(r.range, 1)}</td><td class="trait">${DEF_TRAIT[r.id]}</td></tr>`,
    )
    .join('');
  return { bars, costBars, table: `${head}<tbody>${body}</tbody>` };
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
  for (const b of $('cmpSide').querySelectorAll<HTMLButtonElement>('button'))
    b.setAttribute('aria-pressed', String(b.dataset.s === cmpSide));
  if (def) {
    const h = defCompareHtml();
    $('defBars').innerHTML = h.bars;
    $('defCostBars').innerHTML = h.costBars;
    $('defCostBarsHead').hidden = !h.costBars; // 中身がなければ見出しも出さない
    $('defTable').innerHTML = h.table;
    drawDefIcons();
    return;
  }
  // 攻城兵も武将も、基本の表・火力の表・項目ごとの番付を、この順に出す
  // 棒の色：攻城兵は攻めの色、武将は攻めにも守りにも出るので金（防御施設は守りの色）
  const color = gen ? 'var(--gold)' : 'var(--atk)';
  const items = pool().map((k) => ({ name: nameOf(k), r: statsOf(k) }));
  $('bars').innerHTML = barsHtml(METRICS, items, color);
  // コストあたりの番付。武将は兵力を使わないので出さない。中身がなければ見出しも出さない
  const costBars = gen
    ? ''
    : barsHtml(
        perCostMetrics(METRICS, (s) => s.cost),
        items,
        color,
      );
  $('costBars').innerHTML = costBars;
  $('costBarsHead').hidden = !costBars;
  $('bars').classList.toggle('gen', gen);
  $('unitTable').classList.toggle('gen', gen);
  $('unitTable').innerHTML = tableHtml();
  $('powerTable').innerHTML = powerHtml();
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
