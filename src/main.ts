import './styles.css';

import {
  markTutorialSeen,
  readProgress,
  recordClearedStage,
  setLastStageId,
  setProgressPlaybackSpeed,
  setProgressTimerMode,
  writeProgress
} from './application/progress-storage';
import type { ProgressPlaybackSpeed } from './application/progress-storage';
import {
  clearStageSave,
  createStageSave,
  isStageSaveResumable,
  readStageSave,
  restoreStageSave,
  writeStageSave
} from './application/stage-save';
import type { StageSaveV1 } from './application/stage-save';
import { StageController } from './application/stage-controller';
import type { StageControllerView } from './application/stage-controller';
import { isStageUnlocked, stageAccessLabel } from './application/stage-access';
import { TurnTimer, formatRemainingSeconds, timerDurationMs } from './application/turn-timer';
import { shouldStartTurnTimerAfterVisibility } from './application/visibility-resume';
import { CELL_COUNT } from './domain/constants';
import type { CandidateSlot, StageTimerMode } from './domain/stage-replay';
import { getStageObjectiveProgress } from './domain/stage-session';
import type {
  StageExecution,
  StageTracePhase,
  StageTurnPreview
} from './domain/stage-session';
import type { BoardSnapshot } from './domain/types';
import { BUILT_IN_STAGES, getBuiltInStage } from './domain/stages';
import type { ValidatedStageDefinition } from './domain/stage-definition';
import {
  createIsometricLayout,
  hitTestCell,
  normalizeIsometricRotation
} from './presentation/isometric';
import { PointerController } from './presentation/pointer-controller';
import { renderIsometricBoard } from './presentation/board-renderer';
import type { ConstructionVisual } from './presentation/board-renderer';
import { buildStageProjection, riskLabel } from './presentation/stage-projection';
import { buildStagePreviewSummary } from './presentation/stage-preview';
import {
  resultCauseText,
  resultFirstBreakText,
  resultImprovementHint
} from './presentation/result-feedback';
import {
  buildTurnOutcomeSummary
} from './presentation/turn-outcome';
import type { TurnOutcomeSummary } from './presentation/turn-outcome';
import { TracePlayback, tracePlaybackDurations } from './presentation/trace-playback';
import type { TracePlaybackFrame } from './presentation/trace-playback';
import type { IsometricLayout, IsometricRotation } from './presentation/isometric';

const root = document.querySelector<HTMLDivElement>('#app');
if (root === null) throw new Error('app root is missing');
const appRoot = root;
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const SUPABASE_URL = 'https://mlpnjgezrnhdxsxolyzj.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_drzcy0v97knU6FgjqSgBHw_0A9XPdFM';
const GAME_SLUG = 'nagashimasu';
const CLIENT_VERSION = 'nagashimasu-2026-08-31-platform';
const LAB_URL = 'https://chameleonjp-lab.github.io/chameleonjp_lab/';
const PLAYER_NAME_STORAGE_KEY = 'nagashimasu:player-name';

const stage = getBuiltInStage('stage-01-first-pond');
if (stage === undefined) throw new Error('built-in stage-01-first-pond is missing');
let progress = readProgress();
const clearedStageIds = (value: typeof progress): readonly string[] =>
  value.stages.filter((entry) => entry.cleared).map((entry) => entry.stageId);
let savedStageSave: StageSaveV1 | null = readStageSave();

function stageForSave(save: StageSaveV1): ValidatedStageDefinition | null {
  const definition = getBuiltInStage(save.replay.header.stageId);
  if (
    definition === undefined ||
    !isStageSaveResumable(save, clearedStageIds(progress)) ||
    save.replay.header.dataVersion !== definition.dataVersion ||
    save.replay.header.definitionDigest !== definition.definitionDigest
  ) return null;
  try {
    return restoreStageSave(definition, save) === null ? null : definition;
  } catch {
    return null;
  }
}

const resumableStage = savedStageSave === null ? null : stageForSave(savedStageSave);
if (savedStageSave !== null && resumableStage === null) {
  clearStageSave();
  savedStageSave = null;
}
const lastSelectedStage = getBuiltInStage(progress.lastStageId);
let currentStage = resumableStage ?? (
  lastSelectedStage !== undefined && isStageUnlocked(lastSelectedStage.id, clearedStageIds(progress))
    ? lastSelectedStage
    : stage
);

function stageObjectiveText(definition: ValidatedStageDefinition): string {
  switch (definition.objective.type) {
    case 'stored-water': return `池に雨水を${definition.objective.target}ためる`;
    case 'safe-drain': return `安全な出口へ水を${definition.objective.target}流す`;
    case 'protect': return `保護対象を${definition.objective.target}回守る`;
  }
}

function stageGoalExplanation(definition: ValidatedStageDefinition): string {
  switch (definition.objective.type) {
    case 'stored-water':
      return `池に雨水をため、合計${definition.objective.target}まで集めるとクリアです。`;
    case 'safe-drain':
      return `水を安全な出口へ流し、合計${definition.objective.target}以上にするとクリアです。`;
    case 'protect':
      return `雨のたびに保護対象を浸水させず、${definition.objective.target}回守るとクリアです。`;
  }
}

function stageFirstActionExplanation(
  definition: ValidatedStageDefinition,
  selectedCandidate: string
): string {
  return definition.id === 'stage-01-first-pond' && selectedCandidate === '候補A'
    ? '最初は候補Aが選択済みです。緑の丸を1つ押して、まず仮置きしてみてください。'
    : `${selectedCandidate}を選択中です。緑の丸を1つ押して、まず仮置きしてみてください。`;
}

function stageNumber(definition: ValidatedStageDefinition): number {
  const match = /^stage-(\d+)/u.exec(definition.id);
  return Number(match?.[1] ?? 0);
}

const cellPickerMarkup = Array.from(
  { length: CELL_COUNT },
  (_, index) => `<button class="cell-picker-cell" type="button" data-cell-index="${index}" aria-pressed="false" disabled>${index + 1}</button>`
).join('');

const stageOptionsMarkup = BUILT_IN_STAGES.map((definition) => `
  <button class="stage-option" type="button" data-stage-id="${definition.id}" aria-pressed="${definition.id === currentStage.id}">
    <span class="stage-option-number">ステージ${stageNumber(definition)}</span>
    <strong>${definition.name}</strong>
    <small>${stageObjectiveText(definition)}</small>
    <small class="stage-option-status" data-stage-status="${definition.id}"></small>
  </button>
`).join('');

