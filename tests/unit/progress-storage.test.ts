import { describe, expect, it } from 'vitest';

import {
  PROGRESS_SAVE_VERSION,
  PROGRESS_STORAGE_KEY,
  createDefaultProgress,
  markTutorialSeen,
  parseProgressSave,
  recordClearedStage,
  readProgress,
  setLastStageId,
  setProgressTimerMode,
  writeProgress
} from '../../src/application/progress-storage';
import type { ProgressStorageLike } from '../../src/application/progress-storage';

class FakeStorage implements ProgressStorageLike {
  public value: string | null = null;
  public lastKey: string | null = null;
  public removed = 0;
  public failReads = false;
  public failWrites = false;

  public getItem = (key: string): string | null => {
    if (this.failReads) throw new Error('read failed');
    this.lastKey = key;
    return this.value;
  };

  public setItem = (key: string, value: string): void => {
    if (this.failWrites) throw new Error('write failed');
    this.lastKey = key;
    this.value = value;
  };

  public removeItem = (key: string): void => {
    this.lastKey = key;
    this.removed += 1;
    this.value = null;
  };
}

describe('progress storage', () => {
  it('round-trips settings and keeps the best cleared result', () => {
    let progress = createDefaultProgress();
    progress = setProgressTimerMode(progress, 'extended');
    progress = setLastStageId(progress, 'stage-03-rain-order');
    progress = markTutorialSeen(progress);
    progress = recordClearedStage(progress, 'stage-03-rain-order', { total: 82, grade: 'A' });
    progress = recordClearedStage(progress, 'stage-03-rain-order', { total: 81, grade: 'S' });

    const storage = new FakeStorage();
    expect(writeProgress(progress, storage)).toBe(true);
    const loaded = readProgress(storage);
    expect(loaded.version).toBe(PROGRESS_SAVE_VERSION);
    expect(loaded.timerMode).toBe('extended');
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
      tutorialSeen: false,
      lastStageId: 'stage-01-first-pond',
      stages: []
    };
    expect(() => parseProgressSave({ ...base, extra: true })).toThrow(/unknown key/);
    expect(() => parseProgressSave({ ...base, timerMode: 'fast' })).toThrow(/timerMode/);
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
