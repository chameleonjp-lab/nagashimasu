import type { BoardSnapshot } from '../domain/types';
import type {
  BoardRenderOptions,
  ConstructionVisual,
  ObjectiveProgressVisual
} from './board-view-contract';
import type { ForecastCellView, StageCellRiskView } from './stage-projection';
import type { StageTracePhase, StageTurnPreview } from '../domain/stage-session';
import type { FlowStepResult, RainEvent } from '../domain/types';

export interface ThreeBoardFrame {
  readonly terrain: readonly number[];
  readonly water: readonly number[];
  readonly cellFlags: readonly number[];
  readonly safeEdgeMask: readonly number[];
  readonly dangerEdgeMask: readonly number[];
  readonly selectedCell: number | null;
  readonly preview: StageTurnPreview | null;
  readonly constructionAnchorCells: readonly number[];
  readonly activePlacementCells: readonly number[];
  readonly previewFlow: FlowStepResult | null;
  /** Last preview step, which matches the preview's final board snapshot. */
  readonly previewFinalFlow: FlowStepResult | null;
  readonly activeFlow: FlowStepResult | null;
  readonly rainCells: readonly RainEvent[];
  readonly forecastCells: readonly ForecastCellView[];
  readonly riskCells: readonly StageCellRiskView[];
  readonly playbackProgress: number | null;
  readonly phase: StageTracePhase | null;
  readonly constructionVisual: ConstructionVisual | null;
  readonly resultPhase: 'cleared' | 'failed' | null;
  readonly resultText: string;
  readonly objectiveLabel: string;
  readonly objectiveProgress: ObjectiveProgressVisual | null;
  readonly storageCells: readonly number[];
  readonly resultHighlightCells: readonly number[];
  readonly labelCells: readonly number[] | null;
  readonly reducedMotion: boolean;
  readonly background: string;
}

function frozenNumbers(values: readonly number[] | undefined): readonly number[] {
  return Object.freeze([...(values ?? [])]);
}

function frozenRain(values: readonly RainEvent[]): readonly RainEvent[] {
  return Object.freeze(values.map((cell) => Object.freeze({
    index: cell.index,
    amount: cell.amount
  })));
}

function frozenForecast(values: readonly ForecastCellView[] | undefined): readonly ForecastCellView[] {
  return Object.freeze([...(values ?? [])]);
}

function frozenRisks(values: readonly StageCellRiskView[] | undefined): readonly StageCellRiskView[] {
  return Object.freeze([...(values ?? [])]);
}

/**
 * Chooses which already-computed board evidence is visible in one frame.
 * Nothing here advances a turn, calculates water, or decides a result.
 */
export function buildThreeBoardFrame(
  snapshot: BoardSnapshot,
  options: BoardRenderOptions = {}
): ThreeBoardFrame {
  const preview = options.preview ?? null;
  const constructionVisual = options.constructionVisual ?? null;
  const terrain = constructionVisual?.terrainAfter ??
    preview?.terrainAfterConstruction ?? snapshot.terrain;
  const water = preview?.boardAfterTurn.water ?? snapshot.water;
  const activeFlow = options.flowResult ?? null;
  const previewFlow = activeFlow === null && preview?.valid === true ? preview.nextFlow : null;
  const previewFinalFlow = activeFlow === null && preview?.valid === true
    ? preview.flowSteps[preview.flowSteps.length - 1] ?? previewFlow
    : null;
  const activeRain = frozenRain(options.rainCells ?? []);
  const previewRain = preview?.valid === true ? preview.rainCells : [];
  const rainCells = activeRain.length > 0 ? activeRain : frozenRain(previewRain);
  const objectiveProgress = options.objectiveProgress === undefined ||
    options.objectiveProgress === null
    ? null
    : Object.freeze({
        value: options.objectiveProgress.value,
        target: options.objectiveProgress.target
      });

  return Object.freeze({
    terrain: Object.freeze([...terrain]),
    water: Object.freeze([...water]),
    cellFlags: Object.freeze([...snapshot.cellFlags]),
    safeEdgeMask: Object.freeze([...snapshot.safeEdgeMask]),
    dangerEdgeMask: Object.freeze([...snapshot.dangerEdgeMask]),
    selectedCell: options.selectedCell ?? null,
    preview,
    constructionAnchorCells: frozenNumbers(options.constructionAnchorCells),
    activePlacementCells: frozenNumbers(options.activePlacementCells),
    previewFlow,
    previewFinalFlow,
    activeFlow,
    rainCells,
    forecastCells: frozenForecast(options.forecastCells),
    riskCells: frozenRisks(options.riskCells),
    playbackProgress: options.playbackProgress ?? null,
    phase: options.phase ?? null,
    constructionVisual,
    resultPhase: options.resultPhase ?? null,
    resultText: options.resultText ?? '結果を確認してください',
    objectiveLabel: options.objectiveLabel ?? '目標',
    objectiveProgress,
    storageCells: frozenNumbers(options.storageCells),
    resultHighlightCells: frozenNumbers(options.resultHighlightCells),
    labelCells: options.labelCells === undefined
      ? null
      : frozenNumbers(options.labelCells),
    reducedMotion: options.reducedMotion ?? false,
    background: options.background ?? '#071521'
  });
}
