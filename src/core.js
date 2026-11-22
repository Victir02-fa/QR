/* Constancia · núcleo de lógica.
   Sin acceso al DOM ni al almacenamiento: fechas, validación de datos, métricas, hallazgos y datos de ejemplo.
   Lo usan la app (src/app.js) y las pruebas (tests/core.test.mjs). */
(function (root, factory) {
  'use strict';
  var api = factory();
  root.ConstanciaCore = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '2.0.0';
  var SCHEMA = 2;
  var LIMITS = { habits: 12, name: 40, unit: 12, value: 100000, backupChars: 5 * 1024 * 1024 };

  /* ───────────── Fechas ─────────────
     Un día es una clave "AAAA-MM-DD" en la hora local del usuario.
     La aritmética se hace sobre días UTC, así el horario de verano nunca mueve una fecha. */
  function pad(n) { return String(n).padStart(2, '0'); }
  function keyOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function dayNum(k) { var p = String(k).split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5); }
  function fromNum(n) { var d = new Date(n * 864e5); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  var DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  function isDateKey(k) { return typeof k === 'string' && DATE_RE.test(k) && fromNum(dayNum(k)) === k; }
  function addDays(k, n) { return fromNum(dayNum(k) + n); }
  function dow(k) { return (((dayNum(k) + 3) % 7) + 7) % 7; } // 0 = lunes … 6 = domingo
  function weekStart(k) { return addDays(k, -dow(k)); }
  function ymOf(k) { return k.slice(0, 7); }
  function ddOf(k) { return k.slice(8, 10); }
  function addMonths(ym, n) {
    var p = ym.split('-').map(Number), m = p[1] - 1 + n, y = p[0] + Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return y + '-' + pad(m + 1);
  }
  function daysInMonth(ym) { var p = ym.split('-').map(Number); return new Date(Date.UTC(p[0], p[1], 0)).getUTCDate(); }
  function minK(a, b) { return a < b ? a : b; }
  function maxK(a, b) { return a > b ? a : b; }
  function eachDay(a, b, fn) { for (var n = dayNum(a), e = dayNum(b); n <= e; n++) fn(fromNum(n)); }
  function isTime(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
  function minutesOf(s) { var p = String(s).split(':').map(Number); return (p[0] || 0) * 60 + (p[1] || 0); }

  var DOW_SHORT = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  var DOW = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  var DOW_PLURAL = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos'];
  var MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function longDate(k) { var p = k.split('-').map(Number); return DOW[dow(k)] + ', ' + p[2] + ' de ' + MONTHS[p[1] - 1]; }
  function shortDate(k) { var p = k.split('-').map(Number); return p[2] + ' ' + MONTHS_SHORT[p[1] - 1]; }
  function relDay(k, today) {
    var diff = dayNum(today) - dayNum(k);
    if (diff === 0) return 'Hoy';
    if (diff === 1) return 'Ayer';
    if (diff > 1 && diff < 7) return cap(DOW[dow(k)]);
    return shortDate(k);
  }

  /* ───────────── Formato ───────────── */
  function fmt(v) { return (Math.round(v * 10) / 10).toLocaleString('es-MX', { maximumFractionDigits: 1 }); }
  function pct(x) { return x == null || !isFinite(x) ? '—' : Math.round(x * 100) + '%'; }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  /* ───────────── Catálogos ───────────── */
  var REASONS = [
    { id: 'tiempo', icon: 'clock', label: 'Falta de tiempo', tip: 'Agéndalo como una cita en tu calendario o haz una versión corta: 10 minutos cuentan.' },
    { id: 'cansancio', icon: 'battery-low', label: 'Cansancio', tip: 'Muévelo a la hora en que tienes más energía, por ejemplo temprano en la mañana.' },
    { id: 'olvido', icon: 'bell-off', label: 'Se me olvidó', tip: 'Amárralo a algo que ya haces, como “después del café leo 10 páginas”, y activa el aviso de la mañana.' },
    { id: 'ganas', icon: 'meh', label: 'Sin ganas', tip: 'Ponte una meta de dos minutos. Lo difícil es empezar; casi siempre sigues.' },
    { id: 'antojo', icon: 'cookie', label: 'Antojo o tentación', tip: 'No tengas a la mano lo que te tienta y deja lista una alternativa: fruta, té o chicle sin azúcar.' },
    { id: 'social', icon: 'party-popper', label: 'Evento o salida', tip: 'Decide antes de salir qué vas a comer y a qué hora vas a cumplir ese día.' },
    { id: 'salud', icon: 'thermometer', label: 'Enfermedad', tip: 'Descansar también es parte del proceso. Retómalo en cuanto te sientas bien.' },
    { id: 'otro', icon: 'ellipsis', label: 'Otro', tip: 'Fíjate qué tienen en común esos días para encontrar el patrón.' }
  ];
  var REASON = {};
  REASONS.forEach(function (r) { REASON[r.id] = r; });

  var COLORS = [
    { hex: '#FA114F', name: 'Rojo' }, { hex: '#A6FF00', name: 'Lima' }, { hex: '#00D8FF', name: 'Cian' },
    { hex: '#BF5AF2', name: 'Morado' }, { hex: '#FF9F0A', name: 'Naranja' }, { hex: '#FFD60A', name: 'Amarillo' },
    { hex: '#0A84FF', name: 'Azul' }, { hex: '#FF6FB5', name: 'Rosa' }
  ];

  // Migración de la versión 1, que usaba emojis como íconos.
  var EMOJI_ICON = {
    '🏃': 'footprints', '🏋️': 'dumbbell', '🏋': 'dumbbell', '🚴': 'bike', '🧘': 'flower-2', '🥗': 'salad', '🍎': 'apple',
    '💧': 'droplet', '📖': 'book-open', '📚': 'library', '✍️': 'pen-line', '✍': 'pen-line', '🧠': 'brain', '🚫': 'ban',
    '🍬': 'candy-off', '☕': 'coffee', '😴': 'moon', '🛏️': 'bed', '🛏': 'bed', '🦷': 'sparkles', '💊': 'pill',
    '🚶': 'footprints', '🎸': 'guitar', '💻': 'laptop', '🙏': 'heart', '📵': 'smartphone', '💰': 'wallet', '⭐': 'star'
  };
  var DEFAULT_ICON_BY_ID = { ejercicio: 'dumbbell', saludable: 'salad', leer: 'book-open', sinazucar: 'candy-off' };

  /* ───────────── Color y contraste (WCAG 2.2) ───────────── */
  function hexToRgb(hex) { var n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function luminance(hex) {
    var c = hexToRgb(hex).map(function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) { var la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
  function mixWhite(hex, t) {
    var c = hexToRgb(hex).map(function (v) { return Math.round(v + (255 - v) * t); });
    return '#' + c.map(function (v) { return pad(v.toString(16)); }).join('').toUpperCase();
  }
  // Variante del color de un hábito que se puede leer como texto sobre el fondo dado (≥ 4.5:1).
  function readableOn(hex, bg) {
    for (var t = 0; t <= 1.0001; t += 0.05) { var c = mixWhite(hex, Math.min(t, 1)); if (contrast(c, bg) >= 4.5) return c; }
    return '#FFFFFF';
  }

  /* ───────────── Validación ───────────── */
  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function cleanText(s, max) {
    return Array.from(String(s == null ? '' : s).replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, max).join('');
  }
  function sanitizeId(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32); }
  function sanitizeColor(c) { return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c.toUpperCase() : '#0A84FF'; }
  function finiteIn(v, min, max, fallback) { v = Number(v); return isFinite(v) && v >= min ? Math.min(v, max) : fallback; }
  function migrateIcon(icon, id, known) {
    if (typeof icon === 'string' && known.indexOf(icon) >= 0) return icon;
    if (DEFAULT_ICON_BY_ID[id] && (icon === undefined || EMOJI_ICON[icon])) return DEFAULT_ICON_BY_ID[id];
    if (typeof icon === 'string' && EMOJI_ICON[icon]) return EMOJI_ICON[icon];
    return 'star';
  }

  function normalizeHabit(h, today, used, known) {
    if (!isObj(h)) return null;
    var base = sanitizeId(h.id) || 'habito', id = base, n = 2;
    while (used[id]) id = base + '-' + n++;
    used[id] = true;
    var start = isDateKey(h.start) ? h.start : today;
    var type = h.type === 'count' ? 'count' : 'check';
    var o = {
      id: id,
      name: cleanText(h.name, LIMITS.name) || 'Hábito',
      icon: migrateIcon(h.icon, base, known),
      color: sanitizeColor(h.color),
      type: type,
      unit: type === 'count' ? cleanText(h.unit, LIMITS.unit) : '',
      step: type === 'count' ? finiteIn(h.step, 0.1, LIMITS.value, 1) : 1,
      goals: [],
      start: start
    };
    if (type === 'count') {
      var byDate = {};
      (Array.isArray(h.goals) ? h.goals : []).forEach(function (g) {
        if (isObj(g) && isDateKey(g.from) && Number(g.goal) > 0 && isFinite(Number(g.goal))) byDate[g.from] = Math.min(Number(g.goal), LIMITS.value);
      });
      o.goals = Object.keys(byDate).sort().map(function (k) { return { from: k, goal: byDate[k] }; });
      if (!o.goals.length) o.goals = [{ from: start, goal: 1 }];
    }
    if (isDateKey(h.archivedAt)) o.archivedAt = h.archivedAt;
    return o;
  }

  function normalizeConfig(c, today, knownIcons) {
    var known = knownIcons || [];
    if (!isObj(c)) c = {};
    var used = {};
    var habits = (Array.isArray(c.habits) ? c.habits : [])
      .map(function (h) { return normalizeHabit(h, today, used, known); })
      .filter(Boolean)
      .slice(0, LIMITS.habits);
    var s = isObj(c.settings) ? c.settings : {};
    return {
      version: SCHEMA,
      createdAt: isDateKey(c.createdAt) ? c.createdAt : today,
      habits: habits,
      settings: { morning: isTime(s.morning) ? s.morning : '08:00', night: isTime(s.night) ? s.night : '21:00' }
    };
  }

  function normalizeMonth(b) {
    var out = { days: {}, reasons: {} };
    if (!isObj(b)) return out;
    ['days', 'reasons'].forEach(function (kind) {
      var src = b[kind];
      if (!isObj(src)) return;
      Object.keys(src).forEach(function (dd) {
        if (!/^(0[1-9]|[12]\d|3[01])$/.test(dd) || !isObj(src[dd])) return;
        var day = {};
        Object.keys(src[dd]).forEach(function (hid) {
          if (!hid || sanitizeId(hid) !== hid) return;
          var v = src[dd][hid];
          if (kind === 'days') { if (typeof v === 'number' && isFinite(v) && v >= 0) day[hid] = Math.min(v, LIMITS.value); }
          else if (typeof v === 'string' && REASON[v]) day[hid] = v;
        });
        if (Object.keys(day).length) out[kind][dd] = day;
      });
    });
    return out;
  }

  function defaultConfig(today) {
    return {
      version: SCHEMA, createdAt: today,
      habits: [
        { id: 'ejercicio', name: 'Ejercicio', icon: 'dumbbell', color: '#FA114F', type: 'count', unit: 'min', step: 10, goals: [{ from: today, goal: 30 }], start: today },
        { id: 'saludable', name: 'Comer saludable', icon: 'salad', color: '#A6FF00', type: 'check', unit: '', step: 1, goals: [], start: today },
        { id: 'leer', name: 'Leer', icon: 'book-open', color: '#00D8FF', type: 'count', unit: 'págs', step: 5, goals: [{ from: today, goal: 20 }], start: today },
        { id: 'sinazucar', name: 'No azúcar', icon: 'candy-off', color: '#BF5AF2', type: 'check', unit: '', step: 1, goals: [], start: today }
      ],
      settings: { morning: '08:00', night: '21:00' }
    };
  }

  /* ───────────── Respaldo ───────────── */
  function serializeBackup(data, nowIso) {
    var docs = { config: clone(data.config) };
    Object.keys(data.months).sort().forEach(function (ym) { docs['m-' + ym] = clone(data.months[ym]); });
    return JSON.stringify({ app: 'constancia', version: SCHEMA, exportedAt: nowIso, docs: docs });
  }
  function parseBackup(text, today, knownIcons) {
    if (typeof text !== 'string' || !text.trim()) return { error: 'Pega el texto del respaldo o elige un archivo.' };
    if (text.length > LIMITS.backupChars) return { error: 'El archivo es demasiado grande para ser un respaldo de Constancia.' };
    var j;
    try { j = JSON.parse(text); } catch (e) { return { error: 'El texto no es un respaldo válido. Cópialo completo, desde la primera { hasta la última }.' }; }
    if (!isObj(j) || !isObj(j.docs) || !isObj(j.docs.config) || !Array.isArray(j.docs.config.habits)) return { error: 'No encontré hábitos en este respaldo. ¿Viene de Constancia?' };
    var config = normalizeConfig(j.docs.config, today, knownIcons), months = {}, days = 0;
    Object.keys(j.docs).forEach(function (id) {
      if (!/^m-\d{4}-(0[1-9]|1[0-2])$/.test(id)) return;
      months[id.slice(2)] = normalizeMonth(j.docs[id]);
      days += Object.keys(months[id.slice(2)].days).length;
    });
    var at = typeof j.exportedAt === 'string' && isDateKey(j.exportedAt.slice(0, 10)) ? j.exportedAt.slice(0, 10) : null;
    return { data: { config: config, months: months }, summary: { habits: config.habits.length, months: Object.keys(months).length, days: days, exportedAt: at } };
  }

  /* ───────────── Modelo y métricas ─────────────
     src.docs() → { config, months }   src.today() → "AAAA-MM-DD" */
  function createModel(src) {
    var docs = src.docs, today = src.today;
    function habits() { return docs().config.habits; }
    function habitById(id) { var hs = habits(); for (var i = 0; i < hs.length; i++) if (hs[i].id === id) return hs[i]; return null; }
    function habitsForDay(k) { return habits().filter(function (h) { return !h.archivedAt || k < h.archivedAt; }); }
    function activeHabits() { return habits().filter(function (h) { return !h.archivedAt; }); }
    function month(ym) { return docs().months[ym]; }
    function getVal(hid, k) {
      var m = month(ymOf(k)), d = m && m.days[ddOf(k)], v = d && d[hid];
      return typeof v === 'number' && isFinite(v) && v > 0 ? v : 0;
    }
    function getReason(hid, k) {
      var m = month(ymOf(k)), d = m && m.reasons[ddOf(k)], r = d && d[hid];
      return typeof r === 'string' && REASON[r] ? r : null;
    }
    function goalOn(h, k) {
      if (h.type !== 'count') return 1;
      var g = h.goals || [], cur = g.length ? g[0].goal : 1;
      for (var i = 0; i < g.length; i++) if (g[i].from <= k) cur = g[i].goal;
      return cur > 0 ? cur : 1;
    }
    function evaluable(h, k) { return k >= h.start && (!h.archivedAt || k < h.archivedAt); }
    function prog(h, k) { var v = getVal(h.id, k); return h.type === 'count' ? Math.min(1, v / goalOn(h, k)) : (v >= 1 ? 1 : 0); }
    function isDone(h, k) { return prog(h, k) >= 1; }
    function status(h, k) {
      var t = today();
      if (k > t || !evaluable(h, k)) return 'na';
      if (isDone(h, k)) return 'done';
      return k === t ? 'pending' : 'fail';
    }
    function daySummary(k) {
      var hs = habitsForDay(k).filter(function (h) { return evaluable(h, k); }), done = 0, p = 0;
      hs.forEach(function (h) { var x = prog(h, k); p += x; if (x >= 1) done++; });
      return { total: hs.length, done: done, pct: hs.length ? p / hs.length : 0, perfect: hs.length > 0 && done === hs.length };
    }
    function earliestStart() { var s = today(); habits().forEach(function (h) { if (h.start < s) s = h.start; }); return s; }
    function streaks(h) {
      var t = today(), cur = 0, k = isDone(h, t) ? t : addDays(t, -1);
      while (evaluable(h, k) && isDone(h, k)) { cur++; k = addDays(k, -1); }
      var best = 0, run = 0, end = h.archivedAt ? addDays(h.archivedAt, -1) : t;
      if (h.start <= minK(end, t)) eachDay(h.start, minK(end, t), function (d) {
        if (isDone(h, d)) { run++; if (run > best) best = run; } else if (d !== t) run = 0;
      });
      return { cur: cur, best: Math.max(best, cur) };
    }
    function perfectStreak() {
      var t = today(), first = earliestStart(), k = daySummary(t).perfect ? t : addDays(t, -1), c = 0;
      while (k >= first) { var s = daySummary(k); if (s.total && s.perfect) { c++; k = addDays(k, -1); } else break; }
      return c;
    }
    // Tasa de cumplimiento en [a, b]. El día de hoy solo cuenta si ya se cumplió.
    function rate(h, a, b) {
      var t = today(), done = 0, ev = 0, end = minK(b, t);
      if (a <= end) eachDay(a, end, function (k) {
        if (!evaluable(h, k)) return;
        var d = isDone(h, k);
        if (k === t && !d) return;
        ev++; if (d) done++;
      });
      return { done: done, ev: ev, pct: ev ? done / ev : null };
    }
    function overallRate(a, b) {
      var done = 0, ev = 0;
      habits().forEach(function (h) { var r = rate(h, a, b); done += r.done; ev += r.ev; });
      return { done: done, ev: ev, pct: ev ? done / ev : null };
    }
    function weekdayStats(a, b) {
      var out = DOW_SHORT.map(function (l, i) { return { i: i, done: 0, ev: 0, pct: null }; });
      if (a <= b) eachDay(a, b, function (k) {
        var w = out[dow(k)];
        habits().forEach(function (h) { if (!evaluable(h, k)) return; w.ev++; if (isDone(h, k)) w.done++; });
      });
      out.forEach(function (w) { w.pct = w.ev ? w.done / w.ev : null; });
      return out;
    }
    function reasonCounts(a, b, hid) {
      var counts = {}, unexplained = 0, fails = 0, hs = hid ? [habitById(hid)].filter(Boolean) : habits();
      if (a <= b) eachDay(a, b, function (k) {
        hs.forEach(function (h) {
          if (status(h, k) !== 'fail') return;
          fails++;
          var r = getReason(h.id, k);
          if (r) counts[r] = (counts[r] || 0) + 1; else unexplained++;
        });
      });
      var list = Object.keys(counts).map(function (id) { return { id: id, n: counts[id] }; }).sort(function (x, y) { return y.n - x.n || REASONS.indexOf(REASON[x.id]) - REASONS.indexOf(REASON[y.id]); });
      return { counts: counts, unexplained: unexplained, fails: fails, list: list };
    }
    function pendingReasons(days) {
      var t = today(), out = [];
      for (var i = 1; i <= days; i++) {
        var k = addDays(t, -i);
        habitsForDay(k).forEach(function (h) { if (status(h, k) === 'fail' && !getReason(h.id, k)) out.push({ k: k, h: h.id }); });
      }
      return out;
    }

    /* Hallazgos automáticos: en qué fallas y qué hacer. */
    function insights() {
      var t = today(), y = addDays(t, -1), out = [], hs = habits();
      if (!hs.length) return out;
      var first = earliestStart(), tracked = Math.max(0, dayNum(t) - dayNum(first));
      if (tracked < 7) {
        out.push({ icon: 'sprout', tone: 'info', title: 'Tus patrones aparecen en ' + plural(7 - tracked, 'día', 'días'), text: 'Marca todos los días, también lo que no cumpliste. Con una semana de datos te digo qué día y qué hábito te cuestan más.' });
        return out;
      }
      var wd = weekdayStats(maxK(first, addDays(t, -84)), y), sd = 0, se = 0;
      wd.forEach(function (w) { sd += w.done; se += w.ev; });
      var avg = se ? sd / se : null, valid = wd.filter(function (w) { return w.ev >= 4; });
      if (avg != null && valid.length >= 4) {
        var worst = valid.slice().sort(function (a, b) { return a.pct - b.pct; })[0];
        if (avg - worst.pct >= 0.08) out.push({ icon: 'calendar', tone: 'bad', title: 'Los ' + DOW_PLURAL[worst.i] + ' son tu día más difícil', text: 'Cumples ' + pct(worst.pct) + ' los ' + DOW_PLURAL[worst.i] + ', contra ' + pct(avg) + ' en promedio. Prepara ese día desde la noche anterior: ropa, libro y comida listos.' });
      }
      var from30 = maxK(first, addDays(t, -29));
      var r30 = activeHabits().map(function (h) { var r = rate(h, from30, t); r.h = h; return r; }).filter(function (r) { return r.ev >= 5; });
      r30.sort(function (a, b) { return a.pct - b.pct; });
      var weak = null;
      if (r30.length >= 2 && r30[0].pct < 0.85) {
        weak = r30[0];
        var top = reasonCounts(from30, y, weak.h.id).list[0];
        out.push({ icon: weak.h.icon, habit: weak.h.id, tone: 'bad', title: weak.h.name + ' es tu hábito más débil', text: 'Lo cumpliste ' + weak.done + ' de ' + weak.ev + ' días (' + pct(weak.pct) + ') en los últimos 30 días. ' + (top ? 'Tu motivo más común es ' + REASON[top.id].label.toLowerCase() + '. ' + REASON[top.id].tip : 'Registra por qué fallas y te daré un consejo concreto.') });
      }
      var rc = reasonCounts(from30, y);
      if (rc.list.length && rc.list[0].n >= 3) {
        var r0 = REASON[rc.list[0].id];
        out.push({ icon: r0.icon, tone: 'info', title: 'Tu motivo principal: ' + r0.label.toLowerCase(), text: 'Explica ' + rc.list[0].n + ' de ' + (rc.fails - rc.unexplained) + ' fallas con motivo en 30 días. ' + r0.tip });
      }
      var from60 = maxK(first, addDays(t, -59)), pair = null;
      hs.forEach(function (a) {
        hs.forEach(function (b) {
          if (a === b) return;
          var failA = 0, both = 0, failB = 0, n = 0;
          if (from60 <= y) eachDay(from60, y, function (k) {
            if (!evaluable(a, k) || !evaluable(b, k)) return;
            n++;
            var fa = !isDone(a, k), fb = !isDone(b, k);
            if (fa) { failA++; if (fb) both++; }
            if (fb) failB++;
          });
          if (failA < 4 || !n) return;
          var cond = both / failA, lift = cond - failB / n;
          if (cond >= 0.6 && lift >= 0.25 && (!pair || lift > pair.lift)) pair = { a: a, b: b, both: both, failA: failA, lift: lift };
        });
      });
      if (pair) out.push({ icon: 'link', tone: 'info', title: 'Cuando fallas ' + pair.a.name + ', también fallas ' + pair.b.name, text: 'Pasó ' + pair.both + ' de ' + pair.failA + ' veces. Si aseguras ' + pair.a.name + ' temprano, ' + pair.b.name + ' se vuelve más fácil.' });
      activeHabits().forEach(function (h) {
        if (h.type !== 'count') return;
        var near = 0, sum = 0;
        if (from30 <= y) eachDay(from30, y, function (k) {
          if (status(h, k) !== 'fail') return;
          var v = getVal(h.id, k), g = goalOn(h, k);
          if (v > 0 && v < g) { near++; sum += v / g; }
        });
        if (near < 3) return;
        var g0 = goalOn(h, t), avgv = (sum / near) * g0, sug = Math.max(h.step, Math.round((avgv * 1.1) / h.step) * h.step);
        if (sug < g0) out.push({ icon: 'target', tone: 'info', title: 'En ' + h.name + ' te quedas cerca', text: plural(near, 'vez', 'veces') + ' avanzaste sin llegar a la meta (promedio de ' + fmt(avgv) + ' de ' + fmt(g0) + ' ' + h.unit + '). Prueba ' + fmt(sug) + ' ' + h.unit + ' durante dos semanas y luego sube.' });
      });
      if (r30.length >= 2) {
        var strong = r30[r30.length - 1];
        if (strong.pct >= 0.8 && strong !== weak) out.push({ icon: 'award', tone: 'good', title: strong.h.name + ' ya es parte de tu rutina', text: pct(strong.pct) + ' de cumplimiento en 30 días.' + (weak ? ' Úsalo como ancla: haz ' + weak.h.name + ' justo después.' : '') });
      }
      var ws = weekStart(t), lw = overallRate(addDays(ws, -7), addDays(ws, -1)), pw = overallRate(addDays(ws, -14), addDays(ws, -8));
      if (lw.ev >= 7 && pw.ev >= 7) {
        var diff = Math.round((lw.pct - pw.pct) * 100);
        if (diff >= 5) out.push({ icon: 'trending-up', tone: 'good', title: 'Vas mejorando', text: 'La semana pasada cumpliste ' + pct(lw.pct) + ', ' + diff + ' puntos más que la anterior. Repite lo que te funcionó.' });
        else if (diff <= -5) out.push({ icon: 'trending-down', tone: 'bad', title: 'La semana pasada bajaste', text: 'Cumpliste ' + pct(lw.pct) + ', ' + Math.abs(diff) + ' puntos menos que la anterior. Elige un solo hábito para asegurarlo esta semana.' });
      }
      return out.slice(0, 6);
    }

    return {
      habits: habits, habitById: habitById, habitsForDay: habitsForDay, activeHabits: activeHabits,
      getVal: getVal, getReason: getReason, goalOn: goalOn, evaluable: evaluable, prog: prog, isDone: isDone,
      status: status, daySummary: daySummary, earliestStart: earliestStart, streaks: streaks, perfectStreak: perfectStreak,
      rate: rate, overallRate: overallRate, weekdayStats: weekdayStats, reasonCounts: reasonCounts,
      pendingReasons: pendingReasons, insights: insights
    };
  }

  /* ───────────── Datos de ejemplo (deterministas) ───────────── */
  function buildDemo(today) {
    var start = addDays(today, -69), c = defaultConfig(start);
    var seed = 20261122;
    function rnd() { seed = (seed + 0x6D2B79F5) | 0; var x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }
    function pick(a) { return a[Math.floor(rnd() * a.length)]; }
    var months = {};
    eachDay(start, today, function (k) {
      var w = dow(k), wknd = w >= 5, boost = ((dayNum(k) - dayNum(start)) / 69) * 0.12;
      var m = months[ymOf(k)] || (months[ymOf(k)] = { days: {}, reasons: {} });
      var day = {}, why = {};
      var ex = rnd() < (wknd ? 0.42 : 0.82) + boost;
      day.ejercicio = ex ? 30 + Math.floor(rnd() * 4) * 5 : (rnd() < 0.4 ? 10 + Math.floor(rnd() * 2) * 10 : 0);
      if (!ex) why.ejercicio = pick(wknd ? ['social', 'cansancio', 'ganas'] : ['tiempo', 'tiempo', 'cansancio']);
      var sa = rnd() < (ex ? 0.86 : 0.42) - (wknd ? 0.15 : 0) + boost;
      day.saludable = sa ? 1 : 0;
      if (!sa) why.saludable = pick(wknd ? ['social', 'social', 'antojo'] : ['tiempo', 'antojo']);
      var le = rnd() < 0.55 + boost;
      day.leer = le ? 20 + Math.floor(rnd() * 3) * 5 : (rnd() < 0.65 ? 5 + Math.floor(rnd() * 3) * 5 : 0);
      if (!le) why.leer = pick(['cansancio', 'cansancio', 'olvido', 'tiempo']);
      var az = rnd() < (w === 4 || wknd ? 0.5 : 0.86) + boost * 0.5;
      day.sinazucar = az ? 1 : 0;
      if (!az) why.sinazucar = pick(['antojo', 'antojo', 'social']);
      if (k === today) { day = { ejercicio: 30, saludable: 1, leer: 5, sinazucar: 0 }; why = {}; }
      m.days[ddOf(k)] = day;
      var rs = {};
      Object.keys(why).forEach(function (id) { if (rnd() < 0.8) rs[id] = why[id]; });
      if (Object.keys(rs).length) m.reasons[ddOf(k)] = rs;
    });
    return { config: c, months: months };
  }

  return {
    VERSION: VERSION, SCHEMA: SCHEMA, LIMITS: LIMITS,
    pad: pad, keyOf: keyOf, dayNum: dayNum, fromNum: fromNum, isDateKey: isDateKey, addDays: addDays, dow: dow,
    weekStart: weekStart, ymOf: ymOf, ddOf: ddOf, addMonths: addMonths, daysInMonth: daysInMonth, minK: minK, maxK: maxK,
    eachDay: eachDay, isTime: isTime, minutesOf: minutesOf,
    DOW_SHORT: DOW_SHORT, DOW: DOW, DOW_PLURAL: DOW_PLURAL, MONTHS: MONTHS, MONTHS_SHORT: MONTHS_SHORT,
    cap: cap, longDate: longDate, shortDate: shortDate, relDay: relDay, fmt: fmt, pct: pct, plural: plural,
    REASONS: REASONS, REASON: REASON, COLORS: COLORS,
    contrast: contrast, readableOn: readableOn,
    isObj: isObj, clone: clone, cleanText: cleanText, sanitizeId: sanitizeId, sanitizeColor: sanitizeColor,
    normalizeConfig: normalizeConfig, normalizeMonth: normalizeMonth, defaultConfig: defaultConfig,
    serializeBackup: serializeBackup, parseBackup: parseBackup, createModel: createModel, buildDemo: buildDemo
  };
});
