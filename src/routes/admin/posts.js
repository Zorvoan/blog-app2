'use strict';

// Správa příspěvků. Upravit, smazat i obnovit příspěvek smí pouze jeho autor.

const express = require('express');
const { readPost, str, int } = require('../../forms');
const { parseTags } = require('../../format');
const perms = require('../../permissions');
const { done, load, allow, idsFrom, afterSave } = require('./helpers');
const { addHistoryRoutes } = require('./history');

const router = express.Router();
const BASE = '/admin/posts';

const loadPost = load('item', (models, id, req) => {
  const post = models.posts.byId(id, req.user.id);
  return post && perms.canViewPost(req.user, post) ? post : null;
});
const ownerOnly = (verb) => allow((req) => perms.canEditPost(req.user, req.item), `Příspěvek může ${verb} jen jeho autor.`);

function renderForm(res, { post = null, form, errors = [], statusCode = 200 }) {
  res.status(statusCode).render('admin/post-form', {
    title: post ? `Upravit: ${post.title}` : 'Nový příspěvek', wide: true, post, form, errors,
  });
}

// ---------------------------------------------------------------- seznam (jen vlastní příspěvky)
router.get('/', (req, res) => {
  const { models } = req.app.locals;
  const f = {
    q: str(req.query.q, 200).trim(),
    status: ['published', 'draft'].includes(req.query.status) ? req.query.status : 'all',
    category: req.query.category === 'none' ? 'none' : int(req.query.category) || '',
    trash: req.query.trash === '1',
    sort: ['updated', 'new', 'top', 'title'].includes(req.query.sort) ? req.query.sort : 'updated',
  };
  const perPage = 30;
  const page = Math.max(1, int(req.query.page, 1));
  const { items, total } = models.posts.list({
    viewer: req.user, authorId: req.user.id, q: f.q, status: f.status, categoryId: f.category || undefined,
    trash: f.trash, sort: f.sort, limit: perPage, offset: (page - 1) * perPage,
  });
  res.render('admin/posts', {
    title: 'Příspěvky', wide: true, posts: items, total, f, page,
    totalPages: Math.max(1, Math.ceil(total / perPage)), counts: models.posts.counts(req.user.id),
  });
});

// ---------------------------------------------------------------- náhled neuloženého příspěvku (SSR)
router.post('/preview', (req, res) => {
  const { models } = req.app.locals;
  const { data } = readPost(req.body, models);
  const cat = data.categoryId && models.categories.byId(data.categoryId);
  const existing = int(req.body.id) ? models.posts.byId(int(req.body.id), req.user.id) : null;
  const author = existing || req.user;
  const post = {
    id: 0, title: data.title || 'Bez titulku', body: data.body, status: data.status, pinned: data.pinned, tags: data.tagNames,
    created_at: existing?.created_at || new Date().toISOString(), published_at: existing?.published_at,
    username: author.username, display_name: author.display_name,
    cat_name: cat?.name, cat_slug: cat?.slug, cat_color: cat?.color,
    score: existing?.score || 0, comment_count: existing?.comment_count || 0, my_vote: null,
  };
  res.render('post', { title: `Náhled: ${post.title}`, post, comments: [], preview: 'unsaved' });
});

// ---------------------------------------------------------------- hromadné akce
// Každá akce: které příspěvky se jí týkají a co s nimi udělat.
const BULK = {
  publish: { applies: (p) => !p.deleted_at, run: (m, ids) => m.posts.setStatus(ids, 'published') },
  draft: { applies: (p) => !p.deleted_at, run: (m, ids) => m.posts.setStatus(ids, 'draft') },
  move: { applies: (p) => !p.deleted_at, run: (m, ids, req) => m.posts.setCategory(ids, int(req.body.category_id) || null) },
  trash: { applies: (p) => !p.deleted_at, run: (m, ids) => m.posts.trash(ids) },
  restore: { applies: (p) => !!p.deleted_at, run: (m, ids) => m.posts.restore(ids) },
  destroy: { applies: (p) => !!p.deleted_at, run: (m, ids) => m.posts.destroy(ids) },
};

