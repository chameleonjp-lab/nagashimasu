import type { PieceOffset } from '../domain/pieces';
import type { CandidateSlot, StageRotation } from '../domain/stage-replay';
import { buildCandidateShapeLayout, candidateShapeLabel } from './candidate-shape';

export interface CandidateCardPresentationInput {
  readonly slot: CandidateSlot;
  readonly pieceId: string;
  readonly tokenId: number;
  readonly delta: number;
  readonly offsets: readonly PieceOffset[];
  readonly rotation: StageRotation;
}

export interface CandidateCardPresentation {
  readonly layout: ReturnType<typeof buildCandidateShapeLayout>;
  readonly titleText: string;
  readonly detailText: string;
  readonly titleAttribute: string;
  readonly ariaLabel: string;
}

/**
 * Builds the candidate card's visible and accessible text without touching
 * the DOM. The board's green marker remains the logical anchor of the shape.
 */
export function buildCandidateCardPresentation(
  input: CandidateCardPresentationInput
): CandidateCardPresentation {
  const layout = buildCandidateShapeLayout(input.offsets, input.rotation);
  const shapeText = candidateShapeLabel(layout.offsets);
  const titleText = `候補${input.slot === 0 ? 'A' : 'B'}: ${input.delta > 0 ? '上げる' : '下げる'}`;
  const detailText = `${shapeText}／◎基準セル／パーツの向き${input.rotation + 1}`;
  const ariaLabel = `${titleText}、${shapeText}、◎が盤面の緑の丸に対応、パーツの向き${input.rotation + 1}`;

  return Object.freeze({
    layout,
    titleText,
    detailText,
    titleAttribute: `${input.pieceId} / token ${input.tokenId}`,
    ariaLabel
  });
}
