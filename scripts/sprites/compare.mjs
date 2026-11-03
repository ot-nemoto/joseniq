// モーション比較のページを作る：ゲームに入れた絵のデータ（src/ui/*Frames.ts）と武将の能力値を、compare.tpl.html に埋め込む。
// 使い方：node scripts/sprites/compare.mjs 出力ファイル（.html）。できたページは、ブラウザで開くか、Artifact として公開する
// （compare.tpl.html は Artifact の形で書いてあるので、<html> や <body> の札を持たない）
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const out = process.argv[2];
if (!out) throw new Error('使い方：node scripts/sprites/compare.mjs 出力ファイル');
// データのファイルは biome で整えた TypeScript の式なので、式として読む
const grab = (f) =>
  new Function(
    `return ${fs
      .readFileSync(`${ROOT}${f}`, 'utf8')
      .replace(/^[\s\S]*?export const \w+ = /, '')
      .replace(/ as const;\s*$/, '')}`,
  )();
const data = { brave: grab('src/ui/kenshinFrames.ts'), gunner: grab('src/ui/nobunagaFrames.ts') };
// 能力値は src/sim/defs.ts の GENERALS と同じ値（変えたらここも直す）
const stats = {
  brave: { hp: 2600, dmg: 80, cd: 0.8, speed: 2.0, range: 0.9 },
  gunner: { hp: 1000, dmg: 160, cd: 3.0, speed: 1.5, range: 9.0 },
};
const tpl = fs.readFileSync(`${DIR}compare.tpl.html`, 'utf8');
fs.writeFileSync(out, tpl.replace('/*DATA*/', JSON.stringify(data)).replace('/*STATS*/', JSON.stringify(stats)));
console.log('書き出した', out, fs.statSync(out).size, 'バイト');
