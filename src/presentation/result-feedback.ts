import type {
  StageFailureReason,
  StageMetrics,
  StagePhase,
  StageScore
} from '../domain/stage-session';
import { cellLabel } from './cell-label';

export interface ResultFeedbackInput {
  readonly phase: Extract<StagePhase, 'cleared' | 'failed'>;
  readonly failureReasons: readonly StageFailureReason[];
  readonly metrics: Pick<StageMetrics, 'firstFloodStep' | 'firstFloodStepByCell'>;
  readonly score: StageScore;
}

function hasReason(
  reasons: readonly StageFailureReason[],
  reason: StageFailureReason
): boolean {
  return reasons.includes(reason);
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
      return '次に改善する1点: 保護対象へ流れ込む前に、そこを1段上げるか水を別の流路へ分けてください。';
    }
    if (hasReason(input.failureReasons, 'danger-leak')) {
      return '次に改善する1点: 危険側へ向かう低い辺を先に塞ぐか、安全排水へつなげてください。';
    }
    if (hasReason(input.failureReasons, 'objective-not-met')) {
      return '次に改善する1点: 目的のセルを先に整え、最後の雨まで進捗を残してください。';
    }
    return '次に改善する1点: 雨予報と最終見込みを見て、危険な流れを先に直してください。';
  }

  if (input.score.safety < 50) {
    return '次に改善する1点: 危険側への流出を抑え、より安全に水を流してください。';
  }
  if (input.score.control < 20) {
    return '次に改善する1点: 安全排水を分散し、排水能力の超過を抑えてください。';
  }
  if (input.score.efficiency < 30) {
    return '次に改善する1点: 変更セルを減らし、同じ目的を少ない工事で達成してください。';
  }
  return '次に改善する1点: 候補を残し、同じ安全をより短い工事で目指してください。';
}
