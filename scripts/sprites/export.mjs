// 試作の武将の全コマと、コマごとの幟の位置を、ゲームが読み込むデータ（src/ui/kenshinFrames.ts など）に書き出す。
// 使い方：node scripts/sprites/export.mjs kenshin|nobunaga|mitsuyoshi|masayuki|hideyoshi|ieyasu（書き出したあと npx biome check --write src/ui/*Frames.ts で整える）
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const who = process.argv[2];
const base = fs.readFileSync(`${DIR}common.js`, 'utf8');
const CONF = {
  kenshin: {
    file: 'kenshin.js',
    out: 'src/ui/kenshinFrames.ts',
    expr: 'KQ3D',
    name: 'KENSHIN',
    title: '上杉謙信（猛将）',
    team: (R) => R.r, // 赤い縅と紐（common.js の RAMP.r）
  },
  nobunaga: {
    file: 'nobunaga.js',
    out: 'src/ui/nobunagaFrames.ts',
    expr: 'KN',
    name: 'NOBUNAGA',
    title: '織田信長（鉄砲大将）',
    team: (_R, K) => K.R.r, // 朱の飾り（nobunaga.js の R.r）
  },
  mitsuyoshi: {
    file: 'mitsuyoshi.js',
    out: 'src/ui/mitsuyoshiFrames.ts',
    expr: 'KM',
    name: 'MITSUYOSHI',
    title: '大島光義（弓将）',
    team: (_R, K) => K.R.r, // 朱の縁（mitsuyoshi.js の R.r）
  },
  masayuki: {
    file: 'masayuki.js',
    out: 'src/ui/masayukiFrames.ts',
    expr: 'KS',
    name: 'MASAYUKI',
    title: '真田昌幸（軍師）',
    team: (_R, K) => K.R.r, // 赤い緒・結び目・軍配の日の丸（masayuki.js の R.r）
  },
  hideyoshi: {
    file: 'hideyoshi.js',
    out: 'src/ui/hideyoshiFrames.ts',
    expr: 'KH',
    name: 'HIDEYOSHI',
    title: '豊臣秀吉（築城名人）',
    team: (_R, K) => K.R.r, // 赤い紐（hideyoshi.js の R.r）
  },
  ieyasu: {
    file: 'ieyasu.js',
    out: 'src/ui/ieyasuFrames.ts',
    expr: 'KI',
    name: 'IEYASU',
    title: '徳川家康（堅守）',
    team: (_R, K) => K.R.r, // 赤い鉢巻・すねの紐・軍配の日の丸（ieyasu.js の R.r）
  },
}[who];
if (!CONF)
  throw new Error('使い方：node scripts/sprites/export.mjs kenshin|nobunaga|mitsuyoshi|masayuki|hideyoshi|ieyasu');
const src = `${base}\n${fs.readFileSync(`${DIR}${CONF.file}`, 'utf8').replace(/flash: 0\.55, /g, '')}\nmodule.exports = { K: ${CONF.expr}, RAMP };`;
const m = { exports: {} };
new Function('module', 'exports', src)(m, m.exports);
const { K, RAMP } = m.exports;
const views = { front: K.斜め前, back: K.斜め後ろ };
const acts = {
  idle: (v) => v.待機,
  walk: (v) => v.歩き,
  attack: (v) => v.攻撃.map((f) => f.g),
  hurt: (v) => v.被弾,
  fall: (v) => v.倒れ,
};
const team = CONF.team(RAMP, K).map((c) => c.toLowerCase());
const pal = [];
const idx = new Map();
const code = (c) => {
  c = c.toLowerCase();
  if (!idx.has(c)) {
    idx.set(c, pal.length);
    pal.push(c);
  }
  return idx.get(c);
};
const CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,-/:;<=>?@[]^_{|}~';
const rle = (row) => {
  let s = '',
    i = 0;
  while (i < row.length) {
    let j = i;
    while (j < row.length && row[j] === row[i]) j++;
    const ch = row[i] ? CH[code(row[i])] : '.';
    s += ch + (j - i > 1 ? j - i : '');
    i = j;
  }
  return s;
};
// 頭のてっぺん：謙信は頭巾の色（明るい白は刀身の光と同じなので外す）の上から6行の幅、信長は元結の色の行から求める
const hood = new Set((RAMP.C ?? []).map((c) => c.toLowerCase()));
hood.delete('#ffffff');
const TIE = '#d6d6de';
// 描き方の側で頭の上の端（top）を持たせたコマは、それを使う（光義は兜の鉢の上の端）
const topOf = (g) => {
  if (g.top) return { x: g.top[0], y: g.top[1] };
  if (who === 'nobunaga') {
    for (let y = 0; y < g.length; y++) {
      const xs = [];
      g[y].forEach((c, x) => {
        if (c && c.toLowerCase() === TIE) xs.push(x);
      });
      if (xs.length) return { x: (xs[0] + xs[xs.length - 1]) / 2, y: y - 3 };
    }
    return null;
  }
  let y0 = -1,
    l = 99,
    r = 0;
  for (let y = 0; y < g.length; y++) {
    const xs = [];
    g[y].forEach((c, x) => {
      if (c && hood.has(c.toLowerCase())) xs.push(x);
    });
    if (!xs.length) continue;
    if (y0 < 0) y0 = y;
    if (y - y0 > 6) break;
    l = Math.min(l, xs[0]);
    r = Math.max(r, xs[xs.length - 1]);
  }
  return y0 < 0 ? null : { x: (l + r) / 2, y: y0 };
};
const flagAt = (g, front) => {
  const t = topOf(g);
  return t ? [Math.round(t.x + (front ? -3 : -1)), t.y - 19] : null;
};
const frames = {},
  flags = {};
for (const [vk, v] of Object.entries(views)) {
  frames[vk] = {};
  flags[vk] = {};
  for (const [ak, f] of Object.entries(acts)) {
    const gs = f(v);
    frames[vk][ak] = gs.map((g) => g.map(rle));
    flags[vk][ak] = gs.map((g, i) => (ak === 'fall' && i > 0 ? null : flagAt(g, vk === 'front')));
  }
}
if (pal.length > CH.length) throw new Error(`色が多すぎる: ${pal.length}`);
// 足元：待機の1コマ目の、色のある一番下の行
const g0 = views.front.待機[0];
let foot = g0.length - 1;
while (!g0[foot].some((c) => c)) foot--;
const data = {
  w: K.W,
  h: K.H,
  foot: foot + 0.5,
  ch: CH,
  pal,
  team: team.map((c) => pal.indexOf(c)),
  frames,
  flag: flags,
};
const ts =
  `// ${CONF.title}の試作のドット絵（3頭身・背丈38ドット）。試作のスクリプトから書き出したデータで、手で直さない\n` +
  `// frames の1行は「色の文字＋続く数」の並び（. は空き）。team は軍の色に塗り替える色（暗い順に4段）の番号（使わない段は -1）。\n` +
  `// foot は足元の行、flag はコマごとの幟の竿の上の端の位置（絵の中のドット。反転していないとき。null なら幟を立てない）\n` +
  `export const ${CONF.name} = ${JSON.stringify(data)} as const;\n`;
const out = `${ROOT}${CONF.out}`;
fs.writeFileSync(out, ts);
execFileSync('npx', ['biome', 'check', '--write', out], { cwd: ROOT, stdio: 'inherit' });
console.log(who, '色', pal.length, '大きさ', ts.length, 'team', data.team, '足元', data.foot);
