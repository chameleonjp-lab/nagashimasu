import { describe, expect, it } from 'vitest';

import {
  TurnTimer,
  formatRemainingSeconds,
  timerDurationMs
} from '../../src/application/turn-timer';
import type { TurnTimerRuntime } from '../../src/application/turn-timer';

class FakeRuntime implements TurnTimerRuntime {
  public currentMs = 0;
  public readonly callbacks: Array<() => void> = [];
  private nextHandle = 1;
  private readonly scheduled = new Map<number, { callback: () => void; at: number }>();

  public now = (): number => this.currentMs;

  public schedule = (callback: () => void, delayMs: number): number => {
    this.callbacks.push(callback);
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.scheduled.set(handle, { callback, at: this.currentMs + delayMs });
    return handle;
  };

  public cancel = (handle: number): void => {
    this.scheduled.delete(handle);
  };

  public advance(ms: number): void {
    this.currentMs += ms;
    let next = [...this.scheduled.entries()]
      .filter(([, task]) => task.at <= this.currentMs)
      .sort(([, left], [, right]) => left.at - right.at)[0];
    while (next !== undefined) {
      this.scheduled.delete(next[0]);
      next[1].callback();
      next = [...this.scheduled.entries()]
        .filter(([, task]) => task.at <= this.currentMs)
        .sort(([, left], [, right]) => left.at - right.at)[0];
    }
  }
}

describe('TurnTimer', () => {
  it('maps stage timer modes to fixed thinking durations', () => {
    expect(timerDurationMs(null, 'standard')).toBeNull();
    expect(timerDurationMs(20, 'standard')).toBe(20_000);
    expect(timerDurationMs(20, 'extended')).toBe(30_000);
    expect(timerDurationMs(20, 'unlimited')).toBeNull();
    expect(() => timerDurationMs(-1, 'unlimited')).toThrow(RangeError);
    expect(formatRemainingSeconds(2_001)).toBe('3秒');
    expect(formatRemainingSeconds(null)).toBe('時間制限なし');
  });

  it('pauses without consuming hidden time and expires once after resume', () => {
    const runtime = new FakeRuntime();
    const ticks: number[] = [];
    let expired = 0;
    const timer = new TurnTimer({
      onTick: (remaining) => ticks.push(remaining),
      onExpire: () => { expired += 1; }
    }, runtime);

    timer.start(1_000);
    runtime.advance(400);
    expect(timer.remainingMs).toBe(600);
    timer.pause();
    expect(timer.paused).toBe(true);
    runtime.advance(10_000);
    expect(timer.remainingMs).toBe(600);
    expect(expired).toBe(0);

    timer.resume();
    runtime.advance(599);
    expect(expired).toBe(0);
    runtime.advance(1);
    expect(expired).toBe(1);
    expect(timer.active).toBe(false);
    expect(timer.paused).toBe(false);
    expect(ticks.at(-1)).toBe(0);
  });

  it('stale scheduled callbacks cannot expire a restarted timer', () => {
    const runtime = new FakeRuntime();
    let expired = 0;
    const timer = new TurnTimer({ onExpire: () => { expired += 1; } }, runtime);
    timer.start(1_000);
    timer.stop();
    timer.start(2_000);
    runtime.advance(1_000);
    expect(expired).toBe(0);
    runtime.advance(1_000);
    expect(expired).toBe(1);
  });

  it('invalidates a callback that was already queued when pausing', () => {
    const runtime = new FakeRuntime();
    const ticks: number[] = [];
    const timer = new TurnTimer({ onTick: (remaining) => ticks.push(remaining) }, runtime);
    timer.start(1_000);
    const queuedBeforePause = runtime.callbacks[0];
    timer.pause();
    timer.resume();
    const ticksBeforeStaleCallback = ticks.length;
    queuedBeforePause?.();
    expect(ticks.length).toBe(ticksBeforeStaleCallback);
    expect(timer.remainingMs).toBe(1_000);
  });
});
