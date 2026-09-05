import type {
  StageFailureReason,
  StageSessionSnapshot,
  StageTurnPreview
} from '../domain/stage-session';
import { cellLabel } from './cell-label';

export interface StagePreviewSummary {
  readonly construction: string;
  readonly rain: string;
  readonly flow: string;
  readonly result: string;
}

function constructionSummary(
  snapshot: StageSessionSnapshot,
  preview: StageTurnPreview
): string {
  if (preview.action.type !== 'construct' || preview.placementCells.length === 0) {
    return '施工なし';
  }

  const changes = preview.placementCells.map((index) => ({
    index,
    delta: (preview.terrainAfterConstruction[index] ?? 0) -
      (snapshot.board.terrain[index] ?? 0)
  }));
  const changed = changes.filter((change) => change.delta !== 0);
  if (changed.length === 0) return '施工なし';

  const sameDelta = changed.every((change) => change.delta === changed[0]?.delta);
  if (sameDelta) {
    const delta = changed[0]?.delta ?? 0;
    const direction = delta > 0 ? '上げる' : '下げる';
    return `${changed.map((change) => cellLabel(change.index)).join('・')}を${Math.abs(delta)}段${direction}`;
  }

  return changed
    .map((change) => `${cellLabel(change.index)}を${change.delta > 0 ? '上げる' : '下げる'}`)
    .join('・');
}

function rainSummary(preview: StageTurnPreview): string {
  if (preview.rainCells.length === 0) return 'この手の雨はありません';
  const total = preview.rainCells.reduce((sum, cell) => sum + cell.amount, 0);
  const cells = preview.rainCells.map((cell) => cellLabel(cell.index)).join('・');
  return `雨${total}（${cells}）`;
}

function flowSummary(preview: StageTurnPreview): string {
  const results = preview.flowSteps;
  const moved = results.reduce((sum, result) => sum + result.movedWater, 0);
  const safeDrained = results.reduce((sum, result) => sum + result.safeDrained, 0);
  const dangerLeaked = results.reduce((sum, result) => sum + result.dangerLeaked, 0);
  const protectedOverflow = results.reduce(
    (sum, result) => sum + result.protectedOverflow,
    0
  );
  const parts: string[] = [];
  if (moved > 0) parts.push(`移動${moved}`);
  if (safeDrained > 0) parts.push(`安全排水${safeDrained}`);
  if (dangerLeaked > 0) parts.push(`危険流出${dangerLeaked}`);
  if (protectedOverflow > 0) parts.push(`保護セル浸水${protectedOverflow}`);
  const horizon = `${results.length}回の水流後`;
  return parts.length === 0
    ? `${horizon}: 大きな変化はありません`
    : `${horizon}: ${parts.join('・')}`;
}

function failureReasonText(reason: StageFailureReason): string {
  switch (reason) {
    case 'danger-leak': return '危険側へ流出';
    case 'protected-overflow': return '保護セルが浸水';
    case 'objective-not-met': return '目的未達';
  }
}

function resultSummary(preview: StageTurnPreview): string {
  if (preview.phase === 'cleared') return '見込み: この手でクリアします';
  if (preview.phase === 'failed') {
    const reasons = preview.failureReasons.map(failureReasonText).join('・');
    return reasons.length > 0
      ? `見込み: 失敗（${reasons}）`
      : '見込み: 失敗';
  }
  if (preview.objectiveMet) return '見込み: この手の後で目標達成済みです';
  return '見込み: この手の後も続けられます';
}

/** Converts the authoritative preview evidence into short, user-facing text. */
export function buildStagePreviewSummary(
  snapshot: StageSessionSnapshot,
  preview: StageTurnPreview | null
): StagePreviewSummary | null {
  if (preview === null) return null;
  return Object.freeze({
    construction: constructionSummary(snapshot, preview),
    rain: rainSummary(preview),
    flow: flowSummary(preview),
    result: resultSummary(preview)
  });
}
