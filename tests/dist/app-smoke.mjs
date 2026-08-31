import { existsSync, readFileSync } from 'node:fs';

const htmlPath = new URL('../../dist-app/index.html', import.meta.url);
if (!existsSync(htmlPath)) throw new Error('app build did not produce index.html');
const html = readFileSync(htmlPath, 'utf8');
const scriptMatch = html.match(/<script[^>]+src="([^"]+)"/u);
if (scriptMatch?.[1] === undefined) throw new Error('app build is missing its module script');
const scriptPath = new URL(`../../dist-app/${scriptMatch[1].replace(/^\//u, '')}`, import.meta.url);
if (!existsSync(scriptPath)) throw new Error(`app script is missing: ${scriptMatch[1]}`);
const script = readFileSync(scriptPath, 'utf8');
for (const marker of ['timer-mode', 'playback-speed', '水流再生速度', '一時停止中', '時間切れのため', 'visibilitychange', 'nagashimasu.progress.v2', 'nagashimasu.stage.v1', '続きから再開', 'localStorage', 'playbackProgress', 'tutorial-toggle', '遊び方を表示', 'prefers-reduced-motion', '施工プレビュー', '次の水流', 'result-hint', '次に改善する1点', '前のステージをクリアすると解放', 'candidate-shape', 'legalAnchorIndices', 'constructionAnchorCells', 'セル番号は予報と同じ番号', 'cell-picker', 'board-legend', 'キーボードでも選べます', '青い水面：そのセルにたまった水', '水色の粒：再生中に移動する水', 'このゲームでやること', 'ゲームの流れ', 'objective-progress-track', 'phase-timeline', '水が移動しています', '最初の一手', 'turn-outcome', '直前の手番で起きたこと', 'camera-left', 'camera-right', 'camera-reset', 'mobile-controls-toggle', 'mobile-controls-backdrop', 'secondary-info', '盤面を左へ90度回転', '盤面を正面に戻しました', '仮置きは保持しています']) {
  if (!script.includes(marker)) throw new Error(`app bundle is missing timer/pause marker: ${marker}`);
}
const cssMatch = html.match(/<link[^>]+href="([^"]+\.css)"/u);
if (cssMatch?.[1] !== undefined) {
  const cssPath = new URL(`../../dist-app/${cssMatch[1].replace(/^\//u, '')}`, import.meta.url);
  if (!existsSync(cssPath)) throw new Error(`app stylesheet is missing: ${cssMatch[1]}`);
  const css = readFileSync(cssPath, 'utf8');
  if (!css.includes('repeat(3')) throw new Error('app stylesheet is missing narrow action layout');
  if (!/\[hidden\]\{display:none!important\}/u.test(css)) throw new Error('app stylesheet does not keep hidden panels out of layout');
  if (!/overflow:hidden auto/u.test(css)) throw new Error('app stylesheet does not allow vertical page scrolling');
  if (!css.includes('touch-action:pan-y')) throw new Error('app stylesheet does not preserve board vertical pan');
  if (!css.includes('cell-picker-grid')) throw new Error('app stylesheet is missing the cell picker');
  if (!css.includes('min-height:44px')) throw new Error('app stylesheet is missing the cell picker touch target');
  if (!css.includes('mobile-controls')) throw new Error('app stylesheet is missing the mobile operation sheet');
  if (!css.includes('touch-action:none')) throw new Error('app stylesheet does not isolate board gestures');
}
console.log('app smoke ok');
