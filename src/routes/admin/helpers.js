'use strict';

// Společné pomůcky administrace – aby se v jednotlivých routách neopakovaly.

const { int } = require('../../forms');

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

// Po uložení: "Uložit a pokračovat" zůstane v editoru, jinak zobrazí výsledek.
const afterSave = (req, editUrl, viewUrl) => (req.body.after === 'edit' ? editUrl : viewUrl);

module.exports = { denied, done, load, allow, idsFrom, afterSave };
