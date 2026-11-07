#!/usr/bin/env python3
"""Install the bounded Mirza 0.8.1 connector change; no services or DB writes."""
import argparse
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile

SOURCE_SHA = 'e750cd42bfc30cd9f8b989c664042f3d5cee72af1bd766d0fa28a7d614f9f587'
ANCHOR = 'function addClient($panel, $usernameac, $Expire, $subId, $Total, $inboundid, $name_product, $note = "")\n{\n'
INJECTION = '''    if (pvnetwork_is_sales_bridge($panel)) {
        $liveSelection = pvnetwork_current_selection($panel, $inboundid);
        if (!$liveSelection['ok']) return $liveSelection['response'];
        $inboundid = json_encode($liveSelection['ids']);
    }
'''

def candidate(source: bytes) -> bytes:
    if hashlib.sha256(source).hexdigest() != SOURCE_SHA:
        raise ValueError('Unsupported or changed Mirza driver; inspect it before installing')
    text = source.decode('utf8')
    if text.count(ANCHOR) != 1 or text.count("ini_set('error_log', 'error_log');") != 1:
        raise ValueError('Mirza source anchors changed')
    return text.replace("ini_set('error_log', 'error_log');", "ini_set('error_log', 'error_log');\nrequire_once __DIR__ . '/pvnetwork-selection.php';", 1).replace(ANCHOR, ANCHOR + INJECTION, 1).encode()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True, type=Path, help='Existing Mirza root, e.g. /var/www/mirzabot')
    parser.add_argument('--backup-dir', required=True, type=Path, help='Private directory outside the web root')
    parser.add_argument('--check', action='store_true', help='Validate candidates without changing installation')
    args = parser.parse_args()
    root, backup = args.root.resolve(strict=True), args.backup_dir.resolve()
    if backup == root or root in backup.parents:
        raise ValueError('Backup must be outside the public web root')
    driver = root / 'panels/Api/x-ui_single.php'
    helper = root / 'panels/Api/pvnetwork-selection.php'
    if driver.is_symlink() or helper.is_symlink() or driver.resolve().parent != (root / 'panels/Api').resolve():
        raise ValueError('Unexpected connector paths')
    original = driver.read_bytes()
    patched = candidate(original)
    helper_bytes = Path(__file__).with_name('pvnetwork-selection.php').read_bytes()
    with tempfile.TemporaryDirectory(prefix='pvnetwork-mirza-check-') as temp:
        for name, value in [('x-ui_single.php', patched), ('pvnetwork-selection.php', helper_bytes)]:
            test_file = Path(temp) / name
            test_file.write_bytes(value)
            subprocess.run(['php', '-l', str(test_file)], check=True, capture_output=True)
    if args.check:
        print('Mirza connector candidate validated; installation unchanged')
        return
    backup.mkdir(mode=0o700, parents=True, exist_ok=True)
    saved = backup / 'x-ui_single.php.before'
    with saved.open('xb') as file:
        os.fchmod(file.fileno(), 0o600)
        file.write(original)
    if helper.exists():
        raise ValueError('Connector helper already exists; refusing overwrite')
    info = driver.stat()
    for target, value in [(helper, helper_bytes), (driver, patched)]:
        temporary = target.with_name(target.name + '.pvnetwork-new')
        with temporary.open('xb') as file:
            file.write(value)
            os.fchmod(file.fileno(), info.st_mode & 0o777)
            os.fchown(file.fileno(), info.st_uid, info.st_gid)
        if driver.read_bytes() != original:
            raise ValueError('Driver changed during installation')
        os.replace(temporary, target)
    print('Mirza connector installed; services and database unchanged')

if __name__ == '__main__':
    main()
