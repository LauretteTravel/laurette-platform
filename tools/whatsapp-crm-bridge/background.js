import { parseSettings, restrictSettings } from './settings.js';

const WHATSAPP_ORIGIN = 'https://web.whatsapp.com';
const validText = (value, max) => typeof value === 'string' && value.length <= max;
const nullableText = (value, max) => value === null || validText(value, max);

chrome.runtime.onInstalled.addListener(() => {
  // The popup and sync handler also enforce this before accessing settings.
  void restrictSettings().catch(() => {});
});

chrome.runtime.onMessage.addListener((request, sender, reply) => {
  if (request?.type !== 'crm:sync' ||
      sender.id !== chrome.runtime.id || sender.frameId !== 0 ||
      sender.origin !== WHATSAPP_ORIGIN || !Number.isInteger(sender.tab?.id)) {
    return false;
  }

  syncChat(request.chat).then(reply, () => {
    reply({ code: 'ERROR', message: 'Could not read settings or reach the CRM.' });
  });
  return true;
});

async function syncChat(chat) {
  await restrictSettings();
  const saved = await chrome.storage.sync.get(['apiEndpoint', 'authToken']);
  let settings;
  try {
    settings = parseSettings(saved.apiEndpoint, saved.authToken);
  } catch {
    return { code: 'SETUP', message: 'Configure your CRM endpoint and token in the extension popup.' };
  }

  if (!await chrome.permissions.contains({ origins: [settings.hostPermission] })) {
    return { code: 'SETUP', message: 'Open the extension popup and save settings to grant CRM access.' };
  }

  if (!validText(chat?.contact?.name, 512) || !chat.contact.name ||
      !(chat.contact.phone === null ||
        (validText(chat.contact.phone, 16) && /^\+[1-9]\d{6,14}$/.test(chat.contact.phone))) ||
      !Array.isArray(chat.messages) || chat.messages.length < 1 || chat.messages.length > 10 ||
      !chat.messages.every((message) => message &&
        nullableText(message.id, 512) && nullableText(message.label, 512) &&
        ['incoming', 'outgoing', 'unknown'].includes(message.direction) &&
        nullableText(message.text, 65536))) {
    return { code: 'ERROR', message: 'Open a chat with visible messages and try again.' };
  }

  const { name, phone } = chat.contact;
  const messages = chat.messages.map(({ id, direction, text, label }) =>
    ({ id, direction, text, label }));
  // Use only saved settings for the destination. Reject redirects and omit cookies.
  const signal = AbortSignal.timeout(15000);
  try {
    const response = await fetch(settings.apiEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ source: 'whatsapp-web', contact: { name, phone }, messages }),
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal
    });
    // The HTTP status is sufficient. Never expose the CRM response to the page.
    void response.body?.cancel().catch(() => {});
    return response.ok
      ? { code: 'OK' }
      : { code: 'ERROR', message: `CRM returned HTTP ${response.status}.` };
  } catch {
    return {
      code: 'ERROR',
      message: signal.aborted ? 'CRM request timed out.' : 'CRM connection failed or redirected.'
    };
  }
}
