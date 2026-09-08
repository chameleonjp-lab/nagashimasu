import { assertCellIndex, BoardState } from '../domain/board';
import { CELL_COUNT, MAX_CELL_WATER } from '../domain/constants';
import type { StageMetrics, StageTraceEvent } from '../domain/stage-session';
import type { BoardSnapshot, FlowStepResult } from '../domain/types';

/**
 * The board snapshots used by one accepted-turn playback.
 *
 * These snapshots are presentation evidence only.  The reducer has already
 * decided the transfer and drain records; this module applies those records
 * to a copy so the renderer can show the same board at every trace phase.
 */
export interface PlaybackBoardSequence {
  readonly beforeBoard: BoardSnapshot;
  readonly afterRainBoard: BoardSnapshot | null;
  readonly trace: readonly StageTraceEvent[];
  readonly flowEvents: readonly StageTraceEvent[];
  readonly flowBoards: readonly BoardSnapshot[];
  readonly finalBoard: BoardSnapshot;
}

function assertAmount(amount: number, label: string): void {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_CELL_WATER) {
    throw new RangeError(`${label} must be an integer from 1 to ${MAX_CELL_WATER}`);
  }
}

function nextWaterFromResult(
  board: BoardSnapshot,
  result: FlowStepResult
): Uint16Array {
  const delta = new Int32Array(CELL_COUNT);
  for (const transfer of result.transfers) {
    assertCellIndex(transfer.from);
    assertAmount(transfer.amount, 'transfer amount');
    delta[transfer.from] = (delta[transfer.from] ?? 0) - transfer.amount;
    if (transfer.to !== null) {
      assertCellIndex(transfer.to);
      delta[transfer.to] = (delta[transfer.to] ?? 0) + transfer.amount;
    }
  }
  for (const drain of result.drains) {
    assertCellIndex(drain.index);
    assertAmount(drain.amount, 'drain amount');
    delta[drain.index] = (delta[drain.index] ?? 0) - drain.amount;
  }

  const nextWater = new Uint16Array(CELL_COUNT);
  for (let index = 0; index < CELL_COUNT; index += 1) {
    const next = (board.water[index] ?? 0) + (delta[index] ?? 0);
    if (!Number.isSafeInteger(next) || next < 0 || next > MAX_CELL_WATER) {
      throw new RangeError(`water[${index}] would leave the Uint16 range`);
    }
    nextWater[index] = next;
  }
  return nextWater;
}

