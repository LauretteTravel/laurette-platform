import { parseSettings, restrictSettings } from './settings.js';

const form = document.querySelector('#settings');
const fields = document.querySelector('#fields');
const endpoint = document.querySelector('#endpoint');
const token = document.querySelector('#token');
const status = document.querySelector('#status');

async function loadSettings() {
  try {
    await restrictSettings();
    const saved = await chrome.storage.sync.get(['apiEndpoint', 'authToken']);
    endpoint.value = saved.apiEndpoint ?? '';
    token.value = saved.authToken ?? '';
    fields.disabled = false;
  } catch {
    status.textContent = 'Could not load settings. Reopen the popup to try again.';
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  fields.disabled = true;
  status.textContent = '';
  try {
    const { apiEndpoint, authToken, hostPermission } = parseSettings(endpoint.value, token.value);
    // Call request directly in the submit gesture, before awaiting any other API.
    const granted = await chrome.permissions.request({ origins: [hostPermission] });
    if (!granted) {
      status.textContent = 'Allow access to the CRM host to save settings.';
      return;
    }
    await chrome.storage.sync.set({ apiEndpoint, authToken });
    endpoint.value = apiEndpoint;
    status.textContent = 'Settings saved.';
  } catch (error) {
    status.textContent = error.message || 'Could not save settings.';
  } finally {
    fields.disabled = false;
  }
});

void loadSettings();
