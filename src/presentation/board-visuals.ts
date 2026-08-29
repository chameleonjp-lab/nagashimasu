import { clampPlaybackProgress } from './playback-visuals';

/** The largest water amount that needs a different visual level in the MVP. */
export const MAX_VISUAL_WATER = 24;

export interface WaterVisualLevel {
  readonly amount: number;
  readonly ratio: number;
  readonly lift: number;
  readonly depth: number;
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite number`);
  }
}

/**
 * Maps a domain water amount to a compact presentation level.
 *
 * The domain may hold much larger integers than the tutorial stages use. The
 * display intentionally saturates after MAX_VISUAL_WATER so that a flood is
 * still visible without allowing an extreme value to cover the whole board.
 */
export function waterVisualLevel(amount: number): WaterVisualLevel {
  assertNonNegativeFinite(amount, 'amount');
  const visibleAmount = Math.min(MAX_VISUAL_WATER, amount);
  const ratio = visibleAmount === 0 ? 0 : 0.2 + (visibleAmount / MAX_VISUAL_WATER) * 0.8;
  return Object.freeze({
    amount,
    ratio,
    lift: ratio * 0.34,
    depth: 0.08 + ratio * 0.22
  });
}

/** Returns one deterministic moving-particle phase for a transfer. */
export function flowParticleProgress(
  progress: number,
  particleIndex: number,
  particleCount: number
): number {
  if (!Number.isSafeInteger(particleIndex) || particleIndex < 0) {
    throw new RangeError('particleIndex must be a non-negative integer');
  }
  if (!Number.isSafeInteger(particleCount) || particleCount <= 0) {
    throw new RangeError('particleCount must be a positive integer');
  }
  if (particleIndex >= particleCount) {
    throw new RangeError('particleIndex must be smaller than particleCount');
  }
  const offset = particleIndex / particleCount;
  return (clampPlaybackProgress(progress) + offset) % 1;
}

