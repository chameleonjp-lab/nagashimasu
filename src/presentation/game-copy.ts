import type {
  StageFailureReason,
  StagePhase,
  StageRejectionReason,
  StageTracePhase
} from '../domain/stage-session';

export interface PlaybackGuideText {
  readonly action: string;
  readonly detail: string;
}

export function playbackGuideText(
  phase: StageTracePhase,
  flowStep: number | null
): PlaybackGuideText {
  switch (phase) {
    case 'construction':
      return {
        action: 'いま起きていること: 地面の高さを変えています。',
        detail: '選んだ配置を盤面へ反映しています。'
      };
    case 'rain':
      return {
        action: 'いま起きていること: 予報どおりに雨が降っています。',
        detail: '雨が降ったセルと雨量を盤面で確認できます。'
      };
    case 'flow':
      return {
        action: `いま起きていること: 水が移動しています（${flowStep ?? '-'}回目）。`,
        detail: '水は低い方へ流れ、安全な出口か危険側へ進みます。'
      };
    case 'evaluation':
      return {
        action: 'いま起きていること: 目標を達成したか確認しています。',
        detail: '処理が終わるまで少し待ってください。'
      };
    case 'undo':
      return {
        action: 'いま起きていること: 直前の手を元に戻しています。',
        detail: '元に戻った盤面を確認してから、次の手を選べます。'
      };
  }
}

export function failureReasonText(reason: StageFailureReason): string {
  const labels: Readonly<Record<StageFailureReason, string>> = {
    'danger-leak': '危険側へ流出しました',
    'protected-overflow': '保護対象が浸水しました',
    'objective-not-met': 'ステージの目的を達成できませんでした'
  };
  return labels[reason];
}

export function resultVisualText(
  phase: StagePhase,
  failureReasons: readonly StageFailureReason[]
): string {
  if (phase === 'cleared') return 'クリア：目標を達成しました';
  if (failureReasons.includes('protected-overflow')) {
    return '失敗：保護対象が浸水しました';
  }
  if (failureReasons.includes('danger-leak')) {
    return '失敗：水が危険側へ流れました';
  }
  return '失敗：目標を達成できませんでした';
}

export function rejectionReasonText(reason: StageRejectionReason | null): string {
  if (reason === null) return '';
  const labels: Readonly<Partial<Record<StageRejectionReason, string>>> = {
    'cell-out-of-bounds': '盤面の外です。',
    'anchor-out-of-bounds': '置き場所が盤面の外です。',
    'construction-forbidden': 'ここは施工できません。',
    'terrain-limit': '地形の高さ上限または下限に達します。',
    'candidate-exhausted': '候補が尽きています。',
    'timer-disabled': 'このステージではタイムアウトを使えません。',
    'stage-complete': 'このステージは終了しています。',
    'undo-already-used': 'Undoはこのステージで1回だけ使えます。',
    'undo-unavailable': '戻せる手番がありません。'
  };
  return labels[reason] ?? `操作を受け付けません（${reason}）。`;
}
