import { describe, expect, it } from 'vitest';

import type { StageAction } from '../../src/domain/stage-replay';
import {
  createStageSession,
  replayStageSession
} from '../../src/domain/stage-session';
import { getBuiltInStage } from '../../src/domain/stages';

function requireReplayStage() {
  const stage = getBuiltInStage('stage-03-rain-order');
  if (stage === undefined) throw new Error('missing replay integration stage');
  return stage;
}

function construct(
  actionId: number,
  expectedRevision: number,
  anchorIndex: number,
  rotation: 0 | 1 | 2 | 3
): StageAction {
  return {
    type: 'construct',
    actionId,
    expectedRevision,
    slot: 0,
    anchorIndex,
    rotation
  };
}

function skip(actionId: number, expectedRevision: number): StageAction {
  return { type: 'skip', actionId, expectedRevision };
}

function timeout(actionId: number, expectedRevision: number): StageAction {
  return { type: 'timeout', actionId, expectedRevision };
}

function undo(actionId: number, expectedRevision: number): StageAction {
  return { type: 'undo', actionId, expectedRevision };
}

function jsonCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function differentHash(hash: string): string {
  return hash === '0000000000000000'
    ? '1111111111111111'
    : '0000000000000000';
}

function completedReplayFixture() {
  const stage = requireReplayStage();
  const session = createStageSession(stage, 'standard');

  // The first candidate is a two-cell line. Rotating at row 4, column 1
  // raises both cells of the west gate before its turn-2 rain arrives.
  expect(session.execute(construct(0, 0, 33, 1)).accepted).toBe(true);
  expect(session.execute(skip(1, 1)).accepted).toBe(true);
  expect(session.execute(timeout(2, 2)).accepted).toBe(true);
  expect(session.execute(undo(3, 3)).accepted).toBe(true);

  return { stage, session, replay: session.exportReplay() };
}

describe('StageSession and StageReplay integration', () => {
  it('replays construct, skip, timeout, and undo after a JSON round trip', () => {
    const { stage, session, replay } = completedReplayFixture();
    const serializedReplay: unknown = jsonCopy(replay);
    const replayed = replayStageSession(stage, serializedReplay);

    expect(replay.entries.map((entry) => entry.action.type)).toEqual([
      'construct',
      'skip',
      'timeout',
      'undo'
    ]);
    expect(replayed.snapshot).toEqual(session.snapshot);
    expect(replayed.fullStateHash).toBe(session.fullStateHash);
    expect(replayed.reversibleGameplayHash).toBe(session.reversibleGameplayHash);
    expect(replayed.exportReplay()).toEqual(replay);
  });

  it.each([
    ['stageId', 'stage-03-rain-order-copy'],
    ['dataVersion', '1_0_1'],
    ['definitionDigest', '0000000000000000']
  ] as const)('rejects a replay with a mismatched definition %s', (key, value) => {
    const { stage, replay } = completedReplayFixture();
    const changed = jsonCopy(replay) as unknown as Record<string, unknown>;
    const header = changed['header'] as Record<string, unknown>;
    if (key === 'definitionDigest') {
      header[key] = differentHash(replay.header.definitionDigest);
    } else {
      header[key] = value;
    }

    expect(() => replayStageSession(stage, changed)).toThrow(/definition does not match/);
  });

  it.each([
    ['heightUnit', 9],
    ['maxFlowPerStep', 7]
  ] as const)('rejects changed water coefficient %s through the initial full hash', (key, value) => {
    const { stage, replay } = completedReplayFixture();
    const changed = jsonCopy(replay) as unknown as Record<string, unknown>;
    const header = changed['header'] as Record<string, unknown>;
    const waterRules = header['waterRules'] as Record<string, unknown>;
    waterRules[key] = value;

    expect(() => replayStageSession(stage, changed)).toThrow(/initial full-state hash/);
  });

  it('rejects initial, before, and after full-state hash tampering at their boundaries', () => {
    const { stage, replay } = completedReplayFixture();

    const changedInitial = jsonCopy(replay) as unknown as Record<string, unknown>;
    const initialHeader = changedInitial['header'] as Record<string, unknown>;
    initialHeader['initialFullHash'] = differentHash(replay.header.initialFullHash);
    expect(() => replayStageSession(stage, changedInitial)).toThrow(
      /initial full-state hash/
    );

    const firstEntry = replay.entries[0];
    if (firstEntry === undefined) throw new Error('missing first replay entry');

    const changedBefore = jsonCopy(replay) as unknown as Record<string, unknown>;
    const beforeEntry = (changedBefore['entries'] as Record<string, unknown>[])[0];
    if (beforeEntry === undefined) throw new Error('missing mutable before entry');
    beforeEntry['beforeFullHash'] = differentHash(firstEntry.beforeFullHash);
    expect(() => replayStageSession(stage, changedBefore)).toThrow(/before hash mismatch/);

    const changedAfter = jsonCopy(replay) as unknown as Record<string, unknown>;
    const afterEntry = (changedAfter['entries'] as Record<string, unknown>[])[0];
    if (afterEntry === undefined) throw new Error('missing mutable after entry');
    afterEntry['afterFullHash'] = differentHash(firstEntry.afterFullHash);
    expect(() => replayStageSession(stage, changedAfter)).toThrow(/after hash mismatch/);
  });

  it('never appends invalid, stale, collision, or retry operations to the replay', () => {
    const stage = requireReplayStage();
    const session = createStageSession(stage, 'standard');

    const invalid = session.execute(construct(0, 0, 63, 0));
    expect(invalid.accepted).toBe(false);
    expect(session.exportReplay().entries).toHaveLength(0);

    const staleRevision = session.execute(skip(0, 1));
    expect(staleRevision).toMatchObject({
      accepted: false,
      reason: 'stale-revision'
    });
    expect(session.exportReplay().entries).toHaveLength(0);

    const accepted = session.execute(skip(0, 0));
    expect(accepted.accepted).toBe(true);
    expect(session.exportReplay().entries).toHaveLength(1);

    const retry = session.execute(skip(0, 0));
    expect(retry).toMatchObject({ accepted: true, replayed: true });
    expect(session.exportReplay().entries).toHaveLength(1);

    const collision = session.execute(timeout(0, 0));
    expect(collision).toMatchObject({
      accepted: false,
      reason: 'action-id-collision'
    });
    const staleId = session.execute(skip(2, 1));
    expect(staleId).toMatchObject({
      accepted: false,
      reason: 'stale-action-id'
    });
    expect(session.exportReplay().entries).toHaveLength(1);
  });
});
