// 一時用：現行平城とコンパクト平城を並べたHTML地図を書き出す
import { writeFileSync } from 'node:fs';

const { createServer } = await import('vite');
const server = await createServer({
  server: { middlewareMode: true, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
  logLevel: 'error',
});
const S = await server.ssrLoadModule('/src/sim/index.ts');
const { compactFlatLayout, compactHillLayout, compactYamaLayout } = await server.ssrLoadModule('/src/sim/simField.ts');
const compactFlat = () => compactFlatLayout();
const compactHill = () => compactHillLayout();
const compactYama = () => compactYamaLayout();
await server.close();
const { W, H, preset, entryPoints, BDEF } = S;

const COLORS = {
  hall: '#c0392b',
  gate: '#b9770e',
  wall: '#7f8c8d',
  tbow: '#2e6da4',
  tgun: '#6c3483',
  cata: '#ca6f1e',
  drum: '#c2185b',
  bell: '#8e44ad',
  drawbridge: '#a1887f',
};
const NAMES = {
  hall: '本丸',
  gate: '門',
  wall: '城壁',
  tbow: '弓櫓',
  tgun: '鉄砲櫓',
  cata: '大筒',
  drum: '鼓楼',
  bell: '鐘楼',
  drawbridge: '跳橋',
};
const CELL = 13;

function svgMap(lay, title) {
  const eps = entryPoints(lay);
  let cells = '';
  for (let i = 0; i < W * H; i++) {
    const x = i % W,
      y = (i / W) | 0;
    if (lay.water[i])
      cells += `<rect x="${x * CELL}" y="${y * CELL}" width="${CELL}" height="${CELL}" fill="#aed6f1"/>`;
    else if (lay.moat?.[i])
      cells += `<rect x="${x * CELL}" y="${y * CELL}" width="${CELL}" height="${CELL}" fill="#d5c6a1"/>`;
    if (lay.bridge?.[i])
      cells += `<rect x="${x * CELL}" y="${y * CELL}" width="${CELL}" height="${CELL}" fill="#a1887f"/>`;
    const hh = lay.heights?.[i] ?? 0;
    if (hh > 0)
      cells += `<rect x="${x * CELL}" y="${y * CELL}" width="${CELL}" height="${CELL}" fill="rgba(120,90,40,${0.13 * hh})"/><text x="${x * CELL + CELL / 2}" y="${y * CELL + CELL - 2}" text-anchor="middle" font-size="8" fill="#7a5c1e">${hh}</text>`;
  }
  for (const b of lay.buildings) {
    const w = (BDEF[b.type]?.w ?? 1) * CELL,
      h = (BDEF[b.type]?.h ?? 1) * CELL;
    cells += `<rect x="${b.x * CELL}" y="${b.y * CELL}" width="${w}" height="${h}" fill="${COLORS[b.type] ?? '#333'}"><title>${NAMES[b.type] ?? b.type} (${b.x},${b.y})</title></rect>`;
  }
  // 出撃口（東=1・南東=7、計測で使う2つ）
  let marks = '';
  for (const ei of [1, 7]) {
    const [ex, ey] = eps[ei].e;
    marks += `<circle cx="${ex * CELL + CELL / 2}" cy="${ey * CELL + CELL / 2}" r="7" fill="none" stroke="#e74c3c" stroke-width="2.5"/><text x="${ex * CELL + CELL / 2}" y="${ey * CELL - 4}" text-anchor="middle" font-size="11" fill="#e74c3c" font-weight="bold">${ei === 1 ? '東' : '南東'}</text>`;
  }
  const cnt = {};
  for (const b of lay.buildings) cnt[b.type] = (cnt[b.type] ?? 0) + 1;
  const summary = Object.entries(cnt)
    .map(([t, n]) => `${NAMES[t] ?? t} ${n}`)
    .join('・');
  return `<figure><svg width="${W * CELL}" height="${H * CELL}" style="background:#f7f5ee;border:1px solid #ccc">${cells}${marks}</svg><figcaption><strong>${title}</strong><br>${summary}</figcaption></figure>`;
}

const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>計測フィールド：コンパクト城（平城・平山城・山城）</title>
<style>body{font-family:sans-serif;margin:24px;color:#222} .row{display:flex;gap:32px;flex-wrap:wrap} figure{margin:0} figcaption{margin-top:8px;font-size:14px;line-height:1.6} h1{font-size:20px} p{max-width:900px;line-height:1.7}</style></head>
<body>
<h1>計測フィールド：コンパクト城（平城・平山城・山城）vs 現行の平城（基本）</h1>
<p>赤い丸は計測で使う出撃口（東・南東）。コンパクト版は本丸中央・二重郭（外郭18×18・内郭8×8）で、撃つ施設は21（弓櫓12・鉄砲櫓5・大筒4）＋鼓楼4。平山城版・山城版は建物が平城版と全く同じで、地面だけが段々（平山城は外郭1段・内郭2段。山城は城の外まで段々が続き、裾野1段・中腹2段・外郭3段・内郭4段。マスの数字＝高さ）。高い所の櫓は射程が伸びる。</p>
<div class="row">
${svgMap(compactFlat(), '平城コンパクト')}
${svgMap(compactHill(), '平山城コンパクト')}
${svgMap(compactYama(), '山城コンパクト')}
${svgMap(preset('flat'), '平城（基本）＝現行の物差し')}
</div>
<p>凡例：<span style="color:#c0392b">■</span>本丸 <span style="color:#b9770e">■</span>門 <span style="color:#7f8c8d">■</span>城壁 <span style="color:#2e6da4">■</span>弓櫓 <span style="color:#6c3483">■</span>鉄砲櫓 <span style="color:#ca6f1e">■</span>大筒 <span style="color:#c2185b">■</span>鼓楼 ／ 水色＝川、水色の橋＝橋、薄茶＝堀。各マスにホバーで名前と座標が出ます。</p>
</body></html>`;
writeFileSync(process.argv[2], html);
console.log('wrote', process.argv[2]);
