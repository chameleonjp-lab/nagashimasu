export const PROGRESS_SAVE_VERSION = 'nagashimasu-progress-v2' as const;
export const PROGRESS_STORAGE_KEY = 'nagashimasu.progress.v2';
export const LEGACY_PROGRESS_SAVE_VERSION = 'nagashimasu-progress-v1' as const;
export const LEGACY_PROGRESS_STORAGE_KEY = 'nagashimasu.progress.v1';
export const MAX_SAVED_STAGE_ENTRIES = 64;

const SAFE_STAGE_ID = /^[A-Za-z0-9_-]{1,48}$/u;
const SAVE_KEYS_V2 = Object.freeze([
  'version',
  'timerMode',
  'playbackSpeed',
  'tutorialSeen',
  'lastStageId',
  'stages'
] as const);
const SAVE_KEYS_V1 = Object.freeze([
  'version',
  'timerMode',
  'tutorialSeen',
  'lastStageId',
  'stages'
] as const);
const STAGE_KEYS = Object.freeze([
  'stageId',
  'cleared',
  'bestTotal',
  'bestGrade'
] as const);

export type ProgressTimerMode = 'standard' | 'extended' | 'unlimited';
export type ProgressPlaybackSpeed = 'standard' | 'fast';
export type ProgressGrade = 'S' | 'A' | 'B' | 'C';

export interface SavedStageProgress {
  readonly stageId: string;
  readonly cleared: boolean;
  readonly bestTotal: number | null;
  readonly bestGrade: ProgressGrade | null;
}

export interface ProgressSaveV1 {
  readonly version: typeof LEGACY_PROGRESS_SAVE_VERSION;
  readonly timerMode: ProgressTimerMode;
  readonly tutorialSeen: boolean;
  readonly lastStageId: string;
  readonly stages: readonly SavedStageProgress[];
}

export interface ProgressSaveV2 {
  readonly version: typeof PROGRESS_SAVE_VERSION;
  readonly timerMode: ProgressTimerMode;
  readonly playbackSpeed: ProgressPlaybackSpeed;
  readonly tutorialSeen: boolean;
  readonly lastStageId: string;
  readonly stages: readonly SavedStageProgress[];
}

export interface StageResultToSave {
  readonly total: number;
  readonly grade: ProgressGrade | null;
}

export interface ProgressStorageLike {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
}

type PlainRecord = Record<string, unknown>;

const DEFAULT_PROGRESS: ProgressSaveV2 = Object.freeze({
  version: PROGRESS_SAVE_VERSION,
  // Stage 3 is the first timed stage. Give a new player the longer preset
  // while keeping standard and unlimited available in the stage picker.
  timerMode: 'extended',
  playbackSpeed: 'standard',
  tutorialSeen: false,
  lastStageId: 'stage-01-first-pond',
  stages: Object.freeze([])
});

function assertPlainRecord(value: unknown, label: string): asserts value is PlainRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain JSON object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain JSON object`);
  }
}

function dataValue(value: PlainRecord, key: string, label: string): unknown {
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

function exactKeys(value: PlainRecord, expectedKeys: readonly string[], label: string): void {
  const expected = new Set(expectedKeys);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !expected.has(key)) {
      throw new TypeError(`${label} contains unknown key ${String(key)}`);
    }
    dataValue(value, key, label);
  }
  for (const key of expectedKeys) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${label} is missing required key ${key}`);
    }
  }
}

