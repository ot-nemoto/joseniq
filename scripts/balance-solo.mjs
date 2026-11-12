// 武将ひとりの性能を比べる計測（攻めと守りの両方）。ユーザーの指定（2026-11-12）：
// - 攻め：武将はその武将ひとりだけ（他の将枠は空け、兵は編成例そのまま）。守将は置かない
// - 守り：守将はその武将ひとりだけ（＋城の施設）。攻め手は武将なしで、兵コスト140ぶんの兵だけで攻める
//   （編成例の兵の構成比を保って、合計コストが140になるよう数を増やす。将枠は空ける）
//   攻め手の兵力上限は本番では60（BUDGET_A）で、140の作戦はそのままでは60ぶんしか出撃できない。
//   守りの計測だけ、runPlan と同じ手順で戦いの budgetA を140に広げて出す（計測専用。本番の値は変えない）
// これで、武将ごとの数字が「その武将ひとりの寄与」に近くなる（組み合わせの集計だった lite との違い）
// 使い方: npm run balance:solo [-- --out 結果.json [--resume]]
// 結果は20戦ごとに --out へ書き出す。--resume で記録済みの戦を飛ばせる
import { fork } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const RESUME = process.argv.includes('--resume');
const ENTRY_IDX = [1, 7]; // 出撃口：東(1)と南東(7)（lite と同じ）
// 守将ひとりの置き場（平城）：攻め手の来る口に合わせて、その進路に当たる持ち場に置く
// （置き場が進路から外れると、近接の守将が一度も戦わないまま終わるため。東口は (33,11)、南東口は (28,17)。どちらも lite の3か所のうちの1つ）
const POSTS = { 1: { x: 33, y: 11 }, 7: { x: 28, y: 17 } };
const DEF_TROOP_COST = 140; // 守りの計測で、攻め手の兵に使わせる合計コスト

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

// 編成例の兵コスト（将は数えない）
const troopCost = (S, tpl) =>
  tpl.steps.reduce((a, s) => (S.isGeneralKind(s.kind) ? a : a + (S.ADEF[s.kind]?.cost ?? 0) * (s.n ?? 1)), 0);

// 攻め：将枠の最初にその武将を入れ、残りの将枠は空ける。兵はそのまま
const atkSteps = (S, tpl, gen) => {
  let placed = false;
  const steps = [];
  for (const s of tpl.steps) {
    if (S.isGeneralKind(s.kind)) {
      if (gen && !placed) {
        steps.push({ ...s, kind: gen });
        placed = true;
      }
    } else steps.push(s);
  }
  return steps;
};

// 守りの攻め手：将枠を空け、兵の数を合計コスト DEF_TROOP_COST になるよう増やす（構成比は保つ）
const defSteps = (S, tpl) => {
  const f = DEF_TROOP_COST / troopCost(S, tpl);
  return tpl.steps
    .filter((s) => !S.isGeneralKind(s.kind))
    .map((s) => ({ ...s, n: Math.max(1, Math.round((s.n ?? 1) * f)) }));
};
const scaledCost = (S, tpl) =>
  defSteps(S, tpl).reduce((a, s) => a + (S.ADEF[s.kind]?.cost ?? 0) * (s.n ?? 1), 0);

// runPlan と同じ手順だが、守りの計測では攻め手の兵力（budgetA）を広げられるようにしたもの
const runWithBudget = (S, layout, plan, budget) => {
  const s = S.createBattle(layout);
  s.timeLimit = S.TIME_LIMIT;
  if (budget != null) s.budgetA = budget;
  s.started = plan.length > 0;
  const auto = { plan, i: 0 };
  for (let g = 0; g < 100000 && !s.over; g++) S.autoStep(s, auto);
  return s;
};

