// Pruebas del núcleo de lógica. Ejecutar: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/icons.js';
import '../src/core.js';

const C = globalThis.ConstanciaCore;
const ICONS = globalThis.ConstanciaHabitIcons;

function makeModel(config, months = {}, today = '2026-11-22') {
  const docs = { config: C.normalizeConfig(config, today, ICONS), months };
  return { docs, today, m: C.createModel({ docs: () => docs, today: () => today }) };
}
function setDays(months, hid, entries) {
  for (const [k, v] of Object.entries(entries)) {
    const ym = k.slice(0, 7), dd = k.slice(8);
    months[ym] ??= { days: {}, reasons: {} };
    months[ym].days[dd] ??= {};
    months[ym].days[dd][hid] = v;
  }
}

test('fechas: aritmética, día de la semana y límites de mes y año', () => {
  assert.equal(C.dow('2026-11-22'), 6, '22 nov 2026 es domingo');
  assert.equal(C.dow('2026-11-16'), 0, '16 nov 2026 es lunes');
  assert.equal(C.weekStart('2026-11-22'), '2026-11-16');
  assert.equal(C.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(C.addDays('2028-03-01', -1), '2028-02-29', 'año bisiesto');
  assert.equal(C.addMonths('2026-01', -1), '2025-12');
  assert.equal(C.addMonths('2026-12', 1), '2027-01');
  assert.equal(C.daysInMonth('2028-02'), 29);
  assert.equal(C.daysInMonth('2026-02'), 28);
  // Fechas alrededor del cambio de horario (México y EE. UU.)
  assert.equal(C.addDays('2026-03-07', 1), '2026-03-08');
  assert.equal(C.addDays('2026-11-01', 1), '2026-11-02');
  assert.equal(C.dayNum('2026-03-09') - C.dayNum('2026-03-07'), 2);
});

test('fechas: isDateKey rechaza fechas imposibles', () => {
  assert.ok(C.isDateKey('2026-02-28'));
  assert.ok(!C.isDateKey('2026-02-30'));
  assert.ok(!C.isDateKey('2026-13-01'));
  assert.ok(!C.isDateKey('22-11-2026'));
  assert.ok(!C.isDateKey(null));
});

test('validación: limpia ids peligrosos, colores, textos y emojis de la v1', () => {
  const c = C.normalizeConfig({
    habits: [
      { id: '"><img src=x onerror=alert(1)>', name: '  <b>Correr</b>\n\t ', color: 'red', type: 'count', goals: [{ from: '2026-11-01', goal: 'abc' }] },
      { id: 'leer', name: 'Leer', icon: '📖', color: '#00d8ff', type: 'count', unit: 'págs', step: 5, goals: [{ from: '2026-11-10', goal: 30 }, { from: '2026-11-01', goal: 20 }], start: '2026-11-01' },
      { id: 'leer', name: 'Duplicado', type: 'check' },
      { id: 'ejercicio', icon: '🏃', type: 'count', goals: [{ from: '2026-11-01', goal: 30 }] },
      'no es objeto'
    ]
  }, '2026-11-22', ICONS);
  assert.equal(c.habits.length, 4);
  const [a, b, dup, ex] = c.habits;
  assert.match(a.id, /^[a-z0-9_-]+$/);
  assert.equal(a.name, '<b>Correr</b>', 'el texto se recorta; el escape ocurre al pintar');
  assert.equal(a.color, '#0A84FF');
  assert.deepEqual(a.goals, [{ from: '2026-11-22', goal: 1 }], 'meta inválida → meta por omisión');
  assert.equal(b.color, '#00D8FF');
  assert.equal(b.icon, 'book-open', 'emoji migrado a ícono');
  assert.deepEqual(b.goals.map(g => g.from), ['2026-11-01', '2026-11-10'], 'metas ordenadas');
  assert.equal(dup.id, 'leer-2', 'ids duplicados se vuelven únicos');
  assert.equal(ex.icon, 'dumbbell');
  assert.equal(c.settings.morning, '08:00');
});

test('validación: límite de hábitos y horarios', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: 'h' + i, name: 'H' + i }));
  const c = C.normalizeConfig({ habits: many, settings: { morning: '25:00', night: '22:30' } }, '2026-11-22', ICONS);
  assert.equal(c.habits.length, C.LIMITS.habits);
  assert.equal(c.settings.morning, '08:00');
  assert.equal(c.settings.night, '22:30');
});

