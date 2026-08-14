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
import { StageController } from './application/stage-controller';
import { TurnTimer, formatRemainingSeconds, timerDurationMs } from './application/turn-timer';
import type { CandidateSlot, StageTimerMode } from './domain/stage-replay';
import { getStageObjectiveProgress } from './domain/stage-session';
import type { StageExecution, StageTracePhase } from './domain/stage-session';
import { BUILT_IN_STAGES, getBuiltInStage } from './domain/stages';
import type { ValidatedStageDefinition } from './domain/stage-definition';
import { createIsometricLayout, hitTestCell } from './presentation/isometric';
import { PointerController } from './presentation/pointer-controller';
import { renderIsometricBoard } from './presentation/board-renderer';
import { buildStageProjection, riskLabel } from './presentation/stage-projection';
import {
  resultCauseText,
  resultFirstBreakText,
  resultImprovementHint
} from './presentation/result-feedback';
import { TracePlayback, tracePlaybackDurations } from './presentation/trace-playback';
import type { TracePlaybackFrame } from './presentation/trace-playback';
import type { IsometricLayout } from './presentation/isometric';

const root = document.querySelector<HTMLDivElement>('#app');
if (root === null) throw new Error('app root is missing');
const appRoot = root;
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

const stage = getBuiltInStage('stage-01-first-pond');
if (stage === undefined) throw new Error('built-in stage-01-first-pond is missing');
let progress = readProgress();
let currentStage = getBuiltInStage(progress.lastStageId) ?? stage;

function stageObjectiveText(definition: ValidatedStageDefinition): string {
  switch (definition.objective.type) {
    case 'stored-water': return `水を${definition.objective.target}ためる`;
    case 'safe-drain': return `安全排水を${definition.objective.target}つくる`;
    case 'protect': return `保護対象を${definition.objective.target}回守る`;
  }
}

function stageNumber(definition: ValidatedStageDefinition): number {
  const match = /^stage-(\d+)/u.exec(definition.id);
  return Number(match?.[1] ?? 0);
}

const stageOptionsMarkup = BUILT_IN_STAGES.map((definition) => `
  <button class="stage-option" type="button" data-stage-id="${definition.id}" aria-pressed="${definition.id === currentStage.id}">
    <span class="stage-option-number">ステージ${stageNumber(definition)}</span>
    <strong>${definition.name}</strong>
    <small>${stageObjectiveText(definition)}</small>
  </button>
`).join('');

