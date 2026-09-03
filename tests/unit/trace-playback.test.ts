import { describe, expect, it, vi } from 'vitest';

import { StageController } from '../../src/application/stage-controller';
import { getBuiltInStage } from '../../src/domain/stages';
import {
  createTracePlaybackTimeline,
  TracePlayback,
  tracePlaybackDurations,
  tracePlaybackFrameAt
} from '../../src/presentation/trace-playback';

const stage = getBuiltInStage('stage-01-first-pond');
if (stage === undefined) throw new Error('stage fixture missing');
const fixtureStage = stage;

describe('trace playback timeline', () => {
  it('keeps the committed trace order and exposes deterministic phase progress', () => {
    const controller = new StageController(fixtureStage);
    controller.setAnchor(8);
    const execution = controller.confirm();
    if (execution === null || !execution.accepted) throw new Error('fixture execution failed');

    const timeline = createTracePlaybackTimeline(execution.trace, {
      constructionMs: 10,
      rainMs: 20,
      flowMs: 30,
      evaluationMs: 40,
      undoMs: 50
    });
    expect(timeline.map((segment) => segment.event.phase)).toEqual([
      'construction',
      'rain',
      'flow',
      'flow',
      'flow',
      'flow',
      'evaluation'
    ]);
    expect(timeline[0]?.startMs).toBe(0);
    expect(timeline[0]?.endMs).toBe(10);
    expect(timeline[2]?.startMs).toBe(30);
    expect(timeline[2]?.endMs).toBe(60);

    const construction = tracePlaybackFrameAt(timeline, 5);
    expect(construction.phase).toBe('construction');
    expect(construction.progress).toBe(0.5);
    expect(construction.done).toBe(false);

    const secondFlow = tracePlaybackFrameAt(timeline, 75);
    expect(secondFlow.phase).toBe('flow');
    expect(secondFlow.segmentIndex).toBe(3);
    expect(secondFlow.progress).toBeCloseTo(0.5);

    const finished = tracePlaybackFrameAt(timeline, 190);
    expect(finished.phase).toBe('evaluation');
    expect(finished.progress).toBe(1);
    expect(finished.done).toBe(true);
  });

  it('handles empty traces and rejects invalid elapsed or duration values', () => {
    expect(tracePlaybackFrameAt([], 0)).toMatchObject({
      event: null,
      phase: null,
      segmentIndex: -1,
      done: true
    });
    expect(() => tracePlaybackFrameAt([], -1)).toThrow(RangeError);
    expect(() => createTracePlaybackTimeline([], {
      constructionMs: -1,
      rainMs: 0,
      flowMs: 0,
      evaluationMs: 0,
      undoMs: 0
    })).toThrow(RangeError);
    expect(() => createTracePlaybackTimeline([], {
      constructionMs: Number.NaN,
      rainMs: 0,
      flowMs: 0,
      evaluationMs: 0,
      undoMs: 0
    })).toThrow(RangeError);
  });

  it('offers a faster presentation without dropping trace events', () => {
    const standard = tracePlaybackDurations('standard');
    const fast = tracePlaybackDurations('fast');
    expect(fast.constructionMs).toBeLessThan(standard.constructionMs);
    expect(fast.rainMs).toBeLessThan(standard.rainMs);
    expect(fast.flowMs).toBeLessThan(standard.flowMs);
    expect(fast.evaluationMs).toBeLessThan(standard.evaluationMs);
    expect(createTracePlaybackTimeline(stageTrace(), fast)).toHaveLength(7);
    expect(() => tracePlaybackDurations('instant' as never)).toThrow(RangeError);
  });

  it('pauses and resumes presentation time without changing the current frame', () => {
    let clock = 100;
    let queuedCallback: FrameRequestCallback | null = null;
    let nextRequestId = 0;
    vi.stubGlobal('performance', { now: () => clock });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      queuedCallback = callback;
      nextRequestId += 1;
      return nextRequestId;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);

    try {
      const playback = new TracePlayback(stageTrace(), {
        onFrame: () => undefined,
        onComplete: () => undefined
      });
      playback.start();
      expect(playback.active).toBe(true);
      clock = 140;
      playback.pause();
      const pausedFrame = playback.frame;
      expect(playback.paused).toBe(true);
      expect(playback.active).toBe(false);
      clock = 900;
      playback.resume();
      expect(playback.paused).toBe(false);
      expect(playback.active).toBe(true);
      expect(playback.frame).toBe(pausedFrame);
      expect(queuedCallback).not.toBeNull();
      playback.cancel();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

function stageTrace() {
  const controller = new StageController(fixtureStage);
  controller.setAnchor(8);
  const execution = controller.confirm();
  if (execution === null || !execution.accepted) throw new Error('fixture execution failed');
  return execution.trace;
}
