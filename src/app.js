/* Constancia · interfaz.
   Depende de ConstanciaCore (src/core.js) y ConstanciaIcons (src/icons.js). */
(function () {
  'use strict';

  const C = window.ConstanciaCore;
  const ICONS = window.ConstanciaIcons;
  const HABIT_ICONS = window.ConstanciaHabitIcons;
  if (!C || !ICONS || !HABIT_ICONS) {
    document.body.textContent = 'No se pudo cargar Constancia. Recarga la página.';
    return;
  }
  document.documentElement.lang = 'es';

  /* ═════════════ Utilidades ═════════════ */
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => C.keyOf(new Date());
  const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function icon(name, cls) {
    const body = ICONS[name] || ICONS['circle-help'];
    return '<svg class="i' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + body + '</svg>';
  }
  const tintCache = {};
  const tint = (hex, bg) => { const k = hex + (bg || ''); return tintCache[k] || (tintCache[k] = C.readableOn(hex, bg || '#1C1C1E')); };
  function deepMerge(a, b) {
    const out = C.isObj(a) ? Object.assign({}, a) : {};
    Object.keys(b || {}).forEach((k) => { out[k] = C.isObj(b[k]) ? deepMerge(C.isObj(out[k]) ? out[k] : {}, b[k]) : b[k]; });
    return out;
  }

  /* ═════════════ Diagnóstico y errores ═════════════
     Todo error se registra (sin datos personales) y se muestra de forma no intrusiva.
     Los datos nunca se descartan por un error de pantalla. */
  const Diag = {
    errors: [],
    report(err, ctx, quiet) {
      const msg = err && (err.message || err.code) ? (err.message || err.code) : String(err);
      this.errors.push({ at: new Date().toISOString(), ctx: ctx || 'app', msg: String(msg).slice(0, 240) });
      if (this.errors.length > 25) this.errors.shift();
      if (!quiet) { try { console.warn('[Constancia]', ctx || '', err); } catch (e) { /* sin consola */ } }
    }
  };
  function onFault(err, ctx) {
    Diag.report(err, ctx);
    try { S.fault = true; renderBanners(); } catch (e) { /* la app aún no termina de iniciar */ }
  }
  window.addEventListener('error', (e) => {
    if (e && e.target && e.target !== window) return; // recursos externos: no son fallas de la app
    onFault(e.error || e.message, 'global');
  });
  window.addEventListener('unhandledrejection', (e) => onFault(e.reason, 'promesa'));

  /* ═════════════ Estado ═════════════ */
  const S = {
    view: 'hoy', selected: today(), histMode: 'mes', histMonth: C.ymOf(today()), histHabit: 'all',
    real: { config: null, months: {} }, demo: null,
    loaded: false, sync: 'idle', syncMsg: '', sheet: null, firstPaint: true, celebrate: false,
    fault: false, notices: {}, swUpdate: null
  };
  let pendingDefault = null;
  const D = () => S.demo || S.real;
  function data() {
    const d = D();
    if (d.config) return d;
    if (!pendingDefault) pendingDefault = C.defaultConfig(today());
    return { config: pendingDefault, months: d.months };
  }
  const cfg = () => data().config;
  const M = C.createModel({ docs: data, today: today });

  /* ═════════════ Almacenamiento ═════════════
     · Visor de Claude: base de datos privada del artifact (solo el dueño lee y escribe).
     · Web app instalada: localStorage del dispositivo.
     Documentos: "config" (hábitos y ajustes) y "m-AAAA-MM" (registros del mes). */
  const LS_KEY = 'constancia.v1';
  function applyDocs(docs, skip) {
    Object.keys(docs).forEach((id) => {
      if (skip && skip(id)) return;
      const b = docs[id];
      if (id === 'config') { if (C.isObj(b)) { S.real.config = C.normalizeConfig(b, today(), HABIT_ICONS); pendingDefault = null; } }
      else if (/^m-\d{4}-(0[1-9]|1[0-2])$/.test(id)) S.real.months[id.slice(2)] = C.normalizeMonth(b);
    });
  }
  function realData() {
    return { config: S.real.config || pendingDefault || C.defaultConfig(today()), months: S.real.months };
  }

  const Store = {
    mode: 'memory', db: null, col: null, q: {}, exists: {}, definitive: false, downloads: null,
    readOnly: false, lsTimer: null, loadTimer: null,

    async init() {
      const use = window.claude && typeof window.claude.use === 'function' ? (n) => window.claude.use(n) : null;
      let db = null;
      if (use) { try { db = await use('db'); } catch (e) { Diag.report(e, 'db-init'); } }
      if (db) {
        this.db = db; this.mode = 'db'; this.listen();
        Promise.resolve().then(() => use('downloads')).then((d) => { this.downloads = d || null; if (S.view === 'aj') render(); }, () => {});
        return;
      }
      this.loadLocal();
      S.loaded = true;
      render();
    },

    /* ── localStorage ── */
    loadLocal() {
      let raw = null;
      try { raw = localStorage.getItem(LS_KEY); this.mode = 'local'; }
      catch (e) { this.mode = 'memory'; S.notices.storage = 'private'; Diag.report(e, 'storage-open', true); return; }
      if (raw == null) return;
      try {
        const j = JSON.parse(raw);
        if (!C.isObj(j) || !C.isObj(j.docs)) throw new Error('Formato de datos desconocido');
        applyDocs(j.docs);
      } catch (e) {
        Diag.report(e, 'storage-parse');
        try { localStorage.setItem(LS_KEY + '.danado', raw); } catch (err) { /* sin espacio para la copia */ }
        S.notices.storage = 'corrupt';
      }
    },
    saveLocal(now) {
      clearTimeout(this.lsTimer);
      const write = () => {
        this.lsTimer = null;
        try {
          localStorage.setItem(LS_KEY, JSON.stringify({ app: 'constancia', version: C.SCHEMA, docs: this.allDocs() }));
          this.setSync('saved');
        } catch (e) {
          Diag.report(e, 'storage-write');
          const full = e && (e.name === 'QuotaExceededError' || e.code === 22);
          this.setSync('error', full ? 'El dispositivo no tiene espacio para guardar. Exporta un respaldo.' : 'Este navegador no permite guardar. Exporta un respaldo antes de cerrar.');
        }
      };
      if (now) write(); else this.lsTimer = setTimeout(write, 150);
    },
    flushLocal() { if (this.lsTimer) this.saveLocal(true); },
    allDocs() {
      const d = realData(), out = { config: C.clone(d.config) };
      Object.keys(d.months).forEach((ym) => { out['m-' + ym] = C.clone(d.months[ym]); });
      return out;
    },
    reloadFromOtherTab(raw) {
      try {
        const j = JSON.parse(raw);
        if (!C.isObj(j) || !C.isObj(j.docs)) return;
        S.real = { config: null, months: {} };
        applyDocs(j.docs);
        render();
      } catch (e) { Diag.report(e, 'storage-sync'); }
    },

    /* ── Base de datos del artifact ── */
    listen() {
      this.col = this.db.collection('habitos');
      this.loadTimer = setTimeout(() => {
        if (!this.definitive) { this.setSync('offline', 'Todavía no se pudo conectar con tus datos. Reintentando…'); S.loaded = true; render(); }
      }, 10000);
      this.col.onSnapshot((snap) => {
        const docs = {};
        snap.docs.forEach((d) => { if (d.exists) docs[d.id] = d.data(); });
        Object.keys(docs).forEach((id) => { this.exists[id] = true; });
        if (!snap.metadata.fromCache && !this.definitive) {
          this.definitive = true;
          clearTimeout(this.loadTimer);
          if (S.sync === 'offline' && !this.pending()) this.setSync('idle');
        }
        applyDocs(docs, (id) => this.busy(id));
        S.loaded = true;
        scheduleRender();
      }, (err) => {
        clearTimeout(this.loadTimer);
        Diag.report(err, 'db-listen');
        const code = err && err.code;
        if (code === 'revoked') { this.readOnly = true; this.setSync('error', 'Este link ya no tiene acceso a tus datos.'); }
        else this.setSync('error', 'No se pudieron leer tus datos. Cierra y vuelve a abrir la app.');
        S.loaded = true; render();
      });
    },
    busy(id) { const q = this.q[id]; return !!(q && (q.inflight || q.wait || q.patch || q.replace)); },
    pending() { return Object.keys(this.q).some((id) => this.busy(id)); },
    entry(id) { return this.q[id] || (this.q[id] = { patch: null, replace: false, inflight: false, wait: false, tries: 0 }); },
    patch(id, patch) {
      if (S.demo) return;
      if (this.mode === 'local') return this.saveLocal();
      if (this.mode !== 'db' || this.readOnly) return;
      const q = this.entry(id);
      if (!q.replace) q.patch = deepMerge(q.patch || {}, patch);
      this.flush(id);
    },
    replace(id) {
      if (S.demo) return;
      if (this.mode === 'local') return this.saveLocal();
      if (this.mode !== 'db' || this.readOnly) return;
      const q = this.entry(id);
      q.replace = true; q.patch = null;
      this.flush(id);
    },
    remove(id) {
      if (S.demo) return;
      if (this.mode === 'local') return this.saveLocal();
      if (this.mode !== 'db' || this.readOnly) return;
      const q = this.entry(id);
      q.patch = null; q.replace = false;
      this.col.doc(id).delete().then(() => { this.exists[id] = false; }, (e) => Diag.report(e, 'db-delete'));
    },
    fullDoc(id) {
      if (id === 'config') return C.clone(realData().config);
      return C.clone(S.real.months[id.slice(2)] || { days: {}, reasons: {} });
    },
    flush(id) {
      const q = this.q[id];
      if (!q || q.inflight || q.wait || (!q.patch && !q.replace)) return;
      if (navigator.onLine === false) { this.setSync('offline'); return; }
      q.inflight = true;
      const patch = q.patch, rep = q.replace;
      q.patch = null; q.replace = false;
      this.setSync('saving');
      const ref = this.col.doc(id);
      let known = this.exists[id];
      if (known === undefined && this.definitive) known = false;
      const op = rep || known === false
        ? ref.set(this.fullDoc(id))
        : ref.update(patch).catch((e) => {
          if (e && (e.code === 'invalid_argument' || e.code === 'transform_error') && known !== true) return ref.set(this.fullDoc(id));
          throw e;
        });
      op.then(() => {
        this.exists[id] = true; q.inflight = false; q.tries = 0;
        if (q.patch || q.replace) this.flush(id);
        else if (!this.pending()) this.setSync('saved');
      }, (e) => {
        q.inflight = false;
        const code = e && e.code;
        Diag.report(e, 'db-write ' + id, true);
        const requeue = () => { if (rep) { q.replace = true; q.patch = null; } else if (!q.replace) q.patch = deepMerge(patch || {}, q.patch || {}); };
        if (!code || code === 'unavailable' || code === 'resource_exhausted' || code === 'capability_disabled') {
          requeue();
          q.tries++;
          this.setSync('offline');
          if (q.tries <= 5) {
            q.wait = true;
            setTimeout(() => { q.wait = false; this.flush(id); }, Math.min(16000, 1000 * Math.pow(2, q.tries - 1)) + Math.random() * 400);
          }
          return;
        }
        if (code === 'revoked' || code === 'not_granted') {
          this.readOnly = true;
          this.setSync('error', 'Este link es de solo lectura: tus cambios no se pueden guardar aquí.');
          return;
        }
        if (code === 'quota_exceeded') { requeue(); this.setSync('error', 'Se llenó el espacio de datos. Exporta un respaldo y borra hábitos antiguos.'); return; }
        this.setSync('error', 'No se pudo guardar el último cambio (' + code + ').');
      });
    },
    retryAll() {
      Object.keys(this.q).forEach((id) => { const q = this.q[id]; q.tries = 0; q.wait = false; this.flush(id); });
      if (this.mode === 'local') this.saveLocal(true);
    },
    setSync(state, msg) {
      const was = S.sync, wasMsg = S.syncMsg;
      S.sync = state; S.syncMsg = msg || '';
      const line = document.getElementById('sync-line');
      if (line) { line.className = 'sync ' + syncClass(); line.textContent = syncText(); }
      if (was !== state || wasMsg !== S.syncMsg) renderBanners();
    }
  };
  function syncClass() { return S.demo ? 'demo' : S.sync; }
  function syncText() {
    if (S.demo) return 'Modo ejemplo: nada se guarda';
    if (S.sync === 'saving') return 'Guardando…';
    if (S.sync === 'offline') return 'Sin conexión: se guardará al reconectar';
    if (S.sync === 'error') return S.syncMsg || 'No se pudo guardar';
    if (!S.loaded) return 'Cargando…';
    if (Store.mode === 'db') return 'Guardado en tu cuenta de Claude';
    if (Store.mode === 'local') return 'Guardado en este dispositivo';
    return 'Sin guardar: el navegador no lo permite';
  }

  /* ═════════════ Cambios de datos ═════════════ */
  function monthFor(k, create) {
    const d = D(), ym = C.ymOf(k);
    let m = d.months[ym];
    if (!m && create) m = d.months[ym] = { days: {}, reasons: {} };
    return m;
  }
  function canWrite() {
    if (!S.loaded) { hud('Cargando tus datos…', 'clock', true); return false; }
    if (Store.readOnly && !S.demo) { hud('Este link es de solo lectura', 'lock', true); return false; }
    return true;
  }
  function saveConfig() {
    const d = D();
    if (!d.config) { d.config = pendingDefault || C.defaultConfig(today()); pendingDefault = null; }
    Store.replace('config');
  }
  function ensureConfig() { if (!S.demo && !S.real.config && (Store.mode !== 'db' || Store.definitive)) saveConfig(); }
  function setVal(h, k, v) {
    if (k > today()) return;
    v = Math.max(0, Math.min(C.LIMITS.value, Math.round(Number(v) * 10) / 10));
    if (!isFinite(v)) return;
    const m = monthFor(k, true), dd = C.ddOf(k);
    m.days[dd] = Object.assign({}, m.days[dd], { [h.id]: v });
    Store.patch('m-' + C.ymOf(k), { days: { [dd]: { [h.id]: v } } });
    if (k < h.start && v > 0) {
      h.start = k;
      if (h.goals && h.goals.length && h.goals[0].from > k) h.goals[0].from = k;
      saveConfig();
    } else ensureConfig();
  }
  function setReason(h, k, r) {
    const m = monthFor(k, true), dd = C.ddOf(k);
    m.reasons[dd] = Object.assign({}, m.reasons[dd]);
    if (r) m.reasons[dd][h.id] = r; else delete m.reasons[dd][h.id];
    Store.patch('m-' + C.ymOf(k), { reasons: { [dd]: { [h.id]: r || null } } });
    ensureConfig();
  }

  /* ═════════════ Anillos (SVG) ═════════════ */
  function ringsSVG(items, size, opts) {
    opts = opts || {};
    const n = Math.max(items.length, 1), c = size / 2;
    const inner = size * (opts.inner != null ? opts.inner : 0.14);
    const slot = Math.min((c - inner) / n, size * 0.13);
    const w = slot * 0.84, track = opts.track != null ? opts.track : 0.26;
    let s = '<svg viewBox="0 0 ' + size + ' ' + size + '" width="' + size + '" height="' + size + '" aria-hidden="true" focusable="false">';
    if (!items.length) s += '<circle cx="' + c + '" cy="' + c + '" r="' + (c - 3) + '" fill="none" stroke="#3A3A3C" stroke-width="3"/>';
    items.forEach((it, i) => {
      const r = c - w / 2 - i * slot;
      if (r <= w / 2) return;
      const C2 = 2 * Math.PI * r, p = Math.max(0, Math.min(1, it.p || 0)), off = (C2 * (1 - p)).toFixed(2);
      s += '<circle cx="' + c + '" cy="' + c + '" r="' + r.toFixed(2) + '" fill="none" stroke="' + it.color + '" stroke-opacity="' + track + '" stroke-width="' + w.toFixed(2) + '"/>';
      s += '<circle class="rp"' + (it.key ? ' data-k="' + it.key + '"' : '') + ' data-off="' + off + '" cx="' + c + '" cy="' + c + '" r="' + r.toFixed(2) + '" fill="none" stroke="' + it.color + '" stroke-width="' + w.toFixed(2) + '" stroke-linecap="round" stroke-dasharray="' + C2.toFixed(2) + '" stroke-dashoffset="' + off + '" transform="rotate(-90 ' + c + ' ' + c + ')"' + (p === 0 ? ' opacity="0"' : '') + '/>';
    });
    return s + '</svg>';
  }
  function dayRings(k, size) {
    const fut = k > today();
    const items = M.habitsForDay(k).map((h) => ({ p: fut || !M.evaluable(h, k) ? 0 : M.prog(h, k), color: h.color }));
    return ringsSVG(items, size, { track: fut ? 0.12 : 0.28 });
  }

  /* ═════════════ Vistas ═════════════ */
  const TITLES = { hoy: 'Hoy', hist: 'Historial', ana: 'Análisis', aj: 'Ajustes' };
  function largeTitle(eyebrow, title, right) {
    return '<header class="lt"><div><div class="lt-eyebrow">' + esc(eyebrow) + '</div><h1 id="view-title">' + esc(title) + '</h1></div>' + (right || '') + '</header>';
  }

  /* ── Hoy ── */
  function viewHoy() {
    const t = today(), k = S.selected, isToday = k === t;
    const hs = M.habitsForDay(k), sum = M.daySummary(k);
    const ago = C.dayNum(t) - C.dayNum(k);
    const title = isToday ? 'Hoy' : ago === 1 ? 'Ayer' : C.cap(C.DOW[C.dow(k)]) + ' ' + Number(k.slice(8));
    let html = largeTitle(C.longDate(k), title, isToday ? '' : '<button class="btn-pill press" type="button" data-act="go-today">' + icon('rotate-ccw') + 'Hoy</button>');
    html += weekStrip(k);
    if (!hs.length) {
      return html + '<section class="card empty"><span class="tile" style="--tile:var(--tint-fill)">' + icon('list-checks') + '</span><h2>Agrega tu primer hábito</h2><p class="muted">Elige lo que quieres cumplir todos los días y márcalo aquí.</p><button class="btn primary press" type="button" data-act="new-habit">' + icon('plus') + 'Agregar hábito</button></section>';
    }
    html += summaryCard(k, hs, sum, isToday);
    html += ctxCard(k);
    html += '<div class="sec-h"><h2>Hábitos</h2><span>' + sum.done + ' de ' + sum.total + '</span></div>';
    html += '<ul class="list" aria-label="Hábitos del ' + esc(C.longDate(k)) + '">' + hs.map((h) => habitRow(h, k)).join('') + '</ul>';
    return html;
  }

  function weekStrip(k) {
    const ws = C.weekStart(k), t = today();
    let cells = '';
    for (let i = 0; i < 7; i++) {
      const d = C.addDays(ws, i), fut = d > t, s = fut ? null : M.daySummary(d);
      const label = C.longDate(d) + (s && s.total ? ', ' + s.done + ' de ' + s.total : '');
      cells += '<button class="wk-day' + (d === k ? ' sel' : '') + (d === t ? ' today' : '') + '" type="button" data-act="day" data-k="' + d + '"' + (fut ? ' disabled' : '') + (d === k ? ' aria-current="date"' : '') + '><span class="wk-l" aria-hidden="true">' + C.DOW_SHORT[i] + '</span>' + dayRings(d, 32) + '<span class="wk-n" aria-hidden="true">' + Number(d.slice(8)) + '</span><span class="vh">' + esc(label) + '</span></button>';
    }
    const canNext = C.addDays(ws, 7) <= t;
    return '<nav class="week" aria-label="Semana"><button class="wk-nav" type="button" data-act="week" data-d="-7" aria-label="Semana anterior">' + icon('chevron-left') + '</button>' + cells +
      '<button class="wk-nav" type="button" data-act="week" data-d="7"' + (canNext ? '' : ' disabled') + ' aria-label="Semana siguiente">' + icon('chevron-right') + '</button></nav>';
  }

  function summaryCard(k, hs, sum, isToday) {
    const items = hs.map((h) => ({ p: M.prog(h, k), color: h.color, key: 'big-' + h.id }));
    const rows = hs.slice(0, 5).map((h) => {
      const v = M.getVal(h.id, k), g = M.goalOn(h, k), st = M.status(h, k);
      const val = h.type === 'count'
        ? C.fmt(v) + '<small>/' + C.fmt(g) + (h.unit ? ' ' + esc(h.unit.toUpperCase()) : '') + '</small>'
        : st === 'done' ? 'Hecho' : st === 'fail' ? 'No cumplido' : st === 'na' ? '—' : 'Pendiente';
      return '<div class="sum-row"><span class="sum-name">' + esc(h.name) + '</span><span class="sum-val" style="color:' + tint(h.color) + '">' + val + '</span></div>';
    }).join('') + (hs.length > 5 ? '<div class="sum-more">y ' + C.plural(hs.length - 5, 'hábito más', 'hábitos más') + '</div>' : '');
    let foot;
    if (!S.loaded) foot = 'Cargando tus datos…';
    else if (sum.perfect) foot = '<b>' + (isToday ? '¡Día perfecto!' : 'Día perfecto') + '</b>';
    else foot = '<b>' + sum.done + ' de ' + sum.total + '</b> · ' + C.pct(sum.pct) + (isToday ? ' del día' : '');
    const ps = S.loaded && isToday ? M.perfectStreak() : 0;
    return '<section class="card summary' + (S.celebrate ? ' celebrate' : '') + '" aria-label="Resumen del día"><div class="summary-top"><div class="rings-big">' + ringsSVG(items, 164, { inner: 0.12 }) + '</div><div class="sum-list">' + rows + '</div></div>' +
      '<div class="summary-foot"><span>' + foot + '</span>' + (ps >= 2 ? '<span class="streak-chip">' + icon('flame') + C.plural(ps, 'día perfecto', 'días perfectos') + '</span>' : '') + '</div></section>';
  }

  function band() {
    const s = cfg().settings, now = nowMinutes();
    if (now >= C.minutesOf(s.night)) return 'night';
    if (now < 12 * 60) return 'morning';
    return 'day';
  }

  function ctxCard(k) {
    if (!S.loaded) return '';
    const t = today(), y = C.addDays(t, -1);
    const card = (ic, color, title, text, actions) => '<section class="card ctx"><span class="tile" style="--tile:' + color + '">' + icon(ic) + '</span><h2>' + title + '</h2><p>' + text + '</p>' + (actions ? '<div class="ctx-a">' + actions + '</div>' : '') + '</section>';
    const names = (list) => list.map((h) => esc(h.name)).join(', ');
    if (k !== t) {
      const fails = M.habitsForDay(k).filter((h) => M.status(h, k) === 'fail');
      if (!fails.length) return '';
      const missing = fails.filter((h) => !M.getReason(h.id, k));
      return card('pencil', 'var(--gray-tile)', 'No cumpliste ' + C.plural(fails.length, 'hábito', 'hábitos'), names(fails) + '. Si sí lo hiciste, márcalo abajo.',
        missing.length ? '<button class="btn small primary press" type="button" data-act="reasons-day" data-k="' + k + '">Registrar por qué</button>' : '');
    }
    const b = band(), pendingToday = M.activeHabits().filter((h) => M.status(h, t) === 'pending');
    if (b === 'night') {
      if (!pendingToday.length) return card('moon', 'var(--indigo)', 'Día cerrado', 'Cumpliste todo hoy. Mañana sigues la racha.');
      const left = pendingToday.map((h) => esc(h.name) + (h.type === 'count' ? ' (' + C.fmt(M.getVal(h.id, t)) + ' de ' + C.fmt(M.goalOn(h, t)) + ')' : '')).join(', ');
      return card('moon', 'var(--indigo)', 'Cierra tu día', 'Te ' + (pendingToday.length === 1 ? 'falta' : 'faltan') + ' ' + left + '.', '<button class="btn small press" type="button" data-act="reasons-today">Hoy no lo voy a lograr</button>');
    }
    if (b === 'morning') {
      const plan = M.activeHabits().map((h) => esc(h.type === 'count' ? h.name + ' ' + C.fmt(M.goalOn(h, t)) + ' ' + h.unit : h.name)).join(' · ');
      const yFails = M.habitsForDay(y).filter((h) => M.status(h, y) === 'fail');
      const yMissing = yFails.filter((h) => !M.getReason(h.id, y));
      const ySum = M.daySummary(y);
      let extra = '';
      if (ySum.perfect) extra = '<br>Ayer tuviste un día perfecto.';
      else if (yFails.length) extra = '<br>Ayer te faltó: ' + names(yFails) + '.';
      return card('sunrise', 'var(--orange)', 'Plan de hoy', plan + extra, yMissing.length ? '<button class="btn small primary press" type="button" data-act="reasons-day" data-k="' + y + '">¿Qué pasó ayer?</button>' : '');
    }
    const pend = M.pendingReasons(7);
    if (pend.length) return card('pencil', 'var(--tint-fill)', C.plural(pend.length, 'falla', 'fallas') + ' sin motivo', 'Anotar por qué fallaste revela tus patrones en Análisis.', '<button class="btn small primary press" type="button" data-act="reasons-pending">Registrar motivos</button>');
    return '';
  }

  function habitRow(h, k) {
    const t = today(), v = M.getVal(h.id, k), g = M.goalOn(h, k), p = M.prog(h, k), st = M.status(h, k), ev = M.evaluable(h, k);
    const streak = k === t ? M.streaks(h).cur : 0;
    let sub;
    if (!ev && v === 0) sub = 'Aún no empezabas este hábito';
    else if (h.type === 'check') sub = p >= 1 ? 'Hecho' : st === 'fail' ? 'No cumplido' : 'Pendiente';
    else sub = C.fmt(v) + ' de ' + C.fmt(g) + (h.unit ? ' ' + h.unit : '');
    const on = p >= 1 || (h.type === 'count' && v > 0);
    let ctl;
    if (h.type === 'check') {
      ctl = '<button class="check' + (p >= 1 ? ' on' : '') + '" type="button" data-act="toggle" data-h="' + h.id + '" aria-pressed="' + (p >= 1) + '" aria-label="' + esc(h.name) + ': ' + (p >= 1 ? 'hecho. Toca para desmarcar' : 'marcar como hecho') + '">' + icon('check') + '</button>';
    } else {
      ctl = '<div class="stepper" role="group" aria-label="' + esc(h.name) + '"><button type="button" data-act="dec" data-h="' + h.id + '"' + (v <= 0 ? ' disabled' : '') + ' aria-label="Restar ' + C.fmt(h.step) + ' ' + esc(h.unit) + '">' + icon('minus') + '</button><span class="stepper-div" aria-hidden="true"></span>' +
        '<button class="plus" type="button" data-act="inc" data-h="' + h.id + '" aria-label="Sumar ' + C.fmt(h.step) + ' ' + esc(h.unit) + '">' + icon('plus') + '<span>' + C.fmt(h.step) + '</span></button></div>';
    }
    let why = '';
    if (st === 'fail') {
      const r = M.getReason(h.id, k), R = r && C.REASON[r];
      why = '<button class="reason-chip press' + (R ? ' set' : '') + '" type="button" data-act="why" data-h="' + h.id + '" data-k="' + k + '">' + icon(R ? R.icon : 'plus') + (R ? esc(R.label) : 'Agregar motivo') + '</button>';
    }
    return '<li class="hrow" style="--hc:' + h.color + ';--ht:' + tint(h.color) + ';--ht2:' + tint(h.color, '#2C2C2E') + '">' +
      '<button class="hmain" type="button" data-act="detail" data-h="' + h.id + '" aria-label="' + esc(h.name + ', ' + sub + (streak >= 2 ? ', racha de ' + streak + ' días' : '') + '. Ver detalle') + '">' +
      '<span class="hring">' + ringsSVG([{ p: p, color: h.color, key: 'row-' + h.id }], 48, { inner: 0.3 }) + '<span class="hicon">' + icon(h.icon) + '</span></span>' +
      '<span class="htext"><span class="hname">' + esc(h.name) + '</span><span class="hsub' + (on ? ' on' : '') + '">' + esc(sub) + (streak >= 2 ? '<span class="flame">' + icon('flame') + streak + '</span>' : '') + '</span></span></button>' +
      '<div class="hctl">' + ctl + '</div>' + why + '</li>';
  }

  /* ── Historial ── */
  function viewHist() {
    let html = largeTitle('Tu pizarra de días', 'Historial');
    html += '<div class="seg" role="tablist" aria-label="Periodo">' +
      ['mes', 'anio'].map((v) => '<button type="button" role="tab" data-act="hist-mode" data-v="' + v + '" aria-selected="' + (S.histMode === v) + '">' + (v === 'mes' ? 'Mes' : 'Año') + '</button>').join('') + '</div>';
    return html + (S.histMode === 'mes' ? monthView(S.histMonth) : yearView());
  }

  function monthView(ym) {
    const t = today(), tym = C.ymOf(t), first = ym + '-01', n = C.daysInMonth(ym), lead = C.dow(first), p = ym.split('-').map(Number);
    let html = '<section class="card"><div class="mon-head"><h2>' + C.MONTHS[p[1] - 1] + ' ' + p[0] + '</h2><div class="mon-nav"><button class="btn-circle press" type="button" data-act="hist-month" data-d="-1" aria-label="Mes anterior">' + icon('chevron-left') + '</button><button class="btn-circle press" type="button" data-act="hist-month" data-d="1"' + (ym >= tym ? ' disabled' : '') + ' aria-label="Mes siguiente">' + icon('chevron-right') + '</button></div></div>';
    html += '<div class="cal">' + C.DOW_SHORT.map((l, i) => '<div class="cal-l" aria-hidden="true" title="' + C.DOW[i] + '">' + l + '</div>').join('');
    for (let i = 0; i < lead; i++) html += '<div aria-hidden="true"></div>';
    let perfect = 0;
    for (let d = 1; d <= n; d++) {
      const k = ym + '-' + C.pad(d), fut = k > t, s = fut ? null : M.daySummary(k), pf = !!(s && s.perfect);
      if (pf) perfect++;
      html += '<button class="cal-d' + (k === t ? ' today' : '') + (pf ? ' perfect' : '') + '" type="button" data-act="cal-day" data-k="' + k + '"' + (fut ? ' disabled' : '') + ' aria-label="' + esc(C.longDate(k) + (s && s.total ? ', ' + s.done + ' de ' + s.total + (pf ? ', día perfecto' : '') : '')) + '">' + dayRings(k, 40) + '<span class="cal-n" aria-hidden="true">' + d + '</span></button>';
    }
    html += '</div><p class="foot-note">Toca un día para verlo o corregirlo. Los días perfectos aparecen en amarillo.</p></section>';
    if (first > t) return html;
    const last = C.minK(ym + '-' + C.pad(n), t);
    const rows = M.habits().filter((h) => h.start <= last && (!h.archivedAt || h.archivedAt > first)).map((h) => {
      const r = M.rate(h, first, last);
      let total = '';
      if (h.type === 'count') { let sum = 0; C.eachDay(first, last, (k) => { sum += M.getVal(h.id, k); }); total = ' · ' + C.fmt(sum) + (h.unit ? ' ' + h.unit : ''); }
      return barRow(h.icon, h.color, h.name, r.done + '/' + r.ev + ' días' + total, r.pct, C.pct(r.pct));
    }).join('');
    html += '<section class="card"><div class="card-h"><h2>Resumen del mes</h2><span>' + C.plural(perfect, 'día perfecto', 'días perfectos') + '</span></div>' + (rows || '<p class="muted">Sin registros este mes.</p>') + '</section>';
    return html;
  }

  function barRow(ic, color, name, meta, frac, end, endExtra) {
    return '<div class="hbar"><span class="tile sm dark" style="--tile:' + color + '">' + icon(ic) + '</span><div class="hb-main"><div class="hb-top"><span>' + esc(name) + '</span><span>' + esc(meta) + '</span></div><div class="track"><i style="width:' + Math.round((frac || 0) * 100) + '%;--c:' + color + '"></i></div></div><span class="end">' + esc(end) + (endExtra || '') + '</span></div>';
  }

  function yearView() {
    const t = today();
    let h = S.histHabit === 'all' ? null : M.habitById(S.histHabit);
    if (S.histHabit !== 'all' && !h) { S.histHabit = 'all'; h = null; }
    const chips = '<div class="chips scroll" role="group" aria-label="Filtrar por hábito"><button class="chip" type="button" data-act="hist-habit" data-h="all" aria-pressed="' + !h + '">Todos</button>' +
      M.habits().map((x) => '<button class="chip" type="button" data-act="hist-habit" data-h="' + x.id + '" aria-pressed="' + (h === x) + '" style="--chip:' + x.color + '">' + icon(x.icon) + esc(x.name) + '</button>').join('') + '</div>';
    const endWs = C.weekStart(t), startWs = C.addDays(endWs, -52 * 7);
    let cells = '', prevM = null;
    for (let c = 0; c < 53; c++) {
      const col = C.addDays(startWs, c * 7), m = col.slice(5, 7);
      let lab = '';
      if (m !== prevM) { lab = C.MONTHS_SHORT[Number(m) - 1]; if (c === 0 && C.addDays(col, 14).slice(5, 7) !== m) lab = ''; }
      prevM = m;
      cells += '<span class="hm">' + lab + '</span>';
      for (let r = 0; r < 7; r++) cells += heatCell(C.addDays(col, r), h, t);
    }
    let html = chips + '<section class="card"><div class="card-h"><h2>Últimos 12 meses</h2></div><div class="heat-scroll" id="heat-scroll" tabindex="0" role="region" aria-label="Mapa de calor de 12 meses; desliza para ver meses anteriores"><div class="heat" aria-hidden="true">' + cells + '</div></div>';
    html += '<div class="legend" aria-hidden="true">' + (h
      ? '<span><i class="hc fail"></i>No cumplido</span><span><i class="hc" style="background:' + h.color + '66"></i>Parcial</span><span><i class="hc" style="background:' + h.color + '"></i>Cumplido</span>'
      : '<span><i class="hc fail"></i>0%</span><span><i class="hc l2"></i>Parcial</span><span><i class="hc l4"></i>Día perfecto</span>') + '</div>';
    const from = C.maxK(C.addDays(t, -364), M.earliestStart());
    if (h) {
      const r = M.rate(h, from, t), sk = M.streaks(h);
      html += '<p class="muted">' + esc(h.name) + ': ' + r.done + ' de ' + r.ev + ' días cumplidos (' + C.pct(r.pct) + '). Mejor racha: ' + C.plural(sk.best, 'día', 'días') + '.</p>';
    } else {
      let pf = 0, tracked = 0;
      C.eachDay(from, t, (k) => { const s = M.daySummary(k); if (s.total) { tracked++; if (s.perfect) pf++; } });
      html += '<p class="muted">' + C.plural(pf, 'día perfecto', 'días perfectos') + ' de ' + C.plural(tracked, 'día registrado', 'días registrados') + '.</p>';
    }
    return html + '</section>';
  }
  function heatCell(k, h, t) {
    if (k > t) return '<i class="hc fut"></i>';
    if (h) {
      if (!M.evaluable(h, k)) return '<i class="hc"></i>';
      const p = M.prog(h, k), tc = k === t ? ' today' : '';
      if (p >= 1) return '<i class="hc' + tc + '" style="background:' + h.color + '"></i>';
      if (p > 0) return '<i class="hc' + tc + '" style="background:' + h.color + '66"></i>';
      return '<i class="hc ' + (k === t ? 'today' : 'fail') + '"></i>';
    }
    const s = M.daySummary(k);
    if (!s.total) return '<i class="hc"></i>';
    const lv = s.perfect ? 4 : s.pct >= 0.66 ? 3 : s.pct >= 0.33 ? 2 : s.pct > 0 ? 1 : 0;
    if (k === t && !lv) return '<i class="hc today"></i>';
    return '<i class="hc ' + (lv ? 'l' + lv : 'fail') + (k === t ? ' today' : '') + '"></i>';
  }
  function miniHeat(h, weeks) {
    const t = today(), startWs = C.addDays(C.weekStart(t), -(weeks - 1) * 7);
    let cells = '';
    for (let c = 0; c < weeks; c++) for (let r = 0; r < 7; r++) cells += heatCell(C.addDays(startWs, c * 7 + r), h, t);
    return '<div class="heat-scroll" tabindex="0" role="region" aria-label="Últimas ' + weeks + ' semanas"><div class="heat mini" aria-hidden="true">' + cells + '</div></div>';
  }

  /* ── Análisis ── */
  function delta(a, b, suffix) {
    if (a.pct == null || b.pct == null || b.ev < 3) return '<span class="delta">' + (suffix || '&nbsp;') + '</span>';
    const d = Math.round((a.pct - b.pct) * 100);
    return '<span class="delta ' + (d >= 0 ? 'up' : 'down') + '">' + icon(d >= 0 ? 'arrow-up' : 'arrow-down') + Math.abs(d) + ' pts</span>';
  }
  function viewAna() {
    const t = today(), y = C.addDays(t, -1), ws = C.weekStart(t), ym = C.ymOf(t), pym = C.addMonths(ym, -1);
    const first = M.earliestStart(), tracked = Math.max(0, C.dayNum(t) - C.dayNum(first));
    let html = largeTitle('Para mejorar cada día', 'Análisis');
    if (tracked < 3 && !S.demo) {
      html += '<section class="card ctx"><span class="tile" style="--tile:var(--tint-fill)">' + icon('chart-column') + '</span><h2>Aquí verás en qué fallas</h2><p>Llevas ' + C.plural(tracked + 1, 'día', 'días') + ' registrando. Con una semana aparecen tus rachas, tu día más difícil y tus motivos más comunes.</p><div class="ctx-a"><button class="btn small primary press" type="button" data-act="demo-on">Ver un ejemplo</button></div></section>';
    }
    const wNow = M.overallRate(ws, t), wPrev = M.overallRate(C.addDays(ws, -7), C.addDays(ws, -1));
    const mNow = M.overallRate(ym + '-01', t), mPrev = M.overallRate(pym + '-01', pym + '-' + C.pad(C.daysInMonth(pym)));
    let perfect = 0;
    C.eachDay(ym + '-01', t, (k) => { if (M.daySummary(k).perfect) perfect++; });
    html += '<div class="kpis">' +
      '<div class="kpi"><span class="lbl">Esta semana</span><span class="val">' + C.pct(wNow.pct) + '</span>' + delta(wNow, wPrev) + '</div>' +
      '<div class="kpi"><span class="lbl">Este mes</span><span class="val">' + C.pct(mNow.pct) + '</span>' + delta(mNow, mPrev) + '</div>' +
      '<div class="kpi"><span class="lbl">Días perfectos</span><span class="val">' + perfect + '</span><span class="delta">en ' + C.MONTHS[Number(ym.slice(5)) - 1] + '</span></div></div>';

    const ins = M.insights();
    if (ins.length) {
      html += '<section class="card"><div class="card-h"><h2>Lo que encontré</h2></div>' + ins.map((x) => {
        const color = x.tone === 'bad' ? 'var(--red)' : x.tone === 'good' ? 'var(--green)' : 'var(--tint-fill)';
        return '<div class="ins"><span class="tile' + (x.tone === 'bad' || x.tone === 'good' ? ' dark' : '') + '" style="--tile:' + color + '">' + icon(x.icon) + '</span><h3>' + esc(x.title) + '</h3><p>' + esc(x.text) + '</p></div>';
      }).join('') + '</section>';
    }

    const hs = M.activeHabits();
    html += '<section class="card"><div class="card-h"><h2>Rachas</h2><span>Actual · Récord</span></div>' + (hs.length ? hs.map((h) => {
      const s = M.streaks(h);
      return '<div class="streak-row"><span class="tile sm dark" style="--tile:' + h.color + '">' + icon(h.icon) + '</span><span class="nm">' + esc(h.name) + '</span><span class="v cur" aria-label="Racha actual ' + s.cur + '">' + icon('flame') + s.cur + '</span><span class="v best" aria-label="Récord ' + s.best + '">' + icon('trophy') + s.best + '</span></div>';
    }).join('') : '<p class="muted">Agrega hábitos para ver tus rachas.</p>') + '</section>';

    const from30 = C.addDays(t, -29), prevA = C.addDays(t, -59), prevB = C.addDays(t, -30);
    html += '<section class="card"><div class="card-h"><h2>Cumplimiento</h2><span>30 días</span></div>' + hs.map((h) => {
      const r = M.rate(h, C.maxK(from30, h.start), t), rp = M.rate(h, C.maxK(prevA, h.start), prevB);
      let d = '';
      if (r.pct != null && rp.pct != null && rp.ev >= 5) { const dd = Math.round((r.pct - rp.pct) * 100); d = '<span class="delta ' + (dd >= 0 ? 'up' : 'down') + '">' + icon(dd >= 0 ? 'arrow-up' : 'arrow-down') + Math.abs(dd) + '</span>'; }
      return barRow(h.icon, h.color, h.name, r.done + '/' + r.ev + ' días', r.pct, C.pct(r.pct), d);
    }).join('') + '</section>';

    const wd = M.weekdayStats(C.maxK(first, C.addDays(t, -84)), y), valid = wd.filter((w) => w.pct != null);
    let worst = null, best = null;
    if (valid.length >= 3) {
      const sorted = valid.slice().sort((a, b) => a.pct - b.pct);
      if (sorted[sorted.length - 1].pct - sorted[0].pct >= 0.05) { worst = sorted[0].i; best = sorted[sorted.length - 1].i; }
    }
    html += '<section class="card"><div class="card-h"><h2>Por día de la semana</h2><span>12 semanas</span></div>';
    if (valid.length) {
      html += '<div class="wdc" role="img" aria-label="' + esc('Cumplimiento por día: ' + wd.map((w) => C.DOW[w.i] + ' ' + C.pct(w.pct)).join(', ')) + '">' + wd.map((w) =>
        '<div class="wdc-col' + (w.i === worst ? ' worst' : '') + (w.i === best ? ' best' : '') + '"><span class="wdc-v">' + C.pct(w.pct) + '</span><div class="wdc-area"><div class="wdc-bar" style="height:' + Math.round((w.pct || 0) * 100) + '%"></div></div><span class="wdc-l">' + C.DOW_SHORT[w.i] + '</span></div>').join('') + '</div>';
      if (worst != null) html += '<div class="legend"><span><i style="--c:var(--red)"></i>Más difícil: ' + C.DOW[worst] + '</span><span><i style="--c:var(--green)"></i>Mejor: ' + C.DOW[best] + '</span></div>';
    } else html += '<p class="muted">Aparece cuando tengas días completos registrados.</p>';
    html += '</section>';

    const rc = M.reasonCounts(C.maxK(first, C.addDays(t, -89)), y), maxN = rc.list.length ? rc.list[0].n : 1;
    html += '<section class="card"><div class="card-h"><h2>Motivos de falla</h2><span>90 días</span></div>';
    if (rc.list.length) html += rc.list.map((x) => barRow(C.REASON[x.id].icon, 'var(--label-2)', C.REASON[x.id].label, '', x.n / maxN, String(x.n))).join('');
    else html += '<p class="muted">Cuando falles un hábito, toca “Agregar motivo” y aquí verás qué se repite.</p>';
    const pend = M.pendingReasons(7).length;
    if (rc.unexplained) html += '<p class="foot-note">' + C.plural(rc.unexplained, 'falla', 'fallas') + ' sin motivo registrado.</p>';
    if (pend) html += '<div><button class="btn small primary press" type="button" data-act="reasons-pending">Registrar las de esta semana (' + pend + ')</button></div>';
    return html + '</section>';
  }

  /* ── Ajustes ── */
  function viewAj() {
    const c = cfg(), t = today(), act = M.activeHabits(), arch = M.habits().filter((h) => h.archivedAt);
    let html = largeTitle('Configura tu tablero', 'Ajustes');
    html += '<div class="group-t">Mis hábitos</div><div class="group">' + act.map((h, i) =>
      '<div class="gi"><span class="tile sm dark" style="--tile:' + h.color + '">' + icon(h.icon) + '</span>' +
      '<button class="gi-main" type="button" data-act="edit-habit" data-h="' + h.id + '"><span class="gi-title">' + esc(h.name) + '</span><span class="gi-sub">' + esc(h.type === 'count' ? 'Meta diaria: ' + C.fmt(M.goalOn(h, t)) + (h.unit ? ' ' + h.unit : '') : 'Sí o no') + '</span></button>' +
      '<button class="gi-mv press" type="button" data-act="move" data-h="' + h.id + '" data-d="-1"' + (i === 0 ? ' disabled' : '') + ' aria-label="Subir ' + esc(h.name) + '">' + icon('arrow-up') + '</button>' +
      '<button class="gi-mv press" type="button" data-act="move" data-h="' + h.id + '" data-d="1"' + (i === act.length - 1 ? ' disabled' : '') + ' aria-label="Bajar ' + esc(h.name) + '">' + icon('arrow-down') + '</button></div>').join('') +
      (act.length < C.LIMITS.habits ? '<button class="gi" type="button" data-act="new-habit"><span class="tile sm" style="--tile:var(--tint-fill)">' + icon('plus') + '</span><span class="gi-main"><span class="gi-title gi-link">Agregar hábito</span></span></button>' : '<div class="gi no-tile"><span class="gi-sub">Llegaste al máximo de ' + C.LIMITS.habits + ' hábitos activos.</span></div>') + '</div>';
    if (arch.length) html += '<div class="group-t">Archivados</div><div class="group">' + arch.map((h) =>
      '<div class="gi"><span class="tile sm dark" style="--tile:' + h.color + '">' + icon(h.icon) + '</span><div class="gi-main"><span class="gi-title">' + esc(h.name) + '</span><span class="gi-sub">Oculto desde el ' + C.shortDate(h.archivedAt) + '</span></div><button class="btn small press" type="button" data-act="restore" data-h="' + h.id + '">Restaurar</button></div>').join('') + '</div>';

    html += '<div class="group-t">Recordatorios</div><div class="group">' +
      '<div class="gi"><span class="tile sm" style="--tile:var(--orange)">' + icon('sunrise') + '</span><label class="gi-main" for="set-morning"><span class="gi-title">Mañana</span><span class="gi-sub">Plan del día y repaso de ayer</span></label><input id="set-morning" type="time" value="' + esc(c.settings.morning) + '"></div>' +
      '<div class="gi"><span class="tile sm" style="--tile:var(--indigo)">' + icon('moon') + '</span><label class="gi-main" for="set-night"><span class="gi-title">Noche</span><span class="gi-sub">Cierre: lo que falta y por qué</span></label><input id="set-night" type="time" value="' + esc(c.settings.night) + '"></div>' +
      '<button class="gi" type="button" data-act="howto"><span class="tile sm" style="--tile:var(--red)">' + icon('bell') + '</span><span class="gi-main"><span class="gi-title">Notificaciones en el iPhone</span></span><span class="chev">' + icon('chevron-right') + '</span></button></div>';

    const where = Store.mode === 'db' ? 'Privado. Solo tú lo ves, en cualquier dispositivo con tu cuenta.' : Store.mode === 'local' ? 'Solo en este dispositivo. Exporta un respaldo de vez en cuando.' : 'Este navegador no deja guardar. Exporta un respaldo antes de cerrar.';
    html += '<div class="group-t">Datos</div><div class="group">' +
      '<div class="gi"><span class="tile sm" style="--tile:var(--gray-tile)">' + icon(Store.mode === 'db' ? 'cloud' : 'hard-drive') + '</span><div class="gi-main"><span id="sync-line" class="sync ' + syncClass() + '">' + esc(syncText()) + '</span><span class="gi-sub">' + where + '</span></div></div>' +
      '<button class="gi" type="button" data-act="export-copy"><span class="tile sm" style="--tile:var(--tint-fill)">' + icon('copy') + '</span><span class="gi-main"><span class="gi-title">Copiar respaldo</span></span></button>' +
      (Store.mode !== 'db' || Store.downloads ? '<button class="gi" type="button" data-act="export-dl"><span class="tile sm" style="--tile:var(--tint-fill)">' + icon('download') + '</span><span class="gi-main"><span class="gi-title">Descargar respaldo</span></span></button>' : '') +
      '<button class="gi" type="button" data-act="import-open"><span class="tile sm" style="--tile:var(--tint-fill)">' + icon('upload') + '</span><span class="gi-main"><span class="gi-title">Importar respaldo</span></span><span class="chev">' + icon('chevron-right') + '</span></button>' +
      '<button class="gi" type="button" data-act="' + (S.demo ? 'demo-off' : 'demo-on') + '"><span class="tile sm" style="--tile:var(--yellow)">' + icon('sparkles') + '</span><span class="gi-main"><span class="gi-title">' + (S.demo ? 'Salir del modo ejemplo' : 'Ver un ejemplo con datos') + '</span><span class="gi-sub">Diez semanas ficticias para conocer el análisis</span></span></button></div>';

    html += '<div class="group-t">Soporte</div><div class="group">' +
      '<button class="gi" type="button" data-act="diag"><span class="tile sm" style="--tile:var(--gray-tile)">' + icon('shield-check') + '</span><span class="gi-main"><span class="gi-title">Diagnóstico</span><span class="gi-sub">' + (Diag.errors.length ? C.plural(Diag.errors.length, 'evento registrado', 'eventos registrados') : 'Todo en orden') + '</span></span><span class="chev">' + icon('chevron-right') + '</span></button>' +
      '<div class="gi"><span class="tile sm" style="--tile:var(--tint-fill)">' + icon('info') + '</span><div class="gi-main"><span class="gi-title">Próximamente: app nativa</span><span class="gi-sub">Widgets en inicio y bloqueo, marcar desde el widget, avisos integrados e iCloud. Tu respaldo se importa allá.</span></div></div></div>';
    html += '<div class="about"><span>Constancia ' + C.VERSION + '</span><span>' + C.plural(M.habits().length, 'hábito', 'hábitos') + ' · desde el ' + C.shortDate(M.earliestStart()) + '</span></div>';
    return html;
  }

  /* ═════════════ Avisos (banners) ═════════════ */
  function renderBanners() {
    const el = document.getElementById('banners');
    if (!el) return;
    const out = [];
    const b = (cls, ic, color, title, text, action) => '<div class="banner ' + cls + '" role="' + (cls === 'error' ? 'alert' : 'status') + '"><span class="tile sm" style="--tile:' + color + '">' + icon(ic) + '</span><div><p class="b-title">' + title + '</p>' + (text ? '<p>' + text + '</p>' : '') + '</div>' + (action || '') + '</div>';
    if (S.demo) out.push(b('demo', 'sparkles', '#000', 'Modo ejemplo', 'Datos ficticios de 10 semanas. Tus datos reales no se tocan.', '<button class="btn press" type="button" data-act="demo-off">Salir</button>'));
    if (S.swUpdate) out.push(b('', 'refresh-cw', 'var(--tint-fill)', 'Nueva versión disponible', 'Actualiza para usar las mejoras.', '<button class="btn primary press" type="button" data-act="sw-update">Actualizar</button>'));
    if (!S.demo && S.sync === 'offline') out.push(b('', 'wifi-off', 'var(--gray-tile)', 'Sin conexión', esc(S.syncMsg || 'Tus cambios se guardarán al reconectar.'), '<button class="btn press" type="button" data-act="retry-sync">Reintentar</button>'));
    if (!S.demo && S.sync === 'error') out.push(b('error', 'triangle-alert', 'var(--red)', 'No se pudo guardar', esc(S.syncMsg), Store.readOnly ? '' : '<button class="btn press" type="button" data-act="retry-sync">Reintentar</button>'));
    if (S.notices.storage === 'corrupt') out.push(b('error', 'triangle-alert', 'var(--orange)', 'No pudimos leer tus datos guardados', 'Guardamos una copia de seguridad y empezaste de cero. Si tienes un respaldo, impórtalo en Ajustes.', '<button class="btn press" type="button" data-act="dismiss" data-v="storage">Entendido</button>'));
    if (S.notices.storage === 'private') out.push(b('', 'lock', 'var(--gray-tile)', 'Este navegador no deja guardar', 'Tus marcas se perderán al cerrar. Exporta un respaldo o usa Safari normal.', '<button class="btn press" type="button" data-act="dismiss" data-v="storage">Entendido</button>'));
    if (S.fault) out.push(b('error', 'bug', 'var(--orange)', 'Algo no salió como esperaba', 'Tus datos están a salvo.', '<button class="btn press" type="button" data-act="fault-retry">Reintentar</button>'));
    el.innerHTML = out.join('');
  }

  /* ═════════════ Render ═════════════ */
  let renderQueued = false;
  function scheduleRender() { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; render(); }); }
  function render() {
    try {
      const prev = {};
      $$('#view .rp[data-k]').forEach((c) => { prev[c.getAttribute('data-k')] = c.getAttribute('data-off'); });
      const html = S.view === 'hist' ? viewHist() : S.view === 'ana' ? viewAna() : S.view === 'aj' ? viewAj() : viewHoy();
      $('#view').innerHTML = html;
      $$('#tabbar [data-v]').forEach((b) => { if (b.getAttribute('data-v') === S.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
      $('#navbar').textContent = TITLES[S.view];
      document.title = S.view === 'hoy' ? 'Constancia' : TITLES[S.view] + ' · Constancia';
      renderBanners();
      animateRings(prev);
      S.celebrate = false;
      const hsc = document.getElementById('heat-scroll');
      if (hsc) hsc.scrollLeft = hsc.scrollWidth;
      if (S.sheet && !sheetHasFocus()) renderSheet();
    } catch (err) {
      Diag.report(err, 'render');
      $('#view').innerHTML = '<section class="card fault"><span class="tile" style="--tile:var(--orange)">' + icon('triangle-alert') + '</span><h2>No se pudo mostrar esta pantalla</h2><p class="muted">Tus datos están a salvo. Puedes reintentar o copiar un respaldo.</p><div class="row2"><button class="btn press" type="button" data-act="export-copy">Copiar respaldo</button><button class="btn primary press" type="button" data-act="fault-retry">Reintentar</button></div></section>';
    }
  }
  function animateRings(prev) {
    const fromEmpty = S.firstPaint && S.loaded && S.view === 'hoy';
    if (S.loaded && S.view === 'hoy') S.firstPaint = false;
    if (reduceMotion()) return;
    const todo = [];
    $$('#view .rp[data-k]').forEach((c) => {
      const k = c.getAttribute('data-k'), to = c.getAttribute('data-off');
      let from = prev[k];
      if (from == null) { if (!fromEmpty) return; from = c.getAttribute('stroke-dasharray'); }
      if (Number(from) === Number(to)) return;
      c.style.transition = 'none'; c.style.strokeDashoffset = from; c.style.opacity = '1';
      todo.push([c, to]);
    });
    if (!todo.length) return;
    void document.body.getBoundingClientRect();
    requestAnimationFrame(() => todo.forEach((x) => { x[0].style.transition = ''; x[0].style.strokeDashoffset = x[1]; }));
  }

  /* ═════════════ HUD ═════════════ */
  let hudTimer = null;
  function hud(msg, ic, warn) {
    const el = $('#hud');
    el.innerHTML = icon(ic || 'circle-check') + '<span>' + esc(msg) + '</span>';
    el.classList.toggle('warn', !!warn);
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => { el.classList.remove('show'); setTimeout(() => { if (!el.classList.contains('show')) el.textContent = ''; }, 400); }, 2200);
  }

  /* ═════════════ Hojas inferiores ═════════════ */
  let lastFocus = null;
  function sheetHasFocus() { const a = document.activeElement; return !!(a && a.closest && a.closest('#sheet') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); }
  function setInert(on) { ['app', 'tabbar', 'navbar'].forEach((id) => { const el = document.getElementById(id); if (el) { if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert'); } }); }
  function openSheet(sh) {
    const wasOpen = !!S.sheet;
    if (!wasOpen) lastFocus = document.activeElement;
    S.sheet = sh;
    const el = $('#sheet');
    renderSheet();
    $('#sheet .sheet-scroll').scrollTop = 0;
    if (wasOpen) return;
    el.hidden = false;
    setInert(true);
    document.documentElement.classList.add('locked');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.classList.add('open');
      const f = $('#sheet [data-autofocus]') || $('#sheet .sh-close');
      if (f) f.focus({ preventScroll: true });
    }));
  }
  function closeSheet() {
    if (!S.sheet) return;
    const el = $('#sheet');
    el.classList.remove('open');
    el.style.removeProperty('--drag');
    S.sheet = null;
    setInert(false);
    document.documentElement.classList.remove('locked');
    setTimeout(() => { if (!S.sheet) el.hidden = true; }, reduceMotion() ? 0 : 450);
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
    else $('#view').focus({ preventScroll: true });
  }
  function renderSheet() {
    const sh = S.sheet;
    if (!sh) return;
    let html = '';
    try {
      html = ({ detail: sheetDetail, reasons: sheetReasons, edit: sheetEdit, import: sheetImport, export: sheetExport, howto: sheetHowto, diag: sheetDiag })[sh.type](sh);
    } catch (err) {
      Diag.report(err, 'sheet ' + sh.type);
      html = '<div class="sh-head left"><h2 id="sheet-title">Algo salió mal</h2>' + closeBtn() + '</div><p class="muted">No se pudo mostrar esta ventana. Tus datos están a salvo.</p>';
    }
    $('#sheet-body').innerHTML = html;
  }
  const closeBtn = () => '<button class="btn-circle sh-close press" type="button" data-act="sheet-close" aria-label="Cerrar">' + icon('x') + '</button>';

  function sheetDetail(sh) {
    const h = M.habitById(sh.h);
    if (!h) return '<div class="sh-head left"><h2 id="sheet-title">Hábito no encontrado</h2>' + closeBtn() + '</div>';
    const k = S.selected, t = today(), v = M.getVal(h.id, k), g = M.goalOn(h, k), p = M.prog(h, k), st = M.status(h, k);
    const ht = tint(h.color, '#2C2C2E');
    let html = '<div class="sh-head left"><div class="sh-title"><span class="tile dark" style="--tile:' + h.color + '">' + icon(h.icon) + '</span><div><h2 id="sheet-title">' + esc(h.name) + '</h2><p>' + esc(C.relDay(k, t) + ' · ' + (h.type === 'count' ? 'Meta de ' + C.fmt(g) + (h.unit ? ' ' + h.unit : '') : 'Sí o no')) + '</p></div></div>' + closeBtn() + '</div>';
    html += '<div class="inset" style="--hc:' + h.color + ';--ht:' + ht + '">';
    if (h.type === 'count') {
      html += '<div class="big-num"><button class="btn-circle press" type="button" data-act="dec" data-h="' + h.id + '"' + (v <= 0 ? ' disabled' : '') + ' aria-label="Restar ' + C.fmt(h.step) + '">' + icon('minus') + '</button>' +
        '<div class="bn" aria-live="polite"><span class="bn-v">' + C.fmt(v) + '</span><span class="bn-g">de ' + C.fmt(g) + (h.unit ? ' ' + esc(h.unit) : '') + ' · ' + C.pct(p) + '</span></div>' +
        '<button class="btn-circle plus press" type="button" data-act="inc" data-h="' + h.id + '" aria-label="Sumar ' + C.fmt(h.step) + '">' + icon('plus') + '</button></div>';
      html += '<div class="chips">' +
        '<button class="chip press" type="button" data-act="quick" data-h="' + h.id + '" data-v="' + (h.step * 2) + '">+' + C.fmt(h.step * 2) + '</button>' +
        '<button class="chip press" type="button" data-act="quick" data-h="' + h.id + '" data-v="goal">Meta completa</button>' +
        (v > 0 ? '<button class="chip press" type="button" data-act="quick" data-h="' + h.id + '" data-v="zero">Poner en cero</button>' : '') + '</div>';
      html += '<form class="num-form" id="num-form" novalidate><label class="vh" for="num-input">Cantidad exacta</label><input id="num-input" type="number" inputmode="decimal" min="0" max="' + C.LIMITS.value + '" step="any" placeholder="Cantidad exacta"><button class="btn press" type="submit">Guardar</button></form>';
    } else {
      html += '<button class="toggle-big press" type="button" data-act="toggle" data-h="' + h.id + '" aria-pressed="' + (p >= 1) + '">' + icon(p >= 1 ? 'circle-check' : 'check') + (p >= 1 ? 'Hecho' : 'Marcar como hecho') + '</button>';
    }
    html += '</div>';
    if (st === 'fail' || (st === 'pending' && band() === 'night')) {
      const cur = M.getReason(h.id, k);
      html += '<div class="sec-l">' + (st === 'fail' ? '¿Por qué no se cumplió?' : 'Si hoy no se logra, ¿por qué?') + '</div><div class="chips">' + C.REASONS.map((r) => reasonChip(r, cur, h.id, k)).join('') + '</div>';
    }
    const sk = M.streaks(h), from30 = C.maxK(h.start, C.addDays(t, -29)), r30 = M.rate(h, from30, t);
    html += '<div class="stats"><div class="stat"><span class="v" style="color:var(--orange)">' + icon('flame') + sk.cur + '</span><span class="l">Racha actual</span></div><div class="stat"><span class="v">' + icon('trophy') + sk.best + '</span><span class="l">Mejor racha</span></div>' +
      '<div class="stat"><span class="v">' + C.pct(r30.pct) + '</span><span class="l">Últimos 30 días (' + r30.done + '/' + r30.ev + ')</span></div>';
    if (h.type === 'count') {
      let sum = 0, nd = 0;
      if (from30 <= t) C.eachDay(from30, t, (kk) => { if (!M.evaluable(h, kk)) return; sum += M.getVal(h.id, kk); nd++; });
      html += '<div class="stat"><span class="v">' + C.fmt(nd ? sum / nd : 0) + '</span><span class="l">Promedio diario' + (h.unit ? ' (' + esc(h.unit) + ')' : '') + '</span></div>';
    } else {
      html += '<div class="stat"><span class="v">' + M.rate(h, h.start, t).done + '</span><span class="l">Días cumplidos en total</span></div>';
    }
    html += '</div><div class="sec-l">Últimas 15 semanas</div>' + miniHeat(h, 15);
    const rc = M.reasonCounts(C.maxK(h.start, C.addDays(t, -89)), C.addDays(t, -1), h.id);
    if (rc.list.length) {
      html += '<div class="sec-l">Por qué fallas este hábito</div><div class="stack">' + rc.list.slice(0, 4).map((x) => barRow(C.REASON[x.id].icon, h.color, C.REASON[x.id].label, '', x.n / rc.list[0].n, String(x.n))).join('') +
        '<p class="foot-note">Consejo: ' + esc(C.REASON[rc.list[0].id].tip) + '</p></div>';
    }
    html += '<button class="btn press" type="button" data-act="edit-habit" data-h="' + h.id + '">' + icon('pencil') + 'Editar hábito</button>';
    return html;
  }
  function reasonChip(r, cur, hid, k) {
    return '<button class="chip press" type="button" data-act="reason" data-h="' + hid + '" data-k="' + k + '" data-r="' + r.id + '" aria-pressed="' + (cur === r.id) + '">' + icon(r.icon) + esc(r.label) + '</button>';
  }
  function sheetReasons(sh) {
    let html = '<div class="sh-head left"><h2 id="sheet-title">¿Qué pasó?</h2>' + closeBtn() + '</div><p class="sh-lead">Elige un motivo. Saber por qué fallas te ayuda a ver el patrón.</p>';
    const t = today();
    const items = sh.entries.map((e) => {
      const h = M.habitById(e.h);
      if (!h) return '';
      const v = M.getVal(h.id, e.k), cur = M.getReason(h.id, e.k);
      return '<div class="rs-item"><div class="rs-head"><span class="tile sm dark" style="--tile:' + h.color + '">' + icon(h.icon) + '</span>' + esc(C.relDay(e.k, t)) + ' · ' + esc(h.name) + (h.type === 'count' ? ' <span class="muted">' + C.fmt(v) + ' de ' + C.fmt(M.goalOn(h, e.k)) + '</span>' : '') + '</div><div class="chips" role="group" aria-label="Motivo">' + C.REASONS.map((r) => reasonChip(r, cur, h.id, e.k)).join('') + '</div></div>';
    }).join('');
    return html + (items || '<p class="muted">No hay fallas pendientes.</p>') + '<button class="btn primary press" type="button" data-act="sheet-close">Listo</button>';
  }
  function sheetEdit(sh) {
    const d = sh.draft, isNew = !sh.id;
    let html = '<div class="sh-head">' + closeBtn() + '<h2 id="sheet-title">' + (isNew ? 'Nuevo hábito' : 'Editar hábito') + '</h2><button class="btn-circle primary press" type="submit" form="edit-form" aria-label="Guardar">' + icon('check') + '</button></div>';
    html += '<form class="form" id="edit-form" novalidate>';
    html += '<div class="field-group"><div class="frow"><label class="vh" for="f-name">Nombre</label><input class="left" id="f-name" maxlength="' + C.LIMITS.name + '" value="' + esc(d.name) + '" placeholder="Nombre del hábito" autocomplete="off" enterkeyhint="done"' + (isNew ? ' data-autofocus' : '') + '></div></div>';
    html += '<div><div class="sec-l" style="margin-bottom:8px">Ícono</div><div class="field-group"><div class="icon-grid" role="group" aria-label="Ícono">' + HABIT_ICONS.map((n) => '<button type="button" class="ico" data-act="draft-icon" data-v="' + n + '" aria-pressed="' + (d.icon === n) + '" aria-label="' + n + '" style="--sel:' + d.color + '">' + icon(n) + '</button>').join('') + '</div></div></div>';
    html += '<div><div class="sec-l" style="margin-bottom:8px">Color</div><div class="field-group"><div class="colors" role="group" aria-label="Color">' + C.COLORS.map((c) => '<button type="button" class="sw" style="--sw:' + c.hex + '" data-act="draft-color" data-v="' + c.hex + '" aria-pressed="' + (d.color === c.hex) + '" aria-label="' + c.name + '">' + icon('check') + '</button>').join('') + '</div></div></div>';
    html += '<div><div class="sec-l" style="margin-bottom:8px">Cómo se registra</div><div class="seg" role="radiogroup" aria-label="Cómo se registra">' +
      '<button type="button" role="radio" data-act="draft-type" data-v="check" aria-checked="' + (d.type === 'check') + '">Sí o no</button>' +
      '<button type="button" role="radio" data-act="draft-type" data-v="count" aria-checked="' + (d.type === 'count') + '">Con meta numérica</button></div></div>';
    if (d.type === 'count') {
      html += '<div class="field-group">' +
        '<div class="frow"><label for="f-goal">Meta diaria</label><input id="f-goal" type="number" inputmode="decimal" min="0" max="' + C.LIMITS.value + '" step="any" value="' + esc(d.goal) + '"></div>' +
        '<div class="frow"><label for="f-unit">Unidad</label><input id="f-unit" maxlength="' + C.LIMITS.unit + '" value="' + esc(d.unit) + '" placeholder="min, págs, vasos"></div>' +
        '<div class="frow"><label for="f-step">Cada toque suma</label><input id="f-step" type="number" inputmode="decimal" min="0" max="' + C.LIMITS.value + '" step="any" value="' + esc(d.step) + '"></div></div>' +
        '<p class="hint">Si cambias la meta, los días anteriores conservan la meta que tenían.</p>';
    } else html += '<p class="hint" style="margin-top:-14px">Un toque lo marca como hecho para ese día.</p>';
    if (sh.error) html += '<p class="err" role="alert">' + icon('circle-alert') + esc(sh.error) + '</p>';
    html += '<button class="btn primary press" type="submit">' + (isNew ? 'Agregar hábito' : 'Guardar cambios') + '</button></form>';
    if (!isNew) {
      if (sh.confirmDelete) html += '<div class="confirm" role="alertdialog" aria-label="Confirmar borrado"><p>¿Borrar “' + esc(d.name) + '” para siempre? Desaparece de tus estadísticas. Si solo quieres dejarlo, archívalo.</p><button class="btn destructive press" type="button" data-act="del-confirm">Borrar hábito</button><button class="btn press" type="button" data-act="del-cancel">Cancelar</button></div>';
      else html += '<div class="stack"><button class="btn press" type="button" data-act="archive">' + icon('archive') + 'Archivar hábito</button><p class="hint" style="margin-top:-4px;text-align:center">Lo oculta desde hoy y conserva su historial.</p><button class="btn plain-red press" type="button" data-act="del-ask">' + icon('trash-2') + 'Borrar hábito</button></div>';
    }
    return html;
  }
  function sheetImport(sh) {
    let html = '<div class="sh-head left"><h2 id="sheet-title">Importar respaldo</h2>' + closeBtn() + '</div><p class="sh-lead">Pega el texto del respaldo o elige el archivo .json.</p>';
    html += '<label class="vh" for="imp-text">Texto del respaldo</label><textarea id="imp-text" rows="6" spellcheck="false" placeholder="{&quot;app&quot;:&quot;constancia&quot;, …}">' + esc(sh.text || '') + '</textarea>';
    html += '<label class="btn press" for="imp-file">' + icon('upload') + 'Elegir archivo</label><input id="imp-file" class="vh" type="file" accept=".json,application/json,text/plain">';
    if (sh.error) html += '<p class="err" role="alert">' + icon('circle-alert') + esc(sh.error) + '</p>';
    if (sh.parsed) {
      const s = sh.parsed.summary;
      html += '<div class="confirm" role="alertdialog" aria-label="Confirmar importación"><p>Respaldo' + (s.exportedAt ? ' del ' + esc(C.shortDate(s.exportedAt)) : '') + ' con ' + C.plural(s.habits, 'hábito', 'hábitos') + ' y ' + C.plural(s.days, 'día registrado', 'días registrados') + '. <b>Reemplaza tus datos actuales.</b></p><button class="btn primary press" type="button" data-act="imp-apply">Reemplazar mis datos</button><button class="btn press" type="button" data-act="imp-cancel">Cancelar</button></div>';
    } else html += '<button class="btn primary press" type="button" data-act="imp-check">Revisar respaldo</button>';
    return html;
  }
  function sheetExport(sh) {
    return '<div class="sh-head left"><h2 id="sheet-title">Tu respaldo</h2>' + closeBtn() + '</div><p class="sh-lead">Selecciona todo el texto, cópialo y guárdalo en Notas o en tu correo.</p><label class="vh" for="exp-text">Respaldo</label><textarea id="exp-text" rows="10" readonly spellcheck="false">' + esc(sh.text) + '</textarea>';
  }
  function sheetHowto() {
    const c = cfg(), names = M.activeHabits().map((h) => h.name).join(', ');
    return '<div class="sh-head left"><h2 id="sheet-title">Notificaciones</h2>' + closeBtn() + '</div><p class="sh-lead">La app te muestra el plan y el cierre del día a tus horas. Para que el iPhone te avise sin abrirla, crea dos automatizaciones en la app Atajos.</p>' +
      '<ol class="steps"><li>Abre <b>Atajos</b>, ve a <b>Automatización</b> y toca <b>+</b>.</li><li>Elige <b>Hora del día</b>, pon <b>' + esc(c.settings.morning) + '</b>, <b>Diariamente</b> y <b>Ejecutar inmediatamente</b>.</li>' +
      '<li>Agrega la acción <b>Mostrar notificación</b> con el texto <code>Plan de hoy: ' + esc(names) + '</code>.</li><li>Repite con <b>' + esc(c.settings.night) + '</b> y el texto <code>Cierra tu día en Constancia</code>.</li></ol>' +
      '<p class="foot-note">En la app nativa (etapa 2) los avisos vienen integrados y el de la noche solo llega si te falta algo.</p>';
  }
  function sheetDiag() {
    const rows = [['Versión', C.VERSION + ' (datos v' + C.SCHEMA + ')'], ['Almacenamiento', Store.mode === 'db' ? 'Cuenta de Claude' : Store.mode === 'local' ? 'Este dispositivo' : 'Solo memoria'], ['Estado', syncText()], ['Conexión', navigator.onLine === false ? 'Sin conexión' : 'En línea'], ['Hábitos', String(M.habits().length)], ['Meses con registros', String(Object.keys(S.real.months).length)]];
    let html = '<div class="sh-head left"><h2 id="sheet-title">Diagnóstico</h2>' + closeBtn() + '</div><dl class="kv">' + rows.map((r) => '<dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd>').join('') + '</dl>';
    html += '<div class="sec-l">Eventos recientes</div>' + (Diag.errors.length ? '<ul class="err-list">' + Diag.errors.slice().reverse().map((e) => '<li>' + esc(e.at.slice(11, 19) + ' · ' + e.ctx + ' · ' + e.msg) + '</li>').join('') + '</ul>' : '<p class="muted">Sin errores en esta sesión.</p>');
    html += '<button class="btn press" type="button" data-act="diag-copy">' + icon('copy') + 'Copiar diagnóstico</button><p class="foot-note">El diagnóstico no incluye tus hábitos ni tus registros.</p>';
    return html;
  }

  /* Arrastrar la hoja hacia abajo para cerrarla */
  (function enableDrag() {
    let startY = null, dy = 0;
    document.addEventListener('pointerdown', (e) => {
      if (!S.sheet || !e.target.closest('.sheet-grab')) return;
      startY = e.clientY; dy = 0;
      $('#sheet').classList.add('dragging');
      e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId);
    });
    document.addEventListener('pointermove', (e) => {
      if (startY == null) return;
      dy = Math.max(0, e.clientY - startY);
      $('#sheet .sheet-panel').style.transform = 'translateY(' + dy + 'px)';
    });
    const end = () => {
      if (startY == null) return;
      startY = null;
      $('#sheet').classList.remove('dragging');
      $('#sheet .sheet-panel').style.transform = '';
      if (dy > 110) closeSheet();
    };
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
  })();

  /* ═════════════ Respaldo ═════════════ */
  const exportText = () => C.serializeBackup(realData(), new Date().toISOString());
  function copyText(text, okMsg) {
    const fallback = () => {
      openSheet({ type: 'export', text: text });
      setTimeout(() => { const ta = document.getElementById('exp-text'); if (ta) { ta.focus(); ta.select(); } }, 400);
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => hud(okMsg, 'copy'), fallback);
      else fallback();
    } catch (e) { fallback(); }
  }
  function downloadBackup() {
    const json = exportText(), name = 'constancia-respaldo-' + today() + '.json';
    if (Store.mode === 'db') {
      if (!Store.downloads) return copyText(json, 'Respaldo copiado');
      Store.downloads.save({ filename: name, data: json }).then(() => hud('Respaldo listo', 'download'), (e) => {
        if (e && e.code === 'declined') return;
        Diag.report(e, 'download');
        copyText(json, 'Respaldo copiado');
      });
      return;
    }
    try {
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      hud('Respaldo descargado', 'download');
    } catch (e) { Diag.report(e, 'download'); copyText(json, 'Respaldo copiado'); }
  }
  function applyImport(parsed) {
    S.demo = null;
    const old = Object.keys(S.real.months);
    S.real.config = parsed.data.config;
    S.real.months = parsed.data.months;
    pendingDefault = null;
    Store.replace('config');
    Object.keys(S.real.months).forEach((ym) => Store.replace('m-' + ym));
    old.forEach((ym) => { if (!S.real.months[ym]) Store.remove('m-' + ym); });
    S.selected = today();
  }

  /* ═════════════ Acciones ═════════════ */
  const WRITES = { toggle: 1, inc: 1, dec: 1, quick: 1, reason: 1, 'new-habit': 1, 'edit-habit': 1, move: 1, restore: 1, 'import-open': 1, archive: 1, 'del-confirm': 1 };
  function changeVal(h, k, nv) {
    const before = M.prog(h, k), wasPerfect = M.daySummary(k).perfect;
    setVal(h, k, nv);
    const after = M.prog(h, k), s = M.daySummary(k);
    if (before < 1 && after >= 1) {
      if (s.perfect && !wasPerfect) { hud('¡Día perfecto! ' + s.total + ' de ' + s.total, 'trophy'); S.celebrate = true; }
      else hud(h.name + ' cumplido', 'circle-check');
    }
    render();
  }
  function readDraft() {
    const sh = S.sheet;
    if (!sh || sh.type !== 'edit') return;
    const v = (id) => { const el = document.getElementById(id); return el ? el.value : null; };
    [['f-name', 'name'], ['f-goal', 'goal'], ['f-unit', 'unit'], ['f-step', 'step']].forEach((p) => { const x = v(p[0]); if (x != null) sh.draft[p[1]] = x; });
  }
  const num = (s) => parseFloat(String(s == null ? '' : s).replace(',', '.'));
  function uniqueId(name) {
    const base = (C.sanitizeId(String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '-')) || 'habito').slice(0, 20);
    let id = base, n = 2;
    while (M.habitById(id)) id = base + '-' + n++;
    return id;
  }
  function saveEdit() {
    readDraft();
    const sh = S.sheet, d = sh.draft, t = today();
    const name = C.cleanText(d.name, C.LIMITS.name);
    const fail = (msg, field) => { sh.error = msg; renderSheet(); const f = document.getElementById(field); if (f) f.focus(); };
    if (!name) return fail('Ponle un nombre al hábito.', 'f-name');
    const dup = M.habits().find((x) => x.id !== sh.id && x.name.toLowerCase() === name.toLowerCase());
    if (dup) return fail('Ya tienes un hábito llamado “' + dup.name + '”.', 'f-name');
    let goal = num(d.goal), step = num(d.step);
    if (d.type === 'count') {
      if (!(goal > 0) || goal > C.LIMITS.value) return fail('La meta diaria debe ser un número mayor que cero.', 'f-goal');
      if (!(step > 0) || step > C.LIMITS.value) step = Math.max(1, Math.round(goal / 4));
    }
    const c = cfg();
    if (sh.id) {
      const h = M.habitById(sh.id);
      if (!h) return closeSheet();
      h.name = name; h.icon = d.icon; h.color = d.color;
      if (d.type === 'count') {
        h.type = 'count'; h.unit = C.cleanText(d.unit, C.LIMITS.unit); h.step = step;
        h.goals = (h.goals || []).filter((x) => x.from < t);
        const prev = h.goals.length ? h.goals[h.goals.length - 1].goal : null;
        if (prev !== goal) h.goals.push({ from: h.goals.length ? t : h.start, goal: goal });
      } else { h.type = 'check'; h.unit = ''; h.step = 1; h.goals = []; }
    } else {
      if (M.activeHabits().length >= C.LIMITS.habits) return fail('Llegaste al máximo de ' + C.LIMITS.habits + ' hábitos activos.', 'f-name');
      c.habits.push({ id: uniqueId(name), name: name, icon: d.icon, color: d.color, type: d.type, unit: d.type === 'count' ? C.cleanText(d.unit, C.LIMITS.unit) : '', step: d.type === 'count' ? step : 1, goals: d.type === 'count' ? [{ from: t, goal: goal }] : [], start: t });
    }
    saveConfig();
    const isNew = !sh.id;
    closeSheet(); render();
    hud(isNew ? 'Hábito agregado' : 'Cambios guardados');
  }
  function openEdit(h) {
    const t = today(), used = M.habits().map((x) => x.color);
    const free = (C.COLORS.find((c) => used.indexOf(c.hex) < 0) || C.COLORS[0]).hex;
    openSheet({ type: 'edit', id: h ? h.id : null, draft: h
      ? { name: h.name, icon: h.icon, color: h.color, type: h.type, goal: h.type === 'count' ? M.goalOn(h, t) : 30, unit: h.unit || 'min', step: h.type === 'count' ? h.step : 10 }
      : { name: '', icon: 'star', color: free, type: 'check', goal: 30, unit: 'min', step: 10 } });
  }
  function diagText() {
    return JSON.stringify({ app: 'constancia', version: C.VERSION, schema: C.SCHEMA, mode: Store.mode, sync: S.sync, online: navigator.onLine, habits: M.habits().length, months: Object.keys(S.real.months).length, ua: navigator.userAgent, errors: Diag.errors }, null, 2);
  }

  function handleAction(el) {
    const a = el.getAttribute('data-act'), hid = el.getAttribute('data-h'), h = hid ? M.habitById(hid) : null;
    const k = el.getAttribute('data-k') || S.selected, t = today();
    if (WRITES[a] && !canWrite()) return;
    switch (a) {
      case 'tab': {
        const v = el.getAttribute('data-v');
        if (v === S.view && v === 'hoy') S.selected = t;
        if (v === 'hist' && S.view !== 'hist') S.histMonth = C.ymOf(S.selected);
        S.view = v; window.scrollTo(0, 0); render();
        $('#view').focus({ preventScroll: true });
        break;
      }
      case 'day': S.selected = k; render(); break;
      case 'go-today': S.selected = t; render(); break;
      case 'week': S.selected = C.minK(C.addDays(S.selected, Number(el.getAttribute('data-d'))), t); render(); break;
      case 'toggle': if (h) changeVal(h, S.selected, M.getVal(h.id, S.selected) >= 1 ? 0 : 1); break;
      case 'inc': if (h) changeVal(h, S.selected, M.getVal(h.id, S.selected) + h.step); break;
      case 'dec': if (h) changeVal(h, S.selected, Math.max(0, M.getVal(h.id, S.selected) - h.step)); break;
      case 'quick': if (h) { const q = el.getAttribute('data-v'), cur = M.getVal(h.id, S.selected); changeVal(h, S.selected, q === 'goal' ? Math.max(cur, M.goalOn(h, S.selected)) : q === 'zero' ? 0 : cur + Number(q)); } break;
      case 'detail': if (h) openSheet({ type: 'detail', h: h.id }); break;
      case 'why': if (h) openSheet({ type: 'reasons', entries: [{ k: k, h: h.id }] }); break;
      case 'reasons-day': openSheet({ type: 'reasons', entries: M.habitsForDay(k).filter((x) => M.status(x, k) === 'fail').map((x) => ({ k: k, h: x.id })) }); break;
      case 'reasons-pending': openSheet({ type: 'reasons', entries: M.pendingReasons(7) }); break;
      case 'reasons-today': openSheet({ type: 'reasons', entries: M.activeHabits().filter((x) => M.status(x, t) === 'pending').map((x) => ({ k: t, h: x.id })) }); break;
      case 'reason': if (h) { const r = el.getAttribute('data-r'); setReason(h, k, M.getReason(h.id, k) === r ? null : r); render(); renderSheet(); } break;
      case 'sheet-close': closeSheet(); break;
      case 'hist-mode': S.histMode = el.getAttribute('data-v'); render(); break;
      case 'hist-month': { const nm = C.addMonths(S.histMonth, Number(el.getAttribute('data-d'))); if (nm <= C.ymOf(t)) S.histMonth = nm; render(); break; }
      case 'hist-habit': S.histHabit = hid || 'all'; render(); break;
      case 'cal-day': S.selected = k; S.view = 'hoy'; window.scrollTo(0, 0); render(); break;
      case 'new-habit': openEdit(null); break;
      case 'edit-habit': if (h) openEdit(h); break;
      case 'draft-icon': readDraft(); S.sheet.draft.icon = el.getAttribute('data-v'); renderSheet(); break;
      case 'draft-color': readDraft(); S.sheet.draft.color = el.getAttribute('data-v'); renderSheet(); break;
      case 'draft-type': readDraft(); S.sheet.draft.type = el.getAttribute('data-v'); S.sheet.error = ''; renderSheet(); break;
      case 'archive': { const x = M.habitById(S.sheet.id); if (x) { x.archivedAt = t; saveConfig(); closeSheet(); render(); hud('Hábito archivado', 'archive'); } break; }
      case 'del-ask': readDraft(); S.sheet.confirmDelete = true; renderSheet(); break;
      case 'del-cancel': S.sheet.confirmDelete = false; renderSheet(); break;
      case 'del-confirm': { const id = S.sheet.id, c = cfg(); c.habits = c.habits.filter((x) => x.id !== id); if (S.histHabit === id) S.histHabit = 'all'; saveConfig(); closeSheet(); render(); hud('Hábito borrado', 'trash-2'); break; }
      case 'restore': if (h) { delete h.archivedAt; saveConfig(); render(); hud('Hábito restaurado', 'rotate-ccw'); } break;
      case 'move': if (h) {
        const list = cfg().habits, act = M.activeHabits(), i = act.indexOf(h), j = i + Number(el.getAttribute('data-d'));
        if (j >= 0 && j < act.length) { const ia = list.indexOf(h), ib = list.indexOf(act[j]); list[ia] = act[j]; list[ib] = h; saveConfig(); render(); }
      } break;
      case 'howto': openSheet({ type: 'howto' }); break;
      case 'diag': openSheet({ type: 'diag' }); break;
      case 'diag-copy': copyText(diagText(), 'Diagnóstico copiado'); break;
      case 'export-copy': copyText(exportText(), 'Respaldo copiado'); break;
      case 'export-dl': downloadBackup(); break;
      case 'import-open': openSheet({ type: 'import', text: '' }); break;
      case 'imp-check': { const ta = document.getElementById('imp-text'); S.sheet.text = ta ? ta.value : ''; const res = C.parseBackup(S.sheet.text, t, HABIT_ICONS); S.sheet.error = res.error || ''; S.sheet.parsed = res.data ? res : null; renderSheet(); break; }
      case 'imp-cancel': S.sheet.parsed = null; renderSheet(); break;
      case 'imp-apply': if (S.sheet && S.sheet.parsed) { applyImport(S.sheet.parsed); closeSheet(); render(); hud('Respaldo importado', 'upload'); } break;
      case 'demo-on': S.demo = C.buildDemo(t); S.demo.config = C.normalizeConfig(S.demo.config, t, HABIT_ICONS); S.selected = t; window.scrollTo(0, 0); render(); hud('Modo ejemplo activado', 'sparkles'); break;
      case 'demo-off': S.demo = null; S.selected = t; window.scrollTo(0, 0); render(); break;
      case 'retry-sync': Store.retryAll(); break;
      case 'dismiss': delete S.notices[el.getAttribute('data-v')]; renderBanners(); break;
      case 'fault-retry': S.fault = false; render(); break;
      case 'sw-update': if (S.swUpdate) { S.swUpdate.postMessage('skipWaiting'); } break;
      default: break;
    }
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    try { handleAction(el); }
    catch (err) { Diag.report(err, 'acción ' + el.getAttribute('data-act')); hud('No se pudo completar la acción', 'triangle-alert', true); try { render(); } catch (x) { /* render ya informa */ } }
  });
  document.addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      if (e.target.id === 'edit-form') return saveEdit();
      if (e.target.id === 'num-form') {
        const inp = document.getElementById('num-input'), n = num(inp.value), h = S.sheet && M.habitById(S.sheet.h);
        if (!h) return;
        if (!(n >= 0) || n > C.LIMITS.value) { hud('Escribe un número entre 0 y ' + C.fmt(C.LIMITS.value), 'circle-alert', true); return; }
        if (!canWrite()) return;
        inp.blur(); changeVal(h, S.selected, n);
      }
    } catch (err) { Diag.report(err, 'formulario'); hud('No se pudo guardar', 'triangle-alert', true); }
  });
  document.addEventListener('change', (e) => {
    const id = e.target.id;
    try {
      if (id === 'set-morning' || id === 'set-night') {
        const v = e.target.value;
        if (!C.isTime(v)) { hud('Elige una hora válida', 'circle-alert', true); return; }
        if (!canWrite()) return;
        cfg().settings[id === 'set-morning' ? 'morning' : 'night'] = v;
        saveConfig(); hud('Horario guardado', 'clock');
      }
      if (id === 'imp-file' && e.target.files && e.target.files[0]) {
        const f = e.target.files[0];
        if (f.size > C.LIMITS.backupChars) { S.sheet.error = 'El archivo es demasiado grande para ser un respaldo.'; renderSheet(); return; }
        const rd = new FileReader();
        rd.onload = () => {
          if (!S.sheet || S.sheet.type !== 'import') return;
          S.sheet.text = String(rd.result || '');
          const res = C.parseBackup(S.sheet.text, today(), HABIT_ICONS);
          S.sheet.error = res.error || ''; S.sheet.parsed = res.data ? res : null; renderSheet();
        };
        rd.onerror = () => { if (S.sheet) { S.sheet.error = 'No se pudo leer el archivo.'; renderSheet(); } };
        rd.readAsText(f);
      }
    } catch (err) { Diag.report(err, 'cambio ' + id); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.sheet) closeSheet(); });
  window.addEventListener('storage', (e) => { if (e.key === LS_KEY && e.newValue && Store.mode === 'local' && !Store.lsTimer) Store.reloadFromOtherTab(e.newValue); });
  window.addEventListener('online', () => Store.retryAll());
  window.addEventListener('pagehide', () => Store.flushLocal());
  let lastScrolled = false;
  window.addEventListener('scroll', () => {
    const s = window.scrollY > 52;
    if (s !== lastScrolled) { lastScrolled = s; document.body.classList.toggle('scrolled', s); }
  }, { passive: true });

  /* ═════════════ Arranque ═════════════ */
  function mountChrome() {
    const tabs = [['hoy', 'Hoy', null], ['hist', 'Historial', 'calendar-days'], ['ana', 'Análisis', 'chart-column'], ['aj', 'Ajustes', 'settings']];
    const ringsIcon = '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" opacity=".35"/><path d="M12 3a9 9 0 1 1-8.4 5.8"/><circle cx="12" cy="12" r="4.3" opacity=".35"/><path d="M12 7.7a4.3 4.3 0 1 1-4.3 4.3"/></svg>';
    $('#tabbar').innerHTML = '<div class="tabbar-glass">' + tabs.map((x) => '<button class="tab" type="button" data-act="tab" data-v="' + x[0] + '">' + (x[2] ? icon(x[2]) : ringsIcon) + '<span>' + x[1] + '</span></button>').join('') + '</div>';
  }
  function registerSW() {
    if (window.claude || !('serviceWorker' in navigator) || !(location.protocol === 'https:' || location.hostname === 'localhost')) return;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      const watch = (w) => { if (!w) return; w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) { S.swUpdate = w; renderBanners(); } }); };
      if (reg.waiting && navigator.serviceWorker.controller) { S.swUpdate = reg.waiting; renderBanners(); }
      reg.addEventListener('updatefound', () => watch(reg.installing));
    }).catch((e) => Diag.report(e, 'service-worker', true));
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (S.swUpdate && !reloading) { reloading = true; location.reload(); } });
  }
  function start(saved) {
    if (C.isObj(saved)) {
      ['view', 'selected', 'histMode', 'histMonth', 'histHabit'].forEach((key) => { if (typeof saved[key] === 'string') S[key] = saved[key]; });
      if (!TITLES[S.view]) S.view = 'hoy';
      if (!C.isDateKey(S.selected) || S.selected > today()) S.selected = today();
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(S.histMonth)) S.histMonth = C.ymOf(today());
      if (S.histMode !== 'mes' && S.histMode !== 'anio') S.histMode = 'mes';
    }
    mountChrome();
    render();
    Store.init().catch((e) => { Diag.report(e, 'init'); S.loaded = true; render(); });
    registerSW();
    let lastToday = today(), lastBand = band();
    const tick = () => {
      const t = today(), b = band();
      if (t !== lastToday) { if (S.selected === lastToday) S.selected = t; lastToday = t; render(); }
      else if (b !== lastBand && S.view === 'hoy') render();
      lastBand = b;
    };
    setInterval(tick, 60000);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) Store.flushLocal();
      else { tick(); if (Store.pending()) Store.retryAll(); }
    });
  }
  const hot = window.claude && window.claude.hot;
  try { if (hot && typeof hot.snapshot === 'function') hot.snapshot(() => ({ view: S.view, selected: S.selected, histMode: S.histMode, histMonth: S.histMonth, histHabit: S.histHabit })); } catch (e) { Diag.report(e, 'hot', true); }
  if (hot && typeof hot.ready === 'function') { try { hot.ready(start); } catch (e) { start({}); } }
  else start((hot && hot.data) || {});
})();
