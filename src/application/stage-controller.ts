import type { ValidatedStageDefinition } from '../domain/stage-definition';
import type {
  CandidateSlot,
  StageAction,
  StageRotation,
  StageTimerMode
} from '../domain/stage-replay';
import type { PieceOffset } from '../domain/pieces';
import type {
  StageActionValidation,
  StageExecution,
  StageRainForecast,
  StageSession,
  StageSessionSnapshot,
  StageTurnPreview
} from '../domain/stage-session';
import { createStageSession, replayStageSession } from '../domain/stage-session';
import { parseValidatedStageDefinition } from '../domain/stage-definition';

export interface CandidateCardView {
  readonly slot: CandidateSlot;
  readonly pieceId: string;
  readonly tokenId: number;
  readonly delta: number;
  readonly cellCount: number;
  readonly offsets: readonly PieceOffset[];
  readonly selected: boolean;
}

export interface PendingPlacementView {
  readonly slot: CandidateSlot;
  readonly anchorIndex: number;
  readonly rotation: StageRotation;
}

export interface StageControllerView {
  readonly snapshot: StageSessionSnapshot;
  readonly forecasts: readonly StageRainForecast[];
  readonly candidates: readonly CandidateCardView[];
  readonly legalAnchorIndices: readonly number[];
  readonly pending: PendingPlacementView | null;
  readonly validation: StageActionValidation | null;
  readonly preview: StageTurnPreview | null;
}

function nextRotation(rotation: StageRotation): StageRotation {
  return ((rotation + 1) % 4) as StageRotation;
}

function candidateCard(
  definition: ValidatedStageDefinition,
  snapshot: StageSessionSnapshot,
  slot: CandidateSlot,
  selectedSlot: CandidateSlot
): CandidateCardView {
  const pieceId = snapshot.candidates[slot];
  if (pieceId === undefined) throw new Error(`candidate slot ${slot} is empty`);
  const piece = definition.pieceDefinitions.find((candidate) => candidate.id === pieceId);
  if (piece === undefined) throw new Error(`candidate piece ${pieceId} is missing`);
  return Object.freeze({
    slot,
    pieceId,
    tokenId: snapshot.candidateTokenIds[slot] ?? -1,
    delta: piece.delta,
    cellCount: piece.offsets.length,
    offsets: piece.offsets,
    selected: slot === selectedSlot
  });
}

/**
 * Presentation-facing application adapter. It owns selection and preview
 * state while the StageSession remains the only authority that changes rules.
 */
export class StageController {
  private readonly definition: ValidatedStageDefinition;
  private readonly sessionValue: StageSession;
  private selectedSlotValue: CandidateSlot = 0;
  private pendingValue: PendingPlacementView | null = null;

  public constructor(
    definition: ValidatedStageDefinition,
    timerMode: StageTimerMode = 'standard',
    replayInput?: unknown
  ) {
    this.definition = parseValidatedStageDefinition(definition);
    this.sessionValue = replayInput === undefined
      ? createStageSession(this.definition, timerMode)
      : replayStageSession(this.definition, replayInput);
  }

  public get session(): StageSession {
    return this.sessionValue;
  }

  public get definitionValue(): ValidatedStageDefinition {
    return this.definition;
  }

  public get selectedSlot(): CandidateSlot {
    return this.selectedSlotValue;
  }

  public selectCandidate(slot: CandidateSlot): void {
    if (slot !== 0 && slot !== 1) throw new RangeError('candidate slot must be 0 or 1');
    this.selectedSlotValue = slot;
    if (this.pendingValue !== null && this.pendingValue.slot !== slot) {
      this.pendingValue = Object.freeze({
        ...this.pendingValue,
        slot,
        rotation: 0
      });
    }
  }

