#!/usr/bin/env python3
"""Private dashboard staging and offline-only installation. No network or service management."""
from contextlib import closing
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import time

spec = importlib.util.spec_from_file_location('panel_backup_restore', Path(__file__).with_name('panel-backup.py'))
backup = importlib.util.module_from_spec(spec); spec.loader.exec_module(backup)
TABLES = ('AdminUser', 'Reseller', 'ResellerUser', 'ResellerInbound', 'PanelConfig', 'OperationJournal', 'Setting', 'ActivityLog')
EMPTY = ('Reseller', 'ResellerUser', 'ResellerInbound', 'PanelConfig', 'OperationJournal', 'Setting')
TOKEN = re.compile(r'^[a-f0-9]{64}$')

def sync_dir(path):
    if os.name != 'nt':
        fd = os.open(path, os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)

def atomic_file(path, payload):
    path = Path(path)
    if path.is_symlink(): raise ValueError('Symlink refused')
    tmp = path.with_name(path.name + '.new')
    with open(tmp, 'wb') as f:
        os.chmod(tmp, 0o600); f.write(payload); f.flush(); os.fsync(f.fileno())
    os.replace(tmp, path); sync_dir(path.parent)

def atomic_json(path, value):
    atomic_file(Path(path), json.dumps(value, ensure_ascii=True).encode())

def ro(path):
    return closing(sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True))

def assert_fresh(database):
    with ro(database) as c:
        if any(c.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0] for table in EMPTY):
            raise ValueError('Restore requires a fresh installation')

def inspect_database(database, template):
    backup.integrity(database)
    with ro(database) as c, ro(template) as t:
        if c.execute('PRAGMA foreign_key_check').fetchone(): raise ValueError('Foreign key violation')
        if c.execute("SELECT 1 FROM sqlite_master WHERE type IN ('trigger','view')").fetchone(): raise ValueError('Unexpected executable schema')
        actual = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'") if not r[0].startswith('sqlite_')}
        expected = {r[0] for r in t.execute("SELECT name FROM sqlite_master WHERE type='table'") if not r[0].startswith('sqlite_')}
        if actual != expected or not set(TABLES).issubset(actual): raise ValueError('Incompatible tables')
        def columns(connection, table):
            result=[]
            for _, name, typ, required, default, pk in connection.execute(f'PRAGMA table_info("{table}")'):
                # Older additive migrations used SQLite 0/1 for Prisma false/true.
                if typ.upper() == 'BOOLEAN' and default is not None:
                    default={'false':'0','true':'1'}.get(default.lower(),default)
                result.append((name,typ.upper(),required,default,pk))
            return sorted(result)
        for table in expected:
            # Compare full column contracts (name, type, nullability, default and PK).
            if columns(c,table) != columns(t,table):
                raise ValueError('Incompatible columns')
            if sorted(c.execute(f'PRAGMA foreign_key_list("{table}")').fetchall()) != sorted(t.execute(f'PRAGMA foreign_key_list("{table}")').fetchall()):
                raise ValueError('Incompatible relationships')
            def indexes(connection):
                return sorted((r[2], r[4], tuple(x[2] for x in connection.execute('PRAGMA index_info("' + r[1].replace('"','""') + '")'))) for r in connection.execute(f'PRAGMA index_list("{table}")'))
            if indexes(c) != indexes(t): raise ValueError('Incompatible indexes')
        counts = {table:c.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0] for table in TABLES}
        if not counts['AdminUser']: raise ValueError('No administrator in backup')
        return counts

