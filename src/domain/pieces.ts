import { BOARD_HEIGHT, BOARD_WIDTH, CELL_COUNT } from './constants';
import { coordinateOf, indexOf } from './board';

export const PIECE_SCHEMA_VERSION = 'nagashimasu-piece-v1' as const;
export const MAX_PIECE_DEFINITIONS = 32;
export const MAX_PIECE_OFFSETS = 3;

const MIN_OFFSET = -(BOARD_WIDTH - 1);
const MAX_OFFSET = BOARD_WIDTH - 1;
const SAFE_PIECE_ID = /^[A-Za-z0-9_-]{1,48}$/u;
const PIECE_KEYS = Object.freeze([
  'schemaVersion',
  'id',
  'delta',
  'offsets'
] as const);
const OFFSET_KEYS = Object.freeze(['row', 'column'] as const);

export type Rotation = 0 | 1 | 2 | 3;
export type TerrainDelta = -1 | 1;

export interface PieceOffset {
  readonly row: number;
  readonly column: number;
}

export interface PieceDefinition {
  readonly schemaVersion: typeof PIECE_SCHEMA_VERSION;
  readonly id: string;
  readonly delta: TerrainDelta;
  readonly offsets: readonly PieceOffset[];
}

export type PiecePlacementInvalidReason =
  | 'anchor-out-of-bounds'
  | 'cell-out-of-bounds';

export interface ValidPiecePlacement {
  readonly valid: true;
  readonly cells: readonly number[];
}

export interface InvalidPiecePlacement {
  readonly valid: false;
  readonly reason: PiecePlacementInvalidReason;
  readonly offsetIndex: number | null;
  readonly row: number | null;
  readonly column: number | null;
}

export type PiecePlacement = ValidPiecePlacement | InvalidPiecePlacement;

type PlainRecord = Record<string, unknown>;

function assertPlainRecord(value: unknown, label: string): asserts value is PlainRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain JSON object`);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain JSON object`);
  }
}

