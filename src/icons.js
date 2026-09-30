'use strict';

// Ikony jsou definované jen jednou – v souboru public/icons.svg (SVG sprite).
// Šablony je vkládají odkazem <use>, takže se kresba ikony v HTML neopakuje
// a prohlížeč soubor stáhne jednou a uloží do mezipaměti (i pro offline režim).

const fs = require('node:fs');
const path = require('node:path');

const SPRITE = '/icons.svg';
const NAMES = new Set(
  [...fs.readFileSync(path.join(__dirname, '..', 'public', 'icons.svg'), 'utf8').matchAll(/<symbol id="([a-z-]+)"/g)].map((m) => m[1])
);

function icon(name, cls = '') {
  if (!NAMES.has(name)) throw new Error(`Neznámá ikona: ${name}`);
  return `<svg class="icon${cls ? ` ${cls}` : ''}" aria-hidden="true"><use href="${SPRITE}#${name}"/></svg>`;
}

module.exports = { icon, NAMES };
