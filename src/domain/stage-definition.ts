import { BoardState } from './board';
import { CELL_COUNT, CellFlag, MAX_CELL_WATER } from './constants';
import {
  MAX_PIECE_DEFINITIONS,
  MAX_PIECE_OFFSETS,
  PIECE_SCHEMA_VERSION,
  parsePieceDefinitions
} from './pieces';
import type { PieceDefinition } from './pieces';
import type { RainEvent } from './types';

export const STAGE_SCHEMA_VERSION = 'nagashimasu-stage-v1' as const;
export const MAX_STAGE_ID_LENGTH = 48;
export const MAX_STAGE_DATA_VERSION_LENGTH = 32;
export const MAX_STAGE_NAME_LENGTH = 80;
export const MIN_STAGE_TURNS = 1;
export const MAX_STAGE_TURNS = 64;
export const MIN_FLOW_STEPS_PER_TURN = 2;
export const MAX_FLOW_STEPS_PER_TURN = 6;

const SAFE_STAGE_ID = /^[A-Za-z0-9_-]{1,48}$/u;
const SAFE_DATA_VERSION = /^[A-Za-z0-9_-]{1,32}$/u;
const STAGE_KEYS = Object.freeze([
  'schemaVersion',
  'id',
  'dataVersion',
  'name',
  'board',
  'constructionMask',
  'storageMask',
  'maxTurns',
  'flowStepsPerTurn',
  'timerSeconds',
  'pieceDefinitions',
  'candidateSequence',
  'rainEvents',
  'objective',
  'failure',
  'evaluation'
] as const);
const VALIDATED_STAGE_KEYS = Object.freeze([
  ...STAGE_KEYS,
  'definitionDigest'
] as const);
const DEFINITION_DIGEST = /^[0-9a-f]{16}$/u;
const BOARD_KEYS = Object.freeze([
  'terrain',
  'water',
  'cellFlags',
  'drainCapacity',
  'protectedWaterLimit',
  'safeEdgeMask',
  'dangerEdgeMask'
] as const);
const RAIN_EVENT_KEYS = Object.freeze(['turn', 'cells'] as const);
const RAIN_CELL_KEYS = Object.freeze(['index', 'amount'] as const);
const OBJECTIVE_KEYS = Object.freeze(['type', 'target'] as const);
const FAILURE_KEYS = Object.freeze([
  'maxDangerLeak',
  'maxPeakProtectedOverflow'
] as const);
const EVALUATION_KEYS = Object.freeze([
  'parWork',
  'controlTarget',
  'gradeThresholds'
] as const);
const GRADE_THRESHOLD_KEYS = Object.freeze(['s', 'a', 'b'] as const);

type PlainRecord = Record<string, unknown>;

export type StageObjectiveType = 'stored-water' | 'safe-drain' | 'protect';

export interface ValidatedBoardDefinition {
  readonly terrain: readonly number[];
  readonly water: readonly number[];
  readonly cellFlags: readonly number[];
  readonly drainCapacity: readonly number[];
  readonly protectedWaterLimit: readonly number[];
  readonly safeEdgeMask: readonly number[];
  readonly dangerEdgeMask: readonly number[];
}

export interface StageRainEvent {
  readonly turn: number;
  readonly cells: readonly RainEvent[];
}

export interface StageObjective {
  readonly type: StageObjectiveType;
  readonly target: number;
}

export interface StageFailureLimits {
  readonly maxDangerLeak: number;
  readonly maxPeakProtectedOverflow: number;
}

export interface StageGradeThresholds {
  readonly s: number;
  readonly a: number;
  readonly b: number;
}

export interface StageEvaluation {
  readonly parWork: number;
  readonly controlTarget: number;
  readonly gradeThresholds: StageGradeThresholds;
}

export interface StageDefinition {
  readonly schemaVersion: typeof STAGE_SCHEMA_VERSION;
  readonly id: string;
  readonly dataVersion: string;
  readonly name: string;
  readonly board: ValidatedBoardDefinition;
  readonly constructionMask: readonly (0 | 1)[];
  readonly storageMask: readonly (0 | 1)[];
  readonly maxTurns: number;
  readonly flowStepsPerTurn: number;
  readonly timerSeconds: number | null;
  readonly pieceDefinitions: readonly PieceDefinition[];
  readonly candidateSequence: readonly string[];
  readonly rainEvents: readonly StageRainEvent[];
  readonly objective: StageObjective;
  readonly failure: StageFailureLimits;
  readonly evaluation: StageEvaluation;
}

