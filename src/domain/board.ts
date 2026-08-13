import {
  ALL_DIRECTIONS,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  CELL_COUNT,
  CellFlag,
  Direction,
  KNOWN_CELL_FLAGS,
  MAX_CELL_WATER,
  MAX_TERRAIN_HEIGHT,
  MIN_TERRAIN_HEIGHT
} from './constants';
import type {
  BoardDefinition,
  BoardSnapshot,
  CellCoordinate,
  RainEvent
} from './types';

const EMPTY_DEFINITION: BoardDefinition = Object.freeze({});

function copyArrayLike(
  source: ArrayLike<number> | undefined,
  name: string
): number[] {
  if (source === undefined) return Array<number>(CELL_COUNT).fill(0);
  if (source.length !== CELL_COUNT) {
    throw new RangeError(`${name} must contain exactly ${CELL_COUNT} cells`);
  }
  return Array.from(source);
}

function assertIntegerRange(
  value: number,
  minimum: number,
  maximum: number,
  label: string
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
}

function sum(values: Uint16Array): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function checkedAdd(left: number, right: number, label: string): number {
  const result = left + right;
  assertIntegerRange(result, 0, Number.MAX_SAFE_INTEGER, label);
  return result;
}

function boundaryMaskFor(index: number): number {
  const { row, column } = coordinateOf(index);
  let mask = 0;
  if (row === 0) mask |= Direction.North;
  if (column === BOARD_WIDTH - 1) mask |= Direction.East;
  if (row === BOARD_HEIGHT - 1) mask |= Direction.South;
  if (column === 0) mask |= Direction.West;
  return mask;
}

export function assertCellIndex(index: number): void {
  assertIntegerRange(index, 0, CELL_COUNT - 1, 'cell index');
}

export function indexOf(row: number, column: number): number {
  assertIntegerRange(row, 0, BOARD_HEIGHT - 1, 'row');
  assertIntegerRange(column, 0, BOARD_WIDTH - 1, 'column');
  return row * BOARD_WIDTH + column;
}

export function coordinateOf(index: number): CellCoordinate {
  assertCellIndex(index);
  return Object.freeze({
    row: Math.floor(index / BOARD_WIDTH),
    column: index % BOARD_WIDTH
  });
}

export class BoardState {
  private readonly terrainCells: Int8Array;
  private readonly waterCells: Uint16Array;
  private readonly flagCells: Uint8Array;
  private readonly drainCapacityCells: Uint16Array;
  private readonly protectedWaterLimitCells: Uint16Array;
  private readonly safeEdgeCells: Uint8Array;
  private readonly dangerEdgeCells: Uint8Array;

  private flowStepValue = 0;
  private introducedWaterValue = 0;
  private safeDrainValue = 0;
  private dangerLeakValue = 0;

  public constructor(definition: BoardDefinition = EMPTY_DEFINITION) {
    const terrain = copyArrayLike(definition.terrain, 'terrain');
    const water = copyArrayLike(definition.water, 'water');
    const flags = copyArrayLike(definition.cellFlags, 'cellFlags');
    const drainCapacity = copyArrayLike(definition.drainCapacity, 'drainCapacity');
    const protectedWaterLimit = copyArrayLike(
      definition.protectedWaterLimit,
      'protectedWaterLimit'
    );
    const safeEdges = copyArrayLike(definition.safeEdgeMask, 'safeEdgeMask');
    const dangerEdges = copyArrayLike(definition.dangerEdgeMask, 'dangerEdgeMask');

    for (let index = 0; index < CELL_COUNT; index += 1) {
      const terrainValue = terrain[index];
      const waterValue = water[index];
      const flagValue = flags[index];
      const drainValue = drainCapacity[index];
      const protectedLimitValue = protectedWaterLimit[index];
      const safeMask = safeEdges[index];
      const dangerMask = dangerEdges[index];
      if (
        terrainValue === undefined ||
        waterValue === undefined ||
        flagValue === undefined ||
        drainValue === undefined ||
        protectedLimitValue === undefined ||
        safeMask === undefined ||
        dangerMask === undefined
      ) {
        throw new RangeError('board definition contains a missing cell value');
      }

      assertIntegerRange(
        terrainValue,
        MIN_TERRAIN_HEIGHT,
        MAX_TERRAIN_HEIGHT,
        `terrain[${index}]`
      );
      assertIntegerRange(waterValue, 0, MAX_CELL_WATER, `water[${index}]`);
      assertIntegerRange(flagValue, 0, KNOWN_CELL_FLAGS, `cellFlags[${index}]`);
      if ((flagValue & ~KNOWN_CELL_FLAGS) !== 0) {
        throw new RangeError(`cellFlags[${index}] contains an unknown flag`);
      }
      assertIntegerRange(drainValue, 0, MAX_CELL_WATER, `drainCapacity[${index}]`);
      assertIntegerRange(
        protectedLimitValue,
        0,
        MAX_CELL_WATER,
        `protectedWaterLimit[${index}]`
      );
      assertIntegerRange(safeMask, 0, ALL_DIRECTIONS, `safeEdgeMask[${index}]`);
      assertIntegerRange(dangerMask, 0, ALL_DIRECTIONS, `dangerEdgeMask[${index}]`);

      if ((safeMask & dangerMask) !== 0) {
        throw new RangeError(`cell ${index} cannot classify one edge as both safe and dangerous`);
      }

      const boundaryMask = boundaryMaskFor(index);
      if (((safeMask | dangerMask) & ~boundaryMask) !== 0) {
        throw new RangeError(`cell ${index} defines an outlet on a non-boundary edge`);
      }
    }

    this.terrainCells = Int8Array.from(terrain);
    this.waterCells = Uint16Array.from(water);
    this.flagCells = Uint8Array.from(flags);
    this.drainCapacityCells = Uint16Array.from(drainCapacity);
    this.protectedWaterLimitCells = Uint16Array.from(protectedWaterLimit);
    this.safeEdgeCells = Uint8Array.from(safeEdges);
    this.dangerEdgeCells = Uint8Array.from(dangerEdges);
    this.introducedWaterValue = sum(this.waterCells);
  }

