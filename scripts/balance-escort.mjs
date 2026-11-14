// 付き添い計測：武将ひとり＋決まった兵団で城を攻め、兵がどれだけ長く生きて働けたかを見る。
// 家康の金城鉄壁や秀吉の諸行無常のように「味方を助ける」スキルの効果は、武将ひとりの攻め・守りでは数字に出ないため、
// 兵の平均残存期間（出撃してから倒れるまでの秒）と、スキルで防いだ傷で比べる。
// 兵種ごとの内訳（残存期間と与えた傷）も出す。兵種によって助かり方が違うスキルを見るため。
// 兵種ごとには、相手別（兵・武将・建物・本丸）の与えた傷、倒した兵の数、壊した建物の数、
// 受けた傷、本丸への命中（その兵種が初めて本丸に傷を与えた秒と、出た戦いのうち当てた割合）も記録する。
// 兵団は編成例5種の兵そのまま（コスト約60）。武将は最初の将枠に入れ、残りの将枠は空ける。
// 計測する城は --field で選ぶ（flat=平城コンパクト、hill=平山城コンパクト、yama=山城コンパクト、legacy=平城（基本））。
// 既定は平城コンパクト。2026-11-13に3地形コンパクトを計測の物差しとして採用したため。
// 使い方: npm run balance:escort [-- --out 結果.json] [-- --field hill] [-- --gen guard]
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

const { TEMPLATES, buildPlan, entriesOf, entryPoints, hallOf, preset, SIM_FIELDS } = S;
const fieldArg =
  process.argv.find((v) => v.startsWith('--field='))?.slice(8) ??
  (process.argv.includes('--field') ? process.argv[process.argv.indexOf('--field') + 1] : undefined);
const fieldId = fieldArg ?? 'flat';
const field =
  fieldId === 'legacy'
    ? { id: 'legacy', name: '平城（基本）', build: () => preset('flat') }
    : SIM_FIELDS.find((f) => f.id === fieldId);
if (!field) throw new Error(`--field は flat / hill / yama / legacy のどれかで指定してください（指定: ${fieldId}）`);
const layout = field.build();
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
  const kindOf = new Map(); // 兵の番号 → 兵種
  const hitT = new Map(); // 兵種 → 本丸に初めて傷を与えた秒
  const prevHallDmg = new Map(); // 「側:兵種」キー → 前回見た時点までの本丸への傷
  for (let g = 0; g < 100000 && !s.over; g++) {
    S.autoStep(s, auto);
    for (const a of s.attackers) {
      if (a.summoner || S.ADEF[a.kind].general) continue;
      if (!born.has(a.id)) {
        born.set(a.id, s.t);
        kindOf.set(a.id, a.kind);
      }
      if (a.hp > 0) lastAlive.set(a.id, s.t);
    }
    // 本丸への傷が増えた兵種は、その時点で初めて本丸に攻撃が当たったとみなす
    for (const [k, r] of Object.entries(s.stats.dmgBy)) {
      if (!k.startsWith('a:')) continue;
      const prev = prevHallDmg.get(k) ?? 0;
      if (r.hall > prev && !hitT.has(k.slice(2))) hitT.set(k.slice(2), s.t);
      prevHallDmg.set(k, r.hall);
    }
  }
  const hall = hallOf(s);
  const key = gen ? `a:${gen}` : null;
  const lives = [...born.keys()].map((id) => (lastAlive.get(id) ?? born.get(id)) - born.get(id));
  const troopDmg = Object.entries(s.stats.dmgBy)
    .filter(([k]) => k.startsWith('a:') && k !== key)
    .reduce((a, [, r]) => a + r.tot, 0);
  // 兵種ごとの内訳：残存は兵1体ずつの記録から、与えた傷は記録の「側:兵種」キーから
  const byKind = {};
  const ensureKind = (kind) => {
    if (!byKind[kind])
      byKind[kind] = {
        n: 0,
        lifeSum: 0,
        life30n: 0,
        dmg: 0,
        dmgUnit: 0,
        dmgGen: 0,
        dmgBld: 0,
        dmgHall: 0,
        dmgSkill: 0,
        kills: 0,
        bKills: 0,
        taken: 0,
        hitT: null, // この戦いで初めて本丸に傷を与えた秒（当たらなければ null）
      };
    return byKind[kind];
  };
  for (const [id, kind] of kindOf) {
    const e = ensureKind(kind);
    const life = (lastAlive.get(id) ?? born.get(id)) - born.get(id);
    e.n += 1;
    e.lifeSum += life;
    if (life >= 30) e.life30n += 1;
  }
  // 戦いに実際に出た兵種だけを集計する（信玄の呼んだ騎兵のような、編成外の召喚は兵種に混ぜない）
  const deployedKinds = new Set(kindOf.values());
  for (const [k, r] of Object.entries(s.stats.dmgBy)) {
    if (!k.startsWith('a:') || k === key || !deployedKinds.has(k.slice(2))) continue;
    const e = ensureKind(k.slice(2));
    e.dmg += Math.round(r.tot);
    e.dmgUnit += Math.round(r.unit);
    e.dmgGen += Math.round(r.gen);
    e.dmgBld += Math.round(r.bld);
    e.dmgHall += Math.round(r.hall);
    e.dmgSkill += Math.round(r.skill);
  }
  for (const [k, v] of Object.entries(s.stats.killBy)) {
    if (!k.startsWith('a:') || k === key || !deployedKinds.has(k.slice(2))) continue;
    ensureKind(k.slice(2)).kills += v;
  }
  for (const [k, v] of Object.entries(s.stats.bKillBy)) {
    if (!k.startsWith('a:') || k === key || !deployedKinds.has(k.slice(2))) continue;
    ensureKind(k.slice(2)).bKills += v;
  }
  for (const [k, v] of Object.entries(s.stats.takenBy)) {
    if (!k.startsWith('a:') || k === key || !deployedKinds.has(k.slice(2))) continue;
    ensureKind(k.slice(2)).taken += Math.round(v);
  }
  for (const kind of deployedKinds) {
    if (hitT.has(kind)) ensureKind(kind).hitT = +hitT.get(kind).toFixed(1);
  }
  for (const e of Object.values(byKind)) e.lifeSum = +e.lifeSum.toFixed(1);
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
    byKind,
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
console.log(`\n===== 付き添い（${field.name}）：武将＋編成例の兵団で攻める（編成例5種×出撃口2か所の平均） =====`);
console.table(
  Object.fromEntries(
    [...gens, null].map((g) => {
      const r = rows.filter((x) => x.gen === g);
      return [
        g ? name(g) : '武将なし',
        {
          兵の平均残存期間: +avg(r.map((x) => x.meanLife)).toFixed(1),
          残存30秒以上の兵: pct(avg(r.map((x) => x.life30))),
          兵の与えた傷: Math.round(avg(r.map((x) => x.troopDmg))),
          武将の与えた傷: Math.round(avg(r.map((x) => x.genDmg))),
          金城鉄壁で防いだ傷: Math.round(avg(r.map((x) => x.wardSaved))),
          施設破壊率: pct(avg(r.map((x) => x.bDown / x.bTotal))),
          本丸残り平均: +avg(r.map((x) => x.hall)).toFixed(3),
        },
      ];
    }),
  ),
);