export interface ValidatedStageDefinition extends StageDefinition {
  /** Stable content identity; not a cryptographic signature. */
  readonly definitionDigest: string;
}

function assertPlainRecord(value: unknown, label: string): asserts value is PlainRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain JSON object`);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain JSON object`);
  }
}

function assertExactDataKeys(
  value: PlainRecord,
  expectedKeys: readonly string[],
  label: string
): void {
  const expected = new Set(expectedKeys);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !expected.has(key)) {
      throw new TypeError(`${label} contains unknown key ${String(key)}`);
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(`${label}.${key} must be a plain JSON value`);
    }
  }

  for (const key of expectedKeys) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${label} is missing required key ${key}`);
    }
  }
}

function assertPlainJsonArray(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
  label: string
): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON array`);
  }
  if (value.length < minimumLength || value.length > maximumLength) {
    const expected = minimumLength === maximumLength
      ? `exactly ${minimumLength}`
      : `${minimumLength} to ${maximumLength}`;
    throw new RangeError(`${label} must contain ${expected} entries`);
  }

  const allowedKeys = new Set<string>(['length']);
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    allowedKeys.add(key);
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${label} must not contain a missing array entry at ${index}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(`${label}[${index}] must be a plain JSON value`);
    }
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowedKeys.has(key)) {
      throw new TypeError(`${label} contains unknown array key ${String(key)}`);
    }
  }
}

function integerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new RangeError(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value === 0 ? 0 : value;
}

function boundedString(
  value: unknown,
  maximumLength: number,
  label: string
): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximumLength) {
    throw new RangeError(`${label} must contain 1 to ${maximumLength} characters`);
  }
  return value;
}

function plainDataProperty(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && Object.hasOwn(descriptor, 'value')
    ? descriptor.value
    : undefined;
}

function assertMaximumStringIfPresent(
  value: unknown,
  maximumLength: number,
  label: string
): void {
  if (typeof value === 'string' && value.length > maximumLength) {
    throw new RangeError(`${label} must not exceed ${maximumLength} characters`);
  }
}

/** Rejects every nested unbounded string/array before semantic board work. */
function assertNestedInputSizeBudgets(
  pieceDefinitions: unknown[],
  rainEvents: unknown[]
): void {
  for (let index = 0; index < pieceDefinitions.length; index += 1) {
    const piece = pieceDefinitions[index];
    assertMaximumStringIfPresent(
      plainDataProperty(piece, 'schemaVersion'),
      PIECE_SCHEMA_VERSION.length,
      `pieceDefinitions[${index}].schemaVersion`
    );
    assertMaximumStringIfPresent(
      plainDataProperty(piece, 'id'),
      MAX_STAGE_ID_LENGTH,
      `pieceDefinitions[${index}].id`
    );
    const offsets = plainDataProperty(piece, 'offsets');
    if (Array.isArray(offsets)) {
      assertPlainJsonArray(
        offsets,
        1,
        MAX_PIECE_OFFSETS,
        `pieceDefinitions[${index}].offsets`
      );
    }
  }

  for (let index = 0; index < rainEvents.length; index += 1) {
    const cells = plainDataProperty(rainEvents[index], 'cells');
    if (Array.isArray(cells)) {
      assertPlainJsonArray(cells, 1, CELL_COUNT, `rainEvents[${index}].cells`);
    }
  }
}

function parseNumberArray(value: unknown, label: string): readonly number[] {
  assertPlainJsonArray(value, CELL_COUNT, CELL_COUNT, label);
  const result = value.map((entry, index) => {
    if (typeof entry !== 'number') {
      throw new TypeError(`${label}[${index}] must be a number`);
    }
    return entry;
  });
  return Object.freeze(result);
}

function parseBoard(value: unknown): ValidatedBoardDefinition {
  assertPlainRecord(value, 'board');
  assertExactDataKeys(value, BOARD_KEYS, 'board');

  const terrain = parseNumberArray(value['terrain'], 'board.terrain');
  const water = parseNumberArray(value['water'], 'board.water');
  const cellFlags = parseNumberArray(value['cellFlags'], 'board.cellFlags');
  const drainCapacity = parseNumberArray(
    value['drainCapacity'],
    'board.drainCapacity'
  );
  const protectedWaterLimit = parseNumberArray(
    value['protectedWaterLimit'],
    'board.protectedWaterLimit'
  );
  const safeEdgeMask = parseNumberArray(value['safeEdgeMask'], 'board.safeEdgeMask');
  const dangerEdgeMask = parseNumberArray(
    value['dangerEdgeMask'],
    'board.dangerEdgeMask'
  );

  // BoardState remains the single source of truth for terrain, water, flags,
  // outlet, and boundary invariants. Its typed snapshot also normalizes -0.
  const snapshot = new BoardState({
    terrain,
    water,
    cellFlags,
    drainCapacity,
    protectedWaterLimit,
    safeEdgeMask,
    dangerEdgeMask
  }).snapshot();

  return Object.freeze({
    terrain: snapshot.terrain,
    water: snapshot.water,
    cellFlags: snapshot.cellFlags,
    drainCapacity: snapshot.drainCapacity,
    protectedWaterLimit: snapshot.protectedWaterLimit,
    safeEdgeMask: snapshot.safeEdgeMask,
    dangerEdgeMask: snapshot.dangerEdgeMask
  });
}

