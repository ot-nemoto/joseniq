import {
  ADEF,
  type AttackerKind,
  type AttackPlan,
  type AutoState,
  autoStep,
  type Battle,
  type BattleRecord,
  type BattleResult,
  BUDGET_A,
  canDeploy,
  countOf,
  createBattle,
  DT,
  deploy,
  emptyLayout,
  entryPoints,
  GDEF,
  GENERAL_ORDER,
  type GeneralKind,
  HALL,
  isGeneralKind,
  type Layout,
  LIMITS,
  MAX_GENERALS,
  makeRecord,
  type PlanFilter,
  parseRecord,
  place,
  planAttack,
  preset,
  putGeneral,
  type RunSummary,
  removeGeneral,
  replayState,
  sameOutcome,
  step,
  TEMPLATES,
  type Template,
  TIME_LIMIT,
  type Tool,
  UNIT_ORDER,
  validate,
  ZONE,
} from '../sim';
import { initCompare, renderCompare } from './compare';
import { $ } from './dom';
import { blitBusho, type Frame } from './pixel';
import { createRenderer, type Mode, type Tile } from './renderer';

const STORE_KEY = 'kozen-enbu-layout-v7'; // 32×32・本丸2×2
const VIEW_KEY = 'kozen-enbu-view';
const GEN_DOTS = 30; // パネルの武将のキャラの大きさ（ドット）

interface AutoRun extends AutoState {
  label: string;
  summary?: RunSummary; // 自動攻城の先読み結果
  record?: BattleRecord; // 出撃記録の再生
}
interface ToolInfo {
  name: string;
  cost?: number | string;
  g: string;
  s: 'a' | 'd' | 'n';
  d: string;
}

const GENERAL_INFO: Record<(typeof GENERAL_ORDER)[number], string> = {
  brave: '猛将・周りもまとめて斬る',
  archer: '弓将・遠くから射る',
  sage: '軍師・範囲攻撃「火計」',
  spear: '槍将・間合いが長く騎馬に強い',
  rider: '騎馬大将・速く、駆けた一撃が重い',
  gunner: '鉄砲大将・射程9・一撃が大きい',
  builder: '築城名人・周りの建物を直す',
  ninja: '忍び・近づかないと見つからない',
  guard: '堅守・周りの味方の傷を減らす',
};
const EDIT_TOOLS: (ToolInfo & { id: Tool })[] = [
  { id: 'wall', name: '城壁', g: '壁', s: 'd', d: '通行を阻む' },
  { id: 'moat', name: '堀', g: '堀', s: 'd', d: '外周3マス以内・敵は鈍る' },
  { id: 'bar', name: '拒馬', g: '拒', s: 'd', d: '騎兵を止める・他は鈍る' },
  { id: 'tbow', name: '櫓（弓）', g: '櫓', s: 'd', d: '射程6.5・連射' },
  { id: 'tgun', name: '櫓（鉄砲）', g: '砲', s: 'd', d: '射程9・高威力・遅い' },
  { id: 'cata', name: '投石機', g: '投', s: 'd', d: '射程11・範囲・近くは撃てない' },
  { id: 'drum', name: '鼓楼', g: '鼓', s: 'd', d: '周囲の守将と櫓が速くなる' },
  { id: 'erase', name: '消去', g: '消', s: 'n', d: '施設を取り除く' },
];
const UNIT_INFO: Record<AttackerKind, string> = {
  inf: '近接の基本兵',
  arc: '遠距離から射る',
  cav: '守将を優先して狙う',
  ram: '本丸を直接狙う',
  eng: '壁と櫓を一気に壊す',
  shd: '周りの兵の傷を代わりに受ける',
  scout: '足が速い囮。守将や櫓を引きつける',
  brave: '猛将・周囲をまとめて斬る',
  archer: '弓将・射程が長い',
  sage: '軍師・櫓を狙う範囲攻撃「火計」',
  spear: '槍将・間合いが長く騎馬に強い',
  rider: '騎馬大将・守将を狙い、駆けた一撃が重い',
  gunner: '鉄砲大将・射程9・一撃が大きい',
  builder: '築城名人・施設を狙い、周りの工兵を速くする',
  ninja: '忍び・見つかりにくく、当てた相手を止める',
  guard: '堅守・周りの味方の傷を減らす',
};
// 武将は兵力を使わず、1人ずつ・全体で MAX_GENERALS 人まで出撃できる
const costLabel = (b: Battle | null, k: AttackerKind) => {
  const d = ADEF[k];
  if (!d.limit) return d.cost;
  if (b && (b.used[k] ?? 0) >= d.limit) return '出撃済';
  return b && !canDeploy(b, k) && b.budgetA >= d.cost ? '上限' : '';
};
// 兵種を選ぶキー：1〜9、0、-の順
const UNIT_KEYS = [...'1234567890-'].slice(0, UNIT_ORDER.length);
const AUTO_ATTACK_LABEL = '自動攻城';
// 編成例のボタンに出す内訳（例：三将・盾兵10・工兵6・歩兵10）
function templateSummary(tpl: Template) {
  const n = new Map<AttackerKind, number>();
  for (const st of tpl.steps) if (!ADEF[st.kind].general) n.set(st.kind, (n.get(st.kind) ?? 0) + st.n);
  const gens = tpl.steps.filter((st) => ADEF[st.kind].general).length;
  const parts = [...n].map(([k, c]) => `${ADEF[k].name}${c}`);
  return [gens === 3 ? '三将' : '', ...parts].filter(Boolean).join('・') + (tpl.pair ? '（二方向）' : '');
}
const AUTO_NOTE = 'この城に対して、複数の作戦を先読みして最も良いものを自動で実行します。';

