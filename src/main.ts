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
import { finalizeClearedStage } from './application/clear-progress';
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
import type {
  CandidateSlot,
  StageRotation,
  StageTimerMode
} from './domain/stage-replay';
import { getStageObjectiveProgress } from './domain/stage-session';
import type {
  StageExecution,
  StageTurnPreview
} from './domain/stage-session';
import type { BoardSnapshot } from './domain/types';
import { BUILT_IN_STAGES, getBuiltInStage } from './domain/stages';
import type { ValidatedStageDefinition } from './domain/stage-definition';
import { PointerController } from './presentation/pointer-controller';
import { waterVisualCapForStage } from './presentation/board-visuals';
import type {
  BoardRenderOptions,
  ConstructionVisual
} from './presentation/board-view-contract';
import { buildStageProjection, riskLabel } from './presentation/stage-projection';
import { buildStagePreviewSummary } from './presentation/stage-preview';
import { firstActionGuideText } from './presentation/first-action-guide';
import {
  failureReasonText,
  playbackGuideText,
  rejectionReasonText,
  resultVisualText
} from './presentation/game-copy';
import { mobileControlsFocusTarget } from './presentation/mobile-controls-focus';
import { mobileControlsAccessibilityState } from './presentation/mobile-controls-a11y';
import { buildAppMarkup } from './presentation/app-markup';
import {
  objectiveProgressTitle,
  phaseLabel,
  stageGoalExplanation,
  stageNumber,
  stageObjectiveText,
  terminalPhaseLabel
} from './presentation/stage-copy';
import { renderCandidateCard } from './presentation/candidate-card-dom';
import { renderCellPicker } from './presentation/cell-picker-dom';
import { cellLabel } from './presentation/cell-label';
import {
  resultCauseText,
  resultFirstBreakText,
  resultImprovementHint
} from './presentation/result-feedback';
import { resultScoreGuideText } from './presentation/result-score-guide';
import {
  buildTurnOutcomeSummary
} from './presentation/turn-outcome';
import type { TurnOutcomeSummary } from './presentation/turn-outcome';
import { TracePlayback, tracePlaybackDurations } from './presentation/trace-playback';
import type { TracePlaybackFrame } from './presentation/trace-playback';
import { normalizeBoardRotation } from './presentation/three-board-math';
import type { BoardRotation } from './presentation/three-board-math';
import type { ThreeBoardView } from './presentation/three-board-view';

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

