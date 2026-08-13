import { CellFlag } from '../domain/constants';
import type { ValidatedStageDefinition } from '../domain/stage-definition';
import type { StageRainForecast, StageSessionSnapshot, StageTurnPreview } from '../domain/stage-session';
import type { FlowStepResult, RainEvent, WaterTransfer } from '../domain/types';

export type StageRiskLevel = 'safe' | 'caution' | 'danger' | 'critical';

export interface ForecastCellView extends RainEvent {
  readonly eventIndex: number;
  readonly turn: number;
  readonly turnsUntil: number;
}

export interface StageForecastView {
  readonly eventIndex: number;
  readonly turn: number;
  readonly turnsUntil: number;
  readonly totalAmount: number;
  readonly cells: readonly ForecastCellView[];
}

export interface StageCellRiskView {
  readonly index: number;
  readonly level: StageRiskLevel;
  readonly reasons: readonly string[];
  readonly water: number;
  readonly terrain: number;
  readonly forecastAmount: number;
  readonly protectedCell: boolean;
}

export interface StageProjection {
  readonly forecasts: readonly StageForecastView[];
  readonly forecastCells: readonly ForecastCellView[];
  readonly risks: readonly StageCellRiskView[];
}

const RISK_ORDER: readonly StageRiskLevel[] = Object.freeze([
  'safe',
  'caution',
  'danger',
  'critical'
]);

function maxRisk(left: StageRiskLevel, right: StageRiskLevel): StageRiskLevel {
  return RISK_ORDER.indexOf(left) >= RISK_ORDER.indexOf(right) ? left : right;
}

function addReason(reasons: string[], reason: string): void {
  if (!reasons.includes(reason) && reasons.length < 2) reasons.push(reason);
}

function forecastViews(forecasts: readonly StageRainForecast[]): readonly StageForecastView[] {
  return Object.freeze(
    forecasts.map((forecast) => Object.freeze({
      eventIndex: forecast.eventIndex,
      turn: forecast.turn,
      turnsUntil: forecast.turnsUntil,
      totalAmount: forecast.cells.reduce((total, cell) => total + cell.amount, 0),
      cells: Object.freeze(
        forecast.cells.map((cell) => Object.freeze({
          index: cell.index,
          amount: cell.amount,
          eventIndex: forecast.eventIndex,
          turn: forecast.turn,
          turnsUntil: forecast.turnsUntil
        }))
      )
    }))
  );
}

function transferSources(
  result: FlowStepResult | null,
  predicate: (transfer: WaterTransfer) => boolean
): ReadonlySet<number> {
  if (result === null) return new Set<number>();
  return new Set(result.transfers.filter(predicate).map((transfer) => transfer.from));
}

function protectedOverflowCells(preview: StageTurnPreview | null): ReadonlySet<number> {
  if (preview === null) return new Set<number>();
  return new Set(preview.nextFlow.protectedOverflows.map((overflow) => overflow.index));
}

function safeDrainCells(preview: StageTurnPreview | null): ReadonlySet<number> {
  if (preview === null) return new Set<number>();
  return new Set(preview.nextFlow.drains.map((drain) => drain.index));
}

/** Builds display-only risk information from exact snapshot and preview evidence. */
export function buildStageProjection(
  definition: ValidatedStageDefinition,
  snapshot: StageSessionSnapshot,
  forecasts: readonly StageRainForecast[],
  preview: StageTurnPreview | null
): StageProjection {
  const forecastViewsValue = forecastViews(forecasts);
  const forecastCells = Object.freeze(forecastViewsValue.flatMap((forecast) => forecast.cells));
  const nextRainByCell = new Map<number, number>();
  for (const cell of forecastViewsValue[0]?.cells ?? []) {
    nextRainByCell.set(cell.index, (nextRainByCell.get(cell.index) ?? 0) + cell.amount);
  }

  const dangerSources = transferSources(
    preview?.nextFlow ?? null,
    (transfer) => transfer.kind === 'danger-edge'
  );
  const safeSources = safeDrainCells(preview);
  const overflowCells = protectedOverflowCells(preview);
  const risks: StageCellRiskView[] = [];

  for (let index = 0; index < snapshot.board.terrain.length; index += 1) {
    const water = snapshot.board.water[index] ?? 0;
    const terrain = snapshot.board.terrain[index] ?? 0;
    const protectedCell = ((definition.board.cellFlags[index] ?? snapshot.board.cellFlags[index] ?? 0) & CellFlag.Protected) !== 0;
    const protectedLimit = snapshot.board.protectedWaterLimit[index] ?? 0;
    const forecastAmount = nextRainByCell.get(index) ?? 0;
    let level: StageRiskLevel = 'safe';
    const reasons: string[] = [];

    if (protectedCell && water > protectedLimit) {
      level = maxRisk(level, 'critical');
      addReason(reasons, '現在の水位が保護上限を超えています');
    }
    if ((snapshot.metrics.peakOverflowByCell[index] ?? 0) > 0) {
      level = maxRisk(level, 'critical');
      addReason(reasons, 'この保護セルでは浸水が発生しています');
    }
    if (overflowCells.has(index)) {
      level = maxRisk(level, 'critical');
      addReason(reasons, '次の水流で保護セルへ浸水します');
    }
    if (dangerSources.has(index)) {
      level = maxRisk(level, 'danger');
      addReason(reasons, '次の水流で危険側の出口へ流れます');
    }
    if (safeSources.has(index)) {
      level = maxRisk(level, 'caution');
      addReason(reasons, '次の水流で安全排水口へ流れます');
    }
    if (forecastAmount > 0) {
      const rainWouldOverflow = protectedCell && water + forecastAmount > protectedLimit;
      level = maxRisk(level, rainWouldOverflow ? 'danger' : 'caution');
      addReason(reasons, `次の雨が${forecastAmount}降ります`);
    }
    if (preview?.placementCells.includes(index)) {
      addReason(reasons, 'このセルが施工対象です');
    }

    risks.push(Object.freeze({
      index,
      level,
      reasons: Object.freeze(reasons),
      water,
      terrain,
      forecastAmount,
      protectedCell
    }));
  }

  return Object.freeze({
    forecasts: forecastViewsValue,
    forecastCells,
    risks: Object.freeze(risks)
  });
}

export function riskLabel(level: StageRiskLevel): string {
  switch (level) {
    case 'safe': return '安全';
    case 'caution': return '注意';
    case 'danger': return '危険';
    case 'critical': return '決壊寸前';
  }
}