let controller = new StageController(currentStage, progress.timerMode);
appRoot.innerHTML = `
  <section class="start-panel" id="start-panel" aria-labelledby="start-title">
    <div class="start-card">
      <p class="eyebrow">水を読む、地形を組む、街を守る</p>
      <h1 id="start-title">ナガシマス</h1>
      <p class="game-purpose">雨水の流れを変えるパズル</p>
      <p class="start-lead">雨が降る前に地面を上げ下げして、水をためる場所や安全な出口へ流します。ステージごとの目標を達成するとクリアです。</p>
      <section class="game-loop-visual" aria-label="ゲームの流れ">
        <div class="game-loop-step"><span class="loop-icon loop-terrain" aria-hidden="true">▰</span><strong>地形を作る</strong><small>上げる・下げる</small></div>
        <span class="loop-arrow" aria-hidden="true">→</span>
        <div class="game-loop-step"><span class="loop-icon loop-rain" aria-hidden="true">☁</span><strong>雨が降る</strong><small>予報を読む</small></div>
        <span class="loop-arrow" aria-hidden="true">→</span>
        <div class="game-loop-step"><span class="loop-icon loop-water" aria-hidden="true">≈</span><strong>水を守る</strong><small>ためる・流す</small></div>
      </section>
      <section class="game-explanation" aria-labelledby="game-explanation-title">
        <h2 id="game-explanation-title">このゲームでやること</h2>
        <p>候補は、地面をどう変えるかを示す工事パーツです。置いた場所で水の流れが変わります。</p>
        <p class="selected-stage-goal" id="selected-stage-goal"><strong>選択中のステージ「${currentStage.name}」:</strong> ${stageGoalExplanation(currentStage)}</p>
      </section>
      <section class="player-name-card" aria-labelledby="player-name-title">
        <h2 id="player-name-title">ランキングに参加する</h2>
        <label for="player-name">プレイヤー名（必須）</label>
        <input id="player-name" type="text" maxlength="20" autocomplete="name" placeholder="20文字以内で入力" required />
        <p class="player-name-note" id="player-name-note">名前を入力するとゲームを開始できます。</p>
      </section>
      <div class="platform-actions" aria-label="ゲームの共有と実験場">
        <button id="home-share" type="button">このゲームをシェア</button>
        <span class="platform-status" id="home-share-status" role="status" aria-live="polite"></span>
        <a class="platform-link" href="${LAB_URL}" target="_blank" rel="noopener noreferrer">カメレオンJPの実験場</a>
      </div>
      <section class="tutorial-card" aria-labelledby="tutorial-title">
        <div class="tutorial-heading">
          <h2 id="tutorial-title">最初の1手</h2>
          <button class="tutorial-toggle" id="tutorial-toggle" type="button" aria-controls="tutorial-steps" aria-expanded="true">閉じる</button>
        </div>
        <ol id="tutorial-steps">
          <li><strong>候補A/Bを選ぶ</strong><span>地面を上げる・下げる工事から1つ選びます。最初はAが選択済みです。</span></li>
          <li><strong>緑の丸を1つ押す</strong><span>緑の丸は、その工事を置ける場所です。仮置きなのでまだ確定しません。</span></li>
          <li><strong>予測を読んで進める</strong><span>「施工確定」でその配置のまま雨を進めます。「見送り」なら工事をせず雨を進めます。</span></li>
        </ol>
      </section>
      <section class="stage-picker" aria-labelledby="stage-picker-title">
        <h2 id="stage-picker-title">ステージを選ぶ</h2>
        <div class="stage-list">${stageOptionsMarkup}</div>
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
      <div class="camera-controls" aria-label="盤面の向き">
        <button id="camera-left" type="button" aria-label="盤面を左へ90度回転">↶</button>
        <span id="camera-label">盤面 1 / 4</span>
        <button id="camera-right" type="button" aria-label="盤面を右へ90度回転">↷</button>
        <button id="camera-reset" type="button">正面</button>
      </div>
      <div class="mobile-stage-action">
        <p id="mobile-stage-prompt">操作を開いて、工事を選びます。</p>
        <button id="mobile-controls-toggle" type="button" aria-expanded="false">工事を選ぶ</button>
      </div>
      <section class="pause-panel" id="pause-panel" hidden aria-live="polite">
        <h2>一時停止中</h2>
        <p id="pause-message">再開すると、残り時間から続けます。</p>
        <button id="resume" type="button">再開</button>
      </section>
    </section>
    <div class="mobile-controls-backdrop" id="mobile-controls-backdrop" hidden></div>
    <section class="game-controls" id="game-controls" aria-label="施工操作">
      <div class="controls-sheet-heading">
        <h2 class="controls-title">この手の操作</h2>
        <button id="mobile-controls-close" type="button">盤面へ戻る</button>
      </div>
      <p class="construction-help" id="construction-help">緑の丸が、選んだ候補を置ける場所です。セル番号は予報と同じ番号です。</p>
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
      </section>
      <div class="action-row">
        <button id="rotate" type="button"><strong>向きを変える</strong><small>配置を回転</small></button>
        <button id="cancel" type="button"><strong>仮置きを取消</strong><small>選び直す</small></button>
        <button id="confirm" type="button"><strong>施工確定</strong><small>この配置で雨を進める</small></button>
        <button id="skip" type="button"><strong>見送り</strong><small>工事せず進める</small></button>
        <button id="undo" type="button"><strong>1手戻す</strong><small>Undo</small></button>
      </div>
      <details class="secondary-info" id="secondary-info">
        <summary>盤面の見方・セル番号</summary>
        <section class="board-legend" aria-labelledby="board-legend-title">
          <h2 id="board-legend-title">盤面の見方</h2>
          <ul class="legend-list">
            <li><span class="legend-symbol legend-anchor" aria-hidden="true"></span><span>緑の丸：選んだ候補を置けるセル</span></li>
            <li><span class="legend-symbol legend-forecast" aria-hidden="true"></span><span>点線の輪：予報の雨（数字は雨量）</span></li>
            <li><span class="legend-symbol legend-flow" aria-hidden="true"></span><span>青い水面：そのセルにたまった水（数字は水量）</span></li>
            <li><span class="legend-symbol legend-flow-particle" aria-hidden="true"></span><span>水色の粒：再生中に移動する水</span></li>
            <li><span class="legend-symbol legend-safe" aria-hidden="true"></span><span>緑の辺：安全な排水方向</span></li>
            <li><span class="legend-symbol legend-danger" aria-hidden="true"></span><span>赤い辺：危険側へ流れる方向</span></li>
            <li><span class="legend-symbol legend-risk" aria-hidden="true"></span><span>黄〜赤の塗り：雨と水流の危険度</span></li>
          </ul>
        </section>
        <details class="cell-picker" id="cell-picker">
          <summary>盤面が押しにくいとき：セル番号で選ぶ</summary>
          <p class="cell-picker-help" id="cell-picker-help">施工可能なセルだけ押せます。キーボードでも選べます。</p>
          <div class="cell-picker-grid" id="cell-picker-grid" aria-label="施工可能なセル番号">${cellPickerMarkup}</div>
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
        <p id="result-reasons"></p>
        <p class="result-hint" id="result-hint"></p>
        <section class="result-sharing" aria-labelledby="result-share-title">
          <h3 id="result-share-title">結果をシェア</h3>
          <p id="result-player" class="result-player"></p>
          <textarea id="result-share-text" rows="5" readonly aria-label="結果のシェア文"></textarea>
          <button id="result-share" type="button">シェア文をコピー</button>
          <p id="result-share-status" class="platform-status" role="status" aria-live="polite"></p>
        </section>
        <section class="online-ranking" aria-labelledby="ranking-title">
          <h3 id="ranking-title">上位10名</h3>
          <ol id="ranking-list" class="ranking-list"></ol>
          <p id="ranking-status" class="platform-status" role="status" aria-live="polite">結果を送信するとランキングを表示します。</p>
        </section>
        <a class="platform-link result-platform-link" href="${LAB_URL}" target="_blank" rel="noopener noreferrer">カメレオンJPの実験場へ</a>
        <button id="retry" type="button">もう一度</button>
        <button id="stage-menu" type="button">ステージ選択へ</button>
      </section>
    </section>
  </main>
`;

function required<T extends Element>(selector: string): T {
  const element = appRoot.querySelector<T>(selector);
  if (element === null) throw new Error(`missing element ${selector}`);
  return element;
}

const canvas = required<HTMLCanvasElement>('#board');
const context = canvas.getContext('2d');
if (context === null) throw new Error('2D canvas context is unavailable');
const canvasContext = context;
const stageElement = required<HTMLElement>('.game-stage');
const gameControls = required<HTMLElement>('#game-controls');
const mobileControlsBackdrop = required<HTMLElement>('#mobile-controls-backdrop');
const mobileControlsToggle = required<HTMLButtonElement>('#mobile-controls-toggle');
const mobileControlsClose = required<HTMLButtonElement>('#mobile-controls-close');
const mobileStagePrompt = required<HTMLElement>('#mobile-stage-prompt');
const cameraLeftButton = required<HTMLButtonElement>('#camera-left');
const cameraRightButton = required<HTMLButtonElement>('#camera-right');
const cameraResetButton = required<HTMLButtonElement>('#camera-reset');
const cameraLabel = required<HTMLElement>('#camera-label');
const startPanel = required<HTMLElement>('#start-panel');
const gameShell = required<HTMLElement>('#game-shell');
const playerNameInput = required<HTMLInputElement>('#player-name');
const playerNameNote = required<HTMLElement>('#player-name-note');
const homeShareButton = required<HTMLButtonElement>('#home-share');
const homeShareStatus = required<HTMLElement>('#home-share-status');
const gameTitleElement = required<HTMLElement>('#game-title');
const selectedStageGoalElement = required<HTMLElement>('#selected-stage-goal');
const tutorialSteps = required<HTMLOListElement>('#tutorial-steps');
const tutorialToggle = required<HTMLButtonElement>('#tutorial-toggle');
const stageSummaryElement = required<HTMLElement>('#stage-summary');
const savedGameSummary = required<HTMLElement>('#saved-game-summary');
const resumeSavedGameButton = required<HTMLButtonElement>('#resume-saved-game');
const startGameButton = required<HTMLButtonElement>('#start-game');
const timerModeSelect = required<HTMLSelectElement>('#timer-mode');
const playbackSpeedSelect = required<HTMLSelectElement>('#playback-speed');
const playbackSpeedHelp = required<HTMLElement>('#playback-speed-help');
const stageMenuButton = required<HTMLButtonElement>('#stage-menu');
const stageOptionButtons = Array.from(
  appRoot.querySelectorAll<HTMLButtonElement>('.stage-option')
);
const objectiveElement = required<HTMLElement>('#objective');
const objectiveProgressTitleElement = required<HTMLElement>('#objective-progress-title');
const objectiveProgressLabelElement = required<HTMLElement>('#objective-progress-label');
const objectiveProgressBarElement = required<HTMLElement>('#objective-progress-bar');
const objectiveProgressTrackElement = required<HTMLElement>('#objective-progress-track');
const forecastElement = required<HTMLElement>('#forecast');
const riskElement = required<HTMLElement>('#risk');
const turnGuideStepElement = required<HTMLElement>('#turn-guide-step');
const turnGuideActionElement = required<HTMLElement>('#turn-guide-action');
const turnGuideDetailElement = required<HTMLElement>('#turn-guide-detail');
const turnGuideStepElements = Array.from(
  appRoot.querySelectorAll<HTMLElement>('[data-guide-step]')
);
const phaseStepElements = Array.from(
  appRoot.querySelectorAll<HTMLElement>('[data-phase-ui]')
);
const turnElement = required<HTMLElement>('#turn');
const constructionHelpElement = required<HTMLElement>('#construction-help');
const cellPickerHelpElement = required<HTMLElement>('#cell-picker-help');
const cellPickerButtons = Array.from(
  appRoot.querySelectorAll<HTMLButtonElement>('.cell-picker-cell')
);
const previewSummaryElement = required<HTMLElement>('#preview-summary');
const previewConstructionElement = required<HTMLElement>('#preview-construction');
const previewRainElement = required<HTMLElement>('#preview-rain');
const previewFlowElement = required<HTMLElement>('#preview-flow');
const turnOutcomeElement = required<HTMLElement>('#turn-outcome');
const turnOutcomeConstructionElement = required<HTMLElement>('#turn-outcome-construction');
const turnOutcomeRainElement = required<HTMLElement>('#turn-outcome-rain');
const turnOutcomeFlowElement = required<HTMLElement>('#turn-outcome-flow');
const turnOutcomeResultElement = required<HTMLElement>('#turn-outcome-result');
const messageElement = required<HTMLElement>('#message');
const candidateButtons = [
  required<HTMLButtonElement>('#candidate-a'),
  required<HTMLButtonElement>('#candidate-b')
] as const;
const rotateButton = required<HTMLButtonElement>('#rotate');
const cancelButton = required<HTMLButtonElement>('#cancel');
const confirmButton = required<HTMLButtonElement>('#confirm');
const skipButton = required<HTMLButtonElement>('#skip');
const undoButton = required<HTMLButtonElement>('#undo');
const resultPanel = required<HTMLElement>('#result-panel');
const resultTitle = required<HTMLElement>('#result-title');
const resultSummary = required<HTMLElement>('#result-summary');
const resultFirstBreak = required<HTMLElement>('#result-first-break');
const resultCause = required<HTMLElement>('#result-cause');
const resultScore = required<HTMLElement>('#result-score');
const resultReasons = required<HTMLElement>('#result-reasons');
const resultHint = required<HTMLElement>('#result-hint');
const resultPlayer = required<HTMLElement>('#result-player');
const resultShareText = required<HTMLTextAreaElement>('#result-share-text');
const resultShareButton = required<HTMLButtonElement>('#result-share');
const resultShareStatus = required<HTMLElement>('#result-share-status');
const rankingList = required<HTMLOListElement>('#ranking-list');
const rankingStatus = required<HTMLElement>('#ranking-status');
const retryButton = required<HTMLButtonElement>('#retry');
const timerElement = required<HTMLElement>('#timer');
const pauseButton = required<HTMLButtonElement>('#pause');
const pausePanel = required<HTMLElement>('#pause-panel');
const pauseMessage = required<HTMLElement>('#pause-message');
const resumeButton = required<HTMLButtonElement>('#resume');

