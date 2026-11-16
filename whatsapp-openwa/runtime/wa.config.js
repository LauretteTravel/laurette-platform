import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

export default {
  sessionId: "runtime",
  host: '127.0.0.1',
  apiKey: process.env.WA_API_KEY || undefined,
  browser: { source: 'managed', kind: 'chromium', download: 'auto', cacheDirectory: '.open-wa/browser-cache' },
};
