# 開発

```sh
npm ci
npm run dev        # http://localhost:5173/
npm run typecheck  # 型チェック
npm run check      # Biome（lint・整形。Markdown と YAML も見る）
npm test           # テスト
npm run build      # out/ に出力（公開先に合わせて base は /joseniq/）
```

作りは [architecture.md](architecture.md)、守る決まりは [design.md](design.md) に書いてある。

## ブランチとリリース

- 作業は develop から切ったブランチで行い、develop へ PR を出す。develop に入ると GitHub Pages に公開される
- 毎朝6時（日本時間）に develop から master への PR が自動で出る。含まれる Issue に enhancement があれば `bump:minor`、なければ `bump:patch` のラベルが付き、package.json の版が上がる
- master に入ると、その版でタグとリリースが作られる
- 版を上げるワークフロー（bump-version.yml）は README.md もコミットに含めるので、README.md は消さない（ないと版上げが失敗する）

## PR を出す前に

- `npm run typecheck`・`npm run check`・`npm test` を通す。`npm run check` は Markdown と YAML も見るので、文書やワークフローだけを変えたときも走らせる
- 動きや決まりを変える PR では、関係する docs（design.md・architecture.md・この文書）と README.md も同じ PR で直す

## 数値の調整に使うスクリプト

どちらもテストではないので失敗はしない。戦いは `src/sim/` の `runPlan` で、画面を使わずに最後まで回す。

| コマンド                 | 何を出すか                                                                                                           | 使いどころ                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `npm run balance`        | 「基本（平城）」の城に、編成例5種を出撃口8か所から当てた結果の表（勝ちなら落城までの時間、負けなら本丸の残りの体力） | 数値や仕組みを変えたあと、勝ちやすさがどう変わったかを見る。武将の新しい特徴が、その武将のいない戦いを変えていないかを比べる |
| `npm run balance:combos` | 武将3人の組み合わせ（9人から3人の84通り）を、編成例と出撃口に当てた勝率                                              | 武将どうしの釣り合いの実績を集める。`npm run balance:combos -- --out ファイル名` で、1戦ずつの結果を JSON に書き出す         |

`runPlan` は、画面と違い、予定を出し切って攻め手がいなくなった時点で全滅にする（[architecture.md](architecture.md) の「戦いの計算の流れ」）。数値は今は仮で、結果からすぐに数値を直すことはしない（[design.md](design.md) の「数値は仮」）。

## 画面の確かめ方

### 開発サーバーが古いコードを返すとき

WSL の上では、`npm run dev` の開発サーバーが、ファイルを変えても古いコードを返し続けることがある。画面で確かめる前に、開発サーバーを立ち上げ直すか、`curl http://localhost:5173/src/ui/app.ts` などで新しいコードが返るかを見る（Vite は書き直して返すので、引用符などが変わっていることがある）。

### ヘッドレスブラウザ（Playwright）で確かめるとき

- プロジェクトには Playwright を入れていない。使うときは、別の場所に `playwright-core` を入れて、そこからスクリプトを動かす（ブラウザの版と合わせる）
- 5173 番で別の開発サーバーが動いていることがあるので、別の番号（`npx vite --port 5180 --strictPort` など）で立ち上げる
- 施設の上を道具で押して 400ms 動かさないと、長押しでその施設をつかむ。ヘッドレスでは描画が重く、1歩に数百 ms かかることがあるので、なぞる操作は押した直後に 8px より大きく動かす
- 盤面でつかんでいるかは、`#cv` の `style.cursor` が `grabbing` かで分かる