function parseMask(value: unknown, label: string): readonly (0 | 1)[] {
  assertPlainJsonArray(value, CELL_COUNT, CELL_COUNT, label);
  const mask = value.map((entry, index) => {
    if (entry !== 0 && entry !== 1) {
      throw new RangeError(`${label}[${index}] must be 0 or 1`);
    }
    return entry;
  });
  return Object.freeze(mask);
}

function parseCandidateSequence(
  value: unknown,
  maxTurns: number,
  knownPieceIds: ReadonlySet<string>
): readonly string[] {
  const expectedLength = maxTurns + 2;
  assertPlainJsonArray(value, expectedLength, expectedLength, 'candidateSequence');
  const sequence = value.map((entry, index) => {
    if (typeof entry !== 'string' || !knownPieceIds.has(entry)) {
      throw new RangeError(
        `candidateSequence[${index}] must reference a defined piece id`
      );
    }
    return entry;
  });
  return Object.freeze(sequence);
}

function parseRainCell(value: unknown, eventIndex: number, cellIndex: number): RainEvent {
  const label = `rainEvents[${eventIndex}].cells[${cellIndex}]`;
  assertPlainRecord(value, label);
  assertExactDataKeys(value, RAIN_CELL_KEYS, label);
  return Object.freeze({
    index: integerInRange(value['index'], 0, CELL_COUNT - 1, `${label}.index`),
    amount: integerInRange(value['amount'], 1, MAX_CELL_WATER, `${label}.amount`)
  });
}

function parseRainEvents(
  value: unknown,
  maxTurns: number,
  initialWater: number
): readonly StageRainEvent[] {
  assertPlainJsonArray(value, 0, maxTurns, 'rainEvents');
  let previousTurn = 0;
  let introducedWater = initialWater;

  const events = value.map((eventValue, eventIndex) => {
    const label = `rainEvents[${eventIndex}]`;
    assertPlainRecord(eventValue, label);
    assertExactDataKeys(eventValue, RAIN_EVENT_KEYS, label);
    const turn = integerInRange(eventValue['turn'], 1, maxTurns, `${label}.turn`);
    if (turn <= previousTurn) {
      throw new RangeError('rainEvents turns must be unique and strictly increasing');
    }
    previousTurn = turn;

    const cellsValue = eventValue['cells'];
    assertPlainJsonArray(cellsValue, 1, CELL_COUNT, `${label}.cells`);
    const seenIndices = new Set<number>();
    const cells = cellsValue.map((cellValue, cellIndex) => {
      const cell = parseRainCell(cellValue, eventIndex, cellIndex);
      if (seenIndices.has(cell.index)) {
        throw new RangeError(`${label}.cells contains duplicate index ${cell.index}`);
      }
      seenIndices.add(cell.index);
      introducedWater += cell.amount;
      if (introducedWater > MAX_CELL_WATER) {
        throw new RangeError(
          `initial water plus all rain must not exceed ${MAX_CELL_WATER}`
        );
      }
      return cell;
    });

    return Object.freeze({ turn, cells: Object.freeze(cells) });
  });

  return Object.freeze(events);
}

function parseObjective(value: unknown): StageObjective {
  assertPlainRecord(value, 'objective');
  assertExactDataKeys(value, OBJECTIVE_KEYS, 'objective');
  const type = value['type'];
  if (type !== 'stored-water' && type !== 'safe-drain' && type !== 'protect') {
    throw new RangeError(
      'objective.type must be stored-water, safe-drain, or protect'
    );
  }
  return Object.freeze({
    type,
    target: integerInRange(value['target'], 1, MAX_CELL_WATER, 'objective.target')
  });
}

