#!/usr/bin/env python3
"""Fix escaped Persian sale-error reports in Mirza 0.8.1 without business writes."""
import argparse
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile

ANCHOR = b"$dataoutput['msg'] = json_encode($dataoutput['msg'] ?? $dataoutput ?? 'unknown error');\n            addBalance($Balance_id['id'], $orderPrice);"
REPLACEMENT = b"$dataoutput['msg'] = json_encode($dataoutput['msg'] ?? $dataoutput ?? 'unknown error', function_exists('pvnetwork_is_sales_bridge') && pvnetwork_is_sales_bridge($marzban_list_get) ? JSON_UNESCAPED_UNICODE : 0);\n            addBalance($Balance_id['id'], $orderPrice);"


def candidate(source: bytes) -> bytes:
    if source.count(ANCHOR) != 1:
        raise ValueError('Sale-error report boundary changed; inspect before installation')
    return source.replace(ANCHOR, REPLACEMENT, 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--expected-sha256', required=True)
    parser.add_argument('--backup-dir', required=True, type=Path)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    root, backup = args.root.resolve(strict=True), args.backup_dir.resolve()
    target = root / 'function.php'
    if backup == root or root in backup.parents or target.is_symlink():
        raise ValueError('Unexpected target or public backup location')
    original = target.read_bytes()
    if hashlib.sha256(original).hexdigest() != args.expected_sha256:
        raise ValueError('Mirza function.php changed since inspection')
    patched = candidate(original)
    with tempfile.TemporaryDirectory(prefix='pvnet-report-check-') as temp:
        check = Path(temp) / 'function.php'
        check.write_bytes(patched)
        subprocess.run(['php', '-l', str(check)], check=True, capture_output=True)
    if args.check:
        print('Report formatting validated; installation unchanged')
        return
    backup.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (backup / 'function.php.before').open('xb') as saved:
        os.fchmod(saved.fileno(), 0o600)
        saved.write(original)
    info = target.stat()
    temporary = target.with_name('function.php.pvnet-report-new')
    with temporary.open('xb') as output:
        output.write(patched)
        os.fchmod(output.fileno(), info.st_mode & 0o777)
        os.fchown(output.fileno(), info.st_uid, info.st_gid)
    if target.read_bytes() != original:
        raise ValueError('Mirza changed during installation')
    os.replace(temporary, target)
    print('Sale-error formatting installed; wallet/order logic and services unchanged')


if __name__ == '__main__':
    main()
