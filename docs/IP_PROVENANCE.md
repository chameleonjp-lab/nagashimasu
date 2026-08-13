# 実装と依存関係の来歴

更新日: 2026-08-13

## M3表示・入力実装

`src/presentation`、`src/application`、`src/main.ts`、`src/styles.css`は、本プロジェクトの計画書とADR 0003をもとに新規作成した。Canvas描画、アイソメトリック座標、Pointer Eventsの入力管理、予報・危険度の表示に外部コードやゲーム作品のアセットは使用していない。画面表示はM2の`StageSession.preview`と`StageSession.execute`、snapshotの証拠を使い、表示側で水流計算を再実装しない。

確定後のtrace再生、再生中の入力ロック、クリア／失敗結果パネルも本プロジェクトの独自実装である。再生の時間処理はPresentation層だけが扱い、`StageSession`の状態、判定、評価値を変更しない。

## M1・M2実装

`src/domain`のM1水流モデルとM2ステージ進行は、本リポジトリの`docs/PROJECT_PLAN.md`、`docs/adr/0001-deterministic-water-model.md`、`docs/adr/0002-stage-progression.md`を仕様として新規に実装した。M2のステージ1～3、候補列、雨列、評価値も本プロジェクト用に新規作成した。

計画書の調査欄に記載した他作品、無ライセンス実装、ROM、逆コンパイル成果物から、コード、データ、アセット、画面構成をコピーまたは移植していない。作品名は比較調査を記録する計画書内だけで扱い、配布用コードやアセットには使用しない。

## 実行時依存

M1・M2のゲームルール層に実行時の外部依存はない。

## 開発時依存

| パッケージ | 用途 | 版 | ライセンス |
|---|---|---:|---|
| TypeScript | 型検査 | 7.0.2 | Apache-2.0 |
| Vite | 本番向けビルド | 8.2.1 | MIT |
| Vitest | 自動テスト | 4.1.10 | MIT |
| `@types/node` | Node.js型定義 | 22.20.1 | MIT |

実際に解決された間接依存と完全な版は`package-lock.json`を正本とする。依存を追加する場合は、用途、版、ライセンスをこの文書へ追記する。
