// パラメータ調整の目安：「基本（平城）」の城に、編成例5種を出撃口8か所から当てた結果の表を出す。
// テストではないので失敗はしない。数値を変えたら、勝ちやすさがどう変わったかを見るのに使う。
// 使い方：npm run balance
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const S = await server.ssrLoadModule('/src/sim/index.ts');
  const layout = S.preset('flat');
  const eps = S.entryPoints(layout);
  let wins = 0;
  const rows = S.TEMPLATES.map((tpl) => {
    const cost = tpl.steps.reduce((n, st) => n + S.ADEF[st.kind].cost * st.n, 0);
    const cells = eps.map((ep, i) => {
      const entries = tpl.pair ? [ep.e, eps[S.OPPOSITE[i]].e] : [ep.e];
      const s = S.runPlan(layout, S.buildPlan(tpl, entries));
      if (s.result === 'win') {
        wins++;
        return `勝 ${s.endT.toFixed(0)}秒`;
      }
      const hall = S.hallOf(s);
      return `本丸${Math.ceil((100 * hall.hp) / hall.maxHp)}%`; // わずかでも残れば負けなので、切り上げる
    });
    return { 編成例: tpl.name, 兵力: cost, ...Object.fromEntries(eps.map((ep, i) => [ep.name, cells[i]])) };
  });
  console.log('「基本（平城）」の城に対する編成例の結果（勝ち：落城までの時間／負け：本丸の残り体力）');
  console.table(rows);
  console.log(`勝ち ${wins} / ${rows.length * eps.length}`);
} finally {
  await server.close();
}
