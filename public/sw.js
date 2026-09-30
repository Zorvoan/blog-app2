/* Service worker – offline režim.
 *  - Navštívené stránky se ukládají (network-first), offline se zobrazí uložená verze.
 *  - Statické soubory: stale-while-revalidate.
 *  - Formuláře (příspěvky, stránky, rubriky, komentáře) odeslané bez připojení se uloží
 *    do IndexedDB fronty a po obnovení spojení se automaticky odešlou.
 */
'use strict';

const VERSION = 'v2';
const STATIC_CACHE = `static-${VERSION}`;
const PAGE_CACHE = 'pages';
const STATIC_FILES = ['/css/style.css', '/js/app.js', '/icons.svg', '/icon.svg', '/manifest.webmanifest'];
const QUEUEABLE = /^\/(admin\/(posts|pages|categories)(\/\d+)?|p\/\d+\/comments)$/;

// ---------------------------------------------------------------- IndexedDB fronta
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('blog-offline', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('outbox', mode);
    const result = fn(tx.objectStore('outbox'));
    tx.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}

const outboxAll = () => store('readonly', (s) => s.getAll());
const outboxAdd = (item) => store('readwrite', (s) => s.add(item));
const outboxPut = (item) => store('readwrite', (s) => s.put(item));
const outboxDelete = (id) => store('readwrite', (s) => s.delete(id));

async function notify(extra = {}) {
  const items = await outboxAll();
  const msg = {
    type: 'outbox',
    pending: items.filter((i) => i.status === 'pending').length,
    failed: items.filter((i) => i.status === 'failed').length,
    ...extra,
  };
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach((c) => c.postMessage(msg));
}

let flushing = null;
function flushOutbox() {
  if (!flushing) flushing = doFlush().finally(() => { flushing = null; });
  return flushing;
}

async function doFlush() {
  const items = (await outboxAll()).filter((i) => i.status === 'pending');
  if (!items.length) return notify();
  let token;
  try {
    const r = await fetch('/csrf-token', { credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok) throw new Error('csrf');
    token = (await r.json()).token;
  } catch {
    return notify(); // stále offline
  }
  let synced = 0;
  for (const item of items) {
    const body = new URLSearchParams(item.fields);
    body.set('_csrf', token);
    let res;
    try {
      res = await fetch(item.url, { method: 'POST', body, credentials: 'same-origin', redirect: 'follow' });
    } catch {
      break; // spojení opět spadlo
    }
    const path = new URL(res.url).pathname;
    if (res.ok && path !== '/login') {
      await outboxDelete(item.id);
      synced++;
    } else {
      item.status = 'failed';
      item.error = path === '/login' ? 'Nejste přihlášeni.' : `Server odpověděl ${res.status}.`;
      await outboxPut(item);
    }
  }
  return notify({ synced });
}

// ---------------------------------------------------------------- životní cyklus
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const s = await caches.open(STATIC_CACHE);
    await s.addAll(STATIC_FILES);
    const p = await caches.open(PAGE_CACHE);
    await Promise.all(['/offline', '/'].map((u) => p.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('static-') && key !== STATIC_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const { type } = event.data || {};
  if (type === 'sync') event.waitUntil(flushOutbox());
  else if (type === 'status') event.waitUntil(notify());
  else if (type === 'retry-failed') {
    event.waitUntil((async () => {
      for (const i of await outboxAll()) if (i.status === 'failed') { i.status = 'pending'; await outboxPut(i); }
      await flushOutbox();
    })());
  } else if (type === 'discard-failed') {
    event.waitUntil((async () => {
      for (const i of await outboxAll()) if (i.status === 'failed') await outboxDelete(i.id);
      await notify();
    })());
  } else if (type === 'clear-pages') {
    event.waitUntil(caches.delete(PAGE_CACHE).then(() => event.source?.postMessage({ type: 'cleared' })));
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'outbox') event.waitUntil(flushOutbox());
});

// ---------------------------------------------------------------- požadavky
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.method === 'POST') {
    if (req.mode === 'navigate' && QUEUEABLE.test(url.pathname)) event.respondWith(postWithQueue(event));
    else if (req.mode === 'navigate') event.respondWith(fetch(req).catch(offlinePage));
    return;
  }
  if (req.method !== 'GET' || url.pathname === '/csrf-token') return;

  if (STATIC_FILES.includes(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event));
  } else if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(networkFirst(req));
  }
});

async function staleWhileRevalidate(event) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(event.request);
  const refresh = fetch(event.request).then((res) => {
    if (res.ok) cache.put(event.request, res.clone());
    return res;
  });
  if (cached) {
    event.waitUntil(refresh.catch(() => {}));
    return cached;
  }
  return refresh;
}

async function networkFirst(req) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic' && !res.redirected) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req)) || offlinePage();
  }
}

async function offlinePage() {
  const cache = await caches.open(PAGE_CACHE);
  return (await cache.match('/offline')) ||
    new Response('<!doctype html><meta charset="utf-8"><title>Offline</title><p>Jste offline.</p>', {
      status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
}

async function postWithQueue(event) {
  const req = event.request;
  const copy = req.clone();
  try {
    return await fetch(req);
  } catch {
    const form = await copy.formData();
    const fields = [...form.entries()].filter(([, v]) => typeof v === 'string');
    const title = form.get('title') || form.get('name') || String(form.get('body') || '').slice(0, 40);
    await outboxAdd({
      url: new URL(req.url).pathname, fields, status: 'pending', createdAt: Date.now(),
      label: title ? String(title) : 'Položka',
    });
    try { await self.registration.sync?.register('outbox'); } catch { /* Background Sync není podporován */ }
    await notify({ queued: true });
    const back = req.referrer && new URL(req.referrer).origin === self.location.origin ? req.referrer : '/';
    return Response.redirect(back, 303);
  }
}
