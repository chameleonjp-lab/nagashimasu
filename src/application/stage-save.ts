import { parseStageReplay } from '../domain/stage-replay';
import type { StageReplayV1 } from '../domain/stage-replay';
import type { ProgressStorageLike } from './progress-storage';

export const STAGE_SAVE_VERSION = 'nagashimasu-stage-save-v1' as const;
export const STAGE_SAVE_STORAGE_KEY = 'nagashimasu.stage.v1';

const SAVE_KEYS = Object.freeze([
  'version',
  'replay',
  'fullStateHash',
  'reversibleGameplayHash'
] as const);
const STATE_HASH = /^[0-9a-f]{16}$/u;

export interface StageSaveV1 {
  readonly version: typeof STAGE_SAVE_VERSION;
  readonly replay: StageReplayV1;
  readonly fullStateHash: string;
  readonly reversibleGameplayHash: string;
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

function ownDataValue(value: PlainRecord, key: string, label: string): unknown {
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

function assertExactKeys(value: PlainRecord, expected: readonly string[], label: string): void {
  const expectedSet = new Set(expected);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !expectedSet.has(key)) {
      throw new TypeError(`${label} contains unknown key ${String(key)}`);
    }
    ownDataValue(value, key, label);
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`${label} is missing ${key}`);
  }
}

function stateHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !STATE_HASH.test(value)) {
    throw new TypeError(`${label} must be a 16-character lowercase hexadecimal hash`);
  }
  return value;
}

function storageValue(storage?: ProgressStorageLike): ProgressStorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Strictly validates and freezes an untrusted stage-save object. */
export function parseStageSave(value: unknown): StageSaveV1 {
  assertPlainRecord(value, 'stageSave');
  assertExactKeys(value, SAVE_KEYS, 'stageSave');
  if (ownDataValue(value, 'version', 'stageSave') !== STAGE_SAVE_VERSION) {
    throw new RangeError(`stageSave.version must be ${STAGE_SAVE_VERSION}`);
  }
  const replay = parseStageReplay(ownDataValue(value, 'replay', 'stageSave'));
  const fullStateHash = stateHash(
    ownDataValue(value, 'fullStateHash', 'stageSave'),
    'stageSave.fullStateHash'
  );
  const reversibleGameplayHash = stateHash(
    ownDataValue(value, 'reversibleGameplayHash', 'stageSave'),
    'stageSave.reversibleGameplayHash'
  );
  const lastEntry = replay.entries[replay.entries.length - 1];
  const expectedFullStateHash = lastEntry?.afterFullHash ?? replay.header.initialFullHash;
  if (fullStateHash !== expectedFullStateHash) {
    throw new Error('stageSave.fullStateHash does not match the replay endpoint');
  }
  return Object.freeze({
    version: STAGE_SAVE_VERSION,
    replay,
    fullStateHash,
    reversibleGameplayHash
  });
}

export function createStageSave(
  replay: StageReplayV1,
  fullStateHash: string,
  reversibleGameplayHash: string
): StageSaveV1 {
  return parseStageSave({
    version: STAGE_SAVE_VERSION,
    replay,
    fullStateHash,
    reversibleGameplayHash
  });
}

export function readStageSave(storage?: ProgressStorageLike): StageSaveV1 | null {
  const target = storageValue(storage);
  if (target === null) return null;
  let raw: string | null;
  try {
    raw = target.getItem(STAGE_SAVE_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    return parseStageSave(JSON.parse(raw) as unknown);
  } catch {
    try {
      target.removeItem(STAGE_SAVE_STORAGE_KEY);
    } catch {
      // Storage failures must not prevent a new session from starting.
    }
    return null;
  }
}

export function writeStageSave(
  save: StageSaveV1,
  storage?: ProgressStorageLike
): boolean {
  const target = storageValue(storage);
  if (target === null) return false;
  try {
    const parsed = parseStageSave(save);
    target.setItem(STAGE_SAVE_STORAGE_KEY, JSON.stringify(parsed));
    return true;
  } catch {
    return false;
  }
}

export function clearStageSave(storage?: ProgressStorageLike): void {
  const target = storageValue(storage);
  if (target === null) return;
  try {
    target.removeItem(STAGE_SAVE_STORAGE_KEY);
  } catch {
    // The in-memory session remains usable when localStorage is unavailable.
  }
}
