'use strict';

const path = require('node:path');
const express = require('express');
const { openDb } = require('./db');
const { createModels } = require('./models');
const { createSessions, csrfProtection } = require('./auth');
const fmt = require('./format');
const perms = require('./permissions');
const { icon } = require('./icons');
const { idempotency, newKey } = require('./idempotency');

const ROOT = path.join(__dirname, '..');

function createApp({ dbFile = process.env.DB_FILE || path.join(ROOT, 'data', 'blog.db') } = {}) {
  const db = openDb(dbFile);
  const models = createModels(db);
  const sessions = createSessions(models);
  sessions.purgeExpired();
  models.idempotency.purgeOlderThan(30);

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(ROOT, 'views'));
  app.disable('x-powered-by');
  app.locals.models = models;
  app.locals.sessions = sessions;
  Object.assign(app.locals, fmt, { perms, icon, newKey });

  // Vše se servíruje lokálně – žádné CDN ani externí zdroje.
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
        "connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    });
    next();
  });

  app.use(express.static(path.join(ROOT, 'public'), {
    setHeaders(res, file) {
      if (file.endsWith('sw.js')) res.set({ 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' });
    },
  }));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));
  app.use(sessions.middleware);

  app.use((req, res, next) => {
    // HTML stránky nesmí být cachovány prohlížečem (o offline cache se stará service worker).
    res.set('Cache-Control', 'no-store');
    const settings = models.getSettings();
    Object.assign(res.locals, {
      user: req.user,
      csrf: req.session.csrf,
      flash: req.method === 'GET' ? sessions.takeFlash(req) : null,
      settings,
      navPages: models.pages.nav(),
      allCategories: models.categories.all(),
      trendingTags: models.tags.trending(),
      currentPath: req.path,
      query: req.query,
      title: settings.site_name,
      wide: false,
      bare: false,
    });
    next();
  });
  app.use(csrfProtection);
  app.use(idempotency);

  app.use(require('./routes/auth'));
  app.use(require('./routes/settings'));
  app.use('/admin', require('./routes/admin'));
  app.use(require('./routes/public'));

  app.use((req, res) => {
    res.status(404).render('error', { title: 'Nenalezeno', message: 'Požadovaná stránka neexistuje.' });
  });

  app.use((err, req, res, _next) => {
    console.error(err);
    if (res.headersSent) return;
    res.status(err.status || 500);
    const message = err.status && err.status < 500 ? err.message : 'Na serveru došlo k chybě.';
    try {
      res.render('error', { title: 'Chyba', message });
    } catch {
      res.type('text').send(message);
    }
  });

  app.close = () => db.close();
  return app;
}

module.exports = { createApp };
