export function firstActionGuideText(
  firstRainTurn: number | null,
  selectedCandidateLabel: string
): string {
  const preparationText = firstRainTurn !== null && firstRainTurn > 1
    ? `この手は雨の前の準備です。雨は${firstRainTurn}手目からなので、今の施工で流れを整えます。`
    : '最初の雨に備えて施工します。';
  return `${preparationText}${selectedCandidateLabel}が選択中です。緑の丸を1つ押して、まず仮置きしてみてください。`;
}