function boardEqual(left: BoardSnapshot, right: BoardSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function flowEventsFromTrace(trace: readonly StageTraceEvent[]): readonly StageTraceEvent[] {
  return Object.freeze(
    trace.filter((event) => event.phase === 'flow' && event.flowResult !== null)
  );
}

/**
 * Applies only recorded transfers and drains to produce the intermediate
 * boards for a trace.  It never calls the flow solver and never evaluates a
 * win or failure condition.
 */
export function buildPlaybackBoardSequence(
  beforeBoard: BoardSnapshot,
  afterRainBoard: BoardSnapshot | null,
  trace: readonly StageTraceEvent[],
  finalBoard: BoardSnapshot
): PlaybackBoardSequence {
  const flowEvents = flowEventsFromTrace(trace);
  const flowBoards: BoardSnapshot[] = [];
  let current = afterRainBoard ?? beforeBoard;

  for (const event of flowEvents) {
    const result = event.flowResult;
    if (result === null) throw new Error('flow event is missing its result');
    if (result.flowStep !== current.flowStep + 1) {
      throw new Error(
        `flow trace step ${result.flowStep} does not follow board step ${current.flowStep}`
      );
    }
    const nextBoard = BoardState.fromSnapshot(current);
    nextBoard.applyFlowResult(
      nextWaterFromResult(current, result),
      result.safeDrained,
      result.dangerLeaked
    );
    current = nextBoard.snapshot();
    flowBoards.push(current);
  }

  // A normal accepted turn must be reproducible from its trace.  Undo has no
  // flow events and intentionally transitions from the current board to the
  // checkpoint, so it is the one valid exception.
  const isUndo = trace.some((event) => event.phase === 'undo');
  if (!isUndo && flowEvents.length > 0 && !boardEqual(current, finalBoard)) {
    throw new Error('recorded playback boards do not reach the authoritative final board');
  }

  return Object.freeze({
    beforeBoard,
    afterRainBoard,
    trace: Object.freeze([...trace]),
    flowEvents,
    flowBoards: Object.freeze(flowBoards),
    finalBoard
  });
}

/** Selects the board that belongs to one trace event without advancing state. */
export function boardForPlaybackEvent(
  sequence: PlaybackBoardSequence,
  event: StageTraceEvent | null
): BoardSnapshot {
  if (event === null) return sequence.finalBoard;
  switch (event.phase) {
    case 'construction':
      return sequence.beforeBoard;
    case 'rain':
      return sequence.afterRainBoard ?? sequence.beforeBoard;
    case 'flow': {
      const index = sequence.flowEvents.findIndex((candidate) =>
        candidate === event || candidate.flowStep === event.flowStep
      );
      return index >= 0
        ? sequence.flowBoards[index] ?? sequence.finalBoard
        : sequence.finalBoard;
    }
    case 'evaluation':
    case 'undo':
      return sequence.finalBoard;
  }
}

function overflowTotal(
  values: readonly { readonly index: number; readonly amount: number }[]
): number {
  return values.reduce((total, value) => total + value.amount, 0);
}

/**
 * Replays only the metric observations present in the trace up to an event.
 * This keeps objective progress and risk annotations from jumping to the
 * completed turn while its animation is still in progress.
 */
export function playbackMetricsForEvent(
  sequence: PlaybackBoardSequence,
  event: StageTraceEvent | null,
  initial: StageMetrics
): StageMetrics {
  const eventIndex = event === null
    ? -1
    : sequence.trace.findIndex((candidate) =>
      candidate === event || (
        candidate.phase === event.phase &&
        candidate.flowStep === event.flowStep
      )
    );
  if (eventIndex < 0) return initial;

  const firstFloodStepByCell = [...initial.firstFloodStepByCell];
  const peakOverflowByCell = [...initial.peakOverflowByCell];
  let firstFloodStep = initial.firstFloodStep;
  let peakProtectedOverflow = initial.peakProtectedOverflow;
  let protectedDamage = initial.protectedDamage;
  let safeDrained = initial.safeDrained;
  let dangerLeaked = initial.dangerLeaked;
  let drainCapacityOverflow = initial.drainCapacityOverflow;
  let rainEventsHandled = initial.rainEventsHandled;
  let rainWaterHandled = initial.rainWaterHandled;

  const observeOverflows = (
    overflows: readonly { readonly index: number; readonly amount: number }[],
    observationStep: number
  ): void => {
    const totalOverflow = overflowTotal(overflows);
    for (const overflow of overflows) {
      if (firstFloodStepByCell[overflow.index] === null) {
        firstFloodStepByCell[overflow.index] = observationStep;
      }
      peakOverflowByCell[overflow.index] = Math.max(
        peakOverflowByCell[overflow.index] ?? 0,
        overflow.amount
      );
    }
    if (firstFloodStep === null && totalOverflow > 0) {
      firstFloodStep = observationStep;
    }
    peakProtectedOverflow = Math.max(peakProtectedOverflow, totalOverflow);
    protectedDamage = peakOverflowByCell.reduce(
      (total, amount) => total + amount,
      0
    );
  };

  for (let index = 0; index <= eventIndex; index += 1) {
    const traceEvent = sequence.trace[index];
    if (traceEvent === undefined) continue;
    if (traceEvent.phase === 'rain') {
      if (traceEvent.rainCells.length > 0) {
        rainEventsHandled += 1;
        rainWaterHandled += traceEvent.rainCells.reduce(
          (total, rain) => total + rain.amount,
          0
        );
      }
      observeOverflows(
        traceEvent.protectedOverflows,
        sequence.afterRainBoard?.flowStep ?? sequence.beforeBoard.flowStep
      );
      continue;
    }
    if (traceEvent.phase !== 'flow' || traceEvent.flowResult === null) continue;
    safeDrained += traceEvent.flowResult.safeDrained;
    dangerLeaked += traceEvent.flowResult.dangerLeaked;
    observeOverflows(traceEvent.flowResult.protectedOverflows, traceEvent.flowResult.flowStep);
    const flowIndex = sequence.flowEvents.findIndex((candidate) => candidate === traceEvent);
    const flowBoard = flowIndex < 0 ? undefined : sequence.flowBoards[flowIndex];
    if (flowBoard !== undefined) {
      const currentOverflow = flowBoard.water.reduce(
        (total, amount, cellIndex) =>
          (flowBoard.drainCapacity[cellIndex] ?? 0) > 0 ? total + amount : total,
        0
      );
      drainCapacityOverflow = Math.max(drainCapacityOverflow, currentOverflow);
    }
  }

  return Object.freeze({
    ...initial,
    safeDrained,
    dangerLeaked,
    firstFloodStep,
    firstFloodStepByCell: Object.freeze(firstFloodStepByCell),
    peakProtectedOverflow,
    peakOverflowByCell: Object.freeze(peakOverflowByCell),
    protectedDamage,
    drainCapacityOverflow,
    rainEventsHandled,
    rainWaterHandled
  });
}
