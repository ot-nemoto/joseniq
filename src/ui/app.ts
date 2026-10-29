import {
  ADEF,
  type AttackerKind,
  type AutoState,
  addDeploys,
  addTroopAt,
  type Battle,
  BDEF,
  BUDGET_A,
  type BuildingType,
  bareLayout,
  basicSiege,
  canDeploy,
  canGateAt,
  clamp,
  countOf,
  createBattle,
  type Draft,
  DT,
  deploy,
  deployDue,
  draftToPlan,
  emptyDraft,
  fpOf,
  GDEF,
  GENERAL_ORDER,
  type GeneralKind,
  gateDir,
  generalsUsed,
  H,
  HALL,
  HALL_MARGIN,
  hallPos,
  heightAt,
  isAttackerKind,
  isBuildingType,
  isGeneralKind,
  isMapId,
  type Layout,
  LIMITS,
  MAPS,
  MAX_GENERALS,
  type MapId,
  makeTerrain,
  maxRowN,
  moveBuilding,
  nearestGate,
  notReady,
  occAt,
  type PlaceResult,
  type PlanStep,
  parseDeploys,
  parseDraft,
  place,
  preset,
  putGeneral,
  putGeneralAt,
  removeGeneral,
  removeGeneralFrom,
  removeRow,
  sanitizeDraft,
  step,
  TIME_LIMIT,
  type Tool,
  UNIT_ORDER,
  validate,
  W,
  ZONE,
} from '../sim';
import { initCompare, renderCompare } from './compare';
import { $ } from './dom';
import { blitUnit, type Frame } from './pixel';
import { createRenderer, type Drag, type Mode, type Tile } from './renderer';
import { initTooltips, setTip } from './tooltip';

const STORE_KEY = 'kozen-enbu-layout-v8'; // 42×42・本丸2×2・川
const SIEGE_KEY = 'kozen-enbu-siege-v2'; // 攻城配置（開戦前に決める武将の出撃の予定）
const GEN_DOTS = 30; // パネルの武将と兵のキャラの大きさ（ドット）
const LONG_PRESS = 400; // 施設をこの時間（ミリ秒）押し続けたら、つかんで動かす
const DRAG_SLOP = 6; // パネルのボタンを押してから、この距離（ピクセル）より動かしたらドラッグとして扱う
const PRESS_SLOP = 8; // 長押しの途中で、指がこの距離（ピクセル）までぶれても長押しを続ける

interface ToolInfo {
  name: string;
  cost?: number | string;
  g: string;
  s: 'a' | 'd' | 'n';
  pix?: HTMLCanvasElement; // 字の代わりに出す絵（武将と兵のキャラ・施設の絵）
  d: string;
  req?: boolean; // 必須の施設（名前の横に「必須」の印を出す）
  seal?: boolean; // 武将：名前を朱印にして出す
  stats?: string; // 兵：説明の枠の2行目に出す数値（体力・1撃・射程・速度）
}

const GENERAL_INFO: Record<(typeof GENERAL_ORDER)[number], string> = {
  brave: '周りもまとめて斬る',
  archer: '遠くから射る',
  sage: '範囲攻撃「火計」',
  spear: '間合いが長く騎馬に強い',
  rider: '速く、駆けた一撃が重い',
  gunner: '射程9・一撃が大きい',
  builder: '周りの建物を直す',
  ninja: '近づかないと見つからない',
  guard: '周りの味方の傷を減らす',
};
const EDIT_TOOLS: (ToolInfo & { id: BuildingType })[] = [
  { id: 'hall', name: '本丸', g: '城', s: 'd', d: '落とされたら負け', req: true },
  { id: 'wall', name: '城壁', g: '壁', s: 'd', d: '通行を阻む・壊せない' },
  { id: 'gate', name: '門', g: '門', s: 'd', d: '守将は通れる・攻め手は壊して通る', req: true },
  { id: 'moat', name: '堀', g: '堀', s: 'd', d: '外周3マス以内・敵は鈍る' },
  { id: 'bar', name: '拒馬', g: '拒', s: 'd', d: '騎兵を止める・他は鈍る' },
  { id: 'tbow', name: '弓櫓', g: '櫓', s: 'd', d: '射程6.5・連射' },
  { id: 'tgun', name: '鉄砲櫓', g: '砲', s: 'd', d: '射程9・高威力・遅い' },
  { id: 'cata', name: '大筒', g: '筒', s: 'd', d: '射程11・範囲・近くは撃てない' },
  { id: 'drum', name: '鼓楼', g: '鼓', s: 'd', d: '周囲の守将と櫓が速くなる' },
];
const UNIT_INFO: Record<AttackerKind, string> = {
  inf: '近接の基本兵',
  arc: '遠距離から射る',
  cav: '守将を優先して狙う',
  ram: '本丸を直接狙う',
  eng: '櫓・大筒・鼓楼を一気に壊す。城壁は壊せない',
  shd: '周りの兵の傷を代わりに受ける',
  scout: '足が速い囮。守将や櫓を引きつける',
  brave: '周囲をまとめて斬る',
  archer: '射程が長い',
  sage: '櫓を狙う範囲攻撃「火計」',
  spear: '間合いが長く騎馬に強い',
  rider: '守将を狙い、駆けた一撃が重い',
  gunner: '射程9・一撃が大きい',
  builder: '施設を狙い、周りの工兵を速くする',
  ninja: '見つかりにくく、当てた相手を止める',
  guard: '周りの味方の傷を減らす',
};
// 兵の数値（比較の画面と同じ呼び名）。説明の枠に出す
const statsLabel = (k: AttackerKind) => {
  const d = ADEF[k];
  return `体力 ${d.hp}・1撃 ${d.dmg}・射程 ${d.range.toFixed(1)}・速度 ${d.speed.toFixed(1)}`;
};
// 武将は兵力を使わず、1人ずつ・全体で MAX_GENERALS 人まで出撃できる。出撃したら札に「出撃済」と出す
// （上限の人数に達して出せない武将は、ボタンを薄くするだけで札は出さない）
const costLabel = (b: Battle | null, k: AttackerKind) => {
  const d = ADEF[k];
  if (!d.limit) return `兵力 ${d.cost}`;
  return b && (b.used[k] ?? 0) >= d.limit ? '出撃済' : '';
};