  public setAnchor(anchorIndex: number): void {
    if (!Number.isSafeInteger(anchorIndex) || anchorIndex < 0 || anchorIndex >= 64) {
      throw new RangeError('anchor index must be an integer from 0 to 63');
    }
    this.pendingValue = Object.freeze({
      slot: this.selectedSlotValue,
      anchorIndex,
      rotation: this.pendingValue?.slot === this.selectedSlotValue
        ? this.pendingValue.rotation
        : 0
    });
  }

  public rotate(): void {
    if (this.pendingValue === null) return;
    this.pendingValue = Object.freeze({
      ...this.pendingValue,
      rotation: nextRotation(this.pendingValue.rotation)
    });
  }

  public cancelPlacement(): void {
    this.pendingValue = null;
  }

  /**
   * Returns every anchor that the selected candidate can legally use for the
   * current board and rotation. The result is presentation evidence only; the
   * StageSession still validates the action again on confirmation.
   */
  public get legalAnchorIndices(): readonly number[] {
    const snapshot = this.sessionValue.snapshot;
    if (snapshot.phase !== 'awaiting-turn') return Object.freeze([] as number[]);

    const rotation: StageRotation = this.pendingValue?.slot === this.selectedSlotValue
      ? this.pendingValue.rotation
      : 0;
    const legal: number[] = [];
    for (let anchorIndex = 0; anchorIndex < snapshot.board.terrain.length; anchorIndex += 1) {
      const validation = this.sessionValue.validate({
        type: 'construct',
        actionId: snapshot.nextActionId,
        expectedRevision: snapshot.revision,
        slot: this.selectedSlotValue,
        anchorIndex,
        rotation
      });
      if (validation.valid) legal.push(anchorIndex);
    }
    return Object.freeze(legal);
  }

  private pendingAction(): StageAction | null {
    const pending = this.pendingValue;
    if (pending === null) return null;
    const snapshot = this.sessionValue.snapshot;
    return Object.freeze({
      type: 'construct',
      actionId: snapshot.nextActionId,
      expectedRevision: snapshot.revision,
      slot: pending.slot,
      anchorIndex: pending.anchorIndex,
      rotation: pending.rotation
    });
  }

  public get validation(): StageActionValidation | null {
    const action = this.pendingAction();
    return action === null ? null : this.sessionValue.validate(action);
  }

  public get preview(): StageTurnPreview | null {
    const action = this.pendingAction();
    if (action === null) return null;
    const result = this.sessionValue.preview(action);
    return 'nextFlow' in result ? result : null;
  }

  private execute(action: StageAction): StageExecution {
    const execution = this.sessionValue.execute(action);
    if (execution.accepted) this.pendingValue = null;
    return execution;
  }

  public confirm(): StageExecution | null {
    const action = this.pendingAction();
    return action === null ? null : this.execute(action);
  }

  public skip(): StageExecution {
    const snapshot = this.sessionValue.snapshot;
    return this.execute({
      type: 'skip',
      actionId: snapshot.nextActionId,
      expectedRevision: snapshot.revision
    });
  }

  public timeout(): StageExecution {
    const snapshot = this.sessionValue.snapshot;
    return this.execute({
      type: 'timeout',
      actionId: snapshot.nextActionId,
      expectedRevision: snapshot.revision
    });
  }

  public undo(): StageExecution {
    const snapshot = this.sessionValue.snapshot;
    return this.execute({
      type: 'undo',
      actionId: snapshot.nextActionId,
      expectedRevision: snapshot.revision
    });
  }

  public get view(): StageControllerView {
    const snapshot = this.sessionValue.snapshot;
    return Object.freeze({
      snapshot,
      forecasts: this.sessionValue.rainForecast,
      candidates: Object.freeze([
        candidateCard(this.definition, snapshot, 0, this.selectedSlotValue),
        candidateCard(this.definition, snapshot, 1, this.selectedSlotValue)
      ]),
      legalAnchorIndices: this.legalAnchorIndices,
      pending: this.pendingValue,
      validation: this.validation,
      preview: this.preview
    });
  }
}