test('validación: normalizeMonth descarta valores corruptos', () => {
  const m = C.normalizeMonth({
    days: { '01': { leer: 10, x: -3, y: 'NaN', 'a b': 4 }, '32': { leer: 1 }, '02': { leer: 1e12 }, '03': 'x' },
    reasons: { '01': { leer: 'cansancio', x: 'hackeo', y: null } }
  });
  assert.deepEqual(m.days, { '01': { leer: 10 }, '02': { leer: C.LIMITS.value } });
  assert.deepEqual(m.reasons, { '01': { leer: 'cansancio' } });
});

test('contraste: el color de texto de cada hábito cumple WCAG AA sobre los fondos', () => {
  for (const { hex } of C.COLORS) {
    for (const bg of ['#000000', '#1C1C1E', '#2C2C2E']) {
      const t = C.readableOn(hex, bg);
      assert.ok(C.contrast(t, bg) >= 4.5, `${hex} sobre ${bg}: ${C.contrast(t, bg).toFixed(2)}`);
    }
  }
});

test('métricas: rachas actuales y récord', () => {
  const months = {};
  const { m } = makeModel({ habits: [{ id: 'a', name: 'A', type: 'check', start: '2026-11-10' }] }, months);
  const h = m.habitById('a');
  setDays(months, 'a', { '2026-11-10': 1, '2026-11-11': 1, '2026-11-12': 1, '2026-11-13': 1, '2026-11-15': 1, '2026-11-19': 1, '2026-11-20': 1, '2026-11-21': 1 });
  assert.deepEqual(m.streaks(h), { cur: 3, best: 4 }, 'hoy sin marcar no rompe la racha');
  setDays(months, 'a', { '2026-11-22': 1 });
  assert.deepEqual(m.streaks(h), { cur: 4, best: 4 });
});

test('métricas: estado del día, hoy no cuenta como falla y tasa', () => {
  const months = {};
  const { m } = makeModel({ habits: [{ id: 'a', name: 'A', type: 'check', start: '2026-11-20' }] }, months);
  const h = m.habitById('a');
  setDays(months, 'a', { '2026-11-20': 1 });
  assert.equal(m.status(h, '2026-11-19'), 'na', 'antes de empezar');
  assert.equal(m.status(h, '2026-11-20'), 'done');
  assert.equal(m.status(h, '2026-11-21'), 'fail');
  assert.equal(m.status(h, '2026-11-22'), 'pending');
  assert.equal(m.status(h, '2026-11-23'), 'na', 'futuro');
  assert.deepEqual(m.rate(h, '2026-11-01', '2026-11-22'), { done: 1, ev: 2, pct: 0.5 });
  assert.deepEqual(m.pendingReasons(7), [{ k: '2026-11-21', h: 'a' }]);
});

test('métricas: el historial de metas se respeta por fecha', () => {
  const months = {};
  const { m } = makeModel({ habits: [{ id: 'l', name: 'Leer', type: 'count', unit: 'págs', start: '2026-11-01', goals: [{ from: '2026-11-01', goal: 20 }, { from: '2026-11-15', goal: 30 }] }] }, months);
  const h = m.habitById('l');
  setDays(months, 'l', { '2026-11-10': 25, '2026-11-16': 25 });
  assert.equal(m.isDone(h, '2026-11-10'), true, '25 ≥ 20');
  assert.equal(m.isDone(h, '2026-11-16'), false, '25 < 30');
  assert.equal(m.prog(h, '2026-11-16').toFixed(3), (25 / 30).toFixed(3));
});

