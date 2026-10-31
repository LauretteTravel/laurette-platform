import assert from 'node:assert/strict';
import {connect} from 'node:net';
import {readFileSync} from 'node:fs';
import {createApp} from '../server.js';
import {createSession,hashPassword} from '../lib/auth.js';
import {scanAttachment} from '../lib/attachment-scan.js';

// Synthetic fixture only: opt into uploads without bypassing the real scanner.
process.env.TASK_ATTACHMENT_UPLOADS_ENABLED='1';

const port=Number(process.env.ATTACHMENT_CLAMD_PORT||3310);
const command=(value)=>new Promise((resolve,reject)=>{const socket=connect({host:'127.0.0.1',port});let data='',settled=false;const done=(error,result)=>{if(settled)return;settled=true;socket.destroy();error?reject(error):resolve(result);};socket.setTimeout(2000,()=>done(new Error('clamd command timeout')));socket.on('error',error=>done(error));socket.on('connect',()=>socket.write('z'+value+'\0'));socket.on('data',chunk=>{data+=chunk.toString();if(data.length>4096)return done(new Error('Invalid clamd response'));if(data.includes('\0'))done(null,data.slice(0,data.indexOf('\0')));});socket.on('end',()=>{if(!settled)done(new Error('Incomplete clamd response'));});});
let ready=false;
for(let attempt=0;attempt<120;attempt++){try{if(await command('PING')==='PONG'){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,2000));}
assert.ok(ready,'Real ClamAV must become ready; no mock or bypass permitted');
const version=await command('VERSION');assert.match(version,/^ClamAV /);
const signatureDate=Date.parse(version.split('/').slice(2).join('/'));
assert.ok(Number.isFinite(signatureDate),'ClamAV signature date must be available');
assert.ok(Date.now()-signatureDate<=14*86400000 && signatureDate<=Date.now()+86400000,'ClamAV signatures must be within 14 days');
console.log('REAL_CLAMAV_VERSION',version);
const clean=Buffer.from('%PDF-1.7\nSynthetic acceptance document\n%%EOF');
await scanAttachment(clean);console.log('PASS real engine accepts benign bytes');
// Standard benign AV test marker assembled only in memory; never committed as a file.
const marker=Buffer.from(['X5O!P%@AP[4',String.fromCharCode(92),'PZX54(P^)7CC)7}$','EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'].join(''));
assert.equal(marker.length,68);
await assert.rejects(scanAttachment(marker),error=>error.status===422);
console.log('PASS real engine rejects standard benign AV test marker');
const seed=JSON.parse(readFileSync('data/seed.json','utf8'));
const app=createApp({dbFile:':memory:',seed:{...seed,users:[]},adminPassword:'Synthetic-Real-AV-Password42',baseUrl:'http://127.0.0.1:0'});
try{
 const db=app.db,hash=hashPassword('Synthetic-Real-AV-Password42'),now=new Date().toISOString();
 const id=Number(db.prepare("INSERT INTO users(username,name,role,password_hash,password_salt,created_at) VALUES('av-acceptance','Synthetic AV admin','admin',?,?,?)").run(hash.hash,hash.salt,now).lastInsertRowid);
 const branch=db.prepare('SELECT id FROM branches LIMIT 1').get().id;
 const taskId=Number(db.prepare('INSERT INTO tasks(branch_id,title,priority,assigned_to,created_by,due_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(branch,'Synthetic AV task','normal',id,id,now,now,now).lastInsertRowid);
 const cookie='lt_session='+createSession(db,id,'127.0.0.1','test',{mfaVerified:true}).token;
 const address=await app.listen(0,'127.0.0.1'),base=`http://127.0.0.1:${address.port}`;
 const post=async()=>fetch(base+`/api/admin/tasks/${taskId}/attachments`,{method:'POST',headers:{origin:base,cookie,'content-type':'application/json'},body:JSON.stringify({filename:'acceptance.pdf',base64:clean.toString('base64')})});
 let response=await post();assert.equal(response.status,201);const attachment=(await response.json()).id;
 response=await fetch(base+'/api/admin/task-attachments/'+attachment,{headers:{cookie}});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),clean);
 response=await fetch(base+'/api/admin/task-attachments/'+attachment);assert.equal(response.status,401);await response.text();
 console.log('PASS real-engine API upload, private exact-byte download and anonymous rejection');
 const original=process.env.ATTACHMENT_CLAMD_PORT;process.env.ATTACHMENT_CLAMD_PORT='0';try{response=await post();assert.equal(response.status,503);await response.text();assert.equal(db.prepare('SELECT COUNT(*) n FROM task_attachments').get().n,1);}finally{if(original===undefined)delete process.env.ATTACHMENT_CLAMD_PORT;else process.env.ATTACHMENT_CLAMD_PORT=original;}
 console.log('PASS unavailable scanner fails closed without extra stored data');
 console.log('REAL_CLAMAV_ACCEPTANCE 4/4');
}finally{await app.close();}
