// 計測フィールドの確かめのページ（field.html）。開発する人が、計測専用フィールド（src/sim/simField.ts）での
// 戦いを、計測スクリプト（scripts/field-solo.mjs）と同じ条件で目で見る。
// ゲームの画面からはリンクしない。戦いの計算・能力値・絵はゲームと同じものを使う。
import './style.css';
import {
  ADEF,
  type AutoState,
  autoStep,
  type Battle,
  buildPlan,
  COMPACT_POSTS,
  createBattle,
  DT,
  entriesOf,
  entryPoints,
  GDEF,
  GENERAL_ORDER,
  type GeneralKind,
  hallOf,
  isGeneralKind,
  type Layout,
  SIM_FIELDS,
  type SimFieldId,
  TEMPLATES,
  type Template,
  TIME_LIMIT,
} from './sim';
import { $ } from './ui/dom';
import { createRenderer } from './ui/renderer';

const SPEEDS = [0.5, 1, 2, 4];
const DEF_TROOP_COST = 140; // 守りの計測で、攻め手の兵に使わせる合計コスト（balance-solo と同じ）

interface FieldSetup {
  field: SimFieldId;
  side: 'atk' | 'def';
  gen: GeneralKind | ''; // '' は武将なし
  tpl: number;
  entry: 1 | 7;
}

// ---- 作戦の組み立て（scripts/field-solo.mjs と同じ手順） ----
const troopCost = (tpl: Template) =>
  tpl.steps.reduce((a, s) => (isGeneralKind(s.kind) ? a : a + (ADEF[s.kind]?.cost ?? 0) * (s.n ?? 1)), 0);
// 攻め：将枠の最初にその武将を入れ、残りの将枠は空ける。兵はそのまま
const atkSteps = (tpl: Template, gen: GeneralKind | ''): Template['steps'] => {
  let placed = false;
  const steps: Template['steps'] = [];
  for (const s of tpl.steps) {
    if (isGeneralKind(s.kind)) {
      if (gen && !placed) {
        steps.push({ ...s, kind: gen });
        placed = true;
      }
    } else steps.push(s);
  }
  return steps;
};
// 守りの攻め手：将枠を空け、兵の数を合計コスト140になるよう増やす（構成比は保つ）
const defSteps = (tpl: Template): Template['steps'] => {
  const f = DEF_TROOP_COST / troopCost(tpl);
  return tpl.steps
    .filter((s) => !isGeneralKind(s.kind))
    .map((s) => ({ ...s, n: Math.max(1, Math.round((s.n ?? 1) * f)) }));
};

function buildBattle(setup: FieldSetup): { battle: Battle; auto: AutoState; layout: Layout } {
  const tpl = TEMPLATES[setup.tpl];
  const base = (SIM_FIELDS.find((f) => f.id === setup.field) ?? SIM_FIELDS[0]).build();
  const eps = entryPoints(base);
  let layout = base;
  let steps: Template['steps'];
  if (setup.side === 'atk') {
    steps = atkSteps(tpl, setup.gen);
  } else {
    if (setup.gen) {
      const p = COMPACT_POSTS[setup.entry];
      layout = { ...base, generals: [{ kind: setup.gen, x: p.x, y: p.y }] };
    }
    steps = defSteps(tpl);
  }
  const plan = buildPlan({ ...tpl, steps }, entriesOf(tpl, eps, setup.entry));
  const battle = createBattle(layout);
  battle.timeLimit = TIME_LIMIT;
  if (setup.side === 'def') battle.budgetA = DEF_TROOP_COST;
  battle.started = plan.length > 0;
  return { battle, auto: { plan, i: 0 }, layout };
}

// ---- 画面 ----
const fieldSel = $<HTMLSelectElement>('field');
const sideSel = $<HTMLSelectElement>('side');
const genSel = $<HTMLSelectElement>('gen');
const tplSel = $<HTMLSelectElement>('tpl');
const entrySel = $<HTMLSelectElement>('entry');
const playBtn = $<HTMLButtonElement>('play');
const renderer = createRenderer($<HTMLCanvasElement>('fieldCv'));
$<HTMLCanvasElement>('fieldCv').addEventListener('pointerdown', (e) => renderer.orbitFrom(e));

fieldSel.innerHTML = SIM_FIELDS.map((f) => `<option value="${f.id}">${f.name}</option>`).join('');
genSel.innerHTML =
  `<option value="">武将なし</option>` +
  GENERAL_ORDER.map((k) => `<option value="${k}">${GDEF[k].busho}</option>`).join('');
tplSel.innerHTML = TEMPLATES.map((t, i) => `<option value="${i}">${t.name}</option>`).join('');
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

