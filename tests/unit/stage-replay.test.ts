import { describe, expect, it } from 'vitest';

import {
  MAX_STAGE_REPLAY_ENTRIES,
  STAGE_REPLAY_VERSION,
  STAGE_RULES_VERSION,
  parseStageAction,
  parseStageReplay
} from '../../src/domain/stage-replay';

const HASH_0 = '0000000000000000';
const HASH_1 = '1111111111111111';
const HASH_2 = '2222222222222222';
const HASH_3 = '3333333333333333';
const HASH_4 = '4444444444444444';

function header(): Record<string, unknown> {
  return {
    stageId: 'stage-01',
    dataVersion: '1_0_0',
    definitionDigest: 'abcdef0123456789',
    waterRules: {
      version: 'nagashimasu-water-v1',
      heightUnit: 8,
      maxFlowPerStep: 8
    },
    stageRulesVersion: STAGE_RULES_VERSION,
    timerMode: 'standard',
    initialFullHash: HASH_0
  };
}

function validReplay(): Record<string, unknown> {
  return {
    version: STAGE_REPLAY_VERSION,
    header: header(),
    entries: [
      {
        sequence: 0,
        action: {
          type: 'construct',
          actionId: 0,
          expectedRevision: 0,
          slot: 1,
          anchorIndex: 63,
          rotation: 3
        },
        beforeFullHash: HASH_0,
        afterFullHash: HASH_1
      },
      {
        sequence: 1,
        action: { type: 'skip', actionId: 1, expectedRevision: 1 },
        beforeFullHash: HASH_1,
        afterFullHash: HASH_2
      },
      {
        sequence: 2,
        action: { type: 'timeout', actionId: 2, expectedRevision: 2 },
        beforeFullHash: HASH_2,
        afterFullHash: HASH_3
      },
      {
        sequence: 3,
        action: { type: 'undo', actionId: 3, expectedRevision: 3 },
        beforeFullHash: HASH_3,
        afterFullHash: HASH_4
      }
    ]
  };
}

