// 武将と兵のモーションの確かめのページ（motion.html）。開発する人が、大きな絵の武将と兵の動きとコマの長さを確かめる。
// ゲームの画面からはリンクしない。絵・コマの選び方（bigFrame）・攻撃の区切り（ATTACK_TIME）・能力値（ADEF）は
// ゲームと同じものを読むので、ゲームの側を変えれば、このページもそのまま変わる
import { ADEF, type AttackerKind, DT } from './sim';
import {
  ATTACK_TIME,
  BIG_IDLE_MS,
  BIG_KINDS,
  type BigAction,
  type BigPose,
  type BigView,
  type BigWeapon,
  bigBarDots,
  bigData,
  bigFlagAt,
  bigFlagSprite,
  bigFrame,
  bigMuzzle,
  bigSprite,
  bigWeapon,
} from './ui/bigBusho';
import { FALL_TIME } from './ui/motion';

type Act = BigAction | 'engage';
type Clock = 'game' | 'preview';
// 図の区間：[始め, 終わり, 名前, コマ]。コマが -1 の区間は、構えて待つ間（待機のコマ）
type Seg = [number, number, string, number];
interface Segments {
  len: number;
  segs: Seg[];
  real?: boolean; // 戦闘の秒ではなく実際の秒で進む（待機）
  hits?: number[]; // 攻撃した時刻（戦い始め）
}
interface Shown {
  action: BigAction;
  i: number;
  label: string;
  wait: boolean; // 構えて待つ間（ほかの動きの合間に出す待機のコマ）
  flash?: boolean;
  alpha?: number;
  hidden?: boolean;
}

const $ = <T extends Element = HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`見つからない: #${id}`);
  return el as unknown as T;
};

// 軍の色（src/style.css の --atk・--def と同じ）
const SIDES = { a: '#2c5a9c', d: '#b2402b' } as const;
const WEAPON_NAME: Record<BigWeapon, string> = {
  sword: '刀',
  spear: '槍',
  mallet: '槌',
  shield: '盾',
  wave: '手を振る',
  ram: '丸太',
  gun: '鉄砲',
  bow: '弓',
  fan: '軍配',
  fanHit: '軍配',
};
const KINDS = BIG_KINDS;
const WHO = KINDS.map((kind, k) => ({
  kind,
  name: ADEF[kind].name,
  role: WEAPON_NAME[bigWeapon(kind)],
  tok: `--p${k % 9}`,
}));

const NAMES = {
  idle: ['構え1', '構え2', '構え3', '構え4'],
  walk: ['歩き1', '歩き2', '歩き3', '歩き4'],
  hurt: ['のけぞり', '立て直し'],
  fall: ['崩れる', '傾く', '倒れ伏す'],
};
const ATTACK_NAMES: Record<BigWeapon, readonly string[]> = {
  sword: ['溜め', '振りかぶり', '踏み込み斬り', '振り抜き', '残心'],
  spear: ['構える', '引く', '突く', '伸ばす', '戻す'],
  mallet: ['構える', '振りかぶる', '打ち下ろす', '打ち込む', '戻す'],
  shield: ['構える', '引く', '押す', '押し込む', '戻す'],
  wave: ['手を上げる', '振る', '振る', '振る', '下ろす'],
  ram: ['引く', '溜める', '突く', '打ちつける', '戻す'],
  gun: ['構える', '狙う', '撃つ', '反動', '下ろす'],
  bow: ['つがえる', '引き絞る', '放つ', '残身', '下ろす'],
  fan: ['構える', '掲げる', '振り下ろす', '指す', '下ろす'],
  fanHit: ['構える', '振り上げる', '打ち下ろす', '振り抜く', '戻す'],
};
const WAIT = '構え（待つ）';
const WALK_TO = '歩き（敵の前まで）';
const GONE = '消えた（もう一度）';
// 図の区間が狭いときの短い呼び名
const SHORT: Record<string, string> = {
  [WALK_TO]: '歩き',
  [WAIT]: '待つ',
  踏み込み斬り: '斬る',
  振り抜き: '抜く',
  振りかぶり: '上げ',
  のけぞり: 'のけ',
  立て直し: '直し',
  倒れ伏す: '伏す',
};
const nameOf = (kind: AttackerKind, act: BigAction, i: number) =>
  act === 'attack' ? ATTACK_NAMES[bigWeapon(kind)][i] : NAMES[act][i % NAMES[act].length];

