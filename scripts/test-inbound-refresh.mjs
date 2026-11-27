import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "src/components/panel/admin-view.tsx");
const src = fs.readFileSync(file, "utf8");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

if (!src.includes('if (t.id === "resellers")')) fail("resellers tab does not trigger a refresh condition");
if (!src.includes('void loadInbounds();')) fail("resellers tab does not call loadInbounds");
if (!/onClick=\{\(\) => \{[\s\S]*setTab\(t\.id\);[\s\S]*t\.id === "resellers"[\s\S]*loadInbounds\(\)/m.test(src)) {
  fail("refresh is not wired into the tab click handler");
}
console.log("PASS: resellers tab refreshes inbounds before use");
