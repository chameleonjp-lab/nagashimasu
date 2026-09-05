import { describe, expect, it } from 'vitest';

import {
  LEGACY_PROGRESS_STORAGE_KEY,
  PROGRESS_SAVE_VERSION,
  PROGRESS_STORAGE_KEY,
  createDefaultProgress,
  markTutorialSeen,
  parseProgressSave,
  recordClearedStage,
  readProgress,
  setProgressPlaybackSpeed,
  setLastStageId,
  setProgressTimerMode,
  writeProgress
} from '../../src/application/progress-storage';
import type { ProgressStorageLike } from '../../src/application/progress-storage';

class FakeStorage implements ProgressStorageLike {
  public value: string | null = null;
  public values = new Map<string, string | null>();
  public lastKey: string | null = null;
  public removed = 0;
  public failReads = false;
  public failWrites = false;

  public getItem = (key: string): string | null => {
    if (this.failReads) throw new Error('read failed');
    this.lastKey = key;
    return this.values.has(key) ? this.values.get(key) ?? null : this.value;
  };

  public setItem = (key: string, value: string): void => {
    if (this.failWrites) throw new Error('write failed');
    this.lastKey = key;
    this.value = value;
    this.values.set(key, value);
  };

  public removeItem = (key: string): void => {
    this.lastKey = key;
    this.removed += 1;
    this.values.delete(key);
    if (key === PROGRESS_STORAGE_KEY) this.value = null;
  };
}

describe('progress storage', () => {
  it('starts new players with the longer thinking-time preset', () => {
    expect(createDefaultProgress().timerMode).toBe('extended');
  });

  it('round-trips settings and keeps the best cleared result', () => {
    let progress = createDefaultProgress();
    progress = setProgressTimerMode(progress, 'extended');
    progress = setProgressPlaybackSpeed(progress, 'fast');
    progress = setLastStageId(progress, 'stage-03-rain-order');
    progress = markTutorialSeen(progress);
    progress = recordClearedStage(progress, 'stage-03-rain-order', { total: 82, grade: 'A' });
    progress = recordClearedStage(progress, 'stage-03-rain-order', { total: 81, grade: 'S' });

    const storage = new FakeStorage();
    expect(writeProgress(progress, storage)).toBe(true);
    const loaded = readProgress(storage);
    expect(loaded.version).toBe(PROGRESS_SAVE_VERSION);
    expect(loaded.timerMode).toBe('extended');
    expect(loaded.playbackSpeed).toBe('fast');
    expect(loaded.tutorialSeen).toBe(true);
    expect(loaded.lastStageId).toBe('stage-03-rain-order');
    expect(loaded.stages).toEqual([{
      stageId: 'stage-03-rain-order',
      cleared: true,
      bestTotal: 82,
      bestGrade: 'A'
    }]);
    expect(storage.value).not.toBeNull();
    expect(storage.lastKey).toBe(PROGRESS_STORAGE_KEY);
  });

  it('uses the better grade when totals tie', () => {
    let progress = recordClearedStage(createDefaultProgress(), 'stage-01-first-pond', {
      total: 80,
      grade: 'B'
    });
    progress = recordClearedStage(progress, 'stage-01-first-pond', {
      total: 80,
      grade: 'A'
    });
    expect(progress.stages[0]?.bestGrade).toBe('A');
  });

  it('rejects malformed or ambiguous progress values', () => {
    const base = {
      version: PROGRESS_SAVE_VERSION,
      timerMode: 'standard',
      playbackSpeed: 'standard',
      tutorialSeen: false,
      lastStageId: 'stage-01-first-pond',
      stages: []
    };
    expect(() => parseProgressSave({ ...base, extra: true })).toThrow(/unknown key/);
    expect(() => parseProgressSave({ ...base, timerMode: 'fast' })).toThrow(/timerMode/);
    expect(() => parseProgressSave({ ...base, playbackSpeed: 'slow' })).toThrow(/playbackSpeed/);
    expect(() => parseProgressSave({
      ...base,
      stages: [{
        stageId: 'stage-01-first-pond',
        cleared: true,
        bestTotal: 100,
        bestGrade: 'S'
      }, {
        stageId: 'stage-01-first-pond',
        cleared: true,
        bestTotal: 90,
        bestGrade: 'A'
      }]
    })).toThrow(/duplicate/);
    expect(() => parseProgressSave({
      ...base,
      stages: [{ stageId: 'stage/invalid', cleared: false, bestTotal: null, bestGrade: null }]
    })).toThrow(/stageId/);
  });

  it('migrates a valid v1 save without losing its settings or cleared stages', () => {
    const storage = new FakeStorage();
    storage.values.set(LEGACY_PROGRESS_STORAGE_KEY, JSON.stringify({
      version: 'nagashimasu-progress-v1',
      timerMode: 'unlimited',
      tutorialSeen: true,
      lastStageId: 'stage-02-open-to-sea',
      stages: [{
        stageId: 'stage-02-open-to-sea',
        cleared: true,
        bestTotal: 78,
        bestGrade: 'B'
      }]
    }));

    const migrated = readProgress(storage);
    expect(migrated.version).toBe(PROGRESS_SAVE_VERSION);
    expect(migrated.playbackSpeed).toBe('standard');
    expect(migrated.timerMode).toBe('unlimited');
    expect(migrated.lastStageId).toBe('stage-02-open-to-sea');
    expect(migrated.stages[0]?.bestTotal).toBe(78);
  });

  it('clears corrupt values and keeps the game usable when storage fails', () => {
    const storage = new FakeStorage();
    storage.value = '{"version":"broken"}';
    expect(readProgress(storage)).toEqual(createDefaultProgress());
    expect(storage.removed).toBe(1);

    storage.failReads = true;
    expect(readProgress(storage)).toEqual(createDefaultProgress());

    const failingWrites = new FakeStorage();
    failingWrites.failWrites = true;
    expect(writeProgress(createDefaultProgress(), failingWrites)).toBe(false);
  });
});