let layout: IsometricLayout | null = null;
let cameraRotation: IsometricRotation = 0;
let lastMessage = 'まず緑の丸を1つ押して仮置きしてください。';
let lastTurnOutcome: TurnOutcomeSummary | null = null;
let activeConstructionVisual: ConstructionVisual | null = null;
interface TurnPlaybackVisual {
  readonly beforeBoard: BoardSnapshot;
  readonly afterRainBoard: BoardSnapshot | null;
}
let activeTurnPlaybackVisual: TurnPlaybackVisual | null = null;
let playback: TracePlayback | null = null;
let selectedStageId = currentStage.id;
let selectedTimerMode: StageTimerMode = progress.timerMode;
let selectedPlaybackSpeed: ProgressPlaybackSpeed = progress.playbackSpeed;
let paused = false;
let pageHidden = document.hidden;
let turnTimer: TurnTimer | null = null;
let playerName = readPlayerName();
let resultPlatformLoaded = false;
let resultPlatformRequestId = 0;
const PLAYBACK_SPEED_UNLOCK_STAGE_ID = 'stage-02-open-to-sea';

interface RankingRow {
  readonly display_name?: unknown;
  readonly player_name?: unknown;
  readonly score?: unknown;
  readonly best_score?: unknown;
}

function cleanPlayerName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, 20);
}

function readPlayerName(): string {
  try {
    return cleanPlayerName(localStorage.getItem(PLAYER_NAME_STORAGE_KEY) ?? '');
  } catch {
    return '';
  }
}

function savePlayerName(value: string): void {
  playerName = cleanPlayerName(value);
  try {
    if (playerName.length > 0) localStorage.setItem(PLAYER_NAME_STORAGE_KEY, playerName);
    else localStorage.removeItem(PLAYER_NAME_STORAGE_KEY);
  } catch {
    // The name still applies to the current session when storage is unavailable.
  }
}

function currentGameUrl(): string {
  return new URL(window.location.href).toString().split('#')[0] ?? window.location.href;
}

function homeShareMessage(): string {
  return `ナガシマスで雨水の流れを読み、街を守ろう！\n${currentGameUrl()}\n#ナガシマス #ミニゲーム`;
}

function resultShareMessage(stageName: string, phase: 'cleared' | 'failed', score: { readonly total: number; readonly safety: number; readonly efficiency: number; readonly control: number; readonly grade: string | null }, objectiveProgress: { readonly value: number; readonly target: number }): string {
  const resultLabel = phase === 'cleared' ? 'クリア' : '挑戦結果';
  return `${playerName}さんのナガシマス「${stageName}」${resultLabel}：${score.total}点（安全${score.safety}・効率${score.efficiency}・制御${score.control}／評価${score.grade ?? '-'}）。目標進捗${objectiveProgress.value}/${objectiveProgress.target}\n${currentGameUrl()}\n#ナガシマス #ミニゲーム`;
}

