import type { Direction } from './constants';

export interface BoardDefinition {
  readonly terrain?: ArrayLike<number>;
  readonly water?: ArrayLike<number>;
  readonly cellFlags?: ArrayLike<number>;
  readonly drainCapacity?: ArrayLike<number>;
  readonly protectedWaterLimit?: ArrayLike<number>;
  readonly safeEdgeMask?: ArrayLike<number>;
  readonly dangerEdgeMask?: ArrayLike<number>;
}

export interface BoardSnapshot {
  readonly terrain: readonly number[];
  readonly water: readonly number[];
  readonly cellFlags: readonly number[];
  readonly drainCapacity: readonly number[];
  readonly protectedWaterLimit: readonly number[];
  readonly safeEdgeMask: readonly number[];
  readonly dangerEdgeMask: readonly number[];
  readonly flowStep: number;
  readonly introducedWater: number;
  readonly safeDrain: number;
  readonly dangerLeak: number;
}

export interface RainEvent {
  readonly index: number;
  readonly amount: number;
}

export interface WaterModelConfig {
  readonly heightUnit: number;
  readonly maxFlowPerStep: number;
}

export interface WaterRulesV1 extends WaterModelConfig {
  readonly version: 'nagashimasu-water-v1';
}

export interface FlowStepResult {
  readonly flowStep: number;
  readonly movedWater: number;
  readonly safeDrained: number;
  readonly dangerLeaked: number;
  readonly protectedOverflow: number;
  readonly transfers: readonly WaterTransfer[];
  readonly drains: readonly DrainEvent[];
  readonly protectedOverflows: readonly CellWaterAmount[];
}

export interface WaterTransfer {
  readonly from: number;
  readonly to: number | null;
  readonly direction: Direction;
  readonly kind: 'cell' | 'safe-edge' | 'danger-edge';
  readonly amount: number;
}

export interface DrainEvent {
  readonly index: number;
  readonly amount: number;
}

export interface CellWaterAmount {
  readonly index: number;
  readonly amount: number;
}

export interface CellCoordinate {
  readonly row: number;
  readonly column: number;
}

export interface OutsideTarget {
  readonly direction: Direction;
  readonly kind: 'safe' | 'danger';
}

export type SimulationCommand =
  | {
      readonly type: 'rain';
      readonly cells: readonly RainEvent[];
    }
  | {
      readonly type: 'terrain';
      readonly cells: readonly number[];
      readonly delta: number;
    }
  | {
      readonly type: 'flow';
      readonly steps: number;
    };

export interface OperationLogEntry {
  readonly sequence: number;
  readonly command: SimulationCommand;
  readonly beforeHash: string;
  readonly afterHash: string;
}

export interface SimulationExecution {
  readonly entry: OperationLogEntry;
  readonly flowSteps: readonly FlowStepResult[];
}

export interface ReplayLogV1 {
  readonly version: 'nagashimasu-replay-v1';
  readonly rules: WaterRulesV1;
  readonly initialStateHash: string;
  readonly entries: readonly OperationLogEntry[];
}
