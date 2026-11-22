// Pruebas de punta a punta, accesibilidad (axe-core) y robustez de Constancia.
// Requiere Playwright con Chromium. Ejecutar: npm run test:e2e
// Variables opcionales: SHOTS=<carpeta> guarda capturas para revisión visual.
'use strict';
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const ROOT = path.join(__dirname, '..', '..');
const AXE = fs.readFileSync(path.join(ROOT, 'node_modules/axe-core/axe.min.js'), 'utf8');
const SHOTS = process.env.SHOTS || '';
const LS_KEY = 'constancia.v1';
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const TODAY = keyOf(new Date());
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return keyOf(d); };

/* ── Servidor local: la web app y una simulación del visor de artifacts ── */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const fragment = fs.readFileSync(path.join(ROOT, 'dist/constancia.html'), 'utf8');
const artifactPage = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>' + fragment + '</body></html>';
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/artifact.html') { res.writeHead(200, { 'content-type': TYPES['.html'] }); return res.end(artifactPage); }
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

/* ── Base de datos falsa con la misma interfaz que la del visor (para probar fallas de red) ── */
const FAKE_DB = `
(() => {
  const F = window.__fakeDb = { docs: {}, listeners: [], failQueue: [], calls: [] };
  const copy = (o) => JSON.parse(JSON.stringify(o));
  const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
  const merge = (a, b) => { const o = Object.assign({}, a); for (const k in b) o[k] = isObj(b[k]) && isObj(o[k]) ? merge(o[k], b[k]) : b[k]; return o; };
  const snap = () => ({ docs: Object.keys(F.docs).map((id) => ({ id, exists: true, data: () => copy(F.docs[id]), metadata: { fromCache: false, hasPendingWrites: false } })), metadata: { fromCache: false, hasPendingWrites: false } });
  F.emit = () => F.listeners.forEach((l) => setTimeout(() => l(snap()), 5));
  const fail = () => F.failQueue.length ? Promise.reject({ code: F.failQueue.shift(), message: 'simulado' }) : null;
  const db = { collection: () => ({
    onSnapshot(next) { F.listeners.push(next); setTimeout(() => next(snap()), 40); return () => {}; },
    doc: (id) => ({
      set(d) { F.calls.push('set ' + id); return fail() || (F.docs[id] = copy(d), F.emit(), Promise.resolve()); },
      update(d) { F.calls.push('update ' + id); const f = fail(); if (f) return f; if (!F.docs[id]) return Promise.reject({ code: 'invalid_argument', message: 'no existe' }); F.docs[id] = merge(F.docs[id], copy(d)); F.emit(); return Promise.resolve(); },
      delete() { delete F.docs[id]; F.emit(); return Promise.resolve(); }
    })
  }) };
  window.claude = { use: (n) => Promise.resolve(n === 'db' ? db : null) };
})();`;

