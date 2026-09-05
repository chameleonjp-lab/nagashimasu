import type { StageTracePhase } from '../domain/stage-session';
import type { ValidatedStageDefinition } from '../domain/stage-definition';

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

export function objectiveProgressTitle(definition: ValidatedStageDefinition): string {
  switch (definition.objective.type) {
    case 'stored-water': return '池にためた水';
    case 'safe-drain': return '安全に排水した水';
    case 'protect': return '守れた雨';
  }
}
