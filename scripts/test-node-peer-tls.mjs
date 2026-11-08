import assert from 'node:assert/strict';import https from 'node:https';import {test,after} from 'node:test';import {registerHooks} from 'node:module';import {mkdtempSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import {X509Certificate,createHash} from 'node:crypto';
const hooks=registerHooks({resolve(s,c,next){return next(s.startsWith('./')&&c.parentURL?.includes('/src/lib/')&&!s.endsWith('.ts')?s+'.ts':s,c)}});const{getInbounds}=await import('../src/lib/panel.ts');hooks.deregister();
const dir=mkdtempSync(path.join(tmpdir(),'pvnet-peer-tls-'));
execFileSync('python',['-c',`from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from datetime import datetime,timedelta,timezone
import ipaddress,pathlib,sys
p=pathlib.Path(sys.argv[1]);k=rsa.generate_private_key(public_exponent=65537,key_size=2048);p.joinpath('key.pem').write_bytes(k.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()));now=datetime.now(timezone.utc);name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'node.test')])
for label,end in [('valid',now+timedelta(days=30)),('expired',now-timedelta(days=1))]:
 c=x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(k.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(days=400)).not_valid_after(end).add_extension(x509.BasicConstraints(ca=True,path_length=None),True).add_extension(x509.SubjectAlternativeName([x509.DNSName('node.test'),x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]),False).sign(k,hashes.SHA256());p.joinpath(label+'.pem').write_bytes(c.public_bytes(serialization.Encoding.PEM))
`,dir],{windowsHide:true});
after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(tmpdir()));assert.ok(path.basename(dir).startsWith('pvnet-peer-tls-'));rmSync(dir,{recursive:true,force:true})});
const key=readFileSync(path.join(dir,'key.pem')),pem=kind=>readFileSync(path.join(dir,kind+'.pem'),'utf8'),pin=createHash('sha256').update(new X509Certificate(pem('valid')).publicKey.export({type:'spki',format:'der'})).digest('hex');
async function fixture(kind,fn){let received=0;const server=https.createServer({key,cert:pem(kind)},(req,res)=>{if(req.headers.authorization)received++;res.end(JSON.stringify({success:true,obj:[]}))});await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
 try{await fn({auth:{baseUrl:'https://127.0.0.1:'+port,token:'isolated-fake-peer-key',tls:{mode:'pin',connectHost:'127.0.0.1',ca:pem(kind),spkiSha256:pin}},received:()=>received,port})}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}}
test('a provisioned node key authenticates an expired self-signed certificate before its API key is sent',()=>fixture('expired',async({auth,received})=>{assert.equal((await getInbounds(auth)).ok,true);assert.equal(received(),1)}));
test('wrong pinned key is rejected before credentials or an HTTP request reach the peer',()=>fixture('valid',async({auth,received})=>{auth.tls.spkiSha256='0'.repeat(64);assert.equal((await getInbounds(auth)).ok,false);assert.equal(received(),0)}));
test('the same independently pinned key survives certificate renewal',()=>fixture('valid',async({auth,received})=>{assert.equal((await getInbounds(auth)).ok,true);assert.equal(received(),1)}));
test('pin mode rejects DNS connect destinations and malformed pins without sending credentials',()=>fixture('valid',async({auth,received})=>{for(const patch of [{connectHost:'node.invalid'},{spkiSha256:'bad'}]){const r=await getInbounds({...auth,tls:{...auth.tls,...patch}},{timeoutMs:100});assert.equal(r.ok,false)}assert.equal(received(),0)}));
test('existing CA mode retains strict hostname validation',()=>fixture('valid',async({port,received})=>{const auth={baseUrl:'https://node.test:'+port,token:'isolated-fake-peer-key',tls:{connectHost:'127.0.0.1',ca:pem('valid')}};assert.equal((await getInbounds(auth)).ok,true);assert.equal((await getInbounds({...auth,baseUrl:'https://wrong.test:'+port})).ok,false);assert.equal(received(),1)}));