const cellPickerMarkup = Array.from(
  { length: CELL_COUNT },
  (_, index) => `<button class="cell-picker-cell" type="button" data-cell-index="${index}" aria-pressed="false" disabled>${cellLabel(index)}</button>`
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
appRoot.innerHTML = buildAppMarkup({
  stageName: currentStage.name,
  stageGoal: stageGoalExplanation(currentStage),
  stageOptionsMarkup,
  cellPickerMarkup,
  labUrl: LAB_URL
});

function required<T extends Element>(selector: string): T {
  const element = appRoot.querySelector<T>(selector);
  if (element === null) throw new Error(`missing element ${selector}`);
  return element;
}

const canvas = required<HTMLCanvasElement>('#board');
const stageElement = required<HTMLElement>('.game-stage');
const boardViewStateElement = required<HTMLElement>('#board-view-state');
const boardViewStateText = required<HTMLElement>('#board-view-state-text');
const boardViewStateHelp = required<HTMLElement>('#board-view-state-help');
const boardViewRetryButton = required<HTMLButtonElement>('#board-view-retry');
const boardViewStageMenuButton = required<HTMLButtonElement>('#board-view-stage-menu');
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
const pendingClearSaveSummary = required<HTMLElement>('#pending-clear-save-summary');
const pendingClearSaveRetryButton = required<HTMLButtonElement>('#pending-clear-save-retry');
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
const previewResultElement = required<HTMLElement>('#preview-result');
const turnOutcomeElement = required<HTMLElement>('#turn-outcome');
const turnOutcomeConstructionElement = required<HTMLElement>('#turn-outcome-construction');
const turnOutcomeRainElement = required<HTMLElement>('#turn-outcome-rain');
const turnOutcomeFlowElement = required<HTMLElement>('#turn-outcome-flow');
const turnOutcomeResultElement = required<HTMLElement>('#turn-outcome-result');
const messageElement = required<HTMLElement>('#message');
const progressSaveStatus = required<HTMLElement>('#progress-save-status');
const progressSaveStatusText = required<HTMLElement>('#progress-save-status-text');
const progressSaveRetryButton = required<HTMLButtonElement>('#progress-save-retry');
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
const resultScoreGuide = required<HTMLElement>('#result-score-guide');
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

let boardView: ThreeBoardView | null = null;
let boardViewLoading: Promise<ThreeBoardView | null> | null = null;
let boardViewState: 'ready' | 'loading' | 'error' | 'context-lost' = 'ready';
let boardViewInputLocked = false;
let timerPausedForBoardRecovery = false;
let playbackPausedForBoardRecovery = false;
let cameraRotation: BoardRotation = 0;
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

interface PendingClearSave {
  readonly stageId: string;
  readonly result: {
    readonly total: number;
    readonly grade: 'S' | 'A' | 'B' | 'C' | null;
  };
  readonly stageSave: StageSaveV1 | null;
}

// A failed write stays attached to the exact clear that produced it. This
// lets a later settings write or explicit retry safely persist it without
// allowing a delayed playback callback from another session to reuse it.
const pendingClearSaves = new Map<string, PendingClearSave>();
let sessionId = 0;
let playbackId = 0;

interface RankingRow {
  readonly display_name?: unknown;
  readonly player_name?: unknown;
  readonly score?: unknown;
  readonly best_score?: unknown;
}

function setBoardViewState(nextState: typeof boardViewState, message = ''): void {
  boardViewState = nextState;
  boardViewStateElement.hidden = nextState === 'ready';
  boardViewStateElement.dataset['state'] = nextState;
  boardViewStateText.textContent = message;
  const showActions = nextState === 'error' || nextState === 'context-lost';
  boardViewStateHelp.hidden = !showActions;
  boardViewRetryButton.hidden = !showActions;
  boardViewStageMenuButton.hidden = !showActions;
}

function handleBoardViewContextLost(): void {
  boardViewInputLocked = true;
  timerPausedForBoardRecovery = !paused && (turnTimer?.active ?? false);
  if (timerPausedForBoardRecovery) turnTimer?.pause();
  playbackPausedForBoardRecovery = playback?.active ?? false;
  if (playbackPausedForBoardRecovery) playback?.pause();
  setBoardViewState('context-lost', '3D表示が中断されました');
  render();
}

function handleBoardViewContextRestored(): void {
  boardViewInputLocked = false;
  setBoardViewState('ready');
  continueAfterBoardReady(boardView);
  render();
}

function handleBoardViewInitializationError(_error: unknown): void {
  boardViewInputLocked = true;
  setBoardViewState('error', '3D表示を開始できませんでした');
}

function ensureBoardView(): Promise<ThreeBoardView | null> {
  if (boardView !== null && boardViewState === 'ready') {
    resizeCanvas();
    return Promise.resolve(boardView);
  }
  if (boardView !== null && boardViewState === 'context-lost') {
    return Promise.resolve(boardView);
  }
  if (boardViewLoading !== null) return boardViewLoading;

  setBoardViewState('loading', '3D盤面を準備中…');
  const loading = import('./presentation/three-board-view')
    .then(({ ThreeBoardView }) => {
      if (boardView === null) {
        boardView = new ThreeBoardView(canvas, {
          onInitializationError: handleBoardViewInitializationError,
          onContextLost: handleBoardViewContextLost,
          onContextRestored: handleBoardViewContextRestored,
          onCameraFrame: render
        });
      }
      boardViewInputLocked = false;
      setBoardViewState('ready');
      resizeCanvas();
      return boardView;
    })
    .catch((error: unknown) => {
      handleBoardViewInitializationError(error);
      render();
      return null;
    })
    .finally(() => {
      boardViewLoading = null;
    });
  boardViewLoading = loading;
  return loading;
}

function ensureBoardAndStartTimer(): void {
  void ensureBoardView().then(continueAfterBoardReady);
}

function continueAfterBoardReady(view: ThreeBoardView | null): void {
  if (playbackPausedForBoardRecovery) {
    playbackPausedForBoardRecovery = false;
    playback?.resume();
  }
  if (
    view === null ||
    gameShell.hidden ||
    paused ||
    pageHidden ||
    playback !== null ||
    boardViewInputLocked
  ) return;
  if (timerPausedForBoardRecovery && turnTimer?.paused) {
    timerPausedForBoardRecovery = false;
    turnTimer.resume();
    if (mobileControlsOpen) window.requestAnimationFrame(focusMobileControls);
    return;
  }
  timerPausedForBoardRecovery = false;
  if (controller.view.snapshot.phase === 'awaiting-turn') startTurnTimer();
  if (mobileControlsOpen) window.requestAnimationFrame(focusMobileControls);
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

function focusMobileControls(): void {
  if (!mobileControlsOpen || !isMobileViewport() || gameShell.hidden) return;
  const view = controller.view;
  const target = mobileControlsFocusTarget({
    phase: view.snapshot.phase,
    hasPendingPlacement: view.pending !== null,
    selectedCandidateSlot: view.candidates.find((candidate) => candidate.selected)?.slot ?? null,
    boardReady: boardViewState === 'ready',
    inputLocked: boardViewInputLocked,
    playbackActive: playback !== null
  });
  const element = target === 'candidate-a'
    ? candidateButtons[0]
    : target === 'candidate-b'
      ? candidateButtons[1]
      : target === 'confirm'
        ? confirmButton
        : target === 'retry'
          ? retryButton
          : mobileControlsClose;
  element.focus({ preventScroll: true });
}

function syncMobileControlsAccessibility(): void {
  const state = mobileControlsAccessibilityState(isMobileViewport(), mobileControlsOpen);
  if (state.role === null) gameControls.removeAttribute('role');
  else gameControls.setAttribute('role', state.role);
  if (state.ariaHidden === null) gameControls.removeAttribute('aria-hidden');
  else gameControls.setAttribute('aria-hidden', String(state.ariaHidden));
  if (state.ariaModal === null) gameControls.removeAttribute('aria-modal');
  else gameControls.setAttribute('aria-modal', String(state.ariaModal));
  gameControls.toggleAttribute('inert', state.inert);
  mobileControlsToggle.setAttribute(
    'aria-expanded',
    String(isMobileViewport() && mobileControlsOpen)
  );
}

function focusableMobileControls(): readonly HTMLElement[] {
  return Array.from(gameControls.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
  )).filter((element) => !element.hidden && element.closest('[hidden]') === null);
}

function handleMobileControlsKeydown(event: KeyboardEvent): void {
  if (!mobileControlsOpen || !isMobileViewport()) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    setMobileControlsOpen(false);
    return;
  }
  if (event.key !== 'Tab') return;

  const focusable = focusableMobileControls();
  if (focusable.length === 0) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const active = document.activeElement;
  if (active === null || !gameControls.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function setMobileControlsOpen(open: boolean): void {
  const wasOpen = mobileControlsOpen;
  mobileControlsOpen = open;
  gameControls.classList.toggle('is-open', open);
  const mobile = isMobileViewport();
  mobileControlsBackdrop.hidden = !open || !mobile;
  document.body.classList.toggle('mobile-sheet-open', open && mobile);
  syncMobileControlsAccessibility();
  if (wasOpen && !open && mobile && gameShell.hidden === false) {
    window.requestAnimationFrame(() => mobileControlsToggle.focus({ preventScroll: true }));
  }
  if (!wasOpen && open && mobile && gameShell.hidden === false) {
    window.requestAnimationFrame(focusMobileControls);
  }
}

function cameraText(rotation: BoardRotation): string {
  return `盤面を見る向き ${rotation + 1} / 4`;
}

function setCameraRotation(nextRotation: number): void {
  cameraRotation = normalizeBoardRotation(nextRotation);
  cameraLabel.textContent = cameraText(cameraRotation);
  boardView?.setRotation(cameraRotation, {
    reducedMotion: reducedMotionQuery.matches,
    durationMs: 200
  });
}

function updateMobileStagePrompt(view: StageControllerView): void {
  if (!isMobileViewport()) {
    mobileStagePrompt.textContent = '';
    mobileControlsToggle.hidden = true;
    mobileControlsToggle.disabled = false;
    return;
  }
  mobileControlsToggle.hidden = false;
  mobileControlsToggle.disabled = playback !== null || boardViewState !== 'ready' || boardViewInputLocked;
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

function clearOwnedStageSave(save: StageSaveV1 | null): void {
  // A pending clear may outlive a retry or a stage switch. Only remove the
  // exact save that existed when that clear was attempted; a newer session's
  // stage-save must remain available for its own resume path.
  if (save === null || savedStageSave !== save) return;
  clearStageSave();
  if (savedStageSave === save) {
    savedStageSave = null;
    updateSavedGamePrompt();
  }
}

function settlePersistedClearSaves(): void {
  for (const [stageId, pending] of pendingClearSaves) {
    const saved = progress.stages.find((entry) => entry.stageId === stageId);
    if (saved === undefined || !saved.cleared) continue;
    clearOwnedStageSave(pending.stageSave);
    pendingClearSaves.delete(stageId);
  }
}

function persistProgress(next: typeof progress): boolean {
  progress = next;
  let saved = false;
  try {
    saved = writeProgress(progress);
  } catch {
    saved = false;
  }
  if (saved) settlePersistedClearSaves();
  updatePendingClearSaveUi();
  return saved;
}

function rememberPendingClearSave(
  stageId: string,
  result: PendingClearSave['result'],
  stageSave: StageSaveV1 | null
): void {
  const previous = pendingClearSaves.get(stageId);
  pendingClearSaves.set(stageId, Object.freeze({
    stageId,
    result,
    // Prefer the save belonging to the latest clear attempt. If that session
    // had no save of its own, retain the older fallback so a successful retry
    // can still clean it up safely by object identity.
    stageSave: stageSave ?? previous?.stageSave ?? null
  }));
  updatePendingClearSaveUi();
}

function updatePendingClearSaveUi(): void {
  const pending = [...pendingClearSaves.values()];
  const hasPending = pending.length > 0;
  const stageNames = pending
    .map((entry) => getBuiltInStage(entry.stageId)?.name ?? entry.stageId)
    .join('、');
  const message = hasPending
    ? `クリア結果（${stageNames}）を端末に保存できていません。現在の結果は保持しています。保存を再試行してください。`
    : '';
  pendingClearSaveSummary.hidden = !hasPending;
  pendingClearSaveSummary.textContent = message;
  pendingClearSaveRetryButton.hidden = !hasPending;
  pendingClearSaveRetryButton.disabled = !hasPending;
  progressSaveStatus.hidden = !hasPending;
  progressSaveStatusText.textContent = message;
  progressSaveRetryButton.hidden = !hasPending;
  progressSaveRetryButton.disabled = !hasPending;
}

function retryPendingClearSaves(): void {
  if (pendingClearSaves.size === 0) return;
  let next = progress;
  for (const pending of pendingClearSaves.values()) {
    // Reapply the accepted result to the latest in-memory progress so a
    // setting change or another session cannot discard an older clear.
    next = recordClearedStage(next, pending.stageId, pending.result);
  }
  persistProgress(next);
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
    lastMessage = rejectionReasonText(execution.reason);
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
    boardViewInputLocked ||
    boardView === null ||
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

function invalidatePlayback(): void {
  playbackId += 1;
  playback?.cancel();
  playback = null;
}

function beginNewSession(): void {
  sessionId += 1;
  invalidatePlayback();
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
  beginNewSession();
  activeConstructionVisual = null;
  activeTurnPlaybackVisual = null;
  stopTurnTimer();
  timerPausedForBoardRecovery = false;
  playbackPausedForBoardRecovery = false;
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
  ensureBoardAndStartTimer();
}

function startSelectedStage(): void {
  if (!requirePlayerName()) return;
  const selected = getBuiltInStage(selectedStageId);
  if (selected === undefined || !isStageUnlocked(selected.id, clearedStageIds(progress))) {
    updateStagePicker();
    return;
  }
  beginNewSession();
  activeConstructionVisual = null;
  activeTurnPlaybackVisual = null;
  stopTurnTimer();
  timerPausedForBoardRecovery = false;
  playbackPausedForBoardRecovery = false;
  paused = false;
  pausePanel.hidden = true;
  currentStage = selected;
  cameraRotation = 0;
  cameraLabel.textContent = cameraText(cameraRotation);
  if (
    savedStageSave?.replay.header.stageId === selected.id &&
    !pendingClearSaves.has(selected.id)
  ) {
    clearOwnedStageSave(savedStageSave);
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
  ensureBoardAndStartTimer();
}

function showStagePicker(force = false): void {
  if (playback !== null && !force) return;
  if (force && playback !== null) {
    invalidatePlayback();
    activeConstructionVisual = null;
    activeTurnPlaybackVisual = null;
    playbackPausedForBoardRecovery = false;
  }
  stopTurnTimer();
  timerPausedForBoardRecovery = false;
  playbackPausedForBoardRecovery = false;
  paused = false;
  pausePanel.hidden = true;
  controller.cancelPlacement();
  setMobileControlsOpen(false);
  gameShell.hidden = true;
  startPanel.hidden = false;
  updateStagePicker();
  updateTutorialVisibility();
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

function persistAcceptedClear(
  execution: StageExecution,
  stageSaveBeforeClear: StageSaveV1 | null
): boolean {
  const score = execution.snapshot.score;
  const result = {
    total: score.total,
    grade: score.grade
  } as const;
  const outcome = finalizeClearedStage({
    progress,
    stageId: execution.snapshot.stageId,
    result
  }, {
    saveProgress: persistProgress,
    clearStageSave: () => clearOwnedStageSave(stageSaveBeforeClear)
  });
  // persistProgress normally assigns this already, but keeping the outcome
  // explicit makes the adapter safe if a storage implementation throws before
  // it can update application state.
  progress = outcome.progress;
  // The clear is meaningful in the current session even when browser storage
  // is unavailable. Reflect the in-memory unlock immediately; the retry panel
  // separately communicates whether it has become durable.
  updateStagePicker();
  if (!outcome.saved) {
    rememberPendingClearSave(execution.snapshot.stageId, result, stageSaveBeforeClear);
  }
  updatePendingClearSaveUi();
  return outcome.saved;
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
    action = '仮置き中: 下のプレビューで、施工・雨・4回の水流後の見込みを確認してください。';
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
    const firstRainTurn = currentStage.rainEvents[0]?.turn ?? null;
    detail = `${firstActionGuideText(firstRainTurn, selectedCandidateLabel)} ${stageGoalExplanation(currentStage)}`;
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
  const currentSnapshot = controller.view.snapshot;
  if (
    execution.snapshot.stageId !== currentSnapshot.stageId ||
    execution.snapshot.revision !== currentSnapshot.revision ||
    execution.snapshot.stageId !== currentStage.id
  ) return;
  stopTurnTimer();
  setMobileControlsOpen(false);
  playbackId += 1;
  playback?.cancel();
  activeConstructionVisual = constructionVisual;
  activeTurnPlaybackVisual = turnPlaybackVisual;
  playbackPausedForBoardRecovery = false;
  const outcome = buildTurnOutcomeSummary({
    construction,
    trace: execution.trace,
    phase: execution.snapshot.phase
  });
  const stageSaveBeforePlayback =
    savedStageSave?.replay.header.stageId === execution.snapshot.stageId
      ? savedStageSave
      : null;
  if (execution.snapshot.phase === 'awaiting-turn') {
    persistSessionSave();
  } else if (execution.snapshot.phase === 'cleared') {
    // The accepted result is durable before any animation frame can run. A
    // failed write leaves the old resumable save and a visible retry affordance
    // in place for the current session.
    persistAcceptedClear(execution, stageSaveBeforePlayback);
  } else {
    clearOwnedStageSave(stageSaveBeforePlayback);
  }
  const activeSessionId = sessionId;
  const activePlaybackId = playbackId;
  let playbackInstance: TracePlayback;
  let completed = false;
  playbackInstance = new TracePlayback(execution.trace, {
    onFrame: () => {
      if (
        completed ||
        playbackId !== activePlaybackId ||
        sessionId !== activeSessionId ||
        playback !== playbackInstance
      ) return;
      render();
    },
    onComplete: () => {
      if (
        completed ||
        playbackId !== activePlaybackId ||
        sessionId !== activeSessionId ||
        playback !== playbackInstance
      ) return;
      completed = true;
      playback = null;
      playbackPausedForBoardRecovery = false;
      activeConstructionVisual = null;
      activeTurnPlaybackVisual = null;
      lastTurnOutcome = outcome;
      if (!paused && !pageHidden && controller.view.snapshot.phase === 'awaiting-turn') {
        startTurnTimer();
      }
      if (controller.view.snapshot.phase !== 'awaiting-turn') {
        setMobileControlsOpen(true);
      }
      render();
    }
  }, tracePlaybackDurations(
      playbackSpeedUnlocked() ? selectedPlaybackSpeed : 'standard'
  ));
  playback = playbackInstance;
  playbackInstance.start();
}

function resizeCanvas(): void {
  const bounds = stageElement.getBoundingClientRect();
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const devicePixelRatio = Math.min(2, window.devicePixelRatio || 1);
  boardView?.resize(width, height, devicePixelRatio);
  render();
}

function selectCellAt(clientX: number, clientY: number): void {
  if (
    boardView === null ||
    boardViewState !== 'ready' ||
    boardViewInputLocked ||
    playback !== null ||
    paused
  ) return;
  const view = controller.view;
  if (view.snapshot.phase !== 'awaiting-turn') return;
  const cell = boardView.pickCell(clientX, clientY, view.legalAnchorIndices);
  if (cell !== null) {
    controller.setAnchor(cell);
    lastMessage = `${cellLabel(cell)}に仮置きしました。施工確定で手番が進みます。`;
    if (isMobileViewport()) setMobileControlsOpen(true);
    render();
  }
}

function render(): void {
  const view = controller.view;
  const playbackFrame: TracePlaybackFrame | null = playback?.frame ?? null;
  const boardTransitioning = boardView?.isCameraTransitioning ?? false;
  const locked = playback !== null || paused || boardViewState !== 'ready' ||
    boardViewInputLocked || boardTransitioning;
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
  const boardOptions: BoardRenderOptions = {
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
    constructionVisual: activeConstructionVisual ?? constructionVisualForView(view),
    resultPhase: playback === null &&
      (view.snapshot.phase === 'cleared' || view.snapshot.phase === 'failed')
      ? view.snapshot.phase
      : null,
    resultText: resultVisualText(view.snapshot.phase, view.snapshot.failureReasons),
    objectiveProgress,
    objectiveLabel: objectiveProgressTitle(currentStage),
    storageCells,
    resultHighlightCells,
    labelCells,
    waterVisualCap: waterVisualCapForStage(currentStage),
    reducedMotion: reducedMotionQuery.matches
  };
  if (boardView !== null && boardViewState === 'ready') {
    boardView.render(board, boardOptions);
  }

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
    : `雨予報: ${projection.forecasts.map((forecast) => `あと${forecast.turnsUntil}手・${forecast.totalAmount}・${forecast.cells.map((cell) => cellLabel(cell.index)).join('／')}`).join('、')}`;
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
    riskElement.textContent = `${cellLabel(selectedRisk.index)} 危険度: ${riskLabel(selectedRisk.level)} — ${reasons}`;
  }

  previewSummaryElement.hidden = previewSummary === null;
  previewConstructionElement.textContent = previewSummary === null
    ? ''
    : `施工: ${previewSummary.construction}`;
  previewRainElement.textContent = previewSummary === null
    ? ''
    : `降雨: ${previewSummary.rain}`;
  previewFlowElement.textContent = previewSummary?.flow ?? '';
  previewResultElement.textContent = previewSummary?.result ?? '';

  constructionHelpElement.textContent = view.legalAnchorIndices.length > 0
    ? isMobileViewport()
      ? view.pending === null
        ? '候補を選び、「盤面へ戻る」→緑の丸（カードの◎）をタップします。座標でも選べます。'
        : '仮置きした場所を盤面で確認し、施工確定または取消を選びます。カードの◎が緑の丸です。'
      : `緑の丸（カードの◎）が、選んだ候補の基準セルです（${view.legalAnchorIndices.length}か所）。座標は予報と同じ表記です。`
    : '現在、選んだ候補を置ける場所はありません。見送りで水を進められます。';
  renderCellPicker(cellPickerHelpElement, cellPickerButtons, view, locked);

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
  const previewFailure = view.preview?.phase === 'failed';
  confirmButton.classList.toggle('preview-failure', previewFailure);
  if (previewFailure) confirmButton.setAttribute('aria-label', '施工確定（失敗見込み）');
  else confirmButton.removeAttribute('aria-label');
  skipButton.disabled = locked || view.snapshot.phase !== 'awaiting-turn';
  undoButton.disabled = locked || view.snapshot.undoUsed || view.snapshot.revision === 0;

  const validationMessage = view.validation?.valid === false
    ? rejectionReasonText(view.validation.reason)
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
    resultScoreGuide.textContent = resultScoreGuideText(currentStage);
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
  cameraLeftButton.disabled = locked;
  cameraRightButton.disabled = locked;
  cameraResetButton.disabled = locked;
  pauseButton.disabled = locked || view.snapshot.phase !== 'awaiting-turn';
  pauseButton.textContent = paused ? '再開' : '一時停止';
  pausePanel.hidden = !paused;
  resumeButton.disabled = pageHidden;
  updatePendingClearSaveUi();
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
    lastMessage = `${cellLabel(index)}に仮置きしました。施工確定で手番が進みます。`;
    render();
  });
});

cameraLeftButton.addEventListener('click', () => {
  setCameraRotation(cameraRotation - 1);
  lastMessage = '盤面を見る向きを左へ90度変えました。';
  render();
});

cameraRightButton.addEventListener('click', () => {
  setCameraRotation(cameraRotation + 1);
  lastMessage = '盤面を見る向きを右へ90度変えました。';
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

gameControls.addEventListener('keydown', handleMobileControlsKeydown);

rotateButton.addEventListener('click', () => {
  if (playback !== null || paused) return;
  controller.rotate();
  lastMessage = '工事パーツの向きを変えました。';
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
    lastMessage = rejectionReasonText(execution.reason);
  }
  render();
});

skipButton.addEventListener('click', () => {
  if (playback !== null || paused) return;
  const beforeView = controller.view;
  const turnPreview = controller.previewSkip();
  const execution = controller.skip();
  lastMessage = execution.accepted ? '施工を見送りました。' : rejectionReasonText(execution.reason);
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
  lastMessage = execution.accepted ? '直前の手を取り消しました。' : rejectionReasonText(execution.reason);
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
  beginNewSession();
  stopTurnTimer();
  timerPausedForBoardRecovery = false;
  playbackPausedForBoardRecovery = false;
  paused = false;
  pausePanel.hidden = true;
  if (!pendingClearSaves.has(currentStage.id)) {
    clearOwnedStageSave(savedStageSave?.replay.header.stageId === currentStage.id ? savedStageSave : null);
  }
  controller = new StageController(currentStage, selectedTimerMode);
  cameraRotation = 0;
  cameraLabel.textContent = cameraText(cameraRotation);
  activeConstructionVisual = null;
  activeTurnPlaybackVisual = null;
  lastTurnOutcome = null;
  lastMessage = 'まず緑の丸を1つ押して仮置きしてください。';
  setMobileControlsOpen(true);
  ensureBoardAndStartTimer();
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
pendingClearSaveRetryButton.addEventListener('click', () => {
  retryPendingClearSaves();
  render();
});
progressSaveRetryButton.addEventListener('click', () => {
  retryPendingClearSaves();
  render();
});
stageMenuButton.addEventListener('click', () => showStagePicker());
boardViewRetryButton.addEventListener('click', () => {
  if (boardViewLoading !== null) return;
  boardView?.destroy();
  boardView = null;
  boardViewInputLocked = true;
  ensureBoardAndStartTimer();
  render();
});
boardViewStageMenuButton.addEventListener('click', () => showStagePicker(true));
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

function handleViewportChange(): void {
  syncMobileControlsAccessibility();
  resizeCanvas();
}

window.addEventListener('resize', handleViewportChange, { passive: true });
window.addEventListener('orientationchange', handleViewportChange, { passive: true });
if ('ResizeObserver' in window) {
  new ResizeObserver(resizeCanvas).observe(stageElement);
}

if (!gameShell.hidden) resizeCanvas();
updateStagePicker();
updateSavedGamePrompt();
updateTutorialVisibility();
renderPlayerNameState();
syncMobileControlsAccessibility();
