import { describe, expect, it } from 'vitest';
import {
  buildCellPickerPresentation,
  type CellPickerSource
} from '../../src/presentation/cell-picker-dom';

function source(
  phase: string,
  legalAnchorIndices: readonly number[],
  anchorIndex: number | null = null
): CellPickerSource {
  return {
    snapshot: { phase },
    legalAnchorIndices,
    pending: anchorIndex === null ? null : { anchorIndex }
  };
}

describe('buildCellPickerPresentation', () => {
  it('marks legal, selected, and unavailable cells for an active turn', () => {
    const presentation = buildCellPickerPresentation(
      source('awaiting-turn', [0, 9], 9),
      false,
      [0, 1, 9]
    );

    expect(presentation.helpText).toContain('2か所');
    expect(presentation.buttons).toEqual([
      {
        legal: true,
        selected: false,
        disabled: false,
        ariaLabel: 'セルA1（施工可能）'
      },
      {
        legal: false,
        selected: false,
        disabled: true,
        ariaLabel: 'セルB1（現在は施工不可）'
      },
      {
        legal: true,
        selected: true,
        disabled: false,
        ariaLabel: 'セルB2（選択中）'
      }
    ]);
  });

  it('explains that legal cells are temporarily unavailable while locked', () => {
    const presentation = buildCellPickerPresentation(
      source('awaiting-turn', [0]),
      true,
      [0]
    );

    expect(presentation.buttons[0]).toEqual({
      legal: true,
      selected: false,
      disabled: true,
      ariaLabel: 'セルA1（現在は操作不可）'
    });
  });

  it('does not expose malformed cell indices as legal controls', () => {
    const presentation = buildCellPickerPresentation(
      source('awaiting-turn', [0]),
      false,
      [-1, 64]
    );

    expect(presentation.buttons).toEqual([
      {
        legal: false,
        selected: false,
        disabled: true,
        ariaLabel: 'セル（不明）（現在は施工不可）'
      },
      {
        legal: false,
        selected: false,
        disabled: true,
        ariaLabel: 'セル（不明）（現在は施工不可）'
      }
    ]);
  });
});
