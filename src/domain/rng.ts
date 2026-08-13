const NON_ZERO_FALLBACK_SEED = 0x6d2b79f5;

export class SeededRandom {
  private state: number;

  public constructor(seed: number) {
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
      throw new RangeError('seed must be an unsigned 32-bit integer');
    }

    this.state = seed >>> 0;
    if (this.state === 0) this.state = NON_ZERO_FALLBACK_SEED;
  }

  public nextUint32(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state;
  }

  public nextInt(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 0x1_0000_0000) {
      throw new RangeError('maxExclusive must be an integer from 1 to 2^32');
    }

    const range = 0x1_0000_0000;
    const acceptanceLimit = range - (range % maxExclusive);
    let value: number;
    do {
      value = this.nextUint32();
    } while (value >= acceptanceLimit);

    return value % maxExclusive;
  }

  public getState(): number {
    return this.state;
  }

  public restoreState(state: number): void {
    if (!Number.isSafeInteger(state) || state < 1 || state > 0xffff_ffff) {
      throw new RangeError('state must be an unsigned non-zero 32-bit integer');
    }
    this.state = state >>> 0;
  }
}