const fmt = (t: number) => {
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const resultText = (r: BattleResult | null, endT: number) =>
  r === 'win' ? `${fmt(endT)} で落城` : r === 'timeout' ? '時間切れ' : r === 'wipe' ? '全滅' : '戦闘の途中';

export function startApp() {
  const cv = $<HTMLCanvasElement>('cv');
  const renderer = createRenderer(cv);

  let layout: Layout = loadLayout() || preset('basic');
  let battleLayout: Layout = layout; // 戦闘に使っている配置（記録の再生では記録の配置）
  let mode: Mode = 'edit';
  let tool: Tool = 'wall';
  let unitSel: AttackerKind = 'inf';
  let battle: Battle | null = null;
  let paused = false;
  let speed = 1;
  let acc = 0;
  let resultShown = false;
  let hover: Tile | null = null;
  let painting = false;
  let drag: GeneralKind | null = null; // ドラッグで動かしている武将
  let genColor = ''; // パネルの武将のキャラの色（守りの色）。起動時と、明暗の設定が変わったときに読む
  const genPix = new Map<GeneralKind, HTMLCanvasElement>(); // パネルの武将のキャラ
  let lastPaint = '';
  let panelAt = 0;
  let logLen = -1;
  let toastTimer = 0;
  let busy = false;
  let jobId = 0;
  let autoRun: AutoRun | null = null;

  // ---- 保存 ---------------------------------------------------------------
  function loadLayout(): Layout | null {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? validate(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }
  function saveLayout() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(layout));
    } catch {
      // 保存できなくても動作する
    }
  }
  // 配置を丸ごと入れ替える（編成例・全消去・読み込み）
  function setLayout(l: Layout) {
    layout = l;
    saveLayout();
    refreshEditPanel();
  }

  // ---- 通知 ---------------------------------------------------------------
  function toast(msg: string) {
    if (!msg) return;
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      t.hidden = true;
    }, 1700);
  }

  // ---- パネル生成 ---------------------------------------------------------
  function makeTool(info: ToolInfo, pressed: boolean, onClick: () => void) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tool';
    b.setAttribute('aria-pressed', String(pressed));
    b.innerHTML =
      `<span class="glyph ${info.s}">${info.g}</span>` +
      `<span class="nm">${info.name}<span class="cnt">${info.cost ?? ''}</span></span>` +
      `<small>${info.d}</small>`;
    b.addEventListener('click', onClick);
    return b;
  }
  // 施設は道具を選んで置く。武将はパネルから盤面へドラッグして置き、置いた武将を押すと外す
  function buildEditTools() {
    $('toolgrid').textContent = '';
    $('genEditGrid').textContent = '';
    for (const t of EDIT_TOOLS) {
      const b = makeTool(t, t.id === tool, () => {
        tool = t.id;
        refreshEditPanel();
        updateHint();
      });
      b.dataset.tool = t.id;
      $('toolgrid').appendChild(b);
    }
    for (const k of GENERAL_ORDER) {
      // ボタンには武将の名前、説明には型と特徴。字の代わりにキャラを出す
      const b = makeTool({ name: GDEF[k].busho, g: '', s: 'd', d: GENERAL_INFO[k] }, false, () => {
        // ドラッグして置いた直後のクリックは無視する（置いてすぐ外れないように）
        if (b.dataset.dragged) delete b.dataset.dragged;
        else if (countOf(layout, k)) {
          removeGeneral(layout, k);
          saveLayout();
          refreshEditPanel();
        }
      });
      b.dataset.gen = k;
      b.querySelector('.cnt')?.remove();
      const pix = document.createElement('canvas');
      pix.className = 'gpix';
      pix.width = pix.height = GEN_DOTS * Math.min(Math.round(window.devicePixelRatio || 1), 2);
      pix.setAttribute('aria-hidden', 'true');
      b.querySelector('.glyph')?.replaceWith(pix);
      genPix.set(k, pix);
      // 置いていない武将は、ボタンをつかんで盤面へドラッグする（左ボタン・タッチ・ペンのとき）
      b.addEventListener('pointerdown', (e) => {
        // 前のドラッグの印は、クリックが来なかったときに残るので、押し始めのたびに消す
        delete b.dataset.dragged;
        if (countOf(layout, k) || e.button !== 0) return;
        e.preventDefault();
        try {
          b.setPointerCapture(e.pointerId);
        } catch {
          // 無視
        }
        b.dataset.dragged = '1';
        startDrag(k, e);
      });
      b.addEventListener('pointermove', (e) => {
        if (drag === k) dragMove(e);
      });
      b.addEventListener('pointerup', (e) => {
        if (drag === k) drop(e);
      });
      b.addEventListener('pointercancel', endPaint);
      $('genEditGrid').appendChild(b);
    }
  }
  // キャラを描く。武将・色・コマのどれかが変わったときだけ描き直す
  function drawGenPix(cv: HTMLCanvasElement, k: GeneralKind, color: string, frame: Frame = 'walk0') {
    const key = `${k}|${color}|${frame}`;
    if (cv.dataset.key === key) return;
    cv.dataset.key = key;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const dot = cv.width / GEN_DOTS;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    blitBusho(ctx, k, frame, color, 13 * dot, 29 * dot, dot, 1);
  }
  const defColor = () => getComputedStyle(document.documentElement).getPropertyValue('--def').trim();
  // 兵と武将は別の区分に並べる
  function buildUnitTools() {
    $('unitgrid').textContent = '';
    $('genUnitGrid').textContent = '';
    UNIT_ORDER.forEach((k, i) => {
      const d = ADEF[k];
      const g = $(d.general ? 'genUnitGrid' : 'unitgrid');
      const b = makeTool(
        {
          name: d.busho ?? d.name,
          cost: costLabel(battle, k),
          g: d.glyph,
          s: 'a',
          d: UNIT_KEYS[i] ? `${UNIT_INFO[k]}（${UNIT_KEYS[i]}）` : UNIT_INFO[k],
        },
        k === unitSel,
        () => {
          unitSel = k;
          refreshBattlePanel();
        },
      );
      b.dataset.unit = k;
      g.appendChild(b);
    });
  }

  function refreshEditPanel() {
    $('genEditCount').textContent = `${layout.generals.length} / ${MAX_GENERALS}`;
    const full = layout.generals.length >= MAX_GENERALS;
    for (const b of $('panelEdit').querySelectorAll<HTMLButtonElement>('.tool')) {
      const k = b.dataset.gen;
      if (k && isGeneralKind(k)) {
        // 置いた武将は赤枠（キャラは歩く）。MAX_GENERALS 人置いたら、残りの武将は押せない
        const placed = countOf(layout, k) > 0;
        b.setAttribute('aria-pressed', String(placed));
        b.disabled = !placed && full;
        b.title = placed ? '押すと配置から外します' : '盤面へドラッグして配置します';
        const pix = b.querySelector<HTMLCanvasElement>('.gpix');
        if (pix && !placed) drawGenPix(pix, k, genColor);
        continue;
      }
      const t = EDIT_TOOLS.find((x) => x.id === b.dataset.tool);
      if (!t) continue;
      const id = t.id;
      b.setAttribute('aria-pressed', String(id === tool));
      const lim = id === 'erase' ? 0 : LIMITS[id];
      const used = id === 'erase' ? 0 : countOf(layout, id);
      const sp = b.querySelector('.cnt');
      if (sp) sp.textContent = lim ? `${used} / ${lim}` : '';
      // 上限に達しても選択は維持
      b.disabled = !!lim && used >= lim;
    }
  }
  function refreshBattlePanel() {
    if (!battle) return;
    $('timeText').textContent = `${fmt(battle.t)} / ${fmt(TIME_LIMIT)}`;
    $('budText').textContent = `${battle.budgetA} / ${BUDGET_A}`;
    $('budBar').style.width = `${(battle.budgetA / BUDGET_A) * 100}%`;
    const gens = UNIT_ORDER.reduce((n, k) => n + (ADEF[k].general ? (battle?.used[k] ?? 0) : 0), 0);
    $('genUnitCount').textContent = `${gens} / ${MAX_GENERALS}`;
    for (const b of $('panelBattle').querySelectorAll<HTMLButtonElement>('.tool')) {
      const k = b.dataset.unit as AttackerKind;
      b.setAttribute('aria-pressed', String(k === unitSel));
      b.disabled = !canDeploy(battle, k) || battle.over || !!autoRun || busy;
      const sp = b.querySelector('.cnt');
      if (sp) sp.textContent = String(costLabel(battle, k));
    }
    $<HTMLButtonElement>('autoAttackBtn').disabled = busy;
    for (const b of $('presetgrid').querySelectorAll<HTMLButtonElement>('button')) b.disabled = busy;
    $<HTMLSelectElement>('presetEntry').disabled = busy;
    $('manualBtn').hidden = !autoRun || battle.over;
    const pb = $<HTMLButtonElement>('pauseBtn');
    pb.textContent = paused ? '再開' : '一時停止';
    pb.disabled = !battle.started || battle.over;
    for (const b of $('speedSeg').querySelectorAll<HTMLButtonElement>('button'))
      b.setAttribute('aria-pressed', String(Number(b.dataset.s) === speed));
  }
  function renderLog() {
    if (!battle) return;
    if (battle.log.length === logLen) return;
    logLen = battle.log.length;
    const ol = $('log');
    ol.textContent = '';
    const items = battle.log.slice(-9).reverse();
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'e';
      li.textContent = '出撃すると戦況がここに流れます';
      ol.appendChild(li);
    }
    for (const e of items) {
      const li = document.createElement('li');
      const tm = document.createElement('time');
      tm.textContent = fmt(e.t);
      const sp = document.createElement('span');
      sp.className = e.side;
      sp.textContent = e.msg;
      li.append(tm, sp);
      ol.appendChild(li);
    }
  }

  function updateHint() {
    const h = $('hint');
    if (mode === 'edit') {
      h.textContent = `城域（点線の内側・${ZONE.x1 - ZONE.x0 + 1}×${ZONE.y1 - ZONE.y0 + 1}マス）に配置します。種別ごとに置ける数の上限があります。堀は外周3マス以内だけです。城壁と消去はなぞって連続で配置できます。本丸（${HALL.w}×${HALL.h}）は中央に固定です。武将はパネルから盤面へドラッグして置き、盤面でドラッグして動かします。置いた武将（赤枠）を押すと外せます。薄い円は、敵を見つける範囲です。`;
    } else if (battle?.over) h.textContent = '';
    else if (busy) h.textContent = '作戦を考えています…';
    else if (autoRun?.record) h.textContent = '出撃記録を再生中です。速度を上げると早送りできます。';
    else if (autoRun) h.textContent = '自動攻城を実行中です。速度を上げると早送りできます。';
    else if (battle && !battle.started)
      h.textContent =
        '外周の青いエリアをタップして出撃。最初の出撃で開戦します。数字キー（1〜9・0）で兵種、スペースで一時停止。';
    else h.textContent = '出撃のタイミングは自由です。兵種を選んで、外周のどこからでも投入できます。';
  }

  // ---- モード切替 ---------------------------------------------------------
  function setMode(m: Mode) {
    mode = m;
    endPaint(); // ドラッグやなぞりの途中なら後始末する（指の位置のキャラも消す）
    jobId++;
    busy = false;
    autoRun = null;
    resetAutoUi();
    $('tabUnits').setAttribute('aria-selected', String(m === 'units'));
    $('layoutMain').hidden = m === 'units';
    $('unitsView').hidden = m !== 'units';
    $('tabEdit').setAttribute('aria-selected', String(m === 'edit'));
    $('tabBattle').setAttribute('aria-selected', String(m === 'battle'));
    $('panelEdit').hidden = m !== 'edit';
    $('panelBattle').hidden = m !== 'battle';
    if (m === 'battle') newBattle();
    else {
      battle = null;
      $('overlay').hidden = true;
      if (m === 'edit') refreshEditPanel();
      else renderCompare();
    }
    updateHint();
    panelAt = 0;
  }
  function newBattle(l: Layout = layout) {
    battleLayout = l;
    battle = createBattle(l);
    paused = false;
    acc = 0;
    resultShown = false;
    logLen = -1;
    autoRun = null;
    resetAutoUi();
    $('overlay').hidden = true;
    buildUnitTools();
    refreshBattlePanel();
    renderLog();
    updateHint();
  }

  // ---- 入力 ---------------------------------------------------------------
  const tileAt = (e: PointerEvent) => renderer.tileAt(e.clientX, e.clientY);
  function applyEdit(x: number, y: number) {
    const key = `${tool}${x},${y}`;
    if (key === lastPaint) return;
    lastPaint = key;
    const r = place(layout, tool, x, y);
    if (r.ok) {
      saveLayout();
      refreshEditPanel();
    } else toast(r.msg);
  }
  // ドラッグ中、盤面の外では指の位置にキャラを出す（盤面の上では、置くマスに影を出す）
  const dragFloat = document.createElement('canvas');
  dragFloat.className = 'dragFloat';
  dragFloat.width = dragFloat.height = GEN_DOTS * 2;
  dragFloat.hidden = true;
  document.body.appendChild(dragFloat);
  function startDrag(k: GeneralKind, e: PointerEvent) {
    drag = k;
    drawGenPix(dragFloat, k, genColor);
    dragMove(e);
  }
  function dragMove(e: PointerEvent) {
    hover = tileAt(e);
    dragFloat.hidden = !!hover;
    dragFloat.style.left = `${e.clientX}px`;
    dragFloat.style.top = `${e.clientY}px`;
    updateCursor();
  }
  // 離したマスに置く（置いた武将なら動かす）。置けないマスや盤面の外なら、何もしない
  function drop(e: PointerEvent) {
    const p = tileAt(e);
    const g = layout.generals.find((q) => q.kind === drag);
    // 同じマスで離したとき（押しただけのとき）は何もしない
    if (drag && p && !(g && g.x === p.x && g.y === p.y)) {
      const r = putGeneral(layout, drag, p.x, p.y);
      if (r.ok) {
        saveLayout();
        refreshEditPanel();
      } else toast(r.msg);
    }
    endPaint();
  }
  const generalAt = (p: Tile | null) => (p && layout.generals.find((g) => g.x === p.x && g.y === p.y)) || null;
  // 編集中のカーソル：武将の上ではつかめることを示す
  const updateCursor = () => {
    cv.style.cursor = mode !== 'edit' ? '' : drag ? 'grabbing' : generalAt(hover) ? 'grab' : '';
  };
  cv.addEventListener('pointerdown', (e) => {
    const p = tileAt(e);
    hover = p;
    if (!p) return;
    if (mode === 'edit') {
      try {
        cv.setPointerCapture(e.pointerId);
      } catch {
        // 無視
      }
      // 武将のマスを押したら、どの道具を選んでいても武将をつかむ
      const g = generalAt(p);
      if (g) {
        if (e.button === 0) startDrag(g.kind, e);
      } else {
        painting = true;
        lastPaint = '';
        applyEdit(p.x, p.y);
      }
      updateCursor();
    } else if (battle) {
      if (busy || autoRun) {
        toast(busy ? '作戦を考えています' : '自動攻城中です。「手動に切り替え」で引き継げます');
        return;
      }
      const r = deploy(battle, unitSel, p.x, p.y);
      if (!r.ok) toast(r.msg);
      else {
        refreshBattlePanel();
        renderLog();
        updateHint();
      }
    }
  });
  cv.addEventListener('pointermove', (e) => {
    if (drag) {
      dragMove(e);
      return;
    }
    const p = tileAt(e);
    hover = p;
    if (p && mode === 'edit' && painting && (tool === 'wall' || tool === 'moat' || tool === 'erase'))
      applyEdit(p.x, p.y);
    updateCursor();
  });
  function endPaint() {
    painting = false;
    lastPaint = '';
    drag = null;
    dragFloat.hidden = true;
    updateCursor();
  }
  cv.addEventListener('pointerup', (e) => {
    if (drag) drop(e);
    else endPaint();
  });
  cv.addEventListener('pointercancel', endPaint);
  cv.addEventListener('pointerleave', () => {
    hover = null;
  });

  $('tabEdit').addEventListener('click', () => setMode('edit'));
  $('tabBattle').addEventListener('click', () => setMode('battle'));
  $('tabUnits').addEventListener('click', () => setMode('units'));
  $('retryBtn').addEventListener('click', restart);
  $('resRetry').addEventListener('click', restart);
  $('autoAttackBtn').addEventListener('click', () => startAutoAttack());
  // 編成例：テンプレートを選んで出撃。出撃口は「おまかせ」なら先読みで選ぶ
  const presetEntry = $<HTMLSelectElement>('presetEntry');
  for (const [i, ep] of entryPoints(layout).entries()) presetEntry.add(new Option(ep.name, String(i)));
  TEMPLATES.forEach((tpl, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn preset';
    b.innerHTML = `<b>${tpl.name}</b><small>${templateSummary(tpl)}</small>`;
    b.addEventListener('click', () =>
      startAutoAttack({ tpl: i, entry: presetEntry.value === '' ? undefined : Number(presetEntry.value) }),
    );
    $('presetgrid').appendChild(b);
  });
  $('manualBtn').addEventListener('click', () => {
    autoRun = null;
    $('autoNote').textContent = '手動に切り替えました。続きは自分で出撃できます。';
    refreshBattlePanel();
    updateHint();
  });
  $('resEdit').addEventListener('click', () => setMode('edit'));
  $('pauseBtn').addEventListener('click', () => {
    paused = !paused;
    refreshBattlePanel();
  });
  // 表示の切り替え（2D：真上から／3D：斜め見下ろし）。選んだ表示はこのブラウザに覚えておく
  function setView(v: string) {
    const on = v === '3d';
    renderer.setIso(on);
    $('wrap').classList.toggle('iso', on);
    for (const b of $('viewSeg').querySelectorAll<HTMLButtonElement>('button'))
      b.setAttribute('aria-pressed', String(b.dataset.v === v));
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // 保存できなくても動作する
    }
  }
  for (const b of $('viewSeg').querySelectorAll<HTMLButtonElement>('button'))
    b.addEventListener('click', () => setView(b.dataset.v ?? '2d'));
  try {
    if (localStorage.getItem(VIEW_KEY) === '3d') setView('3d');
  } catch {
    // 読めなければ2Dのまま
  }
  for (const b of $('speedSeg').querySelectorAll<HTMLButtonElement>('button'))
    b.addEventListener('click', () => {
      speed = Number(b.dataset.s);
      refreshBattlePanel();
    });
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-preset]')) {
    b.addEventListener('click', () => {
      setLayout(preset(b.dataset.preset ?? ''));
    });
  }
  $('clearBtn').addEventListener('click', () => {
    setLayout(emptyLayout());
  });
  // 出撃記録：配置と出撃（ティック・兵種・マス）を書き出し、読み込んで同じ戦いを再生する
  const recJson = $<HTMLTextAreaElement>('recJson');
  $('recOut').addEventListener('click', () => {
    if (!battle?.deployLog.length) {
      toast('まだ出撃していません');
      return;
    }
    const auto = !!autoRun && !autoRun.waitAfterPlan;
    recJson.value = JSON.stringify(makeRecord(battleLayout, battle, auto));
    toast('書き出しました');
  });
  $('recIn').addEventListener('click', () => {
    if (busy) return;
    let rec: BattleRecord | null = null;
    try {
      rec = parseRecord(JSON.parse(recJson.value));
    } catch {
      rec = null;
    }
    if (!rec) {
      toast('出撃記録を読み込めません');
      return;
    }
    newBattle(rec.layout);
    autoRun = { ...replayState(rec), label: '記録の再生', record: rec };
    showAutoNote(autoRun);
    updateHint();
    refreshBattlePanel();
  });
  const json = $<HTMLTextAreaElement>('json');
  $('jsonOut').addEventListener('click', () => {
    json.value = JSON.stringify(layout);
  });
  $('jsonIn').addEventListener('click', () => {
    let l: Layout | null = null;
    try {
      l = validate(JSON.parse(json.value));
    } catch {
      l = null;
    }
    if (!l) {
      toast('配置データを読み込めません（形式・範囲・個数を確認）');
      return;
    }
    setLayout(l);
    toast('読み込みました');
  });
  document.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement | null)?.tagName ?? '';
    if (tag === 'TEXTAREA' || tag === 'INPUT' || mode !== 'battle' || !battle) return;
    if (UNIT_KEYS.includes(e.key)) {
      unitSel = UNIT_ORDER[UNIT_KEYS.indexOf(e.key)];
      refreshBattlePanel();
    } else if (e.key === ' ' && tag !== 'BUTTON' && battle.started && !battle.over) {
      e.preventDefault();
      paused = !paused;
      refreshBattlePanel();
    }
  });

  // ---- 結果表示 -----------------------------------------------------------
  function showResult(b: Battle) {
    const st = b.stats;
    const win = b.result === 'win';
    const t = $('resTitle');
    t.textContent = win ? '落城' : '退却';
    t.className = win ? 'win' : 'lose';
    $('resSub').textContent = win
      ? `${fmt(b.endT)} で本丸を陥落させた`
      : b.result === 'timeout'
        ? '時間切れ。本丸は健在'
        : '全軍が壊滅。本丸は健在';
    $('resA').textContent = `出撃 ${st.spent} / ${BUDGET_A}　損耗 ${st.aLostCost}`;
    $('resB').textContent =
      `矢倉 ${st.tDown}/${st.tTotal} 破壊　守将 ${st.dKilled}/${st.gTotal} 討伐　城壁 ${st.wDown} 破壊`;
    const rec = autoRun?.record;
    $('resC').textContent = rec
      ? rec.result === null
        ? '記録は戦闘の途中までです'
        : sameOutcome(rec, b)
          ? '記録と同じ結果です'
          : '記録と結果が異なります（数値が変わった可能性があります）'
      : autoRun
        ? `作戦：${autoRun.label}`
        : '';
    $('overlay').hidden = false;
    updateHint();
    refreshBattlePanel();
  }

  // ---- 自動攻城 -----------------------------------------------------------
  function resetAutoUi() {
    $('autoNote').textContent = AUTO_NOTE;
    $('autoAttackBtn').textContent = AUTO_ATTACK_LABEL;
    $('manualBtn').hidden = true;
  }
  // ジェネレータを少しずつ進め、画面が固まらないようにする
  function runGen<P, R>(gen: Generator<P, R>, onProg: (p: P) => void, onDone: (r: R) => void) {
    const job = ++jobId;
    busy = true;
    const tick = () => {
      if (job !== jobId) return;
      const t0 = performance.now();
      let r: IteratorResult<P, R>;
      do {
        r = gen.next();
        if (!r.done) onProg(r.value);
      } while (!r.done && performance.now() - t0 < 30);
      if (r.done) {
        busy = false;
        onDone(r.value);
      } else setTimeout(tick, 0);
    };
    setTimeout(tick, 0);
  }
  function restart() {
    const prev = autoRun;
    newBattle(battleLayout);
    if (prev) {
      autoRun = { ...prev, i: 0 };
      showAutoNote(autoRun);
      updateHint();
      refreshBattlePanel();
    }
  }
  function showAutoNote(run: AutoRun) {
    const rec = run.record;
    if (rec) {
      $('autoNote').textContent =
        `記録を再生中：出撃 ${rec.deploys.length} 回（記録の結果：${resultText(rec.result, rec.endTick * DT)}）`;
      return;
    }
    const s = run.summary;
    if (!s) return;
    const out =
      s.result === 'win'
        ? `${fmt(s.endT)} で落城・損耗 ${s.lost}`
        : s.result === 'timeout'
          ? '時間切れ'
          : '本丸を落とせず撤退';
    $('autoNote').textContent = `作戦：${run.label}（先読み：${out}）`;
  }
  // filter なしなら全テンプレート×全出撃口、編成例ならその範囲で先読みする
  function startAutoAttack(filter: PlanFilter = {}) {
    if (busy || mode !== 'battle') return;
    newBattle();
    const b = $('autoAttackBtn');
    runGen(
      planAttack(layout, filter),
      (p) => {
        $('autoNote').textContent = `先読み中 ${p.done}/${p.total}`;
        if (filter.tpl === undefined) b.textContent = `先読み中 ${p.done}/${p.total}`;
        updateHint();
      },
      (res: AttackPlan) => {
        b.textContent = AUTO_ATTACK_LABEL;
        autoRun = { plan: res.plan, i: 0, label: res.label, summary: res.summary };
        showAutoNote(autoRun);
        updateHint();
        refreshBattlePanel();
      },
    );
    updateHint();
    refreshBattlePanel();
  }

  // ---- メインループ -------------------------------------------------------
  let last = performance.now();
  // 置いた武将のパネルのキャラを歩かせる
  const WALK: readonly Frame[] = ['walk0', 'walk1', 'walk2', 'walk3'];
  // 動きを減らす設定のときは、立ち姿のまま
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  function walkGenPix(now: number) {
    const frame = still.matches ? 'walk0' : WALK[Math.floor(now / 160) % WALK.length];
    for (const g of layout.generals) {
      const pix = genPix.get(g.kind);
      if (pix) drawGenPix(pix, g.kind, genColor, frame);
    }
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    genColor = defColor();
    refreshEditPanel();
  });
  function loop(now: number) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (mode === 'edit') walkGenPix(now);
    const b = battle;
    if (mode === 'battle' && b && (b.started || autoRun) && !b.over && !paused && !busy) {
      acc += dt * speed;
      let n = 0;
      while (acc >= DT && n < 40 && !b.over) {
        if (autoRun) autoStep(b, autoRun);
        else step(b);
        acc -= DT;
        n++;
      }
      if (n >= 40) acc = 0;
      renderLog();
      if (b.over && !resultShown) {
        resultShown = true;
        showResult(b);
      }
    }
    if (mode !== 'units') renderer.draw({ mode, layout, battle, hover, tool, unitSel, drag });
    // 出撃パネル（経過時間・残り兵力など）は少し間引いて更新する
    if (mode === 'battle' && now - panelAt > 120) {
      panelAt = now;
      refreshBattlePanel();
    }
    requestAnimationFrame(loop);
  }

  // ---- 起動 ---------------------------------------------------------------
  initCompare();
  genColor = defColor();
  buildEditTools();
  refreshEditPanel();
  updateHint();
  document.fonts?.load('800 20px "Shippori Mincho B1"', '歩弓騎車将猛謀櫓門本丸壁出撃エリア').catch(() => {});
  requestAnimationFrame(loop);
}
