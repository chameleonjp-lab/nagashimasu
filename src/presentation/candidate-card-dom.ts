import type { CandidateCardView } from '../application/stage-controller';
import type { StageRotation } from '../domain/stage-replay';
import { buildCandidateCardPresentation } from './candidate-card';

/** Renders the candidate card while keeping its meaning in Presentation. */
export function renderCandidateCard(
  button: HTMLButtonElement,
  card: CandidateCardView,
  rotation: StageRotation
): void {
  const presentation = buildCandidateCardPresentation({ ...card, rotation });
  const layout = presentation.layout;
  const offsets = layout.offsets;
  const occupied = new Set(offsets.map((offset) => `${offset.row},${offset.column}`));
  const anchorKey = `${layout.anchor.row},${layout.anchor.column}`;
  const shape = document.createElement('span');
  shape.className = 'candidate-shape';
  shape.setAttribute('aria-hidden', 'true');
  shape.style.gridTemplateColumns = `repeat(${layout.columnCount}, 10px)`;
  for (let row = 0; row < layout.rowCount; row += 1) {
    for (let column = 0; column < layout.columnCount; column += 1) {
      const key = `${row},${column}`;
      const cell = document.createElement('span');
      cell.className = [
        'candidate-shape-cell',
        occupied.has(key) ? 'is-filled' : '',
        key === anchorKey ? 'is-anchor' : ''
      ].filter(Boolean).join(' ');
      shape.append(cell);
    }
  }

  const copy = document.createElement('span');
  copy.className = 'candidate-copy';
  const title = document.createElement('strong');
  title.textContent = presentation.titleText;
  const detail = document.createElement('small');
  detail.textContent = presentation.detailText;
  copy.append(title, detail);
  button.replaceChildren(shape, copy);
  button.title = presentation.titleAttribute;
  button.setAttribute('aria-label', presentation.ariaLabel);
}
