import { BoardState } from './board';
import {
  CELL_COUNT,
  MAX_TERRAIN_HEIGHT,
  MIN_TERRAIN_HEIGHT
} from './constants';
import { resolvePiecePlacement } from './pieces';
import {
  MAX_STAGE_REPLAY_ENTRIES,
  STAGE_REPLAY_VERSION,
  STAGE_RULES_VERSION,
  parseStageAction,
  parseStageReplay
} from './stage-replay';
import type {
  StageAction,
  StageReplayEntryV1,
  StageReplayV1,
  StageTimerMode
} from './stage-replay';
import { parseValidatedStageDefinition } from './stage-definition';
import type { ValidatedStageDefinition } from './stage-definition';
import { WATER_RULES_VERSION, WaterSimulation } from './simulation';
import type {
  BoardSnapshot,
  CellWaterAmount,
  FlowStepResult,
  RainEvent,
  WaterModelConfig,
  WaterRulesV1
} from './types';
import { advanceWaterFlow } from './water-flow';

export type StagePhase = 'awaiting-turn' | 'cleared' | 'failed';
export type StageGrade = 'S' | 'A' | 'B' | 'C';
export type StageFailureReason =
  | 'danger-leak'
  | 'protected-overflow'
  | 'objective-not-met';
export type StageRejectionReason =
  | 'action-id-collision'
  | 'stale-action-id'
  | 'stale-revision'
  | 'stage-complete'
  | 'timer-disabled'
  | 'undo-already-used'
  | 'undo-unavailable'
  | 'cell-out-of-bounds'
  | 'anchor-out-of-bounds'
  | 'construction-forbidden'
  | 'terrain-limit'
  | 'candidate-exhausted';

export interface StageMetrics {
  readonly safeDrained: number;
  readonly dangerLeaked: number;
  readonly work: number;
  readonly firstFloodStep: number | null;
  readonly firstFloodStepByCell: readonly (number | null)[];
  readonly peakProtectedOverflow: number;
  readonly peakOverflowByCell: readonly number[];
  readonly protectedDamage: number;
  readonly drainCapacityOverflow: number;
  readonly rainEventsHandled: number;
  readonly rainWaterHandled: number;
}

export interface StageScore {
  readonly safety: number;
  readonly efficiency: number;
  readonly control: number;
  readonly total: number;
  readonly grade: StageGrade | null;
}

export interface StageGameplayState {
  readonly board: BoardSnapshot;
  readonly completedTurns: number;
  readonly candidates: readonly [string, string];
  /** Candidate sequence indices give each otherwise-identical piece a stable token. */
  readonly candidateTokenIds: readonly [number, number];
  readonly nextCandidateIndex: number;
  readonly nextRainIndex: number;
  readonly randomState: number;
  readonly metrics: StageMetrics;
  readonly score: StageScore;
  readonly phase: StagePhase;
  readonly objectiveMet: boolean;
  readonly failureReasons: readonly StageFailureReason[];
}

export interface StageReducerState {
  readonly gameplay: StageGameplayState;
  readonly timerMode: StageTimerMode;
  readonly waterRules: WaterRulesV1;
  readonly undoUsed: boolean;
  readonly revision: number;
  readonly nextActionId: number;
  readonly lastAcceptedAction: StageAction | null;
  readonly checkpoint: StageGameplayState | null;
}

export interface StageSessionSnapshot extends StageGameplayState {
  readonly stageId: string;
  readonly dataVersion: string;
  readonly definitionDigest: string;
  readonly stageRulesVersion: typeof STAGE_RULES_VERSION;
  readonly timerMode: StageTimerMode;
  readonly waterRules: WaterRulesV1;
  readonly undoUsed: boolean;
  readonly revision: number;
  readonly nextActionId: number;
}

export type StageTracePhase = 'construction' | 'rain' | 'flow' | 'evaluation' | 'undo';

export interface StageTraceEvent {
  readonly phase: StageTracePhase;
  readonly flowStep: number | null;
  readonly placementCells: readonly number[];
  readonly rainCells: readonly RainEvent[];
  readonly protectedOverflows: readonly CellWaterAmount[];
  readonly flowResult: FlowStepResult | null;
}

export interface StageReduction {
  readonly accepted: boolean;
  readonly replayed: boolean;
  readonly reason: StageRejectionReason | null;
  readonly state: StageReducerState;
  readonly trace: readonly StageTraceEvent[];
  readonly entry: StageReplayEntryV1 | null;
}

export interface StageExecution {
  readonly accepted: boolean;
  readonly replayed: boolean;
  readonly reason: StageRejectionReason | null;
  readonly trace: readonly StageTraceEvent[];
  readonly snapshot: StageSessionSnapshot;
}