const fmt = (t: number) => {
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function startApp() {
  const cv = $<HTMLCanvasElement>('cv');
  const renderer = createRenderer(cv);

  let layout: Layout = loadLayout() || preset('flat');
  let mode: Mode = 'edit';
  // 居城の移転（地形を作り直す窓）を開いている間：元の配置（やめたら戻す）と、選んでいる地図の型。盤面には案を仮に出す
  let terr: { saved: Layout; map: MapId } | null = null;
  // 防衛で選んでいる道具（施設か武将）と、攻城で選んでいる兵種・武将。最初は何も選ばない（null）。選んだボタンをもう一度押すと外れる
  let tool: Tool | null = null;
  let unitSel: AttackerKind | null = null;
  let battle: Battle | null = null;
  let paused = false;
  let speed = 1;
  let acc = 0;
  let resultShown = false;
  let hover: Tile | null = null;
  let painting = false;
  let drag: Drag | null = null; // ドラッグで動かしている武将・施設
  // 施設の上で押し始めたところ。長押しになったら、その施設をつかむ
  let press: { x: number; y: number; cx: number; cy: number; timer: number } | null = null;
  // 何も選ばずに施設を押したところ。PRESS_SLOP より動かしたら、その施設をつかむ（押しただけでは動かさない）
  let grabFrom: { i: number; at: Tile; cx: number; cy: number } | null = null;
  // キーボードで選んでいるマス。kbdDrag はキーボードでつかんでいるとき、kbdFrom はつかみ始めた武将のボタン
  // 初めは本丸の左2マス（本丸は動かせるので、読み込んだ配置の本丸の位置から決める）
  const hall0 = hallPos(layout);
  let cursor: Tile = { x: hall0.x - 2, y: hall0.y };
  let kbdDrag = false;
  let kbdFrom: HTMLElement | null = null;
  // パネルの武将のキャラの色（防衛配置は守りの色、出撃は攻めの色）。起動時と、明暗の設定が変わったときに読む
  let genColor = '';
  let atkColor = '';
  const genPix = new Map<GeneralKind, HTMLCanvasElement>(); // 防衛配置のパネルの武将のキャラ
  let lastPaint = '';
  let panelAt = 0;
  let logLen = -1;
  let toastTimer = 0;
  // 攻城配置：武将と兵の出撃の予定。sched は開戦後に予定を出すもの、siegeDrag はパネルからドラッグしている武将・兵
  // 予定が保存されていなければ（初めて攻城を開いたとき）、編成例の「基本」を入れておく
  let siege: Draft = loadSiege() ?? basicSiege();
  // 手動で出した兵と武将（出撃記録を書き出すとき、予定にまとめる）。
  // 結果の枠を閉じるなどで次の戦いになっても、書き出す前に消えないよう残しておき（manualOld）、
  // 次の戦いで新しく手動で出したときか、予定を入れ替えたときに消す
  let manualLog: PlanStep[] = [];
  let manualOld = false;
  let sched: AutoState | null = null;
  let siegeDrag: AttackerKind | null = null;
  // 防衛配置で、パネルからドラッグしている施設
  let facDrag: BuildingType | null = null;

  // ---- 保存 ---------------------------------------------------------------
  // 保存した予定を読む
  function loadSiege(): Draft | null {
    try {
      const raw = localStorage.getItem(SIEGE_KEY);
      const d = raw ? parseDraft(JSON.parse(raw)) : null;
      return d ? sanitizeDraft(d) : null;
    } catch {
      return null;
    }
  }
  function saveSiege() {
    try {
      localStorage.setItem(SIEGE_KEY, JSON.stringify(siege));
    } catch {
      // 保存できなくても動作する
    }
  }
  function loadLayout(): Layout | null {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? validate(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }
  // 攻城を始められない理由（門の数・本丸への道）。道の確かめは盤面全体を調べるので、配置が変わったときだけやり直す
  let layoutRev = 0;
  let readyRev = -1;
  let readyWhy: string | null = null;
  function whyNotReady() {
    if (readyRev !== layoutRev) {
      readyWhy = notReady(layout);
      readyRev = layoutRev;
    }
    return readyWhy;
  }
  // 元に戻す・やり直す：配置を変えるたびに、変える前の配置（前に保存したときの JSON）を履歴に積む。
  // なぞって続けて置く・消すあいだ（painting）は、押してから離すまでを1回の操作として、最初の1回だけ積む
  const UNDO_MAX = 50;
  const undoStack: string[] = [];
  const redoStack: string[] = [];
  let savedJson = JSON.stringify(layout);
  let strokeSaved = false; // このなぞりで、もう履歴に積んだか
  function saveLayout() {
    layoutRev++;
    const json = JSON.stringify(layout);
    if (json !== savedJson) {
      if (!(painting && strokeSaved)) {
        undoStack.push(savedJson);
        if (undoStack.length > UNDO_MAX) undoStack.shift();
        redoStack.length = 0;
      }
      if (painting) strokeSaved = true;
      savedJson = json;
    }
    persist(json);
    refreshUndo();
  }
  function persist(json: string) {
    try {
      localStorage.setItem(STORE_KEY, json);
    } catch {
      // 保存できなくても動作する
    }
  }
  const sameArr = (a?: number[], b?: number[]) =>
    a === b || (!!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]));
  // 履歴から配置を戻す（from から取り出し、今の配置を to に積む）
  function stepHistory(from: string[], to: string[], done: string) {
    const json = from.pop();
    if (json === undefined) return;
    const l = validate(JSON.parse(json));
    if (!l) {
      refreshUndo();
      return;
    }
    // キーボードでつかんでいる途中なら、Esc と同じくやめて、つかみ始めたボタンへ戻す
    const kbd = kbdDrag;
    const back = kbdFrom;
    endPaint();
    back?.focus();
    to.push(savedJson);
    // 地形が変わらないなら、今の配列をそのまま使う（盤面の立体や地面の絵を作り直さないため）
    for (const k of ['heights', 'water', 'bridge'] as const) if (sameArr(l[k], layout[k])) l[k] = layout[k];
    layout = l;
    savedJson = json;
    layoutRev++;
    persist(json);
    refreshEditPanel();
    refreshUndo();
    say(kbd ? `つかむのをやめて、${done}` : done);
  }
  const undo = () => stepHistory(undoStack, redoStack, '元に戻しました');
  const redo = () => stepHistory(redoStack, undoStack, 'やり直しました');
  function refreshUndo() {
    $<HTMLButtonElement>('undoBtn').disabled = !undoStack.length;
    $<HTMLButtonElement>('redoBtn').disabled = !redoStack.length;
  }
  // 配置を丸ごと入れ替える（編成例・全消去・読み込み・居城の移転）。
  // 城を丸ごと入れ替えたとき（fresh：編成例・読み込み・居城の移転）は、地形が同じでも新しい城として、
  // 元に戻す・やり直すの履歴を終える（前の城には戻せない）。全消去は戻せる
  function setLayout(l: Layout, fresh = false) {
    layout = l;
    saveLayout();
    if (fresh) {
      undoStack.length = 0;
      redoStack.length = 0;
      refreshUndo();
    }
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
  function makeTool(info: ToolInfo, pressed: boolean, onClick: (e: MouseEvent) => void) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tool';
    b.setAttribute('aria-pressed', String(pressed));
    // 武将の名前は朱印にする。2列で右の列から縦に読み、1列の字数（--rows）が多いときは字を縦につぶして正方形に収める。
    // 印は1字ずつ区切って読まれないよう読み上げから外し、名前は見えない文字でまとめて持つ
    const cs = [...info.name];
    const name = info.seal
      ? `<span class="sr">${info.name}</span><b class="seal" aria-hidden="true" style="--rows:${Math.max(2, Math.ceil(cs.length / 2))}">${cs.map((c) => `<i>${c}</i>`).join('')}</b>`
      : `<b>${info.name}${info.req ? '<em class="req">必須</em>' : ''}</b>`;
    b.innerHTML =
      (info.pix ? '' : `<span class="glyph ${info.s}">${info.g}</span>`) +
      `<span class="nm">${name}<span class="cnt">${info.cost ?? ''}</span></span>`;
    // 説明は、ボタンには出さず、マウスを合わせたときに出す。武将は印だけでは読みにくいので、説明の枠の頭に名前を出す。
    // 兵は、次の行に数値を出す
    // （読み上げはボタンの名前で名前を読むので、説明だけにする）
    if (info.stats) setTip(b, `${info.name}：${info.d}\n${info.stats}`, `${info.d}。${info.stats}`);
    else setTip(b, info.seal ? `${info.name}：${info.d}` : info.d, info.d);
    if (info.pix) b.prepend(info.pix);
    b.addEventListener('click', onClick);
    return b;
  }
  // 施設と武将は、攻城の兵・武将と同じく、選んでから盤面を押すか、パネルから盤面へドラッグして置く。
  // 押してから DRAG_SLOP より動かしたらドラッグ、動かさずに離したら選ぶ（もう一度押すと外す）。置いた武将を押すと外す
  function buildEditTools() {
    $('toolgrid').textContent = '';
    $('genEditGrid').textContent = '';
    for (const t of EDIT_TOOLS) {
      // 施設は、字の代わりに盤面と同じ絵を出す
      const pix = makeFacilityPix(t.id);
      const b = makeTool({ ...t, pix }, t.id === tool, () => {
        // ドラッグして置いた直後のクリックは無視する（道具の選び方を変えない）
        if (b.dataset.dragged) {
          delete b.dataset.dragged;
          return;
        }
        tool = tool === t.id ? null : t.id;
        refreshEditPanel();
        updateHint();
      });
      b.dataset.tool = t.id;
      addFacilityDrag(b, t.id);
      $('toolgrid').appendChild(b);
    }
    for (const k of GENERAL_ORDER) {
      // ボタンには武将の名前、説明には特徴。字の代わりにキャラを出す
      const pix = makeUnitPix();
      const b = makeTool({ name: GDEF[k].busho, g: '', s: 'd', d: GENERAL_INFO[k], pix, seal: true }, false, (e) => {
        // ドラッグして置いた直後のクリックは無視する（置いてすぐ外れないように）
        if (b.dataset.dragged) delete b.dataset.dragged;
        else if (countOf(layout, k)) unplaceGeneral(k);
        // キーボード（Enter・スペース）で押したときは、盤面で置く場所を選ぶ
        else if (e.detail === 0) placeByKeyboard(k, b);
        // マウスで押したときは、武将を選ぶ（もう一度押すと外す）。選んでいる間は、盤面を押したマスに置く
        else {
          tool = tool === k ? null : k;
          refreshEditPanel();
          updateHint();
        }
      });
      b.dataset.gen = k;
      b.querySelector('.cnt')?.remove();
      genPix.set(k, pix);
      // 置いていない武将は、ボタンをつかんで盤面へドラッグする（左ボタン・タッチ・ペンのとき）
      addPanelDrag(b, {
        canGrab: () => !countOf(layout, k),
        active: () => draggingGen(k),
        begin: () => {
          drag = { k: 'g', kind: k };
          drawUnitPix(dragFloat, k, genColor);
        },
        move: dragMove,
        drop,
      });
      $('genEditGrid').appendChild(b);
    }
  }
  // 字のアイコンの代わりに置く、施設の絵の canvas。配色が変わったら描き直せるよう、施設の種類を持たせる
  function makeFacilityPix(type: BuildingType) {
    const pix = document.createElement('canvas');
    pix.className = 'fpix';
    // ドット絵ではないので、倍率は丸めずに合わせる（125% などでぼやけないように）
    pix.width = pix.height = Math.round(34 * Math.min(window.devicePixelRatio || 1, 2));
    pix.dataset.facility = type;
    pix.setAttribute('aria-hidden', 'true');
    renderer.drawIcon(pix, type);
    return pix;
  }
  // 字のアイコンの代わりに置く、武将と兵のキャラの canvas
  function makeUnitPix() {
    const pix = document.createElement('canvas');
    pix.className = 'gpix';
    pix.width = pix.height = GEN_DOTS * Math.min(Math.round(window.devicePixelRatio || 1), 2);
    pix.setAttribute('aria-hidden', 'true');
    return pix;
  }
  // キャラを描く。武将（兵）・色・コマのどれかが変わったときだけ描き直す
  function drawUnitPix(cv: HTMLCanvasElement, k: AttackerKind, color: string, frame: Frame = 'walk0') {
    const key = `${k}|${color}|${frame}`;
    if (cv.dataset.key === key) return;
    cv.dataset.key = key;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const dot = cv.width / GEN_DOTS;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    blitUnit(ctx, k, frame, color, 13 * dot, 29 * dot, dot, 1);
  }
  const readGenColors = () => {
    const st = getComputedStyle(document.documentElement);
    genColor = st.getPropertyValue('--def').trim();
    atkColor = st.getPropertyValue('--atk').trim();
  };
  // 兵と武将は別の区分に並べる
  function buildUnitTools() {
    $('unitgrid').textContent = '';
    $('genUnitGrid').textContent = '';
    for (const k of UNIT_ORDER) {
      const d = ADEF[k];
      const g = $(d.general ? 'genUnitGrid' : 'unitgrid');
      // 武将も兵も、字の代わりにキャラを出す（攻めの色）
      const pix = makeUnitPix();
      drawUnitPix(pix, k, atkColor);
      const b = makeTool(
        {
          name: d.busho ?? d.name,
          cost: costLabel(battle, k),
          g: d.glyph,
          s: 'a',
          d: UNIT_INFO[k],
          pix,
          seal: !!d.busho,
          stats: d.general ? undefined : statsLabel(k),
        },
        k === unitSel,
        () => {
          // ドラッグして予定に入れた直後のクリックは無視する
          if (b.dataset.dragged) {
            delete b.dataset.dragged;
            return;
          }
          // 開戦前に、予定に入れた武将を押すと外す（防御側と同じ）
          // 選んでいた武将なら、選ぶのもやめる（外したあとに、押したマスへまた入らないように）
          if (isGeneralKind(k) && isPre() && siegeRow(k)) {
            removeGeneralFrom(siege, k);
            if (unitSel === k) unitSel = null;
            siegeChanged();
            return;
          }
          unitSel = unitSel === k ? null : k;
          refreshBattlePanel();
        },
      );
      b.dataset.unit = k;
      addSiegeDrag(b, k);
      g.appendChild(b);
    }
  }
  // 開戦前：そのマスに予定として入れられるか（兵力・武将の人数も含めて）。影の表示に使う
  function canPlan(k: AttackerKind, x: number, y: number) {
    if (!canGateAt(layout, x, y)) return false;
    const d = structuredClone(siege);
    return (isGeneralKind(k) ? putGeneralAt(d, k, x, y) : addTroopAt(d, k, x, y)).ok;
  }
  // 開戦前：武将・兵を、外周のマスの出撃の予定に入れる（パネルからドラッグしたときと、選んで盤面を押したとき）
  function planAt(k: AttackerKind, p: Tile) {
    if (!canGateAt(layout, p.x, p.y)) {
      toast('出撃口は、まわりの2マスまで平地が続く所に置きます');
      return;
    }
    const r = isGeneralKind(k) ? putGeneralAt(siege, k, p.x, p.y) : addTroopAt(siege, k, p.x, p.y);
    if (!r.ok) {
      toast(r.msg);
      return;
    }
    // 武将は1人1行なので、予定に入れたら選ぶのをやめる（防衛の武将を置いたときと同じ）
    if (isGeneralKind(k) && unitSel === k) unitSel = null;
    siegeChanged();
    // 兵は数などを決めるので、置いた口のリストを開く
    if (!isGeneralKind(k)) showGatePop(siege.gates.findIndex((g) => g.x === p.x && g.y === p.y));
  }
  // パネルのボタンをつかんで盤面へドラッグする（施設・防衛の武将・攻城の兵と武将で共通）。
  // 押してから DRAG_SLOP より動かしたら begin でドラッグを始め、離したら drop で置く。動かさずに離したら、ボタンの click で選ぶ。
  // ドラッグしたボタンには印（dragged）を付け、直後の click を無視できるようにする。押せないボタンはつかまない
  function addPanelDrag(
    b: HTMLButtonElement,
    o: {
      canGrab: () => boolean; // 押せるボタンのうち、つかめるか
      active: () => boolean; // このボタンからドラッグしている最中か
      begin: () => void;
      move: (e: PointerEvent) => void;
      drop: (e: PointerEvent) => void;
    },
  ) {
    let start: { x: number; y: number } | null = null;
    b.addEventListener('pointerdown', (e) => {
      // 前のドラッグの印は、クリックが来なかったときに残るので、押し始めのたびに消す
      delete b.dataset.dragged;
      if (e.button !== 0 || b.disabled || !o.canGrab()) return;
      start = { x: e.clientX, y: e.clientY };
      try {
        b.setPointerCapture(e.pointerId);
      } catch {
        // 無視
      }
    });
    b.addEventListener('pointermove', (e) => {
      if (!start) return;
      if (!o.active()) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_SLOP) return;
        o.begin();
        b.dataset.dragged = '1';
        // つかんでいる間は、どこでもつかんだ形のカーソルにする（endPaint で戻す）
        document.documentElement.classList.add('grabbing');
      }
      o.move(e);
    });
    b.addEventListener('pointerup', (e) => {
      const on = !!start && o.active();
      start = null;
      if (on) o.drop(e);
    });
    b.addEventListener('pointercancel', () => {
      start = null;
      endPaint();
    });
  }
  // 盤面の外では、指の位置に絵を出す（盤面の上では、置くマスに影を出す）
  function floatMove(e: PointerEvent) {
    hover = tileAt(e);
    dragFloat.hidden = !!hover;
    dragFloat.style.left = `${e.clientX}px`;
    dragFloat.style.top = `${e.clientY}px`;
  }
  // 施設のボタンをつかんで盤面へドラッグし、離したマスに1つ置く（本丸は左上のマス）。選んでいる道具は変えない
  function addFacilityDrag(b: HTMLButtonElement, type: BuildingType) {
    addPanelDrag(b, {
      canGrab: () => true,
      active: () => facDrag === type,
      begin: () => {
        endPaint();
        facDrag = type;
        renderer.drawIcon(dragFloat, type);
        // キャラの絵の覚え（drawUnitPix）を消し、次に武将や兵をドラッグしたときに描き直させる
        delete dragFloat.dataset.key;
        dragFloat.classList.add('fac');
      },
      move: floatMove,
      drop: (e) => {
        const p = tileAt(e);
        endPaint();
        if (!p || mode !== 'edit' || terr) return;
        const r = place(layout, type, p.x, p.y);
        if (r.ok) {
          saveLayout();
          refreshEditPanel();
        } else toast(r.msg || '他の配置と重なります');
      },
    });
  }
  // 兵のボタンや武将のボタンをつかんで外周へドラッグすると、開戦前は出撃の予定に入り、開戦後はそのマスにすぐ出る。
  // 開戦前に予定に入れた武将は、ドラッグしない（押すと外す）
  function addSiegeDrag(b: HTMLButtonElement, k: AttackerKind) {
    addPanelDrag(b, {
      // つかめるのは、ドラッグできる印（drag）があるときだけ（refreshBattlePanel が付ける）
      canGrab: () => b.classList.contains('drag'),
      active: () => siegeDrag === k,
      begin: () => {
        siegeDrag = k;
        drawUnitPix(dragFloat, k, atkColor);
        hideGatePop();
      },
      move: floatMove,
      drop: (e) => {
        const p = tileAt(e);
        endPaint();
        // ドラッグの途中で戦いが終わっていたら、何もしない
        if (!p || !battle || battle.over) return;
        if (isPre()) planAt(k, p);
        else deployNow(k, p);
      },
    });
  }

  function refreshEditPanel() {
    $('eraseBtn').setAttribute('aria-pressed', String(tool === 'erase'));
    $('mapName').textContent = MAPS.find((m) => m.id === (layout.map ?? 'flat'))?.name ?? '';
    // 全消去は、消すもの（施設か武将）があるときだけ押せる（攻城配置の全消去と同じ）
    $<HTMLButtonElement>('clearBtn').disabled = !layout.buildings.length && !layout.generals.length;
    // 攻城を始められない理由（門の数・本丸への道）を出す
    const why = whyNotReady();
    $('editReady').textContent = why ?? '';
    $('editReady').hidden = !why;
    $('genEditCount').textContent = `${layout.generals.length} / ${MAX_GENERALS}`;
    const full = layout.generals.length >= MAX_GENERALS;
    for (const b of $('panelEdit').querySelectorAll<HTMLButtonElement>('.tool')) {
      const k = b.dataset.gen;
      if (k && isGeneralKind(k)) {
        // 置いた武将は赤枠（キャラは歩く）。MAX_GENERALS 人置いたら、残りの武将は押せない
        const placed = countOf(layout, k) > 0;
        b.setAttribute('aria-pressed', String(placed));
        b.disabled = !placed && full;
        // 選んでいた武将が置かれたら（ドラッグ・編成例・読み込み・↶など）か、置けなくなったら（ほかの武将で上限に達したら）、選ぶのをやめる
        if ((placed || b.disabled) && tool === k) tool = null;
        // 選んでいる武将（盤面を押すと置く）は、施設の道具と同じ黒い枠
        b.classList.toggle('sel', tool === k);
        const pix = b.querySelector<HTMLCanvasElement>('.gpix');
        if (pix && !placed) drawUnitPix(pix, k, genColor);
        continue;
      }
      const t = EDIT_TOOLS.find((x) => x.id === b.dataset.tool);
      if (!t) continue;
      const id = t.id;
      const lim = LIMITS[id];
      const used = countOf(layout, id);
      // 選んでいる施設が上限に達したら（盤面を押して置いたときなど）、選ぶのをやめる（武将を置いたときと同じ）
      if (lim && used >= lim && tool === id) tool = null;
      b.setAttribute('aria-pressed', String(id === tool));
      const sp = b.querySelector('.cnt');
      // スラッシュの両側は細い空白にする（3列の狭いボタンに収めるため）
      if (sp) sp.textContent = lim ? `${used} / ${lim}` : '';
      // 必須の施設は、置き終えるまで印を目立たせる
      b.querySelector('.req')?.classList.toggle('met', used >= lim);
      // 上限に達したら押せなくする
      b.disabled = !!lim && used >= lim;
    }
  }
  function refreshBattlePanel() {
    if (!battle) return;
    $('timeText').textContent = `${fmt(battle.t)} / ${fmt(TIME_LIMIT)}`;
    // 残り兵力は、まだ出ていない予定の兵の分を引いて出す
    const left = battle.budgetA - pendingCost();
    $('budLeft').textContent = `${left} / ${BUDGET_A}`;
    // 使った兵力：出した分（予定・手動）と、まだ出ていない予定の分。残り兵力と同じく、時間を過ぎて出る予定は数えない
    $('siegeCost').textContent = `${BUDGET_A - left} / ${BUDGET_A}`;
    $('budBar').style.width = `${(Math.max(0, left) / BUDGET_A) * 100}%`;
    const gens = genCount();
    $('genUnitCount').textContent = `${gens} / ${MAX_GENERALS}`;
    const pre = isPre();
    for (const b of $('panelBattle').querySelectorAll<HTMLButtonElement>('.tool')) {
      const k = b.dataset.unit as AttackerKind;
      // 予定の行（武将だけ。兵は同じ兵種を何行でも置けるので、ボタンには出さない）
      const row = ADEF[k].general ? planned(k) : null;
      const used = (battle.used[k] ?? 0) > 0;
      // 選んでいた武将が出撃したら（予定の秒数で出たときも）、選ぶのをやめる
      if (ADEF[k].general && used && unitSel === k) {
        unitSel = null;
        updateHint();
      }
      b.setAttribute('aria-pressed', String(k === unitSel));
      // 予定で出る武将か。開戦後は、戦いの時間内に出る予定だけ（時間外の予定の武将は、手動で出せる）
      // 戦いが終わったら、もう出ないので予定の武将として扱わない
      const due = !!row && !battle.over && (pre || pendingPlan().some((p) => p.kind === k));
      b.classList.toggle('sched', due && !used);
      // 出撃済の武将は押せないが、薄くしない（札で出撃済と分かる）
      b.classList.toggle('out', !!ADEF[k].general && used);
      if (ADEF[k].general) {
        // 開戦前：予定の武将は押すと外せる。ほかの武将は、予定と合わせて上限まで
        // 開戦後：予定の武将は自分では出せない（予定の秒数で出る）
        b.disabled = pre ? !row && gens >= MAX_GENERALS : due || !canDeploy(battle, k) || gens >= MAX_GENERALS;
        b.disabled ||= battle.over;
      } else {
        // 兵は、予定の分を残して兵力が足りるときだけ（予定に入れるときも、手動で出すときも）
        b.disabled = !canDeploy(battle, k) || left < ADEF[k].cost || battle.over;
      }
      // つかんでドラッグできるのは、開戦前は予定に入れられるとき（予定に入れた武将は除く）、開戦後は今出せるとき
      b.classList.toggle(
        'drag',
        pre ? !row && !b.disabled : !b.disabled && canDeploy(battle, k) && manualBlock(k) === null,
      );
      // 選んでいる兵種・武将は、押して外せるよう押せるままにする
      if (k === unitSel) b.disabled = false;
      const sp = b.querySelector('.cnt');
      if (sp) sp.textContent = costLabel(battle, k);
    }
    $('startBtn').hidden = !pre;
    // 防衛の配置が決まりを満たさなければ、開戦できない（理由と、直す場所を出す）
    const why = whyNotReady();
    $<HTMLButtonElement>('startBtn').disabled = !!why;
    $('battleReady').textContent = why && pre ? `${why}。防衛配置で直すと開戦できます` : '';
    $('battleReady').hidden = !(why && pre);
    $<HTMLButtonElement>('siegeClear').disabled = !siege.rows.length;
    if (!pre) hideGatePop();
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
    if (terr)
      h.textContent =
        '型を押すと、地形の案を盤面に出します（同じ型をもう一度押すと、別の案になります）。盤面はドラッグで動かし、右ドラッグかShift＋ドラッグで回せます。気に入ったら「決める」、元の地形に戻すなら「やめる」を押します。';
    else if (mode === 'edit') {
      h.textContent = `城域（点線の内側・${ZONE.x1 - ZONE.x0 + 1}×${ZONE.y1 - ZONE.y0 + 1}マス）に配置します。施設と武将は、パネルで選んでから盤面を押すか、パネルから盤面へドラッグして置きます（選んだものをもう一度押すと外れます）。何も選んでいないときは、施設や武将にマウスを合わせると情報が出ます。種別ごとに置ける数の上限があります。堀は外周3マス以内だけです。城壁・堀と消去は、なぞると続けて置ける・消せます。本丸（${HALL.w}×${HALL.h}）は門と同じく必須で、ほかの施設と同じく置く・消す・動かすことができます（盤面の端から${HALL_MARGIN}マス以上内側）。川の上には何も置けません。地形は「居城の移転」で、新しい土地の案を盤面で確かめてから決めます（決めると、置いたものはすべて消えます）。置いた施設は、何も選んでいないときはドラッグで、道具を選んでいるときは長押ししてから動かします。置いた武将は盤面でドラッグして動かし、パネルの武将（赤枠）を押すと外せます。置く・消すなどの操作は、↶（Ctrl＋Z）で元に戻し、↷（Ctrl＋Y）でやり直せます。薄い円は、敵を見つける範囲です。キーボードでは、盤面を選んで矢印キー（Shiftで5マス）でマスを動かし、Enterで置く・つかむ・離す、Deleteで消す、Escでやめます。武将はパネルのボタンでEnterを押すと、盤面で置く場所を選べます。`;
    } else if (battle?.over) h.textContent = '';
    else if (battle && !battle.started)
      h.textContent =
        '武将と兵はパネルから外周の青いマスへドラッグして、出撃の予定に入れます（同じマスに重ねられます）。マスにマウスを合わせると予定のリストが出て、兵は数・開始（秒）・間隔（秒）、武将は開始（秒）を変えられます。編成例の「基本」で、作戦の見本を置けます。兵種を選んで外周の青いマスを押しても、予定に入れられます（選んだ兵種をもう一度押すと外れます。何も選んでいないときは、施設や武将にマウスを合わせると情報が出ます）。「開戦」で始まり、予定は開戦からの秒数で出撃します。開戦したあとは、兵種を外周へドラッグするか、兵種を選んで外周を押すと、すぐに出せます。スペースで一時停止。';
    else
      h.textContent =
        '出撃のタイミングは自由です。兵種を外周へドラッグするか、兵種を選んで外周を押すと、外周のどこからでも投入できます。何も選んでいないときは、施設や武将にマウスを合わせると情報が出ます。';
  }

  // ---- モード切替 ---------------------------------------------------------
  function setMode(m: Mode) {
    mode = m;
    // 居城の移転の窓を開いたままなら、やめて元の地形に戻す（mode を先に入れ、ほかの画面ではフォーカスを動かさない）
    closeTerrain(false);
    // 盤面をキーボードで操作できるのは配置画面だけなので、ほかの画面ではTabで止まらないようにする
    cv.tabIndex = m === 'edit' ? 0 : -1;
    endPaint(); // ドラッグやなぞりの途中なら後始末する（指の位置のキャラも消す）
    hideGatePop(); // 口の予定のリストは攻城だけのもの（開いたままだと、ほかの画面で情報の窓が出なくなる）
    $('tabUnits').setAttribute('aria-selected', String(m === 'units'));
    $('layoutMain').hidden = m === 'units';
    $('unitsView').hidden = m !== 'units';
    $('tabEdit').setAttribute('aria-selected', String(m === 'edit'));
    $('tabBattle').setAttribute('aria-selected', String(m === 'battle'));
    $('panelEdit').hidden = m !== 'edit';
    $('presetBar').hidden = m !== 'edit';
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
  // 攻城配置の口のうち、今の地形で出撃口にできない所（口のマスか、兵をずらして出す先が平地でない・川）にあるものは、
  // いちばん近い出撃口にできるマスへ動かす
  function snapGates() {
    let moved = false;
    const used = new Set(siege.gates.filter((g) => canGateAt(layout, g.x, g.y)).map((g) => `${g.x},${g.y}`));
    for (const g of siege.gates) {
      if (canGateAt(layout, g.x, g.y)) continue;
      // ほかの口と重ならない、いちばん近いマス
      const p = nearestGate(layout, g.x, g.y, (x, y) => used.has(`${x},${y}`));
      if (!p) continue;
      g.x = p.x;
      g.y = p.y;
      used.add(`${p.x},${p.y}`);
      moved = true;
    }
    if (moved) saveSiege();
  }
  function newBattle() {
    endPaint(); // パネルからドラッグしている途中なら片付ける
    snapGates();
    battle = createBattle(layout);
    manualOld = true;
    paused = false;
    acc = 0;
    resultShown = false;
    logLen = -1;
    resetSched();
    hideGatePop();
    $('overlay').hidden = true;
    buildUnitTools();
    refreshBattlePanel();
    renderLog();
    updateHint();
  }

  // ---- 攻城配置 -----------------------------------------------------------
  // 開戦前か
  function isPre() {
    return !!battle && !battle.started && !battle.over;
  }
  const siegeRow = (k: AttackerKind) => siege.rows.find((r) => r.kind === k) ?? null;
  // この戦いで使う予定の行（開戦前か、予定を流している戦いのとき）
  const planned = (k: AttackerKind) => (isPre() || sched ? siegeRow(k) : null);
  // 武将の人数：出撃した武将と、まだ出ていない予定の武将を合わせて数える。
  // 手動で先に出した武将の予定と、開戦後に戦いの時間内に出ない予定は数えない
  function genCount() {
    if (!battle) return 0;
    const b = battle;
    const rest = b.started ? pendingPlan() : (sched?.plan ?? []);
    const pending = rest.filter((p) => ADEF[p.kind].general && !(b.used[p.kind] ?? 0)).length;
    return generalsUsed(b) + pending;
  }
  // まだ出ていない予定のうち、戦いの時間内に出るもの（時間を過ぎて出る予定は、出ることがないので数えない）
  function pendingPlan() {
    if (!sched) return [];
    const end = Math.round(TIME_LIMIT / DT);
    return sched.plan.slice(sched.i).filter((p) => p.tick <= end);
  }
  // まだ出ていない予定の兵が使う兵力
  function pendingCost() {
    return pendingPlan().reduce((n, p) => n + ADEF[p.kind].cost, 0);
  }
  // 手動で出せない理由（予定と合わせた兵力・武将の上限など）。出せるなら null
  function manualBlock(k: AttackerKind): string | null {
    if (!battle) return '';
    const d = ADEF[k];
    if (!isGeneralKind(k)) return battle.budgetA - pendingCost() < d.cost ? '予定と合わせると兵力が足りません' : null;
    // 武将：出撃したあとは、予定に入っていても「出撃済み」と知らせる（予定の止めより先に見る）
    if ((battle.used[k] ?? 0) > 0) return `${d.busho ?? d.name}はすでに出撃しています`;
    // 同じ武将は予定と手動で2人出せない。兵は、予定の分の兵力を残せば同じ兵種でも手動で出せる
    // 戦いの時間を過ぎて出る予定の武将は、予定では出ないので手動で出せる
    if (pendingPlan().some((p) => p.kind === k)) return `${d.busho ?? d.name}は出撃の予定に入っています`;
    if (genCount() >= MAX_GENERALS) return `武将は予定と合わせて${MAX_GENERALS}人までです`;
    return null;
  }
  // 予定を、開戦からの秒数で出す出撃の並びに直す
  function resetSched() {
    sched = siege.rows.length ? { plan: draftToPlan(siege), i: 0, waitAfterPlan: true } : null;
  }
  function siegeChanged() {
    saveSiege();
    resetSched();
    refreshBattlePanel();
    // 開いているリストも作り直す
    const gi = popGate;
    hideGatePop();
    if (gi >= 0 && siege.gates[gi]) showGatePop(gi);
  }
  // 口にマウスを合わせると出る、出撃の予定のリスト
  const pop = $('gatePop');
  let popGate = -1;
  let popTimer = 0;
  function gatePopAt(p: Tile | null) {
    const gi = p && isPre() && !siegeDrag ? siege.gates.findIndex((g) => g.x === p.x && g.y === p.y) : -1;
    if (gi >= 0) showGatePop(gi);
    else if (!pop.hidden) hideGatePopSoon();
  }
  function showGatePop(gi: number) {
    clearTimeout(popTimer);
    if (gi === popGate && !pop.hidden) return;
    popGate = gi;
    const g = siege.gates[gi];
    pop.textContent = '';
    const h = document.createElement('h4');
    h.textContent = `口（${gateDir(g)}）から出撃する予定`;
    const ul = document.createElement('ul');
    for (const r of siege.rows.filter((q) => q.gate === gi)) {
      const li = document.createElement('li');
      const name = document.createElement('b');
      name.textContent = ADEF[r.kind].busho ?? ADEF[r.kind].name;
      const t0 = popField(
        '開始（秒）',
        () => r.t0,
        0.1,
        () => TIME_LIMIT,
        (v) => {
          r.t0 = v;
        },
      );
      if (ADEF[r.kind].general) li.append(name, t0);
      else {
        // 兵：数・開始秒・間隔と、外すボタン
        li.className = 'troop';
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'iconBtn';
        del.textContent = '×';
        del.setAttribute('aria-label', `${name.textContent}の行を外す`);
        del.addEventListener('click', () => {
          removeRow(siege, siege.rows.indexOf(r));
          siegeChanged();
        });
        const n = popField(
          '数',
          () => r.n,
          1,
          () => maxRowN(siege, siege.rows.indexOf(r)),
          (v) => {
            r.n = Math.max(1, Math.round(v));
          },
        );
        const dt = popField(
          '間隔（秒）',
          () => r.dt,
          0.05,
          () => 10,
          (v) => {
            r.dt = v;
          },
        );
        const fields = document.createElement('div');
        fields.className = 'fields';
        fields.append(n, t0, dt);
        li.append(name, del, fields);
      }
      ul.append(li);
    }
    pop.append(h, ul);
    pop.hidden = false;
    placeNear(pop, g, 14);
  }
  // 窓（口の予定のリスト・情報の窓）をマスの近くに出す。上半分のマスなら下に、下半分のマスなら上に gap だけ離して出し、
  // 盤面の左右からはみ出さないようにする
  function placeNear(el: HTMLElement, t: Tile, gap: number) {
    const c = renderer.tileCenter(t.x, t.y);
    const wrap = $('wrap');
    const x = cv.offsetLeft + c.x;
    const y = cv.offsetTop + c.y;
    const w = el.offsetWidth;
    el.style.left = `${clamp(x - w / 2, 4, wrap.clientWidth - w - 4)}px`;
    el.style.top = `${c.y < cv.clientHeight / 2 ? y + gap : y - el.offsetHeight - gap}px`;
  }
  // リストの数の入力欄。0〜hi() に収める。上限を超えたら知らせる（数の上限は兵力で決まる）。get は予定に入っている値
  function popField(label: string, get: () => number, step: number, hi: () => number, set: (v: number) => void) {
    const lab = document.createElement('label');
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.inputMode = 'decimal';
    inp.min = '0';
    inp.step = String(step);
    inp.value = String(get());
    inp.addEventListener('input', () => {
      const v = Number(inp.value);
      if (inp.value === '' || !Number.isFinite(v)) return;
      const max = hi();
      if (v > max) toast(label === '数' ? `兵力が足りません（この行は ${max} まで）` : `${label}は ${max} までです`);
      set(clamp(v, 0, max));
      saveSiege();
      resetSched();
      refreshBattlePanel();
    });
    // 入力を終えたら、予定に入った値（範囲に収め、数は整数にした値）を欄にも出す
    inp.addEventListener('change', () => {
      if (inp.value === '' || !Number.isFinite(Number(inp.value))) inp.value = '0';
      inp.dispatchEvent(new Event('input'));
      inp.value = String(get());
    });
    lab.append(label, inp);
    return lab;
  }
  function hideGatePop() {
    clearTimeout(popTimer);
    pop.hidden = true;
    popGate = -1;
  }
  // ---- 施設・武将の情報 ---------------------------------------------------
  // 何も選んでいないときに、マウスを合わせた施設や武将の名前と能力を出す。戦闘中は今の体力も出す
  const info = $('infoPop');
  let infoKey = '';
  const num = (v: number, d = 0) => (Number.isInteger(v) ? String(v) : v.toFixed(d));
  // 能力の行（名前・値）。施設・武将に共通の項目を、持っているものだけ並べる。
  // 射程（大筒の撃てない近さも）・見つける範囲・効果の範囲は、マウスを合わせたときの円でわかるので出さない
  function statRows(d: { dmg?: number; aoe?: number; cd?: number }) {
    const rows: [string, string][] = [];
    const dmg = d.aoe ?? d.dmg;
    if (dmg) rows.push(['1撃', num(dmg)]);
    if (d.cd) rows.push(['間隔', `${num(d.cd, 1)}秒`]);
    return rows;
  }
  // マウスの下にあるもの。hp は戦闘中の今の体力
  // マウスの下のマスの情報。施設・武将があればその能力、高台なら高さも出す（平地の空きマスでは出さない）
  function infoAt(p: Tile): { title: string; hp: string; rows: [string, string][] } | null {
    const it = thingAt(p);
    const h = heightAt(layout, p.x, p.y);
    if (it) return h ? { ...it, rows: [...it.rows, ['高さ', `${h}段`]] } : it;
    return h ? { title: '高台', hp: '', rows: [['高さ', `${h}段`]] } : null;
  }
  function thingAt(p: Tile): { title: string; hp: string; rows: [string, string][] } | null {
    const hpOf = (hp: number, max: number, live: boolean) => (live ? `${Math.ceil(hp)} / ${max}` : String(max));
    const gen = (k: GeneralKind, hp: number | null) => ({
      title: GDEF[k].busho,
      hp: hpOf(hp ?? 0, GDEF[k].hp, hp !== null),
      rows: statRows(GDEF[k]),
    });
    const bld = (t: BuildingType, hp: number | null, max: number) => {
      const d = BDEF[t];
      const rows = statRows(d);
      // 鼓楼は攻撃しないので、効果を出す（効果の範囲は円でわかる）
      if (t === 'drum') rows.push(['効果', `守将と櫓の攻撃が ×${num(BDEF.drum.rate ?? 1, 1)} の速さ`]);
      return {
        title: d.name,
        hp: d.terrain || d.unbreakable ? '壊せない' : hpOf(hp ?? 0, max, hp !== null),
        rows,
      };
    };
    const cx = p.x + 0.5;
    const cy = p.y + 0.5;
    const b = mode === 'battle' ? battle : null;
    if (b) {
      const u = b.defenders.find((d) => d.hp > 0 && Math.hypot(d.x - cx, d.y - cy) < 0.75);
      if (u) return { ...gen(u.kind, u.hp), hp: hpOf(u.hp, u.maxHp, true) };
      const a = b.attackers.find((d) => d.hp > 0 && ADEF[d.kind].general && Math.hypot(d.x - cx, d.y - cy) < 0.75);
      if (a) {
        const d = ADEF[a.kind];
        // 攻め手の武将には射程の円を出さないので、射程はここに出す
        const rows = statRows(d);
        if (d.range) rows.push(['射程', `${num(d.range, 1)}マス`]);
        return { title: d.busho ?? d.name, hp: hpOf(a.hp, a.maxHp, true), rows };
      }
      const e = b.buildings.find((q) => q.hp > 0 && p.x >= q.x0 && p.x < q.x0 + q.w && p.y >= q.y0 && p.y < q.y0 + q.h);
      if (e) return bld(e.type, e.hp, e.maxHp);
      // 堀・拒馬は壊れないので、戦闘の施設の一覧ではなく配置から見る
    }
    const g = mode === 'edit' ? generalAt(p) : null;
    if (g) return gen(g.kind, null);
    const pb = layout.buildings.find((q) => {
      const f = fpOf(q);
      return p.x >= f.x0 && p.x < f.x0 + f.w && p.y >= f.y0 && p.y < f.y0 + f.h;
    });
    if (pb && (!b || BDEF[pb.type].terrain)) return bld(pb.type, null, BDEF[pb.type].hp);
    return null;
  }
  // 毎フレーム呼ぶ。中身が変わったときだけ書き直す
  function updateInfoPop() {
    const p = hover;
    const none = mode === 'edit' ? !tool && !drag && !facDrag : mode === 'battle' && !unitSel && !siegeDrag;
    const it = p && none && pop.hidden ? infoAt(p) : null;
    if (!it || !p) {
      info.hidden = true;
      infoKey = '';
      return;
    }
    // 表示の切り替えや画面の大きさで、同じマスでも窓の位置は変わるので、マスの画面上の位置も見る
    const c = renderer.tileCenter(p.x, p.y);
    const key = `${p.x},${p.y}|${it.title}|${it.hp}|${it.rows.join(';')}|${Math.round(c.x)},${Math.round(c.y)}`;
    if (key === infoKey) return;
    infoKey = key;
    info.textContent = '';
    const h = document.createElement('h4');
    h.textContent = it.title;
    const dl = document.createElement('dl');
    for (const [k, v] of it.hp ? [['体力', it.hp], ...it.rows] : it.rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      dl.append(dt, dd);
    }
    info.append(h, dl);
    info.hidden = false;
    placeNear(info, p, 18);
  }
  // マウスが口からリストへ移る間に消えないよう、少し待ってから消す。
  // リストの上にマウスがあるときや、開始（秒）を入力している途中は消さない
  let popHover = false;
  function hideGatePopSoon() {
    clearTimeout(popTimer);
    popTimer = window.setTimeout(() => {
      if (!popHover && !pop.contains(document.activeElement)) hideGatePop();
    }, 300);
  }
  pop.addEventListener('pointerenter', () => {
    popHover = true;
    clearTimeout(popTimer);
  });
  pop.addEventListener('pointerleave', () => {
    popHover = false;
    hideGatePopSoon();
  });
  // 入力を終えてリストの外へフォーカスが移ったら、消す
  pop.addEventListener('focusout', hideGatePopSoon);
  // 全消去：予定の武将と兵、口をすべて消す（防御の全消去と同じく、確かめずに消す）
  $('siegeClear').addEventListener('click', () => {
    setSiege(emptyDraft());
  });
  // 開戦：時計を動かし、予定の武将と兵を開戦からの秒数で出す
  $('startBtn').addEventListener('click', () => {
    if (!battle || !isPre() || whyNotReady()) return;
    battle.started = true;
    hideGatePop();
    refreshBattlePanel();
    updateHint();
  });

  // ---- 入力 ---------------------------------------------------------------
  const tileAt = (e: PointerEvent) => renderer.tileAt(e.clientX, e.clientY);
  function unplaceGeneral(k: GeneralKind) {
    removeGeneral(layout, k);
    saveLayout();
    refreshEditPanel();
  }
  function applyEdit(x: number, y: number) {
    if (!tool) return;
    const key = `${tool}${x},${y}`;
    if (key === lastPaint) return;
    lastPaint = key;
    const r = place(layout, tool, x, y);
    if (r.ok) {
      // 武将は1人ずつなので、置いたら選ぶのをやめる
      if (isGeneralKind(tool)) {
        tool = null;
        updateHint();
      }
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
  function startDrag(d: Drag, e: PointerEvent) {
    drag = d;
    if (d.k === 'g') drawUnitPix(dragFloat, d.kind, genColor);
    dragMove(e);
  }
  // パネルのボタンからマウスでドラッグしている武将か（キーボードでつかんでいるときは、マウスで横取りしない）
  const draggingGen = (k: GeneralKind) => !kbdDrag && drag?.k === 'g' && drag.kind === k;
  // 施設は盤面の外では何も出さない（離したら元の位置に戻る）
  function dragMove(e: PointerEvent) {
    hover = tileAt(e);
    dragFloat.hidden = !!hover || drag?.k !== 'g';
    dragFloat.style.left = `${e.clientX}px`;
    dragFloat.style.top = `${e.clientY}px`;
    updateCursor();
  }
  // つかんでいるものをマス p に置く（置いたものなら動かす）。同じマスのとき（押しただけのとき）は何もしない
  function dropAt(p: Tile | null): PlaceResult {
    const d = drag;
    if (!d || !p) return { ok: false, msg: '' };
    // 施設は、つかんだマスのずれを引いた所（施設の左上）へ置く
    const to = d.k === 'g' ? p : { x: p.x - d.ox, y: p.y - d.oy };
    const from = d.k === 'g' ? layout.generals.find((q) => q.kind === d.kind) : layout.buildings[d.i];
    if (from && from.x === to.x && from.y === to.y) return { ok: true };
    const r = d.k === 'g' ? putGeneral(layout, d.kind, to.x, to.y) : moveBuilding(layout, d.i, to.x, to.y);
    if (r.ok) {
      saveLayout();
      refreshEditPanel();
      return r;
    }
    // 城壁と堀の重なりは、なぞって置くときのために知らせを空にしているので、ここで埋める
    return { ok: false, msg: r.msg || '他の配置と重なります' };
  }
  // 離したマスに置く。置けないマスや盤面の外なら、元の位置のまま
  function drop(e: PointerEvent) {
    const r = dropAt(tileAt(e));
    if (!r.ok) toast(r.msg);
    endPaint();
  }
  const generalAt = (p: Tile | null) => (p && layout.generals.find((g) => g.x === p.x && g.y === p.y)) || null;
  // そのマスにある施設（2×2の本丸は4マスのどれでも）の番号。なければ -1
  const buildingAt = (p: Tile | null) => {
    const o = p && occAt(layout, p.x, p.y);
    return o && o.k === 'b' ? o.i : -1;
  };
  // i番目の施設を、マス p でつかむ。つかんだマスの、施設の左上からのずれも持つ
  const grabB = (i: number, p: Tile): Drag => {
    const b = layout.buildings[i];
    return { k: 'b', i, type: b.type, ox: p.x - b.x, oy: p.y - b.y };
  };
  // 編集中のカーソル：武将の上と、何も選んでいないときの施設の上では、つかめることを示す
  const updateCursor = () => {
    const can = generalAt(hover) || (!tool && buildingAt(hover) >= 0);
    cv.style.cursor = mode !== 'edit' ? '' : drag ? 'grabbing' : can ? 'grab' : '';
  };
  function cancelPress() {
    if (press) clearTimeout(press.timer);
    press = null;
  }
  // 配置画面では1本目の指（マウス）だけを見る。2本目の指で、つかむものやなぞりが入れ替わらないように
  const ignored = (e: PointerEvent) => mode === 'edit' && !e.isPrimary;
  // 右ボタン・中ボタンは盤面を回したり動かしたりするのに使う（renderer の Orbit）ので、配置の操作はしない
  const camButton = (e: PointerEvent) => e.button === 1 || e.button === 2;
  cv.addEventListener('pointerdown', (e) => {
    if (ignored(e) || camButton(e)) return;
    // 地形を作り直す窓を開いている間は、盤面は見るだけ（ドラッグで動かす）
    if (terr) {
      if (e.button === 0) renderer.orbitFrom(e);
      return;
    }
    if (kbdDrag) endPaint(); // キーボードでつかんでいる途中にマウスで押したら、キーボードの方はやめる
    const p = tileAt(e);
    hover = p;
    // 盤面の外は、押してドラッグすると盤面を動かす（Shift を押していれば回す）
    if (!p) {
      if (e.button === 0) renderer.orbitFrom(e);
      return;
    }
    if (mode === 'edit') {
      try {
        cv.setPointerCapture(e.pointerId);
      } catch {
        // 無視
      }
      // 武将のマスを押したら、どの道具を選んでいても武将をつかむ
      const g = generalAt(p);
      const bi = buildingAt(p);
      if (g) {
        if (e.button === 0) startDrag({ k: 'g', kind: g.kind }, e);
      } else if (!tool) {
        // 何も選んでいなければ、施設を押してドラッグすると動かせる。情報を見るつもりで押したときに
        // 少しずれて動かないよう、PRESS_SLOP より動かしてからつかむ（長押しは待たない）
        if (bi >= 0 && e.button === 0) grabFrom = { i: bi, at: p, cx: e.clientX, cy: e.clientY };
        // 空いているマスを押してドラッグすると、盤面を動かす（Shift を押していれば回す）
        else if (bi < 0 && e.button === 0) renderer.orbitFrom(e);
      } else if (bi >= 0 && tool !== 'erase' && e.button === 0) {
        // 施設の上で押したら、長押しでつかむ。その前に指が動いたら、なぞって置く（pointermove）
        cancelPress();
        press = {
          x: p.x,
          y: p.y,
          cx: e.clientX,
          cy: e.clientY,
          timer: window.setTimeout(() => {
            if (!press) return;
            // 押している間に配置が変わっていたら、今そのマスにある施設をつかむ
            const at = press;
            const i = buildingAt(at);
            press = null;
            if (i >= 0) startDrag(grabB(i, at), e);
          }, LONG_PRESS),
        };
      } else {
        painting = true;
        lastPaint = '';
        applyEdit(p.x, p.y);
      }
      updateCursor();
    } else if (battle) {
      // 何も選んでいなければ、ドラッグで盤面を動かす（マウスを合わせた施設や武将の情報は出す）
      if (!unitSel) {
        if (e.button === 0) renderer.orbitFrom(e);
        return;
      }
      // 開戦前は出さずに、選んでいる兵種・武将を押したマスの予定に入れる（「開戦」を押すまで始まらない）
      if (isPre()) {
        if (e.button === 0) planAt(unitSel, p);
        return;
      }
      deployNow(unitSel, p);
    }
  });
  // 開戦後：兵・武将を、そのマスにすぐ出す（外周を押したときと、パネルからドラッグしたとき）。
  // 予定の武将や、予定の分の兵力は残して出す
  function deployNow(k: AttackerKind, p: Tile) {
    if (!battle) return;
    const why = manualBlock(k);
    if (why !== null) {
      toast(why);
      return;
    }
    const r = deploy(battle, k, p.x, p.y);
    if (!r.ok) toast(r.msg);
    else {
      if (manualOld) manualLog = [];
      manualOld = false;
      manualLog.push({ tick: battle.tick, kind: k, x: p.x, y: p.y });
      // 武将は1回しか出せないので、出したら選ぶのをやめる
      if (isGeneralKind(k) && unitSel === k) unitSel = null;
      refreshBattlePanel();
      renderLog();
      updateHint();
    }
  }
  cv.addEventListener('pointermove', (e) => {
    if (ignored(e) || kbdDrag || renderer.busy) return;
    if (drag) {
      dragMove(e);
      return;
    }
    const p = tileAt(e);
    hover = p;
    if (mode === 'battle') gatePopAt(p);
    if (grabFrom) {
      if (Math.hypot(e.clientX - grabFrom.cx, e.clientY - grabFrom.cy) > PRESS_SLOP) {
        const { i, at } = grabFrom;
        grabFrom = null;
        startDrag(grabB(i, at), e);
      }
      return;
    }
    // 長押しの途中は、少しのぶれは待つ。大きく動いたら長押しをやめ、なぞって置く
    if (press) {
      if (Math.hypot(e.clientX - press.cx, e.clientY - press.cy) <= PRESS_SLOP) return;
      painting = true;
      lastPaint = `${tool}${press.x},${press.y}`; // 押し始めのマスは施設があるので、置いたことにして飛ばす
      cancelPress();
    }
    if (p && mode === 'edit' && painting && (tool === 'wall' || tool === 'moat' || tool === 'erase'))
      applyEdit(p.x, p.y);
    updateCursor();
  });
  function endPaint() {
    cancelPress();
    grabFrom = null;
    painting = false;
    strokeSaved = false;
    lastPaint = '';
    drag = null;
    kbdDrag = false;
    kbdFrom = null;
    siegeDrag = null;
    facDrag = null;
    dragFloat.hidden = true;
    dragFloat.classList.remove('fac');
    document.documentElement.classList.remove('grabbing');
    updateCursor();
  }
  cv.addEventListener('pointerup', (e) => {
    if (ignored(e) || camButton(e)) return;
    if (drag) drop(e);
    else {
      // 長押しにならずに離したときは、今までどおりそのマスに置こうとする（重なりの知らせを出す）
      if (press) applyEdit(press.x, press.y);
      endPaint();
    }
  });
  cv.addEventListener('pointercancel', (e) => {
    if (!ignored(e)) endPaint();
  });
  // キーボードで選んでいるマスがあれば、そこに戻す（範囲の円と影を消さない）
  cv.addEventListener('pointerleave', () => {
    hover = kbdDrag || cursorShown() ? cursor : null;
    hideGatePopSoon();
  });

  // ---- キーボードでの配置 -------------------------------------------------
  // 盤面にフォーカスがあるとき、選んでいるマスに枠を出す（マウスで押してフォーカスしたときは出さない）
  const cursorShown = () => mode === 'edit' && cv.matches(':focus-visible');
  const say = (msg: string) => {
    $('kbdStatus').textContent = msg;
  };
  // 読み上げ用の、マスの様子
  function describe(t: Tile) {
    const o = occAt(layout, t.x, t.y);
    const what = !o
      ? '空き'
      : o.k === 'g'
        ? GDEF[layout.generals[o.i].kind].busho
        : BDEF[layout.buildings[o.i].type].name;
    return `横${t.x + 1}・縦${t.y + 1}：${what}`;
  }
  const dragName = (d: Drag) => (d.k === 'g' ? GDEF[d.kind].busho : BDEF[d.type].name);
  function grabByKeyboard(d: Drag) {
    endPaint();
    drag = d;
    kbdDrag = true;
    hover = cursor;
    say(`${dragName(d)}をつかみました。矢印キーで動かし、Enterで置きます。Escでやめます`);
    updateCursor();
  }
  // パネルの武将のボタンから：盤面へフォーカスを移し、その武将をつかんだ状態にする
  function placeByKeyboard(k: GeneralKind, from: HTMLElement) {
    cv.focus();
    grabByKeyboard({ k: 'g', kind: k });
    kbdFrom = from;
  }
  // Enter・スペース：つかんでいれば置く。武将・（何も選んでいなければ）施設の上ならつかむ。ほかは選んでいる道具で置く
  // 置けなかったとき：見える知らせと、読み上げの両方に出す
  function fail(msg: string, c: Tile) {
    toast(msg);
    say(`${msg}。${describe(c)}`);
  }
  function actAt(c: Tile) {
    if (drag) {
      const name = dragName(drag);
      const r = dropAt(c);
      // 置けなければ、つかんだまま別のマスを選べる
      if (!r.ok) fail(r.msg, c);
      else {
        endPaint();
        say(`${name}を置きました。${describe(c)}`);
      }
      return;
    }
    const g = generalAt(c);
    const bi = buildingAt(c);
    if (g) grabByKeyboard({ k: 'g', kind: g.kind });
    else if (!tool) {
      if (bi >= 0) grabByKeyboard(grabB(bi, c));
      else say('ここには動かせるものがありません。施設の道具を選ぶと置けます');
    } else {
      const r = place(layout, tool, c.x, c.y);
      if (r.ok) {
        saveLayout();
        refreshEditPanel();
        say(describe(c));
      } else fail(r.msg || (tool === 'erase' ? 'ここには消せるものがありません' : '他の配置と重なります'), c);
    }
  }
  // Delete・Backspace：武将なら外し、施設なら消す
  function removeAt(c: Tile) {
    const g = generalAt(c);
    if (g) {
      unplaceGeneral(g.kind);
      say(`${GDEF[g.kind].busho}を外しました。${describe(c)}`);
      return;
    }
    const r = place(layout, 'erase', c.x, c.y);
    if (!r.ok) {
      fail(r.msg || 'ここには消せるものがありません', c);
      return;
    }
    saveLayout();
    refreshEditPanel();
    say(`消しました。${describe(c)}`);
  }
  const ARROWS: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  cv.addEventListener('keydown', (e) => {
    if (mode !== 'edit' || terr) return;
    const key = ARROWS[e.key];
    if (key) {
      e.preventDefault();
      // 画面の上下左右の向きで動かす（盤面を回していれば、それに合わせる）
      const mv = renderer.arrow(key[0], key[1]);
      const n = e.shiftKey ? 5 : 1;
      cursor = { x: clamp(cursor.x + mv[0] * n, 0, W - 1), y: clamp(cursor.y + mv[1] * n, 0, H - 1) };
      hover = cursor;
      say(drag ? `${dragName(drag)}：${describe(cursor)}` : describe(cursor));
      updateCursor();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      // マウスでドラッグしている途中は、見えていないカーソルの位置に置かないよう何もしない
      if (!e.repeat && !(drag && !kbdDrag)) actAt(cursor);
    } else if (e.key === 'Escape' && drag) {
      e.preventDefault();
      const back = kbdFrom;
      endPaint();
      say('やめました');
      back?.focus();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (!drag) removeAt(cursor);
    }
  });
  // マウスで押してフォーカスしたときは、押したマスをそのままにする
  cv.addEventListener('focus', () => {
    if (!cursorShown()) return;
    hover = cursor;
    say(`${describe(cursor)}。矢印キーでマスを選び、Enterで置く・つかむ、Deleteで消します`);
  });
  // 盤面からフォーカスが外れたら、キーボードでつかんでいるものは元の位置に戻す
  cv.addEventListener('blur', () => {
    if (kbdDrag) endPaint();
  });

  $('tabEdit').addEventListener('click', () => setMode('edit'));
  $('tabBattle').addEventListener('click', () => setMode('battle'));
  $('tabUnits').addEventListener('click', () => setMode('units'));
  $('retryBtn').addEventListener('click', restart);
  // 結果の枠を閉じたら、攻城の開戦前に戻る（✕・枠の外を押す・Esc）。
  // 枠の中にフォーカスがあったとき（枠の外を押して body に移ったときも）は、「開戦」へ移す（閉じた ✕ に残さない）
  function closeResult() {
    const a = document.activeElement;
    const lost = !a || a === document.body || $('overlay').contains(a);
    restart();
    if (lost) $('startBtn').focus();
  }
  $('resClose').addEventListener('click', closeResult);
  // 枠の外で押して、枠の外で離したときだけ閉じる（枠の中で押して外で離したときは閉じない）
  let downOnBack = false;
  $('overlay').addEventListener('pointerdown', (e) => {
    downOnBack = e.target === e.currentTarget;
  });
  $('overlay').addEventListener('click', (e) => {
    if (downOnBack && e.target === e.currentTarget) closeResult();
  });
  document.addEventListener('keydown', (e) => {
    if ($('overlay').hidden) return;
    if (e.key === 'Escape') closeResult();
    // 枠を出している間は、Tab で枠の外へ出ない（枠の中で押せるのは ✕ だけ）
    else if (e.key === 'Tab') {
      e.preventDefault();
      $('resClose').focus();
    }
  });
  $('pauseBtn').addEventListener('click', () => {
    paused = !paused;
    refreshBattlePanel();
  });
  // 盤面の向きを初めに戻す（回すのは、右ドラッグか、空いている所の Shift＋左ドラッグ）
  $('viewReset').addEventListener('click', () => renderer.resetView());
  for (const b of $('speedSeg').querySelectorAll<HTMLButtonElement>('button'))
    b.addEventListener('click', () => {
      speed = Number(b.dataset.s);
      refreshBattlePanel();
    });
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-preset]')) {
    b.addEventListener('click', () => {
      // 編成例は、地形ごと決まった城を再現する。知らない名前なら何もしない（今の地形や配置を消さない）
      const id = b.dataset.preset;
      if (isMapId(id)) setLayout(preset(id), true);
    });
  }
  // 元に戻す・やり直す（ボタンと Ctrl＋Z／Ctrl＋Y・Ctrl＋Shift＋Z）。防衛配置のときだけ効く
  $('undoBtn').addEventListener('click', undo);
  $('redoBtn').addEventListener('click', redo);
  document.addEventListener('keydown', (e) => {
    if (mode !== 'edit' || terr || !(e.ctrlKey || e.metaKey)) return;
    const tag = (e.target as HTMLElement | null)?.tagName ?? '';
    if (tag === 'TEXTAREA' || tag === 'INPUT') return; // 文字の入力欄では、入力欄の取り消しに任せる
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
      e.preventDefault();
      redo();
    }
  });
  // 消去：施設を取り除く道具を選ぶ（もう一度押すと外れる）。施設の見出しの右のボタン
  $('eraseBtn').addEventListener('click', () => {
    tool = tool === 'erase' ? null : 'erase';
    refreshEditPanel();
    updateHint();
  });
  // 全消去：施設と武将をすべて消す。地形・川・橋はそのまま残す（見出しの右のボタン）
  $('clearBtn').addEventListener('click', () => {
    setLayout({ ...layout, buildings: [], generals: [] });
  });
  // ---- 居城の移転（地形を作り直す窓） ---------------------------------------------------
  // 開くと、選んでいる型の地形の案を盤面に仮に出す。決めたら防衛配置に反映し、施設と武将はすべて消す
  // （起伏が変わると、置いたものが段をまたいだり川に沈んだりするため）。やめたら元の配置に戻す
  function openTerrain() {
    if (mode !== 'edit' || terr) return;
    endPaint();
    tool = null;
    terr = { saved: layout, map: isMapId(layout.map) ? layout.map : 'flat' };
    $('presetBar').hidden = true;
    $('terrShade').hidden = false;
    $('panelTerrain').hidden = false;
    nextTerrain();
    updateHint();
    $('mapSeg').querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
  }
  // 選んでいる型で、新しい案を作って盤面に出す（保存も履歴もしない）。同じ型をもう一度押しても作り直す
  function nextTerrain() {
    if (!terr) return;
    layout = { ...bareLayout(), ...makeTerrain(terr.map, Date.now()), map: terr.map };
    layoutRev++;
    for (const b of $('mapSeg').querySelectorAll<HTMLButtonElement>('button'))
      b.setAttribute('aria-pressed', String(b.dataset.map === terr.map));
  }
  // 窓を閉じる。ok なら今の案を防衛配置に反映し（新しい城なので、移転の前には戻せない）、そうでなければ元の配置に戻す
  function closeTerrain(ok: boolean) {
    const t = terr;
    if (!t) return;
    terr = null;
    // 盤面に出している案を反映する。やめたら元の配置に戻す
    if (ok) setLayout(layout, true);
    else {
      layout = t.saved;
      layoutRev++;
    }
    $('panelTerrain').hidden = true;
    $('terrShade').hidden = true;
    $('presetBar').hidden = mode !== 'edit';
    refreshEditPanel();
    updateHint();
    if (mode === 'edit') $('terrOpen').focus();
  }
  for (const m of MAPS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.map = m.id;
    b.textContent = m.name;
    b.addEventListener('click', () => {
      if (!terr) return;
      terr.map = m.id;
      nextTerrain();
    });
    $('mapSeg').appendChild(b);
  }
  $('terrOpen').addEventListener('click', openTerrain);
  $('terrOk').addEventListener('click', () => closeTerrain(true));
  $('terrCancel').addEventListener('click', () => closeTerrain(false));
  // 出撃記録：攻城配置（口と予定）を書き出し、読み込んで盤面に置く。
  // 戦ったあとに書き出すと、手動で出した兵と武将も、口と行にまとめて予定に足す
  const recJson = $<HTMLTextAreaElement>('recJson');
  $('recOut').addEventListener('click', () => {
    const d = structuredClone(siege);
    if (manualLog.length) addDeploys(d, manualLog);
    recJson.value = JSON.stringify(d);
    toast('書き出しました');
  });
  // 攻城配置を入れ替える（基本・全消去・読み込み）。戦いの途中なら、開戦前に戻す
  function setSiege(d: Draft) {
    if (battle?.started || battle?.over) newBattle();
    manualLog = []; // 予定を入れ替えたので、前の戦いの手動の出撃はまとめない
    siege = d;
    siegeChanged();
  }
  $('recIn').addEventListener('click', () => {
    let d: Draft | null = null;
    let dropped = 0;
    try {
      const o = JSON.parse(recJson.value);
      const plan = parseDraft(o);
      // 攻城配置の形でなければ、前の形の出撃記録（出撃の一覧）として読み、予定にまとめる
      const deploys = plan ? null : parseDeploys(o);
      d = plan ? sanitizeDraft(plan) : deploys ? emptyDraft() : null;
      if (d && deploys) dropped = addDeploys(d, deploys);
    } catch {
      d = null;
    }
    if (!d) {
      toast('出撃記録を読み込めません（形式・範囲を確認）');
      return;
    }
    setSiege(d);
    // 外周でないマスや、兵力・武将の上限を超えた出撃は、予定に入らない
    toast(dropped ? `読み込みました（${dropped} 回の出撃は予定に入れられませんでした）` : '読み込みました');
  });
  // 編成例：基本を置き、出撃記録の欄にも出す
  $('siegeBasic').addEventListener('click', () => {
    setSiege(basicSiege());
    recJson.value = JSON.stringify(siege);
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
    setLayout(l, true);
    toast('読み込みました');
  });
  document.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement | null)?.tagName ?? '';
    if (tag === 'TEXTAREA' || tag === 'INPUT' || mode !== 'battle' || !battle) return;
    if (e.key === ' ' && tag !== 'BUTTON' && battle.started && !battle.over) {
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
      `矢倉 ${st.tDown}/${st.tTotal} 破壊　守将 ${st.dKilled}/${st.gTotal} 討伐　門 ${st.gateDown} 破壊`;
    $('overlay').hidden = false;
    // 入力欄に書いている途中でなければ、✕ へフォーカスを移す（読み上げで結果が伝わるように）
    const tag = document.activeElement?.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') $('resClose').focus();
    updateHint();
    refreshBattlePanel();
  }

  function restart() {
    newBattle();
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
      if (pix) drawUnitPix(pix, g.kind, genColor, frame);
    }
  }
  // 攻城：予定に入れて、まだ出撃していない武将のキャラを歩かせる（防衛配置の置いた武将と同じ）
  // 歩かせるのは、refreshBattlePanel が予定で出る武将として青枠（sched）を付けたボタンだけ。ほかは立ち姿にする。
  // 一時停止の間は、今のコマのまま止める（drawUnitPix は、コマが変わったときだけ描き直す）
  let siegeWalkT = 0;
  function walkSiegePix(now: number) {
    if (!battle) return;
    if (!(paused && battle.started)) siegeWalkT = now;
    const frame = still.matches ? 'walk0' : WALK[Math.floor(siegeWalkT / 160) % WALK.length];
    for (const b of $('genUnitGrid').querySelectorAll<HTMLElement>('[data-unit]')) {
      const k = b.dataset.unit ?? '';
      const pix = b.querySelector<HTMLCanvasElement>('.gpix');
      if (pix && isAttackerKind(k)) drawUnitPix(pix, k, atkColor, b.classList.contains('sched') ? frame : 'walk0');
    }
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    readGenColors();
    // 居城の移転の窓を開いている間は、後ろのメニューを案の配置で作り直さない（閉じるときに作り直す）
    if (!terr) refreshEditPanel();
    for (const pix of $('toolgrid').querySelectorAll<HTMLCanvasElement>('.fpix')) {
      const t = pix.dataset.facility ?? '';
      if (isBuildingType(t)) renderer.drawIcon(pix, t);
    }
    for (const b of $('panelBattle').querySelectorAll<HTMLElement>('[data-unit]')) {
      const k = b.dataset.unit ?? '';
      const pix = b.querySelector<HTMLCanvasElement>('.gpix');
      if (pix && isAttackerKind(k)) drawUnitPix(pix, k, atkColor);
    }
  });
  function loop(now: number) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (mode === 'edit') walkGenPix(now);
    else if (mode === 'battle') walkSiegePix(now);
    updateInfoPop();
    const b = battle;
    if (mode === 'battle' && b && b.started && !b.over && !paused) {
      acc += dt * speed;
      let n = 0;
      while (acc >= DT && n < 40 && !b.over) {
        // 攻城配置の予定は、開戦からの秒数で出す。出せなかったら知らせる
        if (sched)
          for (const f of deployDue(b, sched))
            toast(`${ADEF[f.kind].busho ?? ADEF[f.kind].name}は出撃できませんでした（${f.msg}）`);
        step(b);
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
    // パネルからドラッグしている兵・武将があれば、選んでいる兵種の代わりに、その影を出す
    const shown = siegeDrag ?? unitSel;
    if (mode !== 'units')
      renderer.draw({
        mode,
        layout,
        battle,
        hover,
        // パネルからドラッグしている施設があれば、選んでいる道具の代わりに、その影を出す
        tool: facDrag ?? tool,
        unitSel: shown,
        drag,
        cursor: cursorShown() ? cursor : null,
        siege:
          mode === 'battle' && isPre()
            ? {
                gates: siege.gates,
                rows: siege.rows,
                canPlan: (x: number, y: number) => !!shown && canPlan(shown, x, y),
              }
            : null,
        deployOk: !!battle && !!shown && !isPre() && canDeploy(battle, shown) && manualBlock(shown) === null,
      });
    // 出撃パネル（経過時間・残り兵力など）は少し間引いて更新する
    if (mode === 'battle' && now - panelAt > 120) {
      panelAt = now;
      refreshBattlePanel();
    }
    requestAnimationFrame(loop);
  }

  // ---- 起動 ---------------------------------------------------------------
  initTooltips();
  initCompare(renderer.drawIcon);
  readGenColors();
  buildEditTools();
  refreshEditPanel();
  updateHint();
  document.fonts?.load('800 20px "Shippori Mincho B1"', '歩弓騎車将猛謀櫓門本丸壁出撃エリア').catch(() => {});
  // 武将の名前の印の筆文字も、先に読み込む
  document.fonts?.load('15px "Yuji Syuku"', GENERAL_ORDER.map((k) => GDEF[k].busho).join('')).catch(() => {});
  requestAnimationFrame(loop);
}
