import { indexOf } from './board';
import {
  CELL_COUNT,
  CellFlag,
  Direction
} from './constants';
import { PIECE_SCHEMA_VERSION } from './pieces';
import {
  STAGE_SCHEMA_VERSION,
  parseStageDefinition
} from './stage-definition';
import type { ValidatedStageDefinition } from './stage-definition';

const DATA_VERSION = '1_0_0';
const DEFAULT_GRADES = Object.freeze({ s: 90, a: 75, b: 60 });

function cells(value = 0): number[] {
  return Array<number>(CELL_COUNT).fill(value);
}

function mask(indices: readonly number[]): number[] {
  const result = cells();
  for (const index of indices) result[index] = 1;
  return result;
}

function rectangularIndices(
  firstRow: number,
  lastRow: number,
  firstColumn: number,
  lastColumn: number
): number[] {
  const result: number[] = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      result.push(indexOf(row, column));
    }
  }
  return result;
}

function emptyBoard(terrainValue: number): {
  terrain: number[];
  water: number[];
  cellFlags: number[];
  drainCapacity: number[];
  protectedWaterLimit: number[];
  safeEdgeMask: number[];
  dangerEdgeMask: number[];
} {
  return {
    terrain: cells(terrainValue),
    water: cells(),
    cellFlags: cells(),
    drainCapacity: cells(),
    protectedWaterLimit: cells(),
    safeEdgeMask: cells(),
    dangerEdgeMask: cells()
  };
}

function piece(
  id: string,
  delta: -1 | 1,
  offsets: readonly { readonly row: number; readonly column: number }[]
): Record<string, unknown> {
  return {
    schemaVersion: PIECE_SCHEMA_VERSION,
    id,
    delta,
    offsets: offsets.map((offset) => ({ ...offset }))
  };
}

const RAISE_SINGLE = piece(
  'raise-single',
  1,
  [{ row: 0, column: 0 }]
);
const RAISE_LINE = piece(
  'raise-line',
  1,
  [
    { row: 0, column: 0 },
    { row: 0, column: 1 }
  ]
);
const RAISE_L = piece(
  'raise-l',
  1,
  [
    { row: 0, column: 0 },
    { row: 1, column: 0 },
    { row: 1, column: 1 }
  ]
);
const LOWER_SINGLE = piece(
  'lower-single',
  -1,
  [{ row: 0, column: 0 }]
);
const LOWER_LINE = piece(
  'lower-line',
  -1,
  [
    { row: 0, column: 0 },
    { row: 0, column: 1 }
  ]
);

function createStageOne(): ValidatedStageDefinition {
  const board = emptyBoard(4);
  const westBank = [indexOf(2, 0), indexOf(3, 0)];
  const pond = [indexOf(2, 1), indexOf(3, 1)];

  for (const index of westBank) board.terrain[index] = 1;
  for (const index of pond) board.terrain[index] = 0;
  board.dangerEdgeMask[westBank[0] ?? 0] = Direction.West;
  board.dangerEdgeMask[westBank[1] ?? 0] = Direction.West;

  return parseStageDefinition({
    schemaVersion: STAGE_SCHEMA_VERSION,
    id: 'stage-01-first-pond',
    dataVersion: DATA_VERSION,
    name: 'はじめの池',
    board,
    constructionMask: mask(rectangularIndices(1, 4, 0, 3)),
    storageMask: mask(pond),
    maxTurns: 8,
    flowStepsPerTurn: 4,
    timerSeconds: null,
    pieceDefinitions: [RAISE_SINGLE, RAISE_LINE, RAISE_L],
    candidateSequence: [
      'raise-line',
      'raise-single',
      'raise-single',
      'raise-l',
      'raise-line',
      'raise-single',
      'raise-l',
      'raise-line',
      'raise-single',
      'raise-l'
    ],
    rainEvents: [
      {
        turn: 3,
        cells: pond.map((index) => ({ index, amount: 8 }))
      },
      {
        turn: 7,
        cells: pond.map((index) => ({ index, amount: 8 }))
      }
    ],
    objective: { type: 'stored-water', target: 24 },
    failure: {
      maxDangerLeak: 0,
      maxPeakProtectedOverflow: 65_535
    },
    evaluation: {
      parWork: 2,
      controlTarget: 32,
      gradeThresholds: DEFAULT_GRADES
    }
  });
}