async function runJobs(jobs) {
  const S = await loadSim();
  const { TEMPLATES, buildPlan, entriesOf, entryPoints, hallOf, preset } = S;
  const layout = preset('flat');
  const eps = entryPoints(layout);
  const planCache = new Map();
  const planOf = (side, gen, tpl, ei) => {
    const key = `${side}|${gen ?? ''}|${tpl.name}|${ei}`;
    if (!planCache.has(key)) {
      const steps = side === 'atk' ? atkSteps(S, tpl, gen) : defSteps(S, tpl);
      planCache.set(key, buildPlan({ ...tpl, steps }, entriesOf(tpl, eps, ei)));
    }
    return planCache.get(key);
  };
  const CHUNK = 20;
  let buf = [];
  for (const j of jobs) {
    const tpl = TEMPLATES[j.tpl];
    let lay = layout;
    if (j.side === 'def' && j.gen) {
      const p = POSTS[j.entry] ?? POSTS[1];
      lay = { ...layout, generals: [{ kind: j.gen, x: p.x, y: p.y }] };
    }
    const s = runWithBudget(S, lay, planOf(j.side, j.gen, tpl, j.entry), j.side === 'def' ? DEF_TROOP_COST : null);
    const hall = hallOf(s);
    // 測っている武将の残り体力（いなければ倒れたものとして0）
    const me = j.gen
      ? (j.side === 'atk' ? s.attackers : s.defenders).find((u) => u.kind === j.gen)
      : null;
    const key = j.gen ? `${j.side === 'atk' ? 'a' : 'd'}:${j.gen}` : null;
    const rec = key ? s.stats.dmgBy[key] : undefined;
    buf.push({
      ...j,
      win: s.result === 'win',
      endT: +s.endT.toFixed(1),
      hall: +(hall.hp / hall.maxHp).toFixed(3),
      cost: s.stats.aLostCost,
      killed: s.stats.dKilled,
      tDown: s.stats.tDown,
      gateDown: s.stats.gateDown,
      spent: s.stats.spent,
      aLost: s.stats.aLost,
      genHp: j.gen ? (me ? +Math.max(0, me.hp / me.maxHp).toFixed(3) : 0) : -1,
      bDown: s.buildings.filter((b) => b.hp <= 0).length,
      bTotal: lay.buildings.length,
      // 武将本人の記録（呼んだ兵の傷は、呼んだ武将のスキルの傷に数えている）
      genDmg: rec ? Math.round(rec.tot) : 0,
      genSkillDmg: rec ? Math.round(rec.skill) : 0,
      genKills: key ? (s.stats.killBy[key] ?? 0) : 0,
      genTaken: key ? Math.round(s.stats.takenBy[key] ?? 0) : 0,
      genCasts: key ? (s.stats.castsBy[key] ?? 0) : 0,
      genDeathT: key && s.stats.genDeathT[key] !== undefined ? +s.stats.genDeathT[key].toFixed(1) : -1,
      genWardSaved: key ? Math.round(s.stats.wardSavedBy[key] ?? 0) : 0,
    });
    if (buf.length >= CHUNK) {
      process.send(buf);
      buf = [];
    }
  }
  if (buf.length) process.send(buf);
}

if (process.env.BAL_SOLO_WORKER) {
  const jobs = JSON.parse(process.env.BAL_SOLO_JOBS);
  await runJobs(jobs);
  process.exit(0);
}

// ---- 親：ジョブを作って配り、集計する ----
const S = await loadSim();
const onlyGen = process.argv.includes('--gen') ? process.argv[process.argv.indexOf('--gen') + 1] : null;
const gens = onlyGen ? S.GENERAL_ORDER.filter((g) => g === onlyGen) : S.GENERAL_ORDER;
const name = (k) => S.GDEF[k].busho;

const jobs = [];
for (const gen of [...gens, null])
  for (const side of ['atk', 'def'])
    for (let tpl = 0; tpl < S.TEMPLATES.length; tpl++)
      for (const entry of ENTRY_IDX) jobs.push({ side, gen, tpl, entry });

