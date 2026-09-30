'use strict';

// Hlídá, aby se definice neopakovaly: ikony jen jednou ve sprite souboru,
// v CSS každý selektor jen jednou a žádná dvě pravidla se stejným obsahem.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { icon, NAMES } = require('../src/icons');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('ikony: každá je ve sprite souboru právě jednou a šablony ji jen odkazují', () => {
  const ids = [...read('public/icons.svg').matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'duplicitní id ikony');
  const bodies = [...read('public/icons.svg').matchAll(/<symbol[^>]*>(.*?)<\/symbol>/g)].map((m) => m[1]);
  assert.equal(new Set(bodies).size, bodies.length, 'dvě ikony mají stejnou kresbu');
  assert.ok(NAMES.has('up'));
  assert.equal(icon('up'), '<svg class="icon" aria-hidden="true"><use href="/icons.svg#up"/></svg>');
  assert.throws(() => icon('neexistuje'));
});

test('CSS: žádný selektor není definovaný dvakrát a žádný obsah pravidla se neopakuje', () => {
  const css = read('public/css/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const seen = new Map();
  for (const [, sel] of rules) {
    for (const s of sel.split(',').map((x) => x.trim().replace(/\s+/g, ' '))) {
      if (s === ':root') continue; // tokeny a jejich přepsání v media queries
      assert.ok(!seen.has(s), `selektor ${s} je definovaný víckrát`);
      seen.set(s, true);
    }
  }
  // Stejný obsah se porovnává v rámci jednoho kontextu (hlavní styl, každá media query zvlášť).
  const contexts = css.split(/@media[^{]*\{/);
  for (const ctx of contexts) {
    const bodies = new Map();
    for (const [, sel, body] of ctx.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const key = body.split(';').map((d) => d.trim()).filter(Boolean).sort().join(';');
      if (!key || sel.trim().startsWith(':root')) continue;
      assert.ok(!bodies.has(key), `pravidla "${bodies.get(key)}" a "${sel.trim()}" mají stejný obsah`);
      bodies.set(key, sel.trim());
    }
  }
});