function createStageTwo(): ValidatedStageDefinition {
  const board = emptyBoard(6);
  const channelRow = 3;
  const channelHeights = [6, 5, 4, 4, 2, 1, 0] as const;
  for (let offset = 0; offset < channelHeights.length; offset += 1) {
    board.terrain[indexOf(channelRow, offset + 1)] = channelHeights[offset] ?? 0;
  }
  const source = indexOf(channelRow, 1);
  const outlet = indexOf(channelRow, 7);
  board.safeEdgeMask[outlet] = Direction.East;

  return parseStageDefinition({
    schemaVersion: STAGE_SCHEMA_VERSION,
    id: 'stage-02-open-to-sea',
    dataVersion: DATA_VERSION,
    name: '海へひらく道',
    board,
    constructionMask: mask(rectangularIndices(channelRow, channelRow, 2, 5)),
    storageMask: cells(),
    maxTurns: 9,
    flowStepsPerTurn: 4,
    timerSeconds: null,
    pieceDefinitions: [LOWER_SINGLE, LOWER_LINE],
    candidateSequence: [
      'lower-single',
      'lower-line',
      'lower-single',
      'lower-line',
      'lower-single',
      'lower-line',
      'lower-single',
      'lower-line',
      'lower-single',
      'lower-line',
      'lower-single'
    ],
    rainEvents: [
      { turn: 3, cells: [{ index: source, amount: 8 }] },
      { turn: 7, cells: [{ index: source, amount: 8 }] }
    ],
    objective: { type: 'safe-drain', target: 16 },
    failure: {
      maxDangerLeak: 0,
      maxPeakProtectedOverflow: 65_535
    },
    evaluation: {
      parWork: 1,
      controlTarget: 16,
      gradeThresholds: DEFAULT_GRADES
    }
  });
}

function createStageThree(): ValidatedStageDefinition {
  const board = emptyBoard(6);

  // West: two zero-height, two-cell gates sit between the rain sources and
  // protected cells. Lowering cannot alter either gate. Raising either whole
  // gate by one level blocks an eight-unit rain because equal surfaces do not
  // flow under nagashimasu-water-v1.
  const westSources = [indexOf(4, 0), indexOf(5, 0)];
  const westGateOne = [indexOf(4, 1), indexOf(5, 1)];
  const westGateTwo = [indexOf(4, 2), indexOf(5, 2)];
  const westProtected = [indexOf(4, 3), indexOf(5, 3)];
  for (const index of [
    ...westSources,
    ...westGateOne,
    ...westGateTwo,
    ...westProtected
  ]) {
    board.terrain[index] = 0;
  }

  // East: the protected cell and two drain notches start at equal height.
  // Lowering either notch makes that drain the unique lowest target. Raising
  // a notch instead makes the protected cell the preferred target.
  const eastSource = indexOf(2, 5);
  const eastProtected = indexOf(2, 6);
  const eastDrainNotches = [indexOf(1, 5), indexOf(3, 5)];
  board.terrain[eastSource] = 2;
  board.terrain[eastProtected] = 1;
  for (const index of eastDrainNotches) {
    board.terrain[index] = 1;
    board.drainCapacity[index] = 8;
  }

  for (const index of [...westProtected, eastProtected]) {
    board.cellFlags[index] = CellFlag.Protected;
    board.protectedWaterLimit[index] = 0;
  }

  return parseStageDefinition({
    schemaVersion: STAGE_SCHEMA_VERSION,
    id: 'stage-03-rain-order',
    dataVersion: DATA_VERSION,
    name: '雨雲の順番',
    board,
    constructionMask: mask([
      ...westGateOne,
      ...westGateTwo,
      ...eastDrainNotches
    ]),
    storageMask: mask([...westSources, ...westGateOne, ...westGateTwo]),
    maxTurns: 10,
    flowStepsPerTurn: 4,
    timerSeconds: 20,
    pieceDefinitions: [
      RAISE_SINGLE,
      RAISE_LINE,
      RAISE_L,
      LOWER_SINGLE,
      LOWER_LINE
    ],
    candidateSequence: [
      'raise-line',
      'lower-single',
      'raise-single',
      'lower-line',
      'raise-l',
      'lower-single',
      'raise-line',
      'lower-line',
      'raise-single',
      'raise-l',
      'lower-single',
      'raise-line'
    ],
    rainEvents: [
      {
        turn: 2,
        cells: westSources.map((index) => ({ index, amount: 8 }))
      },
      { turn: 5, cells: [{ index: eastSource, amount: 8 }] },
      { turn: 9, cells: [{ index: eastSource, amount: 16 }] }
    ],
    objective: { type: 'protect', target: 3 },
    failure: {
      maxDangerLeak: 0,
      maxPeakProtectedOverflow: 0
    },
    evaluation: {
      parWork: 3,
      controlTarget: 24,
      gradeThresholds: DEFAULT_GRADES
    }
  });
}

export const BUILT_IN_STAGES: readonly ValidatedStageDefinition[] =
  Object.freeze([
    createStageOne(),
    createStageTwo(),
    createStageThree()
  ]);

const BUILT_IN_STAGE_BY_ID: ReadonlyMap<string, ValidatedStageDefinition> =
  new Map(BUILT_IN_STAGES.map((stage) => [stage.id, stage]));

if (BUILT_IN_STAGE_BY_ID.size !== BUILT_IN_STAGES.length) {
  throw new Error('built-in stage ids must be unique');
}

export function getBuiltInStage(
  id: string
): ValidatedStageDefinition | undefined {
  return BUILT_IN_STAGE_BY_ID.get(id);
}
