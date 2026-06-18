// One-off: repoint the icon registry to Mage (preferred) / Heroicons-outline (fallback),
// keeping Material Symbols where neither set has a sensible equivalent.
// Run: node scripts/remap-icons.mjs
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const mage = require("@iconify-json/mage/icons.json");
const hero = require("@iconify-json/heroicons/icons.json");
const mageHas = (n) => n in mage.icons;
const heroHas = (n) =>
  n in hero.icons && !/-(solid|16-solid|20-solid|mini)$/.test(n);

// key -> "mage:name" | "heroicons:name". Anything not listed keeps its current
// Material Symbols icon (the "skip where no equivalent" rule).
const MAP = {
  // arrows / chevrons / carets
  "arrow-back": "mage:arrow-left", "arrow-back-ios": "mage:chevron-left",
  "arrow-back-ios-new": "mage:chevron-left", "arrow-forward": "mage:arrow-right",
  "arrow-forward-ios": "mage:chevron-right", "arrow-upward": "mage:arrow-up",
  "arrow-downward": "mage:arrow-down", "arrow-right": "mage:arrow-right",
  "arrow-right-alt": "mage:arrow-right", "arrow-drop-down": "mage:caret-down",
  "arrow-drop-up": "mage:caret-up", "expand-more": "mage:chevron-down",
  "expand-less": "mage:chevron-up", "chevron-left": "mage:chevron-left",
  "chevron-right": "mage:chevron-right", "navigate-before": "mage:chevron-left",
  "navigate-next": "mage:chevron-right", "keyboard-arrow-down": "mage:chevron-down",
  "keyboard-arrow-up": "mage:chevron-up", "keyboard-arrow-right": "mage:chevron-right",
  "keyboard-double-arrow-left": "mage:double-arrow-left",
  "keyboard-double-arrow-right": "mage:double-arrow-right",
  "first-page": "mage:double-arrow-left", "last-page": "mage:double-arrow-right",
  "call-made": "mage:arrow-up-right", "call-received": "mage:arrow-down-left",
  "undo": "heroicons:arrow-uturn-left", "redo": "heroicons:arrow-uturn-right",
  "unfold-more": "heroicons:arrows-up-down", "unfold-less": "mage:minimize",
  "trending-up": "heroicons:arrow-trending-up", "trending-up-filled": "heroicons:arrow-trending-up",
  "trending-down": "heroicons:arrow-trending-down", "auto-graph": "mage:chart-up",
  "show-chart": "mage:chart-up", "reorder": "heroicons:bars-3",

  // core actions
  "add": "mage:plus", "add-circle": "mage:plus-circle", "add-circle-outline": "mage:plus-circle",
  "remove": "mage:minus", "close": "mage:x", "clear": "mage:x", "cancel": "mage:cancel",
  "check": "mage:check", "check-circle": "mage:check-circle",
  "check-circle-outline": "mage:check-circle", "check-box": "mage:check-square",
  "task-alt": "mage:check-circle", "content-copy": "mage:copy", "delete": "mage:trash",
  "delete-outline": "mage:trash", "delete-sweep": "mage:trash-2", "edit": "heroicons:pencil",
  "download": "mage:download", "file-download": "mage:file-download", "upload": "mage:upload",
  "upload-file": "mage:file-upload", "file-upload": "mage:file-upload", "note-add": "mage:file-plus",
  "save": "mage:save-floppy", "refresh": "mage:refresh", "cached": "mage:refresh",
  "sync": "mage:refresh", "autorenew": "mage:refresh", "restart-alt": "mage:refresh",
  "update": "mage:refresh", "search": "mage:search", "manage-search": "mage:search",
  "saved-search": "mage:search", "filter": "mage:filter", "filter-alt": "mage:filter",
  "filter-list": "mage:filter", "share": "mage:share", "send": "heroicons:paper-airplane",
  "print": "mage:printer", "preview": "mage:preview", "open-in-new": "mage:external-link",
  "open-in-full": "mage:maximize", "fullscreen": "mage:maximize", "fullscreen-exit": "mage:minimize",
  "close-fullscreen": "mage:minimize", "compress": "mage:minimize",

  // media controls
  "play-arrow": "mage:play", "play-circle": "mage:play-circle",
  "play-circle-filled": "mage:play-circle", "pause": "mage:pause",
  "pause-circle-filled": "heroicons:pause-circle", "stop": "mage:stop", "stop-circle": "mage:stop-circle",
  "fast-forward": "mage:fast-forward", "fast-rewind": "mage:fast-forward-back",
  "volume-up": "mage:volume-up", "volume-off": "mage:volume-mute",

  // status / feedback
  "info": "mage:information-circle", "info-filled": "mage:information-circle",
  "info-outline": "mage:information-circle", "error": "mage:exclamation-circle",
  "error-outline": "mage:exclamation-circle", "warning": "mage:exclamation-triangle",
  "warning-amber": "mage:exclamation-triangle", "report-problem": "mage:exclamation-triangle",
  "help": "mage:question-mark-circle", "help-outline": "mage:question-mark-circle",
  "block": "heroicons:no-symbol", "verified": "mage:verified-check",
  "verified-user": "mage:shield-check", "shield-alert-outline": "heroicons:shield-exclamation",
  "sentiment-very-dissatisfied": "heroicons:face-frown",
  "thumb-up-off-alt": "heroicons:hand-thumb-up", "thumb-down-off-alt": "heroicons:hand-thumb-down",

  // people
  "person": "mage:user", "person-add": "mage:user-plus", "group": "mage:users",
  "groups": "mage:users", "group-add": "mage:user-plus", "group-work": "mage:users",
  "how-to-reg": "mage:user-check", "manage-accounts": "mage:user-check",
  "location-on": "mage:location-pin", "person-pin-circle": "mage:location-pin",

  // objects / things
  "alarm": "mage:alarm-clock", "schedule": "mage:clock", "access-time": "mage:clock",
  "timer": "mage:clock", "calendar-month": "mage:calendar", "event": "mage:calendar",
  "event-note": "mage:calendar", "bookmark": "mage:bookmark", "flag": "mage:flag",
  "tag": "mage:tag", "label": "mage:tag", "key": "mage:key", "lock": "mage:lock",
  "login": "mage:login", "logout": "mage:logout", "exit-to-app": "mage:logout",
  "notifications": "mage:notification-bell", "notifications-active": "mage:notification-bell",
  "mail": "mage:email", "inbox": "mage:inbox", "chat": "mage:message",
  "forum": "mage:message-conversation", "star": "mage:star", "star-rate": "mage:star",
  "stars": "mage:stars-a", "favorite": "mage:heart", "favorite-border": "mage:heart",
  "link": "mage:link", "attachment": "mage:attachment", "attach-file": "mage:attachment",
  "gift": "mage:gift", "redeem": "mage:gift", "card-giftcard": "mage:gift",
  "lightbulb": "mage:light-bulb", "lightbulb-outline": "mage:light-bulb",
  "build": "mage:wrench", "settings": "mage:settings", "tune": "heroicons:adjustments-horizontal",
  "dark-mode": "mage:moon", "light-mode": "mage:sun", "wifi": "mage:wifi",
  "bolt": "mage:bolt", "rocket-launch": "mage:rocket", "flame": "mage:fire-a",
  "whatshot": "mage:fire-a", "memory": "mage:chip", "mouse": "mage:mouse",
  "ads-click": "mage:mouse-pointer", "campaign": "mage:megaphone-a", "menu-book": "mage:book",
  "palette": "mage:color-swatch", "color-lens": "mage:color-swatch", "colorize": "mage:color-picker",
  "hour-glass": "mage:hour-glass", "layers": "mage:stack", "box": "mage:box",
  "inventory-2": "mage:box", "ribbon": "mage:ribbon", "workspace-premium": "mage:ribbon",
  "id-card": "mage:id-card", "card-membership": "mage:id-card", "laptop": "mage:laptop",
  "devices": "mage:laptop", "monitor-heart": "mage:heart-health",

  // money
  "attach-money": "mage:dollar", "monetization-on": "mage:dollar", "paid": "mage:dollar",
  "payments": "mage:credit-card", "credit-card": "mage:credit-card",

  // data / dev / charts
  "code": "heroicons:code-bracket", "data-object": "heroicons:code-bracket",
  "data-array": "heroicons:code-bracket", "database": "mage:database", "dns": "mage:server",
  "storage": "heroicons:circle-stack", "dataset": "heroicons:table-cells",
  "table-chart": "heroicons:table-cells", "table-view": "heroicons:table-cells",
  "grid-on": "heroicons:table-cells", "view-column": "heroicons:view-columns",
  "bar-chart": "mage:chart-vertical", "analytics": "mage:chart-vertical",
  "assessment": "mage:chart-vertical", "query-stats": "mage:chart", "insights": "mage:chart-up",
  "list": "heroicons:list-bullet", "format-list-bulleted": "heroicons:list-bullet",
  "format-list-numbered": "heroicons:numbered-list", "view-in-ar": "heroicons:cube",
  "widgets": "heroicons:squares-2x2", "category": "mage:layout-grid",
  "workspaces": "mage:layout-grid", "dashboard": "mage:dashboard",
  "dashboard-customize": "mage:dashboard-plus", "exchange": "mage:exchange-a",
  "compare": "mage:exchange-a", "compare-arrows": "mage:exchange-a",
  "swap-horiz": "mage:exchange-a", "swap-vert": "mage:exchange-b",

  // documents
  "article": "heroicons:document-text", "description": "heroicons:document-text",
  "draft": "heroicons:document", "assignment": "mage:clipboard",
  "assignment-turned-in": "mage:checklist-note", "fact-check": "mage:checklist",
  "rule": "mage:checklist", "plagiarism": "heroicons:document-magnifying-glass",

  // cloud / web / org
  "cloud": "heroicons:cloud", "cloud-upload": "heroicons:cloud-arrow-up",
  "cloud-download": "heroicons:cloud-arrow-down", "backup": "heroicons:cloud-arrow-up",
  "language": "mage:globe", "web": "heroicons:globe-alt", "window": "heroicons:window",
  "network-check": "heroicons:signal", "account-balance": "heroicons:building-library",
  "business": "heroicons:building-office", "domain": "heroicons:building-office",
  "organization": "heroicons:building-office", "corporate-fare": "heroicons:building-office-2",
  "auto-awesome": "heroicons:sparkles", "security": "mage:security-shield",
  "shield": "mage:security-shield", "smart-toy": "mage:robot", "image": "mage:image",
  "menu": "heroicons:bars-3", "folder": "mage:folder", "folder-open": "mage:folder-open",
  "folder-outline": "mage:folder", "drive-file-move": "mage:folder-open",

  // Nav-icon consistency fixes (screenshot "Data" group + main rail)
  "home": "heroicons:home", "function": "heroicons:variable", "lan": "heroicons:share",
  "data-plus-line": "heroicons:server-stack",
};

