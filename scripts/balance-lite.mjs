// 武将の値の調整に使う、軽い計測（攻めと守りの両方）
// 本番の計測（balance-combos.mjs）は4200戦で重いので、反復に使えるよう条件を絞ったもの：
// - 組み合わせは7人から3人の全35通り（本番と同じ）だが、枠への回し方は1通りだけ
//   （本番は3通り。枠の割り当てによる偏りは残るので、最終確認は本番で行う）
// - 編成例は5種すべて、出撃口は東と南東の2か所だけ（balance.mjs の結果で、本丸の残りに差が出た口）
// - 守りは本番にない鏡像：平城の本丸の郭に守将3人を置き、編成例そのまま（将あり）で攻める
//   攻め手は全戦で固定するので、戦の差は守将の組み合わせだけで決まる。
//   将なしの編成例だと本丸の郭に届く前に全滅して守将と一度も戦えない（実測で確認したので使わない）
// 使い方: npm run balance:lite [-- --out 結果.json [--resume]]
// 1戦ごとの記録を JSON で残す（--out）。集計だけなら標準出力で足りる
// 結果は20戦ごとに --out へ書き出すので、途中で止まっても終わった分は残る。
// --resume を付けると、--out にある戦を飛ばして残りだけを回し、結果を足す（止まった計測の続き用）
import { fork } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const RESUME = process.argv.includes('--resume');
const ENTRY_IDX = [1, 7]; // 出撃口：東(1)と南東(7)
// 守将の置き場（平城）：本丸(30,14)の郭の中で、内の門から本丸へ向かう途中に索敵が掛かる3か所
const POSTS = [
  { x: 27, y: 11 },
  { x: 33, y: 11 },
  { x: 28, y: 17 },
];

