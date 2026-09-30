/* Klientská vylepšení. Aplikace funguje i bez JavaScriptu (vše je renderováno na serveru);
 * tento skript přidává offline režim, živý náhled, AJAX hlasování a drobnosti. */
'use strict';

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function toast(text, ms = 3500) {
    const el = document.createElement('div');
    el.className = 'floating toast';
    el.setAttribute('role', 'status');
    el.textContent = text;
    document.body.append(el);
    setTimeout(() => el.remove(), ms);
  }

  // České skloňování: 1 položka, 2–4 položky, 5+ položek.
  const items = (n) => `${n} ${n === 1 ? 'položka' : n >= 2 && n <= 4 ? 'položky' : 'položek'}`;

  const csrfOf = (form) => form.querySelector('input[name="_csrf"]')?.value || '';

  // ------------------------------------------------------------ service worker + offline
  const sw = navigator.serviceWorker;
  const post = (msg) => sw?.controller?.postMessage(msg);

  function updateNet() {
    const banner = $('#net-banner');
    if (banner) banner.hidden = navigator.onLine;
  }
  window.addEventListener('online', () => { updateNet(); post({ type: 'sync' }); toast('Připojení obnoveno'); });
  window.addEventListener('offline', updateNet);
  updateNet();

  if (sw) {
    sw.register('/sw.js').catch(() => {});
    sw.addEventListener('message', (e) => {
      const m = e.data || {};
      if (m.type === 'outbox') renderOutbox(m);
      if (m.type === 'cleared') {
        const s = $('[data-cache-status]');
        if (s) s.textContent = 'Mezipaměť vymazána.';
      }
    });
    sw.ready.then(() => {
      post({ type: 'status' });
      if (navigator.onLine) post({ type: 'sync' });
    });
  }

  function renderOutbox({ pending = 0, failed = 0, synced = 0, queued = false }) {
    const banner = $('#outbox-banner');
    if (!banner) return;
    const text = $('[data-outbox-text]', banner);
    const btn = $('[data-outbox-sync]', banner);
    if (queued) toast('Jste offline – uloženo do fronty, odešle se po připojení.');
    if (synced) {
      toast(`Odesláno: ${items(synced)} napsaných offline.`);
      if (!document.querySelector('form[data-dirty]')) setTimeout(() => location.reload(), 800);
    }
    if (!pending && !failed) { banner.hidden = true; return; }
    banner.hidden = false;
    if (failed && !pending) {
      text.textContent = `Nepodařilo se odeslat: ${items(failed)} (např. vypršelé přihlášení).`;
      btn.textContent = 'Zkusit znovu';
      btn.onclick = () => post({ type: 'retry-failed' });
    } else {
      text.textContent = `Čeká na odeslání: ${items(pending)}${failed ? ` (selhalo: ${failed})` : ''}.`;
      btn.textContent = 'Odeslat nyní';
      btn.onclick = () => post({ type: failed ? 'retry-failed' : 'sync' });
    }
  }

  // Odhlášení: smazat uložené stránky, aby offline nebyl vidět obsah jiného účtu.
  $$('form[data-logout]').forEach((f) => f.addEventListener('submit', () => post({ type: 'clear-pages' })));
  $$('[data-clear-cache]').forEach((b) => b.addEventListener('click', () => {
    if (!sw?.controller) { toast('Offline režim není v tomto prohlížeči aktivní.'); return; }
    post({ type: 'clear-pages' });
  }));

  // ------------------------------------------------------------ potvrzení akcí
  document.addEventListener('submit', (e) => {
    const form = e.target;
    const msg = form.dataset.confirm;
    if (msg && !confirm(msg)) { e.preventDefault(); return; }
    if (form.matches('[data-bulk]')) {
      const action = form.elements.action?.value;
      if (action === 'destroy' && !confirm('Trvale smazat vybrané příspěvky? Tuto akci nelze vrátit.')) { e.preventDefault(); return; }
    }
    delete form.dataset.dirty;
  }, true);

  // ------------------------------------------------------------ hlasování bez přenačtení
  $$('form[data-vote]').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      if (!navigator.onLine) return;
      e.preventDefault();
      const body = new URLSearchParams(new FormData(form));
      body.set('value', e.submitter?.value || '1');
      try {
        const res = await fetch(form.action, {
          method: 'POST', body,
          headers: { Accept: 'application/json' }, credentials: 'same-origin',
        });
        if (!res.ok || !res.headers.get('content-type')?.includes('json')) throw new Error();
        const { score, myVote } = await res.json();
        $('[data-score]', form).textContent = score;
        for (const btn of $$('.vote-btn', form)) {
          const on = Number(btn.value) === myVote;
          btn.classList.toggle('on', on);
          btn.setAttribute('aria-pressed', String(on));
        }
      } catch {
        // Záloha: klasické odeslání formuláře (form.submit() nepřenáší hodnotu tlačítka).
        const input = Object.assign(document.createElement('input'), { type: 'hidden', name: 'value', value: body.get('value') });
        form.append(input);
        form.submit();
      }
    });
  });

  // ------------------------------------------------------------ textarea
  const grow = (ta) => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight + 2, 900)}px`; };
  $$('textarea[data-autogrow]').forEach((ta) => {
    grow(ta);
    ta.addEventListener('input', () => grow(ta));
  });

  // ------------------------------------------------------------ editor: živý náhled (renderuje server)
  $$('[data-editor]').forEach((ed) => {
    const ta = $('textarea', ed);
    const pv = $('[data-editor-preview]', ed);
    const count = $('[data-editor-count]', ed);
    const form = ed.closest('form');
    const updateCount = () => { count.textContent = `${ta.value.length.toLocaleString('cs')} znaků`; };
    ta.addEventListener('input', updateCount);
    updateCount();

    $$('[data-editor-tab]', ed).forEach((tab) => tab.addEventListener('click', async () => {
      const preview = tab.dataset.editorTab === 'preview';
      $$('[data-editor-tab]', ed).forEach((t) => {
        t.classList.toggle('active', t === tab);
        t.setAttribute('aria-selected', String(t === tab));
      });
      ta.hidden = preview;
      pv.hidden = !preview;
      if (!preview) { ta.focus(); return; }
      if (!navigator.onLine) {
        pv.innerHTML = '<p class="muted">Náhled vyžaduje spojení se serverem (vykresluje se na serveru). Text je uložen ve formuláři.</p>';
        return;
      }
      pv.innerHTML = '<p class="muted">Načítám náhled…</p>';
      try {
        const res = await fetch('/admin/render', {
          method: 'POST', credentials: 'same-origin',
          body: new URLSearchParams({ _csrf: csrfOf(form), body: ta.value }),
        });
        if (!res.ok) throw new Error();
        const html = await res.text();
        pv.innerHTML = html || '<p class="muted">Nic k zobrazení.</p>';
      } catch {
        pv.innerHTML = '<p class="muted">Náhled se nepodařilo načíst.</p>';
      }
    }));
  });

  // ------------------------------------------------------------ varování před odchodem s neuloženými změnami
  $$('form[data-offline-queue]').forEach((form) => {
    if (form.classList.contains('composer')) return;
    form.addEventListener('input', () => { form.dataset.dirty = '1'; });
  });
  window.addEventListener('beforeunload', (e) => {
    if (document.querySelector('form[data-dirty]')) { e.preventDefault(); e.returnValue = ''; }
  });
  // Náhled otevírá novou kartu – formulář zůstává "neuložený".
  $$('button[data-no-queue]').forEach((b) => b.addEventListener('click', () => {
    const form = b.form;
    setTimeout(() => { form.dataset.dirty = '1'; }, 0);
  }));

  // ------------------------------------------------------------ tabulky
  $$('[data-check-all]').forEach((all) => all.addEventListener('change', () => {
    $$('input[name="ids"]', all.closest('form')).forEach((c) => { c.checked = all.checked; });
  }));

  // ------------------------------------------------------------ zpět
  $$('[data-back]').forEach((a) => a.addEventListener('click', (e) => {
    if (document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1) {
      e.preventDefault();
      history.back();
    }
  }));
})();
