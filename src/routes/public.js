'use strict';

const express = require('express');
const { requireLogin } = require('../auth');
const { str, int } = require('../forms');
const perms = require('../permissions');

const router = express.Router();

const SORTS = { hot: 'Populární', new: 'Nové', top: 'Top' };

function feed(req, res, { filter = {}, ...view }) {
  const { models } = req.app.locals;
  const perPage = int(res.locals.settings.posts_per_page, 20);
  const page = Math.max(1, int(req.query.page, 1));
  const sort = SORTS[req.query.sort] ? req.query.sort : 'hot';
  const { items, total } = models.posts.list({
    viewer: req.user, sort, limit: perPage, offset: (page - 1) * perPage, ...filter,
  });
  res.render('feed', {
    posts: items, total, page, sort, sorts: SORTS,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    showCompose: false, header: null, emptyText: 'Zatím tu nic není.',
    ...view,
  });
}

router.get('/', (req, res) => {
  feed(req, res, { title: res.locals.settings.site_name, heading: 'Domů', showCompose: !!req.user });
});

router.get('/c/:slug', (req, res, next) => {
  const cat = req.app.locals.models.categories.bySlug(req.params.slug);
  if (!cat) return next();
  feed(req, res, {
    title: `r/${cat.name}`, heading: cat.name, filter: { categoryId: cat.id },
    header: { kind: 'category', cat }, showCompose: !!req.user, composeCategory: cat.id,
    emptyText: 'V této rubrice zatím nejsou žádné příspěvky.',
  });
});

router.get('/t/:tag', (req, res) => {
  const tag = String(req.params.tag).toLowerCase();
  feed(req, res, {
    title: `#${tag}`, heading: `#${tag}`, filter: { tag },
    header: { kind: 'tag', tag }, emptyText: 'S tímto štítkem nejsou žádné příspěvky.',
  });
});

router.get('/u/:username', (req, res, next) => {
  const { models } = req.app.locals;
  const profile = models.users.byUsername(req.params.username);
  if (!profile) return next();
  feed(req, res, {
    title: `${profile.display_name} (@${profile.username})`, heading: profile.display_name,
    filter: { authorId: profile.id, status: req.user?.id === profile.id ? 'all' : 'published' },
    header: { kind: 'user', profile, stats: models.users.stats(profile.id) },
    emptyText: 'Uživatel zatím nic nenapsal.',
  });
});

router.get('/search', (req, res) => {
  const q = str(req.query.q, 200).trim();
  if (!q) return res.render('search', { title: 'Hledat', q });
  feed(req, res, {
    title: `Hledat: ${q}`, heading: 'Výsledky hledání', filter: { q },
    header: { kind: 'search', q }, emptyText: 'Nic nenalezeno.',
  });
});

router.get('/categories', (req, res) => {
  res.render('categories', { title: 'Rubriky' });
});

router.get('/p/:id', (req, res, next) => {
  const { models } = req.app.locals;
  const post = models.posts.byId(int(req.params.id), req.user?.id);
  if (!post || (post.deleted_at && !perms.canDeletePost(req.user, post))) return next();
  if (!perms.canViewPost(req.user, post)) return next();
  res.render('post', {
    title: post.title, post, comments: models.comments.forPost(post.id),
    preview: post.status === 'draft' || !!post.deleted_at ? 'saved' : null,
  });
});

function backTo(req, fallback) {
  const ref = req.get('referer');
  try {
    const u = new URL(ref);
    if (u.host === req.get('host')) return u.pathname + u.search;
  } catch { /* neplatný referer */ }
  return fallback;
}

router.post('/p/:id/vote', requireLogin, (req, res, next) => {
  const { models } = req.app.locals;
  const post = models.posts.raw(int(req.params.id));
  if (!post || post.deleted_at || post.status !== 'published') return next();
  const value = req.body.value === '-1' ? -1 : 1;
  models.posts.vote(post.id, req.user.id, value);
  if (req.get('accept')?.includes('application/json')) {
    const p = models.posts.byId(post.id, req.user.id);
    return res.json({ score: p.score, myVote: p.my_vote ?? 0 });
  }
  res.redirect(303, backTo(req, `/p/${post.id}`) + `#post-${post.id}`);
});

router.post('/p/:id/comments', requireLogin, (req, res, next) => {
  const { models, sessions } = req.app.locals;
  const post = models.posts.raw(int(req.params.id));
  if (!post || post.deleted_at || post.status !== 'published') return next();
  const body = str(req.body.body, 5000).trim();
  if (!body) sessions.flash(req, 'error', 'Komentář nesmí být prázdný.');
  else models.comments.create(post.id, req.user.id, body);
  res.redirect(303, `/p/${post.id}#comments`);
});

router.post('/comments/:id/delete', requireLogin, (req, res, next) => {
  const { models, sessions } = req.app.locals;
  const c = models.comments.byId(int(req.params.id));
  if (!c) return next();
  if (!perms.canDeleteComment(req.user, c)) return res.status(403).render('error', { title: 'Přístup odepřen', message: 'Tento komentář nemůžete smazat.' });
  models.comments.remove(c.id);
  sessions.flash(req, 'success', 'Komentář byl smazán.');
  res.redirect(303, `/p/${c.post_id}#comments`);
});

router.get('/pages/:slug', (req, res, next) => {
  const page = req.app.locals.models.pages.bySlug(req.params.slug);
  if (!page || !perms.canViewPage(req.user, page)) return next();
  res.render('page', { title: page.title, page, preview: page.status === 'draft' ? 'saved' : null });
});

// Aktuální CSRF token pro odeslání offline fronty (čitelné jen ze stejného originu).
router.get('/csrf-token', (req, res) => {
  res.json({ token: req.session.csrf, user: req.user?.username ?? null });
});

router.get('/offline', (req, res) => {
  res.render('offline', { title: 'Offline' });
});

module.exports = router;
