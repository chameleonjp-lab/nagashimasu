import type { StageTracePhase } from '../domain/stage-session';
import type {
  StageObjective,
  StageObjectiveType,
  ValidatedStageDefinition
} from '../domain/stage-definition';

export type StageObjectiveLike = Pick<StageObjective, 'type' | 'target'>;

export function stageObjectiveText(definition: ValidatedStageDefinition): string {
  switch (definition.objective.type) {
    case 'stored-water': return `池に雨水を${definition.objective.target}ためる`;
    case 'safe-drain': return `安全な出口へ水を${definition.objective.target}流す`;
    case 'protect': return `保護対象を${definition.objective.target}回守る`;
  }
}

export function stageGoalExplanation(definition: ValidatedStageDefinition): string {
  switch (definition.objective.type) {
    case 'stored-water':
      return `池に雨水をため、合計${definition.objective.target}まで集めるとクリアです。`;
    case 'safe-drain':
      return `緑の辺の「安全な出口」へ水を流し、合計${definition.objective.target}以上にするとクリアです。`;
    case 'protect':
      return `雨のたびに保護対象を浸水させず、${definition.objective.target}回守るとクリアです。`;
  }
}

/**
 * Keeps advice and preview copy tied to the stage's actual objective.  The
 * caller supplies the objective from the validated stage definition; this
 * helper never guesses a destination or a correct cell.
 */
export function objectiveActionText(objective: StageObjectiveLike): string {
  switch (objective.type) {
    case 'stored-water': return `池に水をためる（目標${objective.target}）`;
    case 'safe-drain': return `安全な出口へ流す（目標${objective.target}）`;
    case 'protect': return `保護対象を守る（目標${objective.target}回）`;
  }
}

export function objectiveTypeLabel(type: StageObjectiveType): string {
  switch (type) {
    case 'stored-water': return '池にためる目標';
    case 'safe-drain': return '安全な出口へ流す目標';
    case 'protect': return '保護対象を守る目標';
  }
}

/**
 * Describes a skip forecast without implying that skipping is always good or
 * bad.  The projected phase and objective progress are supplied by the
 * authoritative StageTurnPreview.
 */
export function skipForecastResultText(
  objective: StageObjectiveLike,
  phase: 'awaiting-turn' | 'cleared' | 'failed',
  progress: { readonly value: number; readonly target: number },
  failureReasons: readonly string[]
): string {
  const progressText = `${progress.value} / ${progress.target}`;
  if (phase === 'cleared') return `見送り予測: クリア（${objectiveActionText(objective)}・進捗${progressText}）`;
  if (phase === 'failed') {
    const reason = failureReasons.length > 0 ? `（${failureReasons.join('・')}）` : '';
    return `見送り予測: 失敗${reason}。${objectiveTypeLabel(objective.type)}の進捗は${progressText}です。`;
  }
  return `見送り予測: 継続（${objectiveActionText(objective)}・進捗${progressText}）`;
}

export function stageNumber(definition: ValidatedStageDefinition): number {
  const match = /^stage-(\d+)/u.exec(definition.id);
  return Number(match?.[1] ?? 0);
}

export function phaseLabel(phase: StageTracePhase, flowStep: number | null): string {
  switch (phase) {
    case 'construction': return '施工を反映中';
    case 'rain': return '雨を処理中';
    case 'flow': return `水流を再生中（step ${flowStep ?? '-'}）`;
    case 'evaluation': return '結果を判定中';
    case 'undo': return 'Undoを反映中';
  }
}

export function terminalPhaseLabel(phase: 'awaiting-turn' | 'cleared' | 'failed'): string {
  switch (phase) {
    case 'awaiting-turn': return '継続中';
    case 'cleared': return 'クリア';
    case 'failed': return '失敗';
  }
}

export function objectiveProgressTitle(
  definition: Pick<ValidatedStageDefinition, 'objective'>
): string {
  switch (definition.objective.type) {
    case 'stored-water': return '池にためた水';
    case 'safe-drain': return '安全に排水した水';
    case 'protect': return '守れた雨';
  }
}
