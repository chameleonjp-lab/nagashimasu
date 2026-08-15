import { describe, expect, it } from 'vitest';

import {
  STAGE_SAVE_STORAGE_KEY,
  createStageSave,
  parseStageSave,
  readStageSave,
  restoreStageSave,
  writeStageSave
} from '../../src/application/stage-save';
import type { ProgressStorageLike } from '../../src/application/progress-storage';
import { createStageSession } from '../../src/domain/stage-session';
import { getBuiltInStage } from '../../src/domain/stages';

class FakeStorage implements ProgressStorageLike {
  public values = new Map<string, string>();
  public removed = 0;
  public failRead = false;
  public failWrite = false;

  public getItem = (key: string): string | null => {
    if (this.failRead) throw new Error('read failed');
    return this.values.get(key) ?? null;
  };

  public setItem = (key: string, value: string): void => {
    if (this.failWrite) throw new Error('write failed');
    this.values.set(key, value);
  };

  public removeItem = (key: string): void => {
    this.removed += 1;
    this.values.delete(key);
  };
}

function saveFixture() {
  const stage = getBuiltInStage('stage-01-first-pond');
  if (stage === undefined) throw new Error('stage fixture missing');
  const session = createStageSession(stage);
  const execution = session.execute({ type: 'skip', actionId: 0, expectedRevision: 0 });
  if (!execution.accepted) throw new Error('fixture action was rejected');
  return createStageSave(
    session.exportReplay(),
    session.fullStateHash,
    session.reversibleGameplayHash
  );
}

describe('stage save', () => {
  it('round-trips a replay-backed save without storing wall-clock data', () => {
    const storage = new FakeStorage();
    const save = saveFixture();
    expect(writeStageSave(save, storage)).toBe(true);
    const parsed = readStageSave(storage);
    expect(parsed).toEqual(save);
    expect(JSON.stringify(parsed)).not.toMatch(/"timestamp"|"savedAt"|"remainingMs"/u);
    expect(storage.values.has(STAGE_SAVE_STORAGE_KEY)).toBe(true);
  });

  it('rejects unknown keys and a hash that does not match the replay endpoint', () => {
    const save = saveFixture();
    expect(() => parseStageSave({ ...save, extra: true })).toThrow(/unknown key/);
    expect(() => parseStageSave({ ...save, fullStateHash: '0000000000000000' })).toThrow(/endpoint/);
  });

  it('removes corrupt data and keeps the game usable when storage fails', () => {
    const storage = new FakeStorage();
    storage.values.set(STAGE_SAVE_STORAGE_KEY, '{"version":"broken"}');
    expect(readStageSave(storage)).toBeNull();
    expect(storage.removed).toBe(1);

    storage.failRead = true;
    expect(readStageSave(storage)).toBeNull();

    const failingWrite = new FakeStorage();
    failingWrite.failWrite = true;
    expect(writeStageSave(saveFixture(), failingWrite)).toBe(false);
  });

  it('only restores a save that belongs to the stage and is still playable', () => {
    const stage = getBuiltInStage('stage-01-first-pond');
    if (stage === undefined) throw new Error('stage fixture missing');
    const playable = saveFixture();
    expect(restoreStageSave(stage, playable)?.snapshot.phase).toBe('awaiting-turn');

    const terminalSession = createStageSession(stage);
    for (
      let index = 0;
      index < stage.maxTurns && terminalSession.snapshot.phase === 'awaiting-turn';
      index += 1
    ) {
      const result = terminalSession.execute({
        type: 'skip',
        actionId: terminalSession.snapshot.nextActionId,
        expectedRevision: terminalSession.snapshot.revision
      });
      if (!result.accepted) throw new Error(`terminal fixture rejected at ${index}`);
    }
    const terminal = createStageSave(
      terminalSession.exportReplay(),
      terminalSession.fullStateHash,
      terminalSession.reversibleGameplayHash
    );
    expect(terminalSession.snapshot.phase).not.toBe('awaiting-turn');
    expect(restoreStageSave(stage, terminal)).toBeNull();

    const otherStage = getBuiltInStage('stage-02-open-to-sea');
    if (otherStage === undefined) throw new Error('other stage fixture missing');
    expect(restoreStageSave(otherStage, playable)).toBeNull();
  });
});