def inspect_upload(stage, template):
    stage = Path(stage)
    if stage.is_symlink() or not TOKEN.fullmatch(stage.name): raise ValueError('Invalid stage')
    archive = stage / 'archive.zip'
    if archive.is_symlink() or archive.stat().st_size > 64 * 1024 * 1024: raise ValueError('Upload too large')
    meta = backup.verify_archive(archive)
    if not meta['complete']: raise ValueError('Incomplete backup')
    restored = stage / 'restored'
    backup.restore_archive(archive, restored)
    counts = inspect_database(restored / 'data/custom.db', template)
    return {'createdAt':meta['createdAt'], 'sha256':backup.file_hash(archive), 'counts':counts, 'nativePanelsIgnored':len(meta['panels'])}

def apply_pending(data, template, current_secret):
    data = Path(data); root = data / '.restore'; pending = root / 'pending.json'
    if not pending.exists(): return
    if root.is_symlink() or pending.is_symlink(): raise ValueError('Invalid pending state')
    state = json.loads(pending.read_text())
    if not TOKEN.fullmatch(state.get('id', '')) or state.get('phase') not in ('queued', 'applying'): raise ValueError('Invalid pending state')
    stage = root / state['id']
    if stage.is_symlink() or backup.file_hash(stage / 'archive.zip') != state['sha256']: raise ValueError('Archive changed')
    # Always re-extract from the hash-bound archive on restart, not mutable staging DB.
    restored = stage / 'restored'
    if restored.is_symlink(): raise ValueError('Invalid restored path')
    if restored.exists(): shutil.rmtree(restored)
    preview = inspect_upload(stage, template)
    crypto_script = Path(__file__).with_name('restore-crypto.cjs')
    subprocess.run(['node', str(crypto_script), str(restored)], check=True, stdout=subprocess.DEVNULL)
    secret = (restored / 'recovery.env').read_text().removeprefix('APP_SECRET=').rstrip('\n')
    if state['phase'] == 'queued':
        assert_fresh(data / 'custom.db')
        if not current_secret: raise ValueError('Missing target recovery key')
        rollback = backup.create_archive(data / 'custom.db', root / 'rollback', current_secret, [])
        state.update(phase='applying', rollback=rollback['name'])
        atomic_json(pending, state)
    # Replay is idempotent while Node is stopped; pending is cleared only after both durable writes.
    for suffix in ('-wal', '-shm'):
        sidecar = data / ('custom.db' + suffix)
        if sidecar.is_symlink(): raise ValueError('Invalid database sidecar')
        sidecar.unlink(missing_ok=True)
    atomic_file(data / 'custom.db', (restored / 'data/custom.db').read_bytes())
    atomic_file(data / '.app-secret', secret.encode())
    atomic_json(root / 'result.json', {'success':True, 'completedAt':time.time(), 'counts':preview['counts'], 'sha256':state['sha256']})
    pending.unlink(); sync_dir(root)
    shutil.rmtree(stage)

def main():
    action = sys.argv[1]
    if action == 'inspect': result = inspect_upload(Path(sys.argv[2]), Path(sys.argv[3]))
    elif action == 'fresh': assert_fresh(Path(sys.argv[2])); result = {'fresh':True}
    elif action == 'apply':
        data = Path(sys.argv[2])
        root = data / '.restore'
        if root.is_symlink(): raise ValueError('Invalid restore directory')
        if root.exists():
            (root / 'upload.lock').unlink(missing_ok=True)
            # Only expired upload directories owned by this feature are removed.
            for entry in root.iterdir():
                if entry.is_dir() and not entry.is_symlink() and TOKEN.fullmatch(entry.name) and not (root / 'pending.json').exists() and time.time() - entry.stat().st_mtime > 900:
                    shutil.rmtree(entry)
        secret_file = data / '.app-secret'
        secret = secret_file.read_text() if secret_file.exists() else os.environ.get('APP_SECRET', '')
        apply_pending(data, Path(sys.argv[3]), secret); result = {'checked':True}
    else: raise ValueError('Invalid command')
    print(json.dumps(result))

if __name__ == '__main__':
    try: main()
    except Exception:
        print('Dashboard restore rejected; inspect private staging and recovery state', file=sys.stderr)
        sys.exit(1)
