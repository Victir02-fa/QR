// Construye Constancia a partir de src/:
//   dist/constancia.html  → página que se publica como artifact de Claude (sin <html>/<head>, el visor los pone).
//   index.html            → web app instalable para iPhone (manifest, íconos, CSP estricta y service worker).
//   sw.js                 → service worker con versión de caché derivada del contenido.
//
// Uso: node scripts/build.mjs        (o npm run build)
//      node scripts/build.mjs --check  (falla si los archivos generados no están al día; útil en CI)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const check = process.argv.includes('--check');

const css = read('src/styles.css').trim();
const js = ['src/icons.js', 'src/core.js', 'src/app.js'].map((p) => read(p).trim()).join('\n\n');
for (const [name, text] of [['CSS', css], ['JS', js]]) {
  if (/<\/(style|script)/i.test(text)) throw new Error(name + ' contiene una etiqueta de cierre que rompería la página');
}
const shell = read('src/shell.html');
const fragment = shell.replace('/*@CSS*/', () => css).replace('/*@JS*/', () => js);

// ── Web app instalable ──
const cut = fragment.indexOf('<style>');
const head = fragment.slice(0, cut).replace(/<meta name="claude:[^>]*>\s*/g, '').trim();
const body = fragment.slice(cut).trim();
const scripts = [...body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const hashes = scripts.map((s) => "'sha256-" + createHash('sha256').update(s, 'utf8').digest('base64') + "'");
const csp = [
  "default-src 'self'",
  'script-src ' + hashes.join(' '),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');

const index = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
${head}
<meta name="description" content="Marca tus hábitos diarios con anillos de progreso y descubre en qué fallas para mejorar cada día.">
<meta name="theme-color" content="#000000">
<meta name="color-scheme" content="dark">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Constancia">
<meta name="format-detection" content="telephone=no">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<style>
:root { padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
</style>
</head>
<body>
${body}
</body>
</html>
`;

const version = createHash('sha256').update(index).digest('hex').slice(0, 10);
const sw = read('scripts/sw.template.js').replace('__CACHE__', 'constancia-' + version);
const outputs = { 'dist/constancia.html': fragment, 'index.html': index, 'sw.js': sw };

if (check) {
  const stale = Object.entries(outputs).filter(([p, text]) => !existsSync(join(root, p)) || read(p) !== text).map(([p]) => p);
  if (stale.length) { console.error('Archivos generados desactualizados: ' + stale.join(', ') + '. Ejecuta npm run build.'); process.exit(1); }
  console.log('Archivos generados al día.');
} else {
  mkdirSync(join(root, 'dist'), { recursive: true });
  for (const [p, text] of Object.entries(outputs)) writeFileSync(join(root, p), text);
  console.log('Listo: dist/constancia.html (' + (fragment.length / 1024).toFixed(0) + ' KB), index.html, sw.js · caché ' + version);
}
