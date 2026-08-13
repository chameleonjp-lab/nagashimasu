import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CELL_COUNT,
  CellFlag,
  DEFAULT_HEIGHT_UNIT,
  DEFAULT_MAX_FLOW_PER_STEP,
  Direction,
  DIRECTION_ORDER,
  MAX_CELL_WATER,
  MAX_TERRAIN_HEIGHT
} from './constants';
import { assertCellIndex, BoardState, coordinateOf } from './board';
import type {
  BoardSnapshot,
  DrainEvent,
  FlowStepResult,
  WaterModelConfig,
  WaterTransfer
} from './types';

interface FlowTarget {
  readonly direction: Direction;
  readonly surface: number;
  readonly cellIndex: number | null;
  readonly outlet: 'safe' | 'danger' | null;
}

export const DEFAULT_WATER_MODEL_CONFIG: WaterModelConfig = Object.freeze({
  heightUnit: DEFAULT_HEIGHT_UNIT,
  maxFlowPerStep: DEFAULT_MAX_FLOW_PER_STEP
});

function resolveConfig(config?: Partial<WaterModelConfig>): WaterModelConfig {
  const resolved = {
    heightUnit: config?.heightUnit ?? DEFAULT_WATER_MODEL_CONFIG.heightUnit,
    maxFlowPerStep:
      config?.maxFlowPerStep ?? DEFAULT_WATER_MODEL_CONFIG.maxFlowPerStep
  };

  const maximumSafeHeightUnit = Math.floor(
    (Number.MAX_SAFE_INTEGER - MAX_CELL_WATER) / MAX_TERRAIN_HEIGHT
  );
  if (
    !Number.isSafeInteger(resolved.heightUnit) ||
    resolved.heightUnit <= 0 ||
    resolved.heightUnit > maximumSafeHeightUnit
  ) {
    throw new RangeError('heightUnit must be a positive integer');
  }
  if (
    !Number.isSafeInteger(resolved.maxFlowPerStep) ||
    resolved.maxFlowPerStep <= 0 ||
    resolved.maxFlowPerStep > MAX_CELL_WATER
  ) {
    throw new RangeError(`maxFlowPerStep must be an integer from 1 to ${MAX_CELL_WATER}`);
  }

  return Object.freeze(resolved);
}

function validateScanOrder(order: readonly number[] | undefined): readonly number[] {
  if (order === undefined) {
    return Object.freeze(Array.from({ length: CELL_COUNT }, (_, index) => index));
  }
  if (order.length !== CELL_COUNT) {
    throw new RangeError(`scan order must contain exactly ${CELL_COUNT} cells`);
  }
  const seen = new Set<number>();
  for (const index of order) {
    assertCellIndex(index);
    if (seen.has(index)) throw new RangeError(`scan order repeats cell ${index}`);
    seen.add(index);
  }
  return order;
}

function neighborIndex(index: number, direction: Direction): number | null {
  const { row, column } = coordinateOf(index);
  switch (direction) {
    case Direction.North:
      return row > 0 ? index - BOARD_WIDTH : null;
    case Direction.East:
      return column < BOARD_WIDTH - 1 ? index + 1 : null;
    case Direction.South:
      return row < BOARD_HEIGHT - 1 ? index + BOARD_WIDTH : null;
    case Direction.West:
      return column > 0 ? index - 1 : null;
  }
}

function getTargets(
  board: BoardState,
  index: number,
  config: WaterModelConfig
): readonly FlowTarget[] {
  const targets: FlowTarget[] = [];
  const safeMask = board.getSafeEdgeMask(index);
  const dangerMask = board.getDangerEdgeMask(index);

  for (const direction of DIRECTION_ORDER) {
    const adjacent = neighborIndex(index, direction);
    if (adjacent !== null) {
      targets.push({
        direction,
        surface:
          board.getTerrain(adjacent) * config.heightUnit + board.getWater(adjacent),
        cellIndex: adjacent,
        outlet: null
      });
      continue;
    }

    const outlet =
      (safeMask & direction) !== 0
        ? 'safe'
        : (dangerMask & direction) !== 0
          ? 'danger'
          : null;
    if (outlet !== null) {
      targets.push({
        direction,
        surface: -config.heightUnit,
        cellIndex: null,
        outlet
      });
    }
  }

  return targets;
}

