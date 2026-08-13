import { describe, expect, it } from 'vitest';

import {
  MAX_PIECE_DEFINITIONS,
  PIECE_SCHEMA_VERSION,
  parsePieceDefinitions,
  resolvePiecePlacement,
  rotatePieceOffset
} from '../../src/domain/pieces';
import type { PieceDefinition, Rotation } from '../../src/domain/pieces';

function definition(
  id: string,
  offsets: readonly { readonly row: number; readonly column: number }[],
  delta: -1 | 1 = 1
): PieceDefinition {
  return {
    schemaVersion: PIECE_SCHEMA_VERSION,
    id,
    delta,
    offsets
  };
}

describe('piece definition parsing', () => {
  it('accepts the five MVP shapes as versioned plain JSON', () => {
    const parsed = parsePieceDefinitions([
      definition('raise-single', [{ row: 0, column: 0 }]),
      definition('raise-line', [
        { row: 0, column: 0 },
        { row: 0, column: 1 }
      ]),
      definition('raise-l', [
        { row: 0, column: 0 },
        { row: 1, column: 0 },
        { row: 1, column: 1 }
      ]),
      definition('lower-single', [{ row: 0, column: 0 }], -1),
      definition(
        'lower-line',
        [
          { row: 0, column: 0 },
          { row: 0, column: 1 }
        ],
        -1
      )
    ]);

    expect(parsed).toHaveLength(5);
    expect(parsed[0]).toEqual({
      schemaVersion: 'nagashimasu-piece-v1',
      id: 'raise-single',
      delta: 1,
      offsets: [{ row: 0, column: 0 }]
    });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed[0]?.offsets)).toBe(true);
  });

  it('rejects malformed, unsafe, oversized, and unknown JSON values', () => {
    expect(() => parsePieceDefinitions({})).toThrow(/JSON array/);
    expect(() => parsePieceDefinitions([])).toThrow(/1 to 32/);
    expect(() =>
      parsePieceDefinitions(
        Array.from({ length: MAX_PIECE_DEFINITIONS + 1 }, (_, index) =>
          definition(`piece-${index}`, [{ row: 0, column: 0 }], index % 2 === 0 ? 1 : -1)
        )
      )
    ).toThrow(/1 to 32/);

    expect(() =>
      parsePieceDefinitions([
        { ...definition('../unsafe', [{ row: 0, column: 0 }]) }
      ])
    ).toThrow(/ASCII letters/);
    expect(() =>
      parsePieceDefinitions([
        { ...definition('known', [{ row: 0, column: 0 }]), surprise: true }
      ])
    ).toThrow(/unknown key surprise/);
    expect(() =>
      parsePieceDefinitions([
        definition('too-many-cells', [
          { row: 0, column: 0 },
          { row: 0, column: 1 },
          { row: 1, column: 0 },
          { row: 1, column: 1 }
        ])
      ])
    ).toThrow(/1 to 3/);
    expect(() =>
      parsePieceDefinitions([
        definition('far-cell', [{ row: 0, column: 8 }])
      ])
    ).toThrow(/-7 to 7/);
    expect(() =>
      parsePieceDefinitions([
        {
          ...definition('offset-key', [{ row: 0, column: 0 }]),
          offsets: [{ row: 0, column: 0, depth: 0 }]
        }
      ])
    ).toThrow(/unknown key depth/);

    const sparseDefinitions = Array<unknown>(1);
    expect(() => parsePieceDefinitions(sparseDefinitions)).toThrow(/missing array entry/);

    const offsetsWithExtraKey: unknown[] & { note?: string } = [
      { row: 0, column: 0 }
    ];
    offsetsWithExtraKey.note = 'not JSON array data';
    expect(() =>
      parsePieceDefinitions([
        { ...definition('array-key', []), offsets: offsetsWithExtraKey }
      ])
    ).toThrow(/unknown array key note/);
  });

  it('rejects duplicate ids and offsets', () => {
    expect(() =>
      parsePieceDefinitions([
        definition('same', [{ row: 0, column: 0 }]),
        definition('same', [{ row: 0, column: 0 }], -1)
      ])
    ).toThrow(/duplicate id same/);

    expect(() =>
      parsePieceDefinitions([
        definition('duplicate-offset', [
          { row: -1, column: 2 },
          { row: -1, column: 2 }
        ])
      ])
    ).toThrow(/duplicate offset -1,2/);
  });

  it('rejects equivalent shapes after all four rotations and translation', () => {
    expect(() =>
      parsePieceDefinitions([
        definition('horizontal', [
          { row: 0, column: 0 },
          { row: 0, column: 1 }
        ]),
        definition('shifted-vertical', [
          { row: -2, column: 3 },
          { row: -1, column: 3 }
        ])
      ])
    ).toThrow(/rotational duplicate shifted-vertical of horizontal/);

    expect(() =>
      parsePieceDefinitions([
        definition('raise-line', [
          { row: 0, column: 0 },
          { row: 0, column: 1 }
        ]),
        definition(
          'lower-line',
          [
            { row: 0, column: 0 },
            { row: 1, column: 0 }
          ],
          -1
        )
      ])
    ).not.toThrow();
  });
});

describe('piece rotation and placement', () => {
  const lPiece = definition('raise-l', [
    { row: 0, column: 0 },
    { row: 1, column: 0 },
    { row: 1, column: 1 }
  ]);

  it('rotates offsets clockwise in four exact orientations', () => {
    expect([0, 1, 2, 3].map((rotation) => rotatePieceOffset(
      { row: 1, column: 2 },
      rotation as Rotation
    ))).toEqual([
      { row: 1, column: 2 },
      { row: 2, column: -1 },
      { row: -1, column: -2 },
      { row: -2, column: 1 }
    ]);
  });

  it('returns canonical ascending row-major cells for all L rotations', () => {
    const anchor = 27; // row 3, column 3

    expect(resolvePiecePlacement(lPiece, anchor, 0)).toEqual({
      valid: true,
      cells: [27, 35, 36]
    });
    expect(resolvePiecePlacement(lPiece, anchor, 1)).toEqual({
      valid: true,
      cells: [26, 27, 34]
    });
    expect(resolvePiecePlacement(lPiece, anchor, 2)).toEqual({
      valid: true,
      cells: [18, 19, 27]
    });
    expect(resolvePiecePlacement(lPiece, anchor, 3)).toEqual({
      valid: true,
      cells: [20, 27, 28]
    });
  });

  it('returns reason-coded invalid results at the board edge', () => {
    expect(resolvePiecePlacement(lPiece, -1, 0)).toEqual({
      valid: false,
      reason: 'anchor-out-of-bounds',
      offsetIndex: null,
      row: null,
      column: null
    });
    expect(resolvePiecePlacement(lPiece, 63, 0)).toEqual({
      valid: false,
      reason: 'cell-out-of-bounds',
      offsetIndex: 1,
      row: 8,
      column: 7
    });
    expect(resolvePiecePlacement(lPiece, 0, 2)).toEqual({
      valid: false,
      reason: 'cell-out-of-bounds',
      offsetIndex: 1,
      row: -1,
      column: 0
    });
  });
});