async function shareOrCopy(text: string, statusElement: HTMLElement, textElement?: HTMLTextAreaElement): Promise<void> {
  statusElement.textContent = '';
  if (navigator.share) {
    try {
      await navigator.share({ title: 'ナガシマス', text, url: currentGameUrl() });
      statusElement.textContent = '共有しました。';
      return;
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(text);
    statusElement.textContent = 'シェア文をコピーしました。';
  } catch {
    if (textElement !== undefined) {
      textElement.focus();
      textElement.select();
    }
    statusElement.textContent = 'シェア文を選択しました。コピーしてご利用ください。';
  }
}

async function callRankingRpc(name: string, payload: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const body = await response.text();
  let data: unknown = null;
  try {
    data = body.length > 0 ? JSON.parse(body) : null;
  } catch {
    data = body;
  }
  if (!response.ok) throw new Error(`${name}: ${response.status}`);
  return data;
}

function rankingRows(data: unknown): readonly RankingRow[] {
  return Array.isArray(data) ? data.slice(0, 10) as RankingRow[] : [];
}

function renderPlayerNameState(): void {
  playerNameInput.value = playerName;
  const valid = playerName.length > 0;
  playerNameNote.textContent = valid
    ? `${playerName}さんの名前でランキングに参加します。`
    : '名前を入力するとゲームを開始できます。';
  startGameButton.disabled = !valid;
  resumeSavedGameButton.disabled = !valid;
}

async function submitAndLoadRanking(phase: 'cleared' | 'failed', score: { readonly total: number; readonly safety: number; readonly efficiency: number; readonly control: number; readonly grade: string | null }, objectiveProgress: { readonly value: number; readonly target: number }, requestId: number): Promise<void> {
  const isCurrentRequest = (): boolean => requestId === resultPlatformRequestId;
  resultPlayer.textContent = `${playerName}さんの結果`;
  resultShareText.value = resultShareMessage(currentStage.name, phase, score, objectiveProgress);
  resultShareButton.disabled = playerName.length === 0;
  rankingList.replaceChildren();
  rankingStatus.textContent = 'ランキングを更新中…';
  try {
    await callRankingRpc('submit_score', {
      p_display_name: playerName,
      p_game_slug: GAME_SLUG,
      p_score: Math.trunc(score.total),
      p_client_version: CLIENT_VERSION
    });
  } catch {
    if (!isCurrentRequest()) return;
    rankingStatus.textContent = '今回のスコアを送信できませんでした。ランキングを表示します。';
  }
  if (!isCurrentRequest()) return;
  try {
    const rows = rankingRows(await callRankingRpc('get_best_score_ranking', { p_game_slug: GAME_SLUG, p_limit: 10 }));
    if (!isCurrentRequest()) return;
    if (rows.length === 0) {
      const item = document.createElement('li');
      item.textContent = 'まだランキングがありません。';
      rankingList.append(item);
    } else {
      rows.forEach((row) => {
        const item = document.createElement('li');
        const name = typeof row.display_name === 'string'
          ? row.display_name
          : typeof row.player_name === 'string' ? row.player_name : 'ななし';
        const rawScore = row.score ?? row.best_score;
        const numericScore = Number(rawScore);
        item.textContent = `${name}：${Number.isFinite(numericScore) ? Math.trunc(numericScore) : '—'}点`;
        rankingList.append(item);
      });
    }
    if (rankingStatus.textContent === 'ランキングを更新中…') rankingStatus.textContent = '上位10名を表示しています。';
  } catch {
    if (!isCurrentRequest()) return;
    rankingList.replaceChildren();
    const item = document.createElement('li');
    item.textContent = 'ランキングを読み込めませんでした。';
    rankingList.append(item);
    rankingStatus.textContent = 'ランキングを読み込めませんでした。';
  }
}

function requirePlayerName(): boolean {
  if (playerName.length > 0) return true;
  renderPlayerNameState();
  playerNameInput.focus();
  return false;
}

let mobileControlsOpen = false;

function isMobileViewport(): boolean {
  return window.matchMedia('(max-width: 759px)').matches;
}

function setMobileControlsOpen(open: boolean): void {
  const wasOpen = mobileControlsOpen;
  mobileControlsOpen = open;
  gameControls.classList.toggle('is-open', open);
  gameControls.setAttribute('aria-hidden', String(!open && isMobileViewport()));
  mobileControlsBackdrop.hidden = !open || !isMobileViewport();
  mobileControlsToggle.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('mobile-sheet-open', open && isMobileViewport());
  if (wasOpen && !open && isMobileViewport() && gameShell.hidden === false) {
    window.requestAnimationFrame(() => mobileControlsToggle.focus({ preventScroll: true }));
  }
}

function cameraText(rotation: IsometricRotation): string {
  return `盤面 ${rotation + 1} / 4`;
}

function setCameraRotation(nextRotation: number): void {
  cameraRotation = normalizeIsometricRotation(nextRotation);
  cameraLabel.textContent = cameraText(cameraRotation);
  if (layout !== null) {
    layout = createIsometricLayout(layout.viewportWidth, layout.viewportHeight, {
      padding: 16,
      rotation: cameraRotation
    });
  }
}

function updateMobileStagePrompt(view: StageControllerView): void {
  if (!isMobileViewport()) {
    mobileStagePrompt.textContent = '';
    mobileControlsToggle.hidden = true;
    mobileControlsToggle.disabled = false;
    return;
  }
  mobileControlsToggle.hidden = false;
  mobileControlsToggle.disabled = playback !== null;
  if (playback !== null) {
    mobileStagePrompt.textContent = '工事・雨・水流を見ています。';
    mobileControlsToggle.textContent = '操作を閉じる';
    return;
  }
  if (view.snapshot.phase !== 'awaiting-turn') {
    mobileStagePrompt.textContent = '結果を確認してください。';
    mobileControlsToggle.textContent = '結果を開く';
    return;
  }
  if (view.pending !== null) {
    mobileStagePrompt.textContent = '仮置き中です。盤面の下で予測を確認します。';
    mobileControlsToggle.textContent = '予測・確定を開く';
    return;
  }
  mobileStagePrompt.textContent = '候補を選んだら、盤面をタップして置きます。';
  mobileControlsToggle.textContent = '工事を選ぶ';
}

function persistProgress(next: typeof progress): void {
  progress = next;
  writeProgress(progress);
}

function updateTutorialVisibility(): void {
  const expanded = !progress.tutorialSeen;
  tutorialSteps.hidden = !expanded;
  tutorialToggle.setAttribute('aria-expanded', String(expanded));
  tutorialToggle.textContent = expanded ? '閉じる' : '遊び方を表示';
}

function savedStageSummary(stageId: string): string {
  const saved = progress.stages.find((entry) => entry.stageId === stageId);
  if (saved === undefined || !saved.cleared) return '';
  return ` クリア済み（最高${saved.bestTotal ?? 0}点・${saved.bestGrade ?? '-'}）`;
}

function playbackSpeedUnlocked(): boolean {
  return progress.stages.some(
    (entry) => entry.stageId === PLAYBACK_SPEED_UNLOCK_STAGE_ID && entry.cleared
  );
}

function updateStagePicker(): void {
  const selected = getBuiltInStage(selectedStageId);
  if (selected === undefined) return;
  selectedStageGoalElement.textContent = `選択中のステージ「${selected.name}」: ${stageGoalExplanation(selected)}`;
  const clearedIds = clearedStageIds(progress);
  for (const button of stageOptionButtons) {
    const stageId = button.dataset['stageId'];
    const unlocked = stageId !== undefined && isStageUnlocked(stageId, clearedIds);
    button.setAttribute('aria-pressed', String(button.dataset['stageId'] === selected.id));
    button.disabled = !unlocked;
    button.setAttribute('aria-disabled', String(!unlocked));
    button.title = unlocked
      ? ''
      : '前のステージをクリアすると解放されます。';
    const status = button.querySelector<HTMLElement>('[data-stage-status]');
    if (status !== null && stageId !== undefined) {
      status.textContent = stageAccessLabel(stageId, clearedIds);
    }
  }
  timerModeSelect.value = selectedTimerMode;
  timerModeSelect.disabled = selected.timerSeconds === null;
  const speedUnlocked = playbackSpeedUnlocked();
  playbackSpeedSelect.disabled = !speedUnlocked;
  playbackSpeedSelect.value = speedUnlocked ? selectedPlaybackSpeed : 'standard';
  playbackSpeedHelp.textContent = speedUnlocked
    ? '高速でも、施工・雨・水流・評価の全区間を表示します。'
    : 'ステージ2をクリアすると高速を選べます。';
  const timerSummary = selected.timerSeconds === null
    ? '時間制限なし。'
    : (() => {
      const extendedSeconds = Math.round(selected.timerSeconds * 1.5);
      const selectedLabel = selectedTimerMode === 'extended'
        ? `長め${extendedSeconds}秒`
        : selectedTimerMode === 'unlimited'
          ? '無制限'
          : `標準${selected.timerSeconds}秒`;
      return `標準${selected.timerSeconds}秒／長め${extendedSeconds}秒／無制限（現在: ${selectedLabel}）。`;
    })();
  stageSummaryElement.textContent = `${selected.name}: ${stageObjectiveText(selected)}。${timerSummary}${savedStageSummary(selected.id)}`;
}

function updateSavedGamePrompt(): void {
  const save = savedStageSave;
  if (save === null) {
    savedGameSummary.textContent = '';
    resumeSavedGameButton.hidden = true;
    return;
  }
  const definition = stageForSave(save);
  if (definition === null) {
    clearStageSave();
    savedStageSave = null;
    savedGameSummary.textContent = '';
    resumeSavedGameButton.hidden = true;
    return;
  }
  savedGameSummary.textContent = `${definition.name}に続きがあります（受理済み操作${save.replay.entries.length}件）。`;
  resumeSavedGameButton.textContent = `${definition.name}を続きから再開`;
  resumeSavedGameButton.hidden = false;
}

function persistSessionSave(): void {
  const save = createStageSave(
    controller.session.exportReplay(),
    controller.session.fullStateHash,
    controller.session.reversibleGameplayHash
  );
  if (writeStageSave(save)) {
    savedStageSave = save;
  } else {
    clearStageSave();
    savedStageSave = null;
  }
  updateSavedGamePrompt();
}

function thinkingDurationMs(): number | null {
  return timerDurationMs(currentStage.timerSeconds, selectedTimerMode);
}

function stopTurnTimer(): void {
  turnTimer?.stop();
  turnTimer = null;
}

function handleTimeout(): void {
  if (
    paused ||
    pageHidden ||
    playback !== null ||
    controller.view.snapshot.phase !== 'awaiting-turn'
  ) return;
  stopTurnTimer();
  const beforeView = controller.view;
  const turnPreview = controller.previewTimeout();
  const execution = controller.timeout();
  if (execution.accepted) {
    lastMessage = '時間切れのため、施工を見送って水を進めます。';
    startPlayback(
      execution,
      '施工なし（時間切れで見送り）',
      null,
      turnPlaybackVisualForView(beforeView, turnPreview)
    );
  } else {
    lastMessage = reasonText(execution.reason);
  }
  render();
}

function startTurnTimer(): void {
  stopTurnTimer();
  const duration = thinkingDurationMs();
  if (
    duration === null ||
    paused ||
    pageHidden ||
    playback !== null ||
    controller.view.snapshot.phase !== 'awaiting-turn'
  ) {
    render();
    return;
  }
  turnTimer = new TurnTimer({
    onTick: () => render(),
    onExpire: handleTimeout
  });
  turnTimer.start(duration);
}

function pauseGame(reason: 'manual' | 'background'): void {
  if (
    playback !== null ||
    controller.view.snapshot.phase !== 'awaiting-turn' ||
    paused
  ) return;
  paused = true;
  turnTimer?.pause();
  pauseMessage.textContent = reason === 'background'
    ? '画面を離れたため停止しました。再開すると残り時間から続けます。'
    : '再開すると、残り時間から続けます。';
  pausePanel.hidden = false;
  render();
}

function resumeGame(): void {
  if (!paused || pageHidden) return;
  paused = false;
  pausePanel.hidden = true;
  if (turnTimer?.paused) turnTimer.resume();
  else startTurnTimer();
  render();
}

function resumeSavedGame(): void {
  if (!requirePlayerName()) return;
  const save = savedStageSave;
  if (save === null) return;
  const definition = stageForSave(save);
  if (definition === null) {
    clearStageSave();
    savedStageSave = null;
    updateSavedGamePrompt();
    updateStagePicker();
    return;
  }
  playback?.cancel();
  playback = null;
  activeConstructionVisual = null;
  activeTurnPlaybackVisual = null;
  stopTurnTimer();
  paused = false;
  pausePanel.hidden = true;
  currentStage = definition;
  selectedStageId = definition.id;
  cameraRotation = 0;
  cameraLabel.textContent = cameraText(cameraRotation);
  selectedTimerMode = save.replay.header.timerMode;
  lastTurnOutcome = null;
  persistProgress(markTutorialSeen(setLastStageId(progress, definition.id)));
  updateTutorialVisibility();
  updateStagePicker();
  controller = new StageController(definition, selectedTimerMode, save.replay);
  lastMessage = '保存した続きから再開しました。';
  startPanel.hidden = true;
  gameShell.hidden = false;
  setMobileControlsOpen(true);
  resizeCanvas();
  startTurnTimer();
}

function startSelectedStage(): void {
  if (!requirePlayerName()) return;
  const selected = getBuiltInStage(selectedStageId);
  if (selected === undefined || !isStageUnlocked(selected.id, clearedStageIds(progress))) {
    updateStagePicker();
    return;
  }
  playback?.cancel();
  playback = null;
  activeConstructionVisual = null;
  activeTurnPlaybackVisual = null;
  stopTurnTimer();
  paused = false;
  pausePanel.hidden = true;
  currentStage = selected;
  cameraRotation = 0;
  cameraLabel.textContent = cameraText(cameraRotation);
  if (savedStageSave?.replay.header.stageId === selected.id) {
    clearStageSave();
    savedStageSave = null;
  }
  persistProgress(markTutorialSeen(setLastStageId(progress, selected.id)));
  lastTurnOutcome = null;
  updateTutorialVisibility();
  updateSavedGamePrompt();
  controller = new StageController(currentStage, selectedTimerMode);
  lastMessage = 'まず緑の丸を1つ押して仮置きしてください。';
  startPanel.hidden = true;
  gameShell.hidden = false;
  setMobileControlsOpen(true);
  resizeCanvas();
  startTurnTimer();
}

function showStagePicker(): void {
  if (playback !== null) return;
  stopTurnTimer();
  paused = false;
  pausePanel.hidden = true;
  controller.cancelPlacement();
  setMobileControlsOpen(false);
  gameShell.hidden = true;
  startPanel.hidden = false;
  updateStagePicker();
  updateTutorialVisibility();
}

function phaseLabel(phase: StageTracePhase, flowStep: number | null): string {
  switch (phase) {
    case 'construction': return '施工を反映中';
    case 'rain': return '雨を処理中';
    case 'flow': return `水流を再生中（step ${flowStep ?? '-'}）`;
    case 'evaluation': return '結果を判定中';
    case 'undo': return 'Undoを反映中';
  }
}

function terminalPhaseLabel(phase: 'awaiting-turn' | 'cleared' | 'failed'): string {
  switch (phase) {
    case 'awaiting-turn': return '継続中';
    case 'cleared': return 'クリア';
    case 'failed': return '失敗';
  }
}

function objectiveProgressTitle(definition: ValidatedStageDefinition): string {
  switch (definition.objective.type) {
    case 'stored-water': return '池にためた水';
    case 'safe-drain': return '安全に排水した水';
    case 'protect': return '守れた雨';
  }
}

function constructionVisualForView(view: StageControllerView): ConstructionVisual | null {
  const preview = view.preview;
  if (
    preview === null ||
    !preview.valid ||
    preview.action.type !== 'construct' ||
    preview.placementCells.length === 0
  ) return null;
  const firstCell = preview.placementCells[0];
  if (firstCell === undefined) return null;
  return Object.freeze({
    placementCells: preview.placementCells,
    terrainBefore: view.snapshot.board.terrain,
    terrainAfter: preview.terrainAfterConstruction,
    delta: (preview.terrainAfterConstruction[firstCell] ?? 0) -
      (view.snapshot.board.terrain[firstCell] ?? 0)
  });
}

function turnPlaybackVisualForView(
  view: StageControllerView,
  preview: StageTurnPreview | null
): TurnPlaybackVisual {
  return Object.freeze({
    beforeBoard: view.snapshot.board,
    afterRainBoard: preview?.boardAfterRain ?? null
  });
}

function updatePhaseTimeline(
  view: StageControllerView,
  playbackFrame: TracePlaybackFrame | null
): void {
  const rawPhase = playbackFrame?.phase ?? (
    view.snapshot.phase === 'awaiting-turn' ? 'construction' : 'evaluation'
  );
  const activePhase = rawPhase === 'undo' ? 'construction' : rawPhase;
  for (const element of phaseStepElements) {
    const phase = element.dataset['phaseUi'];
    const isCurrent = phase === activePhase;
    element.classList.toggle('is-current', isCurrent);
    element.classList.toggle(
      'is-complete',
      playbackFrame !== null && phase !== undefined &&
        ['construction', 'rain', 'flow', 'evaluation'].indexOf(phase) <
          ['construction', 'rain', 'flow', 'evaluation'].indexOf(activePhase)
    );
    if (isCurrent) element.setAttribute('aria-current', 'step');
    else element.removeAttribute('aria-current');
  }
}

function playbackGuideText(
  phase: StageTracePhase,
  flowStep: number | null
): { readonly action: string; readonly detail: string } {
  switch (phase) {
    case 'construction':
      return { action: 'いま起きていること: 地面の高さを変えています。', detail: '選んだ配置を盤面へ反映しています。' };
    case 'rain':
      return { action: 'いま起きていること: 予報どおりに雨が降っています。', detail: '雨が降ったセルと雨量を盤面で確認できます。' };
    case 'flow':
      return { action: `いま起きていること: 水が移動しています（${flowStep ?? '-'}回目）。`, detail: '水は低い方へ流れ、安全な出口か危険側へ進みます。' };
    case 'evaluation':
      return { action: 'いま起きていること: 目標を達成したか確認しています。', detail: '処理が終わるまで少し待ってください。' };
    case 'undo':
      return { action: 'いま起きていること: 直前の手を元に戻しています。', detail: '元に戻った盤面を確認してから、次の手を選べます。' };
  }
}

function updateTurnGuide(
  view: StageControllerView,
  playbackFrame: TracePlaybackFrame | null
): void {
  let step = 1;
  let stepLabel = 'ステップ1 / 3';
  let action = '';
  let detail = '';

  if (playbackFrame !== null && playbackFrame.phase !== null) {
    const playbackText = playbackGuideText(
      playbackFrame.phase,
      playbackFrame.event?.flowStep ?? null
    );
    stepLabel = '処理中';
    action = playbackText.action;
    detail = playbackText.detail;
  } else if (paused) {
    stepLabel = '一時停止中';
    action = '一時停止中です。';
    detail = '再開ボタンを押すと、残り時間から続けられます。';
  } else if (view.snapshot.phase !== 'awaiting-turn') {
    stepLabel = '終了';
    step = 3;
    action = view.snapshot.phase === 'cleared'
      ? 'クリア: ステージの目標を達成しました。'
      : '失敗: 下の結果欄で、何が起きたか確認してください。';
    detail = '「もう一度」で同じステージを最初からやり直せます。';
  } else if (view.pending !== null) {
    step = 3;
    stepLabel = 'ステップ3 / 3';
    action = '仮置き中: 下のプレビューで、施工・雨・次の水流を確認してください。';
    detail = '納得したら「施工確定」で進みます。やめるなら「仮置きを取消」です。';
  } else if (view.legalAnchorIndices.length === 0) {
    step = 3;
    stepLabel = 'ステップ3 / 3';
    action = '今は置ける場所がありません。「見送り」で工事をせず進みます。';
    detail = stageGoalExplanation(currentStage);
  } else if (view.snapshot.completedTurns === 0) {
    step = 2;
    stepLabel = 'ステップ2 / 3';
    action = '最初の一手: 緑の丸を1つ押してください。';
    const selectedCandidate = view.candidates.find((candidate) => candidate.selected);
    const selectedCandidateLabel = selectedCandidate?.slot === 1 ? '候補B' : '候補A';
    detail = `${stageFirstActionExplanation(currentStage, selectedCandidateLabel)} ${stageGoalExplanation(currentStage)}`;
  } else {
    step = 1;
    stepLabel = 'ステップ1〜2 / 3';
    action = '候補A/Bから選び、緑の丸を1つ押してください。';
    detail = stageGoalExplanation(currentStage);
  }

  turnGuideStepElement.textContent = stepLabel;
  turnGuideActionElement.textContent = action;
  turnGuideDetailElement.textContent = detail;
  for (const element of turnGuideStepElements) {
    element.classList.toggle('is-current', Number(element.dataset['guideStep']) === step);
  }
}

function failureReasonText(reason: string): string {
  const labels: Readonly<Record<string, string>> = {
    'danger-leak': '危険側へ流出しました',
    'protected-overflow': '保護対象が浸水しました',
    'objective-not-met': 'ステージの目的を達成できませんでした'
  };
  return labels[reason] ?? reason;
}

function resultVisualText(view: StageControllerView): string {
  if (view.snapshot.phase === 'cleared') return 'クリア：目標を達成しました';
  if (view.snapshot.failureReasons.includes('protected-overflow')) {
    return '失敗：保護対象が浸水しました';
  }
  if (view.snapshot.failureReasons.includes('danger-leak')) {
    return '失敗：水が危険側へ流れました';
  }
  return '失敗：目標を達成できませんでした';
}

function boardForPlayback(
  view: StageControllerView,
  playbackFrame: TracePlaybackFrame | null
): BoardSnapshot {
  const visual = activeTurnPlaybackVisual;
  if (visual === null || playbackFrame === null) return view.snapshot.board;
  switch (playbackFrame.phase) {
    case 'construction': return visual.beforeBoard;
    case 'rain': return visual.afterRainBoard ?? visual.beforeBoard;
    case 'flow':
    case 'evaluation':
    case 'undo':
      return view.snapshot.board;
  }
  return view.snapshot.board;
}

function startPlayback(
  execution: StageExecution,
  construction: string,
  constructionVisual: ConstructionVisual | null = null,
  turnPlaybackVisual: TurnPlaybackVisual | null = null
): void {
  stopTurnTimer();
  setMobileControlsOpen(false);
  playback?.cancel();
  activeConstructionVisual = constructionVisual;
  activeTurnPlaybackVisual = turnPlaybackVisual;
  const outcome = buildTurnOutcomeSummary({
    construction,
    trace: execution.trace,
    phase: execution.snapshot.phase
  });
  if (controller.view.snapshot.phase === 'awaiting-turn') {
    persistSessionSave();
  } else {
    clearStageSave();
    savedStageSave = null;
    updateSavedGamePrompt();
  }
  playback = new TracePlayback(execution.trace, {
    onFrame: () => render(),
    onComplete: () => {
      playback = null;
      activeConstructionVisual = null;
      activeTurnPlaybackVisual = null;
      lastTurnOutcome = outcome;
      if (!paused && !pageHidden && controller.view.snapshot.phase === 'awaiting-turn') {
        startTurnTimer();
      }
      if (controller.view.snapshot.phase === 'cleared') {
        const score = controller.view.snapshot.score;
        persistProgress(recordClearedStage(progress, currentStage.id, {
          total: score.total,
          grade: score.grade
        }));
        updateStagePicker();
      }
      if (controller.view.snapshot.phase !== 'awaiting-turn') {
        clearStageSave();
        savedStageSave = null;
        updateSavedGamePrompt();
        setMobileControlsOpen(true);
      }
      render();
      if (controller.view.snapshot.phase !== 'awaiting-turn' && isMobileViewport()) {
        window.requestAnimationFrame(() => resultPanel.focus({ preventScroll: true }));
      }
    }
  }, tracePlaybackDurations(
    playbackSpeedUnlocked() ? selectedPlaybackSpeed : 'standard'
  ));
  playback.start();
}

function resizeCanvas(): void {
  const bounds = stageElement.getBoundingClientRect();
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const devicePixelRatio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(width * devicePixelRatio));
  canvas.height = Math.max(1, Math.round(height * devicePixelRatio));
  canvasContext.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  layout = createIsometricLayout(width, height, {
    padding: 16,
    rotation: cameraRotation
  });
  render();
}

