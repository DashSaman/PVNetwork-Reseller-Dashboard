import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync,writeFileSync } from 'node:fs';
import path from 'node:path';
import { operationInstallation } from '../src/lib/operation-installation.ts';
test('normal restarts retain queue consent, while a fresh backup destination does not inherit execution consent',()=>{
 const root=path.join(process.cwd(),'.local-dev','operation-installation-'+Date.now()),old=process.env.DATABASE_URL;
 for(const name of ['original','restored'])mkdirSync(path.join(root,name),{recursive:true});
 try{
  process.env.DATABASE_URL='file:'+path.join(root,'original','custom.db');assert.equal(operationInstallation(),null);const id=operationInstallation(true);assert.match(id,/^[a-f0-9]{48}$/);assert.equal(operationInstallation(),id);
  process.env.DATABASE_URL='file:'+path.join(root,'restored','custom.db');assert.equal(operationInstallation(),null);assert.notEqual(operationInstallation(true),id);
  writeFileSync(path.join(root,'restored','.operation-installation'),'invalid');assert.throws(()=>operationInstallation());
 }finally{if(old===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=old}
});
