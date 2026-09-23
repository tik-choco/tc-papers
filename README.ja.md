# TC Papers

[English](README.md) | 日本語 | [中文](README.zh.md)

論文 PDF を AI で読み解く Web アプリです。PDF をドロップすると査読者の観点でスコアを付けたり、論文のストーリーをグラフにして質問しながら理解を深めたりできます。

公開版: https://tik-choco.github.io/tc-papers/

## 機能

- **レビュー**: AI が 6 観点（技術的妥当性・実証の強さ・新規性・重要性・明瞭さ・再現性）を本文の引用付きで評価します。最終スコア（0–100）はローカルで計算し、引用が本文で確認できない評価は中立側へ補正します。
- **理解モード**: 論文をストーリーグラフ（問題 → 手法 → 結果 → …）にします。質問するたびに答えが理解ツリーに積み上がり、PDF と並べて読めます。
- **OCR**: 画像だけのページは画像入力対応モデルで読み取ります。
- **tc-pdf-viewer 連携**: tc-pdf-viewer に入っている PDF を取り込めます。
- **ローカル保存**: PDF と結果はブラウザーに保存され、tc-storage に自動でバックアップされます。

## AI

tc アプリ共通の mistai 設定を使います（OpenAI 互換 API または AI Network（P2P））。初回起動時にセットアップガイドが開きます。PDF の本文とページ画像は選択した AI に送信されます。

## 開発

```sh
npm install
npm run dev
npm test
npm run test:e2e
npm run build   # サブパス配置は VITE_BASE_PATH=/tc-papers/
```

## ライセンス

[MIT](LICENSE)
