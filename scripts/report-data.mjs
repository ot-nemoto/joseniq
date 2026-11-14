// バランス調整レポート用の集計スクリプト。
// 計測ランが出力した生データ（solo-*.json / duel.json / rows.json）を読み、
// レポートに載せる武将別・兵種別の集計値を JSON で標準出力に出す。
// 使い方: node scripts/report-data.mjs <ランのディレクトリ>
//   ランのディレクトリには field-solo の solo-<地形>.json、
//   balance-duel の duel.json、balance-escort の rows.json を置く
//   （無いファイルは飛ばす）。
// 集計の約束:
//   - 与ダメージ系・被ダメージは「その対象が出た戦い」の1戦平均。
//   - 兵種の平均残存期間は、戦いごとの合計残存期間 ÷ 兵の総数。
//   - 本丸到達率は「その兵種が出た戦いのうち、本丸に初めて傷を与えた
//     戦いの割合」。平均到達時間は当てた戦いだけの平均。
//   - gen が null（付き添い）や "なし"（ソロ）の行は武将なしの基準。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const runDir = process.argv[2];
if (!runDir) {
  console.error('使い方: node scripts/report-data.mjs <ランのディレクトリ>');
  process.exit(1);
}

const readJson = (name) => {
  const p = join(runDir, name);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (x, d = 3) => {
  const f = 10 ** d;
  return Math.round(x * f) / f;
};

const out = {};

// ---- ソロ（field-solo の solo-<地形>.json） ----
out.solo = {};
for (const field of ['flat', 'hill', 'yama']) {
  const rows = readJson(`solo-${field}.json`);
  if (!rows) continue;
  const bySide = {};
  for (const side of ['atk', 'def']) {
    const gens = {};
    for (const r of rows.filter((x) => x.side === side)) {
      if (!gens[r.gen]) gens[r.gen] = { battles: 0, wins: 0, hall: [], genDmg: [] };
      const g = gens[r.gen];
      g.battles += 1;
      if (r.win) g.wins += 1;
      g.hall.push(r.hall);
      g.genDmg.push(r.genDmg);
    }
    bySide[side] = Object.fromEntries(
      Object.entries(gens).map(([gen, g]) => [
        gen,
        {
          battles: g.battles,
          wins: g.wins,
          hallAvg: round(avg(g.hall)),
          genDmgAvg: round(avg(g.genDmg), 0),
        },
      ]),
    );
  }
  out.solo[field] = bySide;
}

// ---- 一騎打ち（balance-duel の duel.json） ----
const duel = readJson('duel.json');
if (duel) {
  const wins = {};
  for (const m of duel.matches) {
    wins[m.left] ??= 0;
    wins[m.right] ??= 0;
    if (m.winner) wins[m.winner] += 1;
  }
  out.duel = { matches: duel.matches.length, wins };
}

// ---- 付き添い（balance-escort の rows.json） ----
const escort = readJson('rows.json');
if (escort) {
  const key = (g) => g ?? 'none';
  // 武将別
  const perGen = {};
  for (const r of escort) {
    const k = key(r.gen);
    if (!perGen[k]) perGen[k] = { battles: 0, meanLife: [], troopDmg: [], genDmg: [], wardSaved: [], hall: [] };
    const g = perGen[k];
    g.battles += 1;
    g.meanLife.push(r.meanLife);
    g.troopDmg.push(r.troopDmg);
    g.genDmg.push(r.genDmg);
    g.wardSaved.push(r.wardSaved);
    g.hall.push(r.hall);
  }
  out.escort = {
    perGen: Object.fromEntries(
      Object.entries(perGen).map(([gen, g]) => [
        gen,
        {
          battles: g.battles,
          meanLifeAvg: round(avg(g.meanLife), 1),
          troopDmgAvg: round(avg(g.troopDmg), 0),
          genDmgAvg: round(avg(g.genDmg), 0),
          wardSavedAvg: round(avg(g.wardSaved), 0),
          hallAvg: round(avg(g.hall)),
        },
      ]),
    ),
  };
  // 兵種別（武将ごと）と、編成ごとの本丸到達
  const kinds = ['inf', 'arc', 'eng', 'shd', 'ram', 'cav'];
  const blank = () => ({
    battles: 0,
    troops: 0,
    lifeSum: 0,
    dmg: 0,
    dmgUnit: 0,
    dmgGen: 0,
    dmgBld: 0,
    dmgHall: 0,
    dmgSkill: 0,
    kills: 0,
    bKills: 0,
    taken: 0,
    hitBattles: 0,
    hitT: [],
  });
  const acc = (a, k, b) => {
    a.battles += 1;
    a.troops += b.n;
    a.lifeSum += b.lifeSum;
    for (const f of ['dmg', 'dmgUnit', 'dmgGen', 'dmgBld', 'dmgHall', 'dmgSkill', 'kills', 'bKills', 'taken']) {
      a[f] += b[f] ?? 0;
    }
    if (k === undefined) return;
    if (b.hitT != null) {
      a.hitBattles += 1;
      a.hitT.push(b.hitT);
    }
  };
  const finish = (a) => ({
    battles: a.battles,
    troops: a.troops,
    lifeAvg: round(a.troops ? a.lifeSum / a.troops : 0, 1),
    dmgPerBattle: round(a.battles ? a.dmg / a.battles : 0, 0),
    dmgUnitPerBattle: round(a.battles ? a.dmgUnit / a.battles : 0, 0),
    dmgGenPerBattle: round(a.battles ? a.dmgGen / a.battles : 0, 0),
    dmgBldPerBattle: round(a.battles ? a.dmgBld / a.battles : 0, 0),
    dmgHallPerBattle: round(a.battles ? a.dmgHall / a.battles : 0, 0),
    dmgSkillPerBattle: round(a.battles ? a.dmgSkill / a.battles : 0, 0),
    killsPerBattle: round(a.battles ? a.kills / a.battles : 0, 1),
    bKillsPerBattle: round(a.battles ? a.bKills / a.battles : 0, 1),
    takenPerBattle: round(a.battles ? a.taken / a.battles : 0, 0),
    hitRate: round(a.battles ? a.hitBattles / a.battles : 0, 3),
    hitBattles: a.hitBattles,
    hitAvgT: a.hitT.length ? round(avg(a.hitT), 1) : null,
  });
  const byKind = {};
  const byTplKind = {};
  for (const r of escort) {
    if (!byKind[key(r.gen)]) byKind[key(r.gen)] = {};
    if (!byTplKind[r.tpl]) byTplKind[r.tpl] = {};
    const g = byKind[key(r.gen)];
    const t = byTplKind[r.tpl];
    for (const kind of kinds) {
      const b = r.byKind?.[kind];
      if (!b) continue;
      if (!g[kind]) g[kind] = blank();
      if (!t[kind]) t[kind] = blank();
      acc(g[kind], kind, b);
      acc(t[kind], kind, b);
    }
  }
  out.escort.byKind = Object.fromEntries(
    Object.entries(byKind).map(([gen, ks]) => [
      gen,
      Object.fromEntries(Object.entries(ks).map(([kind, a]) => [kind, finish(a)])),
    ]),
  );
  out.escort.byTplKind = Object.fromEntries(
    Object.entries(byTplKind).map(([tpl, ks]) => [
      tpl,
      Object.fromEntries(
        Object.entries(ks).map(([kind, a]) => [
          kind,
          {
            battles: a.battles,
            hitRate: round(a.battles ? a.hitBattles / a.battles : 0, 3),
            hitBattles: a.hitBattles,
            hitAvgT: a.hitT.length ? round(avg(a.hitT), 1) : null,
          },
        ]),
      ),
    ]),
  );
}

console.log(JSON.stringify(out, null, 2));
