import { BoardState, hashBoardSnapshot } from './board';
import { MAX_CELL_WATER, MAX_TERRAIN_HEIGHT } from './constants';
import {
  DEFAULT_WATER_MODEL_CONFIG,
  advanceWaterFlow
} from './water-flow';
import type {
  BoardDefinition,
  BoardSnapshot,
  FlowStepResult,
  OperationLogEntry,
  RainEvent,
  ReplayLogV1,
  SimulationExecution,
  SimulationCommand,
  WaterModelConfig,
  WaterRulesV1
} from './types';

export const WATER_RULES_VERSION = 'nagashimasu-water-v1' as const;
export const REPLAY_LOG_VERSION = 'nagashimasu-replay-v1' as const;
export const MAX_FLOW_STEPS_PER_COMMAND = 64;
export const MAX_REPLAY_ENTRIES = 10_000;
export const MAX_REPLAY_FLOW_STEPS = 100_000;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertStateHash(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{16}$/.test(value)) {
    throw new TypeError(`${label} must be a 16-character lowercase hexadecimal hash`);
  }
}

function assertInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
}

export function checkedReplayFlowStepTotal(
  current: number,
  additional: number
): number {
  assertInteger(current, 0, MAX_REPLAY_FLOW_STEPS, 'recorded flow step total');
  assertInteger(additional, 1, MAX_FLOW_STEPS_PER_COMMAND, 'additional flow steps');
  const total = current + additional;
  if (total > MAX_REPLAY_FLOW_STEPS) {
    throw new RangeError(
      `simulation cannot exceed ${MAX_REPLAY_FLOW_STEPS} recorded flow steps`
    );
  }
  return total;
}

function createRules(config?: Partial<WaterModelConfig>): WaterRulesV1 {
  const heightUnit = config?.heightUnit ?? DEFAULT_WATER_MODEL_CONFIG.heightUnit;
  const maxFlowPerStep =
    config?.maxFlowPerStep ?? DEFAULT_WATER_MODEL_CONFIG.maxFlowPerStep;

  const maximumSafeHeightUnit = Math.floor(
    (Number.MAX_SAFE_INTEGER - MAX_CELL_WATER) / MAX_TERRAIN_HEIGHT
  );
  if (
    !Number.isSafeInteger(heightUnit) ||
    heightUnit <= 0 ||
    heightUnit > maximumSafeHeightUnit
  ) {
    throw new RangeError('heightUnit must be a positive integer');
  }
  if (
    !Number.isSafeInteger(maxFlowPerStep) ||
    maxFlowPerStep <= 0 ||
    maxFlowPerStep > MAX_CELL_WATER
  ) {
    throw new RangeError('maxFlowPerStep must be a positive integer');
  }

  return Object.freeze({
    version: WATER_RULES_VERSION,
    heightUnit,
    maxFlowPerStep
  });
}

function cloneRainEvents(events: readonly RainEvent[]): readonly RainEvent[] {
  return Object.freeze(
    events.map((event) => Object.freeze({ index: event.index, amount: event.amount }))
  );
}

function cloneCommand(command: SimulationCommand): SimulationCommand {
  switch (command.type) {
    case 'rain':
      return Object.freeze({ type: 'rain', cells: cloneRainEvents(command.cells) });
    case 'terrain':
      return Object.freeze({
        type: 'terrain',
        cells: Object.freeze([...command.cells]),
        delta: command.delta
      });
    case 'flow':
      return Object.freeze({ type: 'flow', steps: command.steps });
  }
}

function validateCommand(command: unknown): SimulationCommand {
  if (!isRecord(command) || typeof command['type'] !== 'string') {
    throw new TypeError('command must be an object with a known type');
  }

  switch (command['type']) {
    case 'rain': {
      if (!Array.isArray(command['cells']) || command['cells'].length > 64) {
        throw new RangeError('rain command must contain at most 64 cells');
      }
      const events = command['cells'].map((event, index) => {
        if (!isRecord(event)) throw new TypeError(`rain cell ${index} must be an object`);
        assertInteger(event['index'], 0, 63, `rain cell ${index} index`);
        assertInteger(event['amount'], 1, MAX_CELL_WATER, `rain cell ${index} amount`);
        return Object.freeze({ index: event['index'], amount: event['amount'] });
      });
      return Object.freeze({ type: 'rain', cells: Object.freeze(events) });
    }
    case 'terrain': {
      if (!Array.isArray(command['cells']) || command['cells'].length > 64) {
        throw new RangeError('terrain command must contain at most 64 cells');
      }
      const cells = command['cells'].map((index, position) => {
        assertInteger(index, 0, 63, `terrain cell ${position}`);
        return index;
      });
      assertInteger(command['delta'], -MAX_TERRAIN_HEIGHT, MAX_TERRAIN_HEIGHT, 'terrain delta');
      if (command['delta'] === 0) throw new RangeError('terrain delta must be non-zero');
      return Object.freeze({
        type: 'terrain',
        cells: Object.freeze(cells),
        delta: command['delta']
      });
    }
    case 'flow':
      assertInteger(command['steps'], 1, MAX_FLOW_STEPS_PER_COMMAND, 'flow steps');
      return Object.freeze({ type: 'flow', steps: command['steps'] });
    default:
      throw new TypeError(`unsupported command type: ${command['type']}`);
  }
}

