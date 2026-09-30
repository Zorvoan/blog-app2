'use strict';

// Kategorizace: rubriky a štítky (pouze administrátor – kontroluje se při připojení routerů).

const express = require('express');
const { readCategory, int } = require('../../forms');
const { parseTags } = require('../../format');
const { done, load } = require('./helpers');

// ---------------------------------------------------------------- rubriky
const categories = express.Router();
const CAT_BASE = '/admin/categories';
const EMPTY_CATEGORY = { name: '', slug: '', description: '', color: '#1d9bf0', sort_order: 0 };
const loadCategory = load('cat', (models, id) => models.categories.byId(id));

const renderList = (res, form = EMPTY_CATEGORY, errors = [], statusCode = 200) =>
  res.status(statusCode).render('admin/categories', { title: 'Rubriky', wide: true, form, errors });
const renderEdit = (res, cat, form = cat, errors = [], statusCode = 200) =>
  res.status(statusCode).render('admin/category-form', { title: `Upravit rubriku: ${cat.name}`, wide: true, cat, form, errors });

categories.get('/', (req, res) => renderList(res));

categories.post('/', (req, res) => {
  const { models } = req.app.locals;
  const { data, errors } = readCategory(req.body, models);
  if (errors.length) return renderList(res, req.body, errors, 422);
  models.categories.create(data, req.user.id);
  done(req, res, CAT_BASE, `Rubrika „${data.name}“ byla vytvořena.`);
});

categories.get('/:id/edit', loadCategory, (req, res) => renderEdit(res, req.cat));

categories.post('/:id', loadCategory, (req, res) => {
  const { models } = req.app.locals;
  const { data, errors } = readCategory(req.body, models, req.cat.id);
  if (errors.length) return renderEdit(res, req.cat, req.body, errors, 422);
  models.categories.update(req.cat.id, data);
  done(req, res, CAT_BASE, 'Rubrika byla uložena.');
});

categories.post('/:id/delete', loadCategory, (req, res) => {
  const { models } = req.app.locals;
  const moveTo = int(req.body.move_to) || null;
  if (moveTo === req.cat.id || (moveTo && !models.categories.byId(moveTo))) {
    return done(req, res, `${CAT_BASE}/${req.cat.id}/edit`, 'Neplatná cílová rubrika.', 'error');
  }
  models.categories.remove(req.cat.id, moveTo);
  done(req, res, CAT_BASE, `Rubrika „${req.cat.name}“ byla smazána.`);
});

// ---------------------------------------------------------------- štítky
const tags = express.Router();
const TAG_BASE = '/admin/tags';
const loadTag = load('tag', (models, id) => models.tags.byId(id));

tags.get('/', (req, res) => {
  res.render('admin/tags', { title: 'Štítky', wide: true, tags: req.app.locals.models.tags.all() });
});

// Přejmenování na existující název štítky sloučí.
tags.post('/:id', loadTag, (req, res) => {
  const { models } = req.app.locals;
  const [name] = parseTags(req.body.name);
  if (!name) return done(req, res, TAG_BASE, 'Neplatný název štítku (povolena písmena, číslice, - a _).', 'error');
  const merged = models.tags.byName(name) && name !== req.tag.name.toLowerCase();
  models.tags.rename(req.tag.id, name);
  done(req, res, TAG_BASE, merged ? `Štítek #${req.tag.name} byl sloučen do #${name}.` : `Štítek přejmenován na #${name}.`);
});

tags.post('/:id/delete', loadTag, (req, res) => {
  req.app.locals.models.tags.remove(req.tag.id);
  done(req, res, TAG_BASE, `Štítek #${req.tag.name} byl odstraněn ze všech příspěvků.`);
});

module.exports = { categories, tags };
