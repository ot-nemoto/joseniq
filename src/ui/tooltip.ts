// マウスを合わせたときの説明の枠。ブラウザの標準の枠（title）の代わりに、画面の雰囲気に合わせた枠を出す。
// data-tip を持つ要素に合わせると、少し待ってから出す。キーボードで移ったとき（:focus-visible）も出す。
// 文字は data-tip に入れ、読み上げのために aria-description にも写す
const DELAY = 350; // 出すまでの待ち（ミリ秒）
const GAP = 8; // 要素との間

let box: HTMLDivElement | null = null;
let target: HTMLElement | null = null;
let timer = 0;
// 押した要素。押したあとは、その要素から出るまで出さない（押すたびに枠がまた出ないように）
let pressed: HTMLElement | null = null;

// 要素の説明を設定する（空なら消す）。読み上げの文（aria）を、見た目の説明と変えることもできる
export function setTip(el: HTMLElement, text: string, aria = text) {
  if (text) {
    el.dataset.tip = text;
    el.setAttribute('aria-description', aria);
  } else {
    delete el.dataset.tip;
    el.removeAttribute('aria-description');
  }
  el.removeAttribute('title');
  // 出している最中なら、中身を入れ替える
  if (el === target && box && !box.hidden) {
    if (text) box.textContent = text;
    else hide();
  }
}

function show() {
  if (!box || !target?.dataset.tip || !target.isConnected) return;
  box.textContent = target.dataset.tip;
  box.hidden = false;
  // 要素の上に出す。上に入らなければ下に出す。左右は画面からはみ出さないように寄せる
  const r = target.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  const below = r.top - b.height - GAP < 4;
  const left = Math.min(Math.max(4, r.left + r.width / 2 - b.width / 2), window.innerWidth - b.width - 4);
  const top = below ? r.bottom + GAP : r.top - b.height - GAP;
  box.style.left = `${left + window.scrollX}px`;
  box.style.top = `${top + window.scrollY}px`;
  box.classList.toggle('below', below);
  // 矢印は要素の真ん中を指す
  box.style.setProperty('--arrow', `${Math.min(Math.max(12, r.left + r.width / 2 - left), b.width - 12)}px`);
}

function hide() {
  clearTimeout(timer);
  if (box) box.hidden = true;
  target = null;
}

// el の説明を、wait ミリ秒待ってから出す
function showSoon(el: HTMLElement, wait: number) {
  hide();
  target = el;
  timer = window.setTimeout(show, wait);
}

const tipOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>('[data-tip]') : null);

// 画面全体で一度だけ呼ぶ
export function initTooltips() {
  box = document.createElement('div');
  box.className = 'tip';
  box.setAttribute('role', 'tooltip');
  box.hidden = true;
  document.body.append(box);
  // 初めから title を持つ要素は、data-tip に移す（標準の枠と二重に出さないため）
  for (const el of document.querySelectorAll<HTMLElement>('[title]')) setTip(el, el.title);
  document.addEventListener('pointerover', (e) => {
    // ボタンを押したまま動かしている間（ドラッグ中）は出さない
    if (e.pointerType === 'touch' || e.buttons) return;
    const el = tipOf(e.target);
    if (el === target) return;
    if (el !== pressed) pressed = null;
    if (!el || el === pressed) {
      // 押した要素の中で動いたときは、枠を出し直さない
      if (!el) hide();
      return;
    }
    showSoon(el, DELAY);
  });
  // 画面の外へ出たら消す
  document.addEventListener('pointerout', (e) => {
    if (e.relatedTarget) return;
    pressed = null;
    hide();
  });
  window.addEventListener('blur', hide);
  // キーボードで移ったときは、すぐ出す。フォーカスが外れたら消す
  document.addEventListener('focusin', (e) => {
    const el = e.target instanceof HTMLElement ? e.target : null;
    if (el?.dataset.tip && el.matches(':focus-visible')) showSoon(el, 0);
  });
  document.addEventListener('focusout', (e) => {
    if (e.target === target) hide();
  });
  // 押したり、スクロールしたり、キーを押したりしたら消す
  document.addEventListener(
    'pointerdown',
    (e) => {
      pressed = tipOf(e.target);
      hide();
    },
    true,
  );
  for (const ev of ['scroll', 'keydown'] as const) document.addEventListener(ev, hide, true);
}
