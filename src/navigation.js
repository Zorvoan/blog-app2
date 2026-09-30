'use strict';

// Návrat "tam, odkud jsem přišel".
//
// Šipka zpět v editorech i přesměrování po uložení vede na stránku, ze které uživatel přišel:
//   GET  – z parametru ?back=… (předává se mezi stránkami editoru), jinak z hlavičky Referer,
//   POST – ze skrytého pole "back" formuláře, jinak z hlavičky Referer.
// Bere se jen adresa na tomto webu; aktuální stránka, přihlášení a zadané "vyhýbané"
// adresy (např. právě smazaný příspěvek) se přeskočí a použije se výchozí adresa.

const MAX_LENGTH = 500;
const SKIP = /^\/(login|register|logout)\b/;

// Bezpečná adresa v rámci webu (žádné //jiny-web.cz, žádné zalomení řádků).
function localPath(value) {
  return typeof value === 'string' && value.length <= MAX_LENGTH && /^\/(?![/\\])/.test(value) && !/[\r\n]/.test(value)
    ? value
    : null;
}

function refererPath(req) {
  try {
    const url = new URL(req.get('referer'));
    return url.host === req.get('host') ? url.pathname + url.search : null;
  } catch {
    return null;
  }
}

const pathOf = (url) => url.split(/[?#]/)[0];

function backTarget(req, fallback, { avoid = [] } = {}) {
  const here = pathOf(req.originalUrl);
  const candidates = req.method === 'GET' ? [req.query.back, refererPath(req)] : [req.body?.back, refererPath(req)];
  for (const candidate of candidates) {
    const url = localPath(candidate);
    if (!url || SKIP.test(url)) continue;
    const path = pathOf(url);
    if (path === here || avoid.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) continue;
    return url;
  }
  return fallback;
}

// Když se změnila adresa (slug) cíle, vést na novou: /pages/stara?x=1 → /pages/nova?x=1.
const renamePath = (url, from, to) => (pathOf(url) === from ? to + url.slice(from.length) : url);

// Adresa s předaným cílem návratu, např. editor po "Uložit a pokračovat".
const withBack = (url, back) => (back ? `${url}${url.includes('?') ? '&' : '?'}back=${encodeURIComponent(back)}` : url);

module.exports = { localPath, refererPath, backTarget, withBack, renamePath };
