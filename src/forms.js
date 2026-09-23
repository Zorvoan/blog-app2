'use strict';

const { parseTags, slugify } = require('./format');

const str = (v, max = 100000) => String(v ?? '').replace(/\r\n?/g, '\n').slice(0, max);
const int = (v, def = 0) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
};
const status = (v) => (v === 'draft' ? 'draft' : 'published');

// Příspěvky se zadávají výhradně jako text – žádné nahrávání souborů.
function readPost(body, models) {
  const data = {
    title: str(body.title, 300).trim(),
    body: str(body.body).trim(),
    categoryId: int(body.category_id) || null,
    status: status(body.status),
    pinned: body.pinned === '1',
    tagsInput: str(body.tags, 500),
    note: str(body.note, 200).trim(),
  };
  data.tagNames = parseTags(data.tagsInput, data.body);
  const errors = [];
  if (!data.title) errors.push('Zadejte titulek příspěvku.');
  if (data.body.length > 50000) errors.push('Text příspěvku je příliš dlouhý (max. 50 000 znaků).');
  if (data.categoryId && !models.categories.byId(data.categoryId)) errors.push('Zvolená rubrika neexistuje.');
  return { data, errors };
}

function readPage(body, models, exceptId = 0) {
  const data = {
    title: str(body.title, 300).trim(),
    slugInput: str(body.slug, 100).trim(),
    body: str(body.body).trim(),
    status: status(body.status),
    showInNav: body.show_in_nav === '1',
    sortOrder: int(body.sort_order),
    note: str(body.note, 200).trim(),
  };
  const errors = [];
  if (!data.title) errors.push('Zadejte název stránky.');
  if (data.body.length > 100000) errors.push('Obsah stránky je příliš dlouhý.');
  const wanted = slugify(data.slugInput || data.title);
  if (data.slugInput && !wanted) errors.push('Adresa (slug) musí obsahovat písmena nebo číslice.');
  data.slug = models.pages.uniqueSlug(wanted || data.title, exceptId);
  return { data, errors };
}

function readCategory(body, models, exceptId = 0) {
  const data = {
    name: str(body.name, 60).trim(),
    slugInput: str(body.slug, 80).trim(),
    description: str(body.description, 500).trim(),
    color: /^#[0-9a-f]{6}$/i.test(body.color) ? body.color.toLowerCase() : '#1d9bf0',
    sortOrder: int(body.sort_order),
  };
  const errors = [];
  if (!data.name) errors.push('Zadejte název rubriky.');
  const dup = data.name && models.db.prepare('SELECT id FROM categories WHERE name = ? AND id != ?').get(data.name, exceptId);
  if (dup) errors.push('Rubrika s tímto názvem již existuje.');
  data.slug = models.categories.uniqueSlug(data.slugInput || data.name, exceptId);
  return { data, errors };
}

module.exports = { readPost, readPage, readCategory, str, int };
