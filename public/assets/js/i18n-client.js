/* English-site runtime: translates strings produced by client-side JS and keeps links inside /en. */
(() => {
  let dict = {};
  let lang = 'en';

  const ATTRS = ['placeholder', 'aria-label', 'title', 'alt', 'data-wa-text'];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);

  function translate(value) {
    if (!value) return value;
    const trimmed = String(value).trim();
    if (!trimmed || !/[\u0600-\u06FF]/.test(trimmed)) return value;
    const hit = dict[trimmed];
    if (!hit) return value;
    return String(value).replace(trimmed, hit);
  }

  function localizeHref(href) {
    if (!href || !href.startsWith('/') || href.startsWith('//')) return href;
    if (/^\/(api|assets|media|art|admin|health|sitemap|robots|site\.webmanifest)/.test(href)) return href;
    if (href === '/en' || href.startsWith('/en/') || href.startsWith('/en?') || href.startsWith('/en#')) return href;
    return href === '/' ? '/en' : '/en' + href;
  }

  function translateNode(node) {
    if (node.parentElement && node.parentElement.closest('.voucher-overlay')) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const next = translate(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (SKIP.has(node.tagName)) return;
    if (node.dataset && node.dataset.noI18n !== undefined) return;
    if (node.closest && node.closest('.voucher-overlay')) return;
    for (const attr of ATTRS) {
      const value = node.getAttribute && node.getAttribute(attr);
      if (value && /[\u0600-\u06FF]/.test(value)) {
        const next = translate(value);
        if (next !== value) node.setAttribute(attr, next);
      }
    }
    if (node.tagName === 'A' && node.getAttribute('href') && !node.classList.contains('lang-switch')) {
      const next = localizeHref(node.getAttribute('href'));
      if (next !== node.getAttribute('href')) node.setAttribute('href', next);
    }
    for (const child of node.childNodes) translateNode(child);
  }

  function scan(root) {
    if (!root || !dict || !Object.keys(dict).length) return;
    translateNode(root);
    if (root.querySelectorAll) {
      for (const el of root.querySelectorAll('a[href^="/"], img, input, textarea, select')) translateNode(el);
    }
  }

  async function boot() {
    try {
      const res = await fetch('/i18n/en.json', { credentials: 'same-origin' });
      dict = await res.json();
    } catch {
      return;
    }

    // Route API calls through /en so the server can answer with English messages.
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (typeof input === 'string' && input.startsWith('/api/')) input = '/en' + input;
      return nativeFetch(input, init);
    };
    scan(document.body);
    const observer = new MutationObserver((records) => {
      for (const rec of records) {
        if (rec.type === 'childList') {
          for (const node of rec.addedNodes) scan(node);
        } else if (rec.type === 'attributes' && rec.target) {
          translateNode(rec.target);
        } else if (rec.type === 'characterData' && rec.target) {
          translateNode(rec.target);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true, attributeFilter: ATTRS });

    // Keep navigation inside the English site when a link is followed before the observer sees it.
    document.addEventListener('click', (event) => {
      const link = event.target.closest && event.target.closest('a[href^="/"]');
      if (!link || link.target === '_blank' || event.metaKey || event.ctrlKey || event.shiftKey) return;
      if (link.classList.contains('lang-switch')) return;
      const next = localizeHref(link.getAttribute('href'));
      if (next !== link.getAttribute('href')) link.setAttribute('href', next);
    }, true);

    window.__lauretteLang = lang;
    window.__t = translate;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