// Brand-new keys to append (not present in the current registry).
const ADD = {
  // Dedicated traces nav icon — a span/waterfall-style list. Kept separate from
  // `account-tree` (used as a generic tree in ~15 other files).
  "traces": "heroicons:queue-list",
};

const file = "src/lib/core/Icon/OIcon.icons.ts";
const src = fs.readFileSync(file, "utf8");

const header = `// ─────────────────────────────────────────────────────────────────────────────
// APPROVED ICON REGISTRY
//
// All icons used in the application must be listed here.
// Icons are resolved at build time by unplugin-icons — zero runtime fetches.
// This keeps the application fully functional in air-gapped environments.
//
// Sourced from Mage (preferred) and Heroicons-outline, falling back to Material
// Symbols where neither set has a sensible equivalent. IconName is a closed literal
// union derived from this registry — unknown names are TypeScript compile errors.
// ─────────────────────────────────────────────────────────────────────────────

`;

// parse imports: ident -> {collection, name}
const identMap = {};
for (const m of src.matchAll(/^import\s+(\w+)\s+from\s+"~icons\/([^/]+)\/([^"]+)";/gm)) {
  identMap[m[1]] = { collection: m[2], name: m[3] };
}

// parse registry entries (key -> ident), in order, ignoring commented lines
const body = src.slice(src.indexOf("iconRegistry = {"));
const keys = [];
const keyToCurrent = {};
for (const line of body.split("\n")) {
  const m = line.match(/^\s*"([^"]+)":\s*(\w+),/);
  if (!m) continue;
  const [, key, ident] = m;
  if (key in keyToCurrent) continue; // keep first occurrence
  keys.push(key);
  keyToCurrent[key] = identMap[ident];
}

