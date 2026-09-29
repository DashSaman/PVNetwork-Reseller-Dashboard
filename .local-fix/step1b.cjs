// Step 1b: fix remaining issues
const fs = require("fs");
const p = "src/components/panel/admin-view.tsx";
let lines = fs.readFileSync(p, "utf8").split("\n");

// Remove line 49 (panel field in OverviewData stats) — find it precisely
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("panel: { connected: boolean; inbounds: number; clients: number; totalUp: number; totalDown: number; panelsCount: number };")) {
    lines.splice(i, 1);
    console.log("removed panel field at line", i + 1);
    break;
  }
}

// Remove trafficByInbound and usersPerInbound from OverviewData charts
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("trafficByInbound: { tag: string; usedGB: number }[];")) {
    lines.splice(i, 1);
    if (lines[i] && lines[i].includes("usersPerInbound: { tag: string; users: number }[];")) {
      lines.splice(i, 1);
    }
    console.log("removed chart fields");
    break;
  }
}

let s = lines.join("\n");

// Add Loader2 import — simple separate line after the last import
if (!s.includes("Loader2")) {
  s = s.replace(
    '} from "lucide-react";',
    '  Loader2,\n} from "lucide-react";'
  );
}

fs.writeFileSync(p, s, "utf8");
console.log("has old panel:", s.includes("panel: { connected: boolean; inbounds"));
console.log("has trafficByInbound in type:", /trafficByInbound: \{ tag: string/.test(s));
console.log("has usersPerInbound in type:", /usersPerInbound: \{ tag: string/.test(s));
console.log("has Loader2:", s.includes("Loader2"));
