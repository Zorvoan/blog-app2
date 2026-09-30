'use strict';

// Společné pomůcky administrace – aby se v jednotlivých routách neopakovaly.

const { int } = require('../../forms');
const { backTarget, localPath, withBack, renamePath } = require('../../navigation');

function denied(res, message = 'K této akci nemáte oprávnění.') {
  return res.status(403).render('error', { title: 'Přístup odepřen', message });
}

// Zpráva uživateli + přesměrování (vzor POST → redirect → GET).
function done(req, res, url, message, type = 'success') {
  req.app.locals.sessions.flash(req, type, message);
  res.redirect(303, url);
}

// Middleware: načte záznam podle :id, uloží ho do req[key]; neexistující záznam → 404.
function load(key, find) {
  return (req, res, next) => {
    const item = find(req.app.locals.models, int(req.params.id), req);
    if (!item) return next('route');
    req[key] = item;
    next();
  };
}

// Middleware: ověří oprávnění nad načteným záznamem.
function allow(check, message) {
  return (req, res, next) => (check(req) ? next() : denied(res, message));
}

const idsFrom = (v) => [].concat(v ?? []).map((x) => int(x)).filter((x) => x > 0);

// Middleware: zjistí, kam vede šipka zpět (stránka, odkud uživatel přišel), a uloží to
// do res.locals.backUrl. Šablona ho předá dál skrytým polem "back", takže po uložení
// formuláře (POST) je cíl návratu známý. fallback/avoid mohou být funkce (req) => …
function rememberBack(fallback, avoid = () => []) {
  return (req, res, next) => {
    const defaultUrl = typeof fallback === 'function' ? fallback(req) : fallback;
    res.locals.backUrl = req.method === 'GET'
      ? backTarget(req, defaultUrl, { avoid: avoid(req) })
      : localPath(req.body.back) || defaultUrl;
    next();
  };
}

// Po uložení: "Uložit a pokračovat" zůstane v editoru (a zachová cíl návratu),
// jinak se uživatel vrátí tam, odkud do editoru přišel.
const afterSave = (req, res, editUrl) =>
  (req.body.after === 'edit' ? withBack(editUrl, res.locals.backUrl) : res.locals.backUrl);

module.exports = { denied, done, load, allow, idsFrom, rememberBack, afterSave, backTarget, withBack, localPath, renamePath };