// 兵種ごとの内訳：その兵種が出てきた戦い全部をまとめて（体数の重みつき）比べる
const kinds = [...new Set(rows.flatMap((r) => Object.keys(r.byKind)))];
for (const kind of kinds) {
  console.log(`\n--- 兵種ごと：${S.ADEF[kind].name} ---`);
  console.table(
    Object.fromEntries(
      [...gens, null].map((g) => {
        const r = rows.filter((x) => x.gen === g && x.byKind[kind]);
        const n = r.reduce((a, x) => a + x.byKind[kind].n, 0);
        const lifeSum = r.reduce((a, x) => a + x.byKind[kind].lifeSum, 0);
        const life30n = r.reduce((a, x) => a + x.byKind[kind].life30n, 0);
        const dmg = r.reduce((a, x) => a + x.byKind[kind].dmg, 0);
        const dmgHall = r.reduce((a, x) => a + x.byKind[kind].dmgHall, 0);
        const dmgBld = r.reduce((a, x) => a + x.byKind[kind].dmgBld, 0);
        const bKills = r.reduce((a, x) => a + x.byKind[kind].bKills, 0);
        const kills = r.reduce((a, x) => a + x.byKind[kind].kills, 0);
        const taken = r.reduce((a, x) => a + x.byKind[kind].taken, 0);
        const hitRows = r.filter((x) => x.byKind[kind].hitT !== null);
        return [
          g ? name(g) : '武将なし',
          {
            兵の数: n,
            平均残存期間: n ? +(lifeSum / n).toFixed(1) : 0,
            残存30秒以上: n ? pct(life30n / n) : '-',
            与えた傷_1戦平均: r.length ? Math.round(dmg / r.length) : 0,
            本丸への傷_1戦平均: r.length ? Math.round(dmgHall / r.length) : 0,
            建物への傷_1戦平均: r.length ? Math.round(dmgBld / r.length) : 0,
            壊した建物_10戦: bKills,
            倒した兵_10戦: kills,
            受けた傷_1戦平均: r.length ? Math.round(taken / r.length) : 0,
            本丸命中率: r.length ? pct(hitRows.length / r.length) : '-',
            本丸命中_平均秒: hitRows.length
              ? +(hitRows.reduce((a, x) => a + x.byKind[kind].hitT, 0) / hitRows.length).toFixed(1)
              : '-',
          },
        ];
      }),
    ),
  );
}
