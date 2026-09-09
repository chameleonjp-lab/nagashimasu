import { clampPlaybackProgress } from './playback-visuals';
import { DEFAULT_HEIGHT_UNIT, MAX_TERRAIN_HEIGHT } from '../domain/constants';
import type { ValidatedStageDefinition } from '../domain/stage-definition';

/** The minimum water amount represented by the presentation scale. */
export const MAX_VISUAL_WATER = 24;

export interface WaterVisualLevel {
  readonly amount: number;
  readonly ratio: number;
  readonly lift: number;
  readonly depth: number;
}

export interface WaterSurfaceVisualLevel {
  /** The terrain height used by the display, before water is added. */
  readonly terrain: number;
  /** The domain amount, kept unmodified for labels and auditability. */
  readonly amount: number;
  /** The amount represented by the bounded visual scale. */
  readonly visibleAmount: number;
  /** The bounded logical surface: terrain × height unit + visible water. */
  readonly logicalSurface: number;
  /** The same surface in the compact Three.js world-height reference. */
  readonly worldY: number;
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
 * default scale saturates at MAX_VISUAL_WATER, while callers can provide a
 * stage-specific cap so large tutorial-stage amounts remain distinguishable.
 */
export function waterVisualLevel(
  amount: number,
  visualCap = MAX_VISUAL_WATER
): WaterVisualLevel {
  assertNonNegativeFinite(amount, 'amount');
  if (!Number.isFinite(visualCap) || visualCap <= 0) {
    throw new RangeError('visualCap must be a positive finite number');
  }
  const visibleAmount = Math.min(visualCap, amount);
  const ratio = visibleAmount === 0 ? 0 : 0.2 + (visibleAmount / visualCap) * 0.8;
  return Object.freeze({
    amount,
    ratio,
    lift: ratio * 0.34,
    depth: 0.08 + ratio * 0.22
  });
}

function assertTerrainHeight(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TERRAIN_HEIGHT) {
    throw new RangeError(`terrain must be an integer from 0 to ${MAX_TERRAIN_HEIGHT}`);
  }
}

/**
 * Maps the rule's water surface to the same vertical reference as terrain.
 *
 * The water solver compares `terrain * DEFAULT_HEIGHT_UNIT + water`. Keeping
 * that relationship in the display prevents a low tile with a large amount
 * of water from looking lower than a taller, drier tile when it is actually
 * the higher surface. The bounded amount keeps extreme domain values readable
 * without changing the numeric amount shown to the player.
 */
export function waterSurfaceVisualLevel(
  terrain: number,
  amount: number,
  visualCap = MAX_VISUAL_WATER
): WaterSurfaceVisualLevel {
  assertTerrainHeight(terrain);
  assertNonNegativeFinite(amount, 'amount');
  if (!Number.isFinite(visualCap) || visualCap <= 0) {
    throw new RangeError('visualCap must be a positive finite number');
  }
  const visibleAmount = Math.min(visualCap, amount);
  const logicalSurface = terrain * DEFAULT_HEIGHT_UNIT + visibleAmount;
  return Object.freeze({
    terrain,
    amount,
    visibleAmount,
    logicalSurface,
    worldY: logicalSurface / DEFAULT_HEIGHT_UNIT
  });
}

/**
 * Gives each stage a presentation cap based on all water it can introduce.
 * This changes only the visual scale; the domain water amounts remain intact.
 */
export function waterVisualCapForStage(
  stage: Pick<ValidatedStageDefinition, 'board' | 'rainEvents'>
): number {
  const initialWater = stage.board.water.reduce((total, amount) => total + amount, 0);
  const scheduledRain = stage.rainEvents.reduce(
    (stageTotal, event) => event.cells.reduce(
      (eventTotal, cell) => eventTotal + cell.amount,
      stageTotal
    ),
    0
  );
  return Math.max(MAX_VISUAL_WATER, initialWater + scheduledRain);
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
