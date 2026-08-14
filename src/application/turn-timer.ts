export type TurnTimerMode = 'standard' | 'extended' | 'unlimited';

export interface TurnTimerCallbacks {
  readonly onTick?: (remainingMs: number) => void;
  readonly onExpire?: () => void;
}

export interface TurnTimerRuntime {
  readonly now: () => number;
  readonly schedule: (callback: () => void, delayMs: number) => number;
  readonly cancel: (handle: number) => void;
}

const BROWSER_RUNTIME: TurnTimerRuntime = Object.freeze({
  now: () => Date.now(),
  schedule: (callback: () => void, delayMs: number) => window.setTimeout(callback, delayMs),
  cancel: (handle: number) => window.clearTimeout(handle)
});

function assertDuration(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new RangeError('timer duration must be a non-negative finite number');
  }
}

export function timerDurationMs(
  stageSeconds: number | null,
  mode: TurnTimerMode
): number | null {
  if (mode !== 'standard' && mode !== 'extended' && mode !== 'unlimited') {
    throw new RangeError('timer mode must be standard, extended, or unlimited');
  }
  if (stageSeconds === null) return null;
  if (!Number.isSafeInteger(stageSeconds) || stageSeconds < 0) {
    throw new RangeError('stageSeconds must be a non-negative safe integer or null');
  }
  if (mode === 'unlimited') return null;
  const multiplier = mode === 'extended' ? 1.5 : 1;
  return Math.round(stageSeconds * 1000 * multiplier);
}

export function formatRemainingSeconds(remainingMs: number | null): string {
  if (remainingMs === null) return '時間制限なし';
  assertDuration(remainingMs);
  return `${Math.ceil(remainingMs / 1000)}秒`;
}

/** Wall-clock handling for one thinking phase. Domain state never enters here. */
export class TurnTimer {
  private readonly callbacks: TurnTimerCallbacks;
  private readonly runtime: TurnTimerRuntime;
  private deadlineMs: number | null = null;
  private pausedRemainingMs: number | null = null;
  private handle: number | null = null;
  private remainingMsValue: number | null = null;
  private generation = 0;

  public constructor(
    callbacks: TurnTimerCallbacks = {},
    runtime: TurnTimerRuntime = BROWSER_RUNTIME
  ) {
    this.callbacks = callbacks;
    this.runtime = runtime;
  }

  public get active(): boolean {
    return this.deadlineMs !== null;
  }

  public get paused(): boolean {
    return this.pausedRemainingMs !== null;
  }

  public get remainingMs(): number | null {
    if (this.deadlineMs === null) return this.pausedRemainingMs ?? this.remainingMsValue;
    return Math.max(0, this.deadlineMs - this.runtime.now());
  }

  public start(durationMs: number): void {
    assertDuration(durationMs);
    this.stop();
    this.remainingMsValue = durationMs;
    if (durationMs === 0) {
      this.callbacks.onTick?.(0);
      this.callbacks.onExpire?.();
      return;
    }
    this.deadlineMs = this.runtime.now() + durationMs;
    this.callbacks.onTick?.(durationMs);
    this.scheduleNext();
  }

  public pause(): void {
    if (this.deadlineMs === null) return;
    this.generation += 1;
    this.remainingMsValue = Math.max(0, this.deadlineMs - this.runtime.now());
    this.pausedRemainingMs = this.remainingMsValue;
    this.deadlineMs = null;
    this.cancelScheduled();
    this.callbacks.onTick?.(this.remainingMsValue);
  }

  public resume(): void {
    if (this.pausedRemainingMs === null) return;
    const remaining = this.pausedRemainingMs;
    this.pausedRemainingMs = null;
    if (remaining <= 0) {
      this.remainingMsValue = 0;
      this.callbacks.onTick?.(0);
      this.callbacks.onExpire?.();
      return;
    }
    this.deadlineMs = this.runtime.now() + remaining;
    this.remainingMsValue = remaining;
    this.callbacks.onTick?.(remaining);
    this.scheduleNext();
  }

  public stop(): void {
    this.generation += 1;
    this.cancelScheduled();
    this.deadlineMs = null;
    this.pausedRemainingMs = null;
    this.remainingMsValue = null;
  }

  private cancelScheduled(): void {
    if (this.handle !== null) this.runtime.cancel(this.handle);
    this.handle = null;
  }

  private scheduleNext(): void {
    this.cancelScheduled();
    const generation = this.generation;
    const remaining = this.remainingMs;
    if (remaining === null) return;
    this.handle = this.runtime.schedule(() => {
      if (generation !== this.generation || this.deadlineMs === null) return;
      this.handle = null;
      const nextRemaining = Math.max(0, this.deadlineMs - this.runtime.now());
      this.remainingMsValue = nextRemaining;
      this.callbacks.onTick?.(nextRemaining);
      if (nextRemaining <= 0) {
        this.deadlineMs = null;
        this.callbacks.onExpire?.();
        return;
      }
      this.scheduleNext();
    }, Math.min(100, Math.max(1, remaining)));
  }
}
