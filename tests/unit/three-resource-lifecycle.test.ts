import { describe, expect, it } from 'vitest';

import { ThreeResourceTracker } from '../../src/presentation/three-resource-tracker';

describe('three resource lifecycle', () => {
  it('disposes a duplicated resource only once and is idempotent', () => {
    let disposeCount = 0;
    const resource = { dispose: () => { disposeCount += 1; } };
    const tracker = new ThreeResourceTracker();
    tracker.register(resource);
    tracker.register(resource);
    expect(tracker.size).toBe(1);
    tracker.dispose();
    tracker.dispose();
    expect(disposeCount).toBe(1);
    expect(tracker.disposed).toBe(true);
  });

  it('immediately disposes resources registered after destruction', () => {
    let disposeCount = 0;
    const tracker = new ThreeResourceTracker();
    tracker.dispose();
    tracker.register({ dispose: () => { disposeCount += 1; } });
    expect(disposeCount).toBe(1);
    expect(tracker.size).toBe(0);
  });
});
