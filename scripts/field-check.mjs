// 一時用：計測フィールドの地図表示と、試し戦（現行平城との比較）
const { createServer } = await import('vite');
const server = await createServer({
  server: { middlewareMode: true, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
  logLevel: 'error',
});
const S = await server.ssrLoadModule('/src/sim/index.ts');
const { compactFlatLayout, compactHillLayout, compactYamaLayout } = await server.ssrLoadModule('/src/sim/simField.ts');
const builders = { flat: compactFlatLayout, hill: compactHillLayout, yama: compactYamaLayout };
const names = { flat: '平城コンパクト', hill: '平山城コンパクト', yama: '山城コンパクト' };
const fid = ['flat', 'hill', 'yama'].find((v) => process.argv.includes(v)) ?? 'flat';
const compactFlat = () => builders[fid]();
console.log(`対象：${names[fid]}`);
await server.close();
const { entryPoints, TEMPLATES, buildPlan, entriesOf, createBattle, autoStep, hallOf, TIME_LIMIT } = S;
function run(lay, tplIdx, ei, label) {
  const eps = entryPoints(lay);
  const tpl = TEMPLATES[tplIdx];
  const plan = buildPlan(tpl, entriesOf(tpl, eps, ei));
  const s = createBattle(lay);
  s.timeLimit = TIME_LIMIT;
  s.started = plan.length > 0;
  const auto = { plan, i: 0 };
  for (let g = 0; g < 100000 && !s.over; g++) autoStep(s, auto);
  const hall = hallOf(s);
  let dDmg = 0,
    aDmg = 0;
  for (const [k, v] of Object.entries(s.stats.dmgBy)) {
    if (k.startsWith('d:')) dDmg += v.tot;
    else aDmg += v.tot;
  }
  const taken = Math.round(Object.values(s.stats.takenBy).reduce((a, b) => a + b, 0));
  console.log(
    `${label}：結果=${s.result} 終了=${s.endT.toFixed(1)}秒 本丸=${(hall.hp / hall.maxHp).toFixed(3)} 門=${s.stats.gateDown} 攻め喪失=${s.stats.aLost} 攻め被ダメ=${taken} 守り与ダメ=${Math.round(dDmg)} 攻め与ダメ=${Math.round(aDmg)}`,
  );
}
for (let t = 0; t < TEMPLATES.length; t++) {
  run(compactFlat(), t, 1, `コンパクト・編成例${t}(${TEMPLATES[t].name})・東口`);
  run(compactFlat(), t, 7, `コンパクト・編成例${t}(${TEMPLATES[t].name})・南東口`);
}
