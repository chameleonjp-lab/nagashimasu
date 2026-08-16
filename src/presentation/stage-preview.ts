import type {
  StageSessionSnapshot,
  StageTurnPreview
} from '../domain/stage-session';

export interface StagePreviewSummary {
  readonly construction: string;
  readonly rain: string;
  readonly flow: string;
}

function cellLabel(index: number): string {
  return `セル${index + 1}`;
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
  const result = preview.nextFlow;
  const parts: string[] = [];
  if (result.movedWater > 0) parts.push(`移動${result.movedWater}`);
  if (result.safeDrained > 0) parts.push(`安全排水${result.safeDrained}`);
  if (result.dangerLeaked > 0) parts.push(`危険流出${result.dangerLeaked}`);
  if (result.protectedOverflow > 0) {
    parts.push(`保護セル浸水${result.protectedOverflow}`);
  }
  return parts.length === 0
    ? '次の水流で大きな変化はありません'
    : `次の水流: ${parts.join('・')}`;
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
    flow: flowSummary(preview)
  });
}
