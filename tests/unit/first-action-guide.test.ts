import { describe, expect, it } from 'vitest';

import { firstActionGuideText } from '../../src/presentation/first-action-guide';

describe('first action guide', () => {
  it('explains that the first turn prepares for later rain', () => {
    expect(firstActionGuideText(2, '候補A')).toBe(
      'この手は雨の前の準備です。雨は2手目からなので、今の施工で流れを整えます。候補Aが選択中です。緑の丸を1つ押して、まず仮置きしてみてください。'
    );
  });

  it('keeps the selected candidate in the instruction', () => {
    expect(firstActionGuideText(2, '候補B')).toContain('候補Bが選択中です');
  });

  it('uses a safe generic message when rain starts immediately or is absent', () => {
    expect(firstActionGuideText(1, '候補A')).toContain('最初の雨に備えて施工します。');
    expect(firstActionGuideText(null, '候補A')).toContain('最初の雨に備えて施工します。');
  });
});
