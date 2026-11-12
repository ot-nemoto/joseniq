// 調整の前後を比べる集計：1回の計測（フォルダ）につき、一騎打ち・攻め・守りの指標を武将ごとに並べる
// 使い方: node scripts/balance-report.mjs <計測フォルダA> [計測フォルダB]
//   フォルダには duel.json（balance:duel の --out）と lite.json（balance:lite の --out）を置く。どちらかだけでもよい
//   B を渡すと、B の表と「A→B の差」も出す。パラメータを変えたら、同じスクリプトで計測し直して並べるのが使い方
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const [dirA, dirB] = process.argv.slice(2);
if (!dirA) {
  console.error('使い方: node scripts/balance-report.mjs <計測フォルダA> [計測フォルダB]');
  process.exit(1);
}

const NAMES = {
  brave: '上杉謙信',
  archer: '大島光義',
  sage: '真田昌幸',
  rider: '武田信玄',
  gunner: '織田信長',
  builder: '豊臣秀吉',
  guard: '徳川家康',
};
const ORDER = Object.keys(NAMES);
const avg = (xs) => (xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : null);

async function load(dir) {
  const out = {};
  try {
    out.duel = JSON.parse(await readFile(join(dir, 'duel.json'), 'utf8'));
  } catch {
    /* なくてもよい */
  }
  try {
    out.lite = JSON.parse(await readFile(join(dir, 'lite.json'), 'utf8'));
  } catch {
    /* なくてもよい */
  }
  return out;
}

// 武将ごとの指標を出す。取れない指標は null（表示は「-」）
function perGeneral(data) {
  const rows = {};
  for (const g of ORDER) {
    const r = {};
    if (data.duel) {
      const mine = data.duel.matches.filter((m) => m.left === g || m.right === g);
      const wins = mine.filter((m) => m.winner === g);
      r['一騎打ち 勝率'] = mine.length ? wins.length / mine.length : null;
      r['一騎打ち 勝った時の残り体力'] = wins.length
        ? avg(wins.map((m) => (m.left === g ? m.leftHpFrac : m.rightHpFrac)))
        : null;
      r['一騎打ち 平均決着秒'] = avg(mine.map((m) => m.endT));
      const dps = mine.map((m) => (m.left === g ? m.leftDps : m.rightDps)).filter((v) => v !== null);
      r['一騎打ち 秒あたりの傷'] = avg(dps);
    }
    if (data.lite) {
      const atk = data.lite.filter((x) => x.side === 'atk' && x.combo && x.combo.includes(g));
      r['攻め 勝率'] = atk.length ? atk.filter((x) => x.win).length / atk.length : null;
      r['攻め 本丸残り平均'] = avg(atk.map((x) => x.hall));
      const atkWins = atk.filter((x) => x.win);
      r['攻め 勝ちの平均秒'] = atkWins.length ? avg(atkWins.map((x) => x.endT)) : null;
      const def = data.lite.filter((x) => x.side === 'def' && x.combo && x.combo.includes(g));
      r['守り 攻め手の勝率'] = def.length ? def.filter((x) => x.win).length / def.length : null;
      r['守り 本丸残り平均'] = avg(def.map((x) => x.hall));
      r['守り 攻め手の失った兵力'] = avg(def.map((x) => x.cost));
    }
    rows[g] = r;
  }
  return rows;
}

const isPct = (k) => k.includes('勝率') || k.includes('残り');
const fmt = (k, v) => {
  if (v === null || v === undefined) return '-';
  if (k.includes('勝率') || k.includes('残り体力') || k.includes('本丸残り')) return `${(v * 100).toFixed(1)}%`;
  if (k.includes('兵力')) return `${Math.round(v)}`;
  return `${v.toFixed(1)}`;
};
const fmtDelta = (k, a, b) => {
  if (a === null || a === undefined || b === null || b === undefined) return '-';
  const d = b - a;
  const s = d > 0 ? '+' : '';
  if (isPct(k)) return `${s}${(d * 100).toFixed(1)}pt`;
  if (k.includes('兵力')) return `${s}${Math.round(d)}`;
  return `${s}${d.toFixed(1)}`;
};

const A = perGeneral(await load(dirA));
const keys = [...new Set(ORDER.flatMap((g) => Object.keys(A[g])))];
const show = (rows, delta) => {
  const t = {};
  for (const g of ORDER) {
    t[NAMES[g]] = {};
    for (const k of keys) t[NAMES[g]][k] = delta ? fmtDelta(k, A[g][k], rows[g][k]) : fmt(k, rows[g][k]);
  }
  console.table(t);
};
console.log(`\n===== ${dirA} =====`);
show(A, false);
if (dirB) {
  const B = perGeneral(await load(dirB));
  console.log(`\n===== ${dirB} =====`);
  show(B, false);
  console.log(`\n===== 差（${dirB} − ${dirA}） =====`);
  show(B, true);
  console.log(
    '読み方：攻め勝率・守りの本丸残り・一騎打ち勝率は上がるほどその側が強い。守りの「攻め手の勝率」は下がるほど守りが固い。攻めの「本丸残り平均」は下がるほど攻めが強い',
  );
}
