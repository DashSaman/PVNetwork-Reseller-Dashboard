"""Node API ownership boundary; no user/credential/counter writes upstream."""
import base64,hashlib,hmac,http.client,http.server,ipaddress,json,os,pathlib,re,select,shlex,socket,ssl,subprocess,sys,threading,time,urllib.parse,zlib
import requests
from cryptography import x509
from cryptography.hazmat.primitives import serialization

FILTER_ROUTES={'inbounds/list','clients/onlines','clients/onlinesByGuid','clients/lastOnline','server/clientIps','clients/clientIpsByGuid'}

def remaining(deadline=None,maximum=None):
    seconds=maximum if deadline is None else deadline-time.monotonic()
    if seconds is not None and seconds<=0:raise TimeoutError('Node API deadline exceeded')
    return min(seconds,maximum) if seconds is not None and maximum is not None else seconds

def connect_before_deadline(address,deadline,source_address=None,bind_device=None,socket_mark=None):
    host,port=address
    try:addresses=[str(ipaddress.ip_address(host))]
    except ValueError:
        # getent uses the same NSS policy as the application. A child process
        # gives DNS a cancellable deadline instead of an unbounded libc call.
        p=subprocess.run(['getent','ahosts',host],text=True,capture_output=True,timeout=remaining(deadline,2))
        if p.returncode:raise OSError('Node hostname resolution failed')
        addresses=list(dict.fromkeys(line.split()[0] for line in p.stdout.splitlines() if len(line.split())>=2 and line.split()[1]=='STREAM'))
        if not addresses:raise OSError('Node hostname has no stream address')
    error=None
    for ip in addresses:
        seconds=remaining(deadline,2)
        sock=socket.socket(socket.AF_INET6 if ':' in ip else socket.AF_INET,socket.SOCK_STREAM)
        try:
            sock.settimeout(seconds)
            if bind_device:sock.setsockopt(socket.SOL_SOCKET,socket.SO_BINDTODEVICE,bind_device.encode()+b'\0')
            if socket_mark is not None:sock.setsockopt(socket.SOL_SOCKET,socket.SO_MARK,socket_mark)
            if source_address:sock.bind(source_address)
            sock.connect((ip,port));remaining(deadline)
            return sock
        except OSError as exc:
            error=exc;sock.close()
        except BaseException:
            sock.close()
            raise
    raise error or OSError('No reachable node address')

