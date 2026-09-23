'use strict';

const crypto = require('node:crypto');

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const COOKIE = 'sid';

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const randomId = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');

function createSessions(models) {
  const { db } = models;

  function setCookie(res, id) {
    const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : '';
    res.append('Set-Cookie', `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure}`);
  }

  function newSession(res, userId = null) {
    const s = { id: randomId(), user_id: userId, csrf: randomId(18), flash: null, expires_at: Date.now() + SESSION_TTL_MS };
    db.prepare('INSERT INTO sessions (id, user_id, csrf, flash, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(s.id, s.user_id, s.csrf, s.flash, s.expires_at);
    setCookie(res, s.id);
    return s;
  }

  function middleware(req, res, next) {
    const sid = parseCookies(req.headers.cookie)[COOKIE];
    let s = sid ? db.prepare('SELECT * FROM sessions WHERE id = ?').get(sid) : null;
    if (s && s.expires_at < Date.now()) {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(s.id);
      s = null;
    }
    if (!s) s = newSession(res);
    else if (s.expires_at - Date.now() < SESSION_TTL_MS / 2) {
      s.expires_at = Date.now() + SESSION_TTL_MS;
      db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(s.expires_at, s.id);
      setCookie(res, s.id);
    }
    req.session = s;
    req.user = s.user_id ? models.users.byId(s.user_id) : null;
    next();
  }

  // Po přihlášení se vytvoří nové ID relace (ochrana proti session fixation).
  function login(req, res, userId) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(req.session.id);
    const flash = req.session.flash;
    req.session = newSession(res, userId);
    if (flash) setFlashRaw(req, flash);
    req.user = models.users.byId(userId);
  }

  function logout(req, res) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(req.session.id);
    req.session = newSession(res);
    req.user = null;
  }

  function setFlashRaw(req, raw) {
    req.session.flash = raw;
    db.prepare('UPDATE sessions SET flash = ? WHERE id = ?').run(raw, req.session.id);
  }

  function flash(req, type, message) {
    setFlashRaw(req, JSON.stringify({ type, message }));
  }

  function takeFlash(req) {
    if (!req.session.flash) return null;
    const f = JSON.parse(req.session.flash);
    setFlashRaw(req, null);
    return f;
  }

  function purgeExpired() {
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  }

  return { middleware, login, logout, flash, takeFlash, purgeExpired };
}

function csrfProtection(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const token = req.body?._csrf || req.get('x-csrf-token');
  const a = Buffer.from(String(token || ''));
  const b = Buffer.from(req.session.csrf);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  res.status(403);
  return res.render('error', { title: 'Neplatný formulář', message: 'Platnost formuláře vypršela. Obnovte stránku a zkuste to znovu.' });
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  return res.redirect(303, `/login?next=${encodeURIComponent(req.originalUrl)}`);
}

function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
  res.status(403);
  return res.render('error', { title: 'Přístup odepřen', message: 'Tato sekce je dostupná pouze administrátorům.' });
}

module.exports = { hashPassword, verifyPassword, createSessions, csrfProtection, requireLogin, requireAdmin };
