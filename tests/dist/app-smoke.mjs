import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const appDirectory = new URL('../../dist-app/', import.meta.url);
const htmlPath = new URL('../../dist-app/index.html', import.meta.url);
if (!existsSync(htmlPath)) throw new Error('app build did not produce index.html');
const html = readFileSync(htmlPath, 'utf8');

if (/<script[^>]+type=["']importmap["']/iu.test(html)) {
  throw new Error('app build must not use an importmap');
}
if (/https?:\/\/(?:cdn|unpkg|jsdelivr|esm\.sh)/iu.test(html)) {
  throw new Error('app HTML must not load external scripts');
}

const scriptMatch = html.match(/<script[^>]+src="([^"]+)"/u);
if (scriptMatch?.[1] === undefined) throw new Error('app build is missing its module script');
const entryName = scriptMatch[1].replace(/^\.\//u, '');
if (entryName.length === 0) throw new Error('app entry script name is missing');

function listJavaScriptFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativeName = prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name;
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return listJavaScriptFiles(entryPath, relativeName);
    return entry.name.endsWith('.js') ? [relativeName] : [];
  });
}

const javascriptFiles = listJavaScriptFiles(appDirectory.pathname);
if (javascriptFiles.length < 2) {
  throw new Error('app build must contain an entry chunk and a lazy board chunk');
}

const scripts = javascriptFiles.map((name) => ({
  name,
  source: readFileSync(join(appDirectory.pathname, name), 'utf8')
}));
const allScript = scripts.map((script) => script.source).join('\n');
const entryScript = scripts.find((script) => script.name === entryName);
if (entryScript === undefined) throw new Error(`app entry script is missing: ${entryName}`);

const threeChunks = scripts.filter((script) =>
  /WebGLRenderer|OrthographicCamera|Raycaster/u.test(script.source)
);
if (threeChunks.length === 0) throw new Error('Three.js WebGL classes are not bundled');
if (threeChunks.every((script) => script.name === entryName)) {
  throw new Error('Three.js board code was not separated into a lazy chunk');
}
if (!entryScript.source.includes('presentation/three-board-view') &&
    !entryScript.source.includes('three-board-view')) {
  throw new Error('entry chunk is missing the dynamic Three.js board import');
}

for (const externalMarker of ['https://cdn.', 'https://unpkg.com/', 'https://cdn.jsdelivr.net/', 'https://esm.sh/', '<script type="importmap"']) {
  if (allScript.includes(externalMarker)) throw new Error(`external loading marker found: ${externalMarker}`);
}

for (const marker of [
  '3D盤面を準備中…',
  '3D表示を開始できませんでした',
  '盤面が見えないとき',
  '盤面の読み方（例）',
  '水流が4回進みます',
  '盤外の出口は地形を上げても閉じません',
  '安全な出口',
  '3D表示を再生成',
  '3D表示が中断されました',
  'camera-left',
  'camera-right',
  'camera-reset',
  'mobile-controls-toggle',
  'cell-picker',
  'board-legend',
  'pointerup',
  '施工確定',
  'webglcontextlost',
  'webglcontextrestored',
  'Raycaster',
  'OrthographicCamera',
  'WebGLRenderer',
  'prefers-reduced-motion',
  'nagashimasu.progress.v2',
  'nagashimasu.stage.v1',
  '続きから再開',
  'localStorage',
  'playbackProgress',
  'tutorial-toggle',
  '遊び方を表示',
  '施工プレビュー',
  '4回の水流後',
  'preview-result',
  '失敗見込み',
  'result-hint',
  '次に改善する1点',
  '前のステージをクリアすると解放',
  'candidate-shape',
  '◎基準セル',
  'is-anchor',
  'legalAnchorIndices',
  'constructionAnchorCells',
  '座標は予報と同じ表記',
  'キーボードでも選べます',
  '青い水面：そのセルにたまった水',
  '水色の粒：再生中に移動する水',
  '同じ高さのセル同士では水は動きません',
  '盤外の出口は、地形を上げても閉じません',
  'このゲームでやること',
  'ゲームの流れ',
  'objective-progress-track',
  'phase-timeline',
  '水が移動しています',
  '最初の一手',
  'turn-outcome',
  'mobile-controls-backdrop',
  '盤面を見る向きを左へ90度変える',
  '盤面を正面に戻しました',
  '仮置きは保持しています',
  '名前を入力するとゲームを開始できます',
  'シェア文をコピー',
  '上位10名',
  'ランキングを見る'
]) {
  if (!allScript.includes(marker)) throw new Error(`app bundle is missing marker: ${marker}`);
}

for (const obsoleteMarker of ['renderIsometricBoard', 'createIsometricLayout', 'hitTestCell', 'isometric.ts', 'board-renderer.ts']) {
  if (allScript.includes(obsoleteMarker)) throw new Error(`old Canvas board marker remains: ${obsoleteMarker}`);
}

const mainSource = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8');
if (/getContext\(['"]2d['"]\)/u.test(mainSource)) {
  throw new Error('main.ts must not create a 2D board context');
}
if (/renderIsometricBoard|createIsometricLayout|hitTestCell/u.test(mainSource)) {
  throw new Error('main.ts still references the old Canvas board renderer');
}
const labelSource = readFileSync(new URL('../../src/presentation/three-board-labels.ts', import.meta.url), 'utf8');
if (!/getContext\(['"]2d['"]\)/u.test(labelSource)) {
  throw new Error('label module must contain the explicitly allowed offscreen Canvas text path');
}
const boardViewSource = readFileSync(new URL('../../src/presentation/three-board-view.ts', import.meta.url), 'utf8');
if (/Math\.random/u.test(boardViewSource)) {
  throw new Error('Three.js board rendering must be deterministic and must not use Math.random');
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
console.log(`app smoke ok (${javascriptFiles.length} JavaScript chunks; Three.js in ${threeChunks.map((script) => script.name).join(', ')})`);
