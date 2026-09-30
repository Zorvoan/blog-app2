'use strict';

const { now } = require('./db');
const { slugify } = require('./format');

const DEFAULT_SETTINGS = {
  site_name: 'Blogík',
  site_tagline: 'Komunitní blog – piš, hlasuj, diskutuj.',
  posts_per_page: '20',
  allow_registration: '1',
};

const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => '\\' + c);
const placeholders = (arr) => arr.map(() => '?').join(',');

function createModels(db) {
  // Unikátní adresa (slug) v dané tabulce: "o-nas", "o-nas-2", …
  function uniqueSlug(table, input, fallback, exceptId = 0) {
    const exists = db.prepare(`SELECT 1 FROM ${table} WHERE slug = ? AND id != ?`);
    const base = slugify(input) || fallback;
    let slug = base;
    for (let n = 2; exists.get(slug, exceptId); n++) slug = `${base}-${n}`;
    return slug;
  }

  // ---------- nastavení ----------
  function getSettings() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const s = { ...DEFAULT_SETTINGS };
    for (const r of rows) s[r.key] = r.value;
    return s;
  }
  function saveSettings(obj) {
    const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    db.tx(() => {
      for (const [k, v] of Object.entries(obj)) if (k in DEFAULT_SETTINGS) stmt.run(k, String(v));
    });
  }

  // ---------- uživatelé ----------
  const users = {
    byId: (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id),
    byUsername: (u) => db.prepare('SELECT * FROM users WHERE username = ?').get(u),
    byLogin: (login) => db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(login, login),
    count: () => db.prepare('SELECT COUNT(*) n FROM users').get().n,
    create({ username, email, passwordHash, displayName, role = 'user' }) {
      const r = db.prepare(
        'INSERT INTO users (username, email, password_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(username, email || null, passwordHash, displayName || username, role, now());
      return Number(r.lastInsertRowid);
    },
    updateProfile(id, { displayName, email, bio }) {
      db.prepare('UPDATE users SET display_name = ?, email = ?, bio = ? WHERE id = ?').run(displayName, email || null, bio, id);
    },
    setPassword: (id, hash) => db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id),
    setTheme: (id, theme) => db.prepare('UPDATE users SET theme = ? WHERE id = ?').run(theme, id),
    setRole: (id, role) => db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id),
    adminCount: () => db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin'").get().n,
    remove: (id) => db.prepare('DELETE FROM users WHERE id = ?').run(id),
    list: () => db.prepare(`
      SELECT u.*, (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id AND p.deleted_at IS NULL) post_count
      FROM users u ORDER BY u.created_at`).all(),
    stats: (id) => db.prepare(`
      SELECT (SELECT COUNT(*) FROM posts WHERE author_id = ? AND status = 'published' AND deleted_at IS NULL) posts,
             (SELECT COUNT(*) FROM comments WHERE author_id = ?) comments,
             (SELECT COALESCE(SUM(v.value), 0) FROM votes v JOIN posts p ON p.id = v.post_id WHERE p.author_id = ?) karma
    `).get(id, id, id),
  };

  // ---------- rubriky ----------
  const categories = {
    all: () => db.prepare(`
      SELECT c.*, (SELECT COUNT(*) FROM posts p WHERE p.category_id = c.id AND p.status = 'published' AND p.deleted_at IS NULL) post_count
      FROM categories c ORDER BY c.sort_order, c.name`).all(),
    byId: (id) => db.prepare('SELECT * FROM categories WHERE id = ?').get(id),
    bySlug: (slug) => db.prepare('SELECT * FROM categories WHERE slug = ?').get(slug),
    uniqueSlug: (name, exceptId) => uniqueSlug('categories', name, 'rubrika', exceptId),
    create({ name, slug, description, color, sortOrder }, userId) {
      const r = db.prepare(
        'INSERT INTO categories (name, slug, description, color, sort_order, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(name, slug, description, color, sortOrder, userId, now());
      return Number(r.lastInsertRowid);
    },
    update(id, { name, slug, description, color, sortOrder }) {
      db.prepare('UPDATE categories SET name = ?, slug = ?, description = ?, color = ?, sort_order = ? WHERE id = ?')
        .run(name, slug, description, color, sortOrder, id);
    },
    remove(id, moveTo) {
      db.tx(() => {
        db.prepare('UPDATE posts SET category_id = ? WHERE category_id = ?').run(moveTo || null, id);
        db.prepare('DELETE FROM categories WHERE id = ?').run(id);
      });
    },
  };

  // ---------- štítky ----------
  const tags = {
    all: () => db.prepare(`
      SELECT t.id, t.name, COUNT(p.id) post_count
      FROM tags t
      LEFT JOIN post_tags pt ON pt.tag_id = t.id
      LEFT JOIN posts p ON p.id = pt.post_id AND p.deleted_at IS NULL
      GROUP BY t.id ORDER BY post_count DESC, t.name`).all(),
    trending: (limit = 8) => db.prepare(`
      SELECT t.name, COUNT(*) n FROM post_tags pt
      JOIN tags t ON t.id = pt.tag_id
      JOIN posts p ON p.id = pt.post_id AND p.status = 'published' AND p.deleted_at IS NULL
      GROUP BY t.id ORDER BY MAX(julianday(p.published_at)) > julianday('now', '-7 days') DESC, n DESC LIMIT ?`).all(limit),
    byId: (id) => db.prepare('SELECT * FROM tags WHERE id = ?').get(id),
    byName: (name) => db.prepare('SELECT * FROM tags WHERE name = ?').get(name),
    forPosts(ids) {
      const map = new Map(ids.map((id) => [id, []]));
      if (!ids.length) return map;
      const rows = db.prepare(`
        SELECT pt.post_id, t.name FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
        WHERE pt.post_id IN (${placeholders(ids)}) ORDER BY t.name`).all(...ids);
      for (const r of rows) map.get(r.post_id)?.push(r.name);
      return map;
    },
    setForPost(postId, names) {
      db.prepare('DELETE FROM post_tags WHERE post_id = ?').run(postId);
      const ins = db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING');
      const link = db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) SELECT ?, id FROM tags WHERE name = ?');
      for (const n of names) {
        ins.run(n);
        link.run(postId, n);
      }
    },
    // Přejmenování na existující název = sloučení štítků.
    rename(id, newName) {
      db.tx(() => {
        const target = db.prepare('SELECT id FROM tags WHERE name = ? AND id != ?').get(newName, id);
        if (target) {
          db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) SELECT post_id, ? FROM post_tags WHERE tag_id = ?').run(target.id, id);
          db.prepare('DELETE FROM tags WHERE id = ?').run(id);
        } else {
          db.prepare('UPDATE tags SET name = ? WHERE id = ?').run(newName, id);
        }
      });
    },
    remove: (id) => db.prepare('DELETE FROM tags WHERE id = ?').run(id),
    pruneUnused: () => db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM post_tags)').run(),
  };

  // ---------- revize ----------
  const revisions = {
    add(entity, entityId, { title, body }, editorId, note = '') {
      db.prepare('INSERT INTO revisions (entity, entity_id, title, body, editor_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(entity, entityId, title, body, editorId, note, now());
    },
    list: (entity, entityId) => db.prepare(`
      SELECT r.*, u.username editor_username, u.display_name editor_name
      FROM revisions r LEFT JOIN users u ON u.id = r.editor_id
      WHERE r.entity = ? AND r.entity_id = ? ORDER BY r.id DESC`).all(entity, entityId),
    byId: (entity, entityId, id) => db.prepare('SELECT * FROM revisions WHERE entity = ? AND entity_id = ? AND id = ?').get(entity, entityId, id),
    // Změny příspěvků daného autora; withPages = navíc změny stránek (přehled administrátora).
    recent: (limit, authorId, withPages = false) => db.prepare(`
      SELECT r.id, r.entity, r.entity_id, r.title, r.note, r.created_at, u.username editor_username, u.display_name editor_name
      FROM revisions r LEFT JOIN users u ON u.id = r.editor_id
      WHERE (r.entity = 'post' AND r.entity_id IN (SELECT id FROM posts WHERE author_id = ?))
         OR (? AND r.entity = 'page')
      ORDER BY r.id DESC LIMIT ?`).all(authorId, withPages ? 1 : 0, limit),
    removeFor: (entity, entityId) => db.prepare('DELETE FROM revisions WHERE entity = ? AND entity_id = ?').run(entity, entityId),
  };

  // ---------- příspěvky ----------
  const POST_SELECT = `
    SELECT p.*,
      u.username, u.display_name,
      e.username editor_username, e.display_name editor_name,
      c.name cat_name, c.slug cat_slug, c.color cat_color,
      (SELECT COALESCE(SUM(value), 0) FROM votes v WHERE v.post_id = p.id) score,
      (SELECT COUNT(*) FROM comments cm WHERE cm.post_id = p.id) comment_count,
      (SELECT value FROM votes v WHERE v.post_id = p.id AND v.user_id = ?) my_vote
    FROM posts p
    LEFT JOIN users u ON u.id = p.author_id
    LEFT JOIN users e ON e.id = p.edited_by
    LEFT JOIN categories c ON c.id = p.category_id`;

  const SORTS = {
    hot: `p.pinned DESC, (score + 1.0) / (((julianday('now') - julianday(COALESCE(p.published_at, p.created_at))) * 24 + 2)
          * ((julianday('now') - julianday(COALESCE(p.published_at, p.created_at))) * 24 + 2)) DESC, p.id DESC`,
    new: 'COALESCE(p.published_at, p.created_at) DESC, p.id DESC',
    top: 'score DESC, COALESCE(p.published_at, p.created_at) DESC',
    updated: 'p.updated_at DESC, p.id DESC',
    title: 'p.title COLLATE NOCASE ASC',
  };

  function attachTags(items) {
    const map = tags.forPosts(items.map((p) => p.id));
    for (const p of items) p.tags = map.get(p.id) || [];
    return items;
  }

  const posts = {
    list({ viewer = null, categoryId, tag, authorId, q, sort = 'hot', status = 'published', trash = false, limit = 20, offset = 0 } = {}) {
      const where = [trash ? 'p.deleted_at IS NOT NULL' : 'p.deleted_at IS NULL'];
      const params = [];
      if (status === 'published' || status === 'draft') {
        where.push('p.status = ?');
        params.push(status);
      }
      // Koncepty vidí jen autor a administrátor.
      if (!viewer) where.push("p.status = 'published'");
      else if (viewer.role !== 'admin') {
        where.push("(p.status = 'published' OR p.author_id = ?)");
        params.push(viewer.id);
      }
      if (categoryId === 'none') where.push('p.category_id IS NULL');
      else if (categoryId) { where.push('p.category_id = ?'); params.push(categoryId); }
      if (authorId) { where.push('p.author_id = ?'); params.push(authorId); }
      if (tag) {
        where.push('EXISTS (SELECT 1 FROM post_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.post_id = p.id AND t.name = ?)');
        params.push(tag);
      }
      if (q) {
        where.push("(p.title LIKE ? ESCAPE '\\' OR p.body LIKE ? ESCAPE '\\')");
        const like = `%${likeEscape(q)}%`;
        params.push(like, like);
      }
      const whereSql = where.join(' AND ');
      const total = db.prepare(`SELECT COUNT(*) n FROM posts p WHERE ${whereSql}`).get(...params).n;
      const items = db.prepare(`${POST_SELECT} WHERE ${whereSql} ORDER BY ${SORTS[sort] || SORTS.hot} LIMIT ? OFFSET ?`)
        .all(viewer?.id ?? null, ...params, limit, offset);
      return { items: attachTags(items), total };
    },
    byId(id, viewerId = null) {
      const p = db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(viewerId, id);
      return p ? attachTags([p])[0] : null;
    },
    raw: (id) => db.prepare('SELECT * FROM posts WHERE id = ?').get(id),
    create({ title, body, categoryId, status, pinned, tagNames }, userId) {
      return db.tx(() => {
        const t = now();
        const r = db.prepare(`
          INSERT INTO posts (author_id, category_id, title, body, status, pinned, created_at, updated_at, published_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(userId, categoryId || null, title, body, status, pinned ? 1 : 0, t, t, status === 'published' ? t : null);
        const id = Number(r.lastInsertRowid);
        tags.setForPost(id, tagNames);
        revisions.add('post', id, { title, body }, userId, 'Vytvořeno');
        return id;
      });
    },
    update(id, { title, body, categoryId, status, pinned, tagNames, note }, userId) {
      db.tx(() => {
        const t = now();
        db.prepare(`
          UPDATE posts SET title = ?, body = ?, category_id = ?, status = ?, pinned = ?, updated_at = ?, edited_by = ?,
            published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, ?) ELSE published_at END
          WHERE id = ?`)
          .run(title, body, categoryId || null, status, pinned ? 1 : 0, t, userId, status, t, id);
        tags.setForPost(id, tagNames);
        revisions.add('post', id, { title, body }, userId, note || 'Upraveno');
        tags.pruneUnused();
      });
    },
    setStatus(ids, status) {
      const t = now();
      db.prepare(`UPDATE posts SET status = ?, updated_at = ?, published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, ?) ELSE published_at END
        WHERE id IN (${placeholders(ids)})`).run(status, t, status, t, ...ids);
    },
    setCategory: (ids, categoryId) =>
      db.prepare(`UPDATE posts SET category_id = ? WHERE id IN (${placeholders(ids)})`).run(categoryId || null, ...ids),
    trash: (ids) => db.prepare(`UPDATE posts SET deleted_at = ? WHERE id IN (${placeholders(ids)})`).run(now(), ...ids),
    restore: (ids) => db.prepare(`UPDATE posts SET deleted_at = NULL WHERE id IN (${placeholders(ids)})`).run(...ids),
    destroy(ids) {
      db.tx(() => {
        for (const id of ids) revisions.removeFor('post', id);
        db.prepare(`DELETE FROM posts WHERE id IN (${placeholders(ids)})`).run(...ids);
        tags.pruneUnused();
      });
    },
    vote(postId, userId, value) {
      const cur = db.prepare('SELECT value FROM votes WHERE post_id = ? AND user_id = ?').get(postId, userId);
      if (cur && cur.value === value) db.prepare('DELETE FROM votes WHERE post_id = ? AND user_id = ?').run(postId, userId);
      else db.prepare('INSERT INTO votes (user_id, post_id, value) VALUES (?, ?, ?) ON CONFLICT(user_id, post_id) DO UPDATE SET value = excluded.value')
        .run(userId, postId, value);
    },
    counts: (authorId = null) => db.prepare(`
      SELECT
        SUM(deleted_at IS NULL AND status = 'published') published,
        SUM(deleted_at IS NULL AND status = 'draft') drafts,
        SUM(deleted_at IS NOT NULL) trashed
      FROM posts WHERE ? IS NULL OR author_id = ?`).get(authorId, authorId),
  };

  // ---------- komentáře ----------
  const comments = {
    forPost: (postId) => db.prepare(`
      SELECT c.*, u.username, u.display_name FROM comments c LEFT JOIN users u ON u.id = c.author_id
      WHERE c.post_id = ? ORDER BY c.id`).all(postId),
    byId: (id) => db.prepare('SELECT * FROM comments WHERE id = ?').get(id),
    create: (postId, userId, body) =>
      db.prepare('INSERT INTO comments (post_id, author_id, body, created_at) VALUES (?, ?, ?, ?)').run(postId, userId, body, now()),
    remove: (id) => db.prepare('DELETE FROM comments WHERE id = ?').run(id),
    count: () => db.prepare('SELECT COUNT(*) n FROM comments').get().n,
  };

  // ---------- stránky ----------
  const PAGE_SELECT = `
    SELECT pg.*, u.username, u.display_name, e.username editor_username, e.display_name editor_name
    FROM pages pg LEFT JOIN users u ON u.id = pg.author_id LEFT JOIN users e ON e.id = pg.edited_by`;

  const pages = {
    list({ q, status } = {}) {
      const where = ['1 = 1'];
      const params = [];
      if (status === 'published' || status === 'draft') { where.push('pg.status = ?'); params.push(status); }
      if (q) { where.push("(pg.title LIKE ? ESCAPE '\\' OR pg.body LIKE ? ESCAPE '\\')"); params.push(`%${likeEscape(q)}%`, `%${likeEscape(q)}%`); }
      return db.prepare(`${PAGE_SELECT} WHERE ${where.join(' AND ')} ORDER BY pg.sort_order, pg.title`).all(...params);
    },
    nav: () => db.prepare("SELECT title, slug FROM pages WHERE status = 'published' AND show_in_nav = 1 ORDER BY sort_order, title").all(),
    byId: (id) => db.prepare(`${PAGE_SELECT} WHERE pg.id = ?`).get(id),
    bySlug: (slug) => db.prepare(`${PAGE_SELECT} WHERE pg.slug = ?`).get(slug),
    uniqueSlug: (input, exceptId) => uniqueSlug('pages', input, 'stranka', exceptId),
    create({ title, slug, body, status, showInNav, sortOrder }, userId) {
      return db.tx(() => {
        const t = now();
        const r = db.prepare(`
          INSERT INTO pages (title, slug, body, status, show_in_nav, sort_order, author_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(title, slug, body, status, showInNav ? 1 : 0, sortOrder, userId, t, t);
        const id = Number(r.lastInsertRowid);
        revisions.add('page', id, { title, body }, userId, 'Vytvořeno');
        return id;
      });
    },
    update(id, { title, slug, body, status, showInNav, sortOrder, note }, userId) {
      db.tx(() => {
        db.prepare(`
          UPDATE pages SET title = ?, slug = ?, body = ?, status = ?, show_in_nav = ?, sort_order = ?, edited_by = ?, updated_at = ?
          WHERE id = ?`).run(title, slug, body, status, showInNav ? 1 : 0, sortOrder, userId, now(), id);
        revisions.add('page', id, { title, body }, userId, note || 'Upraveno');
      });
    },
    remove(id) {
      db.tx(() => {
        revisions.removeFor('page', id);
        db.prepare('DELETE FROM pages WHERE id = ?').run(id);
      });
    },
    count: () => db.prepare('SELECT COUNT(*) n FROM pages').get().n,
  };

  return { db, getSettings, saveSettings, users, categories, tags, revisions, posts, comments, pages };
}

module.exports = { createModels, DEFAULT_SETTINGS };
