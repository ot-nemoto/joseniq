// 性能検証の物差し：攻めソロ＋守りソロを、計測専用フィールド（src/sim/simField.ts）で回す。
// 手順は旧 balance-solo（削除済み）と同じで、城だけがコンパクト城に替わっている。
// 使い方: node scripts/field-solo.mjs [--field=flat|hill|yama] [--gen <kind>]（省略時は全員＋武将なし、攻守両方）

const ENTRY_IDX = [1, 7]; // 出撃口：東(1)と南東(7)
const DEF_TROOP_COST = 140;

const { createServer } = await import('vite');
const server = await createServer({
  server: { middlewareMode: true, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
  logLevel: 'error',
});
const S = await server.ssrLoadModule('/src/sim/index.ts');
const { compactFlatLayout, compactHillLayout, compactYamaLayout, COMPACT_POSTS } =
  await server.ssrLoadModule('/src/sim/simField.ts');
await server.close();
const {
  TEMPLATES,
  buildPlan,
  entriesOf,
  entryPoints,
  hallOf,
  createBattle,
  autoStep,
  TIME_LIMIT,
  GENERAL_ORDER,
  GDEF,
  isGeneralKind,
  ADEF,
} = S;

const fieldId = process.argv.find((v) => v.startsWith('--field='))?.slice(8) ?? 'flat';
const layout =
  fieldId === 'yama' ? compactYamaLayout() : fieldId === 'hill' ? compactHillLayout() : compactFlatLayout();
const eps = entryPoints(layout);

const troopCost = (tpl) =>
  tpl.steps.reduce((a, s) => (isGeneralKind(s.kind) ? a : a + (ADEF[s.kind]?.cost ?? 0) * (s.n ?? 1)), 0);
const atkSteps = (tpl, gen) => {
  let placed = false;
  const steps = [];
  for (const s of tpl.steps) {
    if (isGeneralKind(s.kind)) {
      if (gen && !placed) {
        steps.push({ ...s, kind: gen });
        placed = true;
      }
    } else steps.push(s);
  }
  return steps;
};
const defSteps = (tpl) => {
  const f = DEF_TROOP_COST / troopCost(tpl);
  return tpl.steps
    .filter((s) => !isGeneralKind(s.kind))
    .map((s) => ({ ...s, n: Math.max(1, Math.round((s.n ?? 1) * f)) }));
};
const runBattle = (lay, plan, budget) => {
  const s = createBattle(lay);
  s.timeLimit = TIME_LIMIT;
  if (budget != null) s.budgetA = budget;
  s.started = plan.length > 0;
  const auto = { plan, i: 0 };
  for (let g = 0; g < 100000 && !s.over; g++) autoStep(s, auto);
  return s;
};

const onlyGen = process.argv.includes('--gen') ? process.argv[process.argv.indexOf('--gen') + 1] : null;
const gens = onlyGen ? GENERAL_ORDER.filter((g) => g === onlyGen) : GENERAL_ORDER;
const rows = [];
for (const gen of [...gens, null]) {
  for (const side of ['atk', 'def']) {
    for (let tpl = 0; tpl < TEMPLATES.length; tpl++) {
      for (const ei of ENTRY_IDX) {
        const t = TEMPLATES[tpl];
        let lay = layout;
        let plan;
        if (side === 'atk') {
          plan = buildPlan({ ...t, steps: atkSteps(t, gen) }, entriesOf(t, eps, ei));
        } else {
          if (gen) {
            const p = COMPACT_POSTS[ei];
            lay = { ...layout, generals: [{ kind: gen, x: p.x, y: p.y }] };
          }
          plan = buildPlan({ ...t, steps: defSteps(t) }, entriesOf(t, eps, ei));
        }
        const s = runBattle(lay, plan, side === 'def' ? DEF_TROOP_COST : null);
        const hall = hallOf(s);
        const key = gen ? `${side === 'atk' ? 'a' : 'd'}:${gen}` : null;
        const rec = key ? s.stats.dmgBy[key] : undefined;
        rows.push({
          gen: gen ?? 'なし',
          side,
          tpl,
          ei,
          win: s.result === 'win',
          endT: +s.endT.toFixed(1),
          hall: +(hall.hp / hall.maxHp).toFixed(3),
          genDmg: rec ? Math.round(rec.tot) : 0,
          genSkillDmg: rec ? Math.round(rec.skill) : 0,
          genTaken: key ? Math.round(s.stats.takenBy[key] ?? 0) : 0,
          genCasts: key ? (s.stats.castsBy[key] ?? 0) : 0,
          genWardSaved: key ? Math.round(s.stats.wardSavedBy[key] ?? 0) : 0,
          aLost: s.stats.aLost,
        });
      }
    }
  }
  const nm = gen ? GDEF[gen].busho : '武将なし';
  const atk = rows.filter((r) => r.gen === (gen ?? 'なし') && r.side === 'atk');
  const def = rows.filter((r) => r.gen === (gen ?? 'なし') && r.side === 'def');
  const avg = (rs, k) => (rs.length ? rs.reduce((a, r) => a + r[k], 0) / rs.length : 0);
  console.log(
    `${nm}：攻め 勝${atk.filter((r) => r.win).length}/10 本丸${avg(atk, 'hall').toFixed(3)} 与ダメ${Math.round(avg(atk, 'genDmg'))} 被ダメ${Math.round(avg(atk, 'genTaken'))} 時間${avg(atk, 'endT').toFixed(0)}秒｜守り 本丸${avg(def, 'hall').toFixed(3)} 与ダメ${Math.round(avg(def, 'genDmg'))} 防いだ傷${Math.round(avg(def, 'genWardSaved'))}`,
  );
}

import { writeFileSync } from 'node:fs';

writeFileSync(new URL('../joseniq-work-field-solo.json', import.meta.url), JSON.stringify(rows, null, 1));
console.log('結果を scripts/joseniq-work-field-solo.json に書いた');
