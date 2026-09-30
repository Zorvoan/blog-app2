'use strict';

// Správa stránek (pouze administrátor – kontroluje se při připojení routeru).

const express = require('express');
const { readPage, str, int } = require('../../forms');
const perms = require('../../permissions');
const { done, load, afterSave } = require('./helpers');
const { addHistoryRoutes } = require('./history');

const router = express.Router();
const BASE = '/admin/pages';

const loadPage = load('item', (models, id) => models.pages.byId(id));

function renderForm(res, { page = null, form, errors = [], statusCode = 200 }) {
  res.status(statusCode).render('admin/page-form', {
    title: page ? `Upravit stránku: ${page.title}` : 'Nová stránka', wide: true, page, form, errors,
  });
}

router.get('/', (req, res) => {
  const f = { q: str(req.query.q, 200).trim(), status: req.query.status || 'all' };
  res.render('admin/pages', { title: 'Stránky', wide: true, pages: req.app.locals.models.pages.list(f), f });
});

// Náhled neuložené stránky (SSR).
router.post('/preview', (req, res) => {
  const { data } = readPage(req.body, req.app.locals.models, int(req.body.id));
  const page = { ...data, id: null, updated_at: new Date().toISOString(), username: req.user.username, display_name: req.user.display_name };
  res.render('page', { title: `Náhled: ${data.title || 'bez názvu'}`, page, preview: 'unsaved' });
});

router.get('/new', (req, res) => {
  renderForm(res, { form: { title: '', slug: '', body: '', status: 'published', show_in_nav: '1', sort_order: 0 } });
});

router.post('/', (req, res) => {
  const { models } = req.app.locals;
  const { data, errors } = readPage(req.body, models);
  if (errors.length) return renderForm(res, { form: req.body, errors, statusCode: 422 });
  const id = models.pages.create(data, req.user.id);
  done(req, res, afterSave(req, `${BASE}/${id}/edit`, `/pages/${data.slug}`), 'Stránka byla vytvořena.');
});

router.get('/:id/edit', loadPage, (req, res) => {
  const page = req.item;
  renderForm(res, {
    page,
    form: { title: page.title, slug: page.slug, body: page.body, status: page.status, show_in_nav: page.show_in_nav ? '1' : '', sort_order: page.sort_order },
  });
});

router.post('/:id', loadPage, (req, res) => {
  const { models } = req.app.locals;
  const { data, errors } = readPage(req.body, models, req.item.id);
  if (errors.length) return renderForm(res, { page: req.item, form: req.body, errors, statusCode: 422 });
  models.pages.update(req.item.id, data, req.user.id);
  done(req, res, afterSave(req, `${BASE}/${req.item.id}/edit`, `/pages/${data.slug}`), 'Stránka byla uložena.');
});

router.post('/:id/delete', loadPage, (req, res) => {
  req.app.locals.models.pages.remove(req.item.id);
  done(req, res, BASE, 'Stránka byla smazána.');
});

addHistoryRoutes(router, {
  entity: 'page',
  base: BASE,
  loadItem: loadPage,
  canEdit: perms.canEditPage,
  restore: (models, page, rev, note, userId) => models.pages.update(page.id, {
    title: rev.title, slug: page.slug, body: rev.body, status: page.status,
    showInNav: !!page.show_in_nav, sortOrder: page.sort_order, note,
  }, userId),
});

module.exports = router;
