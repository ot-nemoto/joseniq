// 武将どうしの一騎打ち総当たり（調整の物差しの1つ）
// 全組み合わせを攻守両方・距離2通りで戦わせ、勝敗だけでなく
// 「勝ったときどれだけ残して勝つか」「決着の速さ」「与える傷の量と速さ」まで数値で残す。
// 乱数はないので、同じパラメータなら毎回まったく同じ結果になる（再現可能）。
// 使い方: npm run balance:duel [-- --out 結果.json]
// 注意：支援スキル（家康の軍配・秀吉の刀狩）は1対1では構造的に不利になる。
// ここでの最下位は「軍の中で弱い」を意味しない。攻め・守りの値は balance:lite で見ること
import { writeFile } from 'node:fs/promises';

const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;
const DISTS = [6, 2];

const { createServer } = await import('vite');
const server = await createServer({
  server: { middlewareMode: true, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
  logLevel: 'error',
});
let S;
try {
  S = await server.ssrLoadModule('/src/sim/index.ts');
} finally {
  await server.close();
}

const gens = S.GENERAL_ORDER;
const name = (k) => S.GDEF[k].busho;
const matches = [];
for (const dist of DISTS)
  for (const a of gens)
    for (const b of gens) {
      if (a === b) continue;
      const d = S.runDuel(S.createDuel({ left: a, right: { k: 'gen', kind: b }, dist }));
      const L = S.duelTotals(d, 'left');
      const R = S.duelTotals(d, 'right');
      matches.push({
        dist,
        left: a,
        right: b,
        winner: d.end.winner === 'left' ? a : d.end.winner === 'right' ? b : null,
        reason: d.end.reason,
        endT: +d.end.t.toFixed(1),
        leftHp: Math.max(0, Math.round(d.left.hp)),
        rightHp: Math.max(0, Math.round(d.right.hp)),
        leftHpFrac: +(Math.max(0, d.left.hp) / S.GDEF[a].hp).toFixed(3),
        rightHpFrac: +(Math.max(0, d.right.hp) / S.GDEF[b].hp).toFixed(3),
        leftDmg: Math.round(L.total),
        rightDmg: Math.round(R.total),
        leftDps: L.perSec === null ? null : +L.perSec.toFixed(1),
        rightDps: R.perSec === null ? null : +R.perSec.toFixed(1),
        leftFirst: L.first,
        rightFirst: R.first,
      });
    }

if (OUT) await writeFile(OUT, JSON.stringify({ dists: DISTS, matches }, null, 1));

const avg = (xs) => (xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : null);
const f1 = (v) => (v === null ? '-' : +v.toFixed(1));

// 勝敗の表（行＝左が攻め、列＝右が守り。距離2通りの合計。○＝行の勝ち、×＝行の負け、△＝相打ち・時間切れ）
console.log('\n勝敗の表（行の武将から見た結果、距離2通りぶん）');
const matrix = {};
for (const a of gens) {
  matrix[name(a)] = {};
  for (const b of gens) {
    if (a === b) {
      matrix[name(a)][name(b)] = '—';
      continue;
    }
    const ms = matches.filter((m) => m.left === a && m.right === b);
    matrix[name(a)][name(b)] = ms.map((m) => (m.winner === a ? '○' : m.winner === b ? '×' : '△')).join('');
  }
}
console.table(matrix);

// 武将ごとのまとめ（攻守両方を合わせた全試合）
console.log('\n武将ごとのまとめ');
const table = {};
for (const g of gens) {
  const mine = matches.filter((m) => m.left === g || m.right === g);
  const wins = mine.filter((m) => m.winner === g);
  const asAtk = mine.filter((m) => m.left === g);
  const asDef = mine.filter((m) => m.right === g);
  const hpWhenWin = wins.map((m) => (m.left === g ? m.leftHp : m.rightHp) / S.GDEF[g].hp);
  const dmg = mine.map((m) => (m.left === g ? m.leftDmg : m.rightDmg));
  const dps = mine.map((m) => (m.left === g ? m.leftDps : m.rightDps)).filter((v) => v !== null);
  const first = mine.map((m) => (m.left === g ? m.leftFirst : m.rightFirst)).filter((v) => v !== null);
  table[name(g)] = {
    勝: wins.length,
    負: mine.filter((m) => m.winner !== null && m.winner !== g).length,
    分: mine.filter((m) => m.winner === null).length,
    '攻め時の勝': `${asAtk.filter((m) => m.winner === g).length}/${asAtk.length}`,
    '守り時の勝': `${asDef.filter((m) => m.winner === g).length}/${asDef.length}`,
    '勝った時の残り体力': avg(hpWhenWin) === null ? '-' : `${f1(avg(hpWhenWin) * 100)}%`,
    '平均決着秒': f1(avg(mine.map((m) => m.endT))),
    '平均の与えた傷': Math.round(avg(dmg)),
    '秒あたりの傷': f1(avg(dps)),
    '先に当てた秒': f1(avg(first)),
  };
}
console.table(table);
console.log(`全${matches.length}試合（距離${DISTS.join('・')}、各組み合わせ攻守両方）`);