def upstream_request(state,method,path,body,headers,deadline):
    """Bound the entire reply, including trickled headers/body, to one deadline."""
    origin=urllib.parse.urlsplit(state.origin)
    timeout=remaining(deadline)
    identity=(state.origin,state.verify,state.spki_pin,state.bind_device,state.socket_mark);conn=None
    # Only fully consumed, healthy connections are reused. Tokens, policies,
    # replies and write results are never cached or retried here.
    with state.lock:
        pool=getattr(state,'upstream_pool',[]);state.upstream_pool=pool
        while pool:
            key,idle,candidate=pool.pop()
            if key==identity and time.monotonic()-idle<15 and candidate.sock is not None and not select.select([candidate.sock],[],[],0)[0]:
                conn=candidate;break
            candidate.close()
    if conn is None and origin.scheme=='https':
        if state.spki_pin:
            # The trust anchor is the node key independently authenticated over
            # its registered WireGuard peer or pinned administrative SSH host.
            # Check that key BEFORE sending any token or request. CA names and
            # certificate renewal dates do not define this private trust model.
            context=ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            context.check_hostname=False;context.verify_mode=ssl.CERT_NONE
        else:context=ssl.create_default_context() if state.verify else ssl._create_unverified_context()
        context.minimum_version=ssl.TLSVersion.TLSv1_2
        conn=http.client.HTTPSConnection(origin.hostname,origin.port or 443,timeout=timeout,context=context)
    elif conn is None:conn=http.client.HTTPConnection(origin.hostname,origin.port or 80,timeout=timeout)
    timer=None;control=None;reusable=False;expired=threading.Event()
    def arm(sock):
        nonlocal timer,control
        # Arm before HTTPSConnection starts its TLS handshake. A raw duplicate
        # remains usable even after the SSL wrapper takes ownership of sock.
        control=socket.fromfd(sock.fileno(),sock.family,sock.type,sock.proto)
        def expire():
            expired.set()
            try:control.shutdown(socket.SHUT_RDWR)
            except OSError:pass
        timer=threading.Timer(remaining(deadline),expire);timer.daemon=True;timer.start()
    def dial(address,timeout=None,source_address=None):
        sock=connect_before_deadline(address,deadline,source_address,state.bind_device,state.socket_mark)
        arm(sock)
        sock.settimeout(remaining(deadline))
        return sock
    conn._create_connection=dial
    try:
        if conn.sock is None:conn.connect()
        else:arm(conn.sock)
        sock=conn.sock
        if state.spki_pin:
            cert=x509.load_der_x509_certificate(sock.getpeercert(binary_form=True))
            key=cert.public_key().public_bytes(serialization.Encoding.DER,serialization.PublicFormat.SubjectPublicKeyInfo)
            if not hmac.compare_digest(hashlib.sha256(key).hexdigest(),state.spki_pin):
                raise ssl.SSLError('Upstream node public key does not match the provisioned identity')
        # Reads, writes and TLS share the absolute request deadline. A fixed
        # two-second socket timeout rejected legitimate slower node updates.
        sock.settimeout(remaining(deadline))
        conn.request(method,path,body=body,headers=headers)
        response=conn.getresponse();status=response.status;response_headers=response.getheaders()
        if 300<=status<400:raise RuntimeError('Unexpected upstream redirect')
        cap=int(state.cfg.get('max_response_bytes',64*1024*1024));payload=bytearray()
        while True:
            remaining(deadline)
            chunk=response.read1(65536)
            if not chunk:break
            if len(payload)+len(chunk)>cap:raise RuntimeError('Upstream response exceeds limit')
            payload.extend(chunk)
        remaining(deadline)
        if response.length not in (None,0):raise RuntimeError('Truncated upstream response')
        payload=bytes(payload);encoding=response.getheader('Content-Encoding','').lower().strip()
        if encoding in ('gzip','deflate'):
            clear=bytearray();pending=payload
            while pending:
                remaining(deadline);decoder=zlib.decompressobj(31 if encoding=='gzip' else zlib.MAX_WBITS)
                try:chunk=decoder.decompress(pending,cap+1-len(clear))
                except zlib.error:
                    if encoding!='deflate':raise
                    decoder=zlib.decompressobj(-zlib.MAX_WBITS);chunk=decoder.decompress(pending,cap+1-len(clear))
                clear.extend(chunk)
                if len(clear)>cap or decoder.unconsumed_tail:raise RuntimeError('Upstream response exceeds limit')
                clear.extend(decoder.flush(max(1,cap+1-len(clear))))
                if len(clear)>cap or not decoder.eof:raise RuntimeError('Invalid compressed upstream response')
                pending=decoder.unused_data
                if pending and encoding!='gzip':raise RuntimeError('Trailing compressed upstream data')
            payload=bytes(clear)
        elif encoding not in ('','identity'):raise RuntimeError('Unsupported upstream response encoding')
        remaining(deadline)
        reusable=not response.will_close and conn.sock is not None
        return status,response_headers,payload
    finally:
        if timer is not None:
            timer.cancel();timer.join()
        if control is not None:control.close()
        with state.lock:
            if reusable and not expired.is_set() and len(state.upstream_pool)<8:
                state.upstream_pool.append((identity,time.monotonic(),conn))
            else:conn.close()

def filter_response(route,body,foreign):
    """Filter only attribution fields. Leave the node's settings/users intact."""
    if not isinstance(body,dict) or body.get('success') is not True:return body,0
    obj=body.get('obj');removed=0
    if route=='inbounds/list' and isinstance(obj,list):
        for inbound in obj:
            if not isinstance(inbound,dict):continue
            stats=inbound.get('clientStats')
            if not isinstance(stats,list):continue
            kept=[s for s in stats if not isinstance(s,dict) or s.get('email') not in foreign]
            removed+=len(stats)-len(kept);inbound['clientStats']=kept
    elif route=='clients/onlines' and isinstance(obj,list):
        kept=[e for e in obj if e not in foreign];removed=len(obj)-len(kept);body['obj']=kept
    elif route=='clients/onlinesByGuid' and isinstance(obj,dict):
        for guid,emails in obj.items():
            if isinstance(emails,list):
                kept=[e for e in emails if e not in foreign];removed+=len(emails)-len(kept);obj[guid]=kept
    elif route=='clients/lastOnline' and isinstance(obj,dict):
        kept={e:v for e,v in obj.items() if e not in foreign};removed=len(obj)-len(kept);body['obj']=kept
    elif route=='server/clientIps' and isinstance(obj,list):
        kept=[row for row in obj if not isinstance(row,dict) or row.get('clientEmail') not in foreign]
        removed=len(obj)-len(kept);body['obj']=kept
    elif route=='clients/clientIpsByGuid' and isinstance(obj,dict):
        for guid,emails in obj.items():
            if isinstance(emails,dict):
                kept={e:v for e,v in emails.items() if e not in foreign};removed+=len(emails)-len(kept);obj[guid]=kept
    return body,removed

