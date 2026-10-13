import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logActivity } from "@/lib/logger";

const exec = promisify(execFile);
export type BackupEntry = { name: string; createdAt: string; kind: "daily" | "manual"; size: number; complete: boolean; panelCount: number; errors: { id: string; name: string; error: string }[] };
const filename = /^pvnet-\d{8}T\d{6}Z-[a-f0-9]{12}\.zip$/;
const slots = globalThis as { __pvnetBackupRunning?: boolean };
function locations() {
  const url = process.env.DATABASE_URL || "file:./custom.db";
  if (!url.startsWith("file:")) throw new Error("بکاپ فقط برای دیتابیس SQLite پشتیبانی می‌شود");
  const file = url.slice(5);
  const database = path.isAbsolute(file) ? file : path.resolve(process.cwd(), "prisma", file);
  return { database, directory: path.join(path.dirname(database), "backups"), script: path.resolve(process.cwd(), "scripts/panel-backup.py") };
}
async function python(args: string[]) {
  const executable = process.env.BACKUP_PYTHON || (process.platform === "win32" ? "python" : "python3");
  const command = process.platform === "win32" ? executable : "/usr/bin/nice";
  const parameters = process.platform === "win32" ? [locations().script, ...args] : ["-n", "10", executable, locations().script, ...args];
  const r = await exec(command, parameters, {
    timeout: 240000, maxBuffer: 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: "utf-8", APP_SECRET: process.env.APP_SECRET || "reseller-panel-local-secret-key-2024" }, windowsHide: true,
  });
  return JSON.parse(r.stdout);
}
async function safeDirectory() {
  const { directory } = locations();
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error("مسیر بکاپ نامعتبر است");
  await fs.chmod(directory, 0o700);
  return directory;
}
export async function listBackups(): Promise<BackupEntry[]> {
  const directory = await safeDirectory();
  const result = await python(["list", "--directory", directory]);
  return result.files;
}
export async function backupSchedule() {
  const directory = await safeDirectory();
  try { const schedule = JSON.parse(await fs.readFile(path.join(directory, "schedule.json"), "utf8")); return schedule.enabled === true; }
  catch { return false; }
}
export async function backupFile(name: string) {
  if (!filename.test(name)) throw new Error("نام بکاپ نامعتبر است");
  const directory = await safeDirectory();
  const file = path.join(directory, name);
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("بکاپ پیدا نشد");
  if (stat.size > 512 * 1024 * 1024) throw new Error("فایل از حد مجاز بزرگ‌تر است");
  return fs.readFile(file);
}
export async function createBackup(actorName: string, kind: "manual" | "daily" = "manual"): Promise<BackupEntry> {
  if (slots.__pvnetBackupRunning) throw new Error("بکاپ دیگری در حال آماده‌سازی است");
  slots.__pvnetBackupRunning = true;
  let temporary = "";
  let directory = "";
  try {
    const { database } = locations();
    directory = await safeDirectory();
    temporary = await fs.mkdtemp(path.join(directory, ".export-")); await fs.chmod(temporary, 0o700);
    const input = path.join(temporary, "input.json");
    // The complete dashboard snapshot includes stored PanelConfig credentials.
    // It never contacts or modifies the independent connected VPN panels.
    await fs.writeFile(input, JSON.stringify({ panels: [], errors: [] }), { mode: 0o600 });
    const result = await python(["create", "--database", database, "--directory", directory, "--input", input, "--kind", kind]);
    await logActivity({ actorType: "ADMIN", actorName, action: result.complete ? "تهیه بکاپ کامل" : "تهیه بکاپ ناقص", detail: `${kind} | ${result.name} | ${result.panelCount} پنل | پاک‌سازی ${result.removed.length} بکاپ قدیمی` });
    return result;
  } finally {
    slots.__pvnetBackupRunning = false;
    if (temporary && path.dirname(temporary) === directory && path.basename(temporary).startsWith(".export-")) await fs.rm(temporary, { recursive: true, force: true });
  }
}