// 試作のページで決めたコマの長さ（ミリ秒）。ゲームの規則で出る長さと比べるために残す
const PREVIEW: Record<BigAction, (w: BigWeapon) => [number, number][]> = {
  idle: () => [0, 1, 2, 3].map((i) => [i, 320]),
  walk: () => [0, 1, 2, 3].map((i) => [i, 160]),
  attack: (w) =>
    w === 'sword'
      ? [
          [0, 180],
          [1, 260],
          [2, 70],
          [3, 130],
          [4, 320],
        ]
      : [
          [0, 200],
          [1, 260],
          [2, 80],
          [3, 160],
          [4, 320],
        ],
  hurt: () => [
    [0, 110],
    [1, 260],
  ],
  fall: () => [
    [0, 300],
    [1, 150],
    [2, 400],
  ],
};

// ---- ゲームの規則でのコマ ----
// 動きごとに、駒の様子（BigPose）を作り、ゲームと同じ bigFrame でコマを選ぶ
const ENGAGE = { walk: 0.8, len: 5.6 }; // 戦い始め：敵の前に着くまでの秒と、くり返す長さ
const HURT_CYCLE = 0.8; // 被弾をくり返す間隔
const FALL_CYCLE = FALL_TIME + 0.7; // 倒れて消えてから、もう一度倒れるまで
const still = (o: Partial<BigPose> = {}): BigPose => ({
  fall: -1,
  mv: 0,
  phase: 0,
  cd: -1,
  cdFull: 0,
  since: -1,
  ...o,
});
// 戦い始めに攻撃する時刻：着いてから、構える時間（aim）を持つ駒はそれだけ構えてから、あとは攻撃の間隔ごと。
// 囮（斥候）は盤面で攻撃しないので、着いたあとは待機の姿のまま（手を振るコマは「攻撃」でだけ見られる）
function engageHits(kind: AttackerKind) {
  const g = ADEF[kind];
  const hits: number[] = [];
  if (g.pref === 'decoy') return hits;
  for (let t = ENGAGE.walk + (g.aim ?? 0); t < ENGAGE.len; t += g.cd) hits.push(+t.toFixed(4));
  return hits;
}
function poseAt(kind: AttackerKind, act: Act, t: number): { pose: BigPose | undefined; flash: number } {
  const g = ADEF[kind];
  if (act === 'idle') return { pose: undefined, flash: 0 };
  if (act === 'walk') return { pose: still({ mv: 1, phase: g.speed * t * 1.1 }), flash: 0 };
  if (act === 'attack') {
    const since = t % g.cd;
    return { pose: still({ cd: g.cd - since, cdFull: g.cd, since }), flash: 0 };
  }
  if (act === 'engage') {
    const c = t % ENGAGE.len;
    if (c < ENGAGE.walk) return { pose: still({ mv: 1, phase: g.speed * c * 1.1, cdFull: g.cd }), flash: 0 };
    const hits = engageHits(kind);
    const last = hits.filter((h) => h <= c + 1e-9).pop();
    const next = hits.find((h) => h > c + 1e-9);
    return {
      pose: still({ cd: next === undefined ? 99 : next - c, cdFull: g.cd, since: last === undefined ? -1 : c - last }),
      flash: 0,
    };
  }
  if (act === 'hurt') return { pose: still(), flash: Math.max(0, 4 - Math.floor((t % HURT_CYCLE) / DT)) };
  return { pose: still({ fall: Math.min(1, (t % FALL_CYCLE) / FALL_TIME) }), flash: 0 };
}
// t は戦闘の秒、nowMs は実際の時刻（待機のコマを進める）
function gameFrame(kind: AttackerKind, act: Act, t: number, nowMs: number): Shown {
  const { pose, flash } = poseAt(kind, act, t);
  const f = bigFrame(kind, pose, flash, nowMs);
  if (act === 'fall' && t % FALL_CYCLE >= FALL_TIME)
    return { action: 'fall', i: 2, label: GONE, wait: false, hidden: true };
  const wait = f.action === 'idle' && act !== 'idle';
  const label = wait ? WAIT : act === 'engage' && f.action === 'walk' ? WALK_TO : nameOf(kind, f.action, f.i);
  return { action: f.action, i: f.i, label, wait, flash: f.action === 'hurt', alpha: f.fade };
}
const lenOf = (kind: AttackerKind, act: Act) =>
  act === 'idle'
    ? (BIG_IDLE_MS * 4) / 1000
    : act === 'walk'
      ? 1 / (ADEF[kind].speed * 1.1)
      : act === 'attack'
        ? ADEF[kind].cd
        : act === 'engage'
          ? ENGAGE.len
          : act === 'hurt'
            ? HURT_CYCLE
            : FALL_CYCLE;
