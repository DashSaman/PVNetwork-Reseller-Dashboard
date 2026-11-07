import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { dataDirectory } from '../../scripts/runtime-secret.cjs';

/** Execution consent is local to this installation, deliberately outside the
 * portable DB archive. Restoring a backup must not replay old destructive jobs
 * against the original infrastructure. Owners may explicitly continue them. */
export function operationInstallation(create = false): string | null {
  const file = path.join(dataDirectory(), '.operation-installation');
  if (!fs.existsSync(file)) {
    if (!create) return null;
    try { fs.writeFileSync(file, randomBytes(24).toString('hex'), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  }
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Invalid operation installation file');
  const value = fs.readFileSync(file, 'utf8');
  if (!/^[a-f0-9]{48}$/.test(value)) throw new Error('Invalid operation installation marker');
  return value;
}
