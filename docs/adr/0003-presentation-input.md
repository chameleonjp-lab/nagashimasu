# ADR 0003: 盤面表示とタッチ入力の境界

## 状態

Accepted／M3実装中

## 背景

M2までで、8×8盤面の水流とステージ進行は画面なしで再現できるようになった。M3ではCanvas 2Dとタッチ入力を追加するが、表示側が水流を近似したり、指を離した瞬間に手番を確定したりすると、画面上の見た目と正しいゲーム状態がずれる。

そのため、表示・入力の責任を次のように分ける。

- Domainはゲーム状態と結果を決める。DOM、Canvas、Pointer Event、壁時計を参照しない。
- Applicationの`StageController`は候補選択、仮置き、preview、確定操作を調停する。
- Presentationは盤面を描画し、Pointer Eventをセル選択へ変換する。水流計算は行わない。

## 決定

### 1. アイソメトリック座標

盤面は固定角度の疑似3Dとして描画する。セル番号はM1・M2と同じrow-major（`row * 8 + column`）を使う。

- 上面は幅・高さを持つひし形として投影する。
- 地形高さは上面を画面上方へ移動させ、側面を地面まで描く。
- 画面サイズ、safe-area、端末の向きが変わっても、8×8全体が表示領域へ収まるレイアウトを再計算する。
- ヒットテストは上面の多角形を対象にする。複数候補が重なる場合は、画面上で高い地形を先に選ぶ。
- Canvas上の座標は表示だけの値であり、Domainのセル番号や地形値を変更しない。

### 2. 仮置きと確定

盤面タップまたはドラッグは、選択中候補のアンカーを仮置きするだけとする。

- Pointer-downでセルを選ぶ。
- Pointer-moveでは同じPointerの間だけ仮置きを更新する。
- Pointer-upは仮置きを保持し、施工を確定しない。
- 回転、取消、施工確定は独立したボタン操作とする。
- Pointer-cancelでは仮置きを解除する。
- 施工確定は`StageController.confirm`から`StageSession.execute`を一度だけ呼び出す。
- 無効配置では候補、手数、Undo、ログを消費せず、理由を表示する。

### 3. Pointer Events

入力はPointer Eventsへ統一し、盤面ごとに同時に1つのPointerだけを受け付ける。

- 最初に受理した`pointerId`をactive pointerとする。
- 別の`pointerId`からのdown／move／upは無視する。
- 受理したPointerにはpointer captureを設定する。
- `pointercancel`、画面遷移、入力解除時にはcaptureを解放する。
- 盤面は`touch-action: none`とし、ブラウザのスクロールや長押しメニューを施工入力と混同しない。
- 主要ボタンは44 CSS px以上とする。

### 4. Previewの正本

仮置きの表示は、M2の`StageSession.preview`が返す配置結果、当手の雨、次の固定水流、同じ状態cloneの盤面を使う。Presentationで別の水流式、近似した排水、見た目だけの危険判定を実装しない。

previewは元の`StageSession`を変更せず、次の値を消費しない。

- 盤面、候補、雨cursor、手数、metrics、revision、action ID、Undo、操作ログ

確定後の`StageTraceEvent`とpreviewの最初のflow resultが一致しない場合は、M3完了と扱わない。

### 5. 時間と画面状態

M3の画面はタイマーをゲーム状態へ直接渡さない。タイマーやPage Visibilityは後続のApplication／Platform層で明示的な`timeout`操作へ変換する。Canvasの再描画、resize、orientationchange、アニメーション速度は、Domainの結果や評価を変えてはならない。

### 6. 雨予報と危険理由

雨予報は`StageSession.rainForecast`をそのまま表示用へ変換する。次の2イベントについて、発生までの手数、合計雨量、降雨セルを表示し、同じセルへ降る別イベントも別の輪で区別する。

セルの危険表示は、次の正確な状態またはpreview evidenceだけから作る。

- 現在の水量と保護上限
- 既に記録されたセル別浸水量
- previewの保護対象超過
- previewの危険出口への移動
- previewの安全排水
- 次の雨がそのセルへ降ること

Presentationは、将来の水流を独自に計算して危険度を推測しない。危険理由は最大2件に絞り、色だけでなく「次の雨」「危険側の出口」「保護セルへの浸水」などの文章でも伝える。

## テスト方針

- 全64セルの中心を投影し、同じセルへヒットテストできる。
- 高さが重なる上面は高いセルを優先する。
- 同時Pointerを1つだけ受理し、upで確定しない。
- cancelで仮置きを解除する。
- preview前後でM2の可逆hashと手数が変わらない。
- 無効配置のconfirmで候補、手数、action IDが変わらない。
- `npm run build:app`と静的app smokeが成功する。
- 2つ先までの雨予報が量・手数・セル位置つきで表示できる。
- 選択セルへ危険度と最大2件の理由を表示できる。

## M3の停止条件

次を満たさない表示・入力変更は次の画面統合へ進めない。

- Pointer-up、再タップ、連打で施工が二重確定する。
- Pointer-cancel後に古い仮置きが残る。
- previewと確定後traceの最初の水流が一致しない。
- 盤面の一部が表示領域から外れ、主要操作が44 CSS px未満になる。
- PresentationがDomainと別の水流・危険判定を持つ。
- `npm run check`、型検査、ドメインsmoke、画面smokeのいずれかが失敗する。
