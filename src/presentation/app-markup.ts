export interface AppMarkupInput {
  readonly stageName: string;
  readonly stageGoal: string;
  readonly stageOptionsMarkup: string;
  readonly cellPickerMarkup: string;
  readonly labUrl: string;
}

/** Builds the static application shell without owning game state or rules. */
export function buildAppMarkup(input: AppMarkupInput): string {
  return `
  <section class="start-panel" id="start-panel" aria-labelledby="start-title">
    <div class="start-card">
      <p class="eyebrow">水を読む、地形を組む、街を守る</p>
      <h1 id="start-title">ナガシマス</h1>
      <p class="game-purpose">雨水の流れを変えるパズル</p>
      <p class="start-lead">雨が降る前に地面を上げ下げして、水をためる場所や安全な出口へ流します。ステージごとの目標を達成するとクリアです。</p>
      <section class="game-loop-visual start-secondary-info" aria-label="ゲームの流れ">
        <div class="game-loop-step"><span class="loop-icon loop-terrain" aria-hidden="true">▰</span><strong>地形を作る</strong><small>上げる・下げる</small></div>
        <span class="loop-arrow" aria-hidden="true">→</span>
        <div class="game-loop-step"><span class="loop-icon loop-rain" aria-hidden="true">☁</span><strong>雨が降る</strong><small>予報を読む</small></div>
        <span class="loop-arrow" aria-hidden="true">→</span>
        <div class="game-loop-step"><span class="loop-icon loop-water" aria-hidden="true">≈</span><strong>水を守る</strong><small>ためる・流す</small></div>
      </section>
      <section class="game-explanation" aria-labelledby="game-explanation-title">
        <h2 id="game-explanation-title">このゲームでやること</h2>
        <p>候補は、地面をどう変えるかを示す工事パーツです。置いた場所で水の流れが変わります。</p>
        <p class="selected-stage-goal" id="selected-stage-goal"><strong>選択中のステージ「${input.stageName}」:</strong> ${input.stageGoal}</p>
      </section>
      <section class="player-name-card" aria-labelledby="player-name-title">
        <h2 id="player-name-title">ランキングに参加する</h2>
        <label for="player-name">プレイヤー名（必須）</label>
        <input id="player-name" type="text" maxlength="20" autocomplete="name" placeholder="20文字以内で入力" required />
        <p class="player-name-note" id="player-name-note">名前を入力するとゲームを開始できます。</p>
      </section>
      <div class="platform-actions start-secondary-info" aria-label="ゲームの共有と実験場">
        <button id="home-share" type="button">このゲームをシェア</button>
        <span class="platform-status" id="home-share-status" role="status" aria-live="polite"></span>
        <a class="platform-link" href="${input.labUrl}" target="_blank" rel="noopener noreferrer">カメレオンJPの実験場</a>
      </div>
      <section class="tutorial-card" aria-labelledby="tutorial-title">
        <div class="tutorial-heading">
          <h2 id="tutorial-title">最初の1手</h2>
          <button class="tutorial-toggle" id="tutorial-toggle" type="button" aria-controls="tutorial-steps" aria-expanded="true">閉じる</button>
        </div>
        <ol id="tutorial-steps">
          <li><strong>候補A/Bを選ぶ</strong><span>地面を上げる・下げる工事から1つ選びます。最初はAが選択済みです。</span></li>
          <li><strong>緑の丸を1つ押す</strong><span>緑の丸は、その工事を置ける場所です。仮置きなのでまだ確定しません。</span></li>
          <li><strong>4回後の見込みを読む</strong><span>「施工確定」で工事・雨・4回の水流を進めます。「見送り」なら工事をせず進めます。</span></li>
        </ol>
      </section>
      <section class="stage-picker" aria-labelledby="stage-picker-title">
        <h2 id="stage-picker-title">ステージを選ぶ</h2>
        <div class="stage-list">${input.stageOptionsMarkup}</div>
        <p class="stage-summary" id="stage-summary"></p>
        <label class="timer-setting" for="timer-mode">思考時間
          <select id="timer-mode">
            <option value="standard">標準</option>
            <option value="extended">長め</option>
            <option value="unlimited">無制限</option>
          </select>
        </label>
        <label class="timer-setting" for="playback-speed">水流再生速度
          <select id="playback-speed">
            <option value="standard">標準</option>
            <option value="fast">高速</option>
          </select>
        </label>
        <p class="setting-help" id="playback-speed-help"></p>
        <p class="saved-game-summary" id="saved-game-summary"></p>
        <button class="start-button" id="resume-saved-game" type="button" hidden>続きから再開</button>
        <button class="start-button" id="start-game" type="button">このステージを始める</button>
      </section>
    </div>
  </section>
  <main class="game-shell" id="game-shell" aria-label="ナガシマス" hidden>
    <header class="game-header">
      <div>
        <h1 class="game-title" id="game-title"></h1>
        <p class="game-purpose">雨水の流れを変えるパズル</p>
        <p class="game-objective" id="objective" aria-live="polite" aria-atomic="true"></p>
        <section class="objective-visual" aria-label="目標の進捗">
          <div class="objective-visual-heading"><span id="objective-progress-title">目標進捗</span><strong id="objective-progress-label">0 / 0</strong></div>
          <div class="objective-progress-track" id="objective-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" aria-label="目標進捗"><span id="objective-progress-bar"></span></div>
        </section>
        <p class="forecast-line" id="forecast" aria-live="polite" aria-atomic="true"></p>
        <p class="game-risk" id="risk"></p>
        <section class="turn-guide" aria-labelledby="turn-guide-title" aria-live="polite" aria-atomic="true">
          <div class="turn-guide-heading">
            <h2 id="turn-guide-title">今すること</h2>
            <span id="turn-guide-step"></span>
          </div>
          <p class="turn-guide-action" id="turn-guide-action"></p>
          <p class="turn-guide-detail" id="turn-guide-detail"></p>
          <ol class="turn-guide-steps" aria-hidden="true">
            <li data-guide-step="1">① 候補を選ぶ</li>
            <li data-guide-step="2">② 緑の丸を押す</li>
            <li data-guide-step="3">③ 予測を読んで進める</li>
          </ol>
        </section>
        <section class="phase-timeline" aria-label="手番の流れ">
          <div class="phase-step is-current" data-phase-ui="construction"><span class="phase-icon" aria-hidden="true">▰</span><strong>工事</strong><small>地形を変える</small></div>
          <div class="phase-step" data-phase-ui="rain"><span class="phase-icon" aria-hidden="true">☁</span><strong>雨</strong><small>雨が落ちる</small></div>
          <div class="phase-step" data-phase-ui="flow"><span class="phase-icon" aria-hidden="true">≈</span><strong>水流</strong><small>水が移動する</small></div>
          <div class="phase-step" data-phase-ui="evaluation"><span class="phase-icon" aria-hidden="true">✓</span><strong>結果</strong><small>目標を判定</small></div>
        </section>
      </div>
      <div class="header-actions">
        <div>
          <p class="game-turn" id="turn"></p>
          <p class="game-timer" id="timer"></p>
        </div>
        <button id="pause" type="button">一時停止</button>
      </div>
    </header>
    <section class="game-stage" aria-label="治水盤面">
      <canvas class="game-canvas" id="board" aria-label="8×8の治水盤面"></canvas>
      <div class="board-view-state" id="board-view-state" role="status" aria-live="polite" hidden>
        <p id="board-view-state-text"></p>
        <section class="board-view-state-help" id="board-view-state-help" aria-labelledby="board-view-state-help-title" hidden>
          <h2 id="board-view-state-help-title">盤面が見えないとき</h2>
          <figure class="board-view-state-diagram" role="img" aria-label="盤面の例。雨が落ち、水面の低いセルへ流れ、安全な出口へ向かいます。">
            <div class="board-view-state-diagram-grid" aria-hidden="true">
              <span class="board-view-state-diagram-token diagram-rain">雨</span>
              <span class="board-view-state-diagram-token diagram-water">水</span>
              <span class="board-view-state-diagram-token diagram-flow">→</span>
              <span class="board-view-state-diagram-token diagram-outlet">出口</span>
            </div>
            <figcaption>盤面の読み方（例）</figcaption>
          </figure>
          <ol>
            <li>候補を選び、緑の丸を押して仮置きします。</li>
            <li>施工を確定すると、雨のあと水流が4回進みます。</li>
            <li>同じ高さでは水は動かず、盤外の出口は地形を上げても閉じません。</li>
          </ol>
          <p>この端末では3D盤面を操作できません。再生成を試すか、別の端末でプレイしてください。</p>
        </section>
        <div class="board-view-state-actions">
          <button id="board-view-retry" type="button">3D表示を再生成</button>
          <button id="board-view-stage-menu" type="button">ステージ選択へ戻る</button>
        </div>
      </div>
      <div class="camera-controls" aria-label="盤面を見る向き">
        <button id="camera-left" type="button" aria-label="盤面を見る向きを左へ90度変える">↶</button>
        <span id="camera-label">盤面を見る向き 1 / 4</span>
        <button id="camera-right" type="button" aria-label="盤面を見る向きを右へ90度変える">↷</button>
        <button id="camera-reset" type="button">正面</button>
      </div>
      <div class="mobile-stage-action">
        <p id="mobile-stage-prompt">操作を開いて、工事を選びます。</p>
        <button id="mobile-controls-toggle" type="button" aria-expanded="false" aria-controls="game-controls" aria-haspopup="dialog">工事を選ぶ</button>
      </div>
      <section class="pause-panel" id="pause-panel" hidden aria-live="polite">
        <h2>一時停止中</h2>
        <p id="pause-message">再開すると、残り時間から続けます。</p>
        <button id="resume" type="button">再開</button>
      </section>
    </section>
    <div class="mobile-controls-backdrop" id="mobile-controls-backdrop" aria-hidden="true" hidden></div>
    <section class="game-controls" id="game-controls" aria-labelledby="controls-sheet-title">
      <div class="controls-sheet-heading">
        <h2 class="controls-title" id="controls-sheet-title">この手の操作</h2>
        <button id="mobile-controls-close" type="button">盤面へ戻る</button>
      </div>
      <p class="construction-help" id="construction-help">緑の丸は、候補カードの◎に対応する基準セルです。座標は予報と同じ表記です。</p>
      <div class="candidate-row">
        <button class="candidate-card" id="candidate-a" type="button" aria-pressed="true">
          <span class="candidate-shape" aria-hidden="true"></span>
          <span class="candidate-copy"><strong></strong><small></small></span>
        </button>
        <button class="candidate-card" id="candidate-b" type="button" aria-pressed="false">
          <span class="candidate-shape" aria-hidden="true"></span>
          <span class="candidate-copy"><strong></strong><small></small></span>
        </button>
      </div>
      <section class="preview-summary" id="preview-summary" aria-label="施工プレビュー" aria-live="polite" aria-atomic="true" hidden>
        <p id="preview-construction"></p>
        <p id="preview-rain"></p>
        <p id="preview-flow"></p>
        <p id="preview-result"></p>
      </section>
      <div class="action-row">
        <button id="rotate" type="button"><strong>パーツを回す</strong><small>工事パーツの向き</small></button>
        <button id="cancel" type="button"><strong>仮置きを取消</strong><small>選び直す</small></button>
        <button id="confirm" type="button"><strong>施工確定</strong><small>この配置で雨を進める</small></button>
        <button id="skip" type="button"><strong>見送り</strong><small>工事せず進める</small></button>
        <button id="undo" type="button"><strong>1手戻す</strong><small>Undo</small></button>
      </div>
      <details class="secondary-info" id="secondary-info">
        <summary>盤面の見方・座標</summary>
        <section class="board-legend" aria-labelledby="board-legend-title">
          <h2 id="board-legend-title">盤面の見方</h2>
          <ul class="legend-list">
            <li><span class="legend-symbol legend-anchor" aria-hidden="true"></span><span>緑の丸：候補カードの◎に対応する基準セル</span></li>
            <li><span class="legend-symbol legend-forecast" aria-hidden="true"></span><span>点線の輪：予報の雨（数字は雨量）</span></li>
            <li><span class="legend-symbol legend-flow" aria-hidden="true"></span><span>青い水面：そのセルにたまった水（数字は水量）</span></li>
            <li><span class="legend-symbol legend-flow-particle" aria-hidden="true"></span><span>水色の粒：再生中に移動する水</span></li>
            <li><span class="legend-symbol legend-safe" aria-hidden="true"></span><span>緑の辺：安全な排水方向</span></li>
            <li><span class="legend-symbol legend-danger" aria-hidden="true"></span><span>赤い辺：危険側へ流れる方向</span></li>
            <li><span class="legend-symbol legend-risk" aria-hidden="true"></span><span>黄〜赤の塗り：雨と水流の危険度</span></li>
            <li><span class="legend-symbol legend-rule" aria-hidden="true">i</span><span>同じ高さのセル同士では水は動きません</span></li>
            <li><span class="legend-symbol legend-rule" aria-hidden="true">↗</span><span>盤外の出口は、地形を上げても閉じません</span></li>
          </ul>
        </section>
        <details class="cell-picker" id="cell-picker">
          <summary>盤面が押しにくいとき：座標で選ぶ</summary>
          <p class="cell-picker-help" id="cell-picker-help">施工可能なセルだけ押せます。キーボードでも選べます。</p>
          <div class="cell-picker-grid" id="cell-picker-grid" aria-label="施工可能な座標">${input.cellPickerMarkup}</div>
        </details>
      </details>
      <section class="turn-outcome" id="turn-outcome" hidden aria-live="polite" aria-atomic="true">
        <h2>直前の手番で起きたこと</h2>
        <p id="turn-outcome-construction"></p>
        <p id="turn-outcome-rain"></p>
        <p id="turn-outcome-flow"></p>
        <p id="turn-outcome-result"></p>
      </section>
      <p class="game-message" id="message" role="status" aria-live="polite"></p>
      <section class="result-panel" id="result-panel" tabindex="-1" hidden aria-live="polite">
        <h2 id="result-title"></h2>
        <p id="result-summary"></p>
        <h3>なぜこの結果になったか</h3>
        <p id="result-first-break"></p>
        <p id="result-cause"></p>
        <p id="result-score"></p>
        <p class="result-score-guide" id="result-score-guide"></p>
        <p id="result-reasons"></p>
        <p class="result-hint" id="result-hint"></p>
        <section class="result-sharing" aria-labelledby="result-share-title">
          <h3 id="result-share-title">結果をシェア</h3>
          <p id="result-player" class="result-player"></p>
          <textarea id="result-share-text" rows="5" readonly aria-label="結果のシェア文"></textarea>
          <button id="result-share" type="button">シェア文をコピー</button>
          <p id="result-share-status" class="platform-status" role="status" aria-live="polite"></p>
        </section>
        <details class="online-ranking">
          <summary>ランキングを見る</summary>
          <section aria-labelledby="ranking-title">
            <h3 id="ranking-title">上位10名</h3>
            <ol id="ranking-list" class="ranking-list"></ol>
            <p id="ranking-status" class="platform-status" role="status" aria-live="polite">結果を送信するとランキングを表示します。</p>
          </section>
        </details>
        <a class="platform-link result-platform-link" href="${input.labUrl}" target="_blank" rel="noopener noreferrer">カメレオンJPの実験場へ</a>
        <button id="retry" type="button">もう一度</button>
        <button id="stage-menu" type="button">ステージ選択へ</button>
      </section>
    </section>
  </main>
`;
}
