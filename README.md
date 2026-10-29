# JOSENIQ

城の防衛と攻城を試すブラウザのアプリ。防衛の側で施設と武将を盤面に置き、攻城の側で兵と武将を出して戦わせる。

公開先: https://ot-nemoto.github.io/joseniq/

## 開発

```sh
npm ci
npm run dev        # http://localhost:5173/
npm run typecheck  # 型チェック
npm run check      # Biome（lint・整形）
npm test           # テスト
npm run build      # out/ に出力（公開先に合わせて base は /joseniq/）
```

## ブランチとリリース

- 作業は develop から切ったブランチで行い、develop へ PR を出す。develop に入ると GitHub Pages に公開される
- 毎朝6時（日本時間）に develop から master への PR が自動で出る。含まれる Issue に enhancement があれば `bump:minor`、なければ `bump:patch` のラベルが付き、package.json の版が上がる
- master に入ると、その版でタグとリリースが作られる
