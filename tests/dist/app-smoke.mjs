import { existsSync, readFileSync } from 'node:fs';

const htmlPath = new URL('../../dist-app/index.html', import.meta.url);
if (!existsSync(htmlPath)) throw new Error('app build did not produce index.html');
const html = readFileSync(htmlPath, 'utf8');
const scriptMatch = html.match(/<script[^>]+src="([^"]+)"/u);
if (scriptMatch?.[1] === undefined) throw new Error('app build is missing its module script');
const scriptPath = new URL(`../../dist-app/${scriptMatch[1].replace(/^\//u, '')}`, import.meta.url);
if (!existsSync(scriptPath)) throw new Error(`app script is missing: ${scriptMatch[1]}`);
const script = readFileSync(scriptPath, 'utf8');
for (const marker of ['timer-mode', 'playback-speed', '水流再生速度', '一時停止中', '時間切れのため', 'visibilitychange', 'nagashimasu.progress.v2', 'nagashimasu.stage.v1', '続きから再開', 'localStorage', 'playbackProgress', 'tutorial-toggle', '遊び方を表示', 'prefers-reduced-motion', '施工プレビュー', '次の水流', 'result-hint', '次に改善する1点', '前のステージをクリアすると解放']) {
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
}
console.log('app smoke ok');
