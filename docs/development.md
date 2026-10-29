# 開発

```sh
npm ci
npm run dev        # http://localhost:5173/
npm run typecheck  # 型チェック
npm run check      # Biome（lint・整形）
npm test           # テスト
npm run build      # out/ に出力（公開先に合わせて base は /joseniq/）
```

- 作業は develop から切ったブランチで行い、develop へ PR を出す。develop に入ると GitHub Pages に公開される
- 毎朝6時（日本時間）に develop から master への PR が自動で出る。含まれる Issue に enhancement があれば `bump:minor`、なければ `bump:patch` のラベルが付き、package.json の版が上がる
- master に入ると、その版でタグとリリースが作られる
