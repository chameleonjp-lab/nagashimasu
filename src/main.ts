import './styles.css';

import { StageController } from './application/stage-controller';
import type { CandidateSlot } from './domain/stage-replay';
import { getStageObjectiveProgress } from './domain/stage-session';
import { getBuiltInStage } from './domain/stages';
import { createIsometricLayout, hitTestCell } from './presentation/isometric';
import { PointerController } from './presentation/pointer-controller';
import { renderIsometricBoard } from './presentation/board-renderer';
import { buildStageProjection, riskLabel } from './presentation/stage-projection';
import type { IsometricLayout } from './presentation/isometric';

const root = document.querySelector<HTMLDivElement>('#app');
if (root === null) throw new Error('app root is missing');
const appRoot = root;

const stage = getBuiltInStage('stage-01-first-pond');
if (stage === undefined) throw new Error('built-in stage-01-first-pond is missing');
const currentStage = stage;

const controller = new StageController(currentStage);
appRoot.innerHTML = `
  <main class="game-shell" aria-label="ナガシマス">
    <header class="game-header">
      <div>
        <h1 class="game-title">ナガシマス — はじめの池</h1>
        <p class="game-objective" id="objective"></p>
        <p class="forecast-line" id="forecast"></p>
        <p class="game-risk" id="risk"></p>
      </div>
      <p class="game-turn" id="turn"></p>
    </header>
    <section class="game-stage" aria-label="治水盤面">
      <canvas class="game-canvas" id="board" aria-label="8×8の治水盤面"></canvas>
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

let layout: IsometricLayout | null = null;
let lastMessage = '盤面をタップして仮置きし、内容を確認してから施工確定を押してください。';

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
  if (layout === null) return;
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
  const projection = buildStageProjection(
    currentStage,
    view.snapshot,
    view.forecasts,
    view.preview
  );
  renderIsometricBoard(canvasContext, view.snapshot.board, currentLayout, {
    selectedCell: view.pending?.anchorIndex ?? null,
    preview: view.preview,
    forecastCells: projection.forecastCells,
    riskCells: projection.risks
  });

  const progress = getStageObjectiveProgress(currentStage, view.snapshot.board, view.snapshot.metrics);
  objectiveElement.textContent = `目的: ${progress.value} / ${progress.target}（${view.snapshot.phase === 'awaiting-turn' ? '継続中' : view.snapshot.phase}）`;
  const forecastText = view.forecasts.length === 0
    ? '雨予報: なし'
    : `雨予報: ${projection.forecasts.map((forecast) => `あと${forecast.turnsUntil}手・${forecast.totalAmount}・${forecast.cells.map((cell) => `セル${cell.index + 1}`).join('／')}`).join('、')}`;
  forecastElement.textContent = forecastText;
  turnElement.textContent = `手数 ${view.snapshot.completedTurns} / ${currentStage.maxTurns}`;

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
  }

  const hasPending = view.pending !== null;
  rotateButton.disabled = !hasPending;
  cancelButton.disabled = !hasPending;
  confirmButton.disabled = view.preview === null;
  skipButton.disabled = view.snapshot.phase !== 'awaiting-turn';
  undoButton.disabled = view.snapshot.undoUsed || view.snapshot.revision === 0;

  const validationMessage = view.validation?.valid === false
    ? reasonText(view.validation.reason)
    : '';
  messageElement.textContent = validationMessage || lastMessage;
}

const pointerController = new PointerController(canvas, {
  onStart: (data) => selectCellAt(data.clientX, data.clientY),
  onMove: (data) => selectCellAt(data.clientX, data.clientY),
  onEnd: () => render(),
  onCancel: () => {
    controller.cancelPlacement();
    lastMessage = '入力が取り消されたため、仮置きを解除しました。';
    render();
  }
});
pointerController.attach();

candidateButtons.forEach((button, slot) => {
  button.addEventListener('click', () => {
    controller.selectCandidate(slot as CandidateSlot);
    lastMessage = `${slot === 0 ? '候補A' : '候補B'}を選択しました。`;
    render();
  });
});

rotateButton.addEventListener('click', () => {
  controller.rotate();
  lastMessage = '仮置きの向きを回転しました。';
  render();
});

cancelButton.addEventListener('click', () => {
  controller.cancelPlacement();
  lastMessage = '仮置きを取り消しました。';
  render();
});

confirmButton.addEventListener('click', () => {
  const execution = controller.confirm();
  if (execution === null) {
    lastMessage = '先に盤面へ候補を仮置きしてください。';
  } else if (execution.accepted) {
    lastMessage = '施工を確定しました。雨と水流を計算しました。';
  } else {
    lastMessage = reasonText(execution.reason);
  }
  render();
});

skipButton.addEventListener('click', () => {
  const execution = controller.skip();
  lastMessage = execution.accepted ? '施工を見送りました。' : reasonText(execution.reason);
  render();
});

undoButton.addEventListener('click', () => {
  const execution = controller.undo();
  lastMessage = execution.accepted ? '直前の手を取り消しました。' : reasonText(execution.reason);
  render();
});

window.addEventListener('resize', resizeCanvas, { passive: true });
window.addEventListener('orientationchange', resizeCanvas, { passive: true });
if ('ResizeObserver' in window) {
  new ResizeObserver(resizeCanvas).observe(stageElement);
}

resizeCanvas();