function assertExactDataKeys(
  value: PlainRecord,
  expectedKeys: readonly string[],
  label: string
): void {
  const expected = new Set(expectedKeys);
  const actualKeys = Reflect.ownKeys(value);

  for (const key of actualKeys) {
    if (typeof key !== 'string' || !expected.has(key)) {
      throw new TypeError(`${label} contains unknown key ${String(key)}`);
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(`${label}.${key} must be a plain JSON value`);
    }
  }

  for (const key of expectedKeys) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${label} is missing required key ${key}`);
    }
  }
}

function assertPlainJsonArray(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
  label: string
): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON array`);
  }
  if (value.length < minimumLength || value.length > maximumLength) {
    throw new RangeError(
      `${label} must contain ${minimumLength} to ${maximumLength} entries`
    );
  }

  const allowedKeys = new Set<string>(['length']);
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    allowedKeys.add(key);
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${label} must not contain a missing array entry at ${index}`);
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(`${label}[${index}] must be a plain JSON value`);
    }
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowedKeys.has(key)) {
      throw new TypeError(`${label} contains unknown array key ${String(key)}`);
    }
  }
}

function assertIntegerRange(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string
): asserts value is number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new RangeError(
      `${label} must be an integer from ${minimum} to ${maximum}`
    );
  }
}

function parseOffset(value: unknown, label: string): PieceOffset {
  assertPlainRecord(value, label);
  assertExactDataKeys(value, OFFSET_KEYS, label);

  const row = value['row'];
  const column = value['column'];
  assertIntegerRange(row, MIN_OFFSET, MAX_OFFSET, `${label}.row`);
  assertIntegerRange(column, MIN_OFFSET, MAX_OFFSET, `${label}.column`);

  return Object.freeze({ row, column });
}

function parsePiece(value: unknown, index: number): PieceDefinition {
  const label = `pieceDefinitions[${index}]`;
  assertPlainRecord(value, label);
  assertExactDataKeys(value, PIECE_KEYS, label);

  const schemaVersion = value['schemaVersion'];
  if (schemaVersion !== PIECE_SCHEMA_VERSION) {
    throw new RangeError(
      `${label}.schemaVersion must be ${PIECE_SCHEMA_VERSION}`
    );
  }

  const id = value['id'];
  if (typeof id !== 'string' || !SAFE_PIECE_ID.test(id)) {
    throw new RangeError(
      `${label}.id must contain 1 to 48 ASCII letters, digits, underscores, or hyphens`
    );
  }

  const delta = value['delta'];
  if (delta !== -1 && delta !== 1) {
    throw new RangeError(`${label}.delta must be -1 or 1`);
  }

  const offsetsValue = value['offsets'];
  assertPlainJsonArray(offsetsValue, 1, MAX_PIECE_OFFSETS, `${label}.offsets`);

  const offsetKeys = new Set<string>();
  const offsets = offsetsValue.map((offsetValue, offsetIndex) => {
    const offset = parseOffset(offsetValue, `${label}.offsets[${offsetIndex}]`);
    const key = `${offset.row},${offset.column}`;
    if (offsetKeys.has(key)) {
      throw new RangeError(`${label}.offsets contains duplicate offset ${key}`);
    }
    offsetKeys.add(key);
    return offset;
  });

  return Object.freeze({
    schemaVersion,
    id,
    delta,
    offsets: Object.freeze(offsets)
  });
}

function rotatedCoordinates(
  offset: PieceOffset,
  rotation: Rotation
): PieceOffset {
  switch (rotation) {
    case 0:
      return offset;
    case 1:
      return { row: offset.column, column: -offset.row };
    case 2:
      return { row: -offset.row, column: -offset.column };
    case 3:
      return { row: -offset.column, column: offset.row };
  }
}

function normalizedRotationSignature(
  piece: PieceDefinition,
  rotation: Rotation
): string {
  const rotated = piece.offsets.map((offset) => rotatedCoordinates(offset, rotation));
  let minimumRow = Number.POSITIVE_INFINITY;
  let minimumColumn = Number.POSITIVE_INFINITY;

  for (const offset of rotated) {
    minimumRow = Math.min(minimumRow, offset.row);
    minimumColumn = Math.min(minimumColumn, offset.column);
  }

  const coordinates = rotated
    .map((offset) => `${offset.row - minimumRow},${offset.column - minimumColumn}`)
    .sort()
    .join(';');
  return `${piece.delta}:${coordinates}`;
}

function rotationalSignature(piece: PieceDefinition): string {
  const signatures: string[] = [];
  for (const rotation of [0, 1, 2, 3] as const) {
    signatures.push(normalizedRotationSignature(piece, rotation));
  }
  signatures.sort();
  return signatures[0] ?? '';
}

/**
 * Validates and defensively copies a JSON piece-definition array.
 *
 * Shapes with the same terrain effect are considered duplicates when one can
 * be translated and rotated by a multiple of 90 degrees to match the other.
 */
export function parsePieceDefinitions(value: unknown): readonly PieceDefinition[] {
  assertPlainJsonArray(value, 1, MAX_PIECE_DEFINITIONS, 'pieceDefinitions');

  const ids = new Set<string>();
  const shapes = new Map<string, string>();
  const definitions = value.map((pieceValue, index) => {
    const piece = parsePiece(pieceValue, index);
    if (ids.has(piece.id)) {
      throw new RangeError(`pieceDefinitions contains duplicate id ${piece.id}`);
    }
    ids.add(piece.id);

    const signature = rotationalSignature(piece);
    const existingId = shapes.get(signature);
    if (existingId !== undefined) {
      throw new RangeError(
        `pieceDefinitions contains rotational duplicate ${piece.id} of ${existingId}`
      );
    }
    shapes.set(signature, piece.id);
    return piece;
  });

  return Object.freeze(definitions);
}

/** Rotates one offset clockwise around the piece anchor. */
export function rotatePieceOffset(
  offset: PieceOffset,
  rotation: Rotation
): PieceOffset {
  const rotated = rotatedCoordinates(offset, rotation);
  return Object.freeze({ row: rotated.row, column: rotated.column });
}

/** Resolves a piece to canonical row-major board cells without mutating state. */
export function resolvePiecePlacement(
  piece: PieceDefinition,
  anchorIndex: number,
  rotation: Rotation
): PiecePlacement {
  if (
    !Number.isSafeInteger(anchorIndex) ||
    anchorIndex < 0 ||
    anchorIndex >= CELL_COUNT
  ) {
    return Object.freeze({
      valid: false,
      reason: 'anchor-out-of-bounds',
      offsetIndex: null,
      row: null,
      column: null
    });
  }

  const anchor = coordinateOf(anchorIndex);
  const cells: number[] = [];
  for (let offsetIndex = 0; offsetIndex < piece.offsets.length; offsetIndex += 1) {
    const offset = piece.offsets[offsetIndex];
    if (offset === undefined) {
      throw new RangeError(`piece ${piece.id} contains a missing offset`);
    }
    const rotated = rotatedCoordinates(offset, rotation);
    const row = anchor.row + rotated.row;
    const column = anchor.column + rotated.column;
    if (row < 0 || row >= BOARD_HEIGHT || column < 0 || column >= BOARD_WIDTH) {
      return Object.freeze({
        valid: false,
        reason: 'cell-out-of-bounds',
        offsetIndex,
        row,
        column
      });
    }
    cells.push(indexOf(row, column));
  }

  cells.sort((left, right) => left - right);
  return Object.freeze({ valid: true, cells: Object.freeze(cells) });
}
