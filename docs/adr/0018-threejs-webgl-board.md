# ADR 0018: Three.js WebGL盤面表示への移行

## 状態

Draft Pull Requestで実装中／iPhone実機・初見プレイ再検証待ち

## 日付

2026-09-03（JST）

## 背景

Canvas 2Dの盤面Rendererは、地形、水、雨、水流、予報、危険表示、結果表示、座標変換、ヒットテストを1つの描画経路で扱っていた。地形の高さを立体として見せ、雨と水流を同じ盤面上で追い、狭い画面でも施工可能セルを押せる表示へ拡張するには、固定オブジェクトを再利用できる3D表示層が必要になった。

正式公開前の移行なので、古いCanvas版との切り替えや互換モードは持たない。移行対象は表示層だけとし、同じ操作記録から得られるゲーム結果を変えない。

## 決定

### Domain・Applicationとの境界

- `src/domain/**`と`src/application/**`は変更しない。Three.js、DOM、Canvas、時計、乱数への依存を持たせない。
- `BoardSnapshot`、`StageTurnPreview`、`StageTraceEvent`、`FlowStepResult`、`WaterTransfer`、`StageProjection`を表示の正本とする。
- 表示側は水の流向、排水量、流出量、浸水量、危険度の根拠、クリア・失敗、スコアを再計算しない。
- 結果文章、操作シート、セル番号による代替操作、保存、再生、ランキングは既存のDOM・Application経路を正本として残す。

### Three.jsの構成

- `ThreeBoardView`が1つのCanvasに1つの`WebGLRenderer`、`Scene`、`OrthographicCamera`を所有する。
- Three.js本体はゲーム開始または保存再開時の`import('./presentation/three-board-view')`で読み込み、タイトル画面では読み込まない。ViteがThree.jsを遅延チャンクへ同梱する。
- カメラは固定見下ろし角度のOrthographicCameraとし、`rotation` 0〜3で90度ずつ水平回転する。自由回転、OrbitControls、ピンチ拡大、傾き操作は導入しない。
- `column`をX、`row`をZ、`terrain`をYへ割り当て、row-majorのセル番号を維持する。高さ0も地面の立体として表示し、高さ1〜6は側面と段差線で区別する。
- 盤面、最大地形高さ、雨雲、水流終点の余白を含む純粋なカメラfit計算を使い、縦向きと横向きで全体を収める。

### 入力と施工可能セル

- 通常のセル判定はCanvasの`getBoundingClientRect()`からCSSピクセルのPointer座標を作り、セル専用のピッキングMeshだけへRaycasterを飛ばす。
- `legalAnchorIndices`は投影したセル中心を先に調べ、中心から22 CSS px以内（直径44 CSS px）で最も近い施工可能セルを返す。該当しない場合だけRaycasterを使う。
- カメラ補間中、再生中、一時停止中、context lost中は`pickCell`を拒否する。
- PointerControllerの1本制限、pointerdown／moveで仮置き、pointerupで未確定、pointercancelで意図した仮置きを保持する契約を変えない。

### 視覚情報と再生

- 地形、水面、水量、池、保護対象、安全出口、危険出口、施工前後、施工可能セル、選択セル、予報、雨雲・雨粒・波紋、危険度は入力された証拠から表示する。
- `StageTurnPreview.boardAfterTurn.water`をプレビュー水量、`StageProjection.forecastCells`を予報、`StageTraceEvent.rainCells`を発生中の雨として使う。`boardAfterNextFlow`は最初の固定ステップを検査・表示する既存契約として残す。
- 水流はpreviewの最終固定ステップ、またはtraceの`flowResult.transfers`をそのまま使う。各`WaterTransfer`の`from`、`to`、`direction`、`kind`、`amount`を保持し、`to: null`は記録されたdirectionの盤面外終点へ伸ばす。危険度の予告はpreviewの全固定ステップの証拠を使う。
- TracePlaybackがphase、event、progressの正本である。Three.js側にゲーム状態を進める常時ループ、独自の水流計算、独自の雨生成は置かない。許可する`requestAnimationFrame`はカメラ補間とTracePlaybackからの表示更新だけとする。
- `prefers-reduced-motion`ではカメラ補間、粒子移動、点滅、脈動を抑えるが、雨量、水量、移動先、結果の情報は省略しない。

### 初期化失敗とWebGL復旧

- dynamic importまたはRenderer初期化の失敗時は盤面内に「3D表示を開始できませんでした」「3D表示を再生成」「ステージ選択へ戻る」を表示し、白画面にしない。
- `webglcontextlost`では既定イベントを抑止し、入力とタイマーをロックする。進行中のTracePlaybackも同じフレームで停止し、ゲーム状態、仮置き、保存を破棄しない。
- `webglcontextrestored`では現在の`BoardSnapshot`と表示フレームからScene graphを再構築し、DomainやStageControllerは作り直さない。TracePlaybackとタイマーは保存した位置から続ける。
- `destroy()`はカメラ補間、イベントリスナー、Sprite、Geometry、Material、CanvasTexture、RenderTarget（使用時）、WebGLRendererを解放し、複数回呼んでも安全にする。

### 外部アセットと性能上限

- 外部の3Dモデル、画像、テクスチャ、CDN、importmap、外部スクリプトは使わない。文字・短い状態語だけは、専用ラベルモジュールの小さなオフスクリーンCanvasからCanvasTextureを作る。
- 64セルのMesh、共有BoxGeometry、輪郭、段差線、雨粒、水滴、流路、波紋、ラベルSpriteは初期化時に上限付きでプールし、renderごとにGeometry、Material、Textureを生成しない。
- devicePixelRatioは最大2、動的シャドウとポストプロセスは使わず、少数の光源を使う。表示が暗くなりすぎない背景・環境光を確保する。
- renderer.infoの通常盤面・水流再生中のdraw calls、geometry数、texture数をPR本文へ記録し、回転、再挑戦、画面往復、プレビュー取消、保存再開でgeometry数とtexture数が増え続けないことを確認する。

## 自動検査

- `three-board-math.test.ts`で64セルのrow-major変換、4方向、Direction、出口終点、水量上限、最大高さを含むカメラfitを検査する。
- `three-board-picking.test.ts`で64セル、4方向、高低差、44 CSS px、重なり時の最近傍、盤面外を純粋な座標処理として検査する。
- `three-board-frame.test.ts`でsnapshot・preview・traceの入力を変更せず、プレビュー水量と記録済みWaterTransferをそのまま使うことを検査する。
- `three-resource-lifecycle.test.ts`でリソース登録の重複排除とidempotentな破棄を検査する。Node単体テストではWebGLRendererを生成しない。
- Domain境界テストでDomain・ApplicationからThree.jsをimportしないこと、Domainがブラウザ・時計・乱数・Canvasへ依存しないことを検査する。
- app smokeで遅延チャンク、同梱、旧Canvas盤面Rendererの削除、context lost/restored、入力・保存・結果・操作シートの既存マーカーを検査する。

## 未確認事項

自動検査だけでは、iPhone 17 Proの実機における視認性、WebGL context lossの実機復旧、縦横各幅、初見プレイヤーの理解を合格とは扱わない。M4は未完了のまま残し、実機確認と初見プレイテスト3名以上、独立レビューを後続ゲートとする。
