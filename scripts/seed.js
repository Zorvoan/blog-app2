'use strict';

// Naplní lokální databázi ukázkovými daty (uživatelé, rubriky, stránky, příspěvky).
// Použití: npm run seed

const path = require('node:path');
const { openDb } = require('../src/db');
const { createModels } = require('../src/models');
const { hashPassword } = require('../src/auth');
const { parseTags } = require('../src/format');

const file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'blog.db');
const models = createModels(openDb(file));

if (models.users.count() > 0) {
  console.log('Databáze již obsahuje data – seed přeskočen.');
  process.exit(0);
}

const admin = models.users.create({ username: 'admin', email: 'admin@example.com', displayName: 'Administrátor', passwordHash: hashPassword('admin12345'), role: 'admin' });
const jana = models.users.create({ username: 'jana', displayName: 'Jana Nováková', passwordHash: hashPassword('jana12345') });

const cats = [
  ['Novinky', 'Co je nového v komunitě', '#1d9bf0'],
  ['Technologie', 'Programování, hardware a software', '#7856ff'],
  ['Cestování', 'Tipy na výlety a zážitky', '#00ba7c'],
  ['Offtopic', 'Vše ostatní', '#f91880'],
].map(([name, description, color], i) =>
  models.categories.create({ name, slug: models.categories.uniqueSlug(name), description, color, sortOrder: i }, admin));

models.pages.create({ title: 'O nás', slug: 'o-nas', status: 'published', showInNav: true, sortOrder: 0,
  body: '# O projektu\n\nTento blog je **komunitní** – každý přihlášený může psát i upravovat příspěvky ostatních.\n\n- vše běží lokálně\n- funguje i offline\n- historie změn u každého příspěvku' }, admin);
models.pages.create({ title: 'Pravidla', slug: 'pravidla', status: 'published', showInNav: true, sortOrder: 1,
  body: '1. Buďte slušní.\n2. Úpravy cizích příspěvků dělejte s rozmyslem – vše je v historii.\n3. Žádný spam.' }, admin);

const posts = [
  [admin, cats[0], 'Vítejte na Blogíku!', 'Toto je první příspěvek. Pište texty, hlasujte a komentujte.\n\nFormátování: **tučně**, *kurzíva*, `kód`, odkazy [takto](https://example.com), #štítky a @zmínky.', 'vitejte'],
  [jana, cats[2], 'Víkend v Krkonoších', 'Doporučuji výstup na Sněžku z Pece pod Sněžkou.\n\n> Nahoře byl krásný výhled!\n\n#hory #výlet', ''],
  [admin, cats[1], 'Proč SQLite stačí', 'Pro menší weby je SQLite ideální volba:\n\n- žádný server\n- jeden soubor\n- rychlé čtení\n\n```\nSELECT * FROM posts;\n```', 'databaze sqlite'],
  [jana, cats[3], 'Nejlepší kafe ve městě?', 'Hledám tipy na kavárny. Pište do komentářů!', 'kava'],
];
for (const [author, cat, title, body, tagsInput] of posts) {
  models.posts.create({ title, body, categoryId: cat, status: 'published', pinned: false, tagNames: parseTags(tagsInput, body) }, author);
}
models.posts.create({ title: 'Rozepsaný koncept', body: 'Tohle zatím vidím jen já.', categoryId: cats[1], status: 'draft', pinned: false, tagNames: [] }, admin);

console.log('Hotovo. Přihlášení: admin / admin12345, jana / jana12345');
