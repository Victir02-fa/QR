// Genera index.html (la web app instalable) a partir de src/app.html.
// src/app.html es la única fuente: se publica tal cual como artifact de Claude
// y aquí se envuelve con lo que necesita una PWA de iPhone (manifest, íconos, service worker).
//
// Uso: node scripts/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src/app.html'), 'utf8');

// Todo lo que va antes del primer <style> (title, meta, link) pasa al <head>.
const cut = src.indexOf('<style>');
if (cut < 0) throw new Error('src/app.html debe tener un bloque <style>');
const headExtra = src.slice(0, cut).trim();
const body = src.slice(cut);

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${headExtra}
<meta name="description" content="Marca tus hábitos diarios con anillos de progreso y descubre en qué fallas para mejorar cada día.">
<meta name="theme-color" content="#000000">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Constancia">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<style>
/* Mismo reinicio que aplica el visor de artifacts de Claude, para que ambas versiones se vean igual. */
:root { padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
body { margin: 0; }
img { max-width: 100%; }
[hidden] { display: none !important; }
</style>
<script>
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
}
</script>
</head>
<body>
${body.trim()}
</body>
</html>
`;

writeFileSync(join(root, 'index.html'), html);
console.log('index.html generado (' + html.length.toLocaleString('es-MX') + ' caracteres)');
