import { describe, expect, it } from 'vitest';

import {
  BoardState,
  Direction,
  REPLAY_LOG_VERSION,
  MAX_FLOW_STEPS_PER_COMMAND,
  MAX_REPLAY_FLOW_STEPS,
  WaterSimulation,
  checkedReplayFlowStepTotal,
  indexOf,
  replaySimulation
} from '../../src/domain';
import type { ReplayLogV1 } from '../../src/domain';
import { cells } from './test-helpers';

function createReplayFixture(): BoardState {
  const terrain = cells(6);
  const safeEdges = cells();
  const origin = indexOf(2, 2);
  const middle = indexOf(2, 3);
  const outlet = indexOf(2, 7);
  terrain[origin] = 3;
  terrain[middle] = 2;
  terrain[indexOf(2, 4)] = 1;
  terrain[indexOf(2, 5)] = 0;
  terrain[indexOf(2, 6)] = 0;
  terrain[outlet] = 0;
  safeEdges[outlet] = Direction.East;
  return new BoardState({ terrain, safeEdgeMask: safeEdges });
}

describe('WaterSimulation replay log', () => {
  it('replays the same commands to the exact same final state', () => {
    const initial = createReplayFixture().snapshot();
    const simulation = new WaterSimulation(initial);
    simulation.execute({
      type: 'rain',
      cells: [{ index: indexOf(2, 2), amount: 24 }]
    });
    simulation.execute({
      type: 'terrain',
      cells: [indexOf(3, 3)],
      delta: -1
    });
    simulation.execute({ type: 'flow', steps: 12 });

    const log = simulation.exportReplayLog();
    const serializedLog: unknown = JSON.parse(JSON.stringify(log));
    const replayed = replaySimulation(initial, serializedLog);

    expect(log.version).toBe(REPLAY_LOG_VERSION);
    expect(replayed.snapshot).toEqual(simulation.snapshot);
    expect(replayed.stateHash).toBe(simulation.stateHash);
    expect(replayed.exportReplayLog()).toEqual(log);
  });

  it('detects a changed initial state before replaying commands', () => {
    const initial = createReplayFixture().snapshot();
    const simulation = new WaterSimulation(initial);
    simulation.execute({ type: 'flow', steps: 1 });
    const changed = BoardState.fromSnapshot(initial);
    changed.addRain([{ index: 0, amount: 1 }]);

    expect(() => replaySimulation(changed.snapshot(), simulation.exportReplayLog())).toThrow(
      /initial state/
    );
  });

  it('detects a changed recorded hash', () => {
    const initial = createReplayFixture().snapshot();
    const simulation = new WaterSimulation(initial);
    simulation.execute({ type: 'flow', steps: 1 });
    const log = simulation.exportReplayLog();
    const first = log.entries[0];
    if (first === undefined) throw new Error('missing fixture entry');
    const changed: ReplayLogV1 = {
      ...log,
      entries: [{ ...first, afterHash: '0000000000000000' }]
    };

    expect(() => replaySimulation(initial, changed)).toThrow(/afterHash/);
  });

  it('does not append a log entry when a command is rejected', () => {
    const simulation = new WaterSimulation();

    expect(() => simulation.execute({ type: 'flow', steps: 0 })).toThrow(/flow steps/);
    expect(simulation.exportReplayLog().entries).toHaveLength(0);
  });

  it('rolls back a multi-step command completely when a later step fails', () => {
    const initial = new BoardState().snapshot();
    const nearCounterLimit = {
      ...initial,
      flowStep: Number.MAX_SAFE_INTEGER - 1
    };
    const simulation = new WaterSimulation(nearCounterLimit);
    const before = simulation.snapshot;

    expect(() => simulation.execute({ type: 'flow', steps: 2 })).toThrow(/flowStep/);
    expect(simulation.snapshot).toEqual(before);
    expect(simulation.exportReplayLog().entries).toHaveLength(0);
  });

  it('retains every fixed-step trace when a temporary flood clears later', () => {
    const terrain = cells(6);
    const water = cells();
    const flags = cells();
    const limits = cells();
    const source = indexOf(2, 2);
    const protectedCell = indexOf(2, 3);
    const low = indexOf(2, 4);
    terrain[source] = 2;
    terrain[protectedCell] = 1;
    terrain[low] = 0;
    water[source] = 8;
    flags[protectedCell] = 1;
    limits[protectedCell] = 0;
    const simulation = new WaterSimulation({
      terrain,
      water,
      cellFlags: flags,
      protectedWaterLimit: limits
    });

    const execution = simulation.execute({ type: 'flow', steps: 2 });

    expect(execution.flowSteps).toHaveLength(2);
    expect(execution.flowSteps[0]?.protectedOverflows).toEqual([
      { index: protectedCell, amount: 8 }
    ]);
    expect(execution.flowSteps[1]?.protectedOverflows).toEqual([]);
    expect(simulation.snapshot.water[low]).toBe(8);
  });

  it('rejects oversized commands and malformed replay JSON before running it', () => {
    const simulation = new WaterSimulation();
    expect(() =>
      simulation.execute({ type: 'flow', steps: MAX_FLOW_STEPS_PER_COMMAND + 1 })
    ).toThrow(/flow steps/);

    const valid = simulation.exportReplayLog();
    expect(() => replaySimulation({}, { ...valid, initialStateHash: 'bad' })).toThrow(
      /initialStateHash/
    );
    expect(() => replaySimulation({}, { ...valid, rules: { version: valid.rules.version } })).toThrow(
      /heightUnit/
    );
    expect(() => replaySimulation({}, { ...valid, entries: 'not-an-array' })).toThrow(
      /entries/
    );
  });

  it('checks the replay flow-step boundary without running an oversized replay', () => {
    expect(checkedReplayFlowStepTotal(MAX_REPLAY_FLOW_STEPS - 1, 1)).toBe(
      MAX_REPLAY_FLOW_STEPS
    );
    expect(() => checkedReplayFlowStepTotal(MAX_REPLAY_FLOW_STEPS, 1)).toThrow(
      /recorded flow steps/
    );

    const simulation = new WaterSimulation();
    simulation.execute({ type: 'flow', steps: 2 });
    simulation.execute({ type: 'flow', steps: 3 });
    const recordedSteps = simulation
      .exportReplayLog()
      .entries.reduce(
        (total, entry) =>
          total + (entry.command.type === 'flow' ? entry.command.steps : 0),
        0
      );
    expect(recordedSteps).toBe(5);
  });
});
