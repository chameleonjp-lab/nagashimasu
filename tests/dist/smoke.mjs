import {
  BoardState,
  CELL_COUNT,
  BUILT_IN_STAGES,
  CellFlag,
  Direction,
  STAGE_RULES_VERSION,
  createStageSession,
  WATER_RULES_VERSION
} from '../../dist/nagashimasu-domain.js';

if (CELL_COUNT !== 64) throw new Error('built library exported an invalid board size');
if (Direction.North !== 1) throw new Error('built library did not export Direction');
if (CellFlag.Protected !== 1) throw new Error('built library did not export CellFlag');
if (WATER_RULES_VERSION !== 'nagashimasu-water-v1') {
  throw new Error('built library exported an unexpected rules version');
}
if (new BoardState().totalWater !== 0) {
  throw new Error('built library could not construct an empty board');
}
if (STAGE_RULES_VERSION !== 'nagashimasu-stage-rules-v1') {
  throw new Error('built library exported an unexpected stage rules version');
}
if (BUILT_IN_STAGES.length !== 3) {
  throw new Error('built library did not export the three M2 stages');
}
const stageSession = createStageSession(BUILT_IN_STAGES[0], 'unlimited');
const firstTurn = stageSession.execute({
  type: 'skip',
  actionId: 0,
  expectedRevision: 0
});
if (!firstTurn.accepted || firstTurn.snapshot.completedTurns !== 1) {
  throw new Error('built library could not execute an M2 stage turn');
}
