// 釣り合いの実績集め：「基本」の城に、武将3人の組み合わせ（9人から3人の84通り）を編成例の武将の枠に入れて当てる。
// 兵の組み方は編成例5種のまま、出撃口は8か所。比べるために、武将なし（兵だけ）の場合も走らせる。
// テストではないので失敗はしない。戦いはCPUの数だけのプロセスに分けて並べて走らせる。
// 使い方：npm run balance:combos（--out ファイル名 で、1戦ずつの結果を JSON に書き出す）
import { fork } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const SELF = fileURLToPath(import.meta.url);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function loadSim() {
  const server = await createServer({
    root: ROOT,
    server: { middlewareMode: true, ws: false },
    appType: 'custom',
    logLevel: 'error',
  });
  return { server, S: await server.ssrLoadModule('/src/sim/index.ts') };
}

// 戦いの一覧。combo は武将3人（null なら武将なし）
function jobsOf(S) {
  const g = S.GENERAL_ORDER;
  const combos = [null];
  for (let a = 0; a < g.length; a++)
    for (let b = a + 1; b < g.length; b++) for (let c = b + 1; c < g.length; c++) combos.push([g[a], g[b], g[c]]);
  const eps = S.entryPoints(S.preset('basic'));
  const jobs = [];
  for (const combo of combos)
    for (let t = 0; t < S.TEMPLATES.length; t++) for (let e = 0; e < eps.length; e++) jobs.push({ combo, t, e });
  return jobs;
}

// 編成例の武将の枠を、出てくる順に組み合わせの3人へ入れ替える。武将なしなら武将の手順を除く
function templateFor(S, tpl, combo) {
  let slot = 0;
  const steps = [];
  for (const st of tpl.steps) {
    if (!S.ADEF[st.kind].general) steps.push(st);
    else if (combo) steps.push({ ...st, kind: combo[slot++] });
  }
  return { ...tpl, steps };
}

function run(S, layout, eps, job) {
  const tpl = templateFor(S, S.TEMPLATES[job.t], job.combo);
  const entries = tpl.pair ? [eps[job.e].e, eps[S.OPPOSITE[job.e]].e] : [eps[job.e].e];
  const s = S.runPlan(layout, S.buildPlan(tpl, entries));
  const hall = S.hallOf(s);
  return {
    combo: job.combo,
    t: job.t,
    e: job.e,
    win: s.result === 'win',
    endT: +s.endT.toFixed(1),
    hall: +(hall.hp / hall.maxHp).toFixed(3),
    lost: s.stats.aLostCost,
    dKilled: s.stats.dKilled,
  };
}

// ---- 子のプロセス：割り当てられた戦いを走らせて、結果を親へ送る ---------------
if (process.argv[2] === '--child') {
  const [i, n] = process.argv.slice(3).map(Number);
  const { server, S } = await loadSim();
  try {
    const layout = S.preset('basic');
    const eps = S.entryPoints(layout);
    const jobs = jobsOf(S).filter((_, k) => k % n === i);
    const out = jobs.map((job) => {
      const r = run(S, layout, eps, job);
      process.send?.({ tick: 1 });
      return r;
    });
    process.send?.({ done: out });
  } finally {
    await server.close();
  }
  process.exit(0);
}

// ---- 親のプロセス：子に分けて走らせ、まとめる ---------------------------------
const outFile = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const { server, S } = await loadSim();
const total = jobsOf(S).length;
const eps = S.entryPoints(S.preset('basic'));
const nameOf = (k) => S.GDEF[k].busho;
await server.close();

const n = Math.max(1, availableParallelism());
let done = 0;
const t0 = Date.now();
const parts = await Promise.all(
  Array.from(
    { length: n },
    (_, i) =>
      new Promise((resolve, reject) => {
        const c = fork(SELF, ['--child', String(i), String(n)]);
        c.on('message', (m) => {
          if (m.tick) {
            done++;
            if (done % 200 === 0) process.stderr.write(`\r${done} / ${total} 戦`);
          }
          if (m.done) resolve(m.done);
        });
        c.on('error', reject);
        c.on('exit', (code) => code && reject(new Error(`子のプロセスが ${code} で終わりました`)));
      }),
  ),
);
process.stderr.write(`\r${total} / ${total} 戦（${((Date.now() - t0) / 1000).toFixed(0)}秒）\n`);
const all = parts.flat();
if (outFile) writeFileSync(outFile, JSON.stringify(all));

// ---- まとめ -------------------------------------------------------------------
const pct = (a, b) => `${((100 * a) / b).toFixed(1)}%`;
function stat(rs) {
  const wins = rs.filter((r) => r.win);
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    戦: rs.length,
    勝率: pct(wins.length, rs.length),
    '落城まで(秒)': wins.length ? avg(wins.map((r) => r.endT)).toFixed(0) : '—',
    '本丸の残り(負け)': pct(avg(rs.filter((r) => !r.win).map((r) => r.hall)), 1),
  };
}
const withGen = all.filter((r) => r.combo);
const noGen = all.filter((r) => !r.combo);
console.log('\n「基本」の城に対する実績（武将3人の84通り × 編成例5種 × 出撃口8か所。武将なしは比べるため）');
console.table({ '武将3人（84通り）': stat(withGen), 武将なし: stat(noGen) });

console.log('\n武将ごと（その武将が入った組み合わせ）');
const byGen = Object.fromEntries(
  S.GENERAL_ORDER.map((k) => [nameOf(k), stat(withGen.filter((r) => r.combo.includes(k)))]),
);
console.table(byGen);

console.log('\n編成例ごと（武将3人の場合）');
console.table(Object.fromEntries(S.TEMPLATES.map((tpl, t) => [tpl.name, stat(withGen.filter((r) => r.t === t))])));

console.log('\n出撃口ごと（武将3人の場合）');
console.table(Object.fromEntries(eps.map((ep, e) => [ep.name, stat(withGen.filter((r) => r.e === e))])));

const combos = new Map();
for (const r of withGen) {
  const key = r.combo.map(nameOf).join('・');
  if (!combos.has(key)) combos.set(key, []);
  combos.get(key).push(r);
}
const ranked = [...combos.entries()]
  .map(([key, rs]) => ({ key, rs, w: rs.filter((r) => r.win).length }))
  .sort((a, b) => b.w - a.w);
console.log('\n組み合わせの上位10（勝率の高い順。40戦ずつ）');
console.table(Object.fromEntries(ranked.slice(0, 10).map((c) => [c.key, stat(c.rs)])));
console.log('\n組み合わせの下位10');
console.table(Object.fromEntries(ranked.slice(-10).map((c) => [c.key, stat(c.rs)])));
const dist = [0, 0, 0, 0, 0];
for (const c of ranked) dist[Math.min(4, Math.floor((c.w / c.rs.length) * 5))]++;
console.log(
  `\n組み合わせの勝率の分布：0〜20% ${dist[0]}・20〜40% ${dist[1]}・40〜60% ${dist[2]}・60〜80% ${dist[3]}・80〜100% ${dist[4]}（84通り）`,
);
