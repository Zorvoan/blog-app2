'use strict';

const express = require('express');
const { requireLogin, requireAdmin } = require('../auth');
const { readPost, readPage, readCategory, str, int } = require('../forms');
const { renderText, parseTags } = require('../format');
const perms = require('../permissions');

const router = express.Router();
router.use(requireLogin);
// Stránky, rubriky, štítky a uživatele spravuje pouze administrátor.
router.use(['/pages', '/categories', '/tags', '/users'], requireAdmin);

const denied = (res, message = 'K této akci nemáte oprávnění.') =>
  res.status(403).render('error', { title: 'Přístup odepřen', message });

const idsFrom = (v) => [].concat(v ?? []).map((x) => int(x)).filter((x) => x > 0);

// ---------------------------------------------------------------- přehled
router.get('/', (req, res) => {
  const { models } = req.app.locals;
  const admin = perms.isAdmin(req.user);
  const mine = models.posts.list({ viewer: req.user, authorId: req.user.id, status: 'all', sort: 'updated', limit: 5 });
  res.render('admin/dashboard', {
    title: 'Administrace', wide: true, admin,
    counts: {
      ...models.posts.counts(req.user.id),
      pages: models.pages.count(),
      categories: res.locals.allCategories.length,
      comments: models.comments.count(),
      users: models.users.count(),
    },
    mine: mine.items,
    activity: models.revisions.recent(12, req.user.id, admin),
  });
});

// ---------------------------------------------------------------- náhled
// Náhled neuloženého obsahu je renderován na serveru stejnou šablonou jako ostrá verze.
router.post('/preview', (req, res) => {
  const { models } = req.app.locals;
  if (req.body.type === 'page') {
    if (!perms.isAdmin(req.user)) return denied(res);
    const { data } = readPage(req.body, models, int(req.body.id));
    const page = { ...data, id: int(req.body.id) || null, updated_at: new Date().toISOString(), username: req.user.username, display_name: req.user.display_name };
    return res.render('page', { title: `Náhled: ${data.title || 'bez názvu'}`, page, preview: 'unsaved' });
  }
  const { data } = readPost(req.body, models);
  const cat = data.categoryId && models.categories.byId(data.categoryId);
  const existing = int(req.body.id) ? models.posts.byId(int(req.body.id), req.user.id) : null;
  const post = {
    id: existing?.id || 0, title: data.title || 'Bez titulku', body: data.body, status: data.status,
    created_at: existing?.created_at || new Date().toISOString(), published_at: existing?.published_at,
    updated_at: new Date().toISOString(),
    username: existing ? existing.username : req.user.username,
    display_name: existing ? existing.display_name : req.user.display_name,
    cat_name: cat?.name, cat_slug: cat?.slug, cat_color: cat?.color,
    score: existing?.score || 0, comment_count: existing?.comment_count || 0, my_vote: null,
    tags: data.tagNames, pinned: data.pinned,
  };
  res.render('post', { title: `Náhled: ${post.title}`, post, comments: [], preview: 'unsaved' });
});

// Fragment pro živý náhled v editoru (fetch z JS).
router.post('/render', (req, res) => {
  res.type('html').send(renderText(str(req.body.body)));
});

// ---------------------------------------------------------------- příspěvky
router.get('/posts', (req, res) => {
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
    viewer: req.user, q: f.q, status: f.status, categoryId: f.category || undefined,
    // Ve správě má každý (i administrátor) jen své příspěvky – cizí upravovat ani mazat nesmí.
    authorId: req.user.id, trash: f.trash, sort: f.sort,
    limit: perPage, offset: (page - 1) * perPage,
  });
  res.render('admin/posts', {
    title: 'Příspěvky', wide: true, posts: items, total, f, page,
    totalPages: Math.max(1, Math.ceil(total / perPage)), counts: models.posts.counts(req.user.id),
  });
});

