const fs = require('node:fs');
const path = require('node:path');
function dataDirectory() {
  const url = process.env.DATABASE_URL || 'file:./custom.db';
  if (!url.startsWith('file:')) throw Error('SQLite required');
  const file = url.slice(5);
  return path.dirname(path.isAbsolute(file) ? file : path.resolve(process.cwd(), 'prisma', file));
}
function runtimeSecret() {
  const file = path.join(dataDirectory(), '.app-secret');
  if (!fs.existsSync(file)) return process.env.APP_SECRET || 'reseller-panel-local-secret-key-2024';
  if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw Error('Invalid recovery key file');
  const secret = fs.readFileSync(file, 'utf8');
  if (!secret || secret.length > 4096 || /[\r\n\0]/.test(secret)) throw Error('Invalid recovery key');
  return secret;
}
module.exports = { runtimeSecret, dataDirectory };
