'use strict';

// Šipka zpět a přesměrování po uložení vedou tam, odkud uživatel přišel.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');

let server;
let base;
let app;
let cookie = '';
let postId;

async function req(method, url, { form, referer } = {}) {
  const headers = { cookie };
  if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
  if (referer) headers.referer = referer.startsWith('http') ? referer : base + referer;
  const res = await fetch(base + url, { method, redirect: 'manual', headers, body: form ? new URLSearchParams(form) : undefined });
  for (const s of res.headers.getSetCookie()) cookie = s.split(';')[0];
  return { status: res.status, location: res.headers.get('location'), text: await res.text() };
}
const csrf = async () => JSON.parse((await req('GET', '/csrf-token')).text).token;
const post = async (url, form = {}, opts = {}) => req('POST', url, { ...opts, form: { _csrf: await csrf(), ...form } });
const backArrow = (html) => html.match(/<a class="plain-btn icon-btn" href="([^"]*)" aria-label="Zpět">/)[1].replace(/&amp;/g, '&');
const backField = (html) => html.match(/name="back" value="([^"]*)"/)?.[1].replace(/&amp;/g, '&');

before(async () => {
  app = createApp({ dbFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blog-nav-')), 'nav.db') });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  await post('/register', { username: 'marek', password: 'heslo1234', password_confirm: 'heslo1234' });
  await post('/admin/categories', { name: 'Novinky' });
  const r = await post('/admin/posts', { title: 'Můj příspěvek', body: 'text', status: 'published', category_id: '1' });
  postId = r.location.match(/\/p\/(\d+)/)[1];
});

after(() => {
  server.close();
  app.close();
});

const EDIT = () => `/admin/posts/${postId}/edit`;
const fields = { title: 'Můj příspěvek', body: 'upraveno', status: 'published', category_id: '1' };

test('úprava otevřená z domovské stránky: šipka i uložení vedou zpět domů', async () => {
  const r = await req('GET', EDIT(), { referer: '/?sort=new' });
  assert.equal(backArrow(r.text), '/?sort=new');
  assert.equal(backField(r.text), '/?sort=new');
  const saved = await post(`/admin/posts/${postId}`, { ...fields, back: backField(r.text) });
  assert.equal(saved.location, `/?sort=new#post-${postId}`, 'po uložení zpět na výpis, odscrollováno na příspěvek');
});

test('úprava otevřená ze správy příspěvků / z rubriky / z příspěvku vrací tamtéž', async () => {
  for (const from of ['/admin/posts?status=published', '/c/novinky', `/p/${postId}`]) {
    const r = await req('GET', EDIT(), { referer: from });
    assert.equal(backArrow(r.text), from);
    const saved = await post(`/admin/posts/${postId}`, { ...fields, back: backField(r.text) });
    assert.ok(saved.location.startsWith(from), `${from} → ${saved.location}`);
  }
});

test('bez znalosti původu vede šipka na výchozí stránku sekce', async () => {
  assert.equal(backArrow((await req('GET', EDIT())).text), '/admin/posts');
  assert.equal(backArrow((await req('GET', EDIT(), { referer: EDIT() })).text), '/admin/posts', 'obnovení stránky');
  assert.equal(backArrow((await req('GET', '/admin/pages/new')).text), '/admin/pages');
});

test('cizí web ani podvržený parametr back se nepoužijí', async () => {
  assert.equal(backArrow((await req('GET', EDIT(), { referer: 'http://zly-web.cz/' })).text), '/admin/posts');
  assert.equal(backArrow((await req('GET', `${EDIT()}?back=//zly-web.cz`)).text), '/admin/posts');
  const saved = await post(`/admin/posts/${postId}`, { ...fields, back: 'https://zly-web.cz' });
  assert.equal(saved.location, '/admin/posts');
});

test('"Uložit a pokračovat" zachová cíl návratu', async () => {
  const saved = await post(`/admin/posts/${postId}`, { ...fields, back: '/', after: 'edit' });
  assert.equal(saved.location, `${EDIT()}?back=%2F`);
  assert.equal(backArrow((await req('GET', saved.location, { referer: EDIT() })).text), '/');
});

test('Zobrazit a Historie z editoru se vrací do editoru a odtud dál na původní stránku', async () => {
  const editor = await req('GET', EDIT(), { referer: '/' });
  const selfUrl = `${EDIT()}?back=%2F`;
  assert.ok(editor.text.includes(`href="/p/${postId}?back=${encodeURIComponent(selfUrl)}"`));
  const history = await req('GET', `/admin/posts/${postId}/history?back=${encodeURIComponent(selfUrl)}`);
  assert.equal(backArrow(history.text), selfUrl);
  const view = await req('GET', `/p/${postId}?back=${encodeURIComponent(selfUrl)}`);
  assert.equal(backArrow(view.text), selfUrl);
});

test('šipka na stránce příspěvku vede tam, odkud uživatel přišel', async () => {
  assert.equal(backArrow((await req('GET', `/p/${postId}`, { referer: '/u/marek' })).text), '/u/marek');
  assert.equal(backArrow((await req('GET', `/p/${postId}`)).text), '/c/novinky', 'bez původu: rubrika příspěvku');
});

test('po smazání se nevracíme na smazaný příspěvek', async () => {
  const r = await post('/admin/posts', { title: 'Ke smazání', body: 'x', status: 'published' });
  const id = r.location.match(/\/p\/(\d+)/)[1];
  let del = await post(`/admin/posts/${id}/trash`, { back: `/p/${id}` });
  assert.equal(del.location, '/admin/posts');
  await post(`/admin/posts/${id}/restore`);
  del = await post(`/admin/posts/${id}/trash`, { back: '/?sort=top' });
  assert.equal(del.location, '/?sort=top');
});