function parseFailure(value: unknown): StageFailureLimits {
  assertPlainRecord(value, 'failure');
  assertExactDataKeys(value, FAILURE_KEYS, 'failure');
  return Object.freeze({
    maxDangerLeak: integerInRange(
      value['maxDangerLeak'],
      0,
      MAX_CELL_WATER,
      'failure.maxDangerLeak'
    ),
    maxPeakProtectedOverflow: integerInRange(
      value['maxPeakProtectedOverflow'],
      0,
      MAX_CELL_WATER,
      'failure.maxPeakProtectedOverflow'
    )
  });
}

function parseEvaluation(value: unknown): StageEvaluation {
  assertPlainRecord(value, 'evaluation');
  assertExactDataKeys(value, EVALUATION_KEYS, 'evaluation');
  const gradeValue = value['gradeThresholds'];
  assertPlainRecord(gradeValue, 'evaluation.gradeThresholds');
  assertExactDataKeys(
    gradeValue,
    GRADE_THRESHOLD_KEYS,
    'evaluation.gradeThresholds'
  );
  const s = integerInRange(gradeValue['s'], 0, 100, 'evaluation.gradeThresholds.s');
  const a = integerInRange(gradeValue['a'], 0, 100, 'evaluation.gradeThresholds.a');
  const b = integerInRange(gradeValue['b'], 0, 100, 'evaluation.gradeThresholds.b');
  if (!(s > a && a > b)) {
    throw new RangeError('grade thresholds must satisfy 100 >= s > a > b >= 0');
  }

  return Object.freeze({
    parWork: integerInRange(value['parWork'], 0, 192, 'evaluation.parWork'),
    controlTarget: integerInRange(
      value['controlTarget'],
      1,
      MAX_CELL_WATER,
      'evaluation.controlTarget'
    ),
    gradeThresholds: Object.freeze({ s, a, b })
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('digest input contains non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${members.join(',')}}`;
  }
  throw new TypeError('digest input is not JSON data');
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * Strictly validates, normalizes, and deeply freezes an untrusted stage value.
 * The accepted input is intentionally JSON-only and rejects all unknown keys.
 */
export function parseStageDefinition(value: unknown): ValidatedStageDefinition {
  assertPlainRecord(value, 'stage');
  assertExactDataKeys(value, STAGE_KEYS, 'stage');

  const schemaVersion = value['schemaVersion'];
  if (schemaVersion !== STAGE_SCHEMA_VERSION) {
    throw new RangeError(`stage.schemaVersion must be ${STAGE_SCHEMA_VERSION}`);
  }

  // Reject cheap size violations before parsing nested content.
  const id = boundedString(value['id'], MAX_STAGE_ID_LENGTH, 'stage.id');
  if (!SAFE_STAGE_ID.test(id)) {
    throw new RangeError(
      'stage.id must contain only ASCII letters, digits, underscores, or hyphens'
    );
  }
  const dataVersion = boundedString(
    value['dataVersion'],
    MAX_STAGE_DATA_VERSION_LENGTH,
    'stage.dataVersion'
  );
  if (!SAFE_DATA_VERSION.test(dataVersion)) {
    throw new RangeError(
      'stage.dataVersion must contain only ASCII letters, digits, underscores, or hyphens'
    );
  }
  const name = boundedString(value['name'], MAX_STAGE_NAME_LENGTH, 'stage.name');
  const maxTurns = integerInRange(
    value['maxTurns'],
    MIN_STAGE_TURNS,
    MAX_STAGE_TURNS,
    'stage.maxTurns'
  );
  assertPlainJsonArray(
    value['pieceDefinitions'],
    1,
    MAX_PIECE_DEFINITIONS,
    'pieceDefinitions'
  );
  assertPlainJsonArray(
    value['candidateSequence'],
    maxTurns + 2,
    maxTurns + 2,
    'candidateSequence'
  );
  for (let index = 0; index < value['candidateSequence'].length; index += 1) {
    const candidate = value['candidateSequence'][index];
    if (
      typeof candidate !== 'string' ||
      candidate.length < 1 ||
      candidate.length > MAX_STAGE_ID_LENGTH
    ) {
      throw new RangeError(
        `candidateSequence[${index}] must contain 1 to ${MAX_STAGE_ID_LENGTH} characters`
      );
    }
  }
  assertPlainJsonArray(value['rainEvents'], 0, maxTurns, 'rainEvents');
  assertPlainJsonArray(
    value['constructionMask'],
    CELL_COUNT,
    CELL_COUNT,
    'constructionMask'
  );
  assertPlainJsonArray(
    value['storageMask'],
    CELL_COUNT,
    CELL_COUNT,
    'storageMask'
  );
  assertMaximumStringIfPresent(
    plainDataProperty(value['objective'], 'type'),
    'stored-water'.length,
    'objective.type'
  );
  assertNestedInputSizeBudgets(value['pieceDefinitions'], value['rainEvents']);

  const board = parseBoard(value['board']);
  const constructionMask = parseMask(value['constructionMask'], 'constructionMask');
  const storageMask = parseMask(value['storageMask'], 'storageMask');
  const flowStepsPerTurn = integerInRange(
    value['flowStepsPerTurn'],
    MIN_FLOW_STEPS_PER_TURN,
    MAX_FLOW_STEPS_PER_TURN,
    'stage.flowStepsPerTurn'
  );
  const timerValue = value['timerSeconds'];
  const timerSeconds = timerValue === null
    ? null
    : integerInRange(timerValue, 5, 300, 'stage.timerSeconds');

  const pieceDefinitions = parsePieceDefinitions(value['pieceDefinitions']);
  const knownPieceIds = new Set(pieceDefinitions.map((piece) => piece.id));
  const candidateSequence = parseCandidateSequence(
    value['candidateSequence'],
    maxTurns,
    knownPieceIds
  );
  const initialWater = board.water.reduce((total, amount) => total + amount, 0);
  if (initialWater > MAX_CELL_WATER) {
    throw new RangeError(`initial water must not exceed ${MAX_CELL_WATER}`);
  }
  const rainEvents = parseRainEvents(value['rainEvents'], maxTurns, initialWater);
  const totalAvailableWater = rainEvents.reduce(
    (stageTotal, event) => event.cells.reduce(
      (eventTotal, cell) => eventTotal + cell.amount,
      stageTotal
    ),
    initialWater
  );
  const objective = parseObjective(value['objective']);
  if (objective.type === 'stored-water') {
    if (!storageMask.includes(1)) {
      throw new RangeError('stored-water objective requires at least one storage cell');
    }
    if (objective.target > totalAvailableWater) {
      throw new RangeError('stored-water objective target exceeds all available water');
    }
  } else if (objective.type === 'safe-drain') {
    const hasSafeOutlet = board.safeEdgeMask.some((mask) => mask !== 0) ||
      board.drainCapacity.some((capacity) => capacity !== 0);
    if (!hasSafeOutlet) {
      throw new RangeError('safe-drain objective requires a safe edge or drain cell');
    }
    if (objective.target > totalAvailableWater) {
      throw new RangeError('safe-drain objective target exceeds all available water');
    }
  } else {
    if (!board.cellFlags.some((flags) => (flags & CellFlag.Protected) !== 0)) {
      throw new RangeError('protect objective requires at least one protected cell');
    }
    if (objective.target > rainEvents.length) {
      throw new RangeError(
        'protect objective target exceeds the number of scheduled rain events'
      );
    }
  }
  const evaluation = parseEvaluation(value['evaluation']);

  const definition: StageDefinition = {
    schemaVersion,
    id,
    dataVersion,
    name,
    board,
    constructionMask,
    storageMask,
    maxTurns,
    flowStepsPerTurn,
    timerSeconds,
    pieceDefinitions,
    candidateSequence,
    rainEvents,
    objective,
    failure: parseFailure(value['failure']),
    evaluation
  };
  const definitionDigest = fnv1a64(canonicalJson(definition));
  return Object.freeze({ ...definition, definitionDigest });
}

/**
 * Revalidates a parsed stage at an execution boundary and verifies its digest.
 * This prevents structurally forged TypeScript/JavaScript values from bypassing
 * the strict raw StageDefinition codec.
 */
export function parseValidatedStageDefinition(
  value: unknown
): ValidatedStageDefinition {
  assertPlainRecord(value, 'validatedStage');
  assertExactDataKeys(value, VALIDATED_STAGE_KEYS, 'validatedStage');
  const suppliedDigest = value['definitionDigest'];
  if (typeof suppliedDigest !== 'string' || !DEFINITION_DIGEST.test(suppliedDigest)) {
    throw new TypeError(
      'validatedStage.definitionDigest must be a 16-character lowercase hexadecimal hash'
    );
  }

  const rawDefinition: Record<string, unknown> = {};
  for (const key of STAGE_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`validatedStage.${key} must be a plain JSON value`);
    }
    rawDefinition[key] = descriptor.value;
  }
  const parsed = parseStageDefinition(rawDefinition);
  if (parsed.definitionDigest !== suppliedDigest) {
    throw new Error('validatedStage definition digest does not match its content');
  }
  return parsed;
}
