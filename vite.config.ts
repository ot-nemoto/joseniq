import { defineConfig } from 'vitest/config';

export default defineConfig(({ command }) => ({
  // GitHub Pages のプロジェクトページ（/joseniq/ 配下）で配信するため。開発サーバーは今までどおり / で開く
  base: command === 'build' ? '/joseniq/' : '/',
  build: {
    // deploy-github-pages.yml が公開する ./out に合わせる
    outDir: 'out',
  },
  server: {
    host: true,
    port: 5173,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
}));
