import json, os, pathlib, shutil, stat, subprocess, tempfile, unittest

@unittest.skipUnless(os.name == 'posix' and shutil.which('bash'), 'requires POSIX file permissions and bash')
class PrivateConnectionHelper(unittest.TestCase):
    def exercise(self, fail):
        with tempfile.TemporaryDirectory() as temp:
            root=pathlib.Path(temp); binary=root/'bin'; binary.mkdir(); tmp=root/'tmp'; tmp.mkdir()
            (root/'CREDENTIALS.txt').write_text('fixture only\n')
            (root/'.env').write_text('ADMIN_USERNAME=fixture\nADMIN_PASSWORD=fixture-password\n')
            jq='''#!/usr/bin/python3
import os,json,sys
if 'baseUrl' in sys.argv[-1]:
 print(json.dumps(dict(baseUrl='http://dummy.invalid',username=os.environ['XUI_USER'],password=os.environ['XUI_PASS'])))
else: print(json.dumps(dict(username=os.environ['ADMIN_USERNAME'],password=os.environ['ADMIN_PASSWORD'])))
'''
            curl='''#!/usr/bin/python3
import os,sys,pathlib,stat,json
a=sys.argv[1:]
for option in ['-c','-b']:
 if option in a:
  p=pathlib.Path(a[a.index(option)+1]);assert p.parent.name.startswith('pvnet-connect.')
  assert stat.S_IMODE(p.parent.stat().st_mode)==0o700
  if option=='-c':p.write_text('fixture-session')
  assert stat.S_IMODE(p.stat().st_mode)&0o077==0
if '--data-binary' in a:
 p=pathlib.Path(a[a.index('--data-binary')+1][1:]);assert stat.S_IMODE(p.stat().st_mode)&0o077==0
 j=json.loads(p.read_text());assert j['password'] in ['fixture-password','native-fixture-password']
 assert not any('fixture-password' in v for v in a)
if os.environ.get('MOCK_FAIL')=='1':sys.exit(9)
print('{"ok":true}')
'''
            for name,source in [('jq',jq),('curl',curl)]:
                p=binary/name;p.write_text(source);p.chmod(0o755)
            env={**os.environ,'PATH':str(binary)+':/usr/bin:/bin','PVNET_DIRECTORY':str(root),'TMPDIR':str(tmp),
                 'XUI_USER':'native-fixture','XUI_PASS':'native-fixture-password','XUI_BASEPATH':'/fixture','XUI_WEB_PORT':'1234','PANEL_URL':'https://dummy.invalid','MOCK_FAIL':str(int(fail))}
            result=subprocess.run(['bash',str(pathlib.Path(__file__).with_name('connect_panel.sh'))],env=env,capture_output=True,text=True)
            self.assertEqual(result.returncode,9 if fail else 0,result.stderr)
            self.assertEqual(list(tmp.iterdir()),[],'credential staging was not removed')
    def test_private_temporary_credentials_and_cleanup_on_success(self):self.exercise(False)
    def test_private_temporary_credentials_and_cleanup_on_failure(self):self.exercise(True)

if __name__=='__main__':unittest.main()