async function loadSim() {
  const { createServer } = await import('vite');
  const server = await createServer({
    server: { middlewareMode: true, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom',
    logLevel: 'error',
  });
  try {
    return await server.ssrLoadModule('/src/sim/index.ts');
  } finally {
    await server.close();
  }
}

async function runJobs(jobs) {
  const S = await loadSim();
  const {
    TEMPLATES, buildPlan, entriesOf, entryPoints, hallOf, preset, runPlan,
  } = S;
  const layout = preset('flat');
  const eps = entryPoints(layout);
  const noGenCache = new Map();
  const planOf = (tpl, combo, ei) => {
    let steps;
    if (combo === 'orig') {
      steps = tpl.steps; // 編成例そのまま（守りの計測で、攻め手を固定するために使う）
    } else if (combo) {
      let gi = 0;
      steps = tpl.steps.map((s) =>
        S.isGeneralKind(s.kind) ? { ...s, kind: combo[gi++ % combo.length] } : s,
      );
    } else {
      const key = tpl.name;
      if (!noGenCache.has(key)) {
        // 将のいない戦いはできない（呼ぶ側の都合）ので、通常兵に置き換えた作戦で近似する（combos 準拠）
        const troops = ['inf', 'arc', 'shd', 'eng', 'cav'];
        let ti = 0;
        noGenCache.set(
          key,
          tpl.steps.map((s) => (S.isGeneralKind(s.kind) ? { ...s, kind: troops[ti++ % troops.length] } : s)),
        );
      }
      steps = noGenCache.get(key);
    }
    return buildPlan({ ...tpl, steps }, entriesOf(tpl, eps, ei));
  };
  // 20戦ごとに親へ送る（進み具合が見えるように。まとめて最後に送ると、失敗したときに全部失う）
  const CHUNK = 20;
  let buf = [];
  for (const j of jobs) {
    const tpl = TEMPLATES[j.tpl];
    let lay = layout;
    if (j.side === 'def' && j.combo) {
      lay = { ...layout, generals: j.combo.map((kind, i) => ({ kind, x: POSTS[i].x, y: POSTS[i].y })) };
    }
    const combo = j.side === 'atk' ? j.combo : 'orig';
    const s = runPlan(lay, planOf(tpl, combo, j.entry));
    const hall = hallOf(s);
    buf.push({
      ...j,
      win: s.result === 'win',
      endT: +s.endT.toFixed(1),
      hall: +(hall.hp / hall.maxHp).toFixed(3),
      cost: s.stats.aLostCost,
      killed: s.stats.dKilled,
    });
    if (buf.length >= CHUNK) {
      process.send(buf);
      buf = [];
    }
  }
  if (buf.length) process.send(buf);
}

if (process.env.BAL_LITE_WORKER) {
  const jobs = JSON.parse(process.env.BAL_LITE_JOBS);
  await runJobs(jobs);
  process.exit(0);
}

// ---- 親：ジョブを作って配り、集計する ----
const S = await loadSim();
const gens = S.GENERAL_ORDER;
const name = (k) => S.GDEF[k].busho;
const combos = [];
for (let a = 0; a < gens.length; a++)
  for (let b = a + 1; b < gens.length; b++)
    for (let c = b + 1; c < gens.length; c++) combos.push([gens[a], gens[b], gens[c]]);

const jobs = [];
// 攻めと守りを交互に並べる（子プロセスへの偏りをならす）
for (const combo of combos) {
  for (const side of ['atk', 'def'])
    for (let tpl = 0; tpl < S.TEMPLATES.length; tpl++)
      for (const entry of ENTRY_IDX) jobs.push({ side, combo, tpl, entry });
}
for (const side of ['atk', 'def'])
  for (let tpl = 0; tpl < S.TEMPLATES.length; tpl++)
    for (const entry of ENTRY_IDX) jobs.push({ side, combo: null, tpl, entry });

// --resume：--out に記録済みの戦は飛ばす
const jobKey = (j) => `${j.side}|${j.combo ? j.combo.join(',') : ''}|${j.tpl}|${j.entry}`;
let prevRows = [];
if (RESUME && OUT) {
  try {
    prevRows = JSON.parse(readFileSync(OUT, 'utf8'));
  } catch { /* まだ無いなら最初から */ }
}
const doneKeys = new Set(prevRows.map(jobKey));
const todoJobs = jobs.filter((j) => !doneKeys.has(jobKey(j)));
if (prevRows.length) console.log(`記録済みの${prevRows.length}戦を飛ばし、残り${todoJobs.length}戦を回す`);

const W = Math.min(availableParallelism(), 8);
console.log(`軽量版の計測：${jobs.length}戦（攻め${jobs.length / 2}＋守り${jobs.length / 2}、組み合わせ${combos.length}通り×編成例${S.TEMPLATES.length}種×出撃口${ENTRY_IDX.length}か所）を${W}並列で実行`);
const t0 = Date.now();
const slices = Array.from({ length: W }, () => []);
todoJobs.forEach((j, i) => slices[i % W].push(j));
const allRows = [...prevRows];
let done = prevRows.length;
await Promise.all(
  slices.map(
    (slice) =>
      new Promise((resolve, reject) => {
        if (!slice.length) return resolve([]);
        const child = fork(fileURLToPath(import.meta.url), [], {
          env: { ...process.env, BAL_LITE_WORKER: '1', BAL_LITE_JOBS: JSON.stringify(slice) },
          stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        });
        const got = [];
        child.on('message', (rows) => {
          got.push(...rows);
          allRows.push(...rows);
          // 途中で止まっても終わった分が残るよう、その都度書き出す
          if (OUT) writeFileSync(OUT, JSON.stringify(allRows, null, 1));
          done += rows.length;
          const el = (Date.now() - t0) / 1000;
          const eta = done > prevRows.length ? Math.round((el / (done - prevRows.length)) * (jobs.length - done)) : '?';
          console.log(`  ${done}/${jobs.length} 戦 終了（${el.toFixed(0)}秒経過、残り約${eta}秒）`);
          if (got.length >= slice.length) resolve(got);
        });
        child.on('error', reject);
        child.on('exit', (code) => {
          if (got.length < slice.length) reject(new Error(`worker が途中で終了（code=${code}, ${got.length}/${slice.length}戦）`));
        });
      }),
  ),
);
const rows = allRows;
const sec = ((Date.now() - t0) / 1000).toFixed(0);
if (OUT) await writeFile(OUT, JSON.stringify(rows, null, 1));
console.log(`\n全${rows.length}戦 終了（${sec}秒）`);

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sum = (r) => ({
  戦: r.length,
  勝率: pct(r.filter((x) => x.win).length / r.length),
  '勝ちの平均秒': r.some((x) => x.win) ? +avg(r.filter((x) => x.win).map((x) => x.endT)).toFixed(0) : '-',
  '負けの本丸残り': +avg(r.filter((x) => !x.win).map((x) => x.hall)).toFixed(3),
  '本丸残り平均': +avg(r.map((x) => x.hall)).toFixed(3),
});

// ---- 攻めの集計 ----
console.log('\n===== 攻め：武将ごとの値（その武将を含む組み合わせの全戦） =====');
const atk = rows.filter((r) => r.side === 'atk' && r.combo);
console.table(
  Object.fromEntries(
    gens.map((g) => [name(g), sum(atk.filter((r) => r.combo.includes(g)))]),
  ),
);
const atkNone = rows.filter((r) => r.side === 'atk' && !r.combo);
console.log('武将なし（通常兵で近似）:', sum(atkNone));

// ---- 守りの集計（勝率は攻め手のもの。低いほど守りが固い） ----
console.log('\n===== 守り：武将ごとの値（その武将が守る組み合わせへの攻め手の成績） =====');
const def = rows.filter((r) => r.side === 'def' && r.combo);
console.table(
  Object.fromEntries(
    gens.map((g) => {
      const r = def.filter((x) => x.combo.includes(g));
      return [name(g), {
        戦: r.length,
        '攻め手の勝率': pct(r.filter((x) => x.win).length / r.length),
        '本丸残り平均': +avg(r.map((x) => x.hall)).toFixed(3),
        '攻め手の失った兵力': Math.round(avg(r.map((x) => x.cost))),
      }];
    }),
  ),
);
const defNone = rows.filter((r) => r.side === 'def' && !r.combo);
console.log('守将なし:', {
  戦: defNone.length,
  '攻め手の勝率': pct(defNone.filter((x) => x.win).length / defNone.length),
  '本丸残り平均': +avg(defNone.map((x) => x.hall)).toFixed(3),
});

// ---- 組み合わせの上位・下位 ----
// 組み合わせの照合は文字列キーで行う（記録を JSON で往復させると配列の同一性が失われるため）
const byCombo = (side) =>
  combos
    .map((c) => {
      const key = c.join(',');
      const r = rows.filter((x) => x.side === side && x.combo && x.combo.join(',') === key);
      return { 組み合わせ: c.map(name).join('・'), 勝率: r.length ? r.filter((x) => x.win).length / r.length : 0, 本丸残り: +avg(r.map((x) => x.hall)).toFixed(3) };
    });
const atkC = byCombo('atk').sort((a, b) => b.勝率 - a.勝率 || a.本丸残り - b.本丸残り);
console.log('\n攻めの組み合わせ 上位5:');
console.table(atkC.slice(0, 5).map((c) => ({ ...c, 勝率: pct(c.勝率) })));
console.log('攻めの組み合わせ 下位5:');
console.table(atkC.slice(-5).map((c) => ({ ...c, 勝率: pct(c.勝率) })));
const defC = byCombo('def').sort((a, b) => a.勝率 - b.勝率 || b.本丸残り - a.本丸残り);
console.log('\n守りの組み合わせ 上位5（攻め手の勝率が低い順）:');
console.table(defC.slice(0, 5).map((c) => ({ ...c, '攻め手の勝率': pct(c.勝率) })));
console.log('守りの組み合わせ 下位5:');
console.table(defC.slice(-5).map((c) => ({ ...c, '攻め手の勝率': pct(c.勝率) })));
