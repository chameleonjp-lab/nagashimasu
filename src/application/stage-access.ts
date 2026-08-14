export const STAGE_ACCESS_ORDER = Object.freeze([
  'stage-01-first-pond',
  'stage-02-open-to-sea',
  'stage-03-rain-order'
] as const);

/** Returns whether a built-in stage is available from the recorded clear history. */
export function isStageUnlocked(
  stageId: string,
  clearedStageIds: readonly string[]
): boolean {
  const stageIndex = STAGE_ACCESS_ORDER.indexOf(stageId as (typeof STAGE_ACCESS_ORDER)[number]);
  if (stageIndex < 0) return false;
  if (clearedStageIds.includes(stageId)) return true;
  if (stageIndex === 0) return true;
  const previousStageId = STAGE_ACCESS_ORDER[stageIndex - 1];
  return previousStageId !== undefined && clearedStageIds.includes(previousStageId);
}

export function stageAccessLabel(
  stageId: string,
  clearedStageIds: readonly string[]
): string {
  if (!isStageUnlocked(stageId, clearedStageIds)) return '前のステージをクリアすると解放';
  return clearedStageIds.includes(stageId) ? 'クリア済み' : '挑戦可能';
}