function validateReplayLog(log: unknown): ReplayLogV1 {
  if (!isRecord(log) || log['version'] !== REPLAY_LOG_VERSION) {
    throw new Error('unsupported or invalid replay version');
  }
  const rawRules = log['rules'];
  if (!isRecord(rawRules) || rawRules['version'] !== WATER_RULES_VERSION) {
    throw new Error('unsupported or invalid water rules version');
  }
  assertInteger(rawRules['heightUnit'], 1, Number.MAX_SAFE_INTEGER, 'replay heightUnit');
  assertInteger(
    rawRules['maxFlowPerStep'],
    1,
    MAX_CELL_WATER,
    'replay maxFlowPerStep'
  );
  const rules = createRules({
    heightUnit: rawRules['heightUnit'],
    maxFlowPerStep: rawRules['maxFlowPerStep']
  });
  assertStateHash(log['initialStateHash'], 'replay initialStateHash');
  const rawEntries = log['entries'];
  if (!Array.isArray(rawEntries) || rawEntries.length > MAX_REPLAY_ENTRIES) {
    throw new RangeError(`replay must contain at most ${MAX_REPLAY_ENTRIES} entries`);
  }

  let totalFlowSteps = 0;
  const entries = rawEntries.map((entry, index) => {
    if (!isRecord(entry)) throw new TypeError(`replay entry ${index} must be an object`);
    assertInteger(entry['sequence'], 0, MAX_REPLAY_ENTRIES - 1, `replay entry ${index} sequence`);
    assertStateHash(entry['beforeHash'], `replay entry ${index} beforeHash`);
    assertStateHash(entry['afterHash'], `replay entry ${index} afterHash`);
    const command = validateCommand(entry['command']);
    if (command.type === 'flow') {
      totalFlowSteps = checkedReplayFlowStepTotal(totalFlowSteps, command.steps);
    }
    return Object.freeze({
      sequence: entry['sequence'],
      command,
      beforeHash: entry['beforeHash'],
      afterHash: entry['afterHash']
    });
  });

  return Object.freeze({
    version: REPLAY_LOG_VERSION,
    rules,
    initialStateHash: log['initialStateHash'],
    entries: Object.freeze(entries)
  });
}

function cloneEntry(entry: OperationLogEntry): OperationLogEntry {
  return Object.freeze({
    sequence: entry.sequence,
    command: cloneCommand(entry.command),
    beforeHash: entry.beforeHash,
    afterHash: entry.afterHash
  });
}

export class WaterSimulation {
  private readonly initialStateHashValue: string;
  private readonly rulesValue: WaterRulesV1;
  private readonly entries: OperationLogEntry[] = [];
  private boardValue: BoardState;
  private replayFlowStepsValue = 0;

  public constructor(
    initial: BoardDefinition | BoardSnapshot = {},
    config?: Partial<WaterModelConfig>
  ) {
    this.boardValue =
      'flowStep' in initial
        ? BoardState.fromSnapshot(initial)
        : new BoardState(initial);
    this.rulesValue = createRules(config);
    this.initialStateHashValue = this.stateHash;
  }

  public get snapshot(): BoardSnapshot {
    return this.boardValue.snapshot();
  }

  public get rules(): WaterRulesV1 {
    return this.rulesValue;
  }

  public get stateHash(): string {
    return hashBoardSnapshot(this.boardValue.snapshot());
  }

  public execute(commandInput: SimulationCommand): SimulationExecution {
    if (this.entries.length >= MAX_REPLAY_ENTRIES) {
      throw new RangeError(`simulation cannot exceed ${MAX_REPLAY_ENTRIES} commands`);
    }
    const command = validateCommand(commandInput);
    const nextReplayFlowSteps =
      command.type === 'flow'
        ? checkedReplayFlowStepTotal(this.replayFlowStepsValue, command.steps)
        : this.replayFlowStepsValue;
    const beforeHash = this.stateHash;
    const nextBoard = this.boardValue.clone();
    const flowSteps: FlowStepResult[] = [];

    switch (command.type) {
      case 'rain':
        nextBoard.addRain(command.cells);
        break;
      case 'terrain':
        nextBoard.applyTerrainDelta(command.cells, command.delta);
        break;
      case 'flow':
        for (let step = 0; step < command.steps; step += 1) {
          flowSteps.push(advanceWaterFlow(nextBoard, { config: this.rulesValue }));
        }
        break;
    }

    const afterHash = hashBoardSnapshot(nextBoard.snapshot());
    const entry = Object.freeze({
      sequence: this.entries.length,
      command,
      beforeHash,
      afterHash
    });
    this.boardValue = nextBoard;
    this.entries.push(entry);
    this.replayFlowStepsValue = nextReplayFlowSteps;
    return Object.freeze({
      entry: cloneEntry(entry),
      flowSteps: Object.freeze(flowSteps)
    });
  }

  public exportReplayLog(): ReplayLogV1 {
    return Object.freeze({
      version: REPLAY_LOG_VERSION,
      rules: this.rulesValue,
      initialStateHash: this.initialStateHashValue,
      entries: Object.freeze(this.entries.map(cloneEntry))
    });
  }
}

export function replaySimulation(
  initial: BoardDefinition | BoardSnapshot,
  logInput: ReplayLogV1 | unknown
): WaterSimulation {
  const log = validateReplayLog(logInput);

  const simulation = new WaterSimulation(initial, log.rules);
  if (simulation.stateHash !== log.initialStateHash) {
    throw new Error('replay initial state does not match the recorded state');
  }

  for (let index = 0; index < log.entries.length; index += 1) {
    const expected = log.entries[index];
    if (expected === undefined) throw new Error(`missing replay entry ${index}`);
    if (expected.sequence !== index) {
      throw new Error(`replay sequence mismatch at entry ${expected.sequence}`);
    }
    if (simulation.stateHash !== expected.beforeHash) {
      throw new Error(`replay beforeHash mismatch at entry ${expected.sequence}`);
    }
    const actual = simulation.execute(expected.command);
    if (actual.entry.afterHash !== expected.afterHash) {
      throw new Error(`replay afterHash mismatch at entry ${expected.sequence}`);
    }
  }

  return simulation;
}