function renderPostForm(res, { post = null, form, errors = [], statusCode = 200 }) {
  res.status(statusCode).render('admin/post-form', {
    title: post ? `Upravit: ${post.title}` : 'Nový příspěvek', wide: true, post, form, errors,
  });
}

router.get('/posts/new', (req, res) => {
  renderPostForm(res, {
    form: { title: '', body: '', category_id: int(req.query.category) || '', status: 'published', tags: '', pinned: false },
  });
});

router.post('/posts', (req, res) => {
  const { models, sessions } = req.app.locals;
  const { data, errors } = readPost(req.body, models);
  if (!perms.canPinPost(req.user)) data.pinned = false;
  if (errors.length) return renderPostForm(res, { form: { ...req.body, pinned: data.pinned }, errors, statusCode: 422 });
  const id = models.posts.create(data, req.user.id);
  sessions.flash(req, 'success', data.status === 'draft' ? 'Koncept byl uložen.' : 'Příspěvek byl publikován.');
  res.redirect(303, req.body.after === 'edit' ? `/admin/posts/${id}/edit` : `/p/${id}`);
});

function loadPost(req, res, next) {
  const post = req.app.locals.models.posts.byId(int(req.params.id), req.user.id);
  if (!post || !perms.canViewPost(req.user, post)) return next('route');
  req.post = post;
  next();
}

router.get('/posts/:id/edit', loadPost, (req, res) => {
  const { post } = req;
  if (!perms.canEditPost(req.user, post)) return denied(res, 'Příspěvek může upravit jen jeho autor.');
  renderPostForm(res, {
    post,
    form: { title: post.title, body: post.body, category_id: post.category_id || '', status: post.status, tags: post.tags.join(', '), pinned: !!post.pinned },
  });
});

router.post('/posts/:id', loadPost, (req, res) => {
  const { models, sessions } = req.app.locals;
  const { post } = req;
  if (!perms.canEditPost(req.user, post)) return denied(res, 'Příspěvek může upravit jen jeho autor.');
  const { data, errors } = readPost(req.body, models);
  if (!perms.canPinPost(req.user)) data.pinned = !!post.pinned;
  if (errors.length) return renderPostForm(res, { post, form: { ...req.body, pinned: data.pinned }, errors, statusCode: 422 });
  models.posts.update(post.id, data, req.user.id);
  sessions.flash(req, 'success', 'Změny byly uloženy.');
  res.redirect(303, req.body.after === 'edit' ? `/admin/posts/${post.id}/edit` : `/p/${post.id}`);
});

router.post('/posts/:id/trash', loadPost, (req, res) => {
  const { models, sessions } = req.app.locals;
  if (!perms.canDeletePost(req.user, req.post)) return denied(res, 'Příspěvek může smazat jen jeho autor.');
  models.posts.trash([req.post.id]);
  sessions.flash(req, 'success', 'Příspěvek byl přesunut do koše.');
  res.redirect(303, '/admin/posts');
});

router.post('/posts/:id/restore', loadPost, (req, res) => {
  const { models, sessions } = req.app.locals;
  if (!perms.canDeletePost(req.user, req.post)) return denied(res, 'Příspěvek může obnovit jen jeho autor.');
  models.posts.restore([req.post.id]);
  sessions.flash(req, 'success', 'Příspěvek byl obnoven z koše.');
  res.redirect(303, '/admin/posts?trash=1');
});

router.post('/posts/:id/destroy', loadPost, (req, res) => {
  const { models, sessions } = req.app.locals;
  if (!perms.canDeletePost(req.user, req.post)) return denied(res, 'Příspěvek může smazat jen jeho autor.');
  models.posts.destroy([req.post.id]);
  sessions.flash(req, 'success', 'Příspěvek byl trvale smazán.');
  res.redirect(303, '/admin/posts?trash=1');
});

