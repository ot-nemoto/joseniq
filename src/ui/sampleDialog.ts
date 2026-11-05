// 動作の見本の窓（<dialog id="sampleDlg">）。兵種の画面の「動作」から開く。
// 窓の中に盤面をもう1つ作り（renderer.ts の createRenderer）、見本の戦い（src/sim/sample.ts）を動かして描く。
// 一時停止と速さは、攻城とは別に持つ
import {
  ADEF,
  BDEF,
  createSample,
  DT,
  GDEF,
  isGeneralKind,
  retarget,
  type Sample,
  type SampleOf,
  stepSample,
} from '../sim';
import { $ } from './dom';
import { createRenderer } from './renderer';

const ZOOM = 5; // 見本の場所へ寄せる倍率
const CLICK_SLOP = 5; // 押してから離すまでに動いてもクリックとみなす距離（画面の点）

function nameOf(of: SampleOf) {
  if (of.k === 'fac') return BDEF[of.type].name;
  return of.k === 'def' ? GDEF[of.kind].busho : (ADEF[of.kind].busho ?? ADEF[of.kind].name);
}
function descOf(of: SampleOf) {
  if (of.k === 'fac' && of.type === 'drum')
    return '隣の弓櫓が、止めた盾兵を撃ちます。鼓楼の波紋の内側にいる櫓と守将は、攻撃が速くなります。盤面をクリックすると、盾兵がそこへ移ります（弓櫓の射程の外へ移すと撃ちません）。';
  if (of.k === 'fac' && of.type === 'bell')
    return `見張りの範囲に止めた盾兵を見つけて鐘を鳴らし、離れた持ち場の${GDEF.brave.busho}が駆けつけて攻めます。盤面をクリックすると、盾兵がそこへ移ります（見張りの範囲の外へ移すと鐘は止まります）。`;
  if (of.k === 'fac') {
    const near = BDEF[of.type].minRange ? '撃てない近さや' : '';
    return `射程の内側に止めた盾兵を撃ちます。盤面をクリックすると、盾兵がそこへ移ります（${near}射程の外へ移すと撃ちません）。`;
  }
  if (of.k === 'def')
    return '守りにつき、持ち場の近くに止めた盾兵に向かって攻めます。盤面をクリックすると、盾兵がそこへ移ります（敵を見つける範囲の外へ移すと攻めません）。';
  if (of.kind === 'ram') return '本丸に向かって攻めます。';
  const again = '盤面をクリックすると、そこに弓櫓を置き直し、今いる所からそこへ向かいます。';
  if (ADEF[of.kind].pref === 'decoy') return `弓櫓に近づき、撃たれたら下がる囮です（攻撃はしません）。${again}`;
  return `弓櫓に向かって攻めます（弓櫓も撃ち返します）。${again}`;
}

