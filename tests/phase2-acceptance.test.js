import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createApp} from '../server.js';
import {staffLogin} from './helpers/staff-auth.mjs';
import {runDeadlineJob} from '../lib/deadlines.js';

test('phase2 acceptance: Arabic employee, mandatory password change, intake, task, follow-up, escalation and closure',async()=>{
 for(const key of ['N8N_BOOKING_WEBHOOK_URL','N8N_WEBHOOK_KEY','N8N_WEBHOOK_SECRET'])delete process.env[key];
 process.env.WHATSAPP_NOTIFICATIONS_ENABLED='0';
 const seed=JSON.parse(readFileSync('data/seed.json','utf8')),password='Synthetic-Acceptance-Password42';
 const app=createApp({dbFile:':memory:',seed:{...seed,users:seed.users.map(({password,...u})=>u)},adminPassword:password,baseUrl:'http://127.0.0.1:0',sendVerificationEmail:async()=>{}});
 try{
 const address=await app.listen(0,'127.0.0.1'),base=`http://127.0.0.1:${address.port}`;
 const api=async(path,body,cookie,method=body?'POST':'GET')=>{const r=await fetch(base+path,{method,headers:{origin:base,'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json()};};
 const admin=await staffLogin(base,seed.users[0].username,password);assert.equal(admin.res.status,200);
 const branch=app.db.prepare('SELECT id FROM branches ORDER BY id LIMIT 1').get().id,department=app.db.prepare("SELECT id FROM departments WHERE name='قسم التذاكر' AND active=1").get().id;
 const created=await api('/api/admin/users',{username:'موظف_قبول',name:'موظف قبول مصطنع',password,role:'agent',roleKey:'sales_agent',branchId:branch,departmentId:department},admin.cookie);assert.equal(created.status,201,JSON.stringify(created.data));
 const employee=app.db.prepare('SELECT id FROM users WHERE username=?').get('موظف_قبول').id,adminId=admin.payload.user.id;
 assert.equal((await api(`/api/admin/users/${employee}/profile`,{manager_id:adminId,reason:'ربط مدير مباشر لتجربة القبول المصطنعة'},admin.cookie,'PATCH')).status,200);
 const staff=await staffLogin(base,'موظف_قبول',password);assert.equal(staff.res.status,200);assert.notEqual(staff.password,password);
 const intake=await api('/api/admin/requests',{type:'flight',tripType:'return',origin:'عمّان (AMM)',destination:'إسطنبول (IST)',departDate:new Date(Date.now()+14*86400000).toISOString().slice(0,10),returnDate:new Date(Date.now()+21*86400000).toISOString().slice(0,10),adults:1,children:0,infants:0,cabin:'economy',baggage:'standard',name:'عميل قبول مصطنع',phone:'0790000099',email:'acceptance@example.invalid',consent:true,branchId:branch,departmentId:department,assignedTo:employee},admin.cookie);assert.equal(intake.status,201,JSON.stringify(intake.data));
 const request=intake.data.requestId,dueAt=new Date(Date.now()-180*60000).toISOString();
 assert.equal((await api(`/api/admin/requests/${request}`,null,staff.cookie)).status,200);
 const task=await api('/api/admin/tasks',{title:'مهمة قبول مترابطة',branchId:branch,departmentId:department,requestReference:intake.data.reference,assignedTo:employee,dueAt},admin.cookie);assert.equal(task.status,201,JSON.stringify(task.data));
 const follow=await api(`/api/admin/requests/${request}/follow-ups`,{note:'متابعة قبول مصطنعة',assignedTo:employee,dueAt},admin.cookie);assert.equal(follow.status,201);
 const policy=(await api('/api/admin/deadline-policy',null,admin.cookie)).data.policy;
 assert.equal((await api('/api/admin/deadline-policy',{...policy,enabled:true,soonMinutes:60,escalateMinutes:120,reason:'اعتماد سياسة في اختبار القبول فقط'},admin.cookie)).status,200);
 assert.equal(runDeadlineJob(app.db).created,4);assert.equal(runDeadlineJob(app.db).created,0);
 assert.equal((await api('/api/admin/deadline-alerts',null,staff.cookie)).data.unread,2);
 assert.equal((await api('/api/admin/deadline-alerts',null,admin.cookie)).data.unread,2);
 assert.equal((await api(`/api/admin/tasks/${task.data.id}/checklist`,{title:'مراجعة تفاصيل الطلب'},staff.cookie)).status,201);
 assert.equal((await api(`/api/admin/tasks/${task.data.id}`,{version:1,status:'in_progress',reason:'بدء العمل في اختبار القبول'},staff.cookie,'PATCH')).status,200);
 let detail=(await api(`/api/admin/tasks/${task.data.id}`,null,staff.cookie)).data;
 assert.equal((await api(`/api/admin/tasks/${task.data.id}`,{version:detail.task.version,status:'done',reason:'محاولة إغلاق قبل المراجعة'},staff.cookie,'PATCH')).status,422);
 const item=detail.checklist[0];assert.equal((await api(`/api/admin/task-checklist/${item.id}`,{version:item.version,done:true},staff.cookie,'PATCH')).status,200);
 assert.equal((await api(`/api/admin/tasks/${task.data.id}`,{version:detail.task.version,status:'done',reason:'اكتملت مراجعة الطلب المصطنع'},staff.cookie,'PATCH')).status,200);
 assert.equal((await api(`/api/admin/follow-ups/${follow.data.id}/finish`,{status:'done',reason:'اكتملت المتابعة المصطنعة'},staff.cookie)).status,200);
 assert.equal((await api('/api/admin/deadline-alerts',null,staff.cookie)).data.total,0);
 assert.equal((await api('/api/admin/deadline-alerts',null,admin.cookie)).data.total,0);
 for(const path of ['/','/account','/track','/programs','/admin'])assert.equal((await fetch(base+path)).status,200);
 assert.equal(app.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(app.db.prepare('PRAGMA foreign_key_check').all().length,0);
 console.log('PHASE2 ACCEPTANCE: 1 linked journey; 4 alerts; 0 duplicates; 0 active alerts after closure; 0 FK errors');
 }finally{await app.close();}
});
