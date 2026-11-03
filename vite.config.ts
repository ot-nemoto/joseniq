import { defineConfig } from 'vitest/config';

export default defineConfig(({ command }) => ({
  // GitHub Pages のプロジェクトページ（/joseniq/ 配下）で配信するため。開発サーバーは今までどおり / で開く
  base: command === 'build' ? '/joseniq/' : '/',
  build: {
    // deploy-github-pages.yml が公開する ./out に合わせる
    outDir: 'out',
    // 遊ぶ画面（index.html）と、開発する人のための武将モーションの確かめのページ（motion.html）
    rollupOptions: {
      input: {
        main: 'index.html',
        motion: 'motion.html',
      },
    },
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
