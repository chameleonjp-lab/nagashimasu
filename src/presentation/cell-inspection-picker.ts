import { CELL_COUNT } from '../domain/constants';
import { cellLabel } from './cell-label';

export interface CellInspectionPickerSource {
  readonly snapshot: {
    readonly phase: string;
  };
  readonly inspectedCellIndex: number | null;
}

export interface CellInspectionPickerButtonPresentation {
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly ariaLabel: string;
}

export interface CellInspectionPickerPresentation {
  readonly helpText: string;
  readonly buttons: readonly CellInspectionPickerButtonPresentation[];
}

function validCellIndex(index: number): boolean {
  return Number.isSafeInteger(index) && index >= 0 && index < CELL_COUNT;
}

/** Builds the display-only cell inspection controls for keyboard and VoiceOver users. */
export function buildCellInspectionPickerPresentation(
  view: CellInspectionPickerSource,
  locked: boolean,
  cellIndices: readonly number[]
): CellInspectionPickerPresentation {
  const canInspect = !locked && view.snapshot.phase === 'awaiting-turn';

  return {
    helpText: canInspect
      ? '64セルから確認したい場所を選べます。選んでも施工位置・手数・操作ログは変わりません。'
      : 'セル確認は、手番を考えている間だけ使えます。',
    buttons: cellIndices.map((index) => {
      const valid = validCellIndex(index);
      const selected = valid && view.inspectedCellIndex === index;
      const label = valid ? cellLabel(index) : 'セル（不明）';
      const status = !valid
        ? '（確認できません）'
        : !canInspect
          ? '（現在は操作不可）'
          : selected
            ? '（確認中）'
            : '（確認）';
      return {
        selected,
        disabled: !valid || !canInspect,
        ariaLabel: `${label}${status}`
      };
    })
  };
}

/** Applies the display-only cell inspection presentation to existing DOM nodes. */
export function renderCellInspectionPicker(
  helpElement: HTMLElement,
  buttons: readonly HTMLButtonElement[],
  view: CellInspectionPickerSource,
  locked: boolean
): void {
  const presentation = buildCellInspectionPickerPresentation(
    view,
    locked,
    buttons.map((button) => Number(button.dataset['cellIndex']))
  );
  helpElement.textContent = presentation.helpText;
  buttons.forEach((button, index) => {
    const buttonPresentation = presentation.buttons[index];
    if (buttonPresentation === undefined) return;
    button.disabled = buttonPresentation.disabled;
    button.setAttribute('aria-pressed', String(buttonPresentation.selected));
    button.setAttribute('aria-label', buttonPresentation.ariaLabel);
  });
}
