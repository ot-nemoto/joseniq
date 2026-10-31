// 軍評定：攻城の出撃の予定を、時間の表で見て直す窓。縦に兵の行と武将、横に時間（開戦から PLAN_LIMIT 秒まで）。
// 口ごとにまとめて出し、開いた口を目立たせる。数・開始・間隔は打ち込むほか、マウスでも動かせる
// （兵の行は帯をつかむと開始、右端をつかむと間隔。武将は印をつかむと開始）。上限は予定のリストと同じ決まり（plan.ts）
import {
  ADEF,
  type AttackerKind,
  addTroopAt,
  BUDGET_A,
  clamp,
  type Draft,
  type DraftRow,
  draftCost,
  GENERAL_ORDER,
  type GeneralKind,
  gateDir,
  isGeneralKind,
  MAX_GENERALS,
  maxRowN,
  PLAN_LIMIT,
  putGeneralAt,
  removeGeneralFrom,
  removeRow,
  rowDtMax,
  rowNByTime,
  rowT0Max,
  setRowKind,
  UNIT_ORDER,
} from '../sim';

export interface CouncilHost {
  siege: () => Draft; // 今の予定（直接書き換える）
  changed: () => void; // 予定を変えたあと（保存・出撃の並び・パネルの更新）
}

const TROOPS = UNIT_ORDER.filter((k) => !isGeneralKind(k));
const T0_STEP = 0.1;
const DT_STEP = 0.05;
// 時間の目盛（秒）
const TICKS = [0, 20, 40, 60, 80, 100, PLAN_LIMIT];
const pct = (t: number) => `${(t / PLAN_LIMIT) * 100}%`;
const fmtSec = (t: number) => (t >= 60 ? `${Math.floor(t / 60)}分${t % 60 ? `${t % 60}秒` : ''}` : `${t}秒`);
const nameOf = (k: AttackerKind) => ADEF[k].busho ?? ADEF[k].name;
// 口の呼び名。同じ向きの口があっても見分けられるよう、番号を付ける（盤面の目印と同じ番号）
export const gateLabel = (d: Draft, gi: number) => `口${gi + 1}（${gateDir(d.gates[gi])}）`;
// 刻み step にそろえ、0〜hi に収める（hi も刻みに切り下げて、上限を超えないようにする）
function snap(v: number, hi: number, step: number) {
  const max = Math.floor(hi / step + 1e-9) * step;
  return +clamp(Math.round(v / step) * step, 0, max).toFixed(4);
}
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export function createCouncil(dlg: HTMLDialogElement, host: CouncilHost) {
  // 開いた口（目立たせる）。行を外して口が消えると番号が詰まるので、口の位置で覚える
  let focusAt: { x: number; y: number } | null = null;
  // 「＋兵を追加」「＋武将を追加」の欄（打ち込みのたびに、押せる・押せないを直す）
  let adds: { troop: HTMLSelectElement; gen: HTMLSelectElement }[] = [];
  const body = el('div', 'cnBody');
  // 知らせ：窓は盤面の知らせより前に重なるので、窓の中に出す
  const msg = el('p', 'cnMsg');
  msg.setAttribute('role', 'status');
  msg.hidden = true;
  let msgTimer = 0;
  function say(text: string) {
    if (!text) return;
    msg.textContent = text;
    msg.hidden = false;
    clearTimeout(msgTimer);
    msgTimer = window.setTimeout(() => {
      msg.hidden = true;
    }, 2500);
  }
  const sum = el('span', 'cnSum');
  const close = el('button', 'cnClose', '✕');
  close.type = 'button';
  close.setAttribute('aria-label', '閉じる');
  close.addEventListener('click', () => dlg.close());
  const head = el('header', 'cnHead');
  const title = el('h2', '', '軍評定');
  title.id = 'councilTitle';
  head.append(title, sum, close);
  dlg.setAttribute('aria-labelledby', 'councilTitle');
  dlg.append(head, msg, body);
  // 窓の外（背景）を押したら閉じる
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });

  // 予定を変えた：保存などをして、窓を作り直す
  function commit() {
    host.changed();
    render();
  }

  // 見出しの兵力・武将の人数と、追加の欄の押せる・押せないを、今の予定に合わせる
  function refreshHead() {
    const d = host.siege();
    const { spent, generals } = draftCost(d);
    sum.textContent = `兵力 ${spent} / ${BUDGET_A}　武将 ${generals} / ${MAX_GENERALS}`;
    // 1体でも追加できる兵種がなければ（兵力を使い切っていれば）押せなくする
    const noTroop = spent + Math.min(...TROOPS.map((k) => ADEF[k].cost)) > BUDGET_A;
    for (const a of adds) {
      a.troop.disabled = noTroop;
      a.gen.disabled = generals >= MAX_GENERALS || a.gen.options.length < 2;
    }
  }

  // 数を打ち込む欄。窓は作り直さない（作り直すと、打っている欄が消えて、Enter・Tab・↑↓で入力の場所が外れるため）。
  // その行と見出しだけを、今の値に合わせる
  function field(
    label: string,
    get: () => number,
    step: number,
    hi: () => number,
    set: (v: number) => void,
    over: (max: number) => string,
    repaint: () => void,
  ) {
    const lab = el('label', 'cnField');
    const inp = el('input');
    inp.type = 'number';
    inp.inputMode = 'decimal';
    inp.min = '0';
    inp.step = String(step);
    inp.value = String(get());
    inp.addEventListener('input', () => {
      const v = Number(inp.value);
      if (inp.value === '' || !Number.isFinite(v)) return;
      const max = snap(hi(), hi(), step);
      if (v > max) say(over(max));
      set(clamp(v, 0, max));
      host.changed();
      repaint();
      refreshHead();
    });
    // 打ち終えたら、予定に入った値（範囲に収め、数は整数にした値）を欄にも出す
    inp.addEventListener('change', () => {
      if (inp.value === '' || !Number.isFinite(Number(inp.value))) inp.value = '0';
      inp.dispatchEvent(new Event('input'));
      inp.value = String(get());
    });
    lab.append(label, inp);
    return lab;
  }

  // 横につかんで動かす。秒の差 ds を渡し続け、離したら予定を確かめて作り直す
  function dragX(handle: HTMLElement, track: HTMLElement, move: (ds: number) => void) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);
      const x0 = e.clientX;
      const w = track.getBoundingClientRect().width || 1;
      const onMove = (ev: PointerEvent) => move(((ev.clientX - x0) / w) * PLAN_LIMIT);
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        commit();
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  }

  // 兵の行の帯と印を、今の値で描き直す
  function paintTroop(track: HTMLElement, bar: HTMLElement, r: DraftRow) {
    const last = r.t0 + r.dt * (r.n - 1);
    bar.style.left = pct(r.t0);
    // 1体目から最後の1体までを、印の半分（7px）ずつはみ出して包む
    bar.style.width = `calc(${pct(last - r.t0)} + 14px)`;
    for (const d of track.querySelectorAll('.cnDot')) d.remove();
    for (let k = 0; k < r.n; k++) {
      const dot = el('i', 'cnDot');
      dot.style.left = pct(r.t0 + r.dt * k);
      track.append(dot);
    }
  }

  function troopRow(d: Draft, r: DraftRow) {
    const row = el('div', 'cnRow');
    const ctl = el('div', 'cnCtl');
    const track = el('div', 'cnTrack');
    const kind = el('select', 'cnKind');
    kind.setAttribute('aria-label', '兵種');
    for (const k of TROOPS) {
      const o = el('option', '', ADEF[k].name);
      o.value = k;
      o.selected = k === r.kind;
      kind.append(o);
    }
    kind.addEventListener('change', () => {
      const res = setRowKind(d, d.rows.indexOf(r), kind.value as AttackerKind);
      if (!res.ok) say(res.msg);
      commit();
    });
    const bar = el('div', 'cnBar');
    bar.title = 'つかんで左右に動かすと、開始が変わる';
    const end = el('span', 'cnEnd');
    end.title = 'つかんで伸び縮みさせると、間隔が変わる';
    if (r.n > 1) bar.append(end);
    track.append(bar);
    const inputs: HTMLInputElement[] = [];
    const repaint = () => {
      paintTroop(track, bar, r);
      [r.n, r.t0, r.dt].forEach((v, i) => {
        if (inputs[i] && document.activeElement !== inputs[i]) inputs[i].value = String(v);
      });
    };
    const n = field(
      '数',
      () => r.n,
      1,
      () => maxRowN(d, d.rows.indexOf(r)),
      (v) => {
        r.n = Math.max(1, Math.round(v));
      },
      (max) =>
        rowNByTime(r) <= max
          ? `開戦から${PLAN_LIMIT / 60}分までに出せるのは ${max} 体までです`
          : `兵力が足りません（この行は ${max} まで）`,
      repaint,
    );
    const t0 = field(
      '開始',
      () => r.t0,
      T0_STEP,
      () => rowT0Max(r),
      (v) => {
        r.t0 = v;
      },
      (max) => `開始（秒）は ${max} までです`,
      repaint,
    );
    const dt = field(
      '間隔',
      () => r.dt,
      DT_STEP,
      () => rowDtMax(r),
      (v) => {
        r.dt = v;
      },
      (max) => `間隔（秒）は ${max} までです`,
      repaint,
    );
    for (const f of [n, t0, dt]) inputs.push(f.querySelector('input') as HTMLInputElement);
    const del = el('button', 'cnDel', '×');
    del.type = 'button';
    del.setAttribute('aria-label', `${ADEF[r.kind].name}の行を外す`);
    del.addEventListener('click', () => {
      removeRow(d, d.rows.indexOf(r));
      commit();
    });
    ctl.append(kind, n, t0, dt, del);
    // 帯をつかむと開始、右端をつかむと間隔（数はそのまま）
    let base = { t0: r.t0, dt: r.dt };
    const remember = () => {
      base = { t0: r.t0, dt: r.dt };
    };
    bar.addEventListener('pointerdown', remember, true);
    dragX(bar, track, (ds) => {
      r.t0 = snap(base.t0 + ds, rowT0Max(r), T0_STEP);
      repaint();
      host.changed();
    });
    dragX(end, track, (ds) => {
      if (r.n < 2) return;
      const lastAt = base.t0 + base.dt * (r.n - 1) + ds;
      r.dt = snap((lastAt - r.t0) / (r.n - 1), rowDtMax(r), DT_STEP);
      repaint();
      host.changed();
    });
    paintTroop(track, bar, r);
    row.append(ctl, track);
    return row;
  }

  function generalRow(d: Draft, r: DraftRow) {
    const row = el('div', 'cnRow gen');
    const ctl = el('div', 'cnCtl');
    const track = el('div', 'cnTrack');
    const mark = el('div', 'cnMark');
    mark.title = 'つかんで左右に動かすと、出る時刻が変わる';
    track.append(mark);
    let input: HTMLInputElement | null = null;
    const repaint = () => {
      mark.style.left = pct(r.t0);
      if (input && document.activeElement !== input) input.value = String(r.t0);
    };
    const t0 = field(
      '開始',
      () => r.t0,
      T0_STEP,
      () => PLAN_LIMIT,
      (v) => {
        r.t0 = v;
      },
      (max) => `開始（秒）は ${max} までです`,
      repaint,
    );
    input = t0.querySelector('input');
    const del = el('button', 'cnDel', '×');
    del.type = 'button';
    del.setAttribute('aria-label', `${nameOf(r.kind)}を予定から外す`);
    del.addEventListener('click', () => {
      removeGeneralFrom(d, r.kind as GeneralKind);
      commit();
    });
    ctl.append(el('b', 'cnName', nameOf(r.kind)), t0, del);
    let base = r.t0;
    mark.addEventListener(
      'pointerdown',
      () => {
        base = r.t0;
      },
      true,
    );
    dragX(mark, track, (ds) => {
      r.t0 = snap(base + ds, PLAN_LIMIT, T0_STEP);
      repaint();
      host.changed();
    });
    repaint();
    row.append(ctl, track);
    return row;
  }

  // 口に兵や武将を追加する欄
  function addControls(d: Draft, gi: number) {
    const box = el('div', 'cnAdd');
    const g = d.gates[gi];
    const troop = el('select');
    troop.setAttribute('aria-label', `${gateLabel(d, gi)}に兵を追加`);
    troop.append(el('option', '', '＋兵を追加'));
    for (const k of TROOPS) {
      const o = el('option', '', `${ADEF[k].name}（兵力 ${ADEF[k].cost}）`);
      o.value = k;
      troop.append(o);
    }
    troop.addEventListener('change', () => {
      const res = addTroopAt(d, troop.value as AttackerKind, g.x, g.y);
      if (!res.ok) say(res.msg);
      commit();
    });
    const gen = el('select');
    gen.setAttribute('aria-label', `${gateLabel(d, gi)}に武将を追加`);
    gen.append(el('option', '', '＋武将を追加'));
    const inPlan = new Set(d.rows.map((r) => r.kind));
    for (const k of GENERAL_ORDER) {
      if (inPlan.has(k)) continue;
      const o = el('option', '', `${nameOf(k)}（${ADEF[k].name}）`);
      o.value = k;
      gen.append(o);
    }
    gen.addEventListener('change', () => {
      const res = putGeneralAt(d, gen.value as GeneralKind, g.x, g.y);
      if (!res.ok) say(res.msg);
      commit();
    });
    box.append(troop, gen);
    adds.push({ troop, gen });
    return box;
  }

  function render() {
    const d = host.siege();
    adds = [];
    body.textContent = '';
    if (!d.gates.length) {
      refreshHead();
      body.append(el('p', 'cnEmpty', '口がありません。兵や武将を、盤面の外周の青いマスへドラッグすると口ができます。'));
      return;
    }
    // 時間の目盛（行の表と同じ列にそろえる）
    const scale = el('div', 'cnRow cnScale');
    const axis = el('div', 'cnTrack');
    for (const t of TICKS) {
      const tick = el('span', t === PLAN_LIMIT ? 'cnTick last' : 'cnTick', fmtSec(t));
      tick.style.left = pct(t);
      axis.append(tick);
    }
    scale.append(el('div', 'cnCtl'), axis);
    body.append(scale);
    d.gates.forEach((g, gi) => {
      const focused = !!focusAt && g.x === focusAt.x && g.y === focusAt.y;
      const sec = el('section', focused ? 'cnGate focus' : 'cnGate');
      const h = el('h3');
      h.append(el('span', '', gateLabel(d, gi)), addControls(d, gi));
      sec.append(h);
      for (const r of d.rows.filter((q) => q.gate === gi))
        sec.append(ADEF[r.kind].general ? generalRow(d, r) : troopRow(d, r));
      body.append(sec);
    });
    refreshHead();
  }

  return {
    // gi 番目の口を目立たせて開く
    open(gi: number) {
      const g = host.siege().gates[gi];
      focusAt = g ? { x: g.x, y: g.y } : null;
      msg.hidden = true;
      render();
      if (!dlg.open) dlg.showModal();
      body.querySelector('.cnGate.focus')?.scrollIntoView({ block: 'nearest' });
    },
    close() {
      if (dlg.open) dlg.close();
    },
    get isOpen() {
      return dlg.open;
    },
  };
}