router.post('/bulk', (req, res) => {
  const { models } = req.app.locals;
  const ids = idsFrom(req.body.ids);
  const back = str(req.body.back, 500).startsWith(BASE) ? str(req.body.back, 500) : BASE;
  const action = BULK[req.body.action];
  if (!action) return done(req, res, back, 'Neznámá akce.', 'error');
  if (!ids.length) return done(req, res, back, 'Nevybrali jste žádné příspěvky.', 'error');
  if (req.body.action === 'move' && int(req.body.category_id) && !models.categories.byId(int(req.body.category_id))) {
    return done(req, res, back, 'Zvolená rubrika neexistuje.', 'error');
  }
  const targets = ids.map((id) => models.posts.raw(id))
    .filter((p) => p && perms.canEditPost(req.user, p) && action.applies(p))
    .map((p) => p.id);
  if (targets.length) action.run(models, targets, req);
  const skipped = ids.length - targets.length;
  done(req, res, back,
    `Hotovo: ${targets.length} příspěvků.` + (skipped ? ` Přeskočeno ${skipped} (cizí příspěvek nebo nevhodný stav).` : ''),
    targets.length ? 'success' : 'error');
});

// ---------------------------------------------------------------- vytvoření
router.get('/new', (req, res) => {
  renderForm(res, { form: { title: '', body: '', category_id: int(req.query.category) || '', status: 'published', tags: '', pinned: false } });
});

router.post('/', (req, res) => {
  const { models } = req.app.locals;
  const { data, errors } = readPost(req.body, models);
  if (!perms.canPinPost(req.user)) data.pinned = false;
  if (errors.length) return renderForm(res, { form: { ...req.body, pinned: data.pinned }, errors, statusCode: 422 });
  const id = models.posts.create(data, req.user.id);
  done(req, res, afterSave(req, `${BASE}/${id}/edit`, `/p/${id}`),
    data.status === 'draft' ? 'Koncept byl uložen.' : 'Příspěvek byl publikován.');
});

// ---------------------------------------------------------------- úprava a mazání (jen autor)
router.get('/:id/edit', loadPost, ownerOnly('upravit'), (req, res) => {
  const post = req.item;
  renderForm(res, {
    post,
    form: { title: post.title, body: post.body, category_id: post.category_id || '', status: post.status, tags: post.tags.join(', '), pinned: !!post.pinned },
  });
});

router.post('/:id', loadPost, ownerOnly('upravit'), (req, res) => {
  const { models } = req.app.locals;
  const post = req.item;
  const { data, errors } = readPost(req.body, models);
  if (!perms.canPinPost(req.user)) data.pinned = !!post.pinned;
  if (errors.length) return renderForm(res, { post, form: { ...req.body, pinned: data.pinned }, errors, statusCode: 422 });
  models.posts.update(post.id, data, req.user.id);
  done(req, res, afterSave(req, `${BASE}/${post.id}/edit`, `/p/${post.id}`), 'Změny byly uloženy.');
});

router.post('/:id/trash', loadPost, ownerOnly('smazat'), (req, res) => {
  req.app.locals.models.posts.trash([req.item.id]);
  done(req, res, BASE, 'Příspěvek byl přesunut do koše.');
});

router.post('/:id/restore', loadPost, ownerOnly('obnovit'), (req, res) => {
  req.app.locals.models.posts.restore([req.item.id]);
  done(req, res, `${BASE}?trash=1`, 'Příspěvek byl obnoven z koše.');
});

router.post('/:id/destroy', loadPost, ownerOnly('smazat'), (req, res) => {
  req.app.locals.models.posts.destroy([req.item.id]);
  done(req, res, `${BASE}?trash=1`, 'Příspěvek byl trvale smazán.');
});

addHistoryRoutes(router, {
  entity: 'post',
  base: BASE,
  loadItem: loadPost,
  canEdit: perms.canEditPost,
  restore: (models, post, rev, note, userId) => models.posts.update(post.id, {
    title: rev.title, body: rev.body, categoryId: post.category_id, status: post.status, pinned: !!post.pinned,
    tagNames: parseTags(post.tags.join(','), rev.body), note,
  }, userId),
});

module.exports = router;
