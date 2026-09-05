import { describe, expect, it } from 'vitest';

import {
  buildCandidateShapeLayout,
  candidateShapeLabel
} from '../../src/presentation/candidate-shape';

describe('candidate shape layout', () => {
  it('keeps the logical anchor visible when rotation moves it away from the top-left', () => {
    const layout = buildCandidateShapeLayout(
      [
        { row: 0, column: 0 },
        { row: 0, column: 1 }
      ],
      3
    );

    expect(layout.anchor).toEqual({ row: 1, column: 0 });
    expect(layout.offsets).toEqual([
      { row: 1, column: 0 },
      { row: 0, column: 0 }
    ]);
    expect(layout.rowCount).toBe(2);
    expect(layout.columnCount).toBe(1);
  });

  it('includes an empty anchor cell when a definition does not fill its origin', () => {
    const layout = buildCandidateShapeLayout(
      [
        { row: 0, column: 1 },
        { row: 1, column: 1 }
      ],
      0
    );

    expect(layout.anchor).toEqual({ row: 0, column: 0 });
    expect(layout.offsets).toEqual([
      { row: 0, column: 1 },
      { row: 1, column: 1 }
    ]);
    expect(layout.rowCount).toBe(2);
    expect(layout.columnCount).toBe(2);
  });

  it('describes the normalized shape without changing its meaning', () => {
    expect(candidateShapeLabel([
      { row: 0, column: 0 },
      { row: 0, column: 1 }
    ])).toBe('直線・2マス');
    expect(candidateShapeLabel([
      { row: 0, column: 0 },
      { row: 1, column: 0 },
      { row: 1, column: 1 }
    ])).toBe('L字・3マス');
  });
});