  public static fromSnapshot(snapshot: BoardSnapshot): BoardState {
    const board = new BoardState({
      terrain: snapshot.terrain,
      water: snapshot.water,
      cellFlags: snapshot.cellFlags,
      drainCapacity: snapshot.drainCapacity,
      protectedWaterLimit: snapshot.protectedWaterLimit,
      safeEdgeMask: snapshot.safeEdgeMask,
      dangerEdgeMask: snapshot.dangerEdgeMask
    });

    assertIntegerRange(snapshot.flowStep, 0, Number.MAX_SAFE_INTEGER, 'flowStep');
    assertIntegerRange(
      snapshot.introducedWater,
      0,
      Number.MAX_SAFE_INTEGER,
      'introducedWater'
    );
    assertIntegerRange(snapshot.safeDrain, 0, Number.MAX_SAFE_INTEGER, 'safeDrain');
    assertIntegerRange(snapshot.dangerLeak, 0, Number.MAX_SAFE_INTEGER, 'dangerLeak');

    board.flowStepValue = snapshot.flowStep;
    board.introducedWaterValue = snapshot.introducedWater;
    board.safeDrainValue = snapshot.safeDrain;
    board.dangerLeakValue = snapshot.dangerLeak;
    board.assertWaterLedger();
    return board;
  }

  public clone(): BoardState {
    return BoardState.fromSnapshot(this.snapshot());
  }

  public snapshot(): BoardSnapshot {
    return Object.freeze({
      terrain: Object.freeze(Array.from(this.terrainCells)),
      water: Object.freeze(Array.from(this.waterCells)),
      cellFlags: Object.freeze(Array.from(this.flagCells)),
      drainCapacity: Object.freeze(Array.from(this.drainCapacityCells)),
      protectedWaterLimit: Object.freeze(Array.from(this.protectedWaterLimitCells)),
      safeEdgeMask: Object.freeze(Array.from(this.safeEdgeCells)),
      dangerEdgeMask: Object.freeze(Array.from(this.dangerEdgeCells)),
      flowStep: this.flowStepValue,
      introducedWater: this.introducedWaterValue,
      safeDrain: this.safeDrainValue,
      dangerLeak: this.dangerLeakValue
    });
  }

  public getTerrain(index: number): number {
    assertCellIndex(index);
    return this.terrainCells[index] ?? 0;
  }

  public getWater(index: number): number {
    assertCellIndex(index);
    return this.waterCells[index] ?? 0;
  }

  public getCellFlags(index: number): number {
    assertCellIndex(index);
    return this.flagCells[index] ?? 0;
  }

  public getDrainCapacity(index: number): number {
    assertCellIndex(index);
    return this.drainCapacityCells[index] ?? 0;
  }

  public getProtectedWaterLimit(index: number): number {
    assertCellIndex(index);
    return this.protectedWaterLimitCells[index] ?? 0;
  }

  public getSafeEdgeMask(index: number): number {
    assertCellIndex(index);
    return this.safeEdgeCells[index] ?? 0;
  }

  public getDangerEdgeMask(index: number): number {
    assertCellIndex(index);
    return this.dangerEdgeCells[index] ?? 0;
  }

  public get flowStep(): number {
    return this.flowStepValue;
  }

  public get introducedWater(): number {
    return this.introducedWaterValue;
  }

  public get safeDrain(): number {
    return this.safeDrainValue;
  }

  public get dangerLeak(): number {
    return this.dangerLeakValue;
  }

  public get totalWater(): number {
    return sum(this.waterCells);
  }

  public getWaterCopy(): Uint16Array {
    return this.waterCells.slice();
  }

