'use strict';

const express = require('express');
const { hashPassword, verifyPassword, requireLogin, requireAdmin } = require('../auth');
const { str, int } = require('../forms');

const router = express.Router();
router.use('/settings', requireLogin);

const TABS = ['profile', 'password', 'appearance', 'account', 'site'];

function render(req, res, tab, extra = {}, statusCode = 200) {
  const { models } = req.app.locals;
  if (tab === 'site' && req.user.role !== 'admin') tab = 'profile';
  res.status(statusCode).render('settings', {
    title: 'Nastavení', tab, errors: [], stats: models.users.stats(req.user.id), ...extra,
  });
}

router.get('/settings', (req, res) => {
  const tab = TABS.includes(req.query.tab) ? req.query.tab : 'profile';
  render(req, res, tab);
});

router.post('/settings/profile', (req, res) => {
  const { models, sessions } = req.app.locals;
  const displayName = str(req.body.display_name, 60).trim();
  const email = str(req.body.email, 200).trim();
  const bio = str(req.body.bio, 500).trim();
  const errors = [];
  if (!displayName) errors.push('Zobrazované jméno nesmí být prázdné.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Zadejte platný e-mail.');
  const other = email && models.users.byLogin(email);
  if (other && other.id !== req.user.id) errors.push('Tento e-mail již používá jiný účet.');
  if (errors.length) return render(req, res, 'profile', { errors }, 422);
  models.users.updateProfile(req.user.id, { displayName, email, bio });
  sessions.flash(req, 'success', 'Profil byl uložen.');
  res.redirect(303, '/settings?tab=profile');
});

router.post('/settings/password', (req, res) => {
  const { models, sessions } = req.app.locals;
  const errors = [];
  const password = str(req.body.new_password, 500);
  if (!verifyPassword(str(req.body.current_password, 500), req.user.password_hash)) errors.push('Současné heslo není správné.');
  if (password.length < 8) errors.push('Nové heslo musí mít alespoň 8 znaků.');
  if (password !== str(req.body.new_password_confirm, 500)) errors.push('Nová hesla se neshodují.');
  if (errors.length) return render(req, res, 'password', { errors }, 422);
  models.users.setPassword(req.user.id, hashPassword(password));
  // Odhlásit ostatní relace tohoto uživatele.
  models.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(req.user.id, req.session.id);
  sessions.flash(req, 'success', 'Heslo bylo změněno. Ostatní přihlášená zařízení byla odhlášena.');
  res.redirect(303, '/settings?tab=password');
});

router.post('/settings/appearance', (req, res) => {
  const { models, sessions } = req.app.locals;
  const theme = ['system', 'light', 'dark'].includes(req.body.theme) ? req.body.theme : 'system';
  models.users.setTheme(req.user.id, theme);
  sessions.flash(req, 'success', 'Vzhled byl uložen.');
  res.redirect(303, '/settings?tab=appearance');
});

router.post('/settings/site', requireAdmin, (req, res) => {
  const { models, sessions } = req.app.locals;
  const siteName = str(req.body.site_name, 60).trim();
  if (!siteName) return render(req, res, 'site', { errors: ['Název webu nesmí být prázdný.'] }, 422);
  models.saveSettings({
    site_name: siteName,
    site_tagline: str(req.body.site_tagline, 200).trim(),
    posts_per_page: Math.min(100, Math.max(5, int(req.body.posts_per_page, 20))),
    allow_registration: req.body.allow_registration === '1' ? '1' : '0',
  });
  sessions.flash(req, 'success', 'Nastavení webu bylo uloženo.');
  res.redirect(303, '/settings?tab=site');
});

router.post('/settings/delete', (req, res) => {
  const { models, sessions } = req.app.locals;
  const errors = [];
  if (!verifyPassword(str(req.body.password, 500), req.user.password_hash)) errors.push('Heslo není správné.');
  if (req.user.role === 'admin' && models.users.adminCount() === 1 && models.users.count() > 1) {
    errors.push('Jste jediný administrátor. Nejdříve jmenujte jiného administrátora.');
  }
  if (errors.length) return render(req, res, 'account', { errors }, 422);
  const id = req.user.id;
  sessions.logout(req, res);
  models.users.remove(id);
  sessions.flash(req, 'info', 'Váš účet byl smazán. Vaše příspěvky zůstávají jako „smazaný uživatel“.');
  res.redirect(303, '/');
});

module.exports = router;
