import {
  CELL_COUNT,
  MAX_CELL_WATER,
  MAX_TERRAIN_HEIGHT
} from './constants';
import type { WATER_RULES_VERSION } from './simulation';

export const STAGE_RULES_VERSION = 'nagashimasu-stage-rules-v1' as const;
export const STAGE_REPLAY_VERSION = 'nagashimasu-stage-replay-v1' as const;
export const MAX_STAGE_REPLAY_ENTRIES = 66;

type WaterRulesVersion = typeof WATER_RULES_VERSION;

// A type-only dependency keeps this codec standalone at runtime while making a
// change to M1's canonical constant fail compilation until this contract is
// intentionally versioned as well.
const EXPECTED_WATER_RULES_VERSION: WaterRulesVersion = 'nagashimasu-water-v1';
const SAFE_STAGE_ID = /^[A-Za-z0-9_-]{1,48}$/u;
const SAFE_DATA_VERSION = /^[A-Za-z0-9_-]{1,32}$/u;
const STATE_HASH = /^[0-9a-f]{16}$/u;

const REPLAY_KEYS = Object.freeze(['version', 'header', 'entries'] as const);
const HEADER_KEYS = Object.freeze([
  'stageId',
  'dataVersion',
  'definitionDigest',
  'waterRules',
  'stageRulesVersion',
  'timerMode',
  'initialFullHash'
] as const);
const WATER_RULES_KEYS = Object.freeze([
  'version',
  'heightUnit',
  'maxFlowPerStep'
] as const);
const ENTRY_KEYS = Object.freeze([
  'sequence',
  'action',
  'beforeFullHash',
  'afterFullHash'
] as const);
const BASE_ACTION_KEYS = Object.freeze([
  'type',
  'actionId',
  'expectedRevision'
] as const);
const CONSTRUCT_ACTION_KEYS = Object.freeze([
  ...BASE_ACTION_KEYS,
  'slot',
  'anchorIndex',
  'rotation'
] as const);

export type StageTimerMode = 'standard' | 'extended' | 'unlimited';
export type StageRotation = 0 | 1 | 2 | 3;
export type CandidateSlot = 0 | 1;

export interface ConstructStageAction {
  readonly type: 'construct';
  readonly actionId: number;
  readonly expectedRevision: number;
  readonly slot: CandidateSlot;
  readonly anchorIndex: number;
  readonly rotation: StageRotation;
}

export interface SkipStageAction {
  readonly type: 'skip';
  readonly actionId: number;
  readonly expectedRevision: number;
}

export interface TimeoutStageAction {
  readonly type: 'timeout';
  readonly actionId: number;
  readonly expectedRevision: number;
}

export interface UndoStageAction {
  readonly type: 'undo';
  readonly actionId: number;
  readonly expectedRevision: number;
}

export type StageAction =
  | ConstructStageAction
  | SkipStageAction
  | TimeoutStageAction
  | UndoStageAction;

export interface StageReplayWaterRulesV1 {
  readonly version: WaterRulesVersion;
  readonly heightUnit: number;
  readonly maxFlowPerStep: number;
}

export interface StageReplayHeaderV1 {
  readonly stageId: string;
  readonly dataVersion: string;
  readonly definitionDigest: string;
  readonly waterRules: StageReplayWaterRulesV1;
  readonly stageRulesVersion: typeof STAGE_RULES_VERSION;
  readonly timerMode: StageTimerMode;
  readonly initialFullHash: string;
}

export interface StageReplayEntryV1 {
  readonly sequence: number;
  readonly action: StageAction;
  readonly beforeFullHash: string;
  readonly afterFullHash: string;
}

export interface StageReplayV1 {
  readonly version: typeof STAGE_REPLAY_VERSION;
  readonly header: StageReplayHeaderV1;
  readonly entries: readonly StageReplayEntryV1[];
}

type PlainRecord = Record<string, unknown>;

function assertPlainRecord(value: unknown, label: string): asserts value is PlainRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain JSON object`);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain JSON object`);
  }
}