// URL の #フィールド|攻守|武将|編成例|出撃口 に選択を残す（duel.html と同じ考え方）
function readHash(): FieldSetup {
  const parts = decodeURIComponent(location.hash.slice(1)).split('|');
  // 旧形式（フィールドなし）で開かれたときは平城として読む
  if (parts[0] === 'atk' || parts[0] === 'def') parts.unshift('flat');
  const [field, side, gen, tpl, entry] = parts;
  return {
    field: SIM_FIELDS.some((f) => f.id === field) ? (field as SimFieldId) : 'flat',
    side: side === 'def' ? 'def' : 'atk',
    gen: isGeneralKind(gen) ? gen : '',
    tpl: Math.min(Math.max(Number(tpl) || 0, 0), TEMPLATES.length - 1),
    entry: entry === '7' ? 7 : 1,
  };
}

let setup = readHash();
let { battle, auto, layout: curLayout } = buildBattle(setup);
let playing = false;
let speed = 1;
let acc = 0;
let last = 0;
let paintAt = 0;

function restart(next: FieldSetup) {
  setup = next;
  history.replaceState(null, '', `#${setup.field}|${setup.side}|${setup.gen}|${setup.tpl}|${setup.entry}`);
  ({ battle, auto, layout: curLayout } = buildBattle(setup));
  playing = false;
  acc = 0;
  renderer.look(21, 21, 1);
  paintControls();
  paintData();
}

function paintControls() {
  fieldSel.value = setup.field;
  sideSel.value = setup.side;
  genSel.value = setup.gen;
  tplSel.value = String(setup.tpl);
  entrySel.value = String(setup.entry);
  playBtn.textContent = playing ? '一時停止' : battle.t > 0 ? '再開' : '開始';
  playBtn.disabled = battle.over;
  for (const b of $('speeds').querySelectorAll('button'))
    b.setAttribute('aria-pressed', String(Number(b.dataset.s) === speed));
}

function paintData() {
  const hall = hallOf(battle);
  const genName = setup.gen ? GDEF[setup.gen].busho : '武将なし';
  $('clock').textContent = `${battle.t.toFixed(1)}秒 / ${TIME_LIMIT}秒`;
  $('result').textContent = !battle.over
    ? '戦いの途中です'
    : battle.result === 'win'
      ? `攻めの勝ち（本丸が落ちた）・${battle.endT.toFixed(1)}秒`
      : battle.result === 'wipe'
        ? `攻めの全滅・${battle.endT.toFixed(1)}秒`
        : `時間切れ・${battle.endT.toFixed(1)}秒`;
  const me = setup.gen
    ? (setup.side === 'atk' ? battle.attackers : battle.defenders).find((u) => u.kind === setup.gen)
    : undefined;
  const key = setup.gen ? `${setup.side === 'atk' ? 'a' : 'd'}:${setup.gen}` : '';
  const genDmg = key ? Math.round(battle.stats.dmgBy[key]?.tot ?? 0) : 0;
  const broken = battle.buildings.filter((b) => b.hp <= 0).length;
  $('stats').textContent =
    `本丸 ${Math.max(0, Math.round(hall.hp))} / ${hall.maxHp}（${((Math.max(0, hall.hp) / hall.maxHp) * 100).toFixed(1)}%）` +
    `・壊れた施設 ${broken} / ${battle.buildings.length}` +
    `・攻めの喪失 ${battle.stats.aLost}` +
    (setup.gen
      ? `・${genName}の体力 ${me ? Math.max(0, Math.round(me.hp)) : 0} / ${me?.maxHp ?? ''}・与えた傷 ${genDmg}・防いだ傷 ${Math.round(battle.stats.wardSavedBy[key] ?? 0)}`
      : '');
}

function frame(now: number) {
  const dtms = last ? Math.min(now - last, 100) : 0;
  last = now;
  if (playing && !battle.over) {
    acc += (dtms / 1000) * speed;
    while (acc >= DT && !battle.over) {
      autoStep(battle, auto);
      acc -= DT;
    }
    if (battle.over) {
      playing = false;
      paintControls();
      paintData();
    } else if (now - paintAt > 200) {
      paintAt = now;
      paintData();
    }
  }
  renderer.draw({
    mode: 'sample',
    layout: curLayout,
    battle,
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

fieldSel.addEventListener('change', () =>
  restart({ ...setup, field: SIM_FIELDS.some((f) => f.id === fieldSel.value) ? (fieldSel.value as SimFieldId) : 'flat' }),
);
sideSel.addEventListener('change', () => restart({ ...setup, side: sideSel.value === 'def' ? 'def' : 'atk' }));
genSel.addEventListener('change', () => restart({ ...setup, gen: isGeneralKind(genSel.value) ? genSel.value : '' }));
tplSel.addEventListener('change', () => restart({ ...setup, tpl: Number(tplSel.value) }));
entrySel.addEventListener('change', () => restart({ ...setup, entry: entrySel.value === '7' ? 7 : 1 }));
playBtn.addEventListener('click', () => {
  playing = !playing;
  paintControls();
});
$<HTMLButtonElement>('reset').addEventListener('click', () => restart(setup));

renderer.look(21, 21, 1);
paintControls();
paintData();
requestAnimationFrame(frame);
