import { describe, expect, it } from 'vitest';

import {
  BoardState,
  CELL_COUNT,
  advanceWaterFlow
} from '../../src/domain';
import {
  createRandomBoardDefinition,
  shuffledScanOrder
} from './test-helpers';

describe('water model invariants', () => {
  it('preserves the ledger and valid water range over many fixed seeds', () => {
    for (let seed = 1; seed <= 120; seed += 1) {
      const board = new BoardState(createRandomBoardDefinition(seed));
      for (let step = 0; step < 24; step += 1) {
        advanceWaterFlow(board, { scanOrder: shuffledScanOrder(seed * 100 + step) });
        expect(
          board.totalWater + board.safeDrain + board.dangerLeak,
          `water ledger for seed ${seed}, step ${step}`
        ).toBe(board.introducedWater);
        for (const water of board.snapshot().water) {
          expect(water).toBeGreaterThanOrEqual(0);
          expect(water).toBeLessThanOrEqual(65_535);
        }
      }
    }
  });

  it('produces identical states for forward, reverse, and shuffled scans', () => {
    const forward = Array.from({ length: CELL_COUNT }, (_, index) => index);
    const reverse = [...forward].reverse();

    for (let seed = 1; seed <= 40; seed += 1) {
      const initial = new BoardState(createRandomBoardDefinition(seed));
      const first = initial.clone();
      const second = initial.clone();
      const third = initial.clone();

      for (let step = 0; step < 16; step += 1) {
        const firstResult = advanceWaterFlow(first, { scanOrder: forward });
        const secondResult = advanceWaterFlow(second, { scanOrder: reverse });
        const thirdResult = advanceWaterFlow(third, {
          scanOrder: shuffledScanOrder(seed * 1000 + step)
        });
        expect(second.snapshot(), `reverse scan seed ${seed}, step ${step}`).toEqual(
          first.snapshot()
        );
        expect(third.snapshot(), `shuffled scan seed ${seed}, step ${step}`).toEqual(
          first.snapshot()
        );
        expect(secondResult, `reverse trace seed ${seed}, step ${step}`).toEqual(
          firstResult
        );
        expect(thirdResult, `shuffled trace seed ${seed}, step ${step}`).toEqual(
          firstResult
        );
      }
    }
  });
});
