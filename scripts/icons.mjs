// Genera src/icons.js con el subconjunto de íconos que usa la app.
// Fuente: Lucide (https://lucide.dev), licencia ISC. Se versiona el resultado para que
// el build no dependa de node_modules.
//
// Uso: npm install && npm run icons
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'node_modules/lucide-static/icons');

// Íconos que el usuario puede elegir para un hábito (el orden es el de la cuadrícula).
export const HABIT_ICONS = [
  'dumbbell', 'activity', 'footprints', 'bike', 'heart-pulse', 'person-standing',
  'salad', 'apple', 'carrot', 'utensils', 'droplet', 'glass-water',
  'coffee', 'candy-off', 'cigarette-off', 'wine-off', 'book-open', 'library',
  'pen-line', 'graduation-cap', 'languages', 'brain', 'flower-2', 'moon',
  'bed', 'sun', 'alarm-clock', 'pill', 'smile', 'heart',
  'music', 'guitar', 'laptop', 'code', 'smartphone', 'ban',
  'wallet', 'piggy-bank', 'leaf', 'sprout', 'bath', 'users',
  'dog', 'house', 'briefcase', 'target', 'sparkles', 'star'
];

// Íconos de la interfaz.
const UI_ICONS = [
  'chevron-left', 'chevron-right', 'check', 'plus', 'minus', 'x', 'calendar-days', 'chart-column',
  'settings', 'flame', 'trophy', 'sunrise', 'pencil', 'circle-alert', 'triangle-alert', 'info',
  'download', 'upload', 'copy', 'archive', 'trash-2', 'rotate-ccw', 'arrow-up', 'arrow-down',
  'trending-up', 'trending-down', 'link', 'clock', 'cloud', 'hard-drive', 'bell', 'lightbulb',
  'battery-low', 'bell-off', 'meh', 'cookie', 'party-popper', 'thermometer', 'ellipsis', 'calendar',
  'award', 'circle-check', 'refresh-cw', 'shield-check', 'bug', 'list-checks', 'circle-help',
  'wifi-off', 'lock'
];

const names = [...new Set([...HABIT_ICONS, ...UI_ICONS])];
const out = {};
for (const name of names) {
  const svg = readFileSync(join(dir, name + '.svg'), 'utf8');
  const inner = svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>[\s\S]*$/, '')
    .replace(/\s*\n\s*/g, '')
    .replace(/\s+\/>/g, '/>')
    .trim();
  if (!inner) throw new Error('Ícono vacío: ' + name);
  out[name] = inner;
}

const body = `/* Íconos de Constancia: subconjunto de Lucide v0.468.0 (licencia ISC, https://lucide.dev).
   Archivo generado por scripts/icons.mjs; no editar a mano. */
(function (root) {
  'use strict';
  root.ConstanciaIcons = ${JSON.stringify(out, null, 1).replace(/\n/g, '\n  ')};
  root.ConstanciaHabitIcons = ${JSON.stringify(HABIT_ICONS)};
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;
writeFileSync(join(root, 'src/icons.js'), body);
console.log('src/icons.js: ' + names.length + ' íconos');
