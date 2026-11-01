import {DatabaseSync} from 'node:sqlite';
import {realpathSync,statSync,statfsSync,mkdtempSync,copyFileSync,chmodSync,writeFileSync} from 'node:fs';
import {resolve,relative,dirname,join,parse} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {openDb} from '../lib/db.js';

const digest=value=>createHash('sha256').update(JSON.stringify(value,(_,v)=>v instanceof Uint8Array?Array.from(v):v)).digest('hex');
function check(db){if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Database integrity or foreign key check failed');}
const tables=db=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
const quoted=name=>'"'+name.replaceAll('"','""')+'"';
function compareHistorical(before,after,{migration=false}={}){
 let rowCount=0;const names=tables(before);
 for(const table of names){
   const columns=before.prepare(`PRAGMA table_info(${quoted(table)})`).all().map(c=>c.name),cols=columns.map(quoted).join(',');
   const oldCount=before.prepare(`SELECT COUNT(*) n FROM ${quoted(table)}`).get().n,newCount=after.prepare(`SELECT COUNT(*) n FROM ${quoted(table)}`).get().n;
   if(migration&&['audit_log','schema_migrations'].includes(table)){if(newCount<oldCount)throw new Error('Historical row count decreased');}
   else if(newCount!==oldCount)throw new Error('Historical row count changed');
   const get=after.prepare(`SELECT ${cols} FROM ${quoted(table)} WHERE rowid=?`);
   for(const old of before.prepare(`SELECT rowid AS __rehearsal_rowid,${cols} FROM ${quoted(table)} ORDER BY rowid`).iterate()){
     const rowid=old.__rehearsal_rowid;delete old.__rehearsal_rowid;const current=get.get(rowid);if(!current)throw new Error('Historical row missing');
     if(migration&&table==='role_definitions'){
       const oldGrants=JSON.parse(old.permissions),grants=new Set(oldGrants);
       if(grants.has('requests:read'))grants.add('tasks:read');if(grants.has('requests:write'))grants.add('tasks:write');if(grants.has('requests:assign'))grants.add('tasks:assign');
       if(digest([...grants].sort())!==digest(JSON.parse(current.permissions).sort()))throw new Error('Unexpected role permission change');
       current.permissions=old.permissions;
     }
     if(digest(old)!==digest(current))throw new Error('Historical cell mismatch');rowCount++;
   }
 }
 if(migration){const extra=after.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(r=>r.version);if(JSON.stringify(extra)!=='[1,2,3,4,5]')throw new Error('Unexpected migration ledger');}
 return {tables:names.length,rows:rowCount};
}
export function rehearsePrivateCopy({sourceFile,privateRoot,maxBytes=32*1024*1024}){
 const source=realpathSync(sourceFile),root=realpathSync(privateRoot),rel=relative(root,source);
 if(!rel||rel.startsWith('..')||resolve(root)===parse(root).root||/(^|[\\/])public([\\/]|$)/i.test(root))throw new Error('Source must be a file inside a private, non-root directory');
 if(!statSync(source).isFile()||statSync(source).size>maxBytes)throw new Error('Source exceeds the bounded rehearsal size');
 const free=statfsSync(root);if(free.bavail*free.bsize<Math.max(64*1024*1024,statSync(source).size*8))throw new Error('Insufficient private disk space for rehearsal');
 let live=new DatabaseSync(source,{readOnly:true});let version;
 try{check(live);version=live.prepare('PRAGMA user_version').get().user_version;if(version!==2)throw new Error('Rehearsal requires an existing version 2 source');}catch(error){live.close();throw error;}
 const directory=mkdtempSync(join(root,'phase2-private-rehearsal-'));chmodSync(directory,0o700);
 const pristine=join(directory,'source-v2.sqlite'),candidate=join(directory,'candidate-v5.sqlite'),restored=join(directory,'restored-v2.sqlite');
 try{live.prepare('VACUUM INTO ?').run(pristine);}finally{live.close();}
 chmodSync(pristine,0o600);copyFileSync(pristine,candidate);chmodSync(candidate,0o600);
 const original=new DatabaseSync(pristine,{readOnly:true});let upgraded;
 let report;
 try{
   check(original);upgraded=openDb(candidate);check(upgraded);
   if(upgraded.prepare('PRAGMA user_version').get().user_version!==5)throw new Error('Upgrade did not reach version 5');
   if(upgraded.migrationBackups.length!==3)throw new Error('Expected private snapshots for migrations 3,4,5');
   const preservation=compareHistorical(original,upgraded,{migration:true});
   for(const backup of upgraded.migrationBackups){const b=new DatabaseSync(backup,{readOnly:true});try{check(b);}finally{b.close();}chmodSync(backup,0o600);}
   upgraded.close();upgraded=null;
   const reopened=openDb(candidate);try{check(reopened);if(reopened.migrationBackups.length)throw new Error('Reopen unexpectedly reran migrations');}finally{reopened.close();}
   copyFileSync(pristine,restored);chmodSync(restored,0o600);const rollback=new DatabaseSync(restored,{readOnly:true});try{check(rollback);if(rollback.prepare('PRAGMA user_version').get().user_version!==2)throw new Error('Restore version mismatch');compareHistorical(original,rollback);}finally{rollback.close();}
   const production=new DatabaseSync(source,{readOnly:true});try{if(production.prepare('PRAGMA user_version').get().user_version!==version)throw new Error('Source schema changed during rehearsal');}finally{production.close();}
   report={ok:true,sourceVersion:2,candidateVersion:5,sourceOpenedReadOnly:true,historicalTables:preservation.tables,historicalRowsChecked:preservation.rows,historicalValuesPreserved:true,migrationSnapshots:3,reopenDidNotRerun:true,isolatedRestoreExact:true,integrity:'ok',foreignKeyErrors:0,retainedPrivately:true,at:new Date().toISOString()};
   writeFileSync(join(directory,'summary.json'),JSON.stringify(report,null,2),{mode:0o600});return report;
 }finally{upgraded?.close();original.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),source=args[args.indexOf('--source')+1],root=args[args.indexOf('--private-root')+1];
 if(!args.includes('--source')||!args.includes('--private-root')||!source||!root)throw new Error('Usage: --source <private v2 DB> --private-root <private parent directory>');
 try{console.log(JSON.stringify(rehearsePrivateCopy({sourceFile:source,privateRoot:root})));}catch{console.error('Private migration rehearsal failed; source was never opened for writing. Inspect the isolated directory on the server.');process.exitCode=1;}
}
