// マウスを合わせたときの説明の枠。ブラウザの標準の枠（title）の代わりに、画面の雰囲気に合わせた枠を出す。
// data-tip を持つ要素に合わせると、少し待ってから出す。1行目を説明、2行目からを操作の説明として、薄い字で出す。
// 文字は data-tip に入れ、読み上げのために aria-description にも写す
const DELAY = 350; // 出すまでの待ち（ミリ秒）
const GAP = 8; // 要素との間

let box: HTMLDivElement | null = null;
let target: HTMLElement | null = null;
let timer = 0;

// 要素の説明を設定する（空なら消す）
export function setTip(el: HTMLElement, text: string) {
  if (text) {
    el.dataset.tip = text;
    el.setAttribute('aria-description', text.replace(/\n/g, '。'));
  } else {
    delete el.dataset.tip;
    el.removeAttribute('aria-description');
  }
  el.removeAttribute('title');
  // 出している最中なら、中身を入れ替える
  if (el === target && box && !box.hidden) {
    if (text) fill(text);
    else hide();
  }
}

function fill(text: string) {
  if (!box) return;
  const [head, ...rest] = text.split('\n');
  box.textContent = '';
  const h = document.createElement('div');
  h.className = 'tipHead';
  h.textContent = head;
  box.append(h);
  for (const line of rest) {
    const d = document.createElement('div');
    d.className = 'tipSub';
    d.textContent = line;
    box.append(d);
  }
}

function show() {
  if (!box || !target?.dataset.tip || !target.isConnected) return;
  fill(target.dataset.tip);
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

// 画面全体で一度だけ呼ぶ
export function initTooltips() {
  box = document.createElement('div');
  box.className = 'tip';
  box.setAttribute('role', 'tooltip');
  box.hidden = true;
  document.body.append(box);
  // 初めから title を持つ要素は、data-tip に移す（標準の枠と二重に出さないため）
  for (const el of document.querySelectorAll<HTMLElement>('[title]')) setTip(el, el.title);
  // 押せない（disabled）ボタンには、ブラウザがマウスの出入りを知らせない。そこで押せないボタンは CSS でマウスを
  // 素通りさせ（pointer-events: none）、マウスの位置にある押せないボタンを、こちらで探す
  const underPointer = (e: PointerEvent) => {
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-tip]');
    if (el) return el;
    for (const d of document.querySelectorAll<HTMLElement>('[data-tip]:disabled')) {
      const r = d.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom) return d;
    }
    return null;
  };
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const el = underPointer(e);
    if (el === target) return;
    hide();
    if (!el) return;
    target = el;
    timer = window.setTimeout(show, DELAY);
  });
  // 押したり、スクロールしたり、キーを押したりしたら消す
  for (const ev of ['pointerdown', 'scroll', 'keydown'] as const) document.addEventListener(ev, hide, true);
  document.addEventListener('pointerleave', hide);
}