export interface StageActionValidation {
  readonly valid: boolean;
  readonly reason: StageRejectionReason | null;
  readonly placementCells: readonly number[];
}

export interface StageTurnPreview {
  readonly valid: true;
  readonly action: StageAction;
  readonly placementCells: readonly number[];
  readonly terrainAfterConstruction: readonly number[];
  readonly rainCells: readonly RainEvent[];
  readonly nextFlow: FlowStepResult;
  readonly boardAfterNextFlow: BoardSnapshot;
}

export interface StageRainForecast {
  readonly eventIndex: number;
  readonly turn: number;
  readonly turnsUntil: number;
  readonly cells: readonly RainEvent[];
}

const EMPTY_NUMBERS = Object.freeze([] as number[]);
const EMPTY_RAIN = Object.freeze([] as RainEvent[]);

function freezeBoard(snapshot: BoardSnapshot): BoardSnapshot {
  return BoardState.fromSnapshot(snapshot).snapshot();
}

function freezeMetrics(metrics: StageMetrics): StageMetrics {
  return Object.freeze({
    ...metrics,
    firstFloodStepByCell: Object.freeze([...metrics.firstFloodStepByCell]),
    peakOverflowByCell: Object.freeze([...metrics.peakOverflowByCell])
  });
}

function freezeScore(score: StageScore): StageScore {
  return Object.freeze({ ...score });
}

function freezeGameplay(gameplay: StageGameplayState): StageGameplayState {
  return Object.freeze({
    ...gameplay,
    board: freezeBoard(gameplay.board),
    candidates: Object.freeze([...gameplay.candidates]) as readonly [string, string],
    candidateTokenIds: Object.freeze(
      [...gameplay.candidateTokenIds]
    ) as readonly [number, number],
    metrics: freezeMetrics(gameplay.metrics),
    score: freezeScore(gameplay.score),
    failureReasons: Object.freeze([...gameplay.failureReasons])
  });
}

