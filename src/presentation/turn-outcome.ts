import type {
  FlowStepResult,
  RainEvent,
  WaterTransfer
} from '../domain/types';
import type {
  StageExecution,
  StagePhase,
  StageTraceEvent
} from '../domain/stage-session';
import { cellLabel } from './cell-label';

export interface TurnOutcomeSummary {
  readonly construction: string;
  readonly rain: string;
  readonly flow: string;
  readonly result: string;
}

export interface TurnOutcomeInput {
  readonly construction: string;
  readonly trace: StageExecution['trace'];
  readonly phase: StagePhase;
}

function uniqueLabels(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}

function rainEvents(trace: readonly StageTraceEvent[]): readonly RainEvent[] {
  return trace.flatMap((event) => event.rainCells);
}

function flowResults(trace: readonly StageTraceEvent[]): readonly FlowStepResult[] {
  return trace.flatMap((event) =>
    event.flowResult === null ? [] : [event.flowResult]
  );
}

function rainSummary(trace: readonly StageTraceEvent[]): string {
  const cells = rainEvents(trace);
  if (cells.length === 0) return '雨: この手番は降っていません。';

  const total = cells.reduce((sum, cell) => sum + cell.amount, 0);
  const locations = uniqueLabels(cells.map((cell) => cellLabel(cell.index)));
  return `雨: 合計${total}（${locations.join('・')}）`;
}

function transferDestination(transfer: WaterTransfer): string {
  if (transfer.to !== null) return cellLabel(transfer.to);
  return transfer.kind === 'danger-edge' ? '危険側' : '安全な排水口';
}

function flowSummary(trace: readonly StageTraceEvent[]): string {
  const results = flowResults(trace);
  if (results.length === 0) return '水: この手番の水流はありません。';

  const moved = results.reduce((sum, result) => sum + result.movedWater, 0);
  const safeDrained = results.reduce((sum, result) => sum + result.safeDrained, 0);
  const dangerLeaked = results.reduce((sum, result) => sum + result.dangerLeaked, 0);
  const protectedOverflow = results.reduce(
    (sum, result) => sum + result.protectedOverflow,
    0
  );
  const routes = uniqueLabels(
    results.flatMap((result) =>
      result.transfers.map(
        (transfer) => `${cellLabel(transfer.from)}→${transferDestination(transfer)}`
      )
    )
  );
  const parts: string[] = [];
  if (moved > 0) parts.push(`移動${moved}`);
  if (safeDrained > 0) parts.push(`安全排水${safeDrained}`);
  if (dangerLeaked > 0) parts.push(`危険側へ流出${dangerLeaked}`);
  if (protectedOverflow > 0) parts.push(`保護対象への浸水${protectedOverflow}`);

  if (parts.length === 0) return '水: 大きな移動はありませんでした。';
  const routeText = routes.length > 0
    ? `。流れ: ${routes.slice(0, 3).join('、')}${routes.length > 3 ? '…' : ''}`
    : '';
  return `水: ${parts.join('・')}${routeText}`;
}

function resultSummary(phase: StagePhase): string {
  switch (phase) {
    case 'awaiting-turn': return '結果: この手番の処理が終わりました。次の手番へ進めます。';
    case 'cleared': return '結果: この手番でステージの目標を達成しました。';
    case 'failed': return '結果: この手番で失敗条件に達しました。下の結果欄に原因を表示します。';
  }
}

/** Summarizes the authoritative trace so a player can connect action, rain, flow, and result. */
export function buildTurnOutcomeSummary(input: TurnOutcomeInput): TurnOutcomeSummary {
  return Object.freeze({
    construction: input.construction,
    rain: rainSummary(input.trace),
    flow: flowSummary(input.trace),
    result: resultSummary(input.phase)
  });
}
