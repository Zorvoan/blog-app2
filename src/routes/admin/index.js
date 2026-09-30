'use strict';

// Administrace: přehled + připojení jednotlivých sekcí.
//   /admin/posts       – vlastní příspěvky (každý přihlášený)
//   /admin/pages       – stránky            (administrátor)
//   /admin/categories  – rubriky            (administrátor)
//   /admin/tags        – štítky             (administrátor)
//   /admin/users       – uživatelé          (administrátor)

const express = require('express');
const { requireLogin, requireAdmin } = require('../../auth');
const { renderText } = require('../../format');
const { str } = require('../../forms');
const perms = require('../../permissions');
const { load, done } = require('./helpers');
const { categories, tags } = require('./taxonomy');

const router = express.Router();
router.use(requireLogin);

router.get('/', (req, res) => {
  const { models } = req.app.locals;
  const admin = perms.isAdmin(req.user);
  res.render('admin/dashboard', {
    title: 'Administrace', wide: true, admin,
    counts: {
      ...models.posts.counts(req.user.id),
      pages: models.pages.count(),
      categories: res.locals.allCategories.length,
      comments: models.comments.count(),
      users: models.users.count(),
    },
    mine: models.posts.list({ viewer: req.user, authorId: req.user.id, status: 'all', sort: 'updated', limit: 5 }).items,
    activity: models.revisions.recent(12, req.user.id, admin),
  });
});

// Fragment pro živý náhled v editoru (fetch z JS).
router.post('/render', (req, res) => {
  res.type('html').send(renderText(str(req.body.body)));
});

router.use('/posts', require('./posts'));
router.use('/pages', requireAdmin, require('./pages'));
router.use('/categories', requireAdmin, categories);
router.use('/tags', requireAdmin, tags);

// ---------------------------------------------------------------- uživatelé
const users = express.Router();
users.get('/', (req, res) => {
  res.render('admin/users', { title: 'Uživatelé', wide: true, users: req.app.locals.models.users.list() });
});
users.post('/:id/role', load('target', (models, id) => models.users.byId(id)), (req, res) => {
  const { models } = req.app.locals;
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  if (req.target.role === 'admin' && role === 'user' && models.users.adminCount() === 1) {
    return done(req, res, '/admin/users', 'Musí zůstat alespoň jeden administrátor.', 'error');
  }
  models.users.setRole(req.target.id, role);
  done(req, res, '/admin/users', `@${req.target.username} je nyní ${role === 'admin' ? 'administrátor' : 'uživatel'}.`);
});
router.use('/users', requireAdmin, users);

module.exports = router;
