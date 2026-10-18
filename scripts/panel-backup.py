#!/usr/bin/env python3
"""Portable, private dashboard/native-panel backups. Restore only into an empty directory."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import tempfile
import time
import uuid
import zipfile

FORMAT = 'pvnet-backup-v1'
NAME = re.compile(r'^pvnet-\d{8}T\d{6}Z-[a-f0-9]{12}\.zip$')
PANEL_ID = re.compile(r'^[A-Za-z0-9_-]{1,100}$')
MAX_BYTES = 512 * 1024 * 1024

def private_dir(path):
    path = Path(path)
    if path.is_symlink(): raise ValueError('Backup directory cannot be a symlink')
    path.mkdir(parents=True, exist_ok=True)
    path.chmod(0o700)
    return path.resolve()

def integrity(path):
    conn = sqlite3.connect('file:' + Path(path).resolve().as_posix() + '?mode=ro', uri=True)
    try:
        if conn.execute('PRAGMA integrity_check').fetchone()[0] != 'ok': raise ValueError('Database integrity check failed')
    finally: conn.close()

def file_hash(path):
    h = hashlib.sha256()
    with open(path, 'rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''): h.update(block)
    return h.hexdigest()

def read_manifest(archive):
    with zipfile.ZipFile(archive) as z:
        info = z.getinfo('manifest.json')
        if info.file_size > 1024 * 1024: raise ValueError('Manifest too large')
        meta = json.loads(z.read(info))
        if meta.get('format') != FORMAT: raise ValueError('Unsupported backup format')
        return meta

def verify_archive(archive):
    with zipfile.ZipFile(archive) as z:
        names = z.namelist()
        if len(names) != len(set(names)) or len(names) > 1000: raise ValueError('Duplicate or excessive archive entries')
        if sum(i.file_size for i in z.infolist()) > MAX_BYTES: raise ValueError('Backup exceeds size limit')
        meta = read_manifest(archive)
        files = meta.get('files', [])
        allowed = {'manifest.json', 'dashboard.db', 'recovery.json'}
        for panel in meta.get('panels', []):
            pid = panel.get('id', '')
            ext = 'db' if panel.get('format') == 'sqlite' else 'dump'
            if not PANEL_ID.fullmatch(pid) or panel.get('file') != f'panels/{pid}.{ext}': raise ValueError('Invalid panel entry')
            allowed.add(panel['file'])
        if set(names) != allowed or {f['name'] for f in files} != allowed - {'manifest.json'}: raise ValueError('Unexpected archive path or missing file')
        for f in files:
            info = z.getinfo(f['name'])
            if stat.S_ISLNK(info.external_attr >> 16): raise ValueError('Archive symlinks are forbidden')
            if info.file_size != f['size']: raise ValueError('File size mismatch')
            h = hashlib.sha256()
            with z.open(info) as source:
                for block in iter(lambda: source.read(1024 * 1024), b''): h.update(block)
            if h.hexdigest() != f['sha256']: raise ValueError('Backup checksum mismatch')
        recovery = json.loads(z.read('recovery.json'))
        secret = recovery.get('APP_SECRET')
        if not isinstance(secret, str) or not secret or '\n' in secret or '\r' in secret: raise ValueError('Invalid recovery key')
        return meta

def create_archive(database, directory, secret, panels, *, panel_errors=None, kind='manual', now=None):
    if not secret or '\n' in secret or '\r' in secret: raise ValueError('A recovery key is required')
    if kind not in ('manual', 'daily'): raise ValueError('Invalid backup kind')
    source = Path(database).resolve(strict=True)
    if not source.is_file(): raise ValueError('Database not found')
    out = private_dir(directory)
    now = time.time() if now is None else now
    stamp = datetime.fromtimestamp(now, timezone.utc)
    filename = f'pvnet-{stamp:%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex[:12]}.zip'
    errors = list(panel_errors or [])
    total = source.stat().st_size + sum(Path(p['path']).stat().st_size for p in panels)
    if total > MAX_BYTES or shutil.disk_usage(out).free < total * 2 + 32 * 1024 * 1024: raise ValueError('Insufficient backup disk space or backup too large')
    with tempfile.TemporaryDirectory(prefix='.building-', dir=out) as tmp:
        tmp = Path(tmp)
        snapshot = tmp / 'dashboard.db'
        src = sqlite3.connect('file:' + source.as_posix() + '?mode=ro', uri=True)
        dst = sqlite3.connect(snapshot)
        try: src.backup(dst)
        finally: dst.close(); src.close()
        integrity(snapshot)
        snapshot.chmod(0o600)
        recovery = tmp / 'recovery.json'
        recovery.write_text(json.dumps({'APP_SECRET': secret}), encoding='utf-8'); recovery.chmod(0o600)
        payload = [('dashboard.db', snapshot), ('recovery.json', recovery)]
        records = []
        for p in panels:
            pid = p['id']
            if not PANEL_ID.fullmatch(pid): raise ValueError('Invalid panel ID')
            native = Path(p['path']).resolve(strict=True)
            header = native.read_bytes()[:16] if native.stat().st_size < 16 else open_header(native)
            if p['format'] == 'sqlite' and header == b'SQLite format 3\x00': integrity(native); ext = 'db'
            elif p['format'] == 'postgres' and header.startswith(b'PGDMP'): ext = 'dump'
            else: raise ValueError('Invalid native panel database export')
            name = f'panels/{pid}.{ext}'
            payload.append((name, native)); records.append({'id': pid, 'name': p['name'], 'format': p['format'], 'file': name})
        meta = {'format': FORMAT, 'createdAt': stamp.isoformat(), 'kind': kind, 'complete': not errors, 'panels': records, 'errors': errors,
                'files': [{'name': name, 'size': p.stat().st_size, 'sha256': file_hash(p)} for name, p in payload]}
        staged = tmp / 'archive.zip'
        with zipfile.ZipFile(staged, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            for name, p in payload: z.write(p, name)
            z.writestr('manifest.json', json.dumps(meta, ensure_ascii=False))
        staged.chmod(0o600)
        verify_archive(staged)
        destination = out / filename
        os.replace(staged, destination)
        os.utime(destination, (now, now))
    return {**summary(destination, meta), 'removed': prune_archives(out, now=now)}

def open_header(path):
    with open(path, 'rb') as source: return source.read(16)

def summary(path, meta):
    return {'name': Path(path).name, 'createdAt': meta['createdAt'], 'kind': meta['kind'], 'size': Path(path).stat().st_size,
            'complete': bool(meta['complete']), 'panelCount': len(meta['panels']), 'errors': meta.get('errors', [])}

def list_archives(directory):
    root = Path(directory)
    if not root.exists(): return []
    if root.is_symlink(): raise ValueError('Backup directory cannot be a symlink')
    files = []
    for p in root.iterdir():
        if not NAME.fullmatch(p.name) or p.is_symlink() or not p.is_file(): continue
        try: files.append(summary(p, read_manifest(p)))
        except (ValueError, KeyError, zipfile.BadZipFile, OSError): continue
    return sorted(files, key=lambda f: f['createdAt'], reverse=True)

def prune_archives(directory, *, now=None):
    now = time.time() if now is None else now
    root = Path(directory)
    if root.is_symlink(): raise ValueError('Backup directory cannot be a symlink')
    removed = []
    for entry in list_archives(root):
        p = root / entry['name']
        if p.is_symlink() or not p.is_file(): continue
        if now - p.stat().st_mtime > 5 * 86400:
            p.unlink(); removed.append(p.name)
    return sorted(removed)

def restore_archive(archive, destination):
    meta = verify_archive(archive)
    target = Path(destination)
    if target.is_symlink() or (target.exists() and any(target.iterdir())): raise ValueError('Restore requires a new or empty directory')
    parent = target.parent.resolve(); parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.pvnet-restore-', dir=parent) as tmp:
        tmp = Path(tmp); private_dir(tmp / 'data'); private_dir(tmp / 'panels')
        with zipfile.ZipFile(archive) as z:
            for f in meta['files']:
                name = f['name']
                if name == 'recovery.json':
                    secret = json.loads(z.read(name))['APP_SECRET']
                    dest = tmp / 'recovery.env'; dest.write_text(f'APP_SECRET={secret}\n', encoding='utf-8')
                else:
                    dest = tmp / ('data/custom.db' if name == 'dashboard.db' else name)
                    with z.open(name) as src, open(dest, 'wb') as dst: shutil.copyfileobj(src, dst)
                dest.chmod(0o600)
            (tmp / 'manifest.json').write_text(json.dumps(meta, ensure_ascii=False), encoding='utf-8')
            (tmp / 'manifest.json').chmod(0o600)
        integrity(tmp / 'data/custom.db')
        for p in meta['panels']:
            if p['format'] == 'sqlite': integrity(tmp / p['file'])
        # Recheck after verification so an existing deployment cannot be replaced.
        if target.exists() and any(target.iterdir()): raise ValueError('Destination changed during restore')
        private_dir(target)
        for item in tmp.iterdir(): shutil.move(str(item), str(target / item.name))
    return meta

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    create = sub.add_parser('create'); create.add_argument('--database', required=True); create.add_argument('--directory', required=True); create.add_argument('--input', required=True); create.add_argument('--kind', default='manual')
    listing = sub.add_parser('list'); listing.add_argument('--directory', required=True)
    verify = sub.add_parser('verify'); verify.add_argument('archive')
    restore = sub.add_parser('restore'); restore.add_argument('archive'); restore.add_argument('destination')
    args = parser.parse_args()
    if args.command == 'create':
        inputs = json.loads(Path(args.input).read_text(encoding='utf-8'))
        key_file = Path(args.database).resolve().parent / '.app-secret'
        if key_file.is_symlink(): raise ValueError('Invalid recovery key file')
        secret = key_file.read_text(encoding='utf-8') if key_file.exists() else os.environ.get('APP_SECRET', '')
        result = create_archive(args.database, args.directory, secret, inputs['panels'], panel_errors=inputs.get('errors'), kind=args.kind)
    elif args.command == 'list': result = {'files': list_archives(args.directory)}
    elif args.command == 'verify':
        meta = verify_archive(args.archive); result = {'valid': True, 'complete': meta['complete'], 'panelCount': len(meta['panels'])}
    else:
        meta = restore_archive(args.archive, args.destination); result = {'restored': True, 'complete': meta['complete'], 'panelCount': len(meta['panels'])}
    print(json.dumps(result, ensure_ascii=True))

if __name__ == '__main__': main()