class PolicyDB:
    def __init__(self,node_id):
        self.node_id=int(node_id)
        self.procenv,self.env=self.runtime_environment()
    def runtime_environment(self,deadline=None):
        pid=subprocess.check_output(['systemctl','show','x-ui.service','-p','MainPID','--value'],text=True,timeout=remaining(deadline,1)).strip()
        procenv=dict(s.split('=',1) for s in pathlib.Path('/proc/'+pid+'/environ').read_bytes().decode().split('\0') if '=' in s)
        assert procenv.get('XUI_DB_TYPE')=='postgres'
        dsn=procenv['XUI_DB_DSN']
        if dsn.startswith(('postgres://','postgresql://')):
            u=urllib.parse.urlsplit(dsn)
            cfg={'host':u.hostname or '', 'port':str(u.port or 5432),'dbname':u.path.lstrip('/'),'user':urllib.parse.unquote(u.username or ''),'password':urllib.parse.unquote(u.password or '')}
            cfg.update(dict(urllib.parse.parse_qsl(u.query)))
        else:cfg=dict(s.split('=',1) for s in shlex.split(dsn) if '=' in s)
        env=os.environ.copy()
        for k,n in {'host':'PGHOST','port':'PGPORT','dbname':'PGDATABASE','user':'PGUSER','password':'PGPASSWORD','sslmode':'PGSSLMODE'}.items():
            if k in cfg:env[n]=cfg[k]
        env['PGAPPNAME']='t6_node'+str(self.node_id)+'_ownership_readonly'
        env['PGOPTIONS']='-c default_transaction_read_only=on -c statement_timeout=1500 -c lock_timeout=250'
        return procenv,env
    def query(self,sql,runtime=None,deadline=None):
        _,env=runtime if runtime is not None else self.runtime_environment(deadline)
        p=subprocess.run(['psql','-X','-A','-t','-q','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True,env=env,timeout=remaining(deadline,2))
        if p.returncode:raise RuntimeError('Ownership policy database unavailable')
        return json.loads(p.stdout)
    def foreign(self,deadline=None):
        # Exact same ownership rule as the installed panel, evaluated fresh for
        # every response before any stats or online attribution can be emitted.
        result=self.query("SELECT coalesce(jsonb_agg(c.email),'[]'::jsonb) FROM public.clients c WHERE EXISTS(SELECT 1 FROM public.client_inbounds ci JOIN public.inbounds attached ON attached.id=ci.inbound_id WHERE ci.client_id=c.id) AND NOT EXISTS(SELECT 1 FROM public.client_inbounds ci JOIN public.inbounds i ON i.id=ci.inbound_id WHERE ci.client_id=c.id AND i.node_id="+str(self.node_id)+");",deadline=deadline)
        return set(result)
    def token(self,deadline=None):
        # A panel restart may rotate both DSN credentials and the node token
        # encryption key. Read one current runtime/key snapshot per request.
        runtime=self.runtime_environment(deadline=deadline);procenv,_=runtime
        stored=self.query('SELECT to_jsonb(api_token) FROM public.nodes WHERE id='+str(self.node_id)+';',runtime=runtime,deadline=deadline)
        if not stored.startswith('enc:v1:'):return stored
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        _,_,key_id,encoded=stored.split(':',3)
        if procenv.get('NODE_TOKEN_KEY_FILE'):
            encoded_key=json.loads(pathlib.Path(procenv['NODE_TOKEN_KEY_FILE']).read_text())['keys'][key_id]
        else:encoded_key=procenv['NODE_TOKEN_KEY']
        key=base64.b64decode(encoded_key+'='*((-len(encoded_key))%4))
        blob=base64.urlsafe_b64decode(encoded+'='*((-len(encoded))%4))
        return AESGCM(key).decrypt(blob[:12],blob[12:],('nodes/api_token/'+str(self.node_id)).encode()).decode()

class State:
    def __init__(self,cfg,db):
        self.cfg=cfg;self.db=db
        # The database is the authority for node credentials. An installation
        # fingerprint is evidence, not a second token configuration to rotate.
        assert db.token(), 'Node credential unavailable'
        self.base_path=cfg['base_path'].rstrip('/')+'/panel/api/'
        self.origin=cfg['upstream_origin'].rstrip('/')
        assert urllib.parse.urlsplit(self.origin).scheme=='https'
        mode=cfg['upstream_tls_verify_mode']
        assert mode in ('skip','verify','pin')
        self.verify=mode=='verify';self.spki_pin=None
        if mode=='pin':
            # A pinned route must use a literal address; no DNS/fallback path.
            ipaddress.ip_address(urllib.parse.urlsplit(self.origin).hostname)
            pin=cfg.get('upstream_spki_sha256')
            if not isinstance(pin,str) or not re.fullmatch(r'[a-fA-F0-9]{64}',pin):raise ValueError('A provisioned SHA256 node public-key pin is required')
            self.spki_pin=pin.lower()
        self.bind_device=cfg.get('upstream_bind_device')
        if self.bind_device is not None and (not isinstance(self.bind_device,str) or not re.fullmatch(r'[a-zA-Z0-9_.:-]{1,15}',self.bind_device)):raise ValueError('Invalid upstream network interface')
        self.socket_mark=cfg.get('upstream_socket_mark')
        if self.socket_mark is not None and (type(self.socket_mark) is not int or not 0<=self.socket_mark<=0xffffffff):raise ValueError('Invalid upstream socket mark')
        self.status={'started_utc':time.time(),'requests':0,'filtered_rows':0,'failures':0,'downstream_disconnects':0,'denied_auth':0}
        self.lock=threading.Lock();self.slots=threading.BoundedSemaphore(8);self.upstream_pool=[]
        self.db.foreign()  # Refuse startup if the ownership boundary is unavailable.
    def record(self,**values):
        with self.lock:
            for route_key,count_key in [('last_route','requests'),('last_failure_route','failures')]:
                if values.get(count_key) and values.get(route_key):
                    parts=values[route_key].split('/',2);route='/'.join(parts[:2])+('/*' if len(parts)>2 else '')
                    metrics=self.status.setdefault('routes',{}).setdefault(route,{'requests':0,'failures':0,'filtered_rows':0})
                    metrics[count_key]+=values[count_key]
                    if count_key=='requests':
                        metrics['filtered_rows']+=values.get('filtered_rows',0);metrics['last_success_utc']=values.get('last_request_utc',time.time())
                        metrics['last_elapsed_ms']=values.get('last_reply_elapsed_ms')
            for k,v in values.items():
                if k in ('requests','filtered_rows','failures','downstream_disconnects','denied_auth'):self.status[k]=self.status.get(k,0)+v
                elif k=='max_reply_elapsed_ms':self.status[k]=max(self.status.get(k,0),v)
                else:self.status[k]=v
            path=pathlib.Path(self.cfg['status_file']);tmp=path.with_suffix('.tmp')
            try:
                tmp.write_text(json.dumps(self.status),encoding='utf8');os.chmod(tmp,0o600);os.replace(tmp,path)
            except OSError:pass  # Status persistence must not corrupt an API reply.

class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    server_version='T6NodeOwnership/1'
    def log_message(self,*args):pass
    def error(self,status,message):
        payload=json.dumps({'success':False,'msg':message}).encode()
        self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(payload)));self.send_header('Connection','close');self.end_headers();self.wfile.write(payload);self.close_connection=True
    def do_GET(self):self.forward()
    def do_POST(self):self.forward()
    def forward(self):
        state=self.server.state
        started=time.monotonic();phase='admission'
        parsed=urllib.parse.urlsplit(self.path)
        if parsed.scheme or parsed.netloc or not parsed.path.startswith(state.base_path):return self.error(404,'Unknown API path')
        route=parsed.path[len(state.base_path):]
        if not route or '..' in urllib.parse.unquote(route).split('/'):return self.error(404,'Unknown API path')
        filtered_route=route in FILTER_ROUTES and not(route=='server/clientIps' and self.command!='GET')
        budget=float(state.cfg.get('request_budget_seconds',8))
        if self.command=='GET' or filtered_route:budget=min(budget,float(state.cfg.get('poll_budget_seconds',3.5)))
        deadline=started+min(8,max(.1,budget))
        if self.headers.get('Transfer-Encoding'):return self.error(400,'Unsupported request encoding')
        try:length=int(self.headers.get('Content-Length','0'))
        except ValueError:return self.error(400,'Invalid request length')
        if length<0 or length>16*1024*1024:return self.error(413,'Request too large')
        if not state.slots.acquire(blocking=False):return self.error(503,'API bridge is busy')
        try:
            phase='authorization'
            token=state.db.token(deadline=deadline)
            if not token:raise RuntimeError('Node credential unavailable')
            if not hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+token):
                state.record(denied_auth=1)
                phase='downstream';return self.error(401,'Unauthorized')
            self.connection.settimeout(remaining(deadline,3))
            body=self.rfile.read(length) if length else None
            if length and len(body)!=length:return self.error(400,'Incomplete request')
            excluded_request={'host','content-length','accept-encoding','connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade'}
            headers={k:v for k,v in self.headers.items() if k.lower() not in excluded_request}
            # Preserve the node protocol's Content-Encoding, integrity hash and
            # master-push marker while leaving compressed request bytes intact.
            headers['Authorization']='Bearer '+token;headers['Accept-Encoding']='gzip, deflate'
            phase='upstream';upstream_started=time.monotonic()
            status,response_headers,payload=upstream_request(state,self.command,self.path,body,headers,deadline)
            upstream_ms=round((time.monotonic()-upstream_started)*1000,1)
            removed=0
            phase='ownership_policy'
            if filtered_route and status==200:
                foreign=state.db.foreign(deadline=deadline)  # No stale policy cache for incoming counters.
                decoded,removed=filter_response(route,json.loads(payload),foreign)
                payload=json.dumps(decoded,ensure_ascii=False,separators=(',',':')).encode()
            phase='downstream'
            self.connection.settimeout(remaining(deadline,1))
            self.send_response(status)
            excluded={'content-length','content-encoding','transfer-encoding','connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','upgrade','etag'}
            for k,v in response_headers:
                if k.lower() not in excluded:self.send_header(k,v)
            self.send_header('Content-Length',str(len(payload)));self.send_header('Connection','close');self.end_headers();self.wfile.write(payload);self.close_connection=True
            elapsed_ms=round((time.monotonic()-started)*1000,1)
            state.record(requests=1,filtered_rows=removed,last_request_utc=time.time(),last_route=route,last_upstream_status=status,last_upstream_ms=upstream_ms,last_reply_elapsed_ms=elapsed_ms,max_reply_elapsed_ms=elapsed_ms)
        except Exception as exc:
            if phase=='downstream' and isinstance(exc,(BrokenPipeError,ConnectionResetError,ssl.SSLEOFError)):
                state.record(downstream_disconnects=1,last_disconnect_utc=time.time(),last_disconnect_error=type(exc).__name__,last_disconnect_route=route,last_disconnect_elapsed_ms=round((time.monotonic()-started)*1000,1))
            else:
                state.record(failures=1,last_failure_utc=time.time(),last_error=type(exc).__name__,last_failure_phase=phase,last_failure_route=route,last_failure_elapsed_ms=round((time.monotonic()-started)*1000,1))
                try:
                    self.connection.settimeout(.25)
                    self.error(503,'Node ownership API temporarily unavailable')
                except OSError:pass
        finally:state.slots.release()

class Server(http.server.ThreadingHTTPServer):
    daemon_threads=True
    def get_request(self):
        sock,address=super().get_request();sock.settimeout(5)
        cfg=self.state.cfg
        key=(os.stat(cfg['cert_file']).st_mtime_ns,os.stat(cfg['key_file']).st_mtime_ns)
        with self.cert_lock:
            if key!=self.cert_stamp:
                context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.minimum_version=ssl.TLSVersion.TLSv1_2
                context.load_cert_chain(cfg['cert_file'],cfg['key_file']);self.context=context;self.cert_stamp=key
            context=self.context
        return context.wrap_socket(sock,server_side=True),address

def main():
    cfg=json.loads(pathlib.Path(sys.argv[1]).read_text())
    assert cfg['listen']=='127.0.0.1'
    requests.packages.urllib3.disable_warnings()
    state=State(cfg,PolicyDB(cfg['node_id']))
    server=Server((cfg['listen'],int(cfg['port'])),Handler)
    server.state=state;server.cert_lock=threading.Lock();server.cert_stamp=None;server.context=None
    state.record(ready=True)
    server.serve_forever(poll_interval=.5)

if __name__=='__main__':main()
