import { describe, expect, it } from 'vitest';

import { buildAppMarkup } from '../../src/presentation/app-markup';

const markup = buildAppMarkup({
  stageName: 'テストステージ',
  stageGoal: 'テスト目標',
  stageOptionsMarkup: '<button data-stage-id="test-stage">テスト</button>',
  cellPickerMarkup: '<button data-cell-index="7">B1</button>',
  labUrl: 'https://example.test/lab'
});

describe('app markup', () => {
  it('keeps the primary screen anchors available to the controller', () => {
    expect(markup).toContain('id="start-panel"');
    expect(markup).toContain('id="game-shell"');
    expect(markup).toContain('id="board"');
    expect(markup).toContain('id="game-controls"');
    expect(markup).toContain('id="result-panel"');
  });

  it('keeps injected stage and accessibility content in the shell', () => {
    expect(markup).toContain('テストステージ');
    expect(markup).toContain('テスト目標');
    expect(markup).toContain('data-stage-id="test-stage"');
    expect(markup).toContain('data-cell-index="7"');
    expect(markup).toContain('aria-controls="game-controls"');
    expect(markup).toContain('aria-labelledby="controls-sheet-title"');
  });

  it('keeps external links explicit and safe', () => {
    expect(markup).toContain('href="https://example.test/lab"');
    expect(markup).toContain('target="_blank" rel="noopener noreferrer"');
  });

  it('marks non-essential start-screen details for narrow-screen reduction', () => {
    expect(markup).toContain('game-loop-visual start-secondary-info');
    expect(markup).toContain('platform-actions start-secondary-info');
    expect(markup).toContain('id="tutorial-steps"');
    expect(markup).toContain('id="stage-picker-title"');
  });

  it('explains cell drains and the shared terrain-plus-water surface', () => {
    expect(markup).toContain('セル内の排水口');
    expect(markup).toContain('1回の水流で最大8');
    expect(markup).toContain('同じ水面');
    expect(markup).toContain('盤外の安全な出口');
  });
});
