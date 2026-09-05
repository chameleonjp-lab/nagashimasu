import { describe, expect, it } from 'vitest';

import { getBuiltInStage } from '../../src/domain/stages';
import {
  objectiveProgressTitle,
  phaseLabel,
  stageGoalExplanation,
  stageNumber,
  stageObjectiveText,
  terminalPhaseLabel
} from '../../src/presentation/stage-copy';

function stage(id: string) {
  const definition = getBuiltInStage(id);
  if (definition === undefined) throw new Error(`stage fixture missing: ${id}`);
  return definition;
}

describe('stage presentation copy', () => {
  it('describes each built-in objective in player language', () => {
    expect(stageObjectiveText(stage('stage-01-first-pond'))).toBe('池に雨水を24ためる');
    expect(stageObjectiveText(stage('stage-02-open-to-sea'))).toBe('安全な出口へ水を8流す');
    expect(stageObjectiveText(stage('stage-03-rain-order'))).toBe('保護対象を3回守る');
  });

  it('keeps the safe outlet and protect explanations explicit', () => {
    expect(stageGoalExplanation(stage('stage-02-open-to-sea'))).toContain('緑の辺の「安全な出口」');
    expect(stageGoalExplanation(stage('stage-03-rain-order'))).toContain('雨のたびに');
  });

  it('extracts the visible stage number from the definition id', () => {
    expect(stageNumber(stage('stage-01-first-pond'))).toBe(1);
    expect(stageNumber(stage('stage-03-rain-order'))).toBe(3);
  });

  it('labels trace phases and terminal states', () => {
    expect(phaseLabel('flow', 4)).toBe('水流を再生中（step 4）');
    expect(phaseLabel('evaluation', null)).toBe('結果を判定中');
    expect(terminalPhaseLabel('awaiting-turn')).toBe('継続中');
    expect(terminalPhaseLabel('failed')).toBe('失敗');
  });

  it('names the progress value for each objective type', () => {
    expect(objectiveProgressTitle(stage('stage-01-first-pond'))).toBe('池にためた水');
    expect(objectiveProgressTitle(stage('stage-02-open-to-sea'))).toBe('安全に排水した水');
    expect(objectiveProgressTitle(stage('stage-03-rain-order'))).toBe('守れた雨');
  });
});
