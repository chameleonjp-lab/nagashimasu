import { describe, expect, it } from 'vitest';

import {
  createDefaultProgress,
  recordClearedStage,
  writeProgress
} from '../../src/application/progress-storage';
import type { ProgressSaveV2, ProgressStorageLike } from '../../src/application/progress-storage';
import { finalizeClearedStage } from '../../src/application/clear-progress';

class RecordingStorage implements ProgressStorageLike {
  public value: string | null = null;
  public failWrites = false;

  public getItem = (): string | null => this.value;

  public setItem = (_key: string, value: string): void => {
    if (this.failWrites) throw new Error('write failed');
    this.value = value;
  };

  public removeItem = (): void => undefined;
}

function clearResult(total = 100, grade: 'S' | 'A' | 'B' | 'C' | null = 'S') {
  return { total, grade } as const;
}

describe('accepted clear persistence', () => {
  it('writes the clear before cleaning up the resumable stage save', () => {
    const storage = new RecordingStorage();
    const events: string[] = [];
    let progress: ProgressSaveV2 = createDefaultProgress();

    const outcome = finalizeClearedStage({
      progress,
      stageId: 'stage-01-first-pond',
      result: clearResult()
    }, {
      saveProgress: (next) => {
        events.push('save-progress');
        progress = next;
        return writeProgress(next, storage);
      },
      clearStageSave: () => {
        events.push('clear-stage-save');
        expect(storage.value).not.toBeNull();
      }
    });

    expect(outcome.saved).toBe(true);
    expect(progress.stages).toEqual([{
      stageId: 'stage-01-first-pond',
      cleared: true,
      bestTotal: 100,
      bestGrade: 'S'
    }]);
    expect(events).toEqual(['save-progress', 'clear-stage-save']);
  });

  it('keeps the result and resumable save when storage returns false', () => {
    const events: string[] = [];
    const outcome = finalizeClearedStage({
      progress: createDefaultProgress(),
      stageId: 'stage-01-first-pond',
      result: clearResult()
    }, {
      saveProgress: () => {
        events.push('save-progress');
        return false;
      },
      clearStageSave: () => events.push('clear-stage-save')
    });

    expect(outcome.saved).toBe(false);
    expect(outcome.progress.stages[0]?.cleared).toBe(true);
    expect(events).toEqual(['save-progress']);
  });

  it('treats a storage exception like a rejected write', () => {
    const events: string[] = [];
    const outcome = finalizeClearedStage({
      progress: createDefaultProgress(),
      stageId: 'stage-01-first-pond',
      result: clearResult()
    }, {
      saveProgress: () => {
        events.push('save-progress');
        throw new Error('quota exceeded');
      },
      clearStageSave: () => events.push('clear-stage-save')
    });

    expect(outcome.saved).toBe(false);
    expect(outcome.progress.stages[0]?.cleared).toBe(true);
    expect(events).toEqual(['save-progress']);
  });

  it('preserves an existing higher score when a clear notification repeats', () => {
    let progress = recordClearedStage(createDefaultProgress(), 'stage-01-first-pond', clearResult(100, 'S'));
    const events: string[] = [];
    const outcome = finalizeClearedStage({
      progress,
      stageId: 'stage-01-first-pond',
      result: clearResult(80, 'A')
    }, {
      saveProgress: (next) => {
        events.push('save-progress');
        progress = next;
        return true;
      },
      clearStageSave: () => events.push('clear-stage-save')
    });

    expect(outcome.saved).toBe(true);
    expect(progress.stages[0]?.bestTotal).toBe(100);
    expect(progress.stages[0]?.bestGrade).toBe('S');
    expect(events).toEqual(['save-progress', 'clear-stage-save']);
  });

  it('keeps a successful clear when save cleanup itself throws', () => {
    const events: string[] = [];
    const outcome = finalizeClearedStage({
      progress: createDefaultProgress(),
      stageId: 'stage-01-first-pond',
      result: clearResult()
    }, {
      saveProgress: () => {
        events.push('save-progress');
        return true;
      },
      clearStageSave: () => {
        events.push('clear-stage-save');
        throw new Error('remove failed');
      }
    });

    expect(outcome.saved).toBe(true);
    expect(outcome.progress.stages[0]?.cleared).toBe(true);
    expect(events).toEqual(['save-progress', 'clear-stage-save']);
  });
});
