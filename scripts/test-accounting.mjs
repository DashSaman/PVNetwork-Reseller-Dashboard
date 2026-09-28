#!/usr/bin/env node
// مجموعه تست فاز ۱ با مجموعه جامع فاز ۱.۱ ادغام شد — این فایل فقط هدایت‌کننده است.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
await import(pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "test-phase11.mjs")).href);