function localPoint(clientX: number, clientY: number): { readonly x: number; readonly y: number } {
  const bounds = canvas.getBoundingClientRect();
  return Object.freeze({ x: clientX - bounds.left, y: clientY - bounds.top });
}

function selectCellAt(clientX: number, clientY: number): void {
  if (layout === null || playback !== null || paused) return;
  const view = controller.view;
  if (view.snapshot.phase !== 'awaiting-turn') return;
  const point = localPoint(clientX, clientY);
  const inputSnapshot: Pick<typeof view.snapshot.board, 'terrain'> = {
    terrain: view.preview?.terrainAfterConstruction ?? view.snapshot.board.terrain
  };
  const cell = hitTestCell(
    layout,
    inputSnapshot,
    point.x,
    point.y,
    view.legalAnchorIndices
  );
  if (cell !== null) {
    controller.setAnchor(cell);
    lastMessage = `セル${cell + 1}に仮置きしました。施工確定で手番が進みます。`;
    if (isMobileViewport()) setMobileControlsOpen(true);
    render();
  }
}

function reasonText(reason: string | null): string {
  if (reason === null) return '';
  const labels: Readonly<Record<string, string>> = {
    'cell-out-of-bounds': '盤面の外です。',
    'anchor-out-of-bounds': '置き場所が盤面の外です。',
    'construction-forbidden': 'ここは施工できません。',
    'terrain-limit': '地形の高さ上限または下限に達します。',
    'candidate-exhausted': '候補が尽きています。',
    'timer-disabled': 'このステージではタイムアウトを使えません。',
    'stage-complete': 'このステージは終了しています。',
    'undo-already-used': 'Undoはこのステージで1回だけ使えます。',
    'undo-unavailable': '戻せる手番がありません。'
  };
  return labels[reason] ?? `操作を受け付けません（${reason}）。`;
}

