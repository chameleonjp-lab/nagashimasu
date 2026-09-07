import { CELL_COUNT } from '../domain/constants';
import { cellLabel } from './cell-label';

export interface CellPickerSource {
  readonly snapshot: {
    readonly phase: string;
  };
  readonly legalAnchorIndices: readonly number[];
  readonly pending: {
    readonly anchorIndex: number;
  } | null;
}

export interface CellPickerButtonPresentation {
  readonly legal: boolean;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly ariaLabel: string;
}

export interface CellPickerPresentation {
  readonly helpText: string;
  readonly buttons: readonly CellPickerButtonPresentation[];
}

function validCellIndex(index: number): boolean {
  return Number.isSafeInteger(index) && index >= 0 && index < CELL_COUNT;
}

/** Builds the accessible state for the coordinate picker without changing rules. */
export function buildCellPickerPresentation(
  view: CellPickerSource,
  locked: boolean,
  cellIndices: readonly number[]
): CellPickerPresentation {
  const legalAnchors = new Set(view.legalAnchorIndices);
  const canSelect = !locked && view.snapshot.phase === 'awaiting-turn';

  return {
    helpText: legalAnchors.size > 0
      ? `施工可能な座標は${legalAnchors.size}か所です。有効な座標を押すと仮置きします。`
      : '現在、選んだ候補を置けるセルはありません。見送りで水を進められます。',
    buttons: cellIndices.map((index) => {
      const valid = validCellIndex(index);
      const legal = valid && legalAnchors.has(index);
      const selected = view.pending?.anchorIndex === index;
      const label = valid ? cellLabel(index) : 'セル（不明）';
      const status = !legal
        ? '（現在は施工不可）'
        : !canSelect
          ? '（現在は操作不可）'
          : selected
            ? '（選択中）'
            : '（施工可能）';
      return {
        legal,
        selected,
        disabled: !canSelect || !legal,
        ariaLabel: `${label}${status}`
      };
    })
  };
}

/** Applies the coordinate picker presentation to its existing DOM nodes. */
export function renderCellPicker(
  helpElement: HTMLElement,
  buttons: readonly HTMLButtonElement[],
  view: CellPickerSource,
  locked: boolean
): void {
  const presentation = buildCellPickerPresentation(
    view,
    locked,
    buttons.map((button) => Number(button.dataset['cellIndex']))
  );
  helpElement.textContent = presentation.helpText;
  buttons.forEach((button, index) => {
    const buttonPresentation = presentation.buttons[index];
    if (buttonPresentation === undefined) return;
    button.disabled = buttonPresentation.disabled;
    button.classList.toggle('is-legal', buttonPresentation.legal);
    button.setAttribute('aria-pressed', String(buttonPresentation.selected));
    button.setAttribute('aria-label', buttonPresentation.ariaLabel);
  });
}
