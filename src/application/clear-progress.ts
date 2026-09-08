import {
  recordClearedStage
} from './progress-storage';
import type {
  ProgressSaveV2,
  StageResultToSave
} from './progress-storage';

/**
 * The small adapter used when a turn has been accepted as a clear.
 *
 * Keeping this boundary in the application layer makes the ordering explicit:
 * the durable clear record is attempted first and the resumable stage save is
 * removed only after that attempt succeeds. Presentation code can provide its
 * own storage and cleanup functions in tests without constructing the UI.
 */
export interface ClearProgressPersistenceAdapter {
  readonly saveProgress: (progress: ProgressSaveV2) => boolean;
  readonly clearStageSave: () => void;
}

export interface AcceptedClearProgressInput {
  readonly progress: ProgressSaveV2;
  readonly stageId: string;
  readonly result: StageResultToSave;
}

export interface AcceptedClearProgressOutcome {
  readonly progress: ProgressSaveV2;
  readonly saved: boolean;
}

/**
 * Persists an accepted clear before playback starts.
 *
 * A storage adapter is allowed to return false or throw. Both cases leave the
 * current in-memory result available to the caller and deliberately skip save
 * cleanup so a resumable pre-clear session can still be retried.
 */
export function finalizeClearedStage(
  input: AcceptedClearProgressInput,
  adapter: ClearProgressPersistenceAdapter
): AcceptedClearProgressOutcome {
  const nextProgress = recordClearedStage(input.progress, input.stageId, input.result);
  let saved = false;
  try {
    saved = adapter.saveProgress(nextProgress) === true;
  } catch {
    saved = false;
  }
  if (saved) {
    try {
      adapter.clearStageSave();
    } catch {
      // The clear record is already durable. Cleanup is best effort and must
      // never turn a successful result into a failed game action.
    }
  }
  return Object.freeze({ progress: nextProgress, saved });
}

// Keep a descriptive alias for callers that use the persistence terminology.
export const persistAcceptedClear = finalizeClearedStage;