// 図にする区間：1ミリ秒ごとにコマを選び、同じコマが続く所をまとめる（待機は実際の時刻で進むので、t をそのまま使う）
function gameSegments(kind: AttackerKind, act: Act): Segments {
  const len = lenOf(kind, act);
  const segs: Seg[] = [];
  let cur: Seg | undefined;
  const n = Math.round(len * 1000);
  for (let k = 0; k < n; k++) {
    // 区切りちょうどの時刻は小数の誤差でどちらにも転ぶので、各ミリ秒の真ん中の時刻で選ぶ
    const t = k / 1000;
    const f = gameFrame(kind, act, t + 0.0005, t * 1000 + 0.5);
    const fi = f.wait || f.hidden ? -1 : f.i % 8;
    if (cur && cur[2] === f.label) cur[1] = (k + 1) / 1000;
    else {
      cur = [t, (k + 1) / 1000, f.label, fi];
      segs.push(cur);
    }
  }
  return { len, segs, real: act === 'idle', hits: act === 'engage' ? engageHits(kind) : undefined };
}
function previewSegments(kind: AttackerKind, act: BigAction): Segments {
  let t = 0;
  const segs = PREVIEW[act](bigWeapon(kind)).map(([i, ms]): Seg => {
    const a = t;
    t += ms / 1000;
    return [a, t, nameOf(kind, act, i), i];
  });
  return { len: t, segs, real: true };
}

// ---- 操作 ----
const state = {
  act: 'attack' as Act,
  view: 'front' as BigView,
  side: 'a' as keyof typeof SIDES,
  speed: 1,
  clock: 'game' as Clock,
  flip: false,
  paused: false,
};
// 戦い始めは試作の時間を持たないので、いつもゲームの時間で出す
const gameClock = () => state.clock === 'game' || state.act === 'engage';
// コマの一覧に出す動き（戦い始めは攻撃のコマ）
const stripAct = (): BigAction => (state.act === 'engage' ? 'attack' : state.act);
function seg<K extends keyof typeof state>(
  id: string,
  items: [string, string][],
  key: K,
  cast: (v: string) => unknown,
) {
  const el = $(id);
  el.innerHTML = items
    .map(([v, t]) => `<button type="button" data-v="${v}" aria-pressed="${String(state[key]) === v}">${t}</button>`)
    .join('');
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    (state as Record<K, unknown>)[key] = cast(b.dataset.v ?? '');
    for (const x of el.children) x.setAttribute('aria-pressed', String(x === b));
    rebuild();
  });
}
const asIs = (v: string) => v;
seg(
  'act',
  [
    ['idle', '待機'],
    ['walk', '歩き'],
    ['attack', '攻撃'],
    ['engage', '戦い始め'],
    ['hurt', '被弾'],
    ['fall', '倒れ'],
  ],
  'act',
  asIs,
);
seg(
  'view',
  [
    ['front', '斜め前'],
    ['back', '斜め後ろ'],
  ],
  'view',
  asIs,
);
seg(
  'side',
  [
    ['a', '攻め'],
    ['d', '守り'],
  ],
  'side',
  asIs,
);
seg(
  'speed',
  [
    ['0.25', '0.25×'],
    ['0.5', '0.5×'],
    ['1', '1×'],
    ['2', '2×'],
    ['4', '4×'],
  ],
  'speed',
  Number,
);
seg(
  'clock',
  [
    ['game', 'ゲームの時間'],
    ['preview', '試作の時間'],
  ],
  'clock',
  asIs,
);
$<HTMLInputElement>('flip').addEventListener('change', (e) => {
  state.flip = (e.target as HTMLInputElement).checked;
  rebuild();
});
const pauseBtn = $('pause');
pauseBtn.addEventListener('click', () => {
  state.paused = !state.paused;
  pauseBtn.textContent = state.paused ? '再生' : '一時停止';
});
$('lede').textContent =
  `${WHO.map((w) => `${w.name}（${w.role}）`).join('と')}の動きを、ゲームに入れた絵のまま並べて再生します。` +
  '「ゲームの時間」では、盤面と同じ関数（bigFrame）でコマを選びます。';