// resolve final target per key
const prefix = { "material-symbols": "Ms", mage: "Mg", heroicons: "He", mdi: "Mdi", octicon: "Oct", majesticons: "Maj", si: "Si", solar: "So" };
const pascal = (s) => s.split(/[^a-z0-9]+/i).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
const varFor = ({ collection, name }) => (prefix[collection] || "Ic") + pascal(name);

const final = {};
const stats = { mage: 0, heroicons: 0, skipped: 0, missing: [] };
for (const key of keys) {
  const mapped = MAP[key];
  if (mapped) {
    const [col, name] = mapped.split(":");
    const ok = col === "mage" ? mageHas(name) : heroHas(name);
    if (!ok) { stats.missing.push(`${key} -> ${mapped}`); final[key] = keyToCurrent[key]; continue; }
    final[key] = { collection: col, name };
    stats[col]++;
  } else {
    final[key] = keyToCurrent[key];
    if (keyToCurrent[key]?.collection === "material-symbols") stats.skipped++;
  }
}

// append brand-new keys
for (const [key, mapped] of Object.entries(ADD)) {
  if (final[key]) continue;
  const [col, name] = mapped.split(":");
  const ok = col === "mage" ? mageHas(name) : heroHas(name);
  if (!ok) { stats.missing.push(`ADD ${key} -> ${mapped}`); continue; }
  keys.push(key);
  final[key] = { collection: col, name };
  stats[col]++;
}

// emit unique imports
const uniq = new Map();
for (const key of keys) {
  const t = final[key];
  if (!t) continue;
  uniq.set(`${t.collection}/${t.name}`, t);
}
const importLines = [...uniq.values()]
  .sort((a, b) => varFor(a).localeCompare(varFor(b)))
  .map((t) => `import ${varFor(t)} from "~icons/${t.collection}/${t.name}";`)
  .join("\n");

const entryLines = keys.map((k) => `  ${JSON.stringify(k)}: ${varFor(final[k])},`).join("\n");

const out = `${header}import ${"type"} { Component } from "vue";

${importLines}

export const iconRegistry = {
${entryLines}
} as const satisfies Record<string, Component>;

export type IconName = keyof typeof iconRegistry;
`;

fs.writeFileSync(file, out, "utf8");
console.log("Remapped:", JSON.stringify({ mage: stats.mage, heroicons: stats.heroicons, keptMaterialSymbols: stats.skipped, totalKeys: keys.length }, null, 2));
if (stats.missing.length) console.log("MISSING (kept MS):\n" + stats.missing.join("\n"));
