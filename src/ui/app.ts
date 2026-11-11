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
  type CastleShape,
  canDeploy,
  canDeployAt,
  canGateAt,
  castleShape,
  clamp,
  closePeers,
  countOf,
  createBattle,
  type Draft,
  DT,
  deploy,
  deployDue,
  draftToPlan,
  ESCAPE_ANGLE,
  ESCAPE_ROUTES,
  emptyDraft,
  escapeShort,
  fpOf,
  GATE_SPACING,
  GDEF,
  GENERAL_ORDER,
  type GeneralKind,
  gateGap,
  gatesDone,
  generalsUsed,
  H,
  HALL,
  HALL_MARGIN,
  hallPos,
  heightAt,
  isAttackerKind,
  isBuildingType,
  isFacilityType,
  isGate,
  isGeneralDefender,
  isGeneralKind,
  isMapId,
  isPresetId,
  KURUWA_LAND,
  LAND_PER_POINT,
  type Layout,
  limitOf,
  MAPS,
  MAX_GENERALS,
  type MapId,
  MOAT_CAP,
  makeTerrain,
  moatCount,
  moveBuilding,
  moveGate,
  nearestGate,
  notReady,
  ON_LINE,
  occAt,
  PLAN_LIMIT,
  PLAN_TICKS,
  type PlaceResult,
  type PlanStep,
  parseDeploys,
  parseDraft,
  place,
  placePreview,
  preset,
  putGeneral,
  putGeneralAt,
  removeGeneral,
  removeGeneralFrom,
  sanitizeDraft,
  step,
  TIME_LIMIT,
  type Tool,
  UNIT_ORDER,
  validate,
  W,
  WALL_PER_GATE,
  wallOwner,
  ZONE,
} from '../sim';
import { BIG_STAND, type BigPick, drawBigBody } from './bigBusho';
import { initCompare, renderCompare } from './compare';
import { createCouncil, gateLabel } from './council';
import { $ } from './dom';
import { createRenderer, type Drag, type Mode, type Tile } from './renderer';
import { createSampleDialog } from './sampleDialog';
import { LAYOUT_KEY, SIEGE_KEY, type Store } from './store';
import { type Stroke, startStroke, strokeTo } from './stroke';
import { initTooltips, setTip } from './tooltip';

const DRAG_ICON = 60; // ドラッグ中の施設の絵の板の大きさ（点）
// 大きな絵の武将のキャラの大きさ（ドット）。全身を等倍で入れる高さで、横は左右の余白を詰めて名前を1行で出せる幅にする
const BIG_ICON_W = 44;
const BIG_ICON_H = 60;
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
  stats?: string; // 兵：説明の枠の2行目に出す数値（体力・攻撃・射程・速度）
}