// ---- 絵 ----
// どの駒も同じ大きさの枠に、足元をそろえて描く（武将と兵の大きさの違いが、そのまま見えるようにする）
const STAGE = (() => {
  const ds = KINDS.map(bigData);
  const foot = Math.max(...ds.map((d) => d.foot));
  return { w: Math.max(...ds.map((d) => d.w)), h: Math.max(...ds.map((d) => Math.round(foot - d.foot) + d.h)), foot };
})();
// 体・白い光・幟を重ねて1コマを描く（幟は反転せず、左向きでは位置だけ返す。斜め前は体の奥、斜め後ろは手前）
function paint(
  cv: HTMLCanvasElement,
  kind: AttackerKind,
  f: Pick<Shown, 'action' | 'i' | 'flash' | 'alpha' | 'hidden'>,
) {
  const d = bigData(kind);
  const x = cv.getContext('2d');
  if (!x) return;
  x.clearRect(0, 0, cv.width, cv.height);
  x.imageSmoothingEnabled = false;
  if (f.hidden) return;
  const side = SIDES[state.side];
  const alpha = f.alpha ?? 1;
  x.globalAlpha = alpha;
  const ox = Math.round((STAGE.w - d.w) / 2);
  const oy = Math.round(STAGE.foot - d.foot);
  const at = bigFlagAt(kind, state.view, f.action, f.i);
  const flag = () => {
    if (at) x.drawImage(bigFlagSprite(kind, side), ox + (state.flip ? d.w - 1 - at[0] : at[0]), oy + at[1]);
  };
  const body = (img: HTMLCanvasElement) => {
    x.save();
    x.translate(ox, oy);
    if (state.flip) {
      x.translate(d.w, 0);
      x.scale(-1, 1);
    }
    x.drawImage(img, 0, 0);
    x.restore();
  };
  if (state.view === 'front') flag();
  body(bigSprite(kind, state.view, f.action, f.i, side));
  if (f.flash) {
    x.globalAlpha = alpha * 0.55;
    body(bigSprite(kind, state.view, f.action, f.i, side, true));
    x.globalAlpha = alpha;
  }
  if (state.view === 'back') flag();
  x.globalAlpha = 1;
}

// ---- 再生台 ----
const playersEl = $('players');
const P = WHO.map((w) => {
  const el = document.createElement('article');
  el.className = 'player';
  el.innerHTML = `<div class="who"><span class="swatch" style="background:var(${w.tok})"></span><b>${w.name}</b><span class="kind">${w.role}</span></div>
    <div class="stage"><canvas width="${STAGE.w}" height="${STAGE.h}" style="aspect-ratio:${STAGE.w} / ${STAGE.h}" aria-label="${w.name}の動き"></canvas></div>
    <div class="readout"><span class="frame">—</span><span class="time">—</span></div><div class="strip"></div>`;
  playersEl.appendChild(el);
  const q = <T extends Element>(s: string) => el.querySelector(s) as T;
  return {
    ...w,
    cv: q<HTMLCanvasElement>('.stage canvas'),
    frame: q<HTMLElement>('.frame'),
    time: q<HTMLElement>('.time'),
    strip: q<HTMLElement>('.strip'),
    thumbs: [] as HTMLElement[],
  };
});
function buildStrips() {
  const act = stripAct();
  for (const p of P) {
    const d = bigData(p.kind);
    const n = d.frames[state.view][act].length;
    p.strip.innerHTML = '';
    p.thumbs = [];
    for (let i = 0; i < n; i++) {
      const f = document.createElement('figure');
      const c = document.createElement('canvas');
      c.width = STAGE.w;
      c.height = STAGE.h;
      c.style.aspectRatio = `${STAGE.w} / ${STAGE.h}`;
      paint(c, p.kind, { action: act, i });
      f.appendChild(c);
      const cap = document.createElement('figcaption');
      cap.textContent = nameOf(p.kind, act, i);
      f.appendChild(cap);
      p.strip.appendChild(f);
      p.thumbs.push(f);
    }
  }
}