interface CandidateOffset {
  readonly row: number;
  readonly column: number;
}

function rotateCandidateOffset(offset: CandidateOffset, rotation: number): CandidateOffset {
  switch (rotation) {
    case 1: return { row: offset.column, column: -offset.row };
    case 2: return { row: -offset.row, column: -offset.column };
    case 3: return { row: -offset.column, column: offset.row };
    default: return offset;
  }
}

function normalizedCandidateOffsets(
  offsets: readonly CandidateOffset[],
  rotation: number
): readonly CandidateOffset[] {
  const rotated = offsets.map((offset) => rotateCandidateOffset(offset, rotation));
  const minimumRow = Math.min(...rotated.map((offset) => offset.row));
  const minimumColumn = Math.min(...rotated.map((offset) => offset.column));
  return rotated.map((offset) => Object.freeze({
    row: offset.row - minimumRow,
    column: offset.column - minimumColumn
  }));
}

function candidateShapeLabel(offsets: readonly CandidateOffset[]): string {
  if (offsets.length === 1) return '1マス';
  const rows = new Set(offsets.map((offset) => offset.row));
  const columns = new Set(offsets.map((offset) => offset.column));
  if (rows.size === 1 || columns.size === 1) return `直線・${offsets.length}マス`;
  if (offsets.length === 3) return 'L字・3マス';
  return `形状・${offsets.length}マス`;
}

function renderCandidateCard(
  button: HTMLButtonElement,
  card: StageControllerView['candidates'][number],
  rotation: number
): void {
  const offsets = normalizedCandidateOffsets(card.offsets, rotation);
  const maximumRow = Math.max(...offsets.map((offset) => offset.row));
  const maximumColumn = Math.max(...offsets.map((offset) => offset.column));
  const occupied = new Set(offsets.map((offset) => `${offset.row},${offset.column}`));
  const shape = document.createElement('span');
  shape.className = 'candidate-shape';
  shape.setAttribute('aria-hidden', 'true');
  shape.style.gridTemplateColumns = `repeat(${maximumColumn + 1}, 10px)`;
  for (let row = 0; row <= maximumRow; row += 1) {
    for (let column = 0; column <= maximumColumn; column += 1) {
      const cell = document.createElement('span');
      cell.className = occupied.has(`${row},${column}`)
        ? 'candidate-shape-cell is-filled'
        : 'candidate-shape-cell';
      shape.append(cell);
    }
  }

  const copy = document.createElement('span');
  copy.className = 'candidate-copy';
  const title = document.createElement('strong');
  const titleText = `${card.slot === 0 ? '候補A' : '候補B'}: ${card.delta > 0 ? '上げる' : '下げる'}`;
  title.textContent = titleText;
  const detail = document.createElement('small');
  const shapeText = candidateShapeLabel(offsets);
  detail.textContent = `${shapeText}／向き${rotation + 1}`;
  copy.append(title, detail);
  button.replaceChildren(shape, copy);
  button.title = `${card.pieceId} / token ${card.tokenId}`;
  button.setAttribute('aria-label', `${titleText}、${shapeText}、向き${rotation + 1}`);
}

function updateCellPicker(view: StageControllerView, locked: boolean): void {
  const legalAnchors = new Set(view.legalAnchorIndices);
  const canSelect = !locked && view.snapshot.phase === 'awaiting-turn';
  cellPickerHelpElement.textContent = legalAnchors.size > 0
    ? `施工可能なセルは${legalAnchors.size}か所です。有効な番号を押すと仮置きします。`
    : '現在、選んだ候補を置けるセルはありません。見送りで水を進められます。';
  for (const button of cellPickerButtons) {
    const index = Number(button.dataset['cellIndex']);
    const legal = Number.isSafeInteger(index) && legalAnchors.has(index);
    const selected = view.pending?.anchorIndex === index;
    button.disabled = !canSelect || !legal;
    button.classList.toggle('is-legal', legal);
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute(
      'aria-label',
      legal
        ? `セル${index + 1}${selected ? '（選択中）' : '（施工可能）'}`
        : `セル${index + 1}（現在は施工不可）`
    );
  }
}

