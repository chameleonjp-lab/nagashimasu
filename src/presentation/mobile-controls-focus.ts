import type { StagePhase } from '../domain/stage-session';

export type MobileControlsFocusTarget =
  | 'close'
  | 'candidate-a'
  | 'candidate-b'
  | 'confirm'
  | 'retry';

export interface MobileControlsFocusInput {
  readonly phase: StagePhase;
  readonly hasPendingPlacement: boolean;
  readonly selectedCandidateSlot: 0 | 1 | null;
  readonly boardReady: boolean;
  readonly inputLocked: boolean;
  readonly playbackActive: boolean;
}

/** Chooses the first useful control after the mobile sheet becomes visible. */
export function mobileControlsFocusTarget(
  input: MobileControlsFocusInput
): MobileControlsFocusTarget {
  if (!input.boardReady || input.inputLocked || input.playbackActive) return 'close';
  if (input.phase !== 'awaiting-turn') return 'retry';
  if (input.hasPendingPlacement) return 'confirm';
  return input.selectedCandidateSlot === 1 ? 'candidate-b' : 'candidate-a';
}