// ---- 図 ----
const svg = $<SVGSVGElement>('timeline');
const tip = $('tip');
let heads: { r: Segments; xs: (t: number) => number; el: SVGLineElement | null }[] = [];
const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const segmentsOf = (kind: AttackerKind) =>
  gameClock() ? gameSegments(kind, state.act) : previewSegments(kind, stripAct());
const g0 = (kind: AttackerKind) => ADEF[kind];
function drawTimeline() {
  const rows = P.map((p) => ({ p, ...segmentsOf(p.kind) }));
  const len = Math.max(...rows.map((r) => r.len));
  const W = 960;
  const L = 120;
  const R = 24;
  const rowH = state.act === 'engage' ? 84 : 64;
  const top = 18;
  const H = top + rows.length * rowH + 34;
  const xs = (t: number) => L + (t / len) * (W - L - R);
  const step = len > 2 ? 0.5 : len > 1 ? 0.2 : 0.1;
  let g = '<g class="grid">';
  for (let t = 0; t <= len + 1e-9; t += step) g += `<line x1="${xs(t)}" x2="${xs(t)}" y1="${top - 6}" y2="${H - 30}"/>`;
  g += '</g><g class="axis">';
  for (let t = 0; t <= len + 1e-9; t += step)
    g += `<text x="${xs(t)}" y="${H - 12}" text-anchor="middle">${+t.toFixed(2)}秒</text>`;
  g += '</g>';
  let body = '';
  const ink = css('--ink');
  const muted = css('--muted');
  rows.forEach((r, k) => {
    const y = top + k * rowH;
    const col = css(r.p.tok);
    const panel = css('--panel');
    const unit = !gameClock() ? '試作の秒' : r.real ? '実際の秒' : '戦闘の秒';
    body += `<text class="rowlabel" x="0" y="${y + 24}">${r.p.name}</text><text x="0" y="${y + 42}" style="font-size:11px;fill:${muted}">${unit}</text>`;
    r.segs.forEach(([a, b, name, fi], j) => {
      const x0 = xs(a) + 1;
      const w = Math.max(1, xs(b) - 1 - x0);
      const wait = fi < 0;
      const fill = wait
        ? `color-mix(in oklab, ${col} 16%, ${panel})`
        : j % 2
          ? `color-mix(in oklab, ${col} 62%, ${panel})`
          : col;
      body += `<rect x="${x0}" y="${y + 6}" width="${w}" height="26" rx="4" fill="${fill}"/>`;
      // 幅が足りないときは短い呼び名にする（くわしくはマウスを乗せると出る）
      const short = SHORT[name] ?? name.slice(0, 2);
      const label = w > name.length * 11 + 8 ? name : w > short.length * 11 + 6 ? short : '';
      if (label)
        body += `<text class="seglabel" x="${x0 + w / 2}" y="${y + 23}" text-anchor="middle" style="fill:${wait || j % 2 ? ink : '#fff'}">${label}</text>`;
      body += `<text class="seglabel" x="${x0 + w / 2}" y="${y + 48}" text-anchor="middle" style="fill:${muted};font-family:var(--f-dot)">${w > 34 ? `${Math.round((b - a) * 1000)}ms` : ''}</text>`;
      body += `<rect class="hit" x="${x0}" y="${y + 2}" width="${w}" height="50" data-tip="${r.p.name}｜${name}｜${a.toFixed(3)}〜${b.toFixed(3)}秒｜${Math.round((b - a) * 1000)}ミリ秒"/>`;
    });
    // 戦い始め：攻撃した時刻（傷が入る・弾が出る瞬間）に印を付ける
    for (const h of r.hits ?? [])
      body += `<line x1="${xs(h)}" x2="${xs(h)}" y1="${y + 1}" y2="${y + 37}" stroke="${ink}" stroke-width="2"/><text x="${xs(h)}" y="${y + 66}" text-anchor="middle" style="font-size:11px;font-weight:700;fill:${ink}">▲${ATTACK_NAMES[bigWeapon(r.p.kind)][2].replace('踏み込み斬り', '斬る')}</text>`;
    body += `<g class="head" data-row="${k}"><line x1="${xs(0)}" x2="${xs(0)}" y1="${y + 2}" y2="${y + 36}"/></g>`;
  });
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = g + body;
  heads = rows.map((r, k) => ({ r, xs, el: svg.querySelector<SVGLineElement>(`.head[data-row="${k}"] line`) }));
  $('legend').innerHTML =
    WHO.map((w) => `<span><i class="swatch" style="background:var(${w.tok})"></i>${w.name}</span>`).join('') +
    '<span><i class="swatch" style="background:color-mix(in oklab, var(--muted) 30%, var(--panel))"></i>構えて待つ間（待機のコマ）</span><span><i class="swatch" style="background:var(--gold)"></i>今の位置</span>' +
    (state.act === 'engage'
      ? '<span><i class="swatch" style="background:var(--ink)"></i>攻撃した時刻（傷が入る・弾が出る）</span>'
      : '');
  $('timeNote').textContent = gameClock()
    ? noteOf(state.act)
    : '試作のページで決めた長さです。ゲームの中では上の「ゲームの時間」の規則で出ます。';
}
// 図の説明。数値は能力値と ATTACK_TIME から作る
function noteOf(act: Act): string {
  const each = (f: (kind: AttackerKind) => string) => WHO.map((w) => f(w.kind)).join('');
  if (act === 'idle')
    return `待機は戦いの時計ではなく、実際の時間で${BIG_IDLE_MS / 1000}秒ごとに進みます（一時停止中も動きます）。`;
  if (act === 'walk')
    return `歩きは時間ではなく、歩いた距離で進みます。4コマで約${(1 / 1.1).toFixed(2)}マス。${each((k) => `${g0(k).name}は速さ${g0(k).speed}、`)}なので、1コマの長さが違います。`;
  if (act === 'attack')
    return `どの駒も、攻撃した時刻（傷を与える・弾が出る瞬間）から後の3コマを出し、次に攻撃できるまでの残りで前の2コマを出します。${each(
      (k) => {
        const tm = ATTACK_TIME[bigWeapon(k)];
        const nm = ATTACK_NAMES[bigWeapon(k)];
        return `${g0(k).name}は${g0(k).cd}秒ごとに攻撃し、残り${tm.pre[0]}秒で${nm[0]}、${tm.pre[1]}秒で${nm[1]}。`;
      },
    )}`;
  if (act === 'engage')
    return `歩いて敵の前に着いてから（${ENGAGE.walk}秒）の動きです。${each((k) =>
      g0(k).aim
        ? `${g0(k).name}は構える時間（${g0(k).aim}秒）を持つので、着いてから${ATTACK_NAMES[bigWeapon(k)].slice(0, 2).join('・')}を出して1回目を攻撃します。`
        : `${g0(k).name}は構える時間を持たないので、着いたその時に攻撃し、1回目は${ATTACK_NAMES[bigWeapon(k)][2]}から始まります。`,
    )}2回目からは、どの駒も前の2コマから出ます。黒い線が攻撃した時刻です。`;
  if (act === 'hurt')
    return '被弾の白い光は4ティック（1ティック＝1/30秒）。前の2ティックがのけぞり、後の2ティックが立て直し。';
  return `倒れは${FALL_TIME}秒。全体の55%から薄れ、${FALL_TIME}秒で消えます。`;
}
svg.addEventListener('pointermove', (e) => {
  const h = (e.target as Element).closest<SVGElement>('[data-tip]');
  if (!h) {
    tip.hidden = true;
    return;
  }
  const [a, b, c, d] = (h.dataset.tip ?? '').split('｜');
  tip.innerHTML = `<b>${a}</b>　${b}<br>${c}<br>${d}`;
  tip.hidden = false;
  tip.style.left = `${Math.min(e.clientX + 14, innerWidth - 270)}px`;
  tip.style.top = `${e.clientY + 14}px`;
});
svg.addEventListener('pointerleave', () => {
  tip.hidden = true;
});

