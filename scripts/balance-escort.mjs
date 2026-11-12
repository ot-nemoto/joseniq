// 付き添い計測：武将ひとり＋決まった兵団で平城を攻め、兵がどれだけ長く生きて働けたかを見る。
// 家康の軍配や秀吉の刀狩のように「味方を助ける」スキルの効果は、武将ひとりの攻め・守りでは数字に出ないため、
// 兵の平均残存期間（出撃してから倒れるまでの秒）と、スキルで防いだ傷で比べる。
// 兵団は編成例5種の兵そのまま（コスト約60）。武将は最初の将枠に入れ、残りの将枠は空ける。
// 使い方: npm run balance:escort [-- --out 結果.json]
import { writeFile } from 'node:fs/promises';

const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const ENTRY_IDX = [1, 7]; // 出撃口：東(1)と南東(7)

const { createServer } = await import('vite');
const server = await createServer({
  server: { middlewareMode: true, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
  logLevel: 'error',
});
const S = await server.ssrLoadModule('/src/sim/index.ts');
await server.close();

const { TEMPLATES, buildPlan, entriesOf, entryPoints, hallOf, preset } = S;
const layout = preset('flat');
const eps = entryPoints(layout);
const onlyGen = process.argv.includes('--gen') ? process.argv[process.argv.indexOf('--gen') + 1] : null;
const gens = onlyGen ? S.GENERAL_ORDER.filter((g) => g === onlyGen) : S.GENERAL_ORDER;
const name = (k) => S.GDEF[k].busho;

const stepsOf = (tpl, gen) => {
  let placed = false;
  const steps = [];
  for (const st of tpl.steps) {
    if (S.isGeneralKind(st.kind)) {
      if (gen && !placed) {
        steps.push({ ...st, kind: gen });
        placed = true;
      }
    } else steps.push(st);
  }
  return steps;
};

// 1戦を手で進め、兵の生死を毎ティック見る（runPlan と同じ進め方に、記録だけ足したもの）
const runEscort = (tpl, gen, ei) => {
  const plan = buildPlan({ ...tpl, steps: stepsOf(tpl, gen) }, entriesOf(tpl, eps, ei));
  const s = S.createBattle(layout);
  s.timeLimit = S.TIME_LIMIT;
  s.started = plan.length > 0;
  const auto = { plan, i: 0 };
  const born = new Map(); // 兵の番号 → 出撃した秒
  const lastAlive = new Map(); // 兵の番号 → 最後に生きていた秒
  for (let g = 0; g < 100000 && !s.over; g++) {
    S.autoStep(s, auto);
    for (const a of s.attackers) {
      if (a.summoner || S.ADEF[a.kind].general) continue;
      if (!born.has(a.id)) born.set(a.id, s.t);
      if (a.hp > 0) lastAlive.set(a.id, s.t);
    }
  }
  const hall = hallOf(s);
  const key = gen ? `a:${gen}` : null;
  const lives = [...born.keys()].map((id) => (lastAlive.get(id) ?? born.get(id)) - born.get(id));
  const troopDmg = Object.entries(s.stats.dmgBy)
    .filter(([k]) => k.startsWith('a:') && k !== key)
    .reduce((a, [, r]) => a + r.tot, 0);
  return {
    gen,
    tpl: tpl.name,
    entry: ei,
    win: s.result === 'win',
    endT: +s.endT.toFixed(1),
    hall: +(hall.hp / hall.maxHp).toFixed(3),
    bDown: s.buildings.filter((b) => b.hp <= 0).length,
    bTotal: s.buildings.length,
    squadN: born.size,
    meanLife: lives.length ? +(lives.reduce((a, b) => a + b, 0) / lives.length).toFixed(1) : 0,
    life30: lives.length ? +(lives.filter((v) => v >= 30).length / lives.length).toFixed(3) : 0,
    troopDmg: Math.round(troopDmg),
    genDmg: key ? Math.round(s.stats.dmgBy[key]?.tot ?? 0) : 0,
    wardSaved: key ? Math.round(s.stats.wardSavedBy[key] ?? 0) : 0,
  };
};

const rows = [];
for (const gen of [...gens, null])
  for (const tpl of TEMPLATES)
    for (const ei of ENTRY_IDX) {
      rows.push(runEscort(tpl, gen, ei));
      console.log(`  ${gen ? name(gen) : '武将なし'} / ${tpl.name} / 出撃口${ei} 終了`);
    }
if (OUT) await writeFile(OUT, JSON.stringify(rows, null, 1));

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
console.log(`\n===== 付き添い：武将＋編成例の兵団で攻める（編成例5種×出撃口2か所の平均） =====`);
console.table(
  Object.fromEntries(
    [...gens, null].map((g) => {
      const r = rows.filter((x) => x.gen === g);
      return [
        g ? name(g) : '武将なし',
        {
          '兵の平均残存期間': +avg(r.map((x) => x.meanLife)).toFixed(1),
          '残存30秒以上の兵': pct(avg(r.map((x) => x.life30))),
          '兵の与えた傷': Math.round(avg(r.map((x) => x.troopDmg))),
          '武将の与えた傷': Math.round(avg(r.map((x) => x.genDmg))),
          '軍配で防いだ傷': Math.round(avg(r.map((x) => x.wardSaved))),
          '施設破壊率': pct(avg(r.map((x) => x.bDown / x.bTotal))),
          '本丸残り平均': +avg(r.map((x) => x.hall)).toFixed(3),
        },
      ];
    }),
  ),
);
