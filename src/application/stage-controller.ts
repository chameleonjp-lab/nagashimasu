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

interface CachedValue<T> {
  readonly key: string;
  readonly value: T;
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
  /** Render ticks do not change the domain state, so reuse derived evidence. */
  private viewCache: CachedValue<StageControllerView> | null = null;
  private legalAnchorCache: CachedValue<readonly number[]> | null = null;
  private validationCache: CachedValue<StageActionValidation | null> | null = null;
  private previewCache: CachedValue<StageTurnPreview | null> | null = null;
  private nonConstructionPreviewCache: {
    readonly key: string;
    readonly type: 'skip' | 'timeout';
    readonly value: StageTurnPreview | null;
  } | null = null;

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
    if (slot === this.selectedSlotValue &&
      (this.pendingValue === null || this.pendingValue.slot === slot)) return;
    this.selectedSlotValue = slot;
    if (this.pendingValue !== null && this.pendingValue.slot !== slot) {
      this.pendingValue = Object.freeze({
        ...this.pendingValue,
        slot,
        rotation: 0
      });
    }
    this.invalidateDerivedView();
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
    this.invalidateDerivedView();
  }

  public rotate(): void {
    if (this.pendingValue === null) return;
    this.pendingValue = Object.freeze({
      ...this.pendingValue,
      rotation: nextRotation(this.pendingValue.rotation)
    });
    this.invalidateDerivedView();
  }

  public cancelPlacement(): void {
    if (this.pendingValue === null) return;
    this.pendingValue = null;
    this.invalidateDerivedView();
  }

  private invalidateDerivedView(): void {
    this.viewCache = null;
    this.legalAnchorCache = null;
    this.validationCache = null;
    this.previewCache = null;
    this.nonConstructionPreviewCache = null;
  }

  private stateKey(snapshot: StageSessionSnapshot): string {
    const pending = this.pendingValue;
    return [
      snapshot.revision,
      snapshot.nextActionId,
      this.selectedSlotValue,
      pending?.slot ?? '-',
      pending?.anchorIndex ?? '-',
      pending?.rotation ?? '-'
    ].join(':');
  }

  private effectiveRotation(): StageRotation {
    return this.pendingValue?.slot === this.selectedSlotValue
      ? this.pendingValue.rotation
      : 0;
  }

  /**
   * Returns every anchor that the selected candidate can legally use for the
   * current board and rotation. The result is presentation evidence only; the
   * StageSession still validates the action again on confirmation.
   */
  private legalAnchorIndicesFor(snapshot: StageSessionSnapshot): readonly number[] {
    const key = [
      snapshot.revision,
      snapshot.nextActionId,
      this.selectedSlotValue,
      this.effectiveRotation()
    ].join(':');
    if (this.legalAnchorCache?.key === key) return this.legalAnchorCache.value;
    if (snapshot.phase !== 'awaiting-turn') {
      const empty = Object.freeze([] as number[]);
      this.legalAnchorCache = { key, value: empty };
      return empty;
    }

    const legal: number[] = [];
    for (let anchorIndex = 0; anchorIndex < snapshot.board.terrain.length; anchorIndex += 1) {
      const validation = this.sessionValue.validate({
        type: 'construct',
        actionId: snapshot.nextActionId,
        expectedRevision: snapshot.revision,
        slot: this.selectedSlotValue,
        anchorIndex,
        rotation: this.effectiveRotation()
      });
      if (validation.valid) legal.push(anchorIndex);
    }
    const value = Object.freeze(legal);
    this.legalAnchorCache = { key, value };
    return value;
  }

  public get legalAnchorIndices(): readonly number[] {
    return this.legalAnchorIndicesFor(this.sessionValue.snapshot);
  }

  private pendingAction(snapshot: StageSessionSnapshot): StageAction | null {
    const pending = this.pendingValue;
    if (pending === null) return null;
    return Object.freeze({
      type: 'construct',
      actionId: snapshot.nextActionId,
      expectedRevision: snapshot.revision,
      slot: pending.slot,
      anchorIndex: pending.anchorIndex,
      rotation: pending.rotation
    });
  }

  private validationFor(snapshot: StageSessionSnapshot): StageActionValidation | null {
    const key = this.stateKey(snapshot);
    if (this.validationCache?.key === key) return this.validationCache.value;
    const action = this.pendingAction(snapshot);
    const value = action === null ? null : this.sessionValue.validate(action);
    this.validationCache = { key, value };
    return value;
  }

  private previewFor(snapshot: StageSessionSnapshot): StageTurnPreview | null {
    const key = this.stateKey(snapshot);
    if (this.previewCache?.key === key) return this.previewCache.value;
    const action = this.pendingAction(snapshot);
    if (action === null) {
      this.previewCache = { key, value: null };
      return null;
    }
    const result = this.sessionValue.preview(action);
    const value = 'nextFlow' in result ? result : null;
    this.previewCache = { key, value };
    return value;
  }

  public get validation(): StageActionValidation | null {
    return this.validationFor(this.sessionValue.snapshot);
  }

  public get preview(): StageTurnPreview | null {
    return this.previewFor(this.sessionValue.snapshot);
  }

  private execute(action: StageAction): StageExecution {
    const execution = this.sessionValue.execute(action);
    if (execution.accepted) {
      this.pendingValue = null;
      this.invalidateDerivedView();
    }
    return execution;
  }

  public confirm(): StageExecution | null {
    const action = this.pendingAction(this.sessionValue.snapshot);
    return action === null ? null : this.execute(action);
  }

  private previewNonConstruction(
    type: 'skip' | 'timeout'
  ): StageTurnPreview | null {
    const snapshot = this.sessionValue.snapshot;
    const key = `${type}:${snapshot.revision}:${snapshot.nextActionId}`;
    if (this.nonConstructionPreviewCache?.key === key &&
      this.nonConstructionPreviewCache.type === type) {
      return this.nonConstructionPreviewCache.value;
    }
    const result = this.sessionValue.preview({
      type,
      actionId: snapshot.nextActionId,
      expectedRevision: snapshot.revision
    });
    const value = 'nextFlow' in result ? result : null;
    this.nonConstructionPreviewCache = { key, type, value };
    return value;
  }

  public previewSkip(): StageTurnPreview | null {
    return this.previewNonConstruction('skip');
  }

  public previewTimeout(): StageTurnPreview | null {
    return this.previewNonConstruction('timeout');
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
    const key = this.stateKey(snapshot);
    if (this.viewCache?.key === key) return this.viewCache.value;
    const value = Object.freeze({
      snapshot,
      forecasts: this.sessionValue.rainForecast,
      candidates: Object.freeze([
        candidateCard(this.definition, snapshot, 0, this.selectedSlotValue),
        candidateCard(this.definition, snapshot, 1, this.selectedSlotValue)
      ]),
      legalAnchorIndices: this.legalAnchorIndicesFor(snapshot),
      pending: this.pendingValue,
      validation: this.validationFor(snapshot),
      preview: this.previewFor(snapshot)
    });
    this.viewCache = { key, value };
    return value;
  }
}