function distributeFlow(
  sourceIndex: number,
  flowStep: number,
  amount: number,
  targets: readonly FlowTarget[],
  delta: Int32Array,
  transfers: WaterTransfer[]
): { safe: number; danger: number } {
  const base = Math.floor(amount / targets.length);
  const remainder = amount % targets.length;
  const remainderStart = (sourceIndex + flowStep) % targets.length;
  let safe = 0;
  let danger = 0;

  for (let offset = 0; offset < targets.length; offset += 1) {
    const targetPosition = (remainderStart + offset) % targets.length;
    const target = targets[targetPosition];
    if (target === undefined) throw new Error('missing deterministic flow target');
    const share = base + (offset < remainder ? 1 : 0);
    if (share === 0) continue;

    if (target.cellIndex !== null) {
      delta[target.cellIndex] = (delta[target.cellIndex] ?? 0) + share;
      transfers.push(Object.freeze({
        from: sourceIndex,
        to: target.cellIndex,
        direction: target.direction,
        kind: 'cell',
        amount: share
      }));
    } else if (target.outlet === 'safe') {
      safe += share;
      transfers.push(Object.freeze({
        from: sourceIndex,
        to: null,
        direction: target.direction,
        kind: 'safe-edge',
        amount: share
      }));
    } else if (target.outlet === 'danger') {
      danger += share;
      transfers.push(Object.freeze({
        from: sourceIndex,
        to: null,
        direction: target.direction,
        kind: 'danger-edge',
        amount: share
      }));
    }
  }

  return { safe, danger };
}

export function advanceWaterFlow(
  board: BoardState,
  options: {
    readonly config?: Partial<WaterModelConfig>;
    readonly scanOrder?: readonly number[];
  } = {}
): FlowStepResult {
  const config = resolveConfig(options.config);
  const scanOrder = validateScanOrder(options.scanOrder);
  const delta = new Int32Array(CELL_COUNT);
  let movedWater = 0;
  let safeDrained = 0;
  let dangerLeaked = 0;
  const transfers: WaterTransfer[] = [];
  const drains: DrainEvent[] = [];

  for (const index of scanOrder) {
    const sourceWater = board.getWater(index);
    if (sourceWater === 0) continue;

    const sourceSurface = board.getTerrain(index) * config.heightUnit + sourceWater;
    const lowerTargets = getTargets(board, index, config).filter(
      (target) => target.surface < sourceSurface
    );
    if (lowerTargets.length === 0) continue;

    let minimumSurface = Number.POSITIVE_INFINITY;
    for (const target of lowerTargets) {
      minimumSurface = Math.min(minimumSurface, target.surface);
    }
    const lowestTargets = lowerTargets.filter(
      (target) => target.surface === minimumSurface
    );
    const balancedAmount = Math.floor((sourceSurface - minimumSurface) / 2);
    const outgoing = Math.min(sourceWater, config.maxFlowPerStep, balancedAmount);
    if (outgoing <= 0) continue;

    delta[index] = (delta[index] ?? 0) - outgoing;
    const outlets = distributeFlow(
      index,
      board.flowStep,
      outgoing,
      lowestTargets,
      delta,
      transfers
    );
    safeDrained += outlets.safe;
    dangerLeaked += outlets.danger;
    movedWater += outgoing;
  }

  const nextWaterValues = Array.from(board.getWaterCopy(), (water, index) =>
    water + (delta[index] ?? 0)
  );
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const next = nextWaterValues[index];
    if (!Number.isSafeInteger(next) || (next ?? -1) < 0) {
      throw new RangeError(`water[${index}] would become invalid`);
    }
  }

  for (let index = 0; index < CELL_COUNT; index += 1) {
    const capacity = board.getDrainCapacity(index);
    if (capacity === 0) continue;
    const drained = Math.min(nextWaterValues[index] ?? 0, capacity);
    nextWaterValues[index] = (nextWaterValues[index] ?? 0) - drained;
    safeDrained += drained;
    if (drained > 0) drains.push(Object.freeze({ index, amount: drained }));
  }

  for (let index = 0; index < CELL_COUNT; index += 1) {
    const next = nextWaterValues[index];
    if (!Number.isSafeInteger(next) || (next ?? -1) < 0 || (next ?? 0) > MAX_CELL_WATER) {
      throw new RangeError(`water[${index}] would leave the Uint16 range`);
    }
  }
  const nextWater = Uint16Array.from(nextWaterValues);

  board.applyFlowResult(nextWater, safeDrained, dangerLeaked);
  transfers.sort((left, right) =>
    left.from - right.from || left.direction - right.direction
  );
  const protectedOverflows = board.getProtectedOverflows();
  return Object.freeze({
    flowStep: board.flowStep,
    movedWater,
    safeDrained,
    dangerLeaked,
    protectedOverflow: protectedOverflows.reduce(
      (total, overflow) => total + overflow.amount,
      0
    ),
    transfers: Object.freeze(transfers),
    drains: Object.freeze(drains),
    protectedOverflows
  });
}

export function previewWaterFlow(
  board: BoardState,
  options: {
    readonly config?: Partial<WaterModelConfig>;
    readonly scanOrder?: readonly number[];
  } = {}
): { readonly snapshot: BoardSnapshot; readonly result: FlowStepResult } {
  const previewBoard = board.clone();
  const result = advanceWaterFlow(previewBoard, options);
  return Object.freeze({ snapshot: previewBoard.snapshot(), result });
}
