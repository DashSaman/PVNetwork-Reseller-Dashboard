// Precise hotfix for admin crash
const fs = require("fs");
const p = "src/components/panel/admin-view.tsx";
let s = fs.readFileSync(p, "utf8");

// 1) Imports
s = s.replace(
  'import { api, StatCard, faDate, gbLabel, faNum, PvLogo } from "./shared";',
  'import { api, StatCard, faDate, gbLabel, formatUsageGB, faNum, PvLogo } from "./shared";'
);
const m = s.match(/import \{([^}]+)\} from "lucide-react"/);
if (m && !s.includes("Loader2")) {
  s = s.replace(m[0], m[0].replace(/\}$/, ", Loader2 }"));
}

// 2) Type fix — remove old panel field and old chart fields
s = s.replace(
  "    panel: { connected: boolean; inbounds: number; clients: number; totalUp: number; totalDown: number; panelsCount: number };\n",
  ""
);
s = s.replace(
  "    trafficByInbound: { tag: string; usedGB: number }[];\n    usersPerInbound: { tag: string; users: number }[];\n",
  ""
);

// 3) Add PanelSummaryData after the OverviewData closing
const overviewEnd = s.indexOf("};", s.indexOf("type OverviewData"));
if (overviewEnd > 0) {
  const insertAt = overviewEnd + 2; // after };
  const panelType = `

type PanelSummaryData = {
  panel: {
    connected: boolean;
    panelsCount: number;
    inbounds: number;
    clients: number;
    totalUp: number;
    totalDown: number;
  };
  trafficByInbound: { panelName: string; tag: string; clients: number; upGB: number; downGB: number }[];
  panelErrors?: { panelName: string; msg: string }[];
  configured: boolean;
  state: "NOT_CONFIGURED" | "CHECKING" | "ONLINE" | "DEGRADED" | "OFFLINE";
  lastSuccessAt: number | null;
  latencyMs: number | null;
};`;
  s = s.slice(0, insertAt) + panelType + s.slice(insertAt);
}

fs.writeFileSync(p, s, "utf8");

// Verify
console.log("has old panel:", s.includes("panel: { connected"));
console.log("has PanelSummaryData:", s.includes("type PanelSummaryData"));
console.log("has formatUsageGB:", s.includes("formatUsageGB"));
console.log("has Loader2:", s.includes("Loader2"));
