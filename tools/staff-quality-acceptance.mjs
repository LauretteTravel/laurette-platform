import assert from 'node:assert/strict';
import { openStaffSection } from '../tests/helpers/staff-browser-navigation.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from '../server.js';
import { hashPassword, createSession } from '../lib/auth.js';

assert.equal(process.env.CI,'true');
assert.equal(process.platform,'linux');
const deps=process.env.VOUCHER_TEST_DEPS,out=join(process.env.VOUCHER_EVIDENCE,'phase6');
for(const p of [deps,out])assert.ok(isAbsolute(p)&&!relative(resolve(process.env.RUNNER_TEMP),resolve(p)).startsWith('..'));
mkdirSync(out,{recursive:true});
const {chromium}=await import(pathToFileURL(join(deps,'node_modules/playwright/index.mjs')).href);
const axeSource=readFileSync(join(deps,'node_modules/axe-core/axe.min.js'),'utf8');
for(const key of ['N8N_BOOKING_WEBHOOK_URL','N8N_WEBHOOK_URL','N8N_BOOKING_WEBHOOK_SECRET','N8N_API_KEY','N8N_WEBHOOK_KEY','TASK_ATTACHMENT_UPLOADS_ENABLED','PROGRAM_SOURCE_UPLOADS_ENABLED'])delete process.env[key];
process.env.WHATSAPP_NOTIFICATIONS_ENABLED='0';
const seed=JSON.parse(readFileSync('data/seed.json','utf8'));
const app=createApp({dbFile:':memory:',seed:{...seed,users:[]},adminPassword:'Synthetic-Quality-Password42',baseUrl:'http://127.0.0.1:0'}),db=app.db;
const now=new Date().toISOString(),pw=hashPassword('Synthetic-Quality-Password42'),branch=db.prepare('SELECT id FROM branches LIMIT 1').get().id,dept=db.prepare('SELECT id FROM departments WHERE branch_id IS NULL LIMIT 1').get().id;
db.prepare('INSERT INTO role_definitions(role_key,name,base_role,data_scope,permissions,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('quality-browser','مراجع جودة مصطنع','admin','organization','["*"]',now,now);
const user=Number(db.prepare('INSERT INTO users(username,name,role,role_key,branch_id,department_id,password_hash,password_salt,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run('quality-browser','مراجع جودة مصطنع','admin','quality-browser',branch,dept,pw.hash,pw.salt,now).lastInsertRowid);
const token=createSession(db,user,'127.0.0.1','synthetic',{mfaVerified:true}).token;
const receiverDept=db.prepare('SELECT id FROM departments WHERE branch_id IS NULL AND id<>? LIMIT 1').get(dept).id;
db.prepare('INSERT INTO role_definitions(role_key,name,base_role,data_scope,permissions,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('quality-receiver','مستلم مصطنع','agent','assigned',JSON.stringify(['overview:read','requests:read','requests:write','requests:transfer']),now,now);
const receiver=Number(db.prepare('INSERT INTO users(username,name,role,role_key,branch_id,department_id,password_hash,password_salt,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run('quality-receiver','مستلم جودة مصطنع','agent','quality-receiver',branch,receiverDept,pw.hash,pw.salt,now).lastInsertRowid);
const receiverToken=createSession(db,receiver,'127.0.0.1','synthetic',{mfaVerified:true}).token;
db.exec('BEGIN');
for(let i=0;i<1500;i++)db.prepare('INSERT INTO requests(reference,type,status,deal_status,assigned_to,branch_id,department_id,source,payload,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('SYN-QUALITY-'+i,'flight','new','new',user,branch,dept,'مصدر جودة مصطنع','{}',now,now);
db.exec('COMMIT');
const addr=await app.listen(0,'127.0.0.1'),base=`http://127.0.0.1:${addr.port}`,browser=await chromium.launch({headless:true});
const metrics={fixtureRequests:1500,axeVersion:null,scans:[],errors:[],keyboard:false,transfer:false,restrictedRole:false,mobile:false,zoom:false,reducedMotion:false,health:false,performance:{},externalNetworkBlocked:true};
const violations=[];
async function context(viewport,{auth=true,reducedMotion='no-preference',session=token}={}){
  const c=await browser.newContext({viewport,locale:'ar-JO',timezoneId:'Asia/Amman',reducedMotion});
  await c.route('**/*',r=>r.request().url().startsWith(base+'/')?r.continue():r.abort());
  if(auth)await c.addCookies([{name:'lt_session',value:session,url:base}]);
  await c.addInitScript(()=>{
    window.__staffLcp=null;
    new PerformanceObserver(list=>{for(const e of list.getEntries())window.__staffLcp=e.startTime;}).observe({type:'largest-contentful-paint',buffered:true});
  });
  c.on('page',p=>p.on('pageerror',e=>metrics.errors.push(e.message)));
  return c;
}
async function scan(page,name){
  await page.evaluate(axeSource);
  const r=await page.evaluate(async()=>({version:axe.version,...await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}})}));
  metrics.axeVersion=r.version;
  const failures=r.violations.map(v=>({id:v.id,impact:v.impact,description:v.description,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));
  metrics.scans.push({name,violations:failures.length,passes:r.passes.length,incomplete:r.incomplete.length,
    incompleteRules:r.incomplete.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))});
  if(failures.length)violations.push({name,violations:failures});
  const ariaReview=r.incomplete.filter(v=>v.id.startsWith('aria-'));
  if(ariaReview.length)violations.push({name,incompleteAria:ariaReview.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))});
}
async function section(page,id,ready){
  await openStaffSection(page,id);
  await page.locator(ready).first().waitFor();
  await page.waitForFunction(()=>document.querySelector('#view')?.getAttribute('aria-busy')==='false');
}
async function settled(page){await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
try{
  const anonymous=await context({width:1440,height:1000},{auth:false}),login=await anonymous.newPage();
  await login.goto(base+'/admin');await login.locator('#loginForm').waitFor();await scan(login,'login');
  const desktop=await context({width:1440,height:1000}),page=await desktop.newPage();
  const start=Date.now();await page.goto(base+'/admin');await page.locator('[data-section=systemHealth]').waitFor({state:'attached'});await page.waitForFunction(()=>document.querySelector('#view')?.getAttribute('aria-busy')==='false');await settled(page);
  metrics.performance.coldReadyMs=Date.now()-start;
  metrics.performance.initial=await page.evaluate(()=>({lcpMs:window.__staffLcp,navigation:performance.getEntriesByType('navigation').map(n=>({ttfbMs:n.responseStart-n.requestStart,domContentLoadedMs:n.domContentLoadedEventEnd,loadMs:n.loadEventEnd}))[0],decodedResourceBytes:performance.getEntriesByType('resource').reduce((sum,r)=>sum+r.decodedBodySize,0),domNodes:document.querySelectorAll('*').length}));
  assert.ok(metrics.performance.coldReadyMs<7000,'Local synthetic cold ready budget: 7000ms');
  assert.ok(metrics.performance.initial.lcpMs>0&&metrics.performance.initial.lcpMs<4000,'Local synthetic LCP budget: 4000ms');
  assert.ok(metrics.performance.initial.decodedResourceBytes<4*1024*1024,'Initial decoded resource budget: 4MiB');
  assert.ok(metrics.performance.initial.domNodes<6000,'Initial DOM budget: 6000 nodes');
  await scan(page,'overview');
  await page.keyboard.press('Tab');
  // The first tabbable item on a fresh navigation is the skip link.
  await page.locator('.admin-skip').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#staffMain').evaluate(e=>document.activeElement===e),true);
  await section(page,'requests','[data-request] .table-action');await scan(page,'requests');
  const opener=page.locator('[data-request] .table-action').first();await opener.focus();await page.keyboard.press('Enter');
  const dialog=page.locator('dialog.drawer-backdrop[open]');await dialog.waitFor();
  assert.equal(await dialog.evaluate(e=>e.contains(document.activeElement)),true);
  await page.locator('#logoutBtn').evaluate(e=>e.focus());
  assert.equal(await dialog.evaluate(e=>e.contains(document.activeElement)),true,'Background cannot steal focus while modal is open');
  assert.ok(await dialog.getAttribute('aria-labelledby'));
  for(let i=0;i<35;i++){await page.keyboard.press('Tab');assert.equal(await dialog.evaluate(e=>e.contains(document.activeElement)),true,'Tab must remain inside modal');}
  for(let i=0;i<35;i++){await page.keyboard.press('Shift+Tab');assert.equal(await dialog.evaluate(e=>e.contains(document.activeElement)),true,'Reverse Tab must remain inside modal');}
  await scan(page,'request-dialog');await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);assert.equal(await opener.evaluate(e=>document.activeElement===e),true);
  metrics.keyboard=true;
  // Real browser handoff: creating a transfer retains the original owner until the recipient accepts it.
  const handedRequest=Number(await opener.locator('xpath=ancestor::tr').getAttribute('data-request'));
  const original=db.prepare('SELECT payload,assigned_to FROM requests WHERE id=?').get(handedRequest);
  await opener.click();await dialog.waitFor();await page.locator('#dTransferDepartment').selectOption(String(receiverDept));await page.locator('#dTransferUser').selectOption(String(receiver));await page.locator('#dTransferNote').fill('تحويل مصطنع لاختبار حفظ السياق');
  const transferResponse=page.waitForResponse(r=>r.url().endsWith(`/requests/${handedRequest}/transfers`)&&r.request().method()==='POST');
  await page.locator('[data-create-transfer]').click();assert.equal((await transferResponse).status(),201);
  const transfer=db.prepare('SELECT id,status FROM request_transfers WHERE request_id=? ORDER BY id DESC LIMIT 1').get(handedRequest);
  assert.equal(transfer.status,'pending');assert.equal(db.prepare('SELECT assigned_to FROM requests WHERE id=?').get(handedRequest).assigned_to,user);
  const receiving=await context({width:1440,height:1000},{session:receiverToken}),rp=await receiving.newPage();await rp.goto(base+'/admin');await rp.locator('[data-section=requests]').first().waitFor();
  assert.equal(await rp.locator('[data-section=systemHealth]').count(),0);
  assert.equal((await rp.request.get(base+'/api/admin/system-health')).status(),403);
  assert.equal((await rp.request.get(base+`/api/admin/requests/${handedRequest}`)).status(),404);metrics.restrictedRole=true;
  await section(rp,'requests',`[data-transfer-response="${transfer.id}"]`);
  const acceptResponse=rp.waitForResponse(r=>r.url().endsWith(`/transfers/${transfer.id}/respond`)&&r.request().method()==='POST');
  await rp.locator(`[data-transfer-response="${transfer.id}"][data-decision=accept]`).click();assert.equal((await acceptResponse).status(),200);
  const handed=db.prepare('SELECT assigned_to,department_id,payload FROM requests WHERE id=?').get(handedRequest);
  assert.equal(handed.assigned_to,receiver);assert.equal(handed.department_id,receiverDept);assert.equal(handed.payload,original.payload);assert.equal(db.prepare('SELECT status FROM request_transfers WHERE id=?').get(transfer.id).status,'accepted');assert.ok(db.prepare('SELECT COUNT(*) n FROM request_owner_history WHERE request_id=?').get(handedRequest).n>0);metrics.transfer=true;
  await receiving.close();
  await page.keyboard.press('Escape');
  await section(page,'tasks','[data-new-task]');await scan(page,'tasks');
  await page.locator('[data-new-task]').click();await dialog.waitFor();await scan(page,'new-task-dialog');await page.keyboard.press('Escape');
  await section(page,'programs','[data-new]');await scan(page,'program-list');
  await page.locator('[data-new]').click();await page.locator('[data-field=title]').waitFor();await scan(page,'program-editor');
  await section(page,'reports','[data-rp-filters]');await scan(page,'reports');
  await section(page,'systemHealth','[data-health-refresh]');await scan(page,'system-health');
  assert.ok((await page.locator('#view').innerText()).includes('لا دليل هنا على نسخة دورية'));
  const health=await page.request.get(base+'/api/admin/system-health');assert.equal(health.status(),200);assert.equal((await health.json()).database.schemaVersion,10);metrics.health=true;
  await page.waitForFunction(()=>!document.querySelector('#toastStack')?.children.length,undefined,{timeout:8000});
  await page.screenshot({path:join(out,'system-health-desktop.png'),fullPage:true});
  const transitions=[];
  for(let i=0;i<3;i++){const t=Date.now();await section(page,'reports','[data-rp-filters]');transitions.push(Date.now()-t);await section(page,'systemHealth','[data-health-refresh]');}
  metrics.performance.reportTransitionMs=transitions;assert.ok(Math.max(...transitions)<2500,'Report interaction readiness budget: 2500ms for 1500 synthetic requests');
  const mobile=await context({width:390,height:844},{reducedMotion:'reduce'}),mp=await mobile.newPage();await mp.goto(base+'/admin');await mp.locator('[data-section=systemHealth]').waitFor({state:'attached'});await section(mp,'systemHealth','[data-health-refresh]');await scan(mp,'mobile-health');
  metrics.mobileDimensions=await mp.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,columns:getComputedStyle(document.querySelector('.health-grid')).gridTemplateColumns.split(' ').length}));
  assert.equal(metrics.mobileDimensions.scroll,390);assert.equal(metrics.mobileDimensions.columns,1);metrics.mobile=true;
  await mp.screenshot({path:join(out,'system-health-mobile.png'),fullPage:true});
  await section(mp,'tasks','[data-new-task]');await mp.locator('[data-new-task]').click();await mp.locator('dialog[open]').waitFor();
  const motion=await mp.locator('.drawer').evaluate(e=>({animation:getComputedStyle(e).animationDuration,transition:getComputedStyle(e).transitionDuration,reduce:matchMedia('(prefers-reduced-motion: reduce)').matches}));
  assert.equal(motion.reduce,true);assert.ok(parseFloat(motion.animation)<.01&&parseFloat(motion.transition)<.01);metrics.reducedMotion=true;await mp.keyboard.press('Escape');
  // A 720px CSS viewport models reflow at 200% on a 1440px desktop, without claiming a browser-zoom audit of every screen.
  await page.setViewportSize({width:720,height:900});await section(page,'systemHealth','[data-health-refresh]');await settled(page);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);metrics.zoom=true;
  await page.screenshot({path:join(out,'system-health-reflow-720.png'),fullPage:true});
  assert.deepEqual(metrics.errors,[]);
  writeFileSync(join(out,'accessibility-findings.json'),JSON.stringify(violations,null,2));
  assert.deepEqual(violations,[],'Accessibility violations must be fixed; no rules are disabled');
  console.log('STAFF_QUALITY_ACCEPTANCE 8/8',JSON.stringify(metrics));
}finally{
  writeFileSync(join(out,'metrics.json'),JSON.stringify(metrics,null,2));
  writeFileSync(join(out,'accessibility-findings.json'),JSON.stringify(violations,null,2));
  await browser.close();await app.close();
}
