import type { StageTraceEvent, StageTracePhase } from '../domain/stage-session';

export interface TracePlaybackDurations {
  readonly constructionMs: number;
  readonly rainMs: number;
  readonly flowMs: number;
  readonly evaluationMs: number;
  readonly undoMs: number;
}

export const DEFAULT_TRACE_PLAYBACK_DURATIONS: TracePlaybackDurations = Object.freeze({
  constructionMs: 180,
  rainMs: 280,
  flowMs: 150,
  evaluationMs: 180,
  undoMs: 180
});

export interface TracePlaybackSegment {
  readonly event: StageTraceEvent;
  readonly startMs: number;
  readonly endMs: number;
}

export interface TracePlaybackFrame {
  readonly event: StageTraceEvent | null;
  readonly phase: StageTracePhase | null;
  readonly segmentIndex: number;
  readonly progress: number;
  readonly elapsedMs: number;
  readonly done: boolean;
}

export interface TracePlaybackCallbacks {
  readonly onFrame: (frame: TracePlaybackFrame) => void;
  readonly onComplete: () => void;
}

function durationFor(
  phase: StageTracePhase,
  durations: TracePlaybackDurations
): number {
  switch (phase) {
    case 'construction': return durations.constructionMs;
    case 'rain': return durations.rainMs;
    case 'flow': return durations.flowMs;
    case 'evaluation': return durations.evaluationMs;
    case 'undo': return durations.undoMs;
  }
}

function assertDuration(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be non-negative`);
}

export function createTracePlaybackTimeline(
  trace: readonly StageTraceEvent[],
  durations: TracePlaybackDurations = DEFAULT_TRACE_PLAYBACK_DURATIONS
): readonly TracePlaybackSegment[] {
  for (const [label, value] of Object.entries(durations)) assertDuration(value, label);
  let startMs = 0;
  const segments = trace.map((event) => {
    const endMs = startMs + durationFor(event.phase, durations);
    const segment = Object.freeze({ event, startMs, endMs });
    startMs = endMs;
    return segment;
  });
  return Object.freeze(segments);
}

export function tracePlaybackFrameAt(
  timeline: readonly TracePlaybackSegment[],
  elapsedInput: number
): TracePlaybackFrame {
  assertDuration(elapsedInput, 'elapsedMs');
  const last = timeline[timeline.length - 1];
  if (last === undefined) {
    return Object.freeze({
      event: null,
      phase: null,
      segmentIndex: -1,
      progress: 1,
      elapsedMs: elapsedInput,
      done: true
    });
  }
  if (elapsedInput >= last.endMs) {
    return Object.freeze({
      event: last.event,
      phase: last.event.phase,
      segmentIndex: timeline.length - 1,
      progress: 1,
      elapsedMs: elapsedInput,
      done: true
    });
  }
  const segmentIndex = timeline.findIndex(
    (segment) => elapsedInput >= segment.startMs && elapsedInput < segment.endMs
  );
  const segment = timeline[Math.max(0, segmentIndex)];
  if (segment === undefined) throw new Error('trace timeline has a gap');
  const duration = segment.endMs - segment.startMs;
  const progress = duration === 0 ? 1 : (elapsedInput - segment.startMs) / duration;
  return Object.freeze({
    event: segment.event,
    phase: segment.event.phase,
    segmentIndex: Math.max(0, segmentIndex),
    progress: Math.min(1, Math.max(0, progress)),
    elapsedMs: elapsedInput,
    done: false
  });
}

/** Presentation-only playback. It never changes StageSession state. */
export class TracePlayback {
  private readonly timeline: readonly TracePlaybackSegment[];
  private readonly callbacks: TracePlaybackCallbacks;
  private animationFrameId: number | null = null;
  private startedAt = 0;
  private frameValue: TracePlaybackFrame;

  public constructor(
    trace: readonly StageTraceEvent[],
    callbacks: TracePlaybackCallbacks,
    durations: TracePlaybackDurations = DEFAULT_TRACE_PLAYBACK_DURATIONS
  ) {
    this.timeline = createTracePlaybackTimeline(trace, durations);
    this.callbacks = callbacks;
    this.frameValue = tracePlaybackFrameAt(this.timeline, 0);
  }

  public get frame(): TracePlaybackFrame {
    return this.frameValue;
  }

  public get active(): boolean {
    return this.animationFrameId !== null;
  }

  public start(): void {
    if (this.active) return;
    if (this.timeline.length === 0) {
      this.callbacks.onComplete();
      return;
    }
    this.startedAt = performance.now();
    this.animationFrameId = requestAnimationFrame(this.tick);
  }

  public cancel(): void {
    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = null;
  }

  private readonly tick = (now: number): void => {
    this.animationFrameId = null;
    this.frameValue = tracePlaybackFrameAt(this.timeline, Math.max(0, now - this.startedAt));
    this.callbacks.onFrame(this.frameValue);
    if (this.frameValue.done) {
      this.callbacks.onComplete();
      return;
    }
    this.animationFrameId = requestAnimationFrame(this.tick);
  };
}