function render(): void {
  const currentLayout = layout;
  if (currentLayout === null) return;
  const view = controller.view;
  const playbackFrame: TracePlaybackFrame | null = playback?.frame ?? null;
  const locked = playback !== null || paused;
  const board = boardForPlayback(view, playbackFrame);
  const objectiveProgress = getStageObjectiveProgress(
    currentStage,
    board,
    view.snapshot.metrics
  );
  const projection = buildStageProjection(
    currentStage,
    view.snapshot,
    view.forecasts,
    view.preview
  );
  const previewSummary = buildStagePreviewSummary(view.snapshot, view.preview);
  const storageCells = currentStage.storageMask.flatMap((value, index) => value === 1 ? [index] : []);
  const resultHighlightCells = view.snapshot.phase === 'failed'
    ? view.snapshot.board.terrain.flatMap((_, index) =>
      (view.snapshot.board.dangerEdgeMask[index] ?? 0) !== 0 ||
      (view.snapshot.metrics.firstFloodStepByCell[index] ?? null) !== null
        ? [index]
        : []
    )
    : [];
  const labelCells = [
    ...view.legalAnchorIndices,
    ...projection.forecastCells.map((forecast) => forecast.index),
    ...storageCells,
    ...view.snapshot.board.terrain.flatMap((_, index) =>
      (view.snapshot.board.cellFlags[index] ?? 0) !== 0 ? [index] : []
    )
  ];
  renderIsometricBoard(canvasContext, board, currentLayout, {
    selectedCell: view.pending?.anchorIndex ?? null,
    preview: view.preview,
    constructionAnchorCells: playback === null ? view.legalAnchorIndices : [],
    activePlacementCells: playbackFrame?.event?.placementCells ?? [],
    flowResult: playbackFrame?.event?.flowResult ?? null,
    rainCells: playbackFrame?.event?.rainCells ?? [],
    forecastCells: projection.forecastCells,
    riskCells: projection.risks,
    playbackProgress: playbackFrame?.progress ?? null,
    phase: playbackFrame?.phase ?? null,
    constructionVisual: activeConstructionVisual,
    resultPhase: playback === null &&
      (view.snapshot.phase === 'cleared' || view.snapshot.phase === 'failed')
      ? view.snapshot.phase
      : null,
    resultText: resultVisualText(view),
    objectiveProgress,
    objectiveLabel: objectiveProgressTitle(currentStage),
    storageCells,
    resultHighlightCells,
    labelCells,
    reducedMotion: reducedMotionQuery.matches
  });

  gameTitleElement.textContent = `ナガシマス — ${currentStage.name}`;
  const phaseText = playbackFrame?.phase === null || playbackFrame?.phase === undefined
    ? terminalPhaseLabel(view.snapshot.phase)
    : phaseLabel(playbackFrame.phase, playbackFrame.event?.flowStep ?? null);
  objectiveElement.textContent = `目標: ${stageObjectiveText(currentStage)}（進捗 ${objectiveProgress.value} / ${objectiveProgress.target}・${phaseText}）`;
  const progressRatio = objectiveProgress.target <= 0
    ? 0
    : Math.min(1, Math.max(0, objectiveProgress.value / objectiveProgress.target));
  objectiveProgressTitleElement.textContent = objectiveProgressTitle(currentStage);
  objectiveProgressLabelElement.textContent = `${objectiveProgress.value} / ${objectiveProgress.target}`;
  objectiveProgressBarElement.style.width = `${progressRatio * 100}%`;
  objectiveProgressTrackElement.setAttribute('aria-valuemin', '0');
  objectiveProgressTrackElement.setAttribute('aria-valuemax', String(objectiveProgress.target));
  objectiveProgressTrackElement.setAttribute('aria-valuenow', String(objectiveProgress.value));
  objectiveProgressTrackElement.setAttribute(
    'aria-label',
    `${objectiveProgressTitle(currentStage)} ${objectiveProgress.value} / ${objectiveProgress.target}`
  );
  const forecastText = view.forecasts.length === 0
    ? '雨予報: なし'
    : `雨予報: ${projection.forecasts.map((forecast) => `あと${forecast.turnsUntil}手・${forecast.totalAmount}・${forecast.cells.map((cell) => `セル${cell.index + 1}`).join('／')}`).join('、')}`;
  forecastElement.textContent = forecastText;
  turnElement.textContent = `手数 ${view.snapshot.completedTurns} / ${currentStage.maxTurns}`;
  const duration = thinkingDurationMs();
  const remaining = turnTimer?.remainingMs ?? null;
  const terminal = view.snapshot.phase !== 'awaiting-turn';
  gameControls.classList.toggle('is-terminal', terminal);
  const timerText = playback !== null
    ? '演出中'
    : paused
      ? '一時停止中'
      : terminal
        ? '終了'
        : duration === null
          ? '時間制限なし'
          : `残り ${formatRemainingSeconds(remaining ?? duration)}`;
  timerElement.textContent = timerText;
  timerElement.classList.toggle(
    'timer-warning',
    !paused && playback === null && remaining !== null && remaining <= 3_000
  );
  updateTurnGuide(view, playbackFrame);
  updatePhaseTimeline(view, playbackFrame);
  updateMobileStagePrompt(view);
  cameraLabel.textContent = cameraText(cameraRotation);

  const selectedRisk = view.pending === null
    ? null
    : projection.risks[view.pending.anchorIndex] ?? null;
  if (selectedRisk === null) {
    riskElement.textContent = '危険度: セルを選ぶと、雨と水流の理由を表示します。';
  } else {
    const reasons = selectedRisk.reasons.length > 0 ? selectedRisk.reasons.join('／') : '今の予測では大きな危険はありません';
    riskElement.textContent = `セル${selectedRisk.index + 1} 危険度: ${riskLabel(selectedRisk.level)} — ${reasons}`;
  }

  previewSummaryElement.hidden = previewSummary === null;
  previewConstructionElement.textContent = previewSummary === null
    ? ''
    : `施工: ${previewSummary.construction}`;
  previewRainElement.textContent = previewSummary === null
    ? ''
    : `降雨: ${previewSummary.rain}`;
  previewFlowElement.textContent = previewSummary?.flow ?? '';

  constructionHelpElement.textContent = view.legalAnchorIndices.length > 0
    ? isMobileViewport()
      ? view.pending === null
        ? '候補を選び、「盤面へ戻る」を押してから緑の丸をタップします。'
        : '仮置きした場所を盤面で確認し、施工確定または取消を選びます。'
      : `緑の丸が、選んだ候補を置ける場所です（${view.legalAnchorIndices.length}か所）。セル番号は予報と同じ番号です。`
    : '現在、選んだ候補を置ける場所はありません。見送りで水を進められます。';
  updateCellPicker(view, locked);

  for (const card of view.candidates) {
    const button = candidateButtons[card.slot];
    const rotation = view.pending?.slot === card.slot ? view.pending.rotation : 0;
    renderCandidateCard(button, card, rotation);
    button.setAttribute('aria-pressed', String(card.selected));
    button.disabled = locked || view.snapshot.phase !== 'awaiting-turn';
  }

  const hasPending = view.pending !== null;
  rotateButton.disabled = locked || !hasPending;
  cancelButton.disabled = locked || !hasPending;
  confirmButton.disabled = locked || view.preview === null || view.snapshot.phase !== 'awaiting-turn';
  skipButton.disabled = locked || view.snapshot.phase !== 'awaiting-turn';
  undoButton.disabled = locked || view.snapshot.undoUsed || view.snapshot.revision === 0;

  const validationMessage = view.validation?.valid === false
    ? reasonText(view.validation.reason)
    : '';
  messageElement.textContent = playbackFrame === null
    ? validationMessage || lastMessage
    : phaseLabel(playbackFrame.phase ?? 'evaluation', playbackFrame.event?.flowStep ?? null);

  resultPanel.hidden = locked || !terminal;
  turnOutcomeElement.hidden = locked || lastTurnOutcome === null;
  if (lastTurnOutcome !== null) {
    turnOutcomeConstructionElement.textContent = `工事: ${lastTurnOutcome.construction}`;
    turnOutcomeRainElement.textContent = lastTurnOutcome.rain;
    turnOutcomeFlowElement.textContent = lastTurnOutcome.flow;
    turnOutcomeResultElement.textContent = lastTurnOutcome.result;
  }
  if (terminal) {
    const resultInput = {
      phase: view.snapshot.phase,
      failureReasons: view.snapshot.failureReasons,
      metrics: view.snapshot.metrics,
      score: view.snapshot.score
    } as const;
    resultTitle.textContent = view.snapshot.phase === 'cleared' ? 'クリア' : '失敗';
    resultSummary.textContent = view.snapshot.phase === 'cleared'
      ? `目標「${stageObjectiveText(currentStage)}」を達成しました（${objectiveProgress.value} / ${objectiveProgress.target}）。`
      : `目標「${stageObjectiveText(currentStage)}」を達成できませんでした。`;
    const score = view.snapshot.score;
    resultFirstBreak.textContent = resultFirstBreakText(resultInput);
    resultCause.textContent = resultCauseText(resultInput);
    resultScore.textContent = `スコア ${score.total}（安全 ${score.safety}・効率 ${score.efficiency}・制御 ${score.control}）／評価 ${score.grade ?? '-'} `;
    resultReasons.textContent = view.snapshot.failureReasons.length === 0
      ? '危険を抑え、安全な流れを作れました。'
      : view.snapshot.failureReasons.map(failureReasonText).join('／');
    resultHint.textContent = resultImprovementHint(resultInput);
    if (!resultPlatformLoaded) {
      resultPlatformLoaded = true;
      resultPlatformRequestId += 1;
      void submitAndLoadRanking(
        view.snapshot.phase,
        view.snapshot.score,
        objectiveProgress,
        resultPlatformRequestId
      );
    }
  } else {
    if (resultPlatformLoaded) {
      resultPlatformLoaded = false;
      resultPlatformRequestId += 1;
    }
  }
  retryButton.disabled = locked;
  stageMenuButton.disabled = playback !== null;
  cameraLeftButton.disabled = playback !== null;
  cameraRightButton.disabled = playback !== null;
  cameraResetButton.disabled = playback !== null;
  pauseButton.disabled = playback !== null || view.snapshot.phase !== 'awaiting-turn';
  pauseButton.textContent = paused ? '再開' : '一時停止';
  pausePanel.hidden = !paused;
  resumeButton.disabled = pageHidden;
}

