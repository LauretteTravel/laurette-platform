(() => {
  'use strict';

  // Keep WhatsApp-specific selectors together so layout changes are easy to patch.
  const HEADER = '#main header';
  const TITLE = '[data-testid="conversation-info-header-chat-title"]';
  const TITLE_FALLBACK = '[data-testid="conversation-info-header"] span[title], span[dir="auto"][title]';
  const MESSAGE = '.message-in, .message-out, [data-pre-plain-text]';
  const BODY = '[data-testid="msg-text"] span.selectable-text, span.selectable-text.copyable-text';
  const PHONE = /^\+?[1-9]\d{6,14}$/;
  const QUOTE = '[data-testid="quoted-message"], [data-testid="quoted-message-preview"]';
  let control;
  let scheduled = false;

  function activeChat() {
    const header = document.querySelector(HEADER);
    const title = header?.querySelector(TITLE) || header?.querySelector(TITLE_FALLBACK);
    const name = (title?.getAttribute('title') || title?.textContent || '').trim();
    return name ? { header, name, main: header.closest('#main') } : null;
  }

  // A rendered row can still be outside the chat's scrolling viewport.
  function visible(row, main) {
    if (row.closest('[hidden], [aria-hidden="true"]') ||
        !row.checkVisibility({ opacityProperty: true, visibilityProperty: true })) {
      return false;
    }
    const box = row.getBoundingClientRect();
    let top = 0;
    let bottom = window.innerHeight;
    let left = 0;
    let right = window.innerWidth;
    for (let parent = row.parentElement; parent; parent = parent.parentElement) {
      const { overflowX, overflowY } = getComputedStyle(parent);
      const clip = parent.getBoundingClientRect();
      if (overflowY !== 'visible' || parent === main) {
        top = Math.max(top, clip.top);
        bottom = Math.min(bottom, clip.bottom);
      }
      if (overflowX !== 'visible' || parent === main) {
        left = Math.max(left, clip.left);
        right = Math.min(right, clip.right);
      }
      if (parent === main) break;
    }
    return Math.max(top, box.top) < Math.min(bottom, box.bottom) &&
      Math.max(left, box.left) < Math.min(right, box.right);
  }

  function readChat({ main, name }) {
    const rows = new Set();
    for (const node of main.querySelectorAll(MESSAGE)) {
      if (node.closest('header, footer, ' + QUOTE)) continue;
      rows.add(node.closest('[role="row"]') ||
        node.closest('.message-in, .message-out') || node);
    }

    const messages = [];
    const ids = new Set();
    const candidates = [...rows];
    for (let i = candidates.length - 1; i >= 0 && messages.length < 10; i--) {
      const row = candidates[i];
      if (!visible(row, main)) continue;
      const bubble = row.closest('.message-in, .message-out') ||
        row.querySelector('.message-in, .message-out');
      const idNode = (bubble || row).closest('[data-id]') || row.querySelector('[data-id]');
      const id = idNode?.getAttribute('data-id')?.slice(0, 512) || null;
      if (id && ids.has(id)) continue;
      if (id) ids.add(id);

      const scope = bubble || row;
      const meta = scope.closest('[data-pre-plain-text]') ||
        scope.querySelector('[data-pre-plain-text]');
      const text = [...scope.querySelectorAll(BODY)]
        .filter((part) => !part.closest(QUOTE))
        .map((part) => part.innerText.trim())
        .filter(Boolean)
        .join('\n');
      messages.push({
        id,
        direction: bubble?.matches('.message-out') ? 'outgoing' :
          bubble?.matches('.message-in') ? 'incoming' : 'unknown',
        text: text.slice(0, 65536) || null,
        label: meta?.getAttribute('data-pre-plain-text')?.trim().slice(0, 512) || null
      });
    }

    // Read a number from a direct chat ID or an international-format chat title.
    // Group and opaque linked IDs cannot be converted to phone numbers.
    const directNumber = messages.map(({ id }) =>
      id?.match(/^(?:true|false)_([1-9]\d{6,14})@(?:c\.us|s\.whatsapp\.net)_/)?.[1]
    ).find(Boolean);
    const displayedNumber = name.replace(/[\s().-]/g, '');
    const number = directNumber || (displayedNumber.startsWith('+') &&
      PHONE.test(displayedNumber) ? displayedNumber.slice(1) : null);
    return {
      contact: { name: name.slice(0, 512), phone: number ? '+' + number : null },
      messages: messages.reverse()
    };
  }

  function paint(button, label, color, detail = label) {
    button.textContent = label;
    button.style.backgroundColor = color;
    button.title = detail;
    button.setAttribute('aria-label', detail);
  }

  async function sync(event, current) {
    if (!event.isTrusted) return;
    event.preventDefault();
    event.stopPropagation();
    const { button, header, name } = current;
    const chat = activeChat();
    if (button.disabled || chat?.header !== header || chat.name !== name) return;
    clearTimeout(current.timer);
    button.disabled = true;
    paint(button, 'Syncing…', '#465762');
    try {
      // Capture before the first await, while the clicked chat is still active.
      const result = await chrome.runtime.sendMessage({ type: 'crm:sync', chat: readChat(chat) });
      if (result?.code === 'SETUP') alert(result.message);
      if (result?.code !== 'OK') throw new Error(result?.message || 'CRM sync failed.');
      paint(button, 'Synced ✓', '#167344');
    } catch (error) {
      paint(button, 'Sync failed', '#a22634', error.message || 'CRM sync failed.');
    } finally {
      button.disabled = false;
      if (control === current) {
        current.timer = setTimeout(() => paint(button, 'Sync to CRM', '#086449'), 4500);
      }
    }
  }

  function reconcile() {
    scheduled = false;
    const chat = activeChat();
    if (control?.header === chat?.header && control?.name === chat?.name &&
        control?.button.parentElement === chat?.header) return;
    if (control) {
      clearTimeout(control.timer);
      control.button.remove();
      control = null;
    }
    if (!chat) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.style.cssText = 'flex:none;margin-inline:8px;padding:6px 10px;border:0;' +
      'border-radius:7px;color:white;font:600 13px system-ui,sans-serif;cursor:pointer;';
    paint(button, 'Sync to CRM', '#086449');
    const current = { header: chat.header, name: chat.name, button };
    button.addEventListener('click', (event) => void sync(event, current));
    control = current;
    chat.header.append(button);
  }

  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(reconcile);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['title', 'data-testid']
  });
  reconcile();
})();
