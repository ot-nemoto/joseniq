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
const pack = (lay) => ({
  buildings: lay.buildings.map((b) => ({
    t: b.type,
    x: b.x,
    y: b.y,
    w: BDEF[b.type]?.w ?? 1,
    h: BDEF[b.type]?.h ?? 1,
  })),
  water: lay.water,
  moat: lay.moat ?? [],
  bridge: lay.bridge ?? [],
  heights: lay.heights,
  entries: entryPoints(lay).map((e) => e.e),
});
writeFileSync(
  process.argv[2],
  JSON.stringify({
    W,
    H,
    compact: pack(compactFlat()),
    hill: pack(compactHill()),
    yama: pack(compactYama()),
    flat: pack(preset('flat')),
  }),
);
console.log('dumped');
