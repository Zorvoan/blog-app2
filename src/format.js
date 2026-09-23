'use strict';

// Bezpečné formátování textu příspěvků a stránek.
// Vstup je vždy nejdříve escapován, poté se aplikuje omezená sada
// značek (markdown-lite). Uživatel tak nemůže vložit vlastní HTML.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

function slugify(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function safeUrl(url) {
  return /^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(url);
}

const HASHTAG_RE = /(^|[\s(>])#([\p{L}\p{N}_-]{1,40})/gu;

function renderInline(escaped) {
  const tokens = [];
  const hold = (html) => `\u0000${tokens.push(html) - 1}\u0000`;
  let t = escaped;

  t = t.replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${code}</code>`));
  t = t.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, label, url) =>
    safeUrl(url) ? hold(`<a href="${url}" rel="nofollow noopener noreferrer" target="_blank">${label}</a>`) : m
  );
  t = t.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"&]/g, (url) =>
    hold(`<a href="${url}" rel="nofollow noopener noreferrer" target="_blank">${url}</a>`)
  );
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
  t = t.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  t = t.replace(HASHTAG_RE, (_, pre, tag) =>
    pre + hold(`<a class="hashtag" href="/t/${encodeURIComponent(tag.toLowerCase())}">#${tag}</a>`)
  );
  t = t.replace(/(^|[\s(>])@([A-Za-z0-9_]{3,30})\b/g, (_, pre, name) =>
    pre + hold(`<a class="mention" href="/u/${name}">@${name}</a>`)
  );

  // Tokeny mohou obsahovat další tokeny (např. kód uvnitř odkazu).
  for (let i = 0; i < 5 && t.includes('\u0000'); i++) {
    t = t.replace(/\u0000(\d+)\u0000/g, (_, n) => tokens[Number(n)]);
  }
  return t;
}

const inline = (s) => renderInline(esc(s));

const RE = {
  fence: /^```/,
  heading: /^(#{1,3})\s+(.+)$/,
  quote: /^>\s?/,
  ul: /^\s*[-*+]\s+/,
  ol: /^\s*\d+[.)]\s+/,
  hr: /^\s*(-{3,}|\*{3,}|_{3,})\s*$/,
};

function isBlockStart(line) {
  return RE.fence.test(line) || RE.heading.test(line) || RE.quote.test(line) ||
    RE.ul.test(line) || RE.ol.test(line) || RE.hr.test(line);
}

function renderText(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    let m;

    if (!line.trim()) { i++; continue; }

    if (RE.fence.test(line)) {
      const code = [];
      i++;
      while (i < lines.length && !RE.fence.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (RE.hr.test(line)) { out.push('<hr>'); i++; continue; }
    if ((m = line.match(RE.heading))) {
      const lvl = m[1].length + 1;
      out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`);
      i++;
      continue;
    }
    if (RE.quote.test(line)) {
      const q = [];
      while (i < lines.length && RE.quote.test(lines[i])) q.push(lines[i++].replace(RE.quote, ''));
      out.push(`<blockquote>${q.map(inline).join('<br>')}</blockquote>`);
      continue;
    }
    if (RE.ul.test(line) || RE.ol.test(line)) {
      const ordered = RE.ol.test(line);
      const re = ordered ? RE.ol : RE.ul;
      const items = [];
      while (i < lines.length && re.test(lines[i])) items.push(lines[i++].replace(re, ''));
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</${tag}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && (para.length === 0 || !isBlockStart(lines[i]))) {
      para.push(lines[i++]);
    }
    out.push(`<p>${para.map(inline).join('<br>')}</p>`);
  }
  return out.join('\n');
}

function plainExcerpt(src, max = 160) {
  const text = String(src ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~[\]()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(s, withTime = true) {
  const d = parseDate(s);
  if (!d) return '';
  const date = `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
  if (!withTime) return date;
  return `${date} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function timeAgo(s) {
  const d = parseDate(s);
  if (!d) return '';
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 45) return 'právě teď';
  if (sec < 3600) return `před ${Math.round(sec / 60)} min`;
  if (sec < 86400) return `před ${Math.round(sec / 3600)} h`;
  if (sec < 7 * 86400) return `před ${Math.round(sec / 86400)} d`;
  return formatDate(s, false);
}

function avatarColor(name) {
  let h = 0;
  for (const ch of String(name ?? '?')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return `hsl(${h % 360} 65% 45%)`;
}

function initial(name) {
  return (String(name ?? '?').trim()[0] || '?').toUpperCase();
}

// Štítky: z pole "štítky" (oddělené čárkou/mezerou) + #hashtagy v textu.
function parseTags(input, body = '') {
  const set = new Set();
  const add = (raw) => {
    const t = String(raw).replace(/^#+/, '').trim().toLowerCase();
    if (t && t.length <= 40 && /^[\p{L}\p{N}_-]+$/u.test(t)) set.add(t);
  };
  String(input ?? '').split(/[,\s]+/).forEach(add);
  for (const m of String(body ?? '').matchAll(HASHTAG_RE)) add(m[2]);
  return [...set].slice(0, 15);
}

module.exports = {
  esc, slugify, safeUrl, renderText, renderInline, plainExcerpt,
  formatDate, timeAgo, avatarColor, initial, parseTags,
};
