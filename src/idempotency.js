'use strict';

// Ochrana proti dvojímu zpracování stejného formuláře.
//
// Formuláře, které lze odeslat i offline (příspěvky, stránky, rubriky, komentáře), nesou
// skryté pole _idem s jednorázovým klíčem. Po úspěšném zpracování (přesměrování) si server
// klíč uloží spolu s cílovou adresou. Když stejný formulář dorazí znovu – dvojklik nebo
// opakované odeslání offline fronty, jejíž první pokus server zpracoval, ale odpověď se
// ztratila – nic se znovu nevytvoří a uživatel je přesměrován na výsledek prvního odeslání.
//
// Souběh nehrozí: databáze je synchronní, takže kontrola, zpracování i uložení klíče
// proběhnou v rámci jednoho požadavku bez přerušení jiným požadavkem.

const crypto = require('node:crypto');

const KEY_RE = /^[A-Za-z0-9-]{16,64}$/;
const newKey = () => crypto.randomUUID();

function idempotency(req, res, next) {
  const key = req.body?._idem;
  if (req.method !== 'POST' || !req.user || typeof key !== 'string' || !KEY_RE.test(key)) return next();

  const { models } = req.app.locals;
  const previous = models.idempotency.find(req.user.id, key);
  if (previous) return res.redirect(303, previous.location);

  // Zapamatovat si výsledek úspěšného zpracování (všechny úspěšné akce končí přesměrováním).
  const redirect = res.redirect.bind(res);
  res.redirect = (...args) => {
    models.idempotency.save(req.user.id, key, String(args[args.length - 1]));
    return redirect(...args);
  };
  next();
}

module.exports = { idempotency, newKey };