function plainArray(value: unknown, maximumLength: number, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be a JSON array`);
  if (value.length > maximumLength) {
    throw new RangeError(`${label} must contain at most ${maximumLength} entries`);
  }
  const allowedKeys = new Set<string>(['length']);
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    allowedKeys.add(key);
    if (!Object.hasOwn(value, key)) throw new TypeError(`${label} has a missing entry at ${index}`);
    dataValue(value as unknown as PlainRecord, key, label);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowedKeys.has(key)) {
      throw new TypeError(`${label} contains unknown array key ${String(key)}`);
    }
  }
}

function stageId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SAFE_STAGE_ID.test(value)) {
    throw new RangeError(`${label} must contain 1 to 48 ASCII letters, digits, underscores, or hyphens`);
  }
  return value;
}

function timerMode(value: unknown, label: string): ProgressTimerMode {
  if (value !== 'standard' && value !== 'extended' && value !== 'unlimited') {
    throw new RangeError(`${label} must be standard, extended, or unlimited`);
  }
  return value;
}

function playbackSpeed(value: unknown, label: string): ProgressPlaybackSpeed {
  if (value !== 'standard' && value !== 'fast') {
    throw new RangeError(`${label} must be standard or fast`);
  }
  return value;
}

function grade(value: unknown, label: string): ProgressGrade | null {
  if (value === null) return null;
  if (value !== 'S' && value !== 'A' && value !== 'B' && value !== 'C') {
    throw new RangeError(`${label} must be S, A, B, C, or null`);
  }
  return value;
}

function total(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 100) {
    throw new RangeError(`${label} must be an integer from 0 to 100 or null`);
  }
  return value;
}

function parseStage(value: unknown, index: number): SavedStageProgress {
  const label = `progress.stages[${index}]`;
  assertPlainRecord(value, label);
  exactKeys(value, STAGE_KEYS, label);
  const stageIdValue = stageId(dataValue(value, 'stageId', label), `${label}.stageId`);
  const cleared = dataValue(value, 'cleared', label);
  if (typeof cleared !== 'boolean') throw new TypeError(`${label}.cleared must be boolean`);
  const bestTotal = total(dataValue(value, 'bestTotal', label), `${label}.bestTotal`);
  const bestGrade = grade(dataValue(value, 'bestGrade', label), `${label}.bestGrade`);
  if (!cleared && (bestTotal !== null || bestGrade !== null)) {
    throw new RangeError(`${label} cannot have a best result before clearing`);
  }
  if (bestGrade !== null && bestTotal === null) {
    throw new RangeError(`${label}.bestGrade requires bestTotal`);
  }
  return Object.freeze({
    stageId: stageIdValue,
    cleared,
    bestTotal,
    bestGrade
  });
}

function parseProgressFields(
  value: PlainRecord,
  speed: ProgressPlaybackSpeed
): ProgressSaveV2 {
  const stagesValue = dataValue(value, 'stages', 'progress');
  plainArray(stagesValue, MAX_SAVED_STAGE_ENTRIES, 'progress.stages');
  const stages = stagesValue.map((entry, index) => parseStage(entry, index));
  const seen = new Set<string>();
  for (const entry of stages) {
    if (seen.has(entry.stageId)) throw new RangeError(`progress.stages contains duplicate ${entry.stageId}`);
    seen.add(entry.stageId);
  }
  stages.sort((left, right) => left.stageId < right.stageId ? -1 : left.stageId > right.stageId ? 1 : 0);

  return Object.freeze({
    version: PROGRESS_SAVE_VERSION,
    timerMode: timerMode(dataValue(value, 'timerMode', 'progress'), 'progress.timerMode'),
    playbackSpeed: speed,
    tutorialSeen: (() => {
      const seenValue = dataValue(value, 'tutorialSeen', 'progress');
      if (typeof seenValue !== 'boolean') throw new TypeError('progress.tutorialSeen must be boolean');
      return seenValue;
    })(),
    lastStageId: stageId(dataValue(value, 'lastStageId', 'progress'), 'progress.lastStageId'),
    stages: Object.freeze(stages)
  });
}

function parseLegacyProgress(value: PlainRecord): ProgressSaveV2 {
  exactKeys(value, SAVE_KEYS_V1, 'progress');
  if (dataValue(value, 'version', 'progress') !== LEGACY_PROGRESS_SAVE_VERSION) {
    throw new RangeError(`progress.version must be ${LEGACY_PROGRESS_SAVE_VERSION}`);
  }
  return parseProgressFields(value, 'standard');
}

/** Strictly validates, copies, freezes, and migrates an untrusted progress value. */
export function parseProgressSave(value: unknown): ProgressSaveV2 {
  assertPlainRecord(value, 'progress');
  const version = dataValue(value, 'version', 'progress');
  if (version === LEGACY_PROGRESS_SAVE_VERSION) return parseLegacyProgress(value);
  exactKeys(value, SAVE_KEYS_V2, 'progress');
  if (version !== PROGRESS_SAVE_VERSION) {
    throw new RangeError(`progress.version must be ${PROGRESS_SAVE_VERSION}`);
  }
  return parseProgressFields(
    value,
    playbackSpeed(dataValue(value, 'playbackSpeed', 'progress'), 'progress.playbackSpeed')
  );
}

export function createDefaultProgress(): ProgressSaveV2 {
  return DEFAULT_PROGRESS;
}

function updateProgress(
  progress: ProgressSaveV2,
  changes: Partial<Pick<ProgressSaveV2, 'timerMode' | 'playbackSpeed' | 'tutorialSeen' | 'lastStageId'>>
): ProgressSaveV2 {
  return parseProgressSave({ ...progress, ...changes, stages: progress.stages });
}

export function setProgressTimerMode(
  progress: ProgressSaveV2,
  value: ProgressTimerMode
): ProgressSaveV2 {
  return updateProgress(progress, { timerMode: value });
}

export function setProgressPlaybackSpeed(
  progress: ProgressSaveV2,
  value: ProgressPlaybackSpeed
): ProgressSaveV2 {
  return updateProgress(progress, { playbackSpeed: value });
}

export function markTutorialSeen(progress: ProgressSaveV2): ProgressSaveV2 {
  return updateProgress(progress, { tutorialSeen: true });
}

export function setLastStageId(progress: ProgressSaveV2, stageIdValue: string): ProgressSaveV2 {
  return updateProgress(progress, { lastStageId: stageIdValue });
}

function gradeRank(value: ProgressGrade | null): number {
  switch (value) {
    case 'S': return 4;
    case 'A': return 3;
    case 'B': return 2;
    case 'C': return 1;
    case null: return 0;
  }
}

export function recordClearedStage(
  progress: ProgressSaveV2,
  stageIdValue: string,
  result: StageResultToSave
): ProgressSaveV2 {
  const id = stageId(stageIdValue, 'stageId');
  const validatedTotal = total(result.total, 'result.total');
  if (validatedTotal === null) throw new RangeError('result.total must be an integer from 0 to 100');
  const validatedGrade = grade(result.grade, 'result.grade');
  const existing = progress.stages.find((entry) => entry.stageId === id);
  const shouldReplace = existing === undefined ||
    existing.bestTotal === null ||
    validatedTotal > existing.bestTotal ||
    (validatedTotal === existing.bestTotal && gradeRank(validatedGrade) > gradeRank(existing.bestGrade));
  const nextEntry: SavedStageProgress = Object.freeze({
    stageId: id,
    cleared: true,
    bestTotal: shouldReplace ? validatedTotal : existing?.bestTotal ?? validatedTotal,
    bestGrade: shouldReplace ? validatedGrade : existing?.bestGrade ?? validatedGrade
  });
  const stages = progress.stages.filter((entry) => entry.stageId !== id);
  stages.push(nextEntry);
  return parseProgressSave({ ...progress, stages });
}

function browserStorage(): ProgressStorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    const storage = window.localStorage;
    return {
      getItem: (key) => storage.getItem(key),
      setItem: (key, value) => storage.setItem(key, value),
      removeItem: (key) => storage.removeItem(key)
    };
  } catch {
    return null;
  }
}

export function readProgress(storage: ProgressStorageLike | null = browserStorage()): ProgressSaveV2 {
  if (storage === null) return createDefaultProgress();
  let raw: string | null;
  try {
    raw = storage.getItem(PROGRESS_STORAGE_KEY);
  } catch {
    return createDefaultProgress();
  }
  if (raw !== null) {
    try {
      return parseProgressSave(JSON.parse(raw) as unknown);
    } catch {
      try { storage.removeItem(PROGRESS_STORAGE_KEY); } catch { /* storage is unavailable */ }
    }
  }

  try {
    raw = storage.getItem(LEGACY_PROGRESS_STORAGE_KEY);
  } catch {
    return createDefaultProgress();
  }
  if (raw === null) return createDefaultProgress();
  try {
    return parseProgressSave(JSON.parse(raw) as unknown);
  } catch {
    try { storage.removeItem(LEGACY_PROGRESS_STORAGE_KEY); } catch { /* storage is unavailable */ }
    return createDefaultProgress();
  }
}

export function writeProgress(
  progress: ProgressSaveV2,
  storage: ProgressStorageLike | null = browserStorage()
): boolean {
  if (storage === null) return false;
  const validated = parseProgressSave(progress);
  try {
    storage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(validated));
    return true;
  } catch {
    return false;
  }
}
