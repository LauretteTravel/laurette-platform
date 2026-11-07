export async function restrictSettings() {
  await chrome.storage.sync.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}

export function parseSettings(apiEndpoint, authToken) {
  let url;
  try {
    url = new URL(apiEndpoint.trim());
  } catch {
    throw new Error('Enter a valid HTTPS CRM endpoint.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
      url.href.length > 2048) {
    throw new Error('Use an HTTPS URL without embedded credentials or a fragment.');
  }
  // Accept bearer credentials and printable API keys without header whitespace.
  const token = typeof authToken === 'string' ? authToken.trim() : '';
  if (!/^[!-~]{1,4096}$/.test(token)) {
    throw new Error('Enter the token or API key without spaces or the Bearer prefix.');
  }
  return {
    apiEndpoint: url.href,
    authToken: token,
    hostPermission: `https://${url.hostname}/*`
  };
}