test('métricas: archivar oculta el hábito desde esa fecha y conserva el historial', () => {
  const months = {};
  const { m } = makeModel({ habits: [{ id: 'a', name: 'A', type: 'check', start: '2026-11-01', archivedAt: '2026-11-20' }] }, months);
  const h = m.habitById('a');
  assert.equal(m.habitsForDay('2026-11-19').length, 1);
  assert.equal(m.habitsForDay('2026-11-20').length, 0);
  assert.equal(m.activeHabits().length, 0);
  assert.equal(m.status(h, '2026-11-21'), 'na');
});

test('métricas: día perfecto y motivos', () => {
  const months = {};
  const { m } = makeModel({ habits: [{ id: 'a', type: 'check', start: '2026-11-20' }, { id: 'b', type: 'check', start: '2026-11-20' }] }, months);
  setDays(months, 'a', { '2026-11-20': 1, '2026-11-21': 1 });
  setDays(months, 'b', { '2026-11-20': 1 });
  months['2026-11'].reasons['21'] = { b: 'cansancio' };
  assert.equal(m.daySummary('2026-11-20').perfect, true);
  assert.equal(m.daySummary('2026-11-21').perfect, false);
  const rc = m.reasonCounts('2026-11-01', '2026-11-21');
  assert.deepEqual(rc.list, [{ id: 'cansancio', n: 1 }]);
  assert.equal(rc.unexplained, 0);
});

test('respaldo: ida y vuelta, y rechazo de entradas inválidas', () => {
  const data = C.buildDemo('2026-11-22');
  const text = C.serializeBackup(data, '2026-11-22T10:00:00.000Z');
  const back = C.parseBackup(text, '2026-11-22', ICONS);
  assert.ok(back.data, back.error);
  assert.equal(back.summary.habits, 4);
  assert.equal(back.summary.exportedAt, '2026-11-22');
  assert.deepEqual(back.data.months['2026-11'].days['22'], data.months['2026-11'].days['22']);
  assert.ok(C.parseBackup('', '2026-11-22', ICONS).error);
  assert.ok(C.parseBackup('{no json', '2026-11-22', ICONS).error);
  assert.ok(C.parseBackup('{"docs":{}}', '2026-11-22', ICONS).error);
  assert.ok(C.parseBackup('x'.repeat(C.LIMITS.backupChars + 1), '2026-11-22', ICONS).error);
});

test('demo: es determinista y produce hallazgos sin valores inválidos', () => {
  const a = C.buildDemo('2026-11-22'), b = C.buildDemo('2026-11-22');
  assert.deepEqual(a, b);
  const docs = { config: C.normalizeConfig(a.config, '2026-11-22', ICONS), months: a.months };
  const m = C.createModel({ docs: () => docs, today: () => '2026-11-22' });
  const ins = m.insights();
  assert.ok(ins.length >= 3, 'al menos tres hallazgos');
  for (const i of ins) {
    assert.ok(i.title && i.text && i.icon);
    assert.doesNotMatch(i.title + i.text, /NaN|undefined|null|Infinity/);
  }
});

test('usuario nuevo: mensaje de inicio en lugar de hallazgos', () => {
  const { m } = makeModel(C.defaultConfig('2026-11-22'));
  const ins = m.insights();
  assert.equal(ins.length, 1);
  assert.equal(ins[0].icon, 'sprout');
});

test('formato: números y porcentajes', () => {
  assert.equal(C.pct(null), '—');
  assert.equal(C.pct(0.756), '76%');
  assert.equal(C.fmt(2.25), '2.3');
  assert.equal(C.fmt(1500), '1,500');
  assert.equal(C.plural(1, 'día', 'días'), '1 día');
  assert.equal(C.relDay('2026-11-21', '2026-11-22'), 'Ayer');
});