router.post('/posts/bulk', (req, res) => {
  const { models, sessions } = req.app.locals;
  const ids = idsFrom(req.body.ids);
  const action = req.body.action;
  const back = str(req.body.back, 500).startsWith('/admin/posts') ? str(req.body.back, 500) : '/admin/posts';
  if (!ids.length) {
    sessions.flash(req, 'error', 'Nevybrali jste žádné příspěvky.');
    return res.redirect(303, back);
  }
  const all = ids.map((id) => models.posts.raw(id)).filter(Boolean);
  const editable = all.filter((p) => perms.canEditPost(req.user, p) && !p.deleted_at);
  const owned = all.filter((p) => perms.canDeletePost(req.user, p));
  const pick = (list) => list.map((p) => p.id);
  let done = 0;

  switch (action) {
    case 'publish':
    case 'draft': {
      const list = owned.filter((p) => !p.deleted_at);
      if (list.length) models.posts.setStatus(pick(list), action === 'publish' ? 'published' : 'draft');
      done = list.length;
      break;
    }
    case 'move': {
      const catId = req.body.category_id === 'none' ? null : int(req.body.category_id);
      if (catId && !models.categories.byId(catId)) break;
      if (editable.length) models.posts.setCategory(pick(editable), catId);
      done = editable.length;
      break;
    }
    case 'trash': {
      const list = owned.filter((p) => !p.deleted_at);
      if (list.length) models.posts.trash(pick(list));
      done = list.length;
      break;
    }
    case 'restore': {
      const list = owned.filter((p) => p.deleted_at);
      if (list.length) models.posts.restore(pick(list));
      done = list.length;
      break;
    }
    case 'destroy': {
      const list = owned.filter((p) => p.deleted_at);
      if (list.length) models.posts.destroy(pick(list));
      done = list.length;
      break;
    }
    default:
      sessions.flash(req, 'error', 'Neznámá akce.');
      return res.redirect(303, back);
  }
  const skipped = ids.length - done;
  sessions.flash(req, done ? 'success' : 'error',
    `Hotovo: ${done} příspěvků.` + (skipped ? ` Přeskočeno ${skipped} (chybí oprávnění nebo nevhodný stav).` : ''));
  res.redirect(303, back);
});

// ---------------------------------------------------------------- historie revizí
function historyRoutes(entity) {
  const base = entity === 'post' ? '/posts' : '/pages';
  const load = (req) => {
    const { models } = req.app.locals;
    return entity === 'post' ? models.posts.byId(int(req.params.id), req.user.id) : models.pages.byId(int(req.params.id));
  };
  const canEdit = (user, item) => (entity === 'post' ? perms.canEditPost(user, item) && perms.canViewPost(user, item) : perms.canEditPage(user, item));

  router.get(`${base}/:id/history`, (req, res, next) => {
    const item = load(req);
    if (!item || !canEdit(req.user, item)) return next('route');
    const revs = req.app.locals.models.revisions.list(entity, item.id);
    res.render('admin/history', { title: `Historie: ${item.title}`, wide: true, entity, item, revs, base: `/admin${base}` });
  });

  router.post(`${base}/:id/revisions/:rid/restore`, (req, res, next) => {
    const { models, sessions } = req.app.locals;
    const item = load(req);
    if (!item || !canEdit(req.user, item)) return next('route');
    const rev = models.revisions.byId(entity, item.id, int(req.params.rid));
    if (!rev) return next('route');
    const note = `Obnovena revize #${rev.id}`;
    if (entity === 'post') {
      models.posts.update(item.id, {
        title: rev.title, body: rev.body, categoryId: item.category_id, status: item.status, pinned: !!item.pinned,
        tagNames: parseTags(item.tags.join(','), rev.body), note,
      }, req.user.id);
    } else {
      models.pages.update(item.id, {
        title: rev.title, slug: item.slug, body: rev.body, status: item.status,
        showInNav: !!item.show_in_nav, sortOrder: item.sort_order, note,
      }, req.user.id);
    }
    sessions.flash(req, 'success', `${note}.`);
    res.redirect(303, `/admin${base}/${item.id}/history`);
  });
}
historyRoutes('post');
historyRoutes('page');

