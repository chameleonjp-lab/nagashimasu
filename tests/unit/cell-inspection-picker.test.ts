import { describe, expect, it } from 'vitest';

import {
  buildCellInspectionPickerPresentation,
  type CellInspectionPickerSource
} from '../../src/presentation/cell-inspection-picker';

function source(phase: string, inspectedCellIndex: number | null): CellInspectionPickerSource {
  return {
    snapshot: { phase },
    inspectedCellIndex
  };
}

describe('buildCellInspectionPickerPresentation', () => {
  it('keeps inspection display-only and marks the inspected cell', () => {
    const presentation = buildCellInspectionPickerPresentation(
      source('awaiting-turn', 9),
      false,
      [0, 9, 10]
    );

    expect(presentation.helpText).toContain('施工位置・手数・操作ログは変わりません');
    expect(presentation.buttons).toEqual([
      { selected: false, disabled: false, ariaLabel: 'セルA1（確認）' },
      { selected: true, disabled: false, ariaLabel: 'セルB2（確認中）' },
      { selected: false, disabled: false, ariaLabel: 'セルC2（確認）' }
    ]);
  });

  it('locks all inspection controls outside an active turn', () => {
    const presentation = buildCellInspectionPickerPresentation(
      source('failed', 0),
      false,
      [0]
    );

    expect(presentation.helpText).toContain('手番を考えている間だけ');
    expect(presentation.buttons[0]).toEqual({
      selected: true,
      disabled: true,
      ariaLabel: 'セルA1（現在は操作不可）'
    });
  });

  it('rejects malformed indices without exposing a control', () => {
    const presentation = buildCellInspectionPickerPresentation(
      source('awaiting-turn', null),
      false,
      [-1, 64]
    );

    expect(presentation.buttons).toEqual([
      { selected: false, disabled: true, ariaLabel: 'セル（不明）（確認できません）' },
      { selected: false, disabled: true, ariaLabel: 'セル（不明）（確認できません）' }
    ]);
  });
});
