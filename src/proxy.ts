import { existsSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { dataDirectory } from "../scripts/runtime-secret.cjs";

export function proxy() {
  if (existsSync(path.join(dataDirectory(), ".restore/pending.json"))) {
    return NextResponse.json({ error: "داشبورد در حال بازیابی است؛ پس از راه‌اندازی مجدد دوباره وارد شوید." }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "5" } });
  }
  return NextResponse.next();
}
// The restore route checks the same pending marker itself. Excluding its streaming
// upload avoids Next proxy's 10 MiB request-body clone/buffer limit.
export const config = { matcher: "/api/((?!admin/backups/restore).*)" };
