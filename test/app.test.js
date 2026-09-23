'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../src/app');

let server;
let base;
let app;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-test-'));

before(async () => {
  app = createApp({ dbFile: path.join(tmp, 'test.db') });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Jednoduchý klient s cookie jar.
function client() {
  let cookie = '';
  const c = {
    async req(method, url, form) {
      const res = await fetch(base + url, {
        method, redirect: 'manual',
        headers: { cookie, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
        body: form ? new URLSearchParams(form) : undefined,
      });
      const set = res.headers.getSetCookie();
      for (const s of set) {
        const [pair] = s.split(';');
        cookie = pair;
      }
      const text = await res.text();
      return { status: res.status, location: res.headers.get('location'), text };
    },
    get: (url) => c.req('GET', url),
    async post(url, form = {}) {
      const token = await c.csrfAny();
      return c.req('POST', url, { _csrf: token, ...form });
    },
    async csrfAny() {
      const r = await c.get('/csrf-token');
      return JSON.parse(r.text).token;
    },
  };
  return c;
}

const alice = client();
const bob = client();
const anon = client();

test('registrace: první uživatel je admin', async () => {
  let r = await alice.post('/register', { username: 'alice', display_name: 'Alice', password: 'heslo1234', password_confirm: 'heslo1234' });
  assert.equal(r.status, 303);
  r = await alice.get('/settings');
  assert.equal(r.status, 200);
  assert.match(r.text, /@alice · admin/);

  r = await bob.post('/register', { username: 'bob', password: 'heslo1234', password_confirm: 'heslo1234' });
  assert.equal(r.status, 303);
  r = await bob.get('/admin/users');
  assert.equal(r.status, 403, 'bob není admin');
});

test('registrace: validace', async () => {
  const c = client();
  const r = await c.post('/register', { username: 'alice', password: 'x', password_confirm: 'y' });
  assert.equal(r.status, 422);
  assert.match(r.text, /obsazené/);
  assert.match(r.text, /alespoň 8 znaků/);
});

test('přihlášení a odhlášení', async () => {
  const c = client();
  let r = await c.post('/login', { login: 'alice', password: 'špatně' });
  assert.equal(r.status, 422);
  r = await c.post('/login', { login: 'alice', password: 'heslo1234', next: '/admin' });
  assert.equal(r.status, 303);
  assert.equal(r.location, '/admin');
  r = await c.get('/admin');
  assert.equal(r.status, 200);
  r = await c.post('/logout');
  r = await c.get('/admin');
  assert.equal(r.status, 303);
  assert.match(r.location, /^\/login/);
});

test('open redirect po přihlášení je blokován', async () => {
  const c = client();
  const r = await c.post('/login', { login: 'alice', password: 'heslo1234', next: '//evil.example' });
  assert.equal(r.location, '/');
});

test('CSRF: POST bez tokenu je odmítnut', async () => {
  const r = await alice.req('POST', '/admin/posts', { title: 'x' });
  assert.equal(r.status, 403);
});

let catId;
test('rubriky: vytvoření, úprava', async () => {
  let r = await alice.post('/admin/categories', { name: 'Technika', description: 'Vše o technice', color: '#ff0000' });
  assert.equal(r.status, 303);
  r = await alice.get('/admin/categories');
  catId = Number(r.text.match(/\/admin\/categories\/(\d+)\/edit/)[1]);
  r = await alice.post('/admin/categories', { name: 'technika' });
  assert.equal(r.status, 422, 'duplicitní název');
  r = await bob.post(`/admin/categories/${catId}`, { name: 'Hack', color: '#00ff00' });
  assert.equal(r.status, 403, 'běžný uživatel nespravuje rubriky');
  r = await bob.get('/admin/categories');
  assert.equal(r.status, 403);
  r = await alice.post(`/admin/categories/${catId}`, { name: 'Technika a věda', color: '#00ff00' });
  assert.equal(r.status, 303);
  r = await anon.get('/c/technika-a-veda');
  assert.equal(r.status, 200);
  assert.match(r.text, /r\/Technika a věda/);
});

let postId;
test('příspěvky: vytvoření jako text, štítky, zobrazení', async () => {
  let r = await alice.post('/admin/posts', {
    title: 'Ahoj <světe>', body: 'Text s **tučným** a #hashtag\n\n<script>alert(1)</script>', category_id: catId, status: 'published', tags: 'první, test',
  });
  assert.equal(r.status, 303);
  postId = Number(r.location.match(/\/p\/(\d+)/)[1]);
  r = await anon.get(`/p/${postId}`);
  assert.equal(r.status, 200);
  assert.match(r.text, /Ahoj &lt;světe&gt;/);
  assert.match(r.text, /<strong>tučným<\/strong>/);
  assert.doesNotMatch(r.text, /<script>alert/);
  assert.match(r.text, /href="\/t\/hashtag"/);
  r = await anon.get('/t/test');
  assert.match(r.text, /Ahoj &lt;světe&gt;/);
  r = await anon.get('/');
  assert.match(r.text, /Ahoj &lt;světe&gt;/);
});

test('příspěvky: běžný uživatel nesmí upravit cizí příspěvek', async () => {
  let r = await bob.get(`/admin/posts/${postId}/edit`);
  assert.equal(r.status, 403);
  r = await bob.post(`/admin/posts/${postId}`, { title: 'Upraveno Bobem', body: 'Nový text', status: 'published' });
  assert.equal(r.status, 403);
  r = await bob.get(`/admin/posts/${postId}/history`);
  assert.equal(r.status, 404);
  r = await anon.get(`/p/${postId}`);
  assert.doesNotMatch(r.text, /Upraveno Bobem/);
  r = await bob.get(`/p/${postId}`);
  assert.doesNotMatch(r.text, new RegExp(`/admin/posts/${postId}/edit`), 'bez odkazu Upravit');
  r = await bob.get('/admin/posts');
  assert.doesNotMatch(r.text, /Ahoj &lt;světe&gt;/, 've správě vidí jen své příspěvky');
  r = await bob.get('/admin/tags');
  assert.equal(r.status, 403, 'štítky spravuje jen admin');
  r = await bob.get('/');
  assert.doesNotMatch(r.text, /href="\/admin\/(pages|categories|tags|users)"/, 'odkazy na správu jsou skryté');
  r = await alice.get('/');
  assert.match(r.text, /href="\/admin\/categories"/);
});

test('příspěvky: autor upravuje svůj příspěvek, vzniká revize', async () => {
  let r = await alice.post(`/admin/posts/${postId}`, { title: 'Upravený titulek', body: 'Nový text', category_id: catId, status: 'published', note: 'oprava' });
  assert.equal(r.status, 303);
  r = await anon.get(`/p/${postId}`);
  assert.match(r.text, /Upravený titulek/);
  r = await alice.get(`/admin/posts/${postId}/history`);
  assert.match(r.text, /2 revizí/);
  assert.match(r.text, /oprava/);
});

test('příspěvky: administrátor smí upravit cizí příspěvek', async () => {
  let r = await bob.post('/admin/posts', { title: 'Bobův příspěvek', body: 'text', status: 'published' });
  const id = Number(r.location.match(/\/p\/(\d+)/)[1]);
  r = await bob.get(`/admin/posts/${id}/edit`);
  assert.equal(r.status, 200, 'vlastní příspěvek upravit smí');
  r = await alice.get(`/admin/posts/${id}/edit`);
  assert.equal(r.status, 200);
  assert.match(r.text, /Jako administrátor upravujete příspěvek uživatele/);
  r = await alice.post(`/admin/posts/${id}`, { title: 'Moderováno', body: 'text', status: 'published' });
  assert.equal(r.status, 303);
  r = await anon.get(`/p/${id}`);
  assert.match(r.text, /Naposledy upravil\(a\) <a href="\/u\/alice">/);
});

test('příspěvky: obnovení revize', async () => {
  let r = await alice.get(`/admin/posts/${postId}/history`);
  const ids = [...r.text.matchAll(/revisions\/(\d+)\/restore/g)].map((m) => m[1]);
  assert.ok(ids.length >= 1);
  r = await alice.post(`/admin/posts/${postId}/revisions/${ids[ids.length - 1]}/restore`);
  assert.equal(r.status, 303);
  r = await anon.get(`/p/${postId}`);
  assert.match(r.text, /Ahoj &lt;světe&gt;/);
});

test('příspěvky: mazat smí jen autor / admin; koš a obnova', async () => {
  let r = await bob.post(`/admin/posts/${postId}/trash`);
  assert.equal(r.status, 403);
  r = await alice.post(`/admin/posts/${postId}/trash`);
  assert.equal(r.status, 303);
  r = await anon.get(`/p/${postId}`);
  assert.equal(r.status, 404);
  r = await alice.get('/admin/posts?trash=1');
  assert.match(r.text, /Ahoj &lt;světe&gt;/);
  r = await alice.post(`/admin/posts/${postId}/restore`);
  assert.equal(r.status, 303);
  r = await anon.get(`/p/${postId}`);
  assert.equal(r.status, 200);
});

test('koncepty vidí jen autor', async () => {
  let r = await bob.post('/admin/posts', { title: 'Bobův koncept', body: 'tajné', status: 'draft' });
  const id = Number(r.location.match(/\/p\/(\d+)/)[1]);
  r = await bob.get(`/p/${id}`);
  assert.equal(r.status, 200);
  assert.match(r.text, /Náhled/);
  r = await anon.get(`/p/${id}`);
  assert.equal(r.status, 404);
  r = await anon.get('/');
  assert.doesNotMatch(r.text, /Bobův koncept/);
  r = await alice.get(`/p/${id}`);
  assert.equal(r.status, 200, 'admin vidí vše');
});

test('hromadné akce', async () => {
  const r1 = await alice.post('/admin/posts', { title: 'Hromadný A', body: 'a', status: 'published' });
  const r2 = await alice.post('/admin/posts', { title: 'Hromadný B', body: 'b', status: 'published' });
  const ids = [r1, r2].map((r) => r.location.match(/\/p\/(\d+)/)[1]);
  const body = new URLSearchParams({ _csrf: await alice.csrfAny(), action: 'draft', back: '/admin/posts' });
  ids.forEach((id) => body.append('ids', id));
  let r = await alice.req('POST', '/admin/posts/bulk', body);
  assert.equal(r.status, 303);
  r = await alice.get('/admin/posts?status=draft');
  assert.match(r.text, /Hromadný A/);
  assert.match(r.text, /Hromadný B/);
});

test('náhled neuloženého příspěvku a stránky (SSR)', async () => {
  let r = await alice.post('/admin/preview', { type: 'post', title: 'Náhledový titulek', body: '# Nadpis\n- bod', category_id: catId });
  assert.equal(r.status, 200);
  assert.match(r.text, /Náhledový titulek/);
  assert.match(r.text, /<h2>Nadpis<\/h2>/);
  assert.match(r.text, /obsah zatím není uložen/);
  r = await alice.post('/admin/preview', { type: 'page', title: 'Stránka X', body: 'obsah' });
  assert.match(r.text, /Stránka X/);
  r = await alice.post('/admin/render', { body: '**b**' });
  assert.equal(r.text, '<p><strong>b</strong></p>');
});

test('stránky: CRUD, slug, navigace, historie', async () => {
  let r = await alice.post('/admin/pages', { title: 'Kontakt ČR', body: 'Pište nám', status: 'published', show_in_nav: '1', sort_order: '1' });
  assert.equal(r.status, 303);
  assert.equal(r.location, '/pages/kontakt-cr');
  r = await anon.get('/pages/kontakt-cr');
  assert.equal(r.status, 200);
  assert.match(r.text, /Pište nám/);
  assert.match(r.text, /href="\/pages\/kontakt-cr"/);
  r = await alice.get('/admin/pages');
  const id = r.text.match(/\/admin\/pages\/(\d+)\/edit/)[1];
  r = await bob.post(`/admin/pages/${id}`, { title: 'Hack', slug: 'hack', body: 'x', status: 'published' });
  assert.equal(r.status, 403, 'běžný uživatel nespravuje stránky');
  r = await bob.get(`/admin/pages/${id}/history`);
  assert.equal(r.status, 403);
  r = await alice.post(`/admin/pages/${id}`, { title: 'Kontakt', slug: 'kontakt', body: 'Nový obsah', status: 'draft' });
  assert.equal(r.status, 303);
  r = await anon.get('/pages/kontakt');
  assert.equal(r.status, 404, 'koncept není veřejný');
  r = await bob.get('/pages/kontakt');
  assert.equal(r.status, 404, 'koncept stránky nevidí ani přihlášený uživatel');
  r = await alice.get(`/admin/pages/${id}/history`);
  assert.match(r.text, /2 revizí/);
  r = await bob.post(`/admin/pages/${id}/delete`);
  assert.equal(r.status, 403);
  r = await alice.post(`/admin/pages/${id}/delete`);
  assert.equal(r.status, 303);
});

test('hlasování a komentáře', async () => {
  let r = await bob.req('POST', `/p/${postId}/vote`, { _csrf: await bob.csrfAny(), value: '1' });
  assert.equal(r.status, 303);
  const res = await fetch(`${base}/p/${postId}/vote`, { method: 'POST', headers: { accept: 'application/json', 'x-csrf-token': await alice.csrfAny(), cookie: '' } });
  assert.equal(res.status, 403, 'cizí token bez relace je odmítnut');
  r = await bob.post(`/p/${postId}/comments`, { body: 'Super @alice!' });
  assert.equal(r.status, 303);
  r = await anon.get(`/p/${postId}`);
  assert.match(r.text, /Komentáře \(1\)/);
  assert.match(r.text, /href="\/u\/alice">@alice/);
  assert.match(r.text, /class="score">1</);
});

test('štítky: přejmenování, sloučení a smazání', async () => {
  await alice.post('/admin/posts', { title: 'Štítkový', body: 'x', status: 'published', tags: 'alfa, beta, gama' });
  const idOf = (html, name) => html.match(new RegExp(`action="/admin/tags/(\\d+)" class="inline-form">[\\s\\S]*?value="${name}"`))[1];
  let r = await alice.get('/admin/tags');
  r = await alice.post(`/admin/tags/${idOf(r.text, 'alfa')}`, { name: 'Omega' });
  assert.equal(r.status, 303);
  r = await alice.get('/admin/tags');
  assert.match(r.text, /value="omega"/);
  r = await alice.post(`/admin/tags/${idOf(r.text, 'beta')}`, { name: 'gama' });
  r = await alice.get('/admin/tags');
  assert.doesNotMatch(r.text, /value="beta"/, 'beta sloučena do gama');
  r = await alice.post(`/admin/tags/${idOf(r.text, 'gama')}/delete`);
  r = await anon.get('/t/gama');
  assert.match(r.text, /S tímto štítkem nejsou žádné příspěvky/);
});

test('nastavení: profil, heslo, motiv, web', async () => {
  let r = await bob.post('/settings/profile', { display_name: 'Bob Stavitel', email: 'bob@example.com', bio: 'Ahoj' });
  assert.equal(r.status, 303);
  r = await anon.get('/u/bob');
  assert.match(r.text, /Bob Stavitel/);
  r = await bob.post('/settings/appearance', { theme: 'dark' });
  r = await bob.get('/');
  assert.match(r.text, /data-theme="dark"/);
  r = await bob.post('/settings/password', { current_password: 'heslo1234', new_password: 'noveheslo1', new_password_confirm: 'noveheslo1' });
  assert.equal(r.status, 303);
  r = await bob.post('/settings/site', { site_name: 'Hack' });
  assert.equal(r.status, 403);
  r = await alice.post('/settings/site', { site_name: 'Můj Blog', site_tagline: 'x', posts_per_page: '10', allow_registration: '' });
  assert.equal(r.status, 303);
  r = await anon.get('/register');
  assert.match(r.text, /Registrace nových uživatelů je momentálně vypnutá/);
  r = await anon.get('/');
  assert.match(r.text, /<title>Můj Blog<\/title>/);
});

test('rubriky: smazání přesune příspěvky', async () => {
  let r = await bob.post(`/admin/categories/${catId}/delete`);
  assert.equal(r.status, 403);
  r = await alice.post(`/admin/categories/${catId}/delete`, { move_to: '' });
  assert.equal(r.status, 303);
  r = await anon.get(`/p/${postId}`);
  assert.equal(r.status, 200);
});

test('smazání účtu', async () => {
  let r = await bob.post('/settings/delete', { password: 'noveheslo1' });
  assert.equal(r.status, 303);
  r = await anon.get(`/p/${postId}`);
  assert.match(r.text, /\[smazaný uživatel\]/);
});

test('offline: service worker, manifest a offline stránka', async () => {
  let r = await anon.get('/sw.js');
  assert.equal(r.status, 200);
  assert.match(r.text, /addEventListener\('fetch'/);
  r = await anon.get('/manifest.webmanifest');
  assert.equal(r.status, 200);
  r = await anon.get('/offline');
  assert.match(r.text, /Jste offline/);
});