describe('StageReplay V1 strict codec', () => {
  it('round-trips every action through JSON and returns a deeply frozen copy', () => {
    const source = validReplay();
    const parsed = parseStageReplay(source);
    const roundTripped = parseStageReplay(JSON.parse(JSON.stringify(parsed)) as unknown);

    expect(roundTripped).toEqual(parsed);
    expect(parsed.version).toBe('nagashimasu-stage-replay-v1');
    expect(parsed.header.stageRulesVersion).toBe('nagashimasu-stage-rules-v1');
    expect(parsed.entries.map((entry) => entry.action.type)).toEqual([
      'construct',
      'skip',
      'timeout',
      'undo'
    ]);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.header)).toBe(true);
    expect(Object.isFrozen(parsed.entries)).toBe(true);
    expect(Object.isFrozen(parsed.entries[0])).toBe(true);
    expect(Object.isFrozen(parsed.entries[0]?.action)).toBe(true);

    (source['header'] as Record<string, unknown>)['stageId'] = 'changed';
    ((source['entries'] as Record<string, unknown>[])[0]?.['action'] as
      Record<string, unknown>)['anchorIndex'] = 0;
    expect(parsed.header.stageId).toBe('stage-01');
    expect(parsed.entries[0]?.action).toMatchObject({ anchorIndex: 63 });
  });

  it('parses individual high-level actions with exact payloads', () => {
    expect(parseStageAction({
      type: 'construct',
      actionId: 9,
      expectedRevision: 7,
      slot: 0,
      anchorIndex: 0,
      rotation: 0
    })).toEqual({
      type: 'construct',
      actionId: 9,
      expectedRevision: 7,
      slot: 0,
      anchorIndex: 0,
      rotation: 0
    });
    expect(parseStageAction({
      type: 'skip',
      actionId: Number.MAX_SAFE_INTEGER,
      expectedRevision: 0
    })).toEqual({
      type: 'skip',
      actionId: Number.MAX_SAFE_INTEGER,
      expectedRevision: 0
    });
  });

  it('rejects wrong versions, header values, hashes, and unsafe identifiers', () => {
    expect(() => parseStageReplay({ ...validReplay(), version: 'v2' }))
      .toThrow(/stageReplay.version/);
    expect(() => parseStageReplay({
      ...validReplay(),
      header: {
        ...header(),
        waterRules: {
          version: 'nagashimasu-water-v2',
          heightUnit: 8,
          maxFlowPerStep: 8
        }
      }
    })).toThrow(/waterRules.version/);
    expect(() => parseStageReplay({
      ...validReplay(),
      header: {
        ...header(),
        waterRules: {
          version: 'nagashimasu-water-v1',
          heightUnit: 0,
          maxFlowPerStep: 8
        }
      }
    })).toThrow(/heightUnit/);
    expect(() => parseStageReplay({
      ...validReplay(),
      header: {
        ...header(),
        waterRules: {
          version: 'nagashimasu-water-v1',
          heightUnit: 8,
          maxFlowPerStep: 8,
          surprise: true
        }
      }
    })).toThrow(/unknown key surprise/);
    expect(() => parseStageReplay({
      ...validReplay(),
      header: { ...header(), stageRulesVersion: 'nagashimasu-stage-rules-v2' }
    })).toThrow(/stageRulesVersion/);
    expect(() => parseStageReplay({
      ...validReplay(),
      header: { ...header(), timerMode: 'fast' }
    })).toThrow(/timerMode/);
    expect(() => parseStageReplay({
      ...validReplay(),
      header: { ...header(), stageId: '../unsafe' }
    })).toThrow(/stageId/);
    expect(() => parseStageReplay({
      ...validReplay(),
      header: { ...header(), definitionDigest: 'ABCDEF0123456789' }
    })).toThrow(/definitionDigest/);

    const replay = validReplay();
    (replay['entries'] as Record<string, unknown>[])[0]!['afterFullHash'] = 'short';
    expect(() => parseStageReplay(replay)).toThrow(/afterFullHash/);
  });

  it('rejects malformed action ranges, action types, and unknown fields', () => {
    expect(() => parseStageAction({
      type: 'construct',
      actionId: -1,
      expectedRevision: 0,
      slot: 0,
      anchorIndex: 0,
      rotation: 0
    })).toThrow(/actionId/);
    expect(() => parseStageAction({
      type: 'construct',
      actionId: 0,
      expectedRevision: 0,
      slot: 2,
      anchorIndex: 0,
      rotation: 0
    })).toThrow(/slot/);
    expect(() => parseStageAction({
      type: 'construct',
      actionId: 0,
      expectedRevision: 0,
      slot: 0,
      anchorIndex: 64,
      rotation: 0
    })).toThrow(/anchorIndex/);
    expect(() => parseStageAction({
      type: 'construct',
      actionId: 0,
      expectedRevision: 0,
      slot: 0,
      anchorIndex: 0,
      rotation: 4
    })).toThrow(/rotation/);
    expect(() => parseStageAction({
      type: 'skip',
      actionId: 0,
      expectedRevision: 0,
      slot: 0
    })).toThrow(/unknown key slot/);
    expect(() => parseStageAction({
      type: 'pause',
      actionId: 0,
      expectedRevision: 0
    })).toThrow(/type must be construct/);
  });

  it('rejects replay action ids and revisions that do not match the sequence', () => {
    const badId = validReplay();
    const badIdAction = ((badId['entries'] as Record<string, unknown>[])[0]?.['action']) as
      Record<string, unknown>;
    badIdAction['actionId'] = 42;
    expect(() => parseStageReplay(badId)).toThrow(/must equal sequence 0/);

    const badRevision = validReplay();
    const badRevisionAction = ((badRevision['entries'] as Record<string, unknown>[])[1]?.['action']) as
      Record<string, unknown>;
    badRevisionAction['expectedRevision'] = 42;
    expect(() => parseStageReplay(badRevision)).toThrow(/must equal sequence 1/);
  });

  it('rejects unknown keys, accessors, prototypes, sparse arrays, and array keys', () => {
    expect(() => parseStageReplay({ ...validReplay(), surprise: true }))
      .toThrow(/unknown key surprise/);
    expect(() => parseStageReplay({
      ...validReplay(),
      header: { ...header(), surprise: true }
    })).toThrow(/unknown key surprise/);

    const unknownEntry = validReplay();
    (unknownEntry['entries'] as Record<string, unknown>[])[0]!['surprise'] = true;
    expect(() => parseStageReplay(unknownEntry)).toThrow(/unknown key surprise/);

    let getterCalls = 0;
    const accessorAction: Record<string, unknown> = {
      actionId: 0,
      expectedRevision: 0
    };
    Object.defineProperty(accessorAction, 'type', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'skip';
      }
    });
    expect(() => parseStageAction(accessorAction)).toThrow(/plain JSON value/);
    expect(getterCalls).toBe(0);

    const inherited = Object.assign(Object.create({ inherited: true }) as object, {
      type: 'skip',
      actionId: 0,
      expectedRevision: 0
    });
    expect(() => parseStageAction(inherited)).toThrow(/plain JSON object/);

    const sparseReplay = validReplay();
    sparseReplay['entries'] = Array<unknown>(1);
    expect(() => parseStageReplay(sparseReplay)).toThrow(/missing array entry/);

    const extraArrayKey = validReplay();
    const entries = extraArrayKey['entries'] as unknown[] & { note?: string };
    entries.note = 'invalid';
    expect(() => parseStageReplay(extraArrayKey)).toThrow(/unknown array key note/);
  });

  it('requires canonical continuous sequence numbers', () => {
    const replay = validReplay();
    (replay['entries'] as Record<string, unknown>[])[2]!['sequence'] = 8;
    expect(() => parseStageReplay(replay)).toThrow(/sequence must equal 2/);
  });

  it('accepts 66 entries and rejects input above the bounded replay size', () => {
    const atLimit = validReplay();
    atLimit['entries'] = Array.from(
      { length: MAX_STAGE_REPLAY_ENTRIES },
      (_, sequence) => ({
        sequence,
        action: {
          type: 'skip',
          actionId: sequence,
          expectedRevision: sequence
        },
        beforeFullHash: HASH_0,
        afterFullHash: HASH_1
      })
    );
    expect(parseStageReplay(atLimit).entries).toHaveLength(66);

    (atLimit['entries'] as unknown[]).push({});
    expect(() => parseStageReplay(atLimit)).toThrow(/at most 66/);
  });
});