const pointerController = new PointerController(canvas, {
  onStart: (data) => selectCellAt(data.clientX, data.clientY),
  onMove: (data) => selectCellAt(data.clientX, data.clientY),
  onEnd: () => render(),
  onCancel: () => {
    if (playback !== null || paused) return;
    // A cancelled pointer stream must not erase an intentional pending
    // placement. This can happen when the browser interrupts a touch gesture.
    if (controller.view.pending !== null) {
      lastMessage = '盤面操作が中断されました。仮置きは保持しています。';
    }
    render();
  }
});
pointerController.attach();

candidateButtons.forEach((button, slot) => {
  button.addEventListener('click', () => {
    if (playback !== null || paused) return;
    controller.selectCandidate(slot as CandidateSlot);
    lastMessage = `${slot === 0 ? '候補A' : '候補B'}を選択しました。`;
    if (isMobileViewport()) setMobileControlsOpen(false);
    render();
  });
});

cellPickerButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (playback !== null || paused) return;
    const index = Number(button.dataset['cellIndex']);
    const view = controller.view;
    if (
      !Number.isSafeInteger(index) ||
      view.snapshot.phase !== 'awaiting-turn' ||
      !view.legalAnchorIndices.includes(index)
    ) return;
    controller.setAnchor(index);
    lastMessage = `セル${index + 1}に仮置きしました。施工確定で手番が進みます。`;
    render();
  });
});

cameraLeftButton.addEventListener('click', () => {
  setCameraRotation(cameraRotation - 1);
  lastMessage = '盤面を左へ90度回転しました。';
  render();
});

cameraRightButton.addEventListener('click', () => {
  setCameraRotation(cameraRotation + 1);
  lastMessage = '盤面を右へ90度回転しました。';
  render();
});

cameraResetButton.addEventListener('click', () => {
  setCameraRotation(0);
  lastMessage = '盤面を正面に戻しました。';
  render();
});

mobileControlsToggle.addEventListener('click', () => {
  setMobileControlsOpen(!mobileControlsOpen);
});

mobileControlsClose.addEventListener('click', () => {
  setMobileControlsOpen(false);
});

mobileControlsBackdrop.addEventListener('click', () => {
  setMobileControlsOpen(false);
});

rotateButton.addEventListener('click', () => {
  if (playback !== null || paused) return;
  controller.rotate();
  lastMessage = '仮置きの向きを回転しました。';
  render();
});

cancelButton.addEventListener('click', () => {
  if (playback !== null || paused) return;
  controller.cancelPlacement();
  lastMessage = '仮置きを取り消しました。';
  render();
});

confirmButton.addEventListener('click', () => {
  if (playback !== null || paused) return;
  const beforeView = controller.view;
  const previewSummary = buildStagePreviewSummary(beforeView.snapshot, beforeView.preview);
  const constructionVisual = constructionVisualForView(beforeView);
  const execution = controller.confirm();
  if (execution === null) {
    lastMessage = '先に盤面へ候補を仮置きしてください。';
  } else if (execution.accepted) {
    lastMessage = '施工を確定しました。雨と水流を計算しました。';
    startPlayback(
      execution,
      previewSummary?.construction ?? '施工あり',
      constructionVisual,
      turnPlaybackVisualForView(beforeView, beforeView.preview)
    );
  } else {
    lastMessage = reasonText(execution.reason);
  }
  render();
});

skipButton.addEventListener('click', () => {
  if (playback !== null || paused) return;
  const beforeView = controller.view;
  const turnPreview = controller.previewSkip();
  const execution = controller.skip();
  lastMessage = execution.accepted ? '施工を見送りました。' : reasonText(execution.reason);
  if (execution.accepted) {
    startPlayback(
      execution,
      '施工なし（見送り）',
      null,
      turnPlaybackVisualForView(beforeView, turnPreview)
    );
  }
  render();
});

undoButton.addEventListener('click', () => {
  if (playback !== null || paused) return;
  const beforeView = controller.view;
  const execution = controller.undo();
  lastMessage = execution.accepted ? '直前の手を取り消しました。' : reasonText(execution.reason);
  if (execution.accepted) {
    startPlayback(
      execution,
      '直前の手を元に戻す',
      null,
      turnPlaybackVisualForView(beforeView, null)
    );
  }
  render();
});

retryButton.addEventListener('click', () => {
  if (playback !== null || paused || !requirePlayerName()) return;
  stopTurnTimer();
  paused = false;
  pausePanel.hidden = true;
  clearStageSave();
  savedStageSave = null;
  updateSavedGamePrompt();
  controller = new StageController(currentStage, selectedTimerMode);
  cameraRotation = 0;
  cameraLabel.textContent = cameraText(cameraRotation);
  activeConstructionVisual = null;
  activeTurnPlaybackVisual = null;
  lastTurnOutcome = null;
  lastMessage = 'まず緑の丸を1つ押して仮置きしてください。';
  setMobileControlsOpen(true);
  startTurnTimer();
  render();
});

stageOptionButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const stageId = button.dataset['stageId'];
    if (
      stageId === undefined ||
      getBuiltInStage(stageId) === undefined ||
      !isStageUnlocked(stageId, clearedStageIds(progress))
    ) return;
    selectedStageId = stageId;
    persistProgress(setLastStageId(progress, stageId));
    updateStagePicker();
  });
});

tutorialToggle.addEventListener('click', () => {
  if (tutorialSteps.hidden) {
    tutorialSteps.hidden = false;
    tutorialToggle.setAttribute('aria-expanded', 'true');
    tutorialToggle.textContent = '閉じる';
    return;
  }
  persistProgress(markTutorialSeen(progress));
  updateTutorialVisibility();
});

startGameButton.addEventListener('click', startSelectedStage);
resumeSavedGameButton.addEventListener('click', resumeSavedGame);
stageMenuButton.addEventListener('click', showStagePicker);
playerNameInput.addEventListener('input', () => {
  savePlayerName(playerNameInput.value);
  renderPlayerNameState();
});
homeShareButton.addEventListener('click', () => {
  void shareOrCopy(homeShareMessage(), homeShareStatus);
});
resultShareButton.addEventListener('click', () => {
  void shareOrCopy(resultShareText.value, resultShareStatus, resultShareText);
});

timerModeSelect.addEventListener('change', () => {
  const value = timerModeSelect.value;
  if (value !== 'standard' && value !== 'extended' && value !== 'unlimited') return;
  selectedTimerMode = value;
  persistProgress(setProgressTimerMode(progress, value));
  updateStagePicker();
});

playbackSpeedSelect.addEventListener('change', () => {
  if (!playbackSpeedUnlocked()) {
    updateStagePicker();
    return;
  }
  const value = playbackSpeedSelect.value;
  if (value !== 'standard' && value !== 'fast') return;
  selectedPlaybackSpeed = value;
  persistProgress(setProgressPlaybackSpeed(progress, value));
  updateStagePicker();
});

pauseButton.addEventListener('click', () => {
  if (paused) resumeGame();
  else pauseGame('manual');
});

resumeButton.addEventListener('click', resumeGame);

document.addEventListener('visibilitychange', () => {
  pageHidden = document.hidden;
  if (pageHidden) {
    pauseGame('background');
    return;
  }
  if (paused) {
    pauseMessage.textContent = '一時停止中です。再開ボタンを押すと続きます。';
    resumeButton.disabled = false;
    render();
    return;
  }
  if (shouldStartTurnTimerAfterVisibility({
    pageHidden,
    paused,
    playbackActive: playback !== null,
    phase: controller.view.snapshot.phase,
    timerActive: turnTimer?.active ?? false
  })) startTurnTimer();
  render();
});

window.addEventListener('resize', resizeCanvas, { passive: true });
window.addEventListener('orientationchange', resizeCanvas, { passive: true });
if ('ResizeObserver' in window) {
  new ResizeObserver(resizeCanvas).observe(stageElement);
}

if (!gameShell.hidden) resizeCanvas();
updateStagePicker();
updateSavedGamePrompt();
updateTutorialVisibility();
renderPlayerNameState();