const GENERAL_INFO: Record<(typeof GENERAL_ORDER)[number], string> = {
  brave: '刀で斬り、回転斬りで周りをまとめて斬る',
  archer: '槍で突き、スキルの弓で遠くを射る',
  sage: '軍配で打ち、スキル「火計」で離れた所を燃やす',
  rider: '軍配で打ち、スキルで騎兵を呼ぶ',
  gunner: '槍で突き、スキルの鉄砲で3発続けて撃つ',
  builder: '周りの建物を直す',
  guard: '軍配で打ち、スキルで周りの味方の傷を減らす',
};
// 防衛配置のパネルの道具（施設と堀）
type EditToolId = BuildingType | 'moat';
const EDIT_TOOLS: (ToolInfo & { id: EditToolId })[] = [
  { id: 'hall', name: '本丸', g: '城', s: 'd', d: '落とされたら負け', req: true },
  { id: 'wall', name: '城壁', g: '壁', s: 'd', d: '通行を阻む・壊せない' },
  {
    id: 'moat',
    name: '堀',
    g: '堀',
    s: 'd',
    d: '川から水を引く（平城だけ）。中は遅く、攻撃できない。門のすぐ外に引くと引き橋になる。なぞると続けて引ける',
  },
  { id: 'gate', name: '門', g: '門', s: 'd', d: '守将は通れる・攻め手は壊して通る', req: true },
  { id: 'tbow', name: '弓櫓', g: '櫓', s: 'd', d: `射程${BDEF.tbow.range}・連射` },
  { id: 'tgun', name: '鉄砲櫓', g: '砲', s: 'd', d: `射程${BDEF.tgun.range}・高威力・遅い` },
  { id: 'cata', name: '大筒', g: '筒', s: 'd', d: `射程${BDEF.cata.range}・範囲・近くは撃てない` },
  { id: 'drum', name: '鼓楼', g: '鼓', s: 'd', d: '周囲の守将と櫓・大筒が速くなる（重ならない）' },
  { id: 'bell', name: '鐘楼', g: '鐘', s: 'd', d: '敵を見つけると離れた守将も駆けつける' },
];
const UNIT_INFO: Record<AttackerKind, string> = {
  inf: '本丸へ道なりに進み、近くの施設を壊す',
  arc: '遠距離から射る',
  cav: '守将を優先して狙う',
  ram: '門を破る。本丸には弱い',
  eng: '櫓・大筒・鼓楼・鐘楼を一気に壊す。城壁は壊せない',
  shd: '周りの兵の傷を代わりに受ける',
  scout: '足が速い囮。守将や櫓を引きつける',
  brave: '刀で斬り、回転斬りで周りをまとめて斬る',
  archer: '槍で突き、スキルの弓で遠くを射る',
  sage: '櫓を狙い、スキル「火計」で離れた所を燃やす',
  rider: '守将を狙い、スキルで騎兵を呼ぶ',
  gunner: '槍で突き、スキルの鉄砲で3発続けて撃つ',
  builder: '施設を狙い、周りの工兵を速くする',
  guard: '軍配で打ち、スキルで周りの味方の傷を減らす',
};
// 兵の数値（比較の画面と同じ呼び名）。説明の枠に出す
const statsLabel = (k: AttackerKind) => {
  const d = ADEF[k];
  return `体力 ${d.hp}・攻撃 ${d.dmg}・射程 ${d.range.toFixed(1)}・速度 ${d.speed.toFixed(1)}`;
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

export function startApp(store: Store) {
  const cv = $<HTMLCanvasElement>('cv');
  const renderer = createRenderer(cv);

  let unreadable = store.readFailed; // 保存を読めなかった
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
  // なぞって置く・消すときの、始点と最後に置いたマス（stroke.ts）
  let stroke: Stroke | null = null;
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
  let logLast: unknown; // 戦況に出した最新の記録（undefined なら、まだ出していない）
  let toastTimer = 0;
  // 攻城配置：武将と兵の出撃の予定。sched は開戦後に予定を出すもの、siegeDrag はパネルからドラッグしている武将・兵
  // 予定が保存されていなければ（初めて攻城を開いたとき）、今の城の型の編成例「基本」を入れておく
  let siege: Draft = loadSiege() ?? basicSiege(isPresetId(layout.map) ? layout.map : 'flat');
  // 手動で出した兵と武将（出撃記録を書き出すとき、予定にまとめる）。
  // 結果の枠を閉じるなどで次の戦いになっても、書き出す前に消えないよう残しておき（manualOld）、
  // 次の戦いで新しく手動で出したときか、予定を入れ替えたときに消す
  let manualLog: PlanStep[] = [];
  let manualOld = false;
  let sched: AutoState | null = null;
  let siegeDrag: AttackerKind | null = null;
  let pinDrag: number | null = null; // 目印をつかんで動かしている口の番号
  let pinOff = { x: 0, y: 0 }; // つかんだ位置から、口のマスの中心までのずれ（画面の点）
  let pinLeft = false; // つかんだあと、口のマスを離れたか（離れなければ、押しただけとみなす）
  // 防衛配置で、パネルからドラッグしている施設
  let facDrag: EditToolId | null = null;

  // ---- 保存 ---------------------------------------------------------------
  // 保存した予定を読む
  function loadSiege(): Draft | null {
    try {
      const raw = store.get(SIEGE_KEY);
      const d = raw ? parseDraft(JSON.parse(raw)) : null;
      if (raw && !d) unreadable = true;
      return d ? sanitizeDraft(d) : null;
    } catch {
      unreadable = true;
      return null;
    }
  }
  function saveSiege() {
    store.set(SIEGE_KEY, JSON.stringify(siege));
  }
  function loadLayout(): Layout | null {
    try {
      const raw = store.get(LAYOUT_KEY);
      const l = raw ? validate(JSON.parse(raw)) : null;
      if (raw && !l) unreadable = true;
      return l;
    } catch {
      unreadable = true;
      return null;
    }
  }
  // 攻城を始められない理由（本丸・本丸への道・門の前後・守り手が入れない施設・塀と郭）。道の確かめは盤面全体を調べるので、配置が変わったときだけやり直す
  // 配置の版。配置を変えたら必ず増やす（saveLayout・commitLayout を通すか、配置を入れ替えた所で増やす）。
  // 開戦前の確かめを使い回すのと、盤面を描き直すか（renderer.ts の sceneKey）を決めるのに使うので、増やし忘れると盤面が古いまま残る
  let layoutRev = 0;
  let readyRev = -1;
  let readyWhy: string | null = null;
  let readyShape: CastleShape = castleShape(layout); // 塀と土地の形（盤面の色付けとパネルの土地の数にも使う）
  let readyGates = false; // 門に関わる開戦の条件がそろったか（パネルの門の「必須」の印）
  function whyNotReady() {
    if (readyRev !== layoutRev) {
      readyShape = castleShape(layout);
      readyWhy = notReady(layout, readyShape);
      readyGates = gatesDone(layout, readyShape);
      readyRev = layoutRev;
    }
    return readyWhy;
  }
  // 今の配置の塀と土地の形
  function castleNow() {
    whyNotReady();
    return readyShape;
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
  // 配置を変えたあと：保存して、パネルを今の配置に合わせる
  function commitLayout() {
    saveLayout();
    refreshEditPanel();
  }
  function persist(json: string) {
    store.set(LAYOUT_KEY, json);
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
    for (const k of ['heights', 'water', 'bridge', 'moat'] as const) if (sameArr(l[k], layout[k])) l[k] = layout[k];
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
    const name = `<b>${info.name}${info.req ? '<em class="req">必須</em>' : ''}</b>`;
    b.innerHTML =
      (info.pix ? '' : `<span class="glyph ${info.s}">${info.g}</span>`) +
      `<span class="nm">${name}<span class="cnt">${info.cost ?? ''}</span></span>`;
    // 説明は、ボタンには出さず、マウスを合わせたときに出す。兵は、次の行に数値を出す
    // （読み上げはボタンの名前で名前を読むので、説明だけにする）
    if (info.stats) setTip(b, `${info.name}：${info.d}\n${info.stats}`, `${info.d}。${info.stats}`);
    else setTip(b, info.d, info.d);
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
      const b = makeTool({ name: GDEF[k].busho, g: '', s: 'd', d: GENERAL_INFO[k], pix }, false, (e) => {
        if (countOf(layout, k)) unplaceGeneral(k);
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
  function makeFacilityPix(type: EditToolId) {
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
    pix.setAttribute('aria-hidden', 'true');
    return pix;
  }
  // キャラを描く。武将（兵）・色・コマのどれかが変わったときだけ描き直す
  function drawUnitPix(cv: HTMLCanvasElement, k: AttackerKind, color: string, frame: BigPick = BIG_STAND) {
    const key = `${k}|${color}|${frame.action}${frame.i}`;
    if (cv.dataset.key === key) return;
    cv.dataset.key = key;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    // 全身を等倍（1ドットを画面の1点）で、BIG_ICON_W × BIG_ICON_H に切り出す。
    // 枠もその大きさにする（gbig）。止まっているときは待機の構え、歩くときは歩きのコマ。
    cv.classList.add('gbig');
    const r = Math.min(Math.round(window.devicePixelRatio || 1), 2);
    const pw = BIG_ICON_W * r;
    const ph = BIG_ICON_H * r;
    if (cv.width !== pw || cv.height !== ph) {
      cv.width = pw;
      cv.height = ph;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    drawBigBody(ctx, cv, k, frame, color, BIG_ICON_W, BIG_ICON_H);
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
          name: d.name,
          cost: costLabel(battle, k),
          g: d.glyph,
          s: 'a',
          d: UNIT_INFO[k],
          pix,
          stats: d.general ? undefined : statsLabel(k),
        },
        k === unitSel,
        () => {
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
  // そのマスを口にできないときの知らせ（できるなら null）。
  // 外周でないマスや、外周でも平地でない・川のマスなら、開戦後に手で出すときと同じ知らせにする。
  // 出せるマスでも口の決まり（両隣2マスまで平地）に合わなければ、口の決まりを知らせる
  function gateRefusal(p: Tile) {
    if (!isGate(p.x, p.y)) return '外周の青いエリアから出撃します';
    if (!canDeployAt(layout, p.x, p.y)) return '出撃エリアの平地から出撃します';
    if (!canGateAt(layout, p.x, p.y)) return '出撃口は、まわりの2マスまで平地が続く所に置きます';
    return null;
  }
  // 開戦前：武将・兵を、外周のマスの出撃の予定に入れる（パネルからドラッグしたときと、選んで盤面を押したとき）
  function planAt(k: AttackerKind, p: Tile) {
    const no = gateRefusal(p);
    if (no) {
      toast(no);
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
  }
  // ボタンをつかんで盤面へドラッグする（パネルの施設・防衛の武将・攻城の兵と武将、盤面の上の口の目印で共通）。
  // 押してから DRAG_SLOP より動かしたら begin でドラッグを始め、離したら drop で置く。動かさずに離したら、ボタンの click で選ぶ。
  // ドラッグしたボタンには印（dragged）を付け、直後の click を止める（drop で印を消せば、click は止まらない）。
  // 押せないボタンはつかまない。途中で endPaint がドラッグをやめたら、指を離すまで、つかみ直さない
  function addPanelDrag(
    b: HTMLButtonElement,
    o: {
      canGrab: () => boolean; // 押せるボタンのうち、つかめるか
      active: () => boolean; // このボタンからドラッグしている最中か
      begin: (at: { x: number; y: number }) => void; // at は押した位置
      move: (e: PointerEvent) => void;
      drop: (e: PointerEvent) => void;
    },
  ) {
    let start: { x: number; y: number } | null = null;
    let begun = false;
    b.addEventListener(
      'click',
      (e) => {
        if (!b.dataset.dragged) return;
        delete b.dataset.dragged;
        e.stopImmediatePropagation();
      },
      true,
    );
    b.addEventListener('pointerdown', (e) => {
      // 前のドラッグの印は、クリックが来なかったときに残るので、押し始めのたびに消す
      delete b.dataset.dragged;
      begun = false;
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
        if (begun) {
          start = null;
          return;
        }
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_SLOP) return;
        o.begin(start);
        begun = true;
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
  function addFacilityDrag(b: HTMLButtonElement, type: EditToolId) {
    addPanelDrag(b, {
      canGrab: () => true,
      active: () => facDrag === type,
      begin: () => {
        endPaint();
        facDrag = type;
        // 大きな絵の武将をドラッグしたあとなら、絵の板を元の大きさに戻し、武将用の枠（gbig）を外してから描く
        dragFloat.classList.remove('gbig');
        dragFloat.width = dragFloat.height = DRAG_ICON;
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
          commitLayout();
        } else toast(r.msg);
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

  // 目印をつかんでいるときの、移す先のマス。駒の陰のマスも狙えるよう、地面だけを見る
  const pinTile = (e: PointerEvent) => renderer.tileAt(e.clientX + pinOff.x, e.clientY + pinOff.y, true);
  // 口の目印をつかんで動かすと、口を移す。動かさずに離したら、click で軍評定を開く
  function addPinDrag(b: HTMLButtonElement) {
    addPanelDrag(b, {
      canGrab: () => isPre(),
      active: () => pinDrag !== null && pinDrag === Number(b.dataset.gate),
      begin: (at) => {
        endPaint();
        const gi = Number(b.dataset.gate);
        pinDrag = gi;
        pinLeft = false;
        // 口が盤面に映っているときは、つかんだ位置とのずれを保つ（押した位置の下は、口のマスではないため）
        const g = siege.gates[gi];
        const r = cv.getBoundingClientRect();
        const c = renderer.tileCenter(g.x, g.y);
        const seen = c.x >= 0 && c.y >= 0 && c.x < r.width && c.y < r.height;
        pinOff = seen ? { x: r.left + c.x - at.x, y: r.top + c.y - at.y } : { x: 0, y: 0 };
      },
      move: (e) => {
        hover = pinTile(e);
        const g = pinDrag === null ? null : siege.gates[pinDrag];
        if (g && (hover?.x !== g.x || hover?.y !== g.y)) pinLeft = true;
      },
      drop: (e) => {
        const g = pinDrag === null ? null : siege.gates[pinDrag];
        const gi = pinDrag;
        const p = pinTile(e);
        const left = pinLeft;
        endPaint();
        // 口のマスを離れなかったら、手が少しぶれただけとみなし、click で軍評定を開く
        if (!left) delete b.dataset.dragged;
        // 盤面の外や、元のマスで離したときは、何もしない
        if (gi === null || !g || !p || (p.x === g.x && p.y === g.y)) return;
        const no = gateRefusal(p);
        if (no) toast(no);
        else {
          moveGate(siege, gi, p.x, p.y);
          siegeChanged();
        }
      },
    });
  }

  function refreshEditPanel() {
    $('eraseBtn').setAttribute('aria-pressed', String(tool === 'erase'));
    $('mapName').textContent = MAPS.find((m) => m.id === (layout.map ?? 'flat'))?.name ?? '';
    // 全消去は、消すもの（施設か武将）があるときだけ押せる（攻城配置の全消去と同じ）
    $<HTMLButtonElement>('clearBtn').disabled = !layout.buildings.length && !layout.generals.length && !layout.moat;
    // 攻城を始められない理由と、塀の中の広い土地の数（盤面の薄い金色のマス）を出す
    const why = whyNotReady();
    // 郭ごとの数（広い土地・施設の点数）と、城全体の逃げ道と外の門の数。足りない・超えたものがあれば赤字にする
    const cs = castleNow();
    let short = !cs.kuruwa.length;
    const lines = cs.kuruwa.map((info) => {
      if (info.land < KURUWA_LAND || info.used > info.points) short = true;
      return `${info.name}：広い土地 ${info.land} / ${KURUWA_LAND}・点数 ${info.used} / ${info.points}`;
    });
    if (lines.length) {
      if (escapeShort(cs) || cs.closeGates.length) short = true;
      const near = cs.routes >= ESCAPE_ROUTES && !cs.routesApart ? '（外の門が近い）' : '';
      const close = cs.closeGates.length ? `・近すぎる門 ${cs.closeGates.length}` : '';
      lines.push(`逃げ道 ${cs.routes} / ${ESCAPE_ROUTES}${near}・外の門 ${cs.outerGates} / ${cs.gatesNeed}${close}`);
      // 堀は、堀を引ける城の型（平城）か、引いた堀があるときだけ出す
      if (cs.moatCap || cs.moats) {
        if (cs.moats > cs.moatCap || cs.moatAstray.length) short = true;
        const n = cs.moatAstray.length;
        const astray = n ? `・引けない所 ${n}` : '';
        lines.push(`堀 ${cs.moats} / ${cs.moatCap}${astray}`);
      }
    }
    $('landInfo').textContent = lines.length ? lines.join('\n') : '郭がありません（本丸を塀で囲むと、郭ができます）';
    $('landInfo').classList.toggle('short', short);
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
      // 堀は、引いた数と城の型の上限を出す。上限が0（平山城・山城）なら押せない
      if (id === 'moat') {
        const cap = castleNow().moatCap;
        if (!cap && tool === 'moat') tool = null;
        b.setAttribute('aria-pressed', String(tool === 'moat'));
        const sp = b.querySelector('.cnt');
        if (sp) sp.textContent = cap ? `${moatCount(layout)} / ${cap}` : '平城のみ';
        b.disabled = !cap;
        continue;
      }
      const lim = limitOf(id); // 0 は上限なし（施設で上限があるのは本丸だけ）
      const used = countOf(layout, id);
      // 選んでいる施設が上限に達したら（盤面を押して置いたときなど）、選ぶのをやめる（武将を置いたときと同じ）
      if (lim && used >= lim && tool === id) tool = null;
      b.setAttribute('aria-pressed', String(id === tool));
      const sp = b.querySelector('.cnt');
      // 施設（櫓・大筒・鼓楼・鐘楼）は、郭の点数を使う数を出す。本丸は置いた数と上限。城壁・門は何も出さない
      // （スラッシュの両側は細い空白にする。3列の狭いボタンに収めるため）
      if (sp) sp.textContent = isFacilityType(id) ? `${BDEF[id].cost} 点` : lim ? `${used} / ${lim}` : '';
      // 必須の施設は、置き終えるまで印を目立たせる（本丸は置けば、門は gatesDone で置き終えた）
      b.querySelector('.req')?.classList.toggle('met', id === 'gate' ? readyGates : used >= Math.max(lim, 1));
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
    // 使った兵力：出した分（予定・手動）と、まだ出ていない予定の分（残り兵力と同じく pendingPlan で数える）
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
      // 予定で出る武将か。開戦後は、まだ出ていない予定だけ（pendingPlan）。
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
    $('pauseBtn').hidden = pre; // 開戦前は押せないので出さない。開戦のボタンと同じ位置で入れ替わる
    $<HTMLButtonElement>('retryBtn').disabled = pre; // 開戦前は、止める戦いがない
    // 防衛の配置が決まりを満たさなければ、開戦できない（理由と、直す場所を出す）
    const why = whyNotReady();
    $<HTMLButtonElement>('startBtn').disabled = !!why;
    $('battleReady').textContent = why && pre ? `${why}。防衛配置で直すと開戦できます` : '';
    $('battleReady').hidden = !(why && pre);
    $<HTMLButtonElement>('siegeClear').disabled = !siege.rows.length;
    if (!pre) council.close();
    const pb = $<HTMLButtonElement>('pauseBtn');
    // 止まっているときは再生マーク、動いているときは一時停止マーク。名前は title と読み上げで伝える
    pb.textContent = paused ? '▶' : '❚❚';
    const pauseName = paused ? '再開' : '一時停止';
    if (pb.dataset.tip !== pauseName) {
      setTip(pb, pauseName, '');
      pb.setAttribute('aria-label', pauseName);
    }
    pb.disabled = !battle.started || battle.over;
    for (const b of $('speedSeg').querySelectorAll<HTMLButtonElement>('button'))
      b.setAttribute('aria-pressed', String(Number(b.dataset.s) === speed));
  }
  function renderLog() {
    if (!battle) return;
    // 記録は上限で古い順に捨てられて長さが変わらなくなるので、最新の項目で見る
    const last = battle.log.at(-1) ?? null;
    if (last === logLast) return;
    logLast = last;
    const ol = $('log');
    ol.textContent = '';
    // 新しい順。いちばん新しい1行は見出しに出し、開いたときの一覧には2行目から出す。記録がない間の見出しは「戦況」
    const items = battle.log.slice(-10).reverse();
    const line = (e: (typeof items)[number]) => {
      const tm = document.createElement('time');
      tm.textContent = fmt(e.t);
      const sp = document.createElement('span');
      sp.className = e.side;
      sp.textContent = e.msg;
      return [tm, sp];
    };
    $('logLatest').replaceChildren(...(items.length ? line(items[0]) : ['戦況']));
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'e';
      li.textContent = '出撃すると戦況がここに流れます';
      ol.appendChild(li);
    }
    for (const e of items.slice(1)) {
      const li = document.createElement('li');
      li.append(...line(e));
      ol.appendChild(li);
    }
  }

  function updateHint() {
    const h = $('hint');
    if (terr)
      h.textContent =
        '型を押すと、地形の案を盤面に出します（同じ型をもう一度押すと、別の案になります）。盤面はドラッグで動かし、右ドラッグかShift＋ドラッグで回せます。気に入ったら「決める」、元の地形に戻すなら「やめる」を押します。';
    else if (mode === 'edit') {
      h.textContent = `城域（点線の内側・${ZONE.x1 - ZONE.x0 + 1}×${ZONE.y1 - ZONE.y0 + 1}マス）に配置します。施設と武将は、パネルで選んでから盤面を押すか、パネルから盤面へドラッグして置きます（選んだものをもう一度押すと外れます）。施設や武将にマウスを合わせると、範囲の円が出ます（櫓は撃てる範囲、鼓楼は効き目の範囲、鐘楼は見張りの範囲、武将は敵を見つける範囲と射程など。置く前の影にも出ます）。何も選んでいないときは、名前と能力も出ます（塀なら、その塀の櫓が点数を使う郭と残りの点数）。まず城壁で本丸を囲む塀を作ります。囲むと郭ができ、盤面に色が付きます（二の丸は金、三の丸は緑、本丸を囲まない出丸は橙。広い土地は濃く）。門と弓櫓・鉄砲櫓は、塀の城壁を押すか、城壁の上へドラッグすると、その城壁と置き換わります（消すと城壁に戻ります）。大筒・鼓楼・鐘楼は郭の中に置きます。施設は郭の点数を使います（パネルのボタンに施設の点数。郭の点数は、広い土地${LAND_PER_POINT}マスにつき1点）。本丸から城の外へ、同じ門を通らずに行ける逃げ道を${ESCAPE_ROUTES}本作ります。2本の外の門は、本丸から見て${ESCAPE_ANGLE}度以上開いた所に置き、城の外に面した塀${WALL_PER_GATE}マスにつき1つ、外の門を置きます。同じ郭を囲む塀の上の門どうしは、${GATE_SPACING}マス以上離します（門にマウスを合わせると、その間かくを白い点線の円で示し、近すぎる門を赤い丸で囲んで線で結びます。円は効き目の範囲ではありません）。城壁と施設の数に上限はなく、施設は点数の範囲で置けます。堀（パネルの「堀」。平城だけ）は、川と同じ高さで川につながる所に引けます（川を太くしてもかまいません）。堀を引けるのは平城だけで、数は${MOAT_CAP.flat}マスまでです（引くときは止めず、外れた堀は赤く出ます。開戦までに直します）。川と堀は攻め手も守将も入れますが、とても遅くなり、中にいるあいだは攻撃できません。開戦前の確かめで道（本丸への道・城の門への道・逃げ道）を見るときは、川と堀は橋のほかは渡れないものとし、外周の出撃口づたいにも歩きません。川や堀は郭を区切らないので、川に面した所にも城壁が要ります。門の前後と逃げ道は陸にし、橋の両端は門のほかはふさぎません。門のすぐ外の1マスに堀を引くと、その門は引き橋の門になります（開戦前は橋として数え、戦いでは橋が上がっていて、外からは壊せません。中から壊すと橋が下ります）。橋の両端をどちらも門にすると、川や堀の向こうの郭も、本丸から門を通って入れる郭に数えます。城壁・堀・消去は、なぞると続けて置ける・消せます（Shift を押しながらなぞると、縦か横の一直線になります）。本丸（${HALL.w}×${HALL.h}）は必須で、ほかの施設と同じく置く・消す・動かすことができます（盤面の端から${HALL_MARGIN}マス以上内側）。川と堀の上には何も置けません。地形は「居城の移転」で、新しい土地の案を盤面で確かめてから決めます（決めると、置いたものはすべて消えます）。置いた施設は、何も選んでいないときはドラッグで、道具を選んでいるときは長押ししてから動かします。置いた武将は盤面でドラッグして動かし、パネルの武将（赤枠）を押すと外せます。置く・消すなどの操作は、↶（Ctrl＋Z）で元に戻し、↷（Ctrl＋Y）でやり直せます。キーボードでは、盤面を選んで矢印キー（Shiftで5マス）でマスを動かし、Enterで置く・つかむ・離す、Deleteで消す、Escでやめます。武将はパネルのボタンでEnterを押すと、盤面で置く場所を選べます。`;
    } else if (battle?.over) h.textContent = '';
    else if (battle && !battle.started)
      h.textContent = `武将と兵はパネルから外周の青いマスへドラッグして、出撃の予定に入れます（同じマスに重ねられます）。口の上の目印をつかんで動かすと、口を移せます（別の口の上で離すと重なります）。目印を押すと「軍評定」が開き、全部の口の予定を時間の表で見て、兵の兵種・数・開始（秒）・間隔（秒）と武将の開始（秒）を変えられます（数を打ち込むか、帯や印をつかんで動かす）。予定は開戦から${PLAN_LIMIT / 60}分までで、行の最後の1体が${PLAN_LIMIT / 60}分までに出るように組みます。盤面の下の「基本（平城）」「基本（平山城）」「基本（山城）」で、それぞれの城の作戦の見本を置けます。兵種を選んで外周の青いマスを押しても、予定に入れられます（選んだ兵種をもう一度押すと外れます。何も選んでいないときは、施設や武将にマウスを合わせると情報が出ます）。再生マーク（▶）で開戦し、予定は開戦からの秒数で出撃します。開戦したあとは、兵種を外周へドラッグするか、兵種を選んで外周を押すと、すぐに出せます（${PLAN_LIMIT / 60}分まで）。スペースで一時停止。`;
    else
      h.textContent = `開戦から${PLAN_LIMIT / 60}分までは、兵種を外周へドラッグするか、兵種を選んで外周を押すと、外周のどこからでも投入できます。何も選んでいないときは、施設や武将にマウスを合わせると情報が出ます。`;
  }

  // ---- モード切替 ---------------------------------------------------------
  function setMode(m: Mode) {
    mode = m;
    // 居城の移転の窓を開いたままなら、やめて元の地形に戻す（mode を先に入れ、ほかの画面ではフォーカスを動かさない）
    closeTerrain(false);
    // 盤面をキーボードで操作できるのは配置画面だけなので、ほかの画面ではTabで止まらないようにする
    cv.tabIndex = m === 'edit' ? 0 : -1;
    endPaint(); // ドラッグやなぞりの途中なら後始末する（指の位置のキャラも消す）
    council.close(); // 軍評定は攻城の開戦前だけのもの
    $('tabUnits').setAttribute('aria-selected', String(m === 'units'));
    $('layoutMain').hidden = m === 'units';
    $('unitsView').hidden = m !== 'units';
    $('tabEdit').setAttribute('aria-selected', String(m === 'edit'));
    $('tabBattle').setAttribute('aria-selected', String(m === 'battle'));
    $('panelEdit').hidden = m !== 'edit';
    $('presetBar').hidden = m !== 'edit';
    $('siegeBar').hidden = m !== 'battle';
    $('battleHud').hidden = m !== 'battle';
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
  // 予定 d の口のうち、今の地形で出撃口にできない所（口のマスか、兵をずらして出す先が平地でない・川）にあるものは、
  // いちばん近い出撃口にできるマスへ動かす。動かしたら true
  function snapGatesOf(d: Draft) {
    let moved = false;
    const used = new Set(d.gates.filter((g) => canGateAt(layout, g.x, g.y)).map((g) => `${g.x},${g.y}`));
    for (const g of d.gates) {
      if (canGateAt(layout, g.x, g.y)) continue;
      // ほかの口と重ならない、いちばん近いマス
      const p = nearestGate(layout, g.x, g.y, (x, y) => used.has(`${x},${y}`));
      if (!p) continue;
      g.x = p.x;
      g.y = p.y;
      used.add(`${p.x},${p.y}`);
      moved = true;
    }
    return moved;
  }
  function snapGates() {
    if (snapGatesOf(siege)) saveSiege();
  }
  function newBattle() {
    endPaint(); // パネルからドラッグしている途中なら片付ける
    snapGates();
    battle = createBattle(layout);
    manualOld = true;
    paused = false;
    acc = 0;
    resultShown = false;
    logLast = undefined;
    resetSched();
    council.close();
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
  // 手動で先に出した武将の予定と、開戦後に出撃できる時間（2分）を過ぎた予定は数えない
  function genCount() {
    if (!battle) return 0;
    const b = battle;
    const rest = b.started ? pendingPlan() : (sched?.plan ?? []);
    const pending = rest.filter((p) => ADEF[p.kind].general && !(b.used[p.kind] ?? 0)).length;
    return generalsUsed(b) + pending;
  }
  // まだ出ていない予定のうち、出撃できる時間（開戦から PLAN_LIMIT 秒）までに出るもの。
  // 予定は PLAN_LIMIT 秒までに収めて組むので、ふつうはまだ出ていない予定のすべて
  function pendingPlan() {
    if (!sched) return [];
    return sched.plan.slice(sched.i).filter((p) => p.tick <= PLAN_TICKS);
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
    if ((battle.used[k] ?? 0) > 0) return `${d.name}はすでに出撃しています`;
    // 同じ武将は予定と手動で2人出せない。兵は、予定の分の兵力を残せば同じ兵種でも手動で出せる
    if (pendingPlan().some((p) => p.kind === k)) return `${d.name}は出撃の予定に入っています`;
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
  }
  // 軍評定：出撃の予定を時間の表で見て直す窓（council.ts）。口の目印を押すと開く
  const council = createCouncil($<HTMLDialogElement>('council'), {
    siege: () => siege,
    changed: siegeChanged,
  });
  // 口の目印：攻城の開戦前だけ、口の上に出す。盤面を回したり動かしたりしても付いていくよう、毎コマ置き直す
  const pins = $('gatePins');
  function updatePins() {
    const show = mode === 'battle' && isPre() && siege.gates.length > 0;
    pins.hidden = !show;
    if (!show) return;
    while (pins.children.length < siege.gates.length) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'gatePin';
      b.innerHTML =
        '<svg viewBox="0 0 24 32" aria-hidden="true"><path d="M12 31C12 31 2 18.5 2 11a10 10 0 0 1 20 0c0 7.5-10 20-10 20z"/></svg><b></b>';
      b.addEventListener('click', () => council.open(Number(b.dataset.gate)));
      addPinDrag(b);
      pins.append(b);
    }
    while (pins.children.length > siege.gates.length) pins.lastElementChild?.remove();
    // 位置を先にまとめて読み、そのあとで書く（読みと書きを交互にすると、口ごとに配置の計算をやり直させるため）
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    const ox = cv.offsetLeft;
    const oy = cv.offsetTop;
    const at = siege.gates.map((g, gi) => {
      // 口に並ぶ駒（3つまで描く）の頭の上に出す
      const kinds = siege.rows
        .filter((r) => r.gate === gi)
        .map((r) => r.kind)
        .slice(0, 3);
      // つかんでいる目印は、盤面の上なら、移す先のマスに立てる
      const p = pinDrag === gi && hover ? hover : g;
      return renderer.gateTop(p.x, p.y, kinds);
    });
    siege.gates.forEach((_, gi) => {
      const b = pins.children[gi] as HTMLButtonElement;
      // 口が盤面に映っていない（カメラの向きで外に出た）ときも押せるよう、目印は盤面の端に寄せて出す
      // （目印は先の尖りを頭の上に合わせ、上へ 34px 伸びる）
      b.style.left = `${ox + clamp(at[gi].x, 13, w - 13)}px`;
      b.style.top = `${oy + clamp(at[gi].y, 34, h)}px`;
      // 番号と名前は、変わったときだけ書く
      const no = String(gi + 1);
      if (b.dataset.gate !== String(gi)) b.dataset.gate = String(gi);
      const num = b.lastElementChild as HTMLElement;
      if (num.textContent !== no) num.textContent = no;
      const label = `${gateLabel(siege, gi)}の軍評定を開く（つかんで動かすと、口を移す）`;
      if (b.title !== label) {
        b.title = label;
        b.setAttribute('aria-label', label);
      }
    });
  }
  // 窓（情報の窓）をマスの近くに出す。上半分のマスなら下に、下半分のマスなら上に gap だけ離して出し、
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
  // ---- 施設・武将の情報 ---------------------------------------------------
  // 何も選んでいないときに、マウスを合わせた施設や武将の名前と能力を出す。戦闘中は今の体力も出す
  const info = $('infoPop');
  let infoKey = '';
  const num = (v: number, d = 0) => (Number.isInteger(v) ? String(v) : v.toFixed(d));
  // 能力の行（名前・値）。施設・武将に共通の項目を、持っているものだけ並べる。
  // 射程（大筒の撃てない近さも）・見つける範囲・効果の範囲は、マウスを合わせたときの円でわかるので出さない
  function statRows(d: { dmg?: number; cd?: number }) {
    const rows: [string, string][] = [];
    const dmg = d.dmg;
    if (dmg) rows.push(['攻撃', num(dmg)]);
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
      // 鼓楼・鐘楼は攻撃しないので、効果を出す（効果の範囲は円でわかる）
      if (t === 'drum')
        rows.push(['効果', `守将と櫓・大筒の攻撃が ×${num(BDEF.drum.rate ?? 1, 1)} の速さ（重ならない）`]);
      if (t === 'bell') rows.push(['効果', `周囲${num(BDEF.bell.aura ?? 0, 1)}マスの敵を、離れた守将にも知らせる`]);
      return {
        title: d.name,
        hp: d.unbreakable ? '壊せない' : hpOf(hp ?? 0, max, hp !== null),
        rows,
      };
    };
    const cx = p.x + 0.5;
    const cy = p.y + 0.5;
    const b = mode === 'battle' ? battle : null;
    if (b) {
      // 守りの兵（呼ばれた騎兵）は、武将の札を出さない
      const u = b.defenders.find((d) => d.hp > 0 && isGeneralDefender(d) && Math.hypot(d.x - cx, d.y - cy) < 0.75);
      if (u && isGeneralDefender(u)) return { ...gen(u.kind, u.hp), hp: hpOf(u.hp, u.maxHp, true) };
      const a = b.attackers.find((d) => d.hp > 0 && ADEF[d.kind].general && Math.hypot(d.x - cx, d.y - cy) < 0.75);
      if (a) {
        const d = ADEF[a.kind];
        // 攻め手の武将には射程の円を出さないので、射程はここに出す
        const rows = statRows(d);
        if (d.range) rows.push(['射程', `${num(d.range, 1)}マス`]);
        return { title: d.name, hp: hpOf(a.hp, a.maxHp, true), rows };
      }
      const e = b.buildings.find((q) => q.hp > 0 && p.x >= q.x0 && p.x < q.x0 + q.w && p.y >= q.y0 && p.y < q.y0 + q.h);
      if (e) return bld(e.type, e.hp, e.maxHp);
    }
    const g = mode === 'edit' ? generalAt(p) : null;
    if (g) return gen(g.kind, null);
    const pb = layout.buildings.find((q) => {
      const f = fpOf(q);
      return p.x >= f.x0 && p.x < f.x0 + f.w && p.y >= f.y0 && p.y < f.y0 + f.h;
    });
    if (pb && !b) {
      const it = bld(pb.type, null, BDEF[pb.type].hp);
      // 塀（城壁・門・櫓）なら、その塀の上の櫓が点数を使う郭と、その郭の残りの点数
      if (ON_LINE.includes(pb.type)) {
        const cs = castleNow();
        const k = wallOwner(layout, cs, pb.x, pb.y);
        if (k !== null) {
          const info = cs.kuruwa[k];
          it.rows.push(['郭', `${info.name}（点数 残り ${info.points - info.used}）`]);
        }
      }
      // 門に合わせると、盤面に門の間かくの白い点線の円が出る。効果の範囲と取り違えないよう、何の円かをここに書く
      if (pb.type === 'gate') {
        const peers = closePeers(castleNow(), pb);
        it.rows.push(['白い点線', `門どうしの間かく ${GATE_SPACING}マス`]);
        if (peers.length) it.rows.push(['近すぎる門', peers.map((q) => gateGap(pb, q)).join('・')]);
      }
      return it;
    }
    return null;
  }
  // 道具を選んでいるとき（パネルからドラッグしているときも）、マウスの下のマスに置いたらどうなるか。
  // 門・施設だけ出す。配置が変わるか、マスか道具が変わったときだけ求め直す（盤面全体を調べるので）
  let previewKey = '';
  let previewInfo: { title: string; hp: string; rows: [string, string][] } | null = null;
  function previewAt(t: BuildingType, p: Tile) {
    const key = `${t}|${p.x},${p.y}|${layoutRev}`;
    if (key === previewKey) return previewInfo;
    previewKey = key;
    previewInfo = null;
    if (t !== 'gate' && !isFacilityType(t)) return null;
    const r = placePreview(layout, t, p.x, p.y);
    const d = BDEF[t];
    const rows: [string, string][] = [];
    if (!r.ok) rows.push(['置けない', r.msg || '他の配置と重なります']);
    else if (r.kuruwa !== undefined && r.used !== undefined && r.points !== undefined) {
      rows.push(['郭', r.kuruwa]);
      rows.push(['点数', `${d.cost} 点（置くと 残り ${r.points - r.used}）`]);
    }
    previewInfo = rows.length ? { title: d.name, hp: '', rows } : null;
    return previewInfo;
  }
  // 毎フレーム呼ぶ。中身が変わったときだけ書き直す
  function updateInfoPop() {
    const p = hover;
    const none =
      mode === 'edit' ? !tool && !drag && !facDrag : mode === 'battle' && !unitSel && !siegeDrag && pinDrag === null;
    const placing =
      mode === 'edit' && !drag
        ? ((facDrag !== 'moat' ? facDrag : null) ?? (tool && tool !== 'erase' && isBuildingType(tool) ? tool : null))
        : null;
    const it = !p || council.isOpen ? null : none ? infoAt(p) : placing ? previewAt(placing, p) : null;
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
  // 全消去：予定の武将と兵、口をすべて消す（防御の全消去と同じく、確かめずに消す）
  $('siegeClear').addEventListener('click', () => {
    setSiege(emptyDraft());
  });
  // 開戦：時計を動かし、予定の武将と兵を開戦からの秒数で出す
  $('startBtn').addEventListener('click', () => {
    if (!battle || !isPre() || whyNotReady()) return;
    endPaint(); // 目印をつかんだまま開戦したら、つかむのをやめる
    battle.started = true;
    council.close();
    refreshBattlePanel();
    updateHint();
  });

  // ---- 入力 ---------------------------------------------------------------
  const tileAt = (e: PointerEvent) => renderer.tileAt(e.clientX, e.clientY);
  function unplaceGeneral(k: GeneralKind) {
    removeGeneral(layout, k);
    commitLayout();
  }
  // quiet：なぞって通ったマスでは、置けなくても知らせを出さない（マスを通るたびに知らせが出ないように）
  // later：なぞりで何マスもまとめて当てるときは、保存とパネルの更新を呼ぶ側で最後に1回だけ行う。置けたかを返す
  function applyEdit(x: number, y: number, quiet = false, later = false): boolean {
    if (!tool) return false;
    const key = `${tool}${x},${y}`;
    if (key === lastPaint) return false;
    lastPaint = key;
    const r = place(layout, tool, x, y);
    if (r.ok) {
      // 武将は1人ずつなので、置いたら選ぶのをやめる
      if (isGeneralKind(tool)) {
        tool = null;
        updateHint();
      }
      if (!later) {
        commitLayout();
      }
    } else if (!quiet) toast(r.msg);
    return r.ok;
  }
  // ドラッグ中、盤面の外では指の位置にキャラを出す（盤面の上では、置くマスに影を出す）
  const dragFloat = document.createElement('canvas');
  dragFloat.className = 'dragFloat';
  dragFloat.width = dragFloat.height = DRAG_ICON;
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
      commitLayout();
    }
    return r;
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
        stroke = startStroke(p, e.shiftKey);
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
    if (ignored(e) || kbdDrag) return;
    // 盤面を回している間は、なぞりを止める。回し終えたら、そのときのマスから引き直す（回す前のマスとの間を埋めない）
    if (renderer.busy) {
      stroke = null;
      return;
    }
    if (drag) {
      dragMove(e);
      return;
    }
    const p = tileAt(e);
    hover = p;
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
      stroke = startStroke(press, e.shiftKey);
      cancelPress();
    }
    if (mode === 'edit' && painting && (tool === 'wall' || tool === 'moat' || tool === 'erase')) {
      // 盤面の外に出たら、戻ったマスから引き直す（出たマスと戻ったマスの間の、通っていないマスを埋めない）
      if (p) paintTo(p, e.shiftKey);
      else stroke = null;
    }
    updateCursor();
  });
  // ホイールで寄る・引くか、ページを送ると、マウスが止まったままマスが変わるので、なぞりは次のマスから引き直す
  cv.addEventListener(
    'wheel',
    () => {
      if (painting) stroke = null;
    },
    { passive: true },
  );
  // ページを送ると、マウスが止まったまま下のマスが変わるが、pointermove は来ない。
  // なぞりと長押しは、なぞっていないマスを埋めないようにやめ、影や情報の窓は今のマスへ移す
  let mouseAt: PointerEvent | null = null;
  window.addEventListener(
    'pointermove',
    (e) => {
      mouseAt = e;
    },
    { capture: true, passive: true },
  );
  window.addEventListener(
    'scroll',
    () => {
      if (painting) stroke = null;
      cancelPress();
      if (!mouseAt || kbdDrag || cursorShown()) return;
      if (drag) dragMove(mouseAt);
      else {
        hover = tileAt(mouseAt);
        updateCursor();
      }
    },
    { passive: true },
  );
  // なぞって置く・消すを、マス p まで進める（間のマスも埋める。Shift で縦横の一直線）。
  // 引き直すとき（stroke がないとき）は、p から始める
  function paintTo(p: Tile, shift: boolean) {
    const cells = stroke ? strokeTo(stroke, p, shift) : [p];
    stroke ??= startStroke(p, shift);
    let done = false;
    for (const c of cells) done = applyEdit(c.x, c.y, true, true) || done;
    if (done) {
      commitLayout();
    }
  }
  function endPaint() {
    cancelPress();
    grabFrom = null;
    painting = false;
    strokeSaved = false;
    lastPaint = '';
    stroke = null;
    drag = null;
    kbdDrag = false;
    kbdFrom = null;
    siegeDrag = null;
    pinDrag = null;
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
      // 長押しにならずに離したときは、今までどおりそのマスに置こうとする（置けなければ知らせを出す）
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
  });

  // ---- キーボードでの配置 -------------------------------------------------
  // 盤面にフォーカスがあるとき、選んでいるマスに枠を出す（マウスで押してフォーカスしたときは出さない）
  // :focus-visible だけで決めると、マウスで押したあとに Shift（一直線に引く）や Ctrl＋Z を押しても
  // 枠が出てしまう。そのため、Tab で移ってきたときと、配置に使うキーを押したときだけ出し、
  // 盤面をマウスで押したら消す
  let kbdActive = false;
  const cursorShown = () => mode === 'edit' && kbdActive;
  // 右・中ボタン（盤面を回す・動かす）と2本目の指では消さない
  cv.addEventListener('pointerdown', (e) => {
    if (!ignored(e) && !camButton(e)) kbdActive = false;
  });
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
        commitLayout();
        say(describe(c));
      } else fail(r.msg || 'ここには消せるものがありません', c);
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
    commitLayout();
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
    if (key || ['Enter', ' ', 'Delete', 'Backspace'].includes(e.key)) kbdActive = true;
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
    kbdActive = cv.matches(':focus-visible');
    if (!cursorShown()) return;
    hover = cursor;
    say(`${describe(cursor)}。矢印キーでマスを選び、Enterで置く・つかむ、Deleteで消します`);
  });
  // 盤面からフォーカスが外れたら、キーボードでつかんでいるものは元の位置に戻す
  cv.addEventListener('blur', () => {
    kbdActive = false;
    if (kbdDrag) endPaint();
  });

  $('tabEdit').addEventListener('click', () => setMode('edit'));
  $('tabBattle').addEventListener('click', () => setMode('battle'));
  $('tabUnits').addEventListener('click', () => setMode('units'));
  $('retryBtn').addEventListener('click', newBattle);
  // 結果の枠を閉じたら、攻城の開戦前に戻る（✕・枠の外を押す・Esc）。
  // 枠の中にフォーカスがあったとき（枠の外を押して body に移ったときも）は、「開戦」へ移す（閉じた ✕ に残さない）
  function closeResult() {
    const a = document.activeElement;
    const lost = !a || a === document.body || $('overlay').contains(a);
    newBattle();
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
      if (isPresetId(id)) setLayout(preset(id), true);
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
  // 全消去：施設と武将と堀をすべて消す。地形・川・橋はそのまま残す（見出しの右のボタン）
  $('clearBtn').addEventListener('click', () => {
    setLayout({ ...layout, buildings: [], generals: [], moat: undefined });
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
    // 手で出したマスをそのまま口にすると、口にできない所（両隣が平地でないなど）になることがあるので、今の地形に合わせる
    let dropped = 0;
    if (manualLog.length) {
      dropped = addDeploys(d, manualLog);
      snapGatesOf(d);
    }
    recJson.value = JSON.stringify(d);
    // 予定と合わせて兵力・武将の人数を超えたり、同じ武将がすでに予定にいたりする手動の出撃は、予定に入らない
    toast(dropped ? `書き出しました（手で出した ${dropped} 回の出撃は予定に入れられませんでした）` : '書き出しました');
  });
  // 攻城配置を入れ替える（基本・全消去・読み込み）。戦いの途中なら、開戦前に戻す
  function setSiege(d: Draft) {
    endPaint(); // 目印をつかんだままなら、古い口の番号で動かさないよう、つかむのをやめる
    manualLog = []; // 予定を入れ替えたので、前の戦いの手動の出撃はまとめない
    siege = d;
    // 口を今の地形に合わせる（別の城の出撃記録を読み込んだときなど）。戦いの途中なら開戦前に戻す（newBattle も口を合わせる）
    if (battle?.started || battle?.over) newBattle();
    else snapGatesOf(siege);
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
  // 編成例：城の型ごとの基本を置き、出撃記録の欄にも出す。予定だけを入れ替え、盤面の城はそのまま
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-siege]')) {
    b.addEventListener('click', () => {
      const id = b.dataset.siege;
      if (!isPresetId(id)) return;
      setSiege(basicSiege(id));
      recJson.value = JSON.stringify(siege);
    });
  }
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
      toast('配置記録を読み込めません（形式・範囲・個数を確認）');
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
        : // 兵力を残したまま出撃できる時間（2分）を過ぎ、攻め手がいなくなったとき
          b.tick > PLAN_TICKS && b.budgetA > 0
          ? '出撃できる時間を過ぎ、攻め手が尽きた。本丸は健在'
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

  // ---- メインループ -------------------------------------------------------
  let last = performance.now();
  // 置いた武将のパネルのキャラを歩かせる
  const WALK: readonly BigPick[] = [0, 1, 2, 3].map((i) => ({ action: 'walk', i }));
  // 動きを減らす設定のときは、立ち姿のまま
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  function walkGenPix(now: number) {
    const frame = still.matches ? BIG_STAND : WALK[Math.floor(now / 160) % WALK.length];
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
    const frame = still.matches ? BIG_STAND : WALK[Math.floor(siegeWalkT / 160) % WALK.length];
    for (const b of $('genUnitGrid').querySelectorAll<HTMLElement>('[data-unit]')) {
      const k = b.dataset.unit ?? '';
      const pix = b.querySelector<HTMLCanvasElement>('.gpix');
      const sched = b.classList.contains('sched');
      if (pix && isAttackerKind(k)) drawUnitPix(pix, k, atkColor, sched ? frame : BIG_STAND);
    }
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    readGenColors();
    // 居城の移転の窓を開いている間は、後ろのメニューを案の配置で作り直さない（閉じるときに作り直す）
    if (!terr) refreshEditPanel();
    for (const pix of $('toolgrid').querySelectorAll<HTMLCanvasElement>('.fpix')) {
      const t = pix.dataset.facility ?? '';
      if (isBuildingType(t) || t === 'moat') renderer.drawIcon(pix, t);
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
    updatePins();
    const b = battle;
    if (mode === 'battle' && b && b.started && !b.over && !paused) {
      acc += dt * speed;
      const before = b.tick;
      let n = 0;
      while (acc >= DT && n < 40 && !b.over) {
        // 攻城配置の予定は、開戦からの秒数で出す。出せなかったら知らせる
        if (sched) for (const f of deployDue(b, sched)) toast(`${ADEF[f.kind].name}は出撃できませんでした（${f.msg}）`);
        step(b);
        acc -= DT;
        n++;
      }
      if (n >= 40) acc = 0;
      // 出撃できる時間（開戦から PLAN_LIMIT 秒）を過ぎたら、兵と武将のボタンを押せなくする
      if (before <= PLAN_TICKS && b.tick > PLAN_TICKS) refreshBattlePanel();
      renderLog();
      if (b.over && !resultShown) {
        resultShown = true;
        showResult(b);
      }
    }
    // パネルからドラッグしている兵・武将か、つかんでいる口の先頭の兵・武将があれば、選んでいる兵種の代わりに、その影を出す
    const pinKind = siege.rows.find((r) => r.gate === pinDrag)?.kind;
    const shown = siegeDrag ?? pinKind ?? unitSel;
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
                canPlan: (x: number, y: number) =>
                  pinKind ? canGateAt(layout, x, y) : !!shown && canPlan(shown, x, y),
              }
            : null,
        deployOk: !!battle && !!shown && !isPre() && canDeploy(battle, shown) && manualBlock(shown) === null,
        castle: mode === 'edit' ? castleNow() : null,
        layoutRev,
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
  const sampleDlg = createSampleDialog();
  initCompare(renderer.drawIcon, sampleDlg.open);
  readGenColors();
  buildEditTools();
  refreshEditPanel();
  updateHint();
  document.fonts?.load('800 20px "Shippori Mincho B1"', '歩弓騎車将猛謀櫓門本丸壁出撃エリア').catch(() => {});
  // 開発サーバーでだけ、マスと画面の位置の対応を外から聞けるようにする（ヘッドレスブラウザで決まったマスを押すため。
  // docs/development.md）。公開の版を作るときは import.meta.env.DEV が false になり、この部分は取り除かれる
  if (import.meta.env.DEV) {
    (window as unknown as { joseniq: unknown }).joseniq = {
      // マスの中心が見えている位置（clientX・clientY と同じく、見えている範囲の左上から）。
      // スクロールなどで見えている範囲の外にあるときは、押せないので null
      tileToClient: (x: number, y: number) => {
        const r = cv.getBoundingClientRect();
        const c = renderer.tileCenter(x, y);
        const p = { x: r.left + c.x, y: r.top + c.y };
        return p.x >= 0 && p.y >= 0 && p.x < window.innerWidth && p.y < window.innerHeight ? p : null;
      },
      // その位置に見えているマス（盤面の外なら null）
      tileAt: (clientX: number, clientY: number) => renderer.tileAt(clientX, clientY),
      // 今の戦いで出撃した記録（ティック・兵種・マス）。戦いがなければ null
      deploys: () => (battle ? battle.deployLog.map((r) => ({ ...r })) : null),
    };
  }
  // 保存の失敗は黙って進めず、画面で知らせる
  store.onFail = () => toast('保存できませんでした。閉じると、今の内容は残りません');
  if (unreadable) toast('保存を読めなかったので、初めの内容で始めます');
  requestAnimationFrame(loop);
}