/* ── Utilidades de prueba ── */
const results = [];
let browser, base;
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: opts.width || 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'], reducedMotion: 'reduce', bypassCSP: !!opts.bypassCSP });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push('console: ' + m.text()); });
  if (opts.fakeDb) await page.addInitScript(FAKE_DB);
  return { ctx, page };
}
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ ok: true, name, ms: Date.now() - t0 }); }
  catch (e) { results.push({ ok: false, name, ms: Date.now() - t0, err: (e && e.message || String(e)).split('\n').slice(0, 6).join('\n') }); }
}
const tap = (page, sel) => page.locator(sel).first().click();
const tab = (page, v) => tap(page, '#tabbar [data-v="' + v + '"]');
async function open(page, url) { await page.goto(base + (url || '/index.html')); await page.waitForSelector('#view .lt'); await page.waitForTimeout(150); }
async function shot(page, name, full) { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: !!full }); }
async function noOverflow(page, where) {
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth }));
  assert.ok(r.sw <= r.w, where + ': desborde horizontal ' + r.sw + ' > ' + r.w);
}
const axeReport = [];
async function axe(page, where) {
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } })).violations.map((x) => ({ id: x.id, impact: x.impact, help: x.help, nodes: x.nodes.length, target: x.nodes.slice(0, 3).map((n) => n.target.join(' ')) })));
  axeReport.push({ where, violations: v });
  return v;
}
function seed(page, docs) { return page.evaluate(([k, d]) => localStorage.setItem(k, JSON.stringify({ app: 'constancia', version: 2, docs: d })), [LS_KEY, docs]); }
function seededDocs() {
  const start = daysAgo(10), ym = TODAY.slice(0, 7);
  const months = {};
  const put = (k, hid, v) => { const m = months[k.slice(0, 7)] || (months[k.slice(0, 7)] = { days: {}, reasons: {} }); (m.days[k.slice(8)] ||= {})[hid] = v; };
  for (let i = 10; i >= 1; i--) { const k = daysAgo(i); put(k, 'leer', i % 3 ? 20 : 5); put(k, 'saludable', i % 2); }
  const docs = { config: { version: 2, createdAt: start, settings: { morning: '08:00', night: '21:00' }, habits: [
    { id: 'leer', name: 'Leer', icon: 'book-open', color: '#00D8FF', type: 'count', unit: 'págs', step: 5, goals: [{ from: start, goal: 20 }], start },
    { id: 'saludable', name: 'Comer saludable', icon: 'salad', color: '#A6FF00', type: 'check', unit: '', step: 1, goals: [], start }
  ] } };
  Object.keys(months).forEach((m) => { docs['m-' + m] = months[m]; });
  return { docs, ym };
}

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://localhost:' + server.address().port;
  browser = await chromium.launch();

  await test('Carga sin errores ni desbordes en anchos de 320 a 430 px', async () => {
    for (const width of [320, 375, 390, 430]) {
      const { ctx, page } = await newPage({ width });
      await open(page);
      for (const v of ['hoy', 'hist', 'ana', 'aj']) { await tab(page, v); await page.waitForTimeout(60); await noOverflow(page, width + 'px/' + v); }
      await tab(page, 'hist'); await tap(page, '[data-act="hist-mode"][data-v="anio"]'); await noOverflow(page, width + 'px/año');
      assert.deepEqual(page.errors, []);
      await ctx.close();
    }
  });

  await test('Marcar sí/no, sumar, restar y cantidad exacta', async () => {
    const { ctx, page } = await newPage();
    await open(page);
    await shot(page, '01-hoy-nuevo');
    await tap(page, '[data-act="toggle"][data-h="saludable"]');
    assert.equal(await page.getAttribute('[data-act="toggle"][data-h="saludable"]', 'aria-pressed'), 'true');
    await tap(page, '[data-act="toggle"][data-h="saludable"]');
    assert.equal(await page.getAttribute('[data-act="toggle"][data-h="saludable"]', 'aria-pressed'), 'false');
    for (let i = 0; i < 3; i++) await tap(page, '[data-act="inc"][data-h="ejercicio"]');
    await tap(page, '[data-act="dec"][data-h="ejercicio"]');
    assert.match(await page.textContent('[data-act="detail"][data-h="ejercicio"] .hsub'), /20 de 30/);
    await tap(page, '[data-act="detail"][data-h="leer"]');
    await page.fill('#num-input', '45');
    await tap(page, '#num-form button[type="submit"]');
    await page.waitForTimeout(100);
    assert.match(await page.textContent('#sheet .bn-v'), /45/);
    await shot(page, '02-detalle');
    await page.keyboard.press('Escape');
    assert.match(await page.textContent('[data-act="detail"][data-h="leer"] .hsub'), /45 de 20/);
    await page.reload(); await page.waitForSelector('#view .lt');
    assert.match(await page.textContent('[data-act="detail"][data-h="leer"] .hsub'), /45 de 20/, 'persiste tras recargar');
    assert.match(await page.textContent('[data-act="detail"][data-h="ejercicio"] .hsub'), /20 de 30/);
    await shot(page, '03-hoy-marcado');
    assert.deepEqual(page.errors, []);
    await ctx.close();
  });

  await test('Validación de la cantidad exacta (negativos, texto, enormes)', async () => {
    const { ctx, page } = await newPage();
    await open(page);
    await tap(page, '[data-act="detail"][data-h="leer"]');
    for (const bad of ['-5', '1e9']) {
      await page.fill('#num-input', bad);
      await tap(page, '#num-form button[type="submit"]');
      assert.match(await page.textContent('#hud'), /Escribe un número/);
    }
    assert.match(await page.textContent('#sheet .bn-v'), /^0$/);
    assert.deepEqual(page.errors, []);
    await ctx.close();
  });

  await test('Motivos de falla en días pasados y análisis con datos', async () => {
    const { ctx, page } = await newPage();
    await open(page);
    await seed(page, seededDocs().docs);
    await page.reload(); await page.waitForSelector('#view .lt');
    await tap(page, '[data-act="day"][data-k="' + daysAgo(2) + '"]');
    const chip = page.locator('[data-act="why"]').first();
    await chip.click();
    await tap(page, '#sheet [data-act="reason"][data-r="cansancio"]');
    assert.equal(await page.getAttribute('#sheet [data-act="reason"][data-r="cansancio"]', 'aria-pressed'), 'true');
    await tap(page, '#sheet .btn.primary');
    await page.waitForTimeout(400);
    assert.match(await page.locator('.reason-chip.set').first().textContent(), /Cansancio/);
    await tab(page, 'ana');
    assert.match(await page.textContent('#view'), /Motivos de falla/);
    assert.match(await page.textContent('#view'), /Cansancio/);
    assert.deepEqual(page.errors, []);
    await ctx.close();
  });

  await test('Crear, validar, editar, reordenar, archivar y borrar hábitos', async () => {
    const { ctx, page } = await newPage();
    await open(page);
    await tab(page, 'aj');
    await tap(page, '[data-act="new-habit"]');
    await tap(page, '#edit-form button[type="submit"]');
    assert.match(await page.textContent('#sheet .err'), /Ponle un nombre/);
    await page.fill('#f-name', 'leer');
    await tap(page, '#edit-form button[type="submit"]');
    assert.match(await page.textContent('#sheet .err'), /Ya tienes un hábito/);
    await page.fill('#f-name', 'Meditar');
    await tap(page, '[data-act="draft-icon"][data-v="flower-2"]');
    await tap(page, '[data-act="draft-color"][data-v="#FF9F0A"]');
    await tap(page, '[data-act="draft-type"][data-v="count"]');
    assert.equal(await page.inputValue('#f-name'), 'Meditar', 'el nombre sobrevive al cambiar de tipo');
    await page.fill('#f-goal', '0');
    await tap(page, '#edit-form button[type="submit"]');
    assert.match(await page.textContent('#sheet .err'), /meta diaria/);
    await page.fill('#f-goal', '10'); await page.fill('#f-unit', 'min'); await page.fill('#f-step', '5');
    await shot(page, '04-editar');
    await tap(page, '#sheet .sh-head .btn-circle.primary');
    await page.waitForTimeout(200);
    assert.match(await page.textContent('#view'), /Meditar/);
    const names = async () => page.$$eval('#view .group .gi-title', (els) => els.map((e) => e.textContent));
    const before = await names();
    await tap(page, '[data-act="move"][data-h="meditar"][data-d="-1"]');
    const after = await names();
    assert.equal(after.indexOf('Meditar'), before.indexOf('Meditar') - 1, 'subió un lugar');
    await tap(page, '[data-act="edit-habit"][data-h="meditar"]');
    await tap(page, '[data-act="archive"]');
    assert.match(await page.textContent('#view'), /Archivados/);
    await tap(page, '[data-act="restore"][data-h="meditar"]');
    await tap(page, '[data-act="edit-habit"][data-h="meditar"]');
    await tap(page, '[data-act="del-ask"]');
    await tap(page, '[data-act="del-confirm"]');
    await page.waitForTimeout(200);
    assert.doesNotMatch(await page.textContent('#view'), /Meditar/);
    await tab(page, 'hoy');
    assert.equal(await page.locator('#view .hrow').count(), 4);
    assert.deepEqual(page.errors, []);
    await ctx.close();
  });

  await test('Respaldo: copiar, rechazar inválidos e importar', async () => {
    const { ctx, page } = await newPage();
    await open(page);
    await tap(page, '[data-act="toggle"][data-h="saludable"]');
    await tab(page, 'aj');
    await tap(page, '[data-act="export-copy"]');
    await page.waitForTimeout(200);
    const text = await page.evaluate(() => navigator.clipboard.readText());
    const j = JSON.parse(text);
    assert.equal(j.app, 'constancia');
    assert.equal(j.docs.config.habits.length, 4);
    await tap(page, '[data-act="import-open"]');
    await page.fill('#imp-text', '{"esto": "no es un respaldo"}');
    await tap(page, '[data-act="imp-check"]');
    assert.match(await page.textContent('#sheet .err'), /No encontré hábitos/);
    j.docs.config.habits = j.docs.config.habits.slice(0, 2);
    await page.fill('#imp-text', JSON.stringify(j));
    await tap(page, '[data-act="imp-check"]');
    assert.match(await page.textContent('#sheet .confirm'), /2 hábitos/);
    await tap(page, '[data-act="imp-apply"]');
    await tab(page, 'hoy');
    assert.equal(await page.locator('#view .hrow').count(), 2);
    assert.deepEqual(page.errors, []);
    await ctx.close();
  });

  await test('Seguridad: un respaldo malicioso no ejecuta código', async () => {
    const { ctx, page } = await newPage();
    await open(page);
    const evil = { app: 'constancia', docs: { config: { habits: [{ id: '"><img src=x onerror="window.__xss=1">', name: '<img src=x onerror="window.__xss=2">', icon: '"><script>window.__xss=3</script>', color: 'red;background:url(javascript:alert(1))', type: 'count', unit: '<b>u</b>', goals: [{ from: TODAY, goal: 5 }] }] } } };
    await tab(page, 'aj');
    await tap(page, '[data-act="import-open"]');
    await page.fill('#imp-text', JSON.stringify(evil));
    await tap(page, '[data-act="imp-check"]');
    await tap(page, '[data-act="imp-apply"]');
    await tab(page, 'hoy');
    await tap(page, '#view .hmain');
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.__xss), undefined, 'no se ejecutó código');
    assert.equal(await page.locator('img').count(), 0, 'no se inyectó HTML');
    assert.match(await page.textContent('#view .hname'), /<img/, 'el nombre se muestra como texto');
    assert.deepEqual(page.errors, []);
    await ctx.close();
  });

  await test('Datos locales dañados: se rescatan y la app sigue funcionando', async () => {
    const { ctx, page } = await newPage();
    await open(page);
    await page.evaluate((k) => localStorage.setItem(k, '{"docs": {"config": [roto'), LS_KEY);
    await page.reload(); await page.waitForSelector('#view .lt');
    assert.match(await page.textContent('#banners'), /No pudimos leer tus datos/);
    assert.equal(await page.evaluate((k) => localStorage.getItem(k + '.danado'), LS_KEY), '{"docs": {"config": [roto');
    await tap(page, '[data-act="toggle"][data-h="saludable"]');
    await page.waitForTimeout(300);
    const saved = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), LS_KEY));
    assert.ok(saved.docs.config, 'se volvió a guardar correctamente');
    await tap(page, '[data-act="dismiss"]');
    assert.equal((await page.textContent('#banners')).trim(), '');
    assert.deepEqual(page.errors.filter((e) => !/Constancia/.test(e)), []);
    await ctx.close();
  });

  await test('Error inesperado: se contiene, se informa y se puede reintentar', async () => {
    const { ctx, page } = await newPage();
    await open(page);
    await page.evaluate(() => setTimeout(() => { throw new Error('falla simulada'); }, 0));
    await page.waitForTimeout(150);
    assert.match(await page.textContent('#banners'), /Algo no salió como esperaba/);
    await tap(page, '[data-act="fault-retry"]');
    assert.equal((await page.textContent('#banners')).trim(), '');
    await tab(page, 'aj'); await tap(page, '[data-act="diag"]');
    assert.match(await page.textContent('#sheet'), /falla simulada/);
    await ctx.close();
  });

  await test('Cuenta de Claude: guarda, reintenta sin conexión y sincroniza otro dispositivo', async () => {
    const { ctx, page } = await newPage({ fakeDb: true });
    await page.goto(base + '/artifact.html');
    await page.waitForSelector('#view .lt');
    await page.waitForTimeout(200);
    await page.evaluate(() => { window.__fakeDb.failQueue.push('unavailable', 'unavailable'); });
    await tap(page, '[data-act="toggle"][data-h="saludable"]');
    await page.waitForTimeout(150);
    assert.match(await page.textContent('#banners'), /Sin conexión/);
    await page.waitForTimeout(4000);
    const docs = await page.evaluate(() => window.__fakeDb.docs);
    const m = docs['m-' + TODAY.slice(0, 7)];
    assert.ok(m && m.days[TODAY.slice(8)].saludable === 1, 'el cambio llegó tras los reintentos');
    assert.ok(docs.config && docs.config.habits.length === 4, 'se guardó la configuración');
    assert.equal((await page.textContent('#banners')).trim(), '', 'el aviso desaparece al guardar');
    // Otro dispositivo marca "Leer"
    await page.evaluate(([ym, dd]) => { const F = window.__fakeDb; F.docs['m-' + ym].days[dd].leer = 20; F.emit(); }, [TODAY.slice(0, 7), TODAY.slice(8)]);
    await page.waitForTimeout(200);
    assert.match(await page.textContent('[data-act="detail"][data-h="leer"] .hsub'), /20 de 20/);
    await tab(page, 'aj');
    assert.match(await page.textContent('#sync-line'), /Guardado en tu cuenta de Claude/);
    // Acceso revocado → solo lectura, sin perder lo que se ve
    await page.evaluate(() => { window.__fakeDb.failQueue.push('revoked'); });
    await tab(page, 'hoy');
    await tap(page, '[data-act="inc"][data-h="ejercicio"]');
    await page.waitForTimeout(200);
    assert.match(await page.textContent('#banners'), /solo lectura/);
    await tap(page, '[data-act="inc"][data-h="ejercicio"]');
    assert.match(await page.textContent('#hud'), /solo lectura/);
    assert.deepEqual(page.errors, []);
    await ctx.close();
  });

  await test('Funciona sin conexión una vez instalada (service worker)', async () => {
    const { ctx, page } = await newPage();
    await open(page);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload(); await page.waitForSelector('#view .lt');
    await ctx.setOffline(true);
    await page.reload(); await page.waitForSelector('#view .lt');
    assert.equal(await page.locator('#view .hrow').count(), 4);
    await ctx.setOffline(false);
    assert.deepEqual(page.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED/.test(e)), []);
    await ctx.close();
  });

  await test('Teclado: abrir con Enter, cerrar con Escape y devolver el foco', async () => {
    const { ctx, page } = await newPage();
    await open(page);
    await page.focus('[data-act="detail"][data-h="leer"]');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('sh-close')), true, 'el foco entra a la hoja');
    assert.equal(await page.evaluate(() => document.getElementById('app').hasAttribute('inert')), true, 'el fondo queda inerte');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-h')), 'leer', 'el foco regresa');
    await ctx.close();
  });

  await test('Modo ejemplo: análisis completo sin tocar los datos reales', async () => {
    const { ctx, page } = await newPage();
    await open(page);
    await tap(page, '[data-act="toggle"][data-h="saludable"]');
    await tab(page, 'ana');
    await tap(page, '[data-act="demo-on"]');
    await tab(page, 'ana');
    const t0 = Date.now();
    await tab(page, 'hoy'); await tab(page, 'ana');
    const ms = Date.now() - t0;
    assert.ok(ms < 1500, 'cambiar de pestaña tarda ' + ms + ' ms');
    assert.ok(await page.locator('#view .ins').count() >= 3, 'al menos tres hallazgos');
    await shot(page, '05-analisis', true);
    await tab(page, 'hoy'); await page.waitForTimeout(300); await shot(page, '06-hoy-ejemplo', true);
    await tab(page, 'hist'); await shot(page, '07-historial-mes', true);
    await tap(page, '[data-act="hist-mode"][data-v="anio"]'); await shot(page, '08-historial-anio');
    await tab(page, 'aj'); await shot(page, '09-ajustes', true);
    await tap(page, '[data-act="demo-off"]');
    await tab(page, 'hoy');
    assert.equal(await page.getAttribute('[data-act="toggle"][data-h="saludable"]', 'aria-pressed'), 'true', 'los datos reales siguen ahí');
    assert.deepEqual(page.errors, []);
    await ctx.close();
  });

  await test('La política de seguridad (CSP) bloquea scripts inyectados', async () => {
    const { ctx, page } = await newPage();
    await open(page);
    const blocked = await page.addScriptTag({ content: 'window.__inyectado = 1' }).then(() => false, () => true);
    assert.ok(blocked && await page.evaluate(() => window.__inyectado) === undefined);
    await ctx.close();
  });

  await test('Accesibilidad WCAG 2.2 AA (axe-core) en todas las pantallas', async () => {
    const { ctx, page } = await newPage({ bypassCSP: true });
    await open(page);
    await tab(page, 'aj'); await tap(page, '[data-act="demo-on"]');
    const where = [];
    for (const v of ['hoy', 'hist', 'ana', 'aj']) { await tab(page, v); await page.waitForTimeout(80); where.push(...(await axe(page, v))); }
    await tab(page, 'hist'); await tap(page, '[data-act="hist-mode"][data-v="anio"]'); where.push(...(await axe(page, 'historial-año')));
    await tab(page, 'hoy'); await tap(page, '[data-act="detail"][data-h="leer"]'); await page.waitForTimeout(300); where.push(...(await axe(page, 'hoja-detalle')));
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await tab(page, 'aj'); await tap(page, '[data-act="edit-habit"][data-h="leer"]'); await page.waitForTimeout(300); where.push(...(await axe(page, 'hoja-editar')));
    const serious = where.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    assert.deepEqual(serious.map((v) => v.id + ' (' + v.nodes + ')'), [], 'sin violaciones graves');
    await ctx.close();
  });

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log((r.ok ? '✔ ' : '✖ ') + r.name + ' (' + r.ms + ' ms)' + (r.ok ? '' : '\n    ' + r.err.replace(/\n/g, '\n    ')));
  const all = axeReport.flatMap((a) => a.violations.map((v) => a.where + ': ' + v.id + ' [' + v.impact + '] ×' + v.nodes + ' — ' + v.help + ' — ' + v.target.join(' | ')));
  console.log('\naxe-core: ' + (all.length ? all.length + ' hallazgos\n  ' + all.join('\n  ') : 'sin hallazgos'));
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' pruebas correctas');
  if (process.env.REPORT) fs.writeFileSync(process.env.REPORT, JSON.stringify({ results, axe: axeReport }, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