// ---- 速さごとの実際の長さ ----
function drawReal() {
  let h =
    '<thead><tr><th>駒</th><th>コマ</th><th class="num">戦闘の秒</th><th class="num">1×</th><th class="num">2×</th><th class="num">4×</th></tr></thead><tbody>';
  for (const p of P) {
    const { segs, real } = gameSegments(p.kind, stripAct());
    for (const [a, b, name, fi] of segs) {
      if (fi < 0) continue;
      const d = b - a;
      const cell = (k: number) => {
        const ms = real ? d * 1000 : (d * 1000) / k;
        return `<td class="num">${ms < 16.7 ? '▲ ' : ''}${ms.toFixed(ms < 100 ? 1 : 0)}ms</td>`;
      };
      const hl = name === ATTACK_NAMES[bigWeapon(p.kind)][2];
      h += `<tr${hl ? ' class="hl"' : ''}><td>${p.name}</td><td>${name}</td><td class="num">${real ? '—' : d.toFixed(3)}</td>${cell(1)}${cell(2)}${cell(4)}</tr>`;
    }
  }
  $('realTbl').innerHTML = `${h}</tbody>`;
}

// ---- 数値の表 ----
function bars(vals: number[], max: number) {
  return `<div class="bars">${WHO.map((w, k) => `<span class="bar" style="width:${max ? (vals[k] / max) * 100 : 0}%;background:var(${w.tok})" title="${w.name} ${vals[k]}"></span>`).join('')}</div>`;
}
function drawTables() {
  const rows: [string, (k: AttackerKind) => number, string][] = [
    ['体力', (k) => ADEF[k].hp, ''],
    ['一撃の威力', (k) => ADEF[k].dmg, ''],
    ['攻撃の間隔', (k) => ADEF[k].cd, '秒'],
    ['射程', (k) => ADEF[k].range, 'マス'],
    ['速さ', (k) => ADEF[k].speed, 'マス/秒'],
    ['構える時間', (k) => ADEF[k].aim ?? 0, '秒'],
    ['1秒あたりの威力', (k) => +(ADEF[k].dmg / ADEF[k].cd).toFixed(1), ''],
  ];
  let h = `<thead><tr><th>項目</th>${WHO.map((w) => `<th class="num">${w.name}</th>`).join('')}<th class="barcell">比べる</th></tr></thead><tbody>`;
  for (const [n, f, u] of rows) {
    const v = WHO.map((w) => f(w.kind));
    h += `<tr><td>${n}</td>${v.map((x) => `<td class="num">${x ? `${x}${u}` : '—'}</td>`).join('')}<td class="barcell">${bars(v, Math.max(...v))}</td></tr>`;
  }
  $('statTbl').innerHTML = `${h}</tbody>`;
  const art = WHO.map((w) => {
    const d = bigData(w.kind);
    const fr = Object.values(d.frames.front).reduce((s, a) => s + a.length, 0);
    return {
      箱: `${d.w}×${d.h}ドット`,
      // 武将は決まりの背丈。兵は頭の上の端から足元まで（絵から測る）
      背丈: d.top === undefined ? '38ドット' : `${Math.round(d.foot - d.top)}ドット`,
      色: `${d.pal.length}色`,
      コマ: `${fr * 2}コマ`,
      棒: `${bigBarDots(w.kind)}ドット`,
      銃口: (() => {
        const mz = bigMuzzle(w.kind);
        return mz ? `${mz.up}・${mz.fwd}ドット` : '—';
      })(),
      大きさ: `${(JSON.stringify(d).length / 1024).toFixed(1)}KB`,
    };
  });
  const ar: [string, keyof (typeof art)[number]][] = [
    ['絵の枠', '箱'],
    ['背丈（前立て・髷・陣笠などを含む）', '背丈'],
    ['色の数', '色'],
    ['コマの数（2方向の合計）', 'コマ'],
    ['体力の棒の高さ（足元から）', '棒'],
    ['飛び道具の出る所（足元から上・前）', '銃口'],
    ['データの大きさ', '大きさ'],
  ];
  let a = `<thead><tr><th>項目</th>${WHO.map((w) => `<th class="num">${w.name}</th>`).join('')}</tr></thead><tbody>`;
  for (const [n, k] of ar) a += `<tr><td>${n}</td>${art.map((x) => `<td class="num">${x[k]}</td>`).join('')}</tr>`;
  $('artTbl').innerHTML = `${a}</tbody>`;
}
// ゲームでのコマの選び方。数値は ATTACK_TIME と能力値から作る
function drawRules() {
  const weapons = [...new Set(KINDS.map(bigWeapon))];
  const who = (w: BigWeapon) =>
    WHO.filter((x) => bigWeapon(x.kind) === w)
      .map((x) => x.name)
      .join('・');
  const per = weapons
    .map((w) => {
      const tm = ATTACK_TIME[w];
      const nm = ATTACK_NAMES[w];
      return `<p><b>${WEAPON_NAME[w]}（${who(w)}）</b>　攻撃した時刻から ${tm.post.join('秒・')}秒で、${nm.slice(2).join('・')}。止まって戦っている間は、次に攻撃できるまでの残りが${tm.pre[0]}秒で${nm[0]}、${tm.pre[1]}秒で${nm[1]}。</p>`;
    })
    .join('');
  const start = WHO.map((w) => {
    const g = ADEF[w.kind];
    const nm = ATTACK_NAMES[bigWeapon(w.kind)];
    return g.aim
      ? `${w.name}は、まだ攻撃していないときと、しばらく攻撃していなかったときは、戦いの計算が攻撃の前に${g.aim}秒構える（構える時間 aim）ので、1回目も${nm[0]}・${nm[1]}を出してから攻撃する。`
      : `${w.name}は構える時間を持たないので、1回目は前の2コマを出さずに${nm[2]}から始まる。`;
  }).join('');
  $('rules').innerHTML = `
    <p><b>向き</b>　画面で下へ進むなら斜め前、上へ進むなら斜め後ろ。左へ進むなら反転（幟は反転しない）。</p>
    <p><b>選ぶ順</b>　倒れ → 攻撃の前の2コマ → 攻撃の後の3コマ → 被弾 → 歩き → 待機（src/ui/bigBusho.ts の bigFrame）。</p>
    ${per}
    <p><b>戦い始め</b>　飛び道具は構え、近くで戦う武器は構えない。${start}最後の攻撃から「攻撃の間隔＋1.5秒」を過ぎたら構えを解く。</p>
    <p><b>被弾</b>　白い光が残っている4ティックのうち、前の2ティックがのけぞり、後の2ティックが立て直し。</p>`;
}

