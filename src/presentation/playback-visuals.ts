/**
 * Converts trace playback progress into small, deterministic visual changes.
 * This module is presentation-only: it never changes a stage or water state.
 */

export function clampPlaybackProgress(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Returns a smooth 0..1 pulse which peaks in the middle of a trace segment. */
export function playbackPulse(value: number | null | undefined): number {
  return Math.sin(Math.PI * clampPlaybackProgress(value));
}

/** Keeps the highlight visible without animating it when motion is reduced. */
export function playbackPulseForMotion(
  value: number | null | undefined,
  reducedMotion: boolean
): number {
  return reducedMotion ? 0.5 : playbackPulse(value);
}
