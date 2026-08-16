export type VisibilityResumePhase = 'awaiting-turn' | 'cleared' | 'failed';

export interface VisibilityResumeState {
  readonly pageHidden: boolean;
  readonly paused: boolean;
  readonly playbackActive: boolean;
  readonly phase: VisibilityResumePhase;
  readonly timerActive: boolean;
}

/**
 * Decides whether a visibility callback must create a fresh thinking timer.
 * A playback that finished while the page was hidden leaves no timer behind;
 * terminal and explicitly paused sessions must remain stopped.
 */
export function shouldStartTurnTimerAfterVisibility(
  state: VisibilityResumeState
): boolean {
  return !state.pageHidden &&
    !state.paused &&
    !state.playbackActive &&
    state.phase === 'awaiting-turn' &&
    !state.timerActive;
}