const jobKey = (j) => `${j.side}|${j.gen ?? ''}|${j.tpl}|${j.entry}`;
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
console.log(
  `武将ひとりの計測：${jobs.length}戦（攻め・守り 各${jobs.length / 2}戦）を${W}並列で実行。` +
    `守りの攻め手の兵コスト（編成例ごと）: ${S.TEMPLATES.map((t) => scaledCost(S, t)).join(' / ')}`,
);
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
          env: { ...process.env, BAL_SOLO_WORKER: '1', BAL_SOLO_JOBS: JSON.stringify(slice) },
          stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        });
        const got = [];
        child.on('message', (rows) => {
          got.push(...rows);
          allRows.push(...rows);
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
const sumAtk = (r) => ({
  戦: r.length,
  勝率: pct(r.filter((x) => x.win).length / r.length),
  '勝ちの平均秒': r.some((x) => x.win) ? +avg(r.filter((x) => x.win).map((x) => x.endT)).toFixed(0) : '-',
  '本丸残り平均': +avg(r.map((x) => x.hall)).toFixed(3),
  '施設破壊率': pct(avg(r.map((x) => (x.bDown ?? 0) / (x.bTotal || 1)))),
  '兵士残存率': pct(avg(r.map((x) => 1 - (x.cost ?? 0) / (x.spent || 1)))),
  '武将の残り体力': r.some((x) => x.genHp >= 0) ? pct(avg(r.filter((x) => x.genHp >= 0).map((x) => x.genHp))) : '-',
  '武将の生存率': r.some((x) => x.genHp >= 0) ? pct(r.filter((x) => x.genHp > 0).length / r.filter((x) => x.genHp >= 0).length) : '-',
  '武将の与えた傷': Math.round(avg(r.map((x) => x.genDmg ?? 0))),
  'うちスキルの傷': Math.round(avg(r.map((x) => x.genSkillDmg ?? 0))),
  'スキル回数': +avg(r.map((x) => x.genCasts ?? 0)).toFixed(1),
  '倒れた秒': r.some((x) => x.genDeathT >= 0) ? +avg(r.filter((x) => x.genDeathT >= 0).map((x) => x.genDeathT)).toFixed(0) : '-',
  '軍配で防いだ傷': Math.round(avg(r.map((x) => x.genWardSaved ?? 0))),
});

console.log('\n===== 攻め：武将ひとり（＋編成例の兵、守将なし） =====');
const atk = rows.filter((r) => r.side === 'atk' && r.gen);
console.table(Object.fromEntries(gens.map((g) => [name(g), sumAtk(atk.filter((r) => r.gen === g))])));
console.log('武将なし（兵だけ）:', sumAtk(rows.filter((r) => r.side === 'atk' && !r.gen)));

console.log('\n===== 守り：武将ひとり（＋施設、攻め手は兵コスト140・武将なし） =====');
const def = rows.filter((r) => r.side === 'def' && r.gen);
console.table(
  Object.fromEntries(
    gens.map((g) => {
      const r = def.filter((x) => x.gen === g);
      return [name(g), {
        戦: r.length,
        '攻め手の勝率': pct(r.filter((x) => x.win).length / r.length),
        '本丸残り平均': +avg(r.map((x) => x.hall)).toFixed(3),
        '攻め手の兵士残存率': pct(avg(r.map((x) => 1 - (x.cost ?? 0) / (x.spent || 1)))),
        '守将の残り体力': pct(avg(r.map((x) => Math.max(0, x.genHp)))),
        '守将の生存率': pct(r.filter((x) => x.genHp > 0).length / r.length),
        '守将の与えた傷': Math.round(avg(r.map((x) => x.genDmg ?? 0))),
        '守将の倒した兵': +avg(r.map((x) => x.genKills ?? 0)).toFixed(1),
        '守将の受けた傷': Math.round(avg(r.map((x) => x.genTaken ?? 0))),
        '守将の倒れた秒': r.some((x) => x.genDeathT >= 0) ? +avg(r.filter((x) => x.genDeathT >= 0).map((x) => x.genDeathT)).toFixed(0) : '-',
        '軍配で防いだ傷': Math.round(avg(r.map((x) => x.genWardSaved ?? 0))),
      }];
    }),
  ),
);
const defNone = rows.filter((r) => r.side === 'def' && !r.gen);
console.log('守将なし:', {
  戦: defNone.length,
  '攻め手の勝率': pct(defNone.filter((x) => x.win).length / defNone.length),
  '本丸残り平均': +avg(defNone.map((x) => x.hall)).toFixed(3),
  '攻め手の兵士残存率': pct(avg(defNone.map((x) => 1 - (x.cost ?? 0) / (x.spent || 1)))),
});