// ---------------------------------------------------------------- stránky
router.get('/pages', (req, res) => {
  const { models } = req.app.locals;
  const f = { q: str(req.query.q, 200).trim(), status: req.query.status || 'all' };
  res.render('admin/pages', { title: 'Stránky', wide: true, pages: models.pages.list(f), f });
});

function renderPageForm(res, { page = null, form, errors = [], statusCode = 200 }) {
  res.status(statusCode).render('admin/page-form', {
    title: page ? `Upravit stránku: ${page.title}` : 'Nová stránka', wide: true, page, form, errors,
  });
}

router.get('/pages/new', (req, res) => {
  renderPageForm(res, { form: { title: '', slug: '', body: '', status: 'published', show_in_nav: '1', sort_order: 0 } });
});

router.post('/pages', (req, res) => {
  const { models, sessions } = req.app.locals;
  const { data, errors } = readPage(req.body, models);
  if (errors.length) return renderPageForm(res, { form: req.body, errors, statusCode: 422 });
  const id = models.pages.create(data, req.user.id);
  sessions.flash(req, 'success', 'Stránka byla vytvořena.');
  res.redirect(303, req.body.after === 'edit' ? `/admin/pages/${id}/edit` : `/pages/${data.slug}`);
});

function loadPage(req, res, next) {
  const page = req.app.locals.models.pages.byId(int(req.params.id));
  if (!page) return next('route');
  req.page = page;
  next();
}

router.get('/pages/:id/edit', loadPage, (req, res) => {
  const { page } = req;
  renderPageForm(res, {
    page,
    form: { title: page.title, slug: page.slug, body: page.body, status: page.status, show_in_nav: page.show_in_nav ? '1' : '', sort_order: page.sort_order },
  });
});

router.post('/pages/:id', loadPage, (req, res) => {
  const { models, sessions } = req.app.locals;
  const { page } = req;
  if (!perms.canEditPage(req.user, page)) return denied(res);
  const { data, errors } = readPage(req.body, models, page.id);
  if (errors.length) return renderPageForm(res, { page, form: req.body, errors, statusCode: 422 });
  models.pages.update(page.id, data, req.user.id);
  sessions.flash(req, 'success', 'Stránka byla uložena.');
  res.redirect(303, req.body.after === 'edit' ? `/admin/pages/${page.id}/edit` : `/pages/${data.slug}`);
});

router.post('/pages/:id/delete', loadPage, (req, res) => {
  const { models, sessions } = req.app.locals;
  if (!perms.canDeletePage(req.user, req.page)) return denied(res, 'Stránku může smazat jen její autor nebo administrátor.');
  models.pages.remove(req.page.id);
  sessions.flash(req, 'success', 'Stránka byla smazána.');
  res.redirect(303, '/admin/pages');
});

// ---------------------------------------------------------------- rubriky
router.get('/categories', (req, res) => {
  res.render('admin/categories', {
    title: 'Rubriky', wide: true, errors: [], form: { name: '', slug: '', description: '', color: '#1d9bf0', sort_order: 0 },
  });
});

router.post('/categories', (req, res) => {
  const { models, sessions } = req.app.locals;
  const { data, errors } = readCategory(req.body, models);
  if (errors.length) return res.status(422).render('admin/categories', { title: 'Rubriky', wide: true, errors, form: req.body });
  models.categories.create(data, req.user.id);
  sessions.flash(req, 'success', `Rubrika „${data.name}“ byla vytvořena.`);
  res.redirect(303, '/admin/categories');
});

function loadCategory(req, res, next) {
  const cat = req.app.locals.models.categories.byId(int(req.params.id));
  if (!cat) return next('route');
  req.cat = cat;
  next();
}

