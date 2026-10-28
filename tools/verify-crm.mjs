import { readFileSync } from 'node:fs';

const base = 'http://127.0.0.1:3000';
const creds = readFileSync('data/admin-credentials.txt', 'utf8');
const password = creds.match(/كلمة المرور المؤقتة:\s*(\S+)/)[1];

const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
  body: JSON.stringify({ username: 'laurette', password }),
});
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
const h = { cookie, 'x-requested-with': 'fetch', 'content-type': 'application/json' };
console.log('login', login.status);

// public lead
const lead = await fetch(`${base}/api/requests`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
  body: JSON.stringify({
    type: 'flight', tripType: 'oneway', origin: 'عمّان (AMM)', destination: 'إسطنبول (IST)',
    departDate: new Date(Date.now() + 86400000 * 10).toISOString().slice(0, 10),
    adults: 2, children: 0, infants: 0, cabin: 'economy', baggage: 'standard',
    name: 'عميل تقارير', phone: '0795550001', consent: true,
  }),
});
const leadData = await lead.json();
console.log('lead', lead.status, leadData.reference, 'value', leadData.value);

const list = await (await fetch(`${base}/api/admin/requests?q=${leadData.reference}`, { headers: h })).json();
const id = list.requests[0].id;
console.log('in admin', list.requests[0].deal_status, list.requests[0].completion_minutes);

for (const status of ['reviewing', 'quoted', 'awaiting', 'confirmed']) {
  const res = await fetch(`${base}/api/admin/requests/${id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ status, quoteAmount: 480 }) });
  console.log('→', status, res.status);
}

const detail = await (await fetch(`${base}/api/admin/requests/${id}`, { headers: h })).json();
console.log('deal', detail.request.deal_status, 'completed', detail.request.completed_at, 'completion', detail.request.completionLabel, 'response', detail.request.responseLabel);

const reports = await (await fetch(`${base}/api/admin/reports?period=weekly&employee=1`, { headers: h })).json();
console.log('report', reports.summary, 'employees', reports.employees.length, 'series', reports.series.length, 'types', reports.byType.length);
const csv = await fetch(`${base}/api/admin/reports.csv?period=weekly`, { headers: h });
console.log('csv', csv.status, csv.headers.get('content-type'), (await csv.text()).split('\n').length, 'lines');

// tracking configuration
const set = await fetch(`${base}/api/admin/settings`, {
  method: 'PATCH', headers: h,
  body: JSON.stringify({ metaPixelId: '123456789012345', gtmId: 'GTM-TEST123', googleAdsId: 'AW-123456789', googleAdsLabel: 'AbCdEf', trackingEnabled: true }),
});
console.log('tracking settings', set.status);
const home = await fetch(`${base}/`);
const html = await home.text();
console.log('home tracking', {
  pixel: html.includes('connect.facebook.net/en_US/fbevents.js'),
  gtm: html.includes('googletagmanager.com/gtm.js'),
  gtag: html.includes('googletagmanager.com/gtag/js'),
  noscript: html.includes('googletagmanager.com/ns.html'),
  csp: (home.headers.get('content-security-policy') || '').includes('connect.facebook.net'),
});

const beacon = await fetch(`${base}/api/track-event`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
  body: JSON.stringify({ event: 'lead', type: 'flight', path: '/' }),
});
console.log('track-event', beacon.status);
const te = await (await fetch(`${base}/api/admin/tracking-events`, { headers: h })).json();
console.log('tracking events', te.events.length, te.counts);

// reset tracking so no external scripts load by default
await fetch(`${base}/api/admin/settings`, {
  method: 'PATCH', headers: h,
  body: JSON.stringify({ metaPixelId: '', gtmId: '', googleAdsId: '', googleAdsLabel: '', trackingEnabled: true }),
});
console.log('tracking reset');
