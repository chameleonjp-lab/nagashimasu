import { describe, expect, it } from 'vitest';

import { SeededRandom } from '../../src/domain';

describe('SeededRandom', () => {
  it('repeats the same sequence for the same seed', () => {
    const first = new SeededRandom(12345);
    const second = new SeededRandom(12345);

    expect(Array.from({ length: 20 }, () => first.nextUint32())).toEqual(
      Array.from({ length: 20 }, () => second.nextUint32())
    );
  });

  it('maps seed zero to one documented non-zero sequence', () => {
    const first = new SeededRandom(0);
    const second = new SeededRandom(0);

    expect(first.getState()).not.toBe(0);
    expect(first.nextUint32()).toBe(second.nextUint32());
  });

  it('restores a saved state exactly', () => {
    const random = new SeededRandom(99);
    random.nextUint32();
    const state = random.getState();
    const expected = random.nextInt(17);

    random.restoreState(state);
    expect(random.nextInt(17)).toBe(expected);
  });

  it('rejects invalid ranges instead of silently coercing them', () => {
    const random = new SeededRandom(1);
    expect(() => random.nextInt(0)).toThrow(/maxExclusive/);
    expect(() => random.nextInt(1.5)).toThrow(/maxExclusive/);
    expect(() => new SeededRandom(-1)).toThrow(/seed/);
    expect(() => new SeededRandom(0x1_0000_0000)).toThrow(/seed/);
  });
});