export function createSampleDialog() {
  const dlg = $<HTMLDialogElement>('sampleDlg');
  const cv = $<HTMLCanvasElement>('sampleCv');
  // 盤面は、初めて開いたときに作る（窓が開くまでは大きさが決まらないため）
  let renderer: ReturnType<typeof createRenderer> | null = null;
  let sample: Sample | null = null;
  let paused = false;
  let speed = 1;
  let acc = 0;
  let last = 0;
  let raf = 0;

  function frame(now: number) {
    if (!dlg.open || !sample || !renderer) {
      raf = 0;
      return;
    }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused) {
      acc += dt * speed;
      let n = 0;
      while (acc >= DT && n < 40) {
        stepSample(sample);
        acc -= DT;
        n++;
      }
      if (n >= 40) acc = 0;
    }
    renderer.draw({
      mode: 'sample',
      layout: sample.layout,
      battle: sample.battle,
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
    raf = requestAnimationFrame(frame);
  }

  function refresh() {
    const of = sample?.of;
    if (!of) return;
    $('sampleTitle').textContent = nameOf(of);
    $('sampleDesc').textContent = descOf(of);
    // 武将は、攻めと守りを切り替えられる
    $('sampleSide').hidden = !(of.k === 'def' || (of.k === 'atk' && isGeneralKind(of.kind)));
    for (const b of $('sampleSide').querySelectorAll<HTMLButtonElement>('button'))
      b.setAttribute('aria-pressed', String(b.dataset.s === (of.k === 'def' ? 'def' : 'atk')));
    $('samplePause').textContent = paused ? '再開' : '一時停止';
    for (const b of $('sampleSpeed').querySelectorAll<HTMLButtonElement>('button'))
      b.setAttribute('aria-pressed', String(Number(b.dataset.s) === speed));
  }

  // 見本を最初から動かし、盤面をそこへ寄せる
  function start(of: SampleOf) {
    sample = createSample(of);
    acc = 0;
    paused = false;
    renderer?.look(sample.focus.x, sample.focus.y, ZOOM);
    refresh();
  }

  function open(of: SampleOf) {
    if (!dlg.open) dlg.showModal();
    // 開くと最初のボタン（✕）にフォーカスが移り、スペースで窓が閉じてしまうので、盤面にフォーカスを置く
    cv.focus();
    renderer ??= createRenderer(cv);
    start(of);
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  // 窓の後ろのページは、ふつうのホイールでも動かさない
  cv.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) e.preventDefault();
    },
    { passive: false },
  );

  // 左ドラッグでも盤面を動かす（Shift を押していれば回す）。右・中ドラッグと Ctrl＋ホイールは renderer の Orbit が受ける。
  // ほとんど動かさずに離したら（クリック）、押したマスを見本の相手の新しい場所にする
  let down: { x: number; y: number } | null = null;
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    // 2本目の指は、クリックとみなさない
    down = e.isPrimary ? { x: e.clientX, y: e.clientY } : null;
    renderer?.orbitFrom(e);
  });
  cv.addEventListener('pointerup', (e) => {
    const d = down;
    down = null;
    if (e.button !== 0 || !d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP) return;
    const t = renderer?.tileAt(e.clientX, e.clientY);
    const next = sample && t ? retarget(sample, t.x, t.y) : null;
    if (!next || next === sample) return;
    // 攻め手の見本は、弓櫓を置き直した見本に替わる（攻め手は今いる所から動く）。カメラはそのままにする
    sample = next;
    acc = 0;
    refresh();
  });
  cv.addEventListener('pointercancel', () => {
    down = null;
  });
  $('sampleClose').addEventListener('click', () => dlg.close());
  // 窓の外（暗い背景）で押して、窓の外で離したときだけ閉じる（窓の中で押して外で離したときは閉じない）
  let downOnBack = false;
  dlg.addEventListener('pointerdown', (e) => {
    downOnBack = e.target === dlg;
  });
  dlg.addEventListener('click', (e) => {
    if (downOnBack && e.target === dlg) dlg.close();
  });
  dlg.addEventListener('close', () => {
    sample = null;
  });
  dlg.addEventListener('keydown', (e) => {
    if (e.key !== ' ' || (e.target as HTMLElement | null)?.tagName === 'BUTTON') return;
    e.preventDefault();
    paused = !paused;
    refresh();
  });
  $('samplePause').addEventListener('click', () => {
    paused = !paused;
    refresh();
  });
  for (const b of $('sampleSpeed').querySelectorAll<HTMLButtonElement>('button'))
    b.addEventListener('click', () => {
      speed = Number(b.dataset.s);
      refresh();
    });
  // 武将の攻めと守りを切り替えると、見本を最初から作り直す
  for (const b of $('sampleSide').querySelectorAll<HTMLButtonElement>('button'))
    b.addEventListener('click', () => {
      const of = sample?.of;
      if (!of || of.k === 'fac' || !isGeneralKind(of.kind)) return;
      start(b.dataset.s === 'def' ? { k: 'def', kind: of.kind } : { k: 'atk', kind: of.kind });
    });

  return { open };
}
