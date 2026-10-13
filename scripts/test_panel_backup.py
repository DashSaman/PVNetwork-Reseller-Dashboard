import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SCRATCH = ROOT / '.local-dev'
SCRATCH.mkdir(exist_ok=True)
MODULE = ROOT / 'scripts/panel-backup.py'
backup = None
if MODULE.exists():
    spec = importlib.util.spec_from_file_location('panel_backup', MODULE)
    backup = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(backup)

class BackupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='backup-test-', dir=SCRATCH)
        self.root = Path(self.tmp.name).resolve()
        self.assertTrue(self.root.is_relative_to(SCRATCH.resolve()))
        self.addCleanup(self.tmp.cleanup)
        self.db = self.root / 'live.db'
        self.out = self.root / 'backups'
        conn = sqlite3.connect(self.db)
        conn.executescript("CREATE TABLE Reseller(id TEXT, username TEXT, trafficPoolGB INTEGER); CREATE TABLE ResellerUser(id TEXT, resellerId TEXT, email TEXT, trafficGB INTEGER); INSERT INTO Reseller VALUES('r1','reseller',100); INSERT INTO ResellerUser VALUES('u1','r1','user',10);")
        conn.close()
        self.panel = self.root / 'panel.db'
        conn = sqlite3.connect(self.panel)
        conn.executescript("CREATE TABLE clients(email TEXT, uuid TEXT, expiry INTEGER); INSERT INTO clients VALUES('user','uuid-42',2000000000000);")
        conn.close()
        self.now = 1800000000
    def need(self):
        self.assertIsNotNone(backup, 'portable backup implementation is missing')
    def make(self, now=None, **kwargs):
        self.need()
        return backup.create_archive(self.db, self.out, 'recovery-secret-42', [{'id':'panel-a','name':'Test panel','path':str(self.panel),'format':'sqlite'}], now=self.now if now is None else now, **kwargs)
    def test_portable_archive_restores_database_secret_and_native_panel_data(self):
        result = self.make()
        self.assertTrue(result['complete'])
        target = self.root / 'new-server'
        restored = backup.restore_archive(self.out / result['name'], target)
        self.assertTrue(restored['complete'])
        conn = sqlite3.connect(target / 'data/custom.db')
        self.assertEqual(conn.execute('select email,trafficGB from ResellerUser').fetchall(), [('user',10)])
        conn.close()
        self.assertEqual((target / 'recovery.env').read_text().strip(), 'APP_SECRET=recovery-secret-42')
        conn = sqlite3.connect(target / 'panels/panel-a.db')
        self.assertEqual(conn.execute('select uuid,expiry from clients').fetchall(), [('uuid-42',2000000000000)])
        conn.close()
    def test_sqlite_wal_snapshot_contains_committed_rows(self):
        conn = sqlite3.connect(self.db)
        conn.execute('pragma journal_mode=WAL')
        conn.execute("insert into ResellerUser values('u2','r1','wal-user',20)")
        conn.commit()
        self.addCleanup(conn.close)
        result = self.make()
        target = self.root / 'new-server'
        backup.restore_archive(self.out / result['name'], target)
        restored = sqlite3.connect(target / 'data/custom.db')
        self.assertEqual(restored.execute('select count(*) from ResellerUser').fetchone()[0], 2)
        restored.close()
    def test_restore_refuses_existing_destination_without_overwriting(self):
        result = self.make()
        target = self.root / 'existing'; target.mkdir(); marker = target / 'important'; marker.write_text('keep')
        with self.assertRaises(ValueError): backup.restore_archive(self.out / result['name'], target)
        self.assertEqual(marker.read_text(), 'keep')
    def test_retention_deletes_only_owned_archives_strictly_older_than_five_days(self):
        old = self.make(now=self.now - 5*86400 - 1)
        boundary = self.make(now=self.now - 5*86400)
        recent = self.make(now=self.now)
        unrelated = self.out / 'other-service.zip'; unrelated.write_bytes(b'keep')
        os.utime(unrelated, (self.now - 10*86400, self.now - 10*86400))
        removed = backup.prune_archives(self.out, now=self.now)
        self.assertEqual(recent['removed'], [old['name']])
        self.assertEqual(removed, [])
        self.assertFalse((self.out / old['name']).exists())
        self.assertTrue((self.out / boundary['name']).exists())
        self.assertTrue((self.out / recent['name']).exists())
        self.assertEqual(unrelated.read_bytes(), b'keep')
    def test_retention_never_follows_symlinks_or_directories(self):
        self.need()
        result = self.make()
        external = self.root / 'external'; external.write_text('untouched')
        link = self.out / 'pvnet-20000101T000000Z-abcdef123456.zip'
        try: link.symlink_to(external)
        except OSError: self.skipTest('symlink privileges unavailable')
        folder = self.out / 'pvnet-20000101T000000Z-abcdef123457.zip'; folder.mkdir()
        backup.prune_archives(self.out, now=self.now)
        self.assertEqual(external.read_text(), 'untouched')
        self.assertTrue(link.is_symlink()); self.assertTrue(folder.exists())
    def test_bad_panel_export_is_marked_partial_not_complete(self):
        result = self.make(panel_errors=[{'id':'missing','name':'Unavailable','error':'offline'}])
        self.assertFalse(result['complete'])
        entries = backup.list_archives(self.out)
        self.assertFalse(entries[0]['complete'])
        self.assertNotIn('recovery-secret-42', json.dumps(entries))
    def test_checksum_tampering_is_rejected_before_restore(self):
        result = self.make()
        original = self.out / result['name']; tampered = self.root / 'tampered.zip'
        with zipfile.ZipFile(original) as source, zipfile.ZipFile(tampered,'w') as dest:
            for name in source.namelist(): dest.writestr(name, b'tampered' if name == 'recovery.json' else source.read(name))
        with self.assertRaises(ValueError): backup.restore_archive(tampered, self.root / 'new-server')
        self.assertFalse((self.root / 'new-server').exists())
    def test_zip_path_traversal_is_rejected(self):
        result = self.make(); malicious = self.root / 'malicious.zip'
        with zipfile.ZipFile(self.out / result['name']) as source, zipfile.ZipFile(malicious,'w') as dest:
            for name in source.namelist(): dest.writestr(name, source.read(name))
            dest.writestr('../outside', b'bad')
        with self.assertRaises(ValueError): backup.restore_archive(malicious, self.root / 'new-server')
        self.assertFalse((self.root / 'outside').exists())
    def test_rejects_empty_secret_and_corrupt_database_without_publishing_archive(self):
        self.need()
        with self.assertRaises(ValueError): backup.create_archive(self.db,self.out,'',[],now=self.now)
        broken = self.root/'broken.db'; broken.write_text('not a database')
        with self.assertRaises(Exception): backup.create_archive(broken,self.out,'secret',[],now=self.now)
        self.assertFalse(list(self.out.glob('*.zip')))

if __name__ == '__main__': unittest.main()
