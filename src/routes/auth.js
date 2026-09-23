'use strict';

const express = require('express');
const { hashPassword, verifyPassword } = require('../auth');
const { str } = require('../forms');

const router = express.Router();

// Jednoduchá ochrana proti hádání hesel: max. 10 neúspěšných pokusů / 15 min na IP + jméno.
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;
const failures = new Map();
function tooManyFailures(key) {
  const f = failures.get(key);
  if (f && Date.now() - f.first > FAIL_WINDOW_MS) failures.delete(key);
  return (failures.get(key)?.count || 0) >= MAX_FAILS;
}
function recordFailure(key) {
  const f = failures.get(key) || { count: 0, first: Date.now() };
  f.count++;
  failures.set(key, f);
  if (failures.size > 10000) failures.delete(failures.keys().next().value);
}

const safeNext = (n) => (typeof n === 'string' && /^\/(?![/\\])/.test(n) ? n : '/');

router.get('/login', (req, res) => {
  if (req.user) return res.redirect(303, '/');
  res.render('login', { title: 'Přihlášení', bare: true, next: safeNext(req.query.next), error: null, login: '' });
});

router.post('/login', (req, res) => {
  const { models, sessions } = req.app.locals;
  const login = str(req.body.login, 200).trim();
  const user = login && models.users.byLogin(login);
  const next = safeNext(req.body.next);
  const key = `${req.ip}|${login.toLowerCase()}`;
  if (tooManyFailures(key)) {
    return res.status(429).render('login', { title: 'Přihlášení', bare: true, next, login, error: 'Příliš mnoho neúspěšných pokusů. Zkuste to znovu za 15 minut.' });
  }
  if (!user || !verifyPassword(str(req.body.password, 500), user.password_hash)) {
    recordFailure(key);
    return res.status(422).render('login', { title: 'Přihlášení', bare: true, next, login, error: 'Nesprávné jméno nebo heslo.' });
  }
  failures.delete(key);
  sessions.login(req, res, user.id);
  sessions.flash(req, 'success', `Vítejte zpět, ${user.display_name}!`);
  res.redirect(303, next);
});

function registrationOpen(models) {
  return models.getSettings().allow_registration === '1' || models.users.count() === 0;
}

router.get('/register', (req, res) => {
  const { models } = req.app.locals;
  if (req.user) return res.redirect(303, '/');
  res.render('register', {
    title: 'Registrace', bare: true, errors: [], form: {},
    open: registrationOpen(models), firstUser: models.users.count() === 0,
  });
});

router.post('/register', (req, res) => {
  const { models, sessions } = req.app.locals;
  const form = {
    username: str(req.body.username, 60).trim(),
    display_name: str(req.body.display_name, 60).trim(),
    email: str(req.body.email, 200).trim(),
  };
  const password = str(req.body.password, 500);
  const errors = [];
  const open = registrationOpen(models);
  if (!open) errors.push('Registrace nových uživatelů je vypnutá.');
  if (!/^[A-Za-z0-9_]{3,30}$/.test(form.username)) errors.push('Uživatelské jméno musí mít 3–30 znaků (písmena bez diakritiky, číslice, podtržítko).');
  else if (models.users.byUsername(form.username)) errors.push('Toto uživatelské jméno je již obsazené.');
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errors.push('Zadejte platný e-mail.');
  else if (form.email && models.users.byLogin(form.email)) errors.push('Tento e-mail je již použit.');
  if (password.length < 8) errors.push('Heslo musí mít alespoň 8 znaků.');
  if (password !== str(req.body.password_confirm, 500)) errors.push('Hesla se neshodují.');

  if (errors.length) {
    return res.status(422).render('register', { title: 'Registrace', bare: true, errors, form, open, firstUser: models.users.count() === 0 });
  }
  const role = models.users.count() === 0 ? 'admin' : 'user';
  const id = models.users.create({
    username: form.username, email: form.email, displayName: form.display_name || form.username,
    passwordHash: hashPassword(password), role,
  });
  sessions.login(req, res, id);
  sessions.flash(req, 'success', role === 'admin'
    ? 'Účet vytvořen. Jako první uživatel jste administrátor.'
    : 'Účet vytvořen. Vítejte!');
  res.redirect(303, '/');
});

router.post('/logout', (req, res) => {
  req.app.locals.sessions.logout(req, res);
  res.redirect(303, '/');
});

module.exports = router;