  public addRain(events: readonly RainEvent[]): void {
    const additions = new Map<number, number>();
    let totalAdded = 0;

    for (const event of events) {
      assertCellIndex(event.index);
      assertIntegerRange(event.amount, 1, MAX_CELL_WATER, 'rain amount');
      const nextForCell = (additions.get(event.index) ?? 0) + event.amount;
      assertIntegerRange(nextForCell, 1, MAX_CELL_WATER, 'combined rain amount');
      additions.set(event.index, nextForCell);
      totalAdded += event.amount;
      assertIntegerRange(totalAdded, 0, Number.MAX_SAFE_INTEGER, 'total rain amount');
    }

    for (const [index, amount] of additions) {
      const nextWater = this.getWater(index) + amount;
      assertIntegerRange(nextWater, 0, MAX_CELL_WATER, `water[${index}] after rain`);
    }

    const nextIntroducedWater = checkedAdd(
      this.introducedWaterValue,
      totalAdded,
      'introducedWater after rain'
    );

    for (const [index, amount] of additions) {
      this.waterCells[index] = this.getWater(index) + amount;
    }
    this.introducedWaterValue = nextIntroducedWater;
    this.assertWaterLedger();
  }

  public applyTerrainDelta(indices: readonly number[], delta: number): void {
    if (!Number.isSafeInteger(delta) || delta === 0) {
      throw new RangeError('terrain delta must be a non-zero integer');
    }

    const uniqueIndices = new Set<number>();
    for (const index of indices) {
      assertCellIndex(index);
      if (uniqueIndices.has(index)) {
        throw new RangeError(`terrain operation contains duplicate cell ${index}`);
      }
      uniqueIndices.add(index);
      const nextHeight = this.getTerrain(index) + delta;
      assertIntegerRange(
        nextHeight,
        MIN_TERRAIN_HEIGHT,
        MAX_TERRAIN_HEIGHT,
        `terrain[${index}] after construction`
      );
    }

    for (const index of uniqueIndices) {
      this.terrainCells[index] = this.getTerrain(index) + delta;
    }
    this.assertWaterLedger();
  }

  public applyFlowResult(
    nextWater: Uint16Array,
    safeDrained: number,
    dangerLeaked: number
  ): void {
    if (nextWater.length !== CELL_COUNT) {
      throw new RangeError(`flow result must contain exactly ${CELL_COUNT} cells`);
    }
    assertIntegerRange(safeDrained, 0, Number.MAX_SAFE_INTEGER, 'safeDrained');
    assertIntegerRange(dangerLeaked, 0, Number.MAX_SAFE_INTEGER, 'dangerLeaked');

    const nextSafeDrain = checkedAdd(
      this.safeDrainValue,
      safeDrained,
      'cumulative safeDrain'
    );
    const nextDangerLeak = checkedAdd(
      this.dangerLeakValue,
      dangerLeaked,
      'cumulative dangerLeak'
    );
    const nextFlowStep = checkedAdd(this.flowStepValue, 1, 'flowStep');
    const expectedAccounted =
      sum(nextWater) +
      nextSafeDrain +
      nextDangerLeak;
    if (expectedAccounted !== this.introducedWaterValue) {
      throw new Error(
        `water ledger mismatch: introduced=${this.introducedWaterValue}, accounted=${expectedAccounted}`
      );
    }

    this.waterCells.set(nextWater);
    this.safeDrainValue = nextSafeDrain;
    this.dangerLeakValue = nextDangerLeak;
    this.flowStepValue = nextFlowStep;
    this.assertWaterLedger();
  }

  public getProtectedOverflow(): number {
    return this.getProtectedOverflows().reduce((total, cell) => total + cell.amount, 0);
  }

  public getProtectedOverflows(): readonly { readonly index: number; readonly amount: number }[] {
    const overflows: { index: number; amount: number }[] = [];
    let total = 0;
    for (let index = 0; index < CELL_COUNT; index += 1) {
      const flags = this.flagCells[index] ?? 0;
      if ((flags & CellFlag.Protected) === 0) continue;
      const amount = Math.max(
        0,
        (this.waterCells[index] ?? 0) - (this.protectedWaterLimitCells[index] ?? 0)
      );
      if (amount > 0) overflows.push(Object.freeze({ index, amount }));
      total += amount;
    }
    if (!Number.isSafeInteger(total)) throw new RangeError('protected overflow exceeds safe range');
    return Object.freeze(overflows);
  }

  public assertWaterLedger(): void {
    const accounted = this.totalWater + this.safeDrainValue + this.dangerLeakValue;
    if (accounted !== this.introducedWaterValue) {
      throw new Error(
        `water ledger mismatch: introduced=${this.introducedWaterValue}, accounted=${accounted}`
      );
    }
  }
}

export function hashBoardSnapshot(snapshot: BoardSnapshot): string {
  const serialized = JSON.stringify(snapshot);
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= BigInt(serialized.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}
