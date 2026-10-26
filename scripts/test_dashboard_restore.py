from contextlib import closing
import importlib.util
import json
from pathlib import Path
import sqlite3
import os
import subprocess
import sys
import zipfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod

backup = load('restore_backup_test', 'panel-backup.py')
restore = load('dashboard_restore_test', 'dashboard-restore.py') if (ROOT / 'scripts/dashboard-restore.py').exists() else None

class RestoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.template = self.root / 'template.db'
        with closing(sqlite3.connect(self.template)) as c, c:
            for table in ['AdminUser', 'Reseller', 'ResellerUser', 'ResellerInbound', 'PanelConfig', 'OperationJournal', 'Setting', 'ActivityLog']:
                c.execute(f'CREATE TABLE {table}(id TEXT PRIMARY KEY, value TEXT)')
            for table, cols in [('AdminUser',['totpSecret']),('Reseller',['totpSecret','tgBotToken','mirzaBotToken']),('PanelConfig',['password','apiToken']),('Setting',['key'])]:
                for col in cols: c.execute(f'ALTER TABLE {table} ADD COLUMN {col} TEXT')
        self.source = self.root / 'source.db'; self.source.write_bytes(self.template.read_bytes())
        with closing(sqlite3.connect(self.source)) as c, c:
            c.execute("INSERT INTO AdminUser(id,value) VALUES('original-admin','hash')")
            c.execute("INSERT INTO Reseller(id,value) VALUES('r1','pool-100')")
            c.execute("INSERT INTO ResellerUser(id,value) VALUES('u1','identity-unchanged')")
        self.archive = self.root / 'archives'
        out = backup.create_archive(self.source, self.archive, 'source-secret', [])
        self.archive = self.archive / out['name']
        self.data = self.root / 'data'; self.data.mkdir()
        (self.data / 'custom.db').write_bytes(self.template.read_bytes())
        with closing(sqlite3.connect(self.data / 'custom.db')) as c, c: c.execute("INSERT INTO AdminUser(id,value) VALUES('bootstrap','hash')")
    def need(self):
        self.assertIsNotNone(restore, 'cold-start dashboard restore implementation missing')
    def stage(self):
        self.need(); stage = self.data / '.restore' / ('a' * 64); stage.mkdir(parents=True)
        (stage / 'archive.zip').write_bytes(self.archive.read_bytes())
        result = restore.inspect_upload(stage, self.template)
        return stage, result
    def queue(self, stage):
        state = {'id':stage.name, 'sha256':backup.file_hash(stage / 'archive.zip'), 'phase':'queued'}
        restore.atomic_json(self.data / '.restore/pending.json', state)
    def test_preview_validates_and_counts_without_touching_destination(self):
        before = (self.data / 'custom.db').read_bytes()
        stage, result = self.stage()
        self.assertEqual(result['counts']['ResellerUser'], 1)
        self.assertNotIn('source-secret', json.dumps(result))
        self.assertEqual((self.data / 'custom.db').read_bytes(), before)
        self.assertEqual((stage / 'restored/recovery.env').read_text().strip(), 'APP_SECRET=source-secret')
    def test_only_well_formed_session_revocations_are_allowed_on_fresh_target(self):
        database = self.data / 'custom.db'
        with closing(sqlite3.connect(database)) as c, c:
            c.execute('INSERT INTO Setting(id,key,value) VALUES(?,?,?)', ('logout', 'sessionRevoked:' + 'a' * 64, '9999999999999'))
        restore.assert_fresh(database)
        with closing(sqlite3.connect(database)) as c, c:
            c.execute('INSERT INTO Setting(id,key,value) VALUES(?,?,?)', ('unknown', 'sessionRevoked:invalid', 'keep'))
        with self.assertRaises(ValueError): restore.assert_fresh(database)
    def test_populated_destination_is_rejected_without_changes(self):
        stage, _ = self.stage(); self.queue(stage)
        with closing(sqlite3.connect(self.data / 'custom.db')) as c, c: c.execute("INSERT INTO Reseller(id,value) VALUES('real','keep')")
        before = (self.data / 'custom.db').read_bytes()
        with self.assertRaises(ValueError): restore.apply_pending(self.data, self.template, 'target-secret')
        self.assertEqual((self.data / 'custom.db').read_bytes(), before)
        self.assertFalse((self.data / '.app-secret').exists())
    def test_offline_install_restores_db_key_and_keeps_rollback(self):
        stage, _ = self.stage(); self.queue(stage)
        restore.apply_pending(self.data, self.template, 'target-secret')
        self.assertEqual((self.data / '.app-secret').read_text(), 'source-secret')
        with closing(sqlite3.connect(self.data / 'custom.db')) as c, c:
            self.assertEqual(c.execute('SELECT * FROM ResellerUser').fetchall(), [('u1','identity-unchanged')])
        self.assertFalse((self.data / '.restore/pending.json').exists())
        self.assertEqual(len(list((self.data / '.restore/rollback').glob('*.zip'))), 1)
        restore.apply_pending(self.data, self.template, 'target-secret')
    def test_interrupted_install_retries_before_node_can_start(self):
        stage, _ = self.stage(); self.queue(stage)
        original = restore.atomic_file
        def interrupted(path, payload):
            if path.name == '.app-secret': raise OSError('simulated power loss')
            original(path, payload)
        restore.atomic_file = interrupted
        try:
            with self.assertRaises(OSError): restore.apply_pending(self.data, self.template, 'target-secret')
        finally: restore.atomic_file = original
        self.assertTrue((self.data / '.restore/pending.json').exists())
        restore.apply_pending(self.data, self.template, 'target-secret')
        self.assertEqual((self.data / '.app-secret').read_text(), 'source-secret')
    def test_tampered_stage_cannot_install(self):
        stage, _ = self.stage(); self.queue(stage)
        (stage / 'archive.zip').write_bytes(b'broken')
        before = (self.data / 'custom.db').read_bytes()
        with self.assertRaises(ValueError): restore.apply_pending(self.data, self.template, 'target-secret')
        self.assertEqual((self.data / 'custom.db').read_bytes(), before)
    def test_direct_backup_cli_after_restore_uses_effective_key(self):
        stage, _ = self.stage(); self.queue(stage)
        restore.apply_pending(self.data, self.template, 'target-secret')
        inputs = self.root / 'input.json'; inputs.write_text('{"panels":[]}')
        directory = self.root / 'after-backups'
        subprocess.run([sys.executable,str(ROOT/'scripts/panel-backup.py'),'create','--database',str(self.data/'custom.db'),'--directory',str(directory),'--input',str(inputs)],env={**os.environ,'APP_SECRET':'target-secret'},check=True,stdout=subprocess.DEVNULL)
        with zipfile.ZipFile(next(directory.glob('*.zip'))) as z:
            self.assertEqual(json.loads(z.read('recovery.json'))['APP_SECRET'],'source-secret')
    def test_schema_mismatch_and_trigger_are_rejected(self):
        self.need()
        with closing(sqlite3.connect(self.source)) as c, c: c.execute('CREATE TRIGGER evil AFTER INSERT ON Reseller BEGIN DELETE FROM ResellerUser; END')
        out = backup.create_archive(self.source, self.root / 'bad', 'source-secret', [])
        stage = self.data / '.restore' / ('b' * 64); stage.mkdir(parents=True)
        (stage / 'archive.zip').write_bytes((self.root / 'bad' / out['name']).read_bytes())
        with self.assertRaises(ValueError): restore.inspect_upload(stage, self.template)
    def test_incompatible_columns_rejected(self):
        self.need()
        with closing(sqlite3.connect(self.source)) as c, c: c.execute('ALTER TABLE Reseller ADD COLUMN futureField TEXT')
        out = backup.create_archive(self.source, self.root / 'bad-schema', 'source-secret', [])
        stage = self.data / '.restore' / ('c' * 64); stage.mkdir(parents=True)
        (stage / 'archive.zip').write_bytes((self.root / 'bad-schema' / out['name']).read_bytes())
        with self.assertRaises(ValueError): restore.inspect_upload(stage, self.template)
    def test_each_persistent_domain_blocks_freshness(self):
        self.need()
        for table in restore.EMPTY:
            with self.subTest(table=table):
                with closing(sqlite3.connect(self.data / 'custom.db')) as c, c:
                    c.execute(f'INSERT INTO {table}(id,value) VALUES(?,?)',('real','preserve'))
                with self.assertRaises(ValueError): restore.assert_fresh(self.data / 'custom.db')
                with closing(sqlite3.connect(self.data / 'custom.db')) as c, c: c.execute(f'DELETE FROM {table}')
    def test_incomplete_archive_rejected(self):
        self.need()
        out=backup.create_archive(self.source,self.root/'incomplete','source-secret',[],panel_errors=[{'id':'missing','name':'missing','error':'offline'}])
        stage=self.data/'.restore'/('d'*64);stage.mkdir(parents=True)
        (stage/'archive.zip').write_bytes((self.root/'incomplete'/out['name']).read_bytes())
        with self.assertRaises(ValueError):restore.inspect_upload(stage,self.template)
    def test_legacy_boolean_zero_default_matches_prisma_false(self):
        self.need()
        with closing(sqlite3.connect(self.template)) as c, c: c.execute('ALTER TABLE Reseller ADD COLUMN flag BOOLEAN NOT NULL DEFAULT false')
        with closing(sqlite3.connect(self.source)) as c, c: c.execute('ALTER TABLE Reseller ADD COLUMN flag BOOLEAN NOT NULL DEFAULT 0')
        out=backup.create_archive(self.source,self.root/'legacy','source-secret',[])
        stage=self.data/'.restore'/('e'*64);stage.mkdir(parents=True)
        (stage/'archive.zip').write_bytes((self.root/'legacy'/out['name']).read_bytes())
        self.assertEqual(restore.inspect_upload(stage,self.template)['counts']['Reseller'],1)

if __name__ == '__main__': unittest.main()