router.get('/categories/:id/edit', loadCategory, (req, res) => {
  res.render('admin/category-form', { title: `Upravit rubriku: ${req.cat.name}`, wide: true, cat: req.cat, form: req.cat, errors: [] });
});

router.post('/categories/:id', loadCategory, (req, res) => {
  const { models, sessions } = req.app.locals;
  if (!perms.canEditCategory(req.user, req.cat)) return denied(res);
  const { data, errors } = readCategory(req.body, models, req.cat.id);
  if (errors.length) {
    return res.status(422).render('admin/category-form', { title: `Upravit rubriku: ${req.cat.name}`, wide: true, cat: req.cat, form: req.body, errors });
  }
  models.categories.update(req.cat.id, data);
  sessions.flash(req, 'success', 'Rubrika byla uložena.');
  res.redirect(303, '/admin/categories');
});

router.post('/categories/:id/delete', loadCategory, (req, res) => {
  const { models, sessions } = req.app.locals;
  if (!perms.canDeleteCategory(req.user, req.cat)) return denied(res, 'Rubriku může smazat jen její zakladatel nebo administrátor.');
  const moveTo = int(req.body.move_to) || null;
  if (moveTo === req.cat.id || (moveTo && !models.categories.byId(moveTo))) {
    sessions.flash(req, 'error', 'Neplatná cílová rubrika.');
    return res.redirect(303, `/admin/categories/${req.cat.id}/edit`);
  }
  models.categories.remove(req.cat.id, moveTo);
  sessions.flash(req, 'success', `Rubrika „${req.cat.name}“ byla smazána.`);
  res.redirect(303, '/admin/categories');
});

// ---------------------------------------------------------------- štítky
router.get('/tags', (req, res) => {
  res.render('admin/tags', { title: 'Štítky', wide: true, tags: req.app.locals.models.tags.all() });
});

router.post('/tags/:id', (req, res, next) => {
  const { models, sessions } = req.app.locals;
  const tag = models.tags.byId(int(req.params.id));
  if (!tag) return next('route');
  const [name] = parseTags(req.body.name);
  if (!name) sessions.flash(req, 'error', 'Neplatný název štítku (povolena písmena, číslice, - a _).');
  else {
    const merged = models.tags.byName(name) && name !== tag.name.toLowerCase();
    models.tags.rename(tag.id, name);
    sessions.flash(req, 'success', merged ? `Štítek #${tag.name} byl sloučen do #${name}.` : `Štítek přejmenován na #${name}.`);
  }
  res.redirect(303, '/admin/tags');
});

router.post('/tags/:id/delete', (req, res, next) => {
  const { models, sessions } = req.app.locals;
  const tag = models.tags.byId(int(req.params.id));
  if (!tag) return next('route');
  models.tags.remove(tag.id);
  sessions.flash(req, 'success', `Štítek #${tag.name} byl odstraněn ze všech příspěvků.`);
  res.redirect(303, '/admin/tags');
});

// ---------------------------------------------------------------- uživatelé (admin)
router.get('/users', requireAdmin, (req, res) => {
  res.render('admin/users', { title: 'Uživatelé', wide: true, users: req.app.locals.models.users.list() });
});

router.post('/users/:id/role', requireAdmin, (req, res, next) => {
  const { models, sessions } = req.app.locals;
  const target = models.users.byId(int(req.params.id));
  if (!target) return next('route');
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  if (target.role === 'admin' && role === 'user' && models.users.adminCount() === 1) {
    sessions.flash(req, 'error', 'Musí zůstat alespoň jeden administrátor.');
  } else {
    models.users.setRole(target.id, role);
    sessions.flash(req, 'success', `@${target.username} je nyní ${role === 'admin' ? 'administrátor' : 'uživatel'}.`);
  }
  res.redirect(303, '/admin/users');
});

module.exports = router;
