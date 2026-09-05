import { describe, expect, it } from 'vitest';

import { cellCoordinate, cellLabel } from '../../src/presentation/cell-label';

describe('player-facing cell coordinates', () => {
  it('maps row-major cells to stable A1-style coordinates', () => {
    expect(cellCoordinate(0)).toBe('A1');
    expect(cellCoordinate(7)).toBe('H1');
    expect(cellCoordinate(8)).toBe('A2');
    expect(cellCoordinate(63)).toBe('H8');
    expect(cellLabel(26)).toBe('セルC4');
  });

  it('rejects indexes outside the board', () => {
    expect(() => cellCoordinate(-1)).toThrow(RangeError);
    expect(() => cellCoordinate(64)).toThrow(RangeError);
  });
});
