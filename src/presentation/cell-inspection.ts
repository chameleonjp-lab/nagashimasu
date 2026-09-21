import type { StageTurnPreview } from '../domain/stage-session';
import type { BoardSnapshot } from '../domain/types';
import { cellLabel } from './cell-label';
import type { StageCellRiskView } from './stage-projection';

export interface CellInspectionInput {
  readonly index: number;
  readonly board: Pick<BoardSnapshot, 'terrain' | 'water'>;
  readonly preview: StageTurnPreview | null;
  readonly risk: StageCellRiskView | null;
}

export interface CellInspectionText {
  readonly title: string;
  readonly current: string;
  readonly forecast: string;
  readonly risk: string;
}

function cellValue(values: readonly number[], index: number): number {
  const value = values[index] ?? 0;
  return Number.isFinite(value) ? value : 0;
}

/**
 * Formats the exact current and preview values for the selected cell.
 *
 * This is presentation-only. It deliberately consumes the authoritative
 * `StageTurnPreview` and projection reasons instead of running another flow
 * calculation or inferring a cause from colors.
 */
export function buildCellInspection(
  input: CellInspectionInput
): CellInspectionText | null {
  if (!Number.isSafeInteger(input.index) || input.index < 0 || input.index >= input.board.terrain.length) {
    return null;
  }

  const currentTerrain = cellValue(input.board.terrain, input.index);
  const currentWater = cellValue(input.board.water, input.index);
  const previewTerrain = input.preview === null
    ? currentTerrain
    : cellValue(input.preview.terrainAfterConstruction, input.index);
  const previewWater = input.preview === null
    ? null
    : cellValue(input.preview.boardAfterTurn.water, input.index);
  const forecastAmount = input.risk?.forecastAmount ?? 0;
  const reasons = input.risk?.reasons ?? [];

  return Object.freeze({
    title: `${cellLabel(input.index)}の確認`,
    current: `現在: 地形${currentTerrain}・水量${currentWater}`,
    forecast: previewWater === null
      ? '予測: この場所では候補を置けません'
      : `この手の予測: 地形${previewTerrain}・水量${previewWater}${forecastAmount > 0 ? `（次の雨${forecastAmount}）` : ''}`,
    risk: reasons.length > 0
      ? `危険理由: ${reasons.join('／')}`
      : '危険理由: 今の予測では大きな危険はありません'
  });
}