let controller = new StageController(currentStage, progress.timerMode);
appRoot.innerHTML = `
  <section class="start-panel" id="start-panel" aria-labelledby="start-title">
    <div class="start-card">
      <p class="eyebrow">水を読む、地形を組む、街を守る</p>
      <h1 id="start-title">ナガシマス</h1>
      <p class="start-lead">次の雨を見て、2つの施工候補から1つを選びます。盤面をタップして仮置きし、結果を確認してから確定します。</p>
      <section class="tutorial-card" aria-labelledby="tutorial-title">
        <div class="tutorial-heading">
          <h2 id="tutorial-title">遊び方</h2>
          <button class="tutorial-toggle" id="tutorial-toggle" type="button" aria-controls="tutorial-steps" aria-expanded="true">閉じる</button>
        </div>
        <ol id="tutorial-steps">
          <li><strong>候補を選ぶ</strong><span>上げる・下げる候補を比べます。</span></li>
          <li><strong>仮置きして読む</strong><span>盤面をタップすると、雨と次の水流を予測します。</span></li>
          <li><strong>確定する</strong><span>回転や取消を使い、納得してから施工確定を押します。</span></li>
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
        <button class="start-button" id="start-game" type="button">このステージを始める</button>
      </section>
    </div>
  </section>
  <main class="game-shell" id="game-shell" aria-label="ナガシマス" hidden>
    <header class="game-header">
      <div>
        <h1 class="game-title" id="game-title"></h1>
        <p class="game-objective" id="objective"></p>
        <p class="forecast-line" id="forecast"></p>
        <p class="game-risk" id="risk"></p>
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
      <section class="pause-panel" id="pause-panel" hidden aria-live="polite">
        <h2>一時停止中</h2>
        <p id="pause-message">再開すると、残り時間から続けます。</p>
        <button id="resume" type="button">再開</button>
      </section>
    </section>
    <section class="game-controls" aria-label="施工操作">
      <div class="candidate-row">
        <button class="candidate-card" id="candidate-a" type="button" aria-pressed="true"></button>
        <button class="candidate-card" id="candidate-b" type="button" aria-pressed="false"></button>
      </div>
      <div class="action-row">
        <button id="rotate" type="button">回転</button>
        <button id="cancel" type="button">取消</button>
        <button id="confirm" type="button">施工確定</button>
        <button id="skip" type="button">見送り</button>
        <button id="undo" type="button">Undo</button>
      </div>
      <p class="game-message" id="message" role="status" aria-live="polite"></p>
      <section class="result-panel" id="result-panel" hidden aria-live="polite">
        <h2 id="result-title"></h2>
        <p id="result-summary"></p>
        <p id="result-first-break"></p>
        <p id="result-cause"></p>
        <p id="result-score"></p>
        <p id="result-reasons"></p>
        <p class="result-hint" id="result-hint"></p>
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
const startPanel = required<HTMLElement>('#start-panel');
const gameShell = required<HTMLElement>('#game-shell');
const gameTitleElement = required<HTMLElement>('#game-title');
const tutorialSteps = required<HTMLOListElement>('#tutorial-steps');
const tutorialToggle = required<HTMLButtonElement>('#tutorial-toggle');
const stageSummaryElement = required<HTMLElement>('#stage-summary');
const startGameButton = required<HTMLButtonElement>('#start-game');
const timerModeSelect = required<HTMLSelectElement>('#timer-mode');
const playbackSpeedSelect = required<HTMLSelectElement>('#playback-speed');
const playbackSpeedHelp = required<HTMLElement>('#playback-speed-help');
const stageMenuButton = required<HTMLButtonElement>('#stage-menu');
const stageOptionButtons = Array.from(
  appRoot.querySelectorAll<HTMLButtonElement>('.stage-option')
);
const objectiveElement = required<HTMLElement>('#objective');
const forecastElement = required<HTMLElement>('#forecast');
const riskElement = required<HTMLElement>('#risk');
const turnElement = required<HTMLElement>('#turn');
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
const retryButton = required<HTMLButtonElement>('#retry');
const timerElement = required<HTMLElement>('#timer');
const pauseButton = required<HTMLButtonElement>('#pause');
const pausePanel = required<HTMLElement>('#pause-panel');
const pauseMessage = required<HTMLElement>('#pause-message');
const resumeButton = required<HTMLButtonElement>('#resume');

let layout: IsometricLayout | null = null;
let lastMessage = '盤面をタップして仮置きし、内容を確認してから施工確定を押してください。';
let playback: TracePlayback | null = null;
let selectedStageId = currentStage.id;
let selectedTimerMode: StageTimerMode = progress.timerMode;
let selectedPlaybackSpeed: ProgressPlaybackSpeed = progress.playbackSpeed;
let paused = false;
let pageHidden = document.hidden;
let turnTimer: TurnTimer | null = null;
const PLAYBACK_SPEED_UNLOCK_STAGE_ID = 'stage-02-open-to-sea';

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
  for (const button of stageOptionButtons) {
    button.setAttribute('aria-pressed', String(button.dataset['stageId'] === selected.id));
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
  const execution = controller.timeout();
  if (execution.accepted) {
    lastMessage = '時間切れのため、施工を見送って水を進めます。';
    startPlayback(execution);
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

function startSelectedStage(): void {
  const selected = getBuiltInStage(selectedStageId);
  if (selected === undefined) return;
  playback?.cancel();
  playback = null;
  stopTurnTimer();
  paused = false;
  pausePanel.hidden = true;
  currentStage = selected;
  persistProgress(markTutorialSeen(setLastStageId(progress, selected.id)));
  updateTutorialVisibility();
  controller = new StageController(currentStage, selectedTimerMode);
  lastMessage = '盤面をタップして仮置きし、内容を確認してから施工確定を押してください。';
  startPanel.hidden = true;
  gameShell.hidden = false;
  resizeCanvas();
  startTurnTimer();
}

function showStagePicker(): void {
  if (playback !== null) return;
  stopTurnTimer();
  paused = false;
  pausePanel.hidden = true;
  controller.cancelPlacement();
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

function failureReasonText(reason: string): string {
  const labels: Readonly<Record<string, string>> = {
    'danger-leak': '危険側へ流出しました',
    'protected-overflow': '保護対象が浸水しました',
    'objective-not-met': 'ステージの目的を達成できませんでした'
  };
  return labels[reason] ?? reason;
}

function startPlayback(execution: StageExecution): void {
  stopTurnTimer();
  playback?.cancel();
  playback = new TracePlayback(execution.trace, {
    onFrame: () => render(),
    onComplete: () => {
      playback = null;
      if (!paused && !pageHidden && controller.view.snapshot.phase === 'awaiting-turn') {
        startTurnTimer();
      }
      if (controller.view.snapshot.phase === 'cleared') {
        const score = controller.view.snapshot.score;
        persistProgress(recordClearedStage(progress, currentStage.id, {
          total: score.total,
          grade: score.grade
        }));
      }
      render();
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
  layout = createIsometricLayout(width, height, { padding: 16 });
  render();
}

function localPoint(clientX: number, clientY: number): { readonly x: number; readonly y: number } {
  const bounds = canvas.getBoundingClientRect();
  return Object.freeze({ x: clientX - bounds.left, y: clientY - bounds.top });
}

function selectCellAt(clientX: number, clientY: number): void {
  if (layout === null || playback !== null) return;
  const point = localPoint(clientX, clientY);
  const cell = hitTestCell(layout, controller.view.snapshot.board, point.x, point.y);
  if (cell !== null) {
    controller.setAnchor(cell);
    lastMessage = `セル${cell + 1}に仮置きしました。施工確定で手番が進みます。`;
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

function render(): void {
  const currentLayout = layout;
  if (currentLayout === null) return;
  const view = controller.view;
  const playbackFrame: TracePlaybackFrame | null = playback?.frame ?? null;
  const locked = playback !== null || paused;
  const projection = buildStageProjection(
    currentStage,
    view.snapshot,
    view.forecasts,
    view.preview
  );
  renderIsometricBoard(canvasContext, view.snapshot.board, currentLayout, {
    selectedCell: view.pending?.anchorIndex ?? null,
    preview: view.preview,
    activePlacementCells: playbackFrame?.event?.placementCells ?? [],
    flowResult: playbackFrame?.event?.flowResult ?? null,
    rainCells: playbackFrame?.event?.rainCells ?? [],
    forecastCells: projection.forecastCells,
    riskCells: projection.risks,
    playbackProgress: playbackFrame?.progress ?? null,
    reducedMotion: reducedMotionQuery.matches
  });

  const progress = getStageObjectiveProgress(currentStage, view.snapshot.board, view.snapshot.metrics);
  gameTitleElement.textContent = `ナガシマス — ${currentStage.name}`;
  const phaseText = playbackFrame?.phase === null || playbackFrame?.phase === undefined
    ? terminalPhaseLabel(view.snapshot.phase)
    : phaseLabel(playbackFrame.phase, playbackFrame.event?.flowStep ?? null);
  objectiveElement.textContent = `目的: ${progress.value} / ${progress.target}（${phaseText}）`;
  const forecastText = view.forecasts.length === 0
    ? '雨予報: なし'
    : `雨予報: ${projection.forecasts.map((forecast) => `あと${forecast.turnsUntil}手・${forecast.totalAmount}・${forecast.cells.map((cell) => `セル${cell.index + 1}`).join('／')}`).join('、')}`;
  forecastElement.textContent = forecastText;
  turnElement.textContent = `手数 ${view.snapshot.completedTurns} / ${currentStage.maxTurns}`;
  const duration = thinkingDurationMs();
  const remaining = turnTimer?.remainingMs ?? null;
  const terminal = view.snapshot.phase !== 'awaiting-turn';
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

  const selectedRisk = view.pending === null
    ? null
    : projection.risks[view.pending.anchorIndex] ?? null;
  if (selectedRisk === null) {
    riskElement.textContent = '危険度: セルを選ぶと、雨と水流の理由を表示します。';
  } else {
    const reasons = selectedRisk.reasons.length > 0 ? selectedRisk.reasons.join('／') : '今の予測では大きな危険はありません';
    riskElement.textContent = `セル${selectedRisk.index + 1} 危険度: ${riskLabel(selectedRisk.level)} — ${reasons}`;
  }

  for (const card of view.candidates) {
    const button = candidateButtons[card.slot];
    button.textContent = `${card.slot === 0 ? '候補A' : '候補B'}: ${card.delta > 0 ? '上げる' : '下げる'}・${card.cellCount}セル`;
    button.title = `${card.pieceId} / token ${card.tokenId}`;
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
  if (terminal) {
    const resultInput = {
      phase: view.snapshot.phase,
      failureReasons: view.snapshot.failureReasons,
      metrics: view.snapshot.metrics,
      score: view.snapshot.score
    } as const;
    resultTitle.textContent = view.snapshot.phase === 'cleared' ? 'クリア' : '失敗';
    resultSummary.textContent = view.snapshot.phase === 'cleared'
      ? `目的 ${progress.value} / ${progress.target} を達成しました。`
      : '今回の手番では目標を守れませんでした。';
    const score = view.snapshot.score;
    resultFirstBreak.textContent = resultFirstBreakText(resultInput);
    resultCause.textContent = resultCauseText(resultInput);
    resultScore.textContent = `スコア ${score.total}（安全 ${score.safety}・効率 ${score.efficiency}・制御 ${score.control}）／評価 ${score.grade ?? '-'} `;
    resultReasons.textContent = view.snapshot.failureReasons.length === 0
      ? '危険を抑え、安全な流れを作れました。'
      : view.snapshot.failureReasons.map(failureReasonText).join('／');
    resultHint.textContent = resultImprovementHint(resultInput);
  }
  retryButton.disabled = locked;
  stageMenuButton.disabled = playback !== null;
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
    controller.cancelPlacement();
    lastMessage = '入力が取り消されたため、仮置きを解除しました。';
    render();
  }
});
pointerController.attach();

candidateButtons.forEach((button, slot) => {
  button.addEventListener('click', () => {
    if (playback !== null || paused) return;
    controller.selectCandidate(slot as CandidateSlot);
    lastMessage = `${slot === 0 ? '候補A' : '候補B'}を選択しました。`;
    render();
  });
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
  const execution = controller.confirm();
  if (execution === null) {
    lastMessage = '先に盤面へ候補を仮置きしてください。';
  } else if (execution.accepted) {
    lastMessage = '施工を確定しました。雨と水流を計算しました。';
    startPlayback(execution);
  } else {
    lastMessage = reasonText(execution.reason);
  }
  render();
});

skipButton.addEventListener('click', () => {
  if (playback !== null || paused) return;
  const execution = controller.skip();
  lastMessage = execution.accepted ? '施工を見送りました。' : reasonText(execution.reason);
  if (execution.accepted) startPlayback(execution);
  render();
});

undoButton.addEventListener('click', () => {
  if (playback !== null || paused) return;
  const execution = controller.undo();
  lastMessage = execution.accepted ? '直前の手を取り消しました。' : reasonText(execution.reason);
  if (execution.accepted) startPlayback(execution);
  render();
});

retryButton.addEventListener('click', () => {
  if (playback !== null || paused) return;
  stopTurnTimer();
  paused = false;
  pausePanel.hidden = true;
  controller = new StageController(currentStage, selectedTimerMode);
  lastMessage = '最初から再挑戦します。';
  startTurnTimer();
  render();
});

stageOptionButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const stageId = button.dataset['stageId'];
    if (stageId === undefined || getBuiltInStage(stageId) === undefined) return;
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
stageMenuButton.addEventListener('click', showStagePicker);

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
  }
});

window.addEventListener('resize', resizeCanvas, { passive: true });
window.addEventListener('orientationchange', resizeCanvas, { passive: true });
if ('ResizeObserver' in window) {
  new ResizeObserver(resizeCanvas).observe(stageElement);
}

if (!gameShell.hidden) resizeCanvas();
updateTutorialVisibility();
updateStagePicker();