function freezeState(state: StageReducerState): StageReducerState {
  return Object.freeze({
    ...state,
    gameplay: freezeGameplay(state.gameplay),
    waterRules: Object.freeze({ ...state.waterRules }),
    lastAcceptedAction:
      state.lastAcceptedAction === null
        ? null
        : parseStageAction(state.lastAcceptedAction),
    checkpoint:
      state.checkpoint === null ? null : freezeGameplay(state.checkpoint)
  });
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function hashJson(value: unknown): string {
  return fnv1a64(canonicalJson(value));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('stage hash input contains a non-finite number');
    }
    return JSON.stringify(value === 0 ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('stage hash input is not JSON data');
}

export function hashReversibleGameplay(gameplay: StageGameplayState): string {
  return hashJson(gameplay);
}

export function hashFullStageState(
  definition: ValidatedStageDefinition,
  state: StageReducerState
): string {
  return hashJson({
    stageId: definition.id,
    dataVersion: definition.dataVersion,
    definitionDigest: definition.definitionDigest,
    stageRulesVersion: STAGE_RULES_VERSION,
    timerMode: state.timerMode,
    waterRules: state.waterRules,
    gameplay: state.gameplay,
    undoUsed: state.undoUsed,
    revision: state.revision,
    nextActionId: state.nextActionId,
    lastAcceptedAction: state.lastAcceptedAction,
    checkpointHash:
      state.checkpoint === null ? null : hashReversibleGameplay(state.checkpoint)
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function checkedAdd(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new RangeError(`${label} exceeds the safe integer range`);
  }
  return result;
}

function checkedMultiply(left: number, right: number, label: string): number {
  const result = left * right;
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new RangeError(`${label} exceeds the safe integer range`);
  }
  return result;
}

function initialRandomState(definitionDigest: string): number {
  const value = Number.parseInt(definitionDigest.slice(-8), 16) >>> 0;
  return value === 0 ? 0x6d2b79f5 : value;
}

export function getStageObjectiveProgress(
  definition: ValidatedStageDefinition,
  board: BoardSnapshot,
  metrics: StageMetrics
): { readonly value: number; readonly target: number } {
  let value: number;
  switch (definition.objective.type) {
    case 'stored-water':
      value = board.water.reduce(
        (total, amount, index) =>
          definition.storageMask[index] === 1
            ? checkedAdd(total, amount, 'stored water')
            : total,
        0
      );
      break;
    case 'safe-drain':
      value = board.safeDrain;
      break;
    case 'protect':
      value = metrics.peakProtectedOverflow === 0
        ? metrics.rainEventsHandled
        : 0;
      break;
  }
  return Object.freeze({ value, target: definition.objective.target });
}

function isObjectiveMet(
  definition: ValidatedStageDefinition,
  board: BoardSnapshot,
  metrics: StageMetrics
): boolean {
  const progress = getStageObjectiveProgress(definition, board, metrics);
  return progress.value >= progress.target;
}

function calculateScore(
  definition: ValidatedStageDefinition,
  board: BoardSnapshot,
  metrics: StageMetrics,
  cleared: boolean
): StageScore {
  const dangerPenalty = checkedMultiply(metrics.dangerLeaked, 2, 'danger penalty');
  const floodPenalty = checkedMultiply(metrics.protectedDamage, 5, 'flood penalty');
  const safety = clamp(50 - dangerPenalty - floodPenalty, 0, 50);
  const excessWork = Math.max(0, metrics.work - definition.evaluation.parWork);
  const workPenalty = checkedMultiply(excessWork, 4, 'work penalty');
  const efficiency = clamp(30 - workPenalty, 0, 30);

  const rawControl = definition.objective.type === 'protect'
    ? metrics.peakProtectedOverflow === 0
      ? metrics.rainWaterHandled
      : 0
    : definition.objective.type === 'stored-water'
      ? board.water.reduce(
        (total, amount, index) =>
          definition.storageMask[index] === 1
            ? checkedAdd(total, amount, 'control stored water')
            : total,
        0
      )
      : board.safeDrain;
  const cappedControl = Math.min(rawControl, definition.evaluation.controlTarget);
  const baseControl = Math.floor(
    checkedMultiply(cappedControl, 20, 'control score numerator') /
      definition.evaluation.controlTarget
  );
  const cappedDrainOverflow = Math.min(
    metrics.drainCapacityOverflow,
    definition.evaluation.controlTarget
  );
  const drainOverflowPenalty = Math.ceil(
    checkedMultiply(cappedDrainOverflow, 20, 'drain overflow penalty numerator') /
      definition.evaluation.controlTarget
  );
  const control = clamp(baseControl - drainOverflowPenalty, 0, 20);
  const total = checkedAdd(checkedAdd(safety, efficiency, 'partial score'), control, 'total score');
  const thresholds = definition.evaluation.gradeThresholds;
  const grade: StageGrade | null = !cleared
    ? null
    : total >= thresholds.s
      ? 'S'
      : total >= thresholds.a
        ? 'A'
        : total >= thresholds.b
          ? 'B'
          : 'C';
  return freezeScore({ safety, efficiency, control, total, grade });
}

function emptyMetrics(board: BoardSnapshot): StageMetrics {
  return freezeMetrics({
    safeDrained: board.safeDrain,
    dangerLeaked: board.dangerLeak,
    work: 0,
    firstFloodStep: null,
    firstFloodStepByCell: Array<(number | null)>(CELL_COUNT).fill(null),
    peakProtectedOverflow: 0,
    peakOverflowByCell: Array<number>(CELL_COUNT).fill(0),
    protectedDamage: 0,
    drainCapacityOverflow: 0,
    rainEventsHandled: 0,
    rainWaterHandled: 0
  });
}

function candidateTuple(
  sequence: readonly string[],
  first: number,
  second: number
): readonly [string, string] {
  const left = sequence[first];
  const right = sequence[second];
  if (left === undefined || right === undefined) {
    throw new RangeError('candidate sequence cannot fill both initial slots');
  }
  return Object.freeze([left, right]);
}

export function createInitialStageState(
  definition: ValidatedStageDefinition,
  timerMode: StageTimerMode = 'standard',
  waterConfig?: Partial<WaterModelConfig>
): StageReducerState {
  if (timerMode !== 'standard' && timerMode !== 'extended' && timerMode !== 'unlimited') {
    throw new RangeError('timerMode must be standard, extended, or unlimited');
  }
  const simulation = new WaterSimulation(definition.board, waterConfig);
  const board = simulation.snapshot;
  const metrics = emptyMetrics(board);
  const gameplay = freezeGameplay({
    board,
    completedTurns: 0,
    candidates: candidateTuple(definition.candidateSequence, 0, 1),
    candidateTokenIds: Object.freeze([0, 1]),
    nextCandidateIndex: 2,
    nextRainIndex: 0,
    randomState: initialRandomState(definition.definitionDigest),
    metrics,
    score: calculateScore(definition, board, metrics, false),
    phase: 'awaiting-turn',
    objectiveMet: isObjectiveMet(definition, board, metrics),
    failureReasons: Object.freeze([])
  });
  return freezeState({
    gameplay,
    timerMode,
    waterRules: simulation.rules,
    undoUsed: false,
    revision: 0,
    nextActionId: 0,
    lastAcceptedAction: null,
    checkpoint: null
  });
}

function actionFingerprint(action: StageAction): string {
  return JSON.stringify(action);
}

function rejected(
  state: StageReducerState,
  reason: StageRejectionReason
): StageReduction {
  return Object.freeze({
    accepted: false,
    replayed: false,
    reason,
    state,
    trace: Object.freeze([]),
    entry: null
  });
}

function replayed(state: StageReducerState): StageReduction {
  return Object.freeze({
    accepted: true,
    replayed: true,
    reason: null,
    state,
    trace: Object.freeze([]),
    entry: null
  });
}

function traceEvent(
  phase: StageTracePhase,
  options: {
    readonly flowStep?: number;
    readonly placementCells?: readonly number[];
    readonly rainCells?: readonly RainEvent[];
    readonly protectedOverflows?: readonly CellWaterAmount[];
    readonly flowResult?: FlowStepResult;
  } = {}
): StageTraceEvent {
  return Object.freeze({
    phase,
    flowStep: options.flowStep ?? null,
    placementCells: Object.freeze([...(options.placementCells ?? EMPTY_NUMBERS)]),
    rainCells: Object.freeze(
      (options.rainCells ?? EMPTY_RAIN).map((cell) =>
        Object.freeze({ index: cell.index, amount: cell.amount })
      )
    ),
    protectedOverflows: Object.freeze(
      (options.protectedOverflows ?? []).map((cell) =>
        Object.freeze({ index: cell.index, amount: cell.amount })
      )
    ),
    flowResult: options.flowResult ?? null
  });
}

function updateFloodMetrics(
  previous: StageMetrics,
  protectedOverflows: readonly CellWaterAmount[],
  observationStep: number
): StageMetrics {
  const firstByCell = [...previous.firstFloodStepByCell];
  const peakByCell = [...previous.peakOverflowByCell];
  let totalOverflow = 0;
  for (const overflow of protectedOverflows) {
    totalOverflow = checkedAdd(totalOverflow, overflow.amount, 'protected overflow');
    if (firstByCell[overflow.index] === null) {
      firstByCell[overflow.index] = observationStep;
    }
    peakByCell[overflow.index] = Math.max(
      peakByCell[overflow.index] ?? 0,
      overflow.amount
    );
  }
  const protectedDamage = peakByCell.reduce(
    (total, amount) => checkedAdd(total, amount, 'protected damage'),
    0
  );
  return freezeMetrics({
    ...previous,
    firstFloodStep:
      previous.firstFloodStep ??
      (totalOverflow > 0 ? observationStep : null),
    firstFloodStepByCell: firstByCell,
    peakProtectedOverflow: Math.max(
      previous.peakProtectedOverflow,
      totalOverflow
    ),
    peakOverflowByCell: peakByCell,
    protectedDamage
  });
}

function updateMetricsForFlow(
  previous: StageMetrics,
  board: BoardState,
  result: FlowStepResult
): StageMetrics {
  const flooded = updateFloodMetrics(
    previous,
    result.protectedOverflows,
    result.flowStep
  );
  let drainOverflow = 0;
  for (let index = 0; index < CELL_COUNT; index += 1) {
    if (board.getDrainCapacity(index) > 0) {
      drainOverflow = checkedAdd(drainOverflow, board.getWater(index), 'drain overflow');
    }
  }
  return freezeMetrics({
    ...flooded,
    safeDrained: board.safeDrain,
    dangerLeaked: board.dangerLeak,
    drainCapacityOverflow: Math.max(previous.drainCapacityOverflow, drainOverflow)
  });
}

function failureReasons(
  definition: ValidatedStageDefinition,
  metrics: StageMetrics,
  atLastTurn: boolean,
  objectiveMet: boolean
): readonly StageFailureReason[] {
  const reasons: StageFailureReason[] = [];
  if (metrics.dangerLeaked > definition.failure.maxDangerLeak) {
    reasons.push('danger-leak');
  }
  if (
    metrics.peakProtectedOverflow >
    definition.failure.maxPeakProtectedOverflow
  ) {
    reasons.push('protected-overflow');
  }
  if (atLastTurn && !objectiveMet) reasons.push('objective-not-met');
  return Object.freeze(reasons);
}

function validateActionAgainstState(
  definition: ValidatedStageDefinition,
  state: StageReducerState,
  action: StageAction
): StageActionValidation {
  const lastAction = state.lastAcceptedAction;
  if (lastAction !== null && action.actionId === lastAction.actionId) {
    return Object.freeze({
      valid: false,
      reason:
        actionFingerprint(action) === actionFingerprint(lastAction)
          ? 'stale-action-id'
          : 'action-id-collision',
      placementCells: Object.freeze([])
    });
  }
  if (action.expectedRevision !== state.revision) {
    return Object.freeze({ valid: false, reason: 'stale-revision', placementCells: Object.freeze([]) });
  }
  if (action.actionId !== state.nextActionId) {
    return Object.freeze({ valid: false, reason: 'stale-action-id', placementCells: Object.freeze([]) });
  }
  if (action.type === 'undo') {
    const reason = state.undoUsed
      ? 'undo-already-used'
      : state.checkpoint === null
        ? 'undo-unavailable'
        : null;
    return Object.freeze({ valid: reason === null, reason, placementCells: Object.freeze([]) });
  }
  if (state.gameplay.phase !== 'awaiting-turn') {
    return Object.freeze({ valid: false, reason: 'stage-complete', placementCells: Object.freeze([]) });
  }
  if (
    action.type === 'timeout' &&
    (state.timerMode === 'unlimited' || definition.timerSeconds === null)
  ) {
    return Object.freeze({ valid: false, reason: 'timer-disabled', placementCells: Object.freeze([]) });
  }
  if (action.type !== 'construct') {
    return Object.freeze({ valid: true, reason: null, placementCells: Object.freeze([]) });
  }

  const pieceId = state.gameplay.candidates[action.slot];
  const piece = definition.pieceDefinitions.find((candidate) => candidate.id === pieceId);
  if (piece === undefined) throw new Error(`missing candidate piece ${pieceId}`);
  const placement = resolvePiecePlacement(piece, action.anchorIndex, action.rotation);
  if (!placement.valid) {
    return Object.freeze({ valid: false, reason: placement.reason, placementCells: Object.freeze([]) });
  }
  for (const index of placement.cells) {
    if (definition.constructionMask[index] !== 1) {
      return Object.freeze({ valid: false, reason: 'construction-forbidden', placementCells: placement.cells });
    }
    const nextHeight = (state.gameplay.board.terrain[index] ?? -1) + piece.delta;
    if (nextHeight < MIN_TERRAIN_HEIGHT || nextHeight > MAX_TERRAIN_HEIGHT) {
      return Object.freeze({ valid: false, reason: 'terrain-limit', placementCells: placement.cells });
    }
  }
  if (state.gameplay.nextCandidateIndex >= definition.candidateSequence.length) {
    return Object.freeze({ valid: false, reason: 'candidate-exhausted', placementCells: placement.cells });
  }
  return Object.freeze({ valid: true, reason: null, placementCells: placement.cells });
}

function makeEntry(
  sequence: number,
  action: StageAction,
  beforeFullHash: string,
  afterFullHash: string
): StageReplayEntryV1 {
  return Object.freeze({
    sequence,
    action: parseStageAction(action),
    beforeFullHash,
    afterFullHash
  });
}

function assertReplaySequence(sequence: number, action: StageAction): void {
  if (
    !Number.isSafeInteger(sequence) ||
    sequence < 0 ||
    sequence >= MAX_STAGE_REPLAY_ENTRIES
  ) {
    throw new RangeError('stage replay sequence exceeds its limit');
  }
  if (sequence !== action.actionId) {
    throw new Error('stage replay sequence must equal the accepted action id');
  }
}

function reduceUndo(
  definition: ValidatedStageDefinition,
  state: StageReducerState,
  action: StageAction,
  sequence: number
): StageReduction {
  if (state.undoUsed) return rejected(state, 'undo-already-used');
  if (state.checkpoint === null) return rejected(state, 'undo-unavailable');
  assertReplaySequence(sequence, action);
  const beforeFullHash = hashFullStageState(definition, state);
  const restored = state.checkpoint;
  const nextState = freezeState({
    ...state,
    gameplay: restored,
    undoUsed: true,
    revision: checkedAdd(state.revision, 1, 'revision'),
    nextActionId: checkedAdd(state.nextActionId, 1, 'action id'),
    lastAcceptedAction: action,
    checkpoint: null
  });
  if (hashReversibleGameplay(nextState.gameplay) !== hashReversibleGameplay(restored)) {
    throw new Error('Undo reversible gameplay hash mismatch');
  }
  const entry = makeEntry(
    sequence,
    action,
    beforeFullHash,
    hashFullStageState(definition, nextState)
  );
  return Object.freeze({
    accepted: true,
    replayed: false,
    reason: null,
    state: nextState,
    trace: Object.freeze([traceEvent('undo')]),
    entry
  });
}

/** Pure high-level reducer. It never mutates the supplied state or definition. */
export function reduceStageAction(
  definition: ValidatedStageDefinition,
  state: StageReducerState,
  actionInput: StageAction | unknown,
  sequenceInput?: number
): StageReduction {
  const action = parseStageAction(actionInput);
  const sequence = sequenceInput ?? action.actionId;
  const lastAction = state.lastAcceptedAction;
  if (lastAction !== null && action.actionId === lastAction.actionId) {
    return actionFingerprint(action) === actionFingerprint(lastAction)
      ? replayed(state)
      : rejected(state, 'action-id-collision');
  }
  if (action.expectedRevision !== state.revision) {
    return rejected(state, 'stale-revision');
  }
  if (action.actionId !== state.nextActionId) {
    return rejected(state, 'stale-action-id');
  }
  if (action.type === 'undo') {
    return reduceUndo(definition, state, action, sequence);
  }
  if (state.gameplay.phase !== 'awaiting-turn') {
    return rejected(state, 'stage-complete');
  }
  if (
    action.type === 'timeout' &&
    (state.timerMode === 'unlimited' || definition.timerSeconds === null)
  ) {
    return rejected(state, 'timer-disabled');
  }

  let placementCells: readonly number[] = EMPTY_NUMBERS;
  let pieceDelta = 0;
  if (action.type === 'construct') {
    const pieceId = state.gameplay.candidates[action.slot];
    const piece = definition.pieceDefinitions.find((candidate) => candidate.id === pieceId);
    if (piece === undefined) throw new Error(`missing candidate piece ${pieceId}`);
    const placement = resolvePiecePlacement(piece, action.anchorIndex, action.rotation);
    if (!placement.valid) return rejected(state, placement.reason);
    for (const index of placement.cells) {
      if (definition.constructionMask[index] !== 1) {
        return rejected(state, 'construction-forbidden');
      }
      const nextHeight = (state.gameplay.board.terrain[index] ?? -1) + piece.delta;
      if (nextHeight < MIN_TERRAIN_HEIGHT || nextHeight > MAX_TERRAIN_HEIGHT) {
        return rejected(state, 'terrain-limit');
      }
    }
    if (state.gameplay.nextCandidateIndex >= definition.candidateSequence.length) {
      return rejected(state, 'candidate-exhausted');
    }
    placementCells = placement.cells;
    pieceDelta = piece.delta;
  }

  assertReplaySequence(sequence, action);

  const beforeFullHash = hashFullStageState(definition, state);
  const checkpoint = state.gameplay;
  const board = BoardState.fromSnapshot(state.gameplay.board);
  const candidates = [...state.gameplay.candidates] as [string, string];
  const candidateTokenIds = [...state.gameplay.candidateTokenIds] as [number, number];
  let nextCandidateIndex = state.gameplay.nextCandidateIndex;
  let metrics = state.gameplay.metrics;
  const trace: StageTraceEvent[] = [];

  if (action.type === 'construct') {
    board.applyTerrainDelta(placementCells, pieceDelta);
    const replacement = definition.candidateSequence[nextCandidateIndex];
    if (replacement === undefined) throw new RangeError('candidate sequence exhausted');
    candidates[action.slot] = replacement;
    candidateTokenIds[action.slot] = nextCandidateIndex;
    nextCandidateIndex += 1;
    metrics = freezeMetrics({
      ...metrics,
      work: checkedAdd(metrics.work, placementCells.length, 'construction work')
    });
  }
  trace.push(traceEvent('construction', { placementCells }));

  const turn = state.gameplay.completedTurns + 1;
  let nextRainIndex = state.gameplay.nextRainIndex;
  const rainEvent = definition.rainEvents[nextRainIndex];
  const rainCells = rainEvent?.turn === turn ? rainEvent.cells : EMPTY_RAIN;
  if (rainCells.length > 0) {
    board.addRain(rainCells);
    nextRainIndex += 1;
    const rainAmount = rainCells.reduce(
      (total, cell) => checkedAdd(total, cell.amount, 'rain water handled'),
      0
    );
    metrics = freezeMetrics({
      ...metrics,
      rainEventsHandled: checkedAdd(metrics.rainEventsHandled, 1, 'rain events handled'),
      rainWaterHandled: checkedAdd(metrics.rainWaterHandled, rainAmount, 'rain water handled')
    });
  }
  const rainProtectedOverflows = board.getProtectedOverflows();
  metrics = updateFloodMetrics(metrics, rainProtectedOverflows, board.flowStep);
  trace.push(traceEvent('rain', {
    rainCells,
    protectedOverflows: rainProtectedOverflows
  }));

  for (let step = 0; step < definition.flowStepsPerTurn; step += 1) {
    const result = advanceWaterFlow(board, { config: state.waterRules });
    metrics = updateMetricsForFlow(metrics, board, result);
    trace.push(traceEvent('flow', {
      flowStep: result.flowStep,
      protectedOverflows: result.protectedOverflows,
      flowResult: result
    }));
  }

  const boardSnapshot = board.snapshot();
  const completedTurns = turn;
  const objectiveMet = isObjectiveMet(definition, boardSnapshot, metrics);
  const atLastTurn = completedTurns === definition.maxTurns;
  const reasons = failureReasons(definition, metrics, atLastTurn, objectiveMet);
  const phase: StagePhase = reasons.length > 0
    ? 'failed'
    : atLastTurn && objectiveMet
      ? 'cleared'
      : 'awaiting-turn';
  const score = calculateScore(definition, boardSnapshot, metrics, phase === 'cleared');
  trace.push(traceEvent('evaluation'));

  const gameplay = freezeGameplay({
    board: boardSnapshot,
    completedTurns,
    candidates: Object.freeze(candidates),
    candidateTokenIds: Object.freeze(candidateTokenIds),
    nextCandidateIndex,
    nextRainIndex,
    randomState: state.gameplay.randomState,
    metrics,
    score,
    phase,
    objectiveMet,
    failureReasons: reasons
  });
  const nextState = freezeState({
    ...state,
    gameplay,
    revision: checkedAdd(state.revision, 1, 'revision'),
    nextActionId: checkedAdd(state.nextActionId, 1, 'action id'),
    lastAcceptedAction: action,
    checkpoint
  });
  const entry = makeEntry(
    sequence,
    action,
    beforeFullHash,
    hashFullStageState(definition, nextState)
  );
  return Object.freeze({
    accepted: true,
    replayed: false,
    reason: null,
    state: nextState,
    trace: Object.freeze(trace),
    entry
  });
}

/** Validates one action without mutating or advancing the session. */
export function validateStageAction(
  definition: ValidatedStageDefinition,
  state: StageReducerState,
  actionInput: StageAction | unknown
): StageActionValidation {
  const action = parseStageAction(actionInput);
  return validateActionAgainstState(definition, state, action);
}

/**
 * Previews construction, this turn's rain, and exactly one production flow
 * step on a clone. No candidate, timer, metrics, log, or source state advances.
 */
export function previewStageTurn(
  definition: ValidatedStageDefinition,
  state: StageReducerState,
  actionInput: StageAction | unknown
): StageTurnPreview | StageActionValidation {
  const action = parseStageAction(actionInput);
  const validation = validateActionAgainstState(definition, state, action);
  if (!validation.valid || action.type === 'undo') return validation;

  const board = BoardState.fromSnapshot(state.gameplay.board);
  if (action.type === 'construct') {
    const pieceId = state.gameplay.candidates[action.slot];
    const piece = definition.pieceDefinitions.find((candidate) => candidate.id === pieceId);
    if (piece === undefined) throw new Error(`missing candidate piece ${pieceId}`);
    board.applyTerrainDelta(validation.placementCells, piece.delta);
  }
  const terrainAfterConstruction = board.snapshot().terrain;
  const nextTurn = state.gameplay.completedTurns + 1;
  const rainEvent = definition.rainEvents[state.gameplay.nextRainIndex];
  const rainCells = rainEvent?.turn === nextTurn ? rainEvent.cells : EMPTY_RAIN;
  if (rainCells.length > 0) board.addRain(rainCells);
  const nextFlow = advanceWaterFlow(board, { config: state.waterRules });

  return Object.freeze({
    valid: true,
    action,
    placementCells: validation.placementCells,
    terrainAfterConstruction,
    rainCells: Object.freeze(
      rainCells.map((cell) => Object.freeze({ index: cell.index, amount: cell.amount }))
    ),
    nextFlow,
    boardAfterNextFlow: board.snapshot()
  });
}

function toSnapshot(
  definition: ValidatedStageDefinition,
  state: StageReducerState
): StageSessionSnapshot {
  return Object.freeze({
    stageId: definition.id,
    dataVersion: definition.dataVersion,
    definitionDigest: definition.definitionDigest,
    stageRulesVersion: STAGE_RULES_VERSION,
    timerMode: state.timerMode,
    waterRules: state.waterRules,
    ...state.gameplay,
    undoUsed: state.undoUsed,
    revision: state.revision,
    nextActionId: state.nextActionId
  });
}

function executionFrom(
  definition: ValidatedStageDefinition,
  reduction: StageReduction
): StageExecution {
  return Object.freeze({
    accepted: reduction.accepted,
    replayed: reduction.replayed,
    reason: reduction.reason,
    trace: reduction.trace,
    snapshot: toSnapshot(definition, reduction.state)
  });
}

export class StageSession {
  private readonly definition: ValidatedStageDefinition;
  private stateValue: StageReducerState;
  private readonly entriesValue: StageReplayEntryV1[] = [];
  private readonly initialFullHashValue: string;
  private lastExecutionValue: StageExecution | null = null;

  public constructor(
    definitionInput: ValidatedStageDefinition | unknown,
    timerMode: StageTimerMode = 'standard',
    waterConfig?: Partial<WaterModelConfig>
  ) {
    this.definition = parseValidatedStageDefinition(definitionInput);
    this.stateValue = createInitialStageState(this.definition, timerMode, waterConfig);
    this.initialFullHashValue = hashFullStageState(this.definition, this.stateValue);
  }

  public get snapshot(): StageSessionSnapshot {
    return toSnapshot(this.definition, this.stateValue);
  }

  public get fullStateHash(): string {
    return hashFullStageState(this.definition, this.stateValue);
  }

  public get reversibleGameplayHash(): string {
    return hashReversibleGameplay(this.stateValue.gameplay);
  }

  public get entries(): readonly StageReplayEntryV1[] {
    return Object.freeze(this.entriesValue.map((entry) => Object.freeze({
      ...entry,
      action: parseStageAction(entry.action)
    })));
  }

  public get rainForecast(): readonly StageRainForecast[] {
    return getStageRainForecast(this.definition, this.snapshot);
  }

  public validate(actionInput: StageAction | unknown): StageActionValidation {
    return validateStageAction(this.definition, this.stateValue, actionInput);
  }

  public preview(
    actionInput: StageAction | unknown
  ): StageTurnPreview | StageActionValidation {
    return previewStageTurn(this.definition, this.stateValue, actionInput);
  }

  public execute(actionInput: StageAction | unknown): StageExecution {
    const action = parseStageAction(actionInput);
    const reduction = reduceStageAction(
      this.definition,
      this.stateValue,
      action,
      this.entriesValue.length
    );
    if (reduction.replayed && this.lastExecutionValue !== null) {
      return Object.freeze({ ...this.lastExecutionValue, replayed: true });
    }
    if (!reduction.accepted) return executionFrom(this.definition, reduction);
    if (reduction.entry === null) throw new Error('accepted action is missing a replay entry');
    this.stateValue = reduction.state;
    this.entriesValue.push(reduction.entry);
    const execution = executionFrom(this.definition, reduction);
    this.lastExecutionValue = execution;
    return execution;
  }

  public exportReplay(): StageReplayV1 {
    return parseStageReplay({
      version: STAGE_REPLAY_VERSION,
      header: {
        stageId: this.definition.id,
        dataVersion: this.definition.dataVersion,
        definitionDigest: this.definition.definitionDigest,
        waterRules: this.stateValue.waterRules,
        stageRulesVersion: STAGE_RULES_VERSION,
        timerMode: this.stateValue.timerMode,
        initialFullHash: this.initialFullHashValue
      },
      entries: this.entriesValue
    });
  }
}

export function createStageSession(
  definition: ValidatedStageDefinition | unknown,
  timerMode: StageTimerMode = 'standard',
  waterConfig?: Partial<WaterModelConfig>
): StageSession {
  return new StageSession(definition, timerMode, waterConfig);
}

export function getStageRainForecast(
  definition: ValidatedStageDefinition,
  snapshot: Pick<StageSessionSnapshot, 'completedTurns' | 'nextRainIndex'>,
  maximumEvents = 2
): readonly StageRainForecast[] {
  if (!Number.isSafeInteger(maximumEvents) || maximumEvents < 0 || maximumEvents > 2) {
    throw new RangeError('maximumEvents must be an integer from 0 to 2');
  }
  const events = definition.rainEvents
    .slice(snapshot.nextRainIndex, snapshot.nextRainIndex + maximumEvents)
    .map((event, offset) => Object.freeze({
      eventIndex: snapshot.nextRainIndex + offset,
      turn: event.turn,
      turnsUntil: Math.max(0, event.turn - (snapshot.completedTurns + 1)),
      cells: Object.freeze(
        event.cells.map((cell) => Object.freeze({ index: cell.index, amount: cell.amount }))
      )
    }));
  return Object.freeze(events);
}

export function replayStageSession(
  definition: ValidatedStageDefinition,
  replayInput: StageReplayV1 | unknown
): StageSession {
  const replay = parseStageReplay(replayInput);
  if (
    replay.header.stageId !== definition.id ||
    replay.header.dataVersion !== definition.dataVersion ||
    replay.header.definitionDigest !== definition.definitionDigest
  ) {
    throw new Error('stage replay definition does not match the supplied stage');
  }
  if (
    replay.header.stageRulesVersion !== STAGE_RULES_VERSION ||
    replay.header.waterRules.version !== WATER_RULES_VERSION
  ) {
    throw new Error('stage replay rules do not match the supported rules');
  }
  const session = createStageSession(
    definition,
    replay.header.timerMode,
    replay.header.waterRules
  );
  if (session.fullStateHash !== replay.header.initialFullHash) {
    throw new Error('stage replay initial full-state hash mismatch');
  }
  for (const entry of replay.entries) {
    if (session.fullStateHash !== entry.beforeFullHash) {
      throw new Error(`stage replay before hash mismatch at entry ${entry.sequence}`);
    }
    const execution = session.execute(entry.action);
    if (!execution.accepted || execution.replayed) {
      throw new Error(`stage replay action rejected at entry ${entry.sequence}`);
    }
    if (session.fullStateHash !== entry.afterFullHash) {
      throw new Error(`stage replay after hash mismatch at entry ${entry.sequence}`);
    }
  }
  return session;
}