// ---- 動かす ----
let tb = 0;
let last = performance.now();
let segStart = 0;
function rebuild() {
  buildStrips();
  drawTimeline();
  drawReal();
  tb = 0;
  segStart = performance.now();
}
function frameNow(kind: AttackerKind, nowMs: number): Shown {
  if (gameClock()) return gameFrame(kind, state.act, tb, nowMs);
  const act = stripAct();
  const { segs, len } = previewSegments(kind, act);
  const c = ((nowMs - segStart) / 1000) % (len + 0.6);
  const s = segs.find(([a, b]) => c >= a && c < b);
  if (!s) return { action: act === 'attack' ? 'idle' : act, i: 0, label: '（くり返し前の間）', wait: true };
  return { action: act, i: s[3], label: s[2], wait: false, flash: act === 'hurt' && s[3] === 0 };
}
function loop(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!state.paused) tb += dt * state.speed;
  P.forEach((p, k) => {
    const f = frameNow(p.kind, state.paused ? segStart + 1 : now);
    paint(p.cv, p.kind, f);
    p.frame.textContent = f.label;
    const hd = heads[k];
    if (hd) {
      const r = hd.r;
      const c = gameClock()
        ? r.real
          ? (now % (r.len * 1000)) / 1000
          : tb % r.len
        : ((now - segStart) / 1000) % (r.len + 0.6);
      p.time.textContent = `${gameClock() ? (r.real ? '実際の秒' : '戦闘の秒') : '試作の秒'} ${c.toFixed(2)}`;
      const x = String(hd.xs(Math.min(c, r.len)));
      hd.el?.setAttribute('x1', x);
      hd.el?.setAttribute('x2', x);
    }
    const act = stripAct();
    p.thumbs.forEach((t, i) => {
      t.classList.toggle('on', f.action === act && !f.wait && i === f.i % p.thumbs.length);
    });
  });
  requestAnimationFrame(loop);
}
rebuild();
drawTables();
drawRules();
requestAnimationFrame(loop);
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', drawTimeline);
// 開発サーバーでだけ、決まった時刻で止めて見られるようにする（ヘッドレスブラウザで決まったコマを撮るため。
// docs/development.md）。公開の版を作るときは import.meta.env.DEV が false になり、この部分は取り除かれる
if (import.meta.env.DEV) {
  (window as unknown as { motionPage: unknown }).motionPage = {
    // 戦闘の秒 t で止める
    seek: (t: number) => {
      tb = t;
      state.paused = true;
      pauseBtn.textContent = '再生';
    },
  };
}
