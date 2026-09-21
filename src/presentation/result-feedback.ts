import type {
  StageFailureReason,
  StageMetrics,
  StagePhase,
  StageScore
} from '../domain/stage-session';
import type { StageObjective } from '../domain/stage-definition';
import { objectiveTypeLabel } from './stage-copy';
import { cellLabel } from './cell-label';

export interface ResultFeedbackInput {
  readonly phase: Extract<StagePhase, 'cleared' | 'failed'>;
  readonly failureReasons: readonly StageFailureReason[];
  readonly metrics: Pick<StageMetrics, 'firstFloodStep' | 'firstFloodStepByCell'>;
  readonly score: StageScore;
  /** The validated stage objective used to keep advice goal-aware. */
  readonly objective?: Pick<StageObjective, 'type' | 'target'>;
  /** Legal anchor cells before the terminal action; never used to guess a solution. */
  readonly legalConstructionRange?: readonly number[];
}

function hasReason(
  reasons: readonly StageFailureReason[],
  reason: StageFailureReason
): boolean {
  return reasons.includes(reason);
}

function legalRangeText(input: ResultFeedbackInput): string {
  const count = input.legalConstructionRange?.length ?? 0;
  return count > 0
    ? `施工可能な範囲（${count}か所）`
    : '施工可能な範囲がないため、候補を切り替える';
}

function objectiveType(input: ResultFeedbackInput): StageObjective['type'] | null {
  return input.objective?.type ?? null;
}

function objectiveAction(input: ResultFeedbackInput): string {
  const objective = input.objective;
  if (objective === undefined) return 'ステージの目的';
  return objectiveTypeLabel(objective.type);
}

function constructionNextStep(input: ResultFeedbackInput, action: string): string {
  const range = legalRangeText(input);
  return `${objectiveAction(input)}。${range}から候補を選び、プレビューで${action}を確認してください。`;
}

/** Returns the first observable break point without inventing a location. */
export function resultFirstBreakText(input: ResultFeedbackInput): string {
  if (input.phase === 'cleared') return '最初の破綻: なし（目標を達成）';

  if (hasReason(input.failureReasons, 'protected-overflow')) {
    let firstCellIndex = -1;
    let firstStep = Number.POSITIVE_INFINITY;
    input.metrics.firstFloodStepByCell.forEach((step, cellIndex) => {
      if (step !== null && step < firstStep) {
        firstCellIndex = cellIndex;
        firstStep = step;
      }
    });
    if (firstCellIndex >= 0) return `最初の破綻: 保護対象の${cellLabel(firstCellIndex)}`;
    if (input.metrics.firstFloodStep !== null) return '最初の破綻: 保護対象の浸水';
    return '最初の破綻: 保護対象';
  }
  if (hasReason(input.failureReasons, 'danger-leak')) return '最初の破綻: 危険側の出口';
  if (hasReason(input.failureReasons, 'objective-not-met')) return '最初の破綻: 目的の未達';
  return '最初の破綻: 特定できません';
}

/** Summarizes the existing domain failure reasons as one short cause sentence. */
export function resultCauseText(input: ResultFeedbackInput): string {
  if (input.phase === 'cleared') return '目的を達成しました。次は評価軸の改善を狙えます。';

  const protectedOverflow = hasReason(input.failureReasons, 'protected-overflow');
  const dangerLeak = hasReason(input.failureReasons, 'danger-leak');
  if (protectedOverflow && dangerLeak) {
    return '危険側への流出と保護対象の浸水が発生したため、目標を守れませんでした。';
  }
  if (protectedOverflow) return '保護対象への浸水が発生したため、目標を守れませんでした。';
  if (dangerLeak) return '水が危険側へ流出したため、目標を守れませんでした。';
  if (hasReason(input.failureReasons, 'objective-not-met')) {
    return '必要な目的値に届かないまま手番を終えました。';
  }
  return '今回の手番では目標を守れませんでした。';
}

/** Chooses exactly one actionable next step from the existing evidence. */
export function resultImprovementHint(input: ResultFeedbackInput): string {
  if (input.phase === 'failed') {
    if (hasReason(input.failureReasons, 'protected-overflow')) {
      if (objectiveType(input) === 'stored-water') {
        return `次に改善する1点: ${constructionNextStep(input, '池に残る水を保ちつつ、保護対象への浸水が消えるか')}`;
      }
      return `次に改善する1点: ${constructionNextStep(input, '保護対象への浸水が消えるか')}`;
    }
    if (hasReason(input.failureReasons, 'danger-leak')) {
      if (objectiveType(input) === 'stored-water') {
        return `次に改善する1点: ${constructionNextStep(input, '池にためる進捗を保ちながら危険側への流出が消えるか')}`;
      }
      if (objectiveType(input) === 'safe-drain') {
        return `次に改善する1点: ${constructionNextStep(input, '安全な出口への流れが増え、危険側への流出が消えるか')}`;
      }
      if (objectiveType(input) === null) {
        return '次に改善する1点: 危険側へ向かう低い辺を、施工可能な範囲から選んで先に塞ぐか、安全排水へつながるかをプレビューで確認してください。';
      }
      return `次に改善する1点: ${constructionNextStep(input, '保護対象を守りながら危険側への流出が消えるか')}`;
    }
    if (hasReason(input.failureReasons, 'objective-not-met')) {
      if (objectiveType(input) === 'stored-water') {
        return `次に改善する1点: ${constructionNextStep(input, '池に残る水量が目標へ近づくか')}`;
      }
      if (objectiveType(input) === 'safe-drain') {
        return `次に改善する1点: ${constructionNextStep(input, '安全な出口への進捗が目標へ近づくか')}`;
      }
      if (objectiveType(input) === null) {
        return '次に改善する1点: 目的のセルを先に整え、最後の雨まで進捗を残せる候補かを、施工可能な範囲のプレビューで確認してください。';
      }
      return `次に改善する1点: ${constructionNextStep(input, '保護対象を守る進捗が続くか')}`;
    }
    return `次に改善する1点: ${constructionNextStep(input, '雨予報と最終見込みに合うか')}`;
  }

  if (input.score.safety < 50) {
    return `次に改善する1点: ${constructionNextStep(input, '危険側への流出が抑えられるか')}`;
  }
  if (input.score.control < 20) {
    if (objectiveType(input) === 'stored-water') {
      return `次に改善する1点: ${constructionNextStep(input, '池にためる量が目標を保ったまま伸びるか')}`;
    }
    if (objectiveType(input) === 'protect') {
      return `次に改善する1点: ${constructionNextStep(input, '保護対象を守る進捗が保たれるか')}`;
    }
    return `次に改善する1点: ${constructionNextStep(input, '安全排水が増え、排水能力の超過が抑えられるか')}`;
  }
  if (input.score.efficiency < 30) {
    return `次に改善する1点: ${constructionNextStep(input, '同じ目的を少ない工事で達成できるか')}`;
  }
  return `次に改善する1点: ${constructionNextStep(input, '同じ安全をより短い工事で目指せるか')}`;
}
