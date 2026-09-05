export interface ResultScoreGuideDefinition {
  readonly objective: {
    readonly type: 'stored-water' | 'safe-drain' | 'protect';
    readonly target: number;
  };
  readonly evaluation: {
    readonly controlTarget: number;
  };
}

const SCORE_AXIS_SUMMARY = 'スコアは安全50点・工事効率30点・流量制御20点で計算します。';

/** Explains the score units without changing the domain evaluation. */
export function resultScoreGuideText(
  definition: ResultScoreGuideDefinition
): string {
  switch (definition.objective.type) {
    case 'stored-water':
      return `${SCORE_AXIS_SUMMARY} クリア条件は池に雨水を${definition.objective.target}ためること。流量制御は池に残った水を${definition.evaluation.controlTarget}まで評価します。`;
    case 'safe-drain':
      return `${SCORE_AXIS_SUMMARY} クリア条件は安全な出口へ水を${definition.objective.target}流すこと。流量制御も安全排水を${definition.evaluation.controlTarget}まで評価します。`;
    case 'protect':
      return `${SCORE_AXIS_SUMMARY} クリア条件は保護対象を${definition.objective.target}回守ること。流量制御は守れた雨の水量を${definition.evaluation.controlTarget}まで評価します。`;
  }
}
