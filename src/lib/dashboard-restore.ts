import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db } from "./db";
import { dataDirectory } from "../../scripts/runtime-secret.cjs";

const exec = promisify(execFile);
const LIMIT = 64 * 1024 * 1024, TTL = 15 * 60 * 1000;
const tokenPattern = /^[a-f0-9]{64}$/;
const root = () => path.join(dataDirectory(), ".restore");
const template = () => process.env.RESTORE_TEMPLATE || path.resolve("prisma-template/custom.db");
export type RestorePreview = { createdAt: string; sha256: string; counts: Record<string, number>; nativePanelsIgnored: number; encryptedFields: number; peerCount: number; privateRoute: boolean };

export async function restoreAvailability() {
  const counts = await Promise.all([db.reseller.count(), db.resellerUser.count(), db.resellerInbound.count(), db.panelConfig.count(), db.operationJournal.count(), db.setting.count()]);
  const fresh = counts.every(n => n === 0);
  const enabled = process.env.DASHBOARD_RESTORE_ENABLED === "1"
    && path.resolve(/* turbopackIgnore: true */ process.env.DASHBOARD_RESTORE_DATA_DIR || "/app/data") === path.resolve(/* turbopackIgnore: true */ dataDirectory())
    && path.basename((process.env.DATABASE_URL || "").slice(5)) === "custom.db";
  const pending = await fs.access(path.join(root(), "pending.json")).then(() => true, () => false);
  return { allowed: fresh && enabled && !pending, fresh, pending, reason: !fresh ? "بازیابی فقط روی نصب تازه و بدون نماینده، کاربر، اتصال یا تنظیمات قبلی مجاز است." : !enabled ? "بازیابی به نسخهٔ Docker دارای راه‌انداز بازیابی نیاز دارد." : pending ? "بازیابی در انتظار راه‌اندازی مجدد است." : "", maxBytes: LIMIT };
}
export async function assertRestoreAllowed() {
  const result = await restoreAvailability();
  if (!result.allowed) throw Error(result.reason);
}
async function privateRoot() {
  const directory = root();
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  if ((await fs.lstat(directory)).isSymbolicLink()) throw Error("مسیر بازیابی نامعتبر است.");
  await fs.chmod(directory, 0o700);
  return directory;
}
async function runPython(args: string[]) {
  const result = await exec(process.env.BACKUP_PYTHON || (process.platform === "win32" ? "python" : "python3"), [path.resolve("scripts/dashboard-restore.py"), ...args], { windowsHide: true, timeout: 180000, maxBuffer: 1024 * 1024 });
  return JSON.parse(result.stdout);
}
async function validate(stage: string): Promise<RestorePreview> {
  const inspected = await runPython(["inspect", stage, template()]);
  const result = await exec(process.execPath, [path.resolve("scripts/restore-crypto.cjs"), path.join(stage, "restored")], { windowsHide: true, timeout: 30000, maxBuffer: 65536 });
  return { ...inspected, ...JSON.parse(result.stdout) };
}
export async function previewRestore(request: Request, adminId: string) {
  await assertRestoreAllowed();
  const directory = await privateRoot();
  // One bounded upload at a time; startup clears a lock orphaned by a killed process.
  const lock = await fs.open(path.join(directory, "upload.lock"), "wx", 0o600);
  const id = crypto.randomBytes(32).toString("hex"), stage = path.join(directory, id);
  let ready = false;
  try {
    await assertRestoreAllowed();
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && tokenPattern.test(entry.name)) await fs.rm(path.join(directory, entry.name), { recursive: true });
    }
    await fs.mkdir(stage, { mode: 0o700 });
    const declared = request.headers.get("content-length");
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > LIMIT)) throw Error("حداکثر حجم فایل ۶۴ مگابایت است.");
    if (!request.body) throw Error("فایل بکاپ انتخاب نشده است.");
    const disk = await fs.statfs(directory);
    if (disk.bavail * disk.bsize < Math.ceil(1.2 * 1024 * 1024 * 1024)) throw Error("حداقل ۱٫۲ گیگابایت فضای آزاد برای بازیابی لازم است.");
    const file = await fs.open(path.join(stage, "archive.zip"), "wx", 0o600);
    const reader = request.body.getReader(); let size = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > LIMIT) { await reader.cancel(); throw Error("حداکثر حجم فایل ۶۴ مگابایت است."); }
        await file.writeFile(part.value);
      }
      await file.sync();
    } finally { reader.releaseLock(); await file.close(); }
    if (!size) throw Error("فایل خالی است.");
    const preview = await validate(stage);
    await assertRestoreAllowed();
    await fs.writeFile(path.join(stage, "preview.json"), JSON.stringify({ adminId, expiresAt: Date.now() + TTL, preview }), { mode: 0o600, flag: "wx" });
    ready = true;
    return { token: id, expiresAt: Date.now() + TTL, preview };
  } finally {
    if (!ready) await fs.rm(stage, { recursive: true, force: true });
    await lock.close(); await fs.unlink(path.join(directory, "upload.lock"));
  }
}
export async function queueRestore(id: string, adminId: string) {
  if (!tokenPattern.test(id)) throw Error("پیش‌نمایش معتبر نیست؛ فایل را دوباره بررسی کنید.");
  await assertRestoreAllowed();
  const directory = await privateRoot();
  const lock = await fs.open(path.join(directory, "upload.lock"), "wx", 0o600);
  try {
    await assertRestoreAllowed();
    const stage = path.join(directory, id);
    if ((await fs.lstat(stage)).isSymbolicLink()) throw Error("مسیر نامعتبر است.");
    const info = JSON.parse(await fs.readFile(path.join(stage, "preview.json"), "utf8"));
    if (info.adminId !== adminId || info.expiresAt < Date.now()) throw Error("پیش‌نمایش منقضی یا نامعتبر است.");
    const actualHash = crypto.createHash("sha256").update(await fs.readFile(path.join(stage, "archive.zip"))).digest("hex");
    if (actualHash !== info.preview.sha256) throw Error("فایل پس از بررسی تغییر کرده است.");
    await fs.rm(path.join(stage, "restored"), { recursive: true });
    await validate(stage);
    await assertRestoreAllowed();
    // Exclusive durable marker blocks new API traffic. Installation happens before Node starts.
    const pending = await fs.open(path.join(directory, "pending.json"), "wx", 0o600);
    try { await pending.writeFile(JSON.stringify({ id, sha256: actualHash, phase: "queued" })); await pending.sync(); }
    finally { await pending.close(); }
    if (process.platform !== "win32") {
      const parent = await fs.open(directory, "r");
      try { await parent.sync(); } finally { await parent.close(); }
    }
  } finally { await lock.close(); await fs.unlink(path.join(directory, "upload.lock")); }
}