function ownDataValue(
  value: PlainRecord,
  key: string,
  label: string
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    descriptor === undefined ||
    !descriptor.enumerable ||
    !Object.hasOwn(descriptor, 'value')
  ) {
    throw new TypeError(`${label}.${key} must be a plain JSON value`);
  }
  return descriptor.value;
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
    ownDataValue(value, key, label);
  }

  for (const key of expectedKeys) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${label} is missing required key ${key}`);
    }
  }
}

function assertPlainJsonArray(
  value: unknown,
  maximumLength: number,
  label: string
): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON array`);
  }
  if (value.length > maximumLength) {
    throw new RangeError(`${label} must contain at most ${maximumLength} entries`);
  }

  const allowedKeys = new Set<string>(['length']);
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    allowedKeys.add(key);
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${label} must not contain a missing array entry at ${index}`);
    }
    ownDataValue(value as unknown as PlainRecord, key, label);
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowedKeys.has(key)) {
      throw new TypeError(`${label} contains unknown array key ${String(key)}`);
    }
  }
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new RangeError(`${label} must be a nonnegative safe integer`);
  }
  return value === 0 ? 0 : value;
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

function stateHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !STATE_HASH.test(value)) {
    throw new TypeError(
      `${label} must be a 16-character lowercase hexadecimal hash`
    );
  }
  return value;
}

function safeIdentifier(
  value: unknown,
  pattern: RegExp,
  maximumLength: number,
  label: string
): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new RangeError(
      `${label} must contain 1 to ${maximumLength} ASCII letters, digits, underscores, or hyphens`
    );
  }
  return value;
}

function parseAction(value: unknown, label: string): StageAction {
  assertPlainRecord(value, label);
  const type = ownDataValue(value, 'type', label);
  if (
    type !== 'construct' &&
    type !== 'skip' &&
    type !== 'timeout' &&
    type !== 'undo'
  ) {
    throw new RangeError(`${label}.type must be construct, skip, timeout, or undo`);
  }

  assertExactDataKeys(
    value,
    type === 'construct' ? CONSTRUCT_ACTION_KEYS : BASE_ACTION_KEYS,
    label
  );
  const actionId = nonnegativeInteger(value['actionId'], `${label}.actionId`);
  const expectedRevision = nonnegativeInteger(
    value['expectedRevision'],
    `${label}.expectedRevision`
  );

  if (type === 'construct') {
    return Object.freeze({
      type,
      actionId,
      expectedRevision,
      slot: integerInRange(value['slot'], 0, 1, `${label}.slot`) as CandidateSlot,
      anchorIndex: integerInRange(
        value['anchorIndex'],
        0,
        CELL_COUNT - 1,
        `${label}.anchorIndex`
      ),
      rotation: integerInRange(
        value['rotation'],
        0,
        3,
        `${label}.rotation`
      ) as StageRotation
    });
  }

  return Object.freeze({ type, actionId, expectedRevision });
}

/** Strictly validates and freezes one untrusted high-level stage action. */
export function parseStageAction(value: unknown, label = 'action'): StageAction {
  return parseAction(value, label);
}

function parseWaterRules(value: unknown): StageReplayWaterRulesV1 {
  const label = 'stageReplay.header.waterRules';
  assertPlainRecord(value, label);
  assertExactDataKeys(value, WATER_RULES_KEYS, label);
  const version = value['version'];
  if (version !== EXPECTED_WATER_RULES_VERSION) {
    throw new RangeError(`${label}.version must be ${EXPECTED_WATER_RULES_VERSION}`);
  }

  const maximumSafeHeightUnit = Math.floor(
    (Number.MAX_SAFE_INTEGER - MAX_CELL_WATER) / MAX_TERRAIN_HEIGHT
  );
  return Object.freeze({
    version,
    heightUnit: integerInRange(
      value['heightUnit'],
      1,
      maximumSafeHeightUnit,
      `${label}.heightUnit`
    ),
    maxFlowPerStep: integerInRange(
      value['maxFlowPerStep'],
      1,
      MAX_CELL_WATER,
      `${label}.maxFlowPerStep`
    )
  });
}

function parseHeader(value: unknown): StageReplayHeaderV1 {
  assertPlainRecord(value, 'stageReplay.header');
  assertExactDataKeys(value, HEADER_KEYS, 'stageReplay.header');

  const stageRulesVersion = value['stageRulesVersion'];
  if (stageRulesVersion !== STAGE_RULES_VERSION) {
    throw new RangeError(
      `stageReplay.header.stageRulesVersion must be ${STAGE_RULES_VERSION}`
    );
  }
  const timerMode = value['timerMode'];
  if (
    timerMode !== 'standard' &&
    timerMode !== 'extended' &&
    timerMode !== 'unlimited'
  ) {
    throw new RangeError(
      'stageReplay.header.timerMode must be standard, extended, or unlimited'
    );
  }

  return Object.freeze({
    stageId: safeIdentifier(
      value['stageId'],
      SAFE_STAGE_ID,
      48,
      'stageReplay.header.stageId'
    ),
    dataVersion: safeIdentifier(
      value['dataVersion'],
      SAFE_DATA_VERSION,
      32,
      'stageReplay.header.dataVersion'
    ),
    definitionDigest: stateHash(
      value['definitionDigest'],
      'stageReplay.header.definitionDigest'
    ),
    waterRules: parseWaterRules(value['waterRules']),
    stageRulesVersion,
    timerMode,
    initialFullHash: stateHash(
      value['initialFullHash'],
      'stageReplay.header.initialFullHash'
    )
  });
}

function parseEntry(value: unknown, index: number): StageReplayEntryV1 {
  const label = `stageReplay.entries[${index}]`;
  assertPlainRecord(value, label);
  assertExactDataKeys(value, ENTRY_KEYS, label);
  const sequence = integerInRange(
    value['sequence'],
    0,
    MAX_STAGE_REPLAY_ENTRIES - 1,
    `${label}.sequence`
  );
  if (sequence !== index) {
    throw new RangeError(`${label}.sequence must equal ${index}`);
  }

  const action = parseAction(value['action'], `${label}.action`);
  if (action.actionId !== sequence || action.expectedRevision !== sequence) {
    throw new RangeError(
      `${label}.action id and expected revision must equal sequence ${sequence}`
    );
  }
  return Object.freeze({
    sequence,
    action,
    beforeFullHash: stateHash(value['beforeFullHash'], `${label}.beforeFullHash`),
    afterFullHash: stateHash(value['afterFullHash'], `${label}.afterFullHash`)
  });
}

/**
 * Strictly validates, defensively copies, and deeply freezes StageReplay V1.
 * Execution semantics and state-hash equality remain the stage session's job.
 */
export function parseStageReplay(value: unknown): StageReplayV1 {
  assertPlainRecord(value, 'stageReplay');
  assertExactDataKeys(value, REPLAY_KEYS, 'stageReplay');
  if (value['version'] !== STAGE_REPLAY_VERSION) {
    throw new RangeError(`stageReplay.version must be ${STAGE_REPLAY_VERSION}`);
  }

  const header = parseHeader(value['header']);
  const entriesValue = value['entries'];
  assertPlainJsonArray(
    entriesValue,
    MAX_STAGE_REPLAY_ENTRIES,
    'stageReplay.entries'
  );
  const entries = entriesValue.map((entry, index) => parseEntry(entry, index));

  return Object.freeze({
    version: STAGE_REPLAY_VERSION,
    header,
    entries: Object.freeze(entries)
  });
}
