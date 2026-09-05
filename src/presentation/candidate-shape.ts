import type { PieceOffset, Rotation } from '../domain/pieces';

export interface CandidateShapeLayout {
  readonly offsets: readonly PieceOffset[];
  /** The piece anchor inside the normalized card grid. */
  readonly anchor: PieceOffset;
  readonly rowCount: number;
  readonly columnCount: number;
}

function rotateOffset(offset: PieceOffset, rotation: Rotation): PieceOffset {
  switch (rotation) {
    case 1: return { row: offset.column, column: -offset.row };
    case 2: return { row: -offset.row, column: -offset.column };
    case 3: return { row: -offset.column, column: offset.row };
    default: return offset;
  }
}

/**
 * Normalizes a candidate for the compact card while retaining the logical
 * anchor. The anchor is the board cell selected by the green marker; it is
 * not necessarily the top-left filled cell after rotation.
 */
export function buildCandidateShapeLayout(
  offsets: readonly PieceOffset[],
  rotation: Rotation
): CandidateShapeLayout {
  const rotated = offsets.map((offset) => rotateOffset(offset, rotation));
  const rotatedAnchor = { row: 0, column: 0 };
  const minimumRow = Math.min(
    rotatedAnchor.row,
    ...rotated.map((offset) => offset.row)
  );
  const minimumColumn = Math.min(
    rotatedAnchor.column,
    ...rotated.map((offset) => offset.column)
  );
  const normalized = rotated.map((offset) => Object.freeze({
    row: offset.row - minimumRow,
    column: offset.column - minimumColumn
  }));

  return Object.freeze({
    offsets: Object.freeze(normalized),
    anchor: Object.freeze({
      row: rotatedAnchor.row - minimumRow,
      column: rotatedAnchor.column - minimumColumn
    }),
    rowCount: Math.max(0, ...normalized.map((offset) => offset.row)) + 1,
    columnCount: Math.max(0, ...normalized.map((offset) => offset.column)) + 1
  });
}

export function candidateShapeLabel(offsets: readonly PieceOffset[]): string {
  if (offsets.length === 1) return '1マス';
  const rows = new Set(offsets.map((offset) => offset.row));
  const columns = new Set(offsets.map((offset) => offset.column));
  if (rows.size === 1 || columns.size === 1) return `直線・${offsets.length}マス`;
  if (offsets.length === 3) return 'L字・3マス';
  return `形状・${offsets.length}マス`;
}
