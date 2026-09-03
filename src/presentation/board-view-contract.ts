import type { StageTracePhase, StageTurnPreview } from '../domain/stage-session';
import type { BoardSnapshot, FlowStepResult, RainEvent } from '../domain/types';
import type { ForecastCellView, StageCellRiskView } from './stage-projection';

/** The visual representation of one accepted construction. */
export interface ConstructionVisual {
  readonly placementCells: readonly number[];
  readonly terrainBefore: readonly number[];
  readonly terrainAfter: readonly number[];
  readonly delta: number;
}

export interface ObjectiveProgressVisual {
  readonly value: number;
  readonly target: number;
}

/**
 * Presentation-only input for the board view.
 *
 * This contract deliberately contains evidence produced by the domain and
 * application layers. It does not contain callbacks for changing game state,
 * and it does not depend on Three.js, the DOM, or Canvas.
 */
export interface BoardRenderOptions {
  readonly selectedCell?: number | null;
  readonly preview?: StageTurnPreview | null;
  readonly constructionAnchorCells?: readonly number[];
  readonly activePlacementCells?: readonly number[];
  readonly flowResult?: FlowStepResult | null;
  readonly rainCells?: readonly RainEvent[];
  readonly forecastCells?: readonly ForecastCellView[];
  readonly riskCells?: readonly StageCellRiskView[];
  readonly playbackProgress?: number | null;
  readonly phase?: StageTracePhase | null;
  readonly constructionVisual?: ConstructionVisual | null;
  readonly resultPhase?: 'cleared' | 'failed' | null;
  readonly resultText?: string;
  readonly objectiveLabel?: string;
  readonly objectiveProgress?: ObjectiveProgressVisual | null;
  readonly storageCells?: readonly number[];
  readonly resultHighlightCells?: readonly number[];
  /** When supplied, only these logical cells receive a number label. */
  readonly labelCells?: readonly number[];
  readonly reducedMotion?: boolean;
  readonly background?: string;
}

/** A stable input snapshot for pure frame tests and the WebGL view. */
export interface BoardViewInput {
  readonly snapshot: BoardSnapshot;
  readonly options: BoardRenderOptions;
}
