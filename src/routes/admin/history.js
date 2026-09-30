'use strict';

// Historie revizí – stejné routy pro příspěvky i stránky.
// Přidá na router: GET /:id/history a POST /:id/revisions/:rid/restore.

const { int } = require('../../forms');
const { done, rememberBack, withBack } = require('./helpers');

function addHistoryRoutes(router, { entity, base, loadItem, canEdit, restore }) {
  const guard = [
    loadItem,
    (req, res, next) => (canEdit(req.user, req.item) ? next() : next('route')),
    rememberBack((req) => `${base}/${req.item.id}/edit`),
  ];

  router.get('/:id/history', guard, (req, res) => {
    const revs = req.app.locals.models.revisions.list(entity, req.item.id);
    res.render('admin/history', { title: `Historie: ${req.item.title}`, wide: true, entity, item: req.item, revs, base });
  });

  router.post('/:id/revisions/:rid/restore', guard, (req, res, next) => {
    const { models } = req.app.locals;
    const rev = models.revisions.byId(entity, req.item.id, int(req.params.rid));
    if (!rev) return next('route');
    const note = `Obnovena revize #${rev.id}`;
    restore(models, req.item, rev, note, req.user.id);
    done(req, res, withBack(`${base}/${req.item.id}/history`, res.locals.backUrl), `${note}.`);
  });
}

module.exports = { addHistoryRoutes };
