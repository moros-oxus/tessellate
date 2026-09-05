import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

// Two bundles: the main thread (figma API, no DOM) and the UI script inlined into ui.html —
// Figma plugins load exactly one code file and one self-contained html file.
mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'dist/code.js',
  format: 'iife',
  target: 'es2019',
  logLevel: 'silent',
});

const ui = await build({
  entryPoints: ['src/ui.ts'],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2019',
  logLevel: 'silent',
});
const script = ui.outputFiles[0].text;
const html = readFileSync('src/ui.html', 'utf8').replace(
  '/*UI_SCRIPT*/',
  () => script,
);
writeFileSync('dist/ui.html', html);
console.log('built dist/code.js + dist/ui.html');
