// Re-skin the icon registry to Hugeicons (primary, thin+rounded, stroke 1.5) with
// Streamline-Flex as a gap fallback. Keeps Material Symbols only if neither has a match.
// Only touches src/lib/core/Icon/OIcon.icons.ts.  Run: node scripts/remap-hugeicons.mjs
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const huge = require("@iconify-json/hugeicons/icons.json");
// Streamline-Flex was an exploration fallback; Hugeicons covered everything so it
// was uninstalled. Tolerate its absence.
let flex = { icons: {} };
try { flex = require("@iconify-json/streamline-flex/icons.json"); } catch { /* not installed */ }
const HUGE = new Set(Object.keys(huge.icons));
const FLEX = new Set(Object.keys(flex.icons));

// Candidate concept stems per registry key. The search tries each stem as: exact,
// then -01/-02/-03, then the first `stem-<n>`. First stem that resolves wins.
// Only keys whose Hugeicons name differs from the key need an entry; others fall
// back to [key]. Order stems by visual preference (closest main-branch look first).
const SYN = {
  // arrows & chevrons (Hugeicons: arrow-*-01 are the chevrons)
  "expand-more": ["arrow-down-01"], "arrow-drop-down": ["arrow-down-01"], "keyboard-arrow-down": ["arrow-down-01"],
  "expand-less": ["arrow-up-01"], "arrow-drop-up": ["arrow-up-01"], "keyboard-arrow-up": ["arrow-up-01"],
  "chevron-left": ["arrow-left-01"], "navigate-before": ["arrow-left-01"], "keyboard-arrow-left": ["arrow-left-01"],
  "chevron-right": ["arrow-right-01"], "navigate-next": ["arrow-right-01"], "keyboard-arrow-right": ["arrow-right-01"],
  "arrow-back": ["arrow-left-02"], "arrow-back-ios": ["arrow-left-01"], "arrow-back-ios-new": ["arrow-left-01"],
  "arrow-forward": ["arrow-right-02"], "arrow-forward-ios": ["arrow-right-01"],
  "arrow-upward": ["arrow-up-02"], "arrow-downward": ["arrow-down-02"],
  "arrow-right": ["arrow-right-02"], "arrow-right-alt": ["arrow-right-02"],
  "keyboard-double-arrow-left": ["arrow-left-double"], "keyboard-double-arrow-right": ["arrow-right-double"],
  "first-page": ["arrow-left-double"], "last-page": ["arrow-right-double"],
  "call-made": ["arrow-up-right-01", "arrow-up-right"], "call-received": ["arrow-down-left-01", "arrow-down-left"],
  "undo": ["arrow-turn-backward", "undo"], "redo": ["arrow-turn-forward", "redo"],
  "unfold-more": ["unfold-more", "arrow-up-down"], "unfold-less": ["unfold-less", "arrow-shrink"],
  "trending-up": ["chart-increase", "trade-up"], "trending-up-filled": ["chart-increase", "trade-up"],
  "trending-down": ["chart-decrease", "trade-down"], "auto-graph": ["chart-line-data-01", "chart-up"],
  "show-chart": ["chart-line-data-01"], "reorder": ["menu-01"], "compare-arrows": ["exchange-01"],
  "swap-horiz": ["exchange-01"], "swap-vert": ["exchange-02", "arrow-up-down"], "compare": ["exchange-01"], "exchange": ["exchange-01"],
  "fork-right": ["arrow-turn-right"], "alt-route": ["route-01", "routing"],

  // core actions
  "add": ["add-01", "plus-sign"], "add-circle": ["add-circle"], "add-circle-outline": ["add-circle"],
  "remove": ["remove-01", "minus-sign"], "close": ["cancel-01"], "clear": ["cancel-01"], "cancel": ["cancel-circle"],
  "check": ["tick-01", "tick-02"], "check-circle": ["checkmark-circle-01"], "check-circle-outline": ["checkmark-circle-02", "checkmark-circle-01"],
  "check-box": ["checkmark-square-01"], "task-alt": ["checkmark-circle-01"], "content-copy": ["copy-01"],
  "delete": ["delete-02"], "delete-outline": ["delete-02"], "delete-sweep": ["delete-03"],
  "edit": ["pencil-edit-02", "edit-02"], "download": ["download-01", "download-04"], "file-download": ["file-download"],
  "upload": ["upload-01", "upload-04"], "upload-file": ["file-upload"], "file-upload": ["file-upload"], "note-add": ["file-add", "note-add"],
  "save": ["floppy-disk"], "refresh": ["arrow-reload-horizontal"], "cached": ["arrow-reload-horizontal"], "sync": ["arrow-reload-horizontal"], "autorenew": ["arrow-reload-horizontal"],
  "restart-alt": ["arrow-reload-horizontal"], "update": ["arrow-reload-horizontal"], "search": ["search-01"], "manage-search": ["search-01"], "saved-search": ["search-add"],
  "filter": ["filter"], "filter-alt": ["filter"], "filter-list": ["filter-horizontal", "filter"], "share": ["share-08", "share-01"],
  "send": ["sent-02", "navigation-03"], "print": ["printer"], "preview": ["view"], "open-in-new": ["link-square-02", "arrow-up-right-01"],
  "open-in-full": ["arrow-expand-01", "maximize-01"], "fullscreen": ["arrow-expand-01", "maximize-screen"], "fullscreen-exit": ["arrow-shrink-01", "minimize-screen"],
  "close-fullscreen": ["arrow-shrink-01"], "compress": ["arrow-shrink-01"], "more-vert": ["more-vertical"], "more-horiz": ["more-horizontal"],

  // media
  "play-arrow": ["play"], "play-circle": ["play-circle"], "play-circle-filled": ["play-circle"], "pause": ["pause"],
  "pause-circle-filled": ["pause-circle"], "stop": ["stop"], "stop-circle": ["stop-circle"],
  "fast-forward": ["forward-02", "next"], "fast-rewind": ["backward-02", "previous"], "volume-up": ["volume-high"], "volume-off": ["volume-mute-02", "volume-off"],

  // status
  "info": ["information-circle"], "info-filled": ["information-circle"], "info-outline": ["information-circle"],
  "error": ["alert-circle"], "error-outline": ["alert-circle"], "warning": ["alert-02", "alert-triangle"], "warning-amber": ["alert-02", "alert-triangle"],
  "report-problem": ["alert-triangle", "alert-02"], "help": ["help-circle"], "help-outline": ["help-circle"], "block": ["unavailable", "cancel-circle"],
  "verified": ["checkmark-badge-01"], "verified-user": ["shield-user", "checkmark-badge-01"], "shield-alert-outline": ["shield-energy", "alert-02"],
  "sentiment-very-dissatisfied": ["sad-01", "confused"], "thumb-up-off-alt": ["thumbs-up"], "thumb-down-off-alt": ["thumbs-down"],

  // people
  "person": ["user"], "person-add": ["user-add-01", "add-team"], "group": ["user-multiple"], "groups": ["user-group", "user-multiple"],
  "group-add": ["add-team", "user-add-01"], "group-work": ["user-group"], "how-to-reg": ["user-check-01"], "manage-accounts": ["user-settings-01"],
  "location-on": ["location-01", "location-05"], "person-pin-circle": ["location-user-01", "location-01"],

  // objects
  "alarm": ["alarm-clock"], "schedule": ["clock-01"], "access-time": ["clock-01"], "timer": ["clock-01", "time-quarter"],
  "calendar-month": ["calendar-01", "calendar-03"], "event": ["calendar-01"], "event-note": ["calendar-03"], "bookmark": ["bookmark-01"],
  "flag": ["flag-02", "flag-01"], "tag": ["tag-01"], "label": ["tag-01"], "key": ["key-01"], "lock": ["square-lock-01", "lock"],
  "login": ["login-01"], "logout": ["logout-01"], "exit-to-app": ["logout-01"], "notifications": ["notification-02", "notification-01"],
  "notifications-active": ["notification-02"], "mail": ["mail-01"], "inbox": ["inbox"], "chat": ["bubble-chat"], "forum": ["bubble-chat-question", "comment-01"],
  "star": ["star"], "star-rate": ["star"], "stars": ["sparkles", "star"], "favorite": ["favourite"], "favorite-border": ["favourite"],
  "link": ["link-02", "link-01"], "attachment": ["attachment-01", "attachment"], "attach-file": ["attachment-01"], "gift": ["gift"], "redeem": ["gift"], "card-giftcard": ["gift"],
  "lightbulb": ["idea-01", "bulb"], "lightbulb-outline": ["idea-01", "bulb"], "build": ["wrench-01", "tools"], "settings": ["settings-01", "settings-02"],
  "tune": ["equalizer-02", "preference-horizontal"], "dark-mode": ["moon-02", "moon"], "light-mode": ["sun-03", "sun-01"], "wifi": ["wifi-01"],
  "bolt": ["flash"], "rocket-launch": ["rocket-01", "rocket"], "flame": ["fire"], "whatshot": ["fire"], "memory": ["computer", "chip", "ram"],
  "mouse": ["mouse-01"], "ads-click": ["cursor-magic-selection-01", "cursor-01"], "campaign": ["megaphone-01"], "menu-book": ["book-open-01"],
  "palette": ["paint-board"], "color-lens": ["paint-board"], "colorize": ["color-picker"], "hour-glass": ["hour-glass"], "hourglass-empty": ["hour-glass"],
  "layers": ["layers-01"], "box": ["package", "box-1"], "inventory-2": ["package", "inbox"], "ribbon": ["medal-01", "award-01"], "workspace-premium": ["medal-01", "award-01"],
  "id-card": ["id"], "card-membership": ["id", "credit-card"], "laptop": ["laptop"], "devices": ["computer-phone-sync", "device-access"], "monitor-heart": ["heart-check", "pulse-01"],

  // money
  "attach-money": ["dollar-01", "money-01"], "monetization-on": ["dollar-circle"], "paid": ["dollar-circle"], "payments": ["credit-card"], "credit-card": ["credit-card"],

  // data / dev / charts
  "code": ["source-code", "code"], "data-object": ["source-code"], "data-array": ["square-arrow-data", "code"], "database": ["database"], "dns": ["server-stack-01", "database"],
  "storage": ["database-01", "server-stack-01"], "dataset": ["table-01", "grid-table"], "table-chart": ["table-01"], "table-view": ["table-01"], "grid-on": ["grid-table", "grid"],
  "view-column": ["layout-3-column", "table-columns-split"], "bar-chart": ["chart-column", "chart-column-big"], "analytics": ["analytics-01", "chart-bar-line"], "assessment": ["analytics-01"],
  "query-stats": ["chart-line-data-01", "analytics-01"], "insights": ["chart-line-data-01", "analytics-up"], "list": ["menu-01", "list-view"], "format-list-bulleted": ["left-to-right-list-bullet", "list-view"],
  "format-list-numbered": ["left-to-right-list-number"], "view-in-ar": ["cube"], "widgets": ["dashboard-square-01", "grid"], "category": ["grid", "dashboard-square-02"],
  "workspaces": ["grid", "dashboard-square-01"], "dashboard": ["dashboard-square-01", "dashboard-browsing"], "dashboard-customize": ["dashboard-square-add"],
  "data-plus-line": ["database-add", "database"], "function": ["function", "function-square"], "functions": ["function", "sigma"],

  // documents
  "article": ["news", "document-attachment"], "description": ["license", "doc-01", "file-01"], "draft": ["file-edit", "doc-01"], "assignment": ["task-01", "clipboard"],
  "assignment-turned-in": ["task-done-01", "checkmark-square-01"], "fact-check": ["task-done-01"], "rule": ["checklist", "task-01"], "plagiarism": ["search-document", "file-search"],

  // cloud / web / org
  "cloud": ["cloud"], "cloud-upload": ["cloud-upload"], "cloud-download": ["cloud-download"], "backup": ["cloud-upload"], "language": ["globe", "global"],
  "web": ["global", "internet"], "window": ["browser", "window"], "network-check": ["wifi-connected-01", "signal-full-02"], "account-balance": ["bank"],
  "business": ["building-06", "office"], "domain": ["building-06"], "organization": ["building-06", "structure-01"], "corporate-fare": ["building-08", "office"],
  "auto-awesome": ["sparkles", "ai-magic"], "security": ["shield-01", "security"], "shield": ["shield-01", "security"], "smart-toy": ["robot-01", "bot"], "image": ["image-01", "image-02"],
  "menu": ["menu-01", "menu-02"], "folder": ["folder-01"], "folder-open": ["folder-open", "folder-02"], "folder-outline": ["folder-01"], "drive-file-move": ["folder-export", "folder-move-to"],
  "lan": ["share-network", "structure-01"], "hub": ["share-network", "connect"], "schema": ["structure-01", "flowchart-01"], "account-tree": ["structure-01", "flowchart-01"],
  "graph-2": ["flowchart-01"], "call-merge": ["git-merge"], "git-branch": ["git-branch"], "merge": ["git-merge"], "pattern": ["dashed-line-02", "grid"],

  // misc kept-but-mappable
  "history": ["clock-01", "time-04"], "title": ["text", "heading-01"], "text-fields": ["text"], "align-left": ["text-align-left"],
  "bookmark": ["bookmark-01"], "radar": ["radar-01"], "psychology": ["brain-01", "brain"], "brain-circuit": ["ai-brain-01", "brain-01"],
  "speed": ["dashboard-speed-01", "gauge-01"], "troubleshoot": ["search-02", "bug-01"], "rocket": ["rocket-01"], "key-2": ["key-01"],
  "admin-panel-settings": ["shield-user", "user-settings-01"], "fact-check-2": ["task-done-01"], "view-column-2": ["layout-table-01"],
  "radio-button-checked": ["radio", "circle"], "radio-button-unchecked": ["circle"], "circle": ["circle"], "drag-indicator": ["drag-drop", "more-horizontal"],
  "touch-app": ["touch-01", "cursor-pointer-01"], "webhook": ["api", "webhook"], "memory-2": ["chip"], "speed-2": ["gauge-01"],
  "pets": ["paw"], "monitor-heart-2": ["heart-check"], "dataset-2": ["table-01"], "view-in-ar-2": ["cube"],

  // traces / new key
  "traces": ["chart-gantt", "bar-chart-horizontal", "waterfall-up-01"],

  // action-* dashboard keys (keep matching the rest)
  "action-import": ["file-import", "download-04"], "action-move-to-folder": ["folder-export", "folder-move-to"],
  "action-duplicate": ["copy-01"], "action-delete": ["delete-02"],

  // rescue pass for the "kept on Material Symbols" list (resolve() validates each)
  "visibility": ["view"], "visibility-off": ["view-off"],
  "hourglass-empty": ["sand-clock", "time-04", "time-quarter-02"],
  "left-panel-close": ["sidebar-left-01", "sidebar-left"], "left-panel-open": ["sidebar-left-01", "sidebar-left"],
  "all-inclusive": ["infinity-01", "infinity"], "fork-right": ["git-fork", "arrow-turn-right"],
  "cloud-done": ["cloud-saving-done-01", "cloud-saving-done-02"], "running-with-errors": ["alert-circle"],
  "search-off": ["search-remove", "search-minus"], "data-usage": ["pie-chart", "pie-chart-01"],
  "fiber-manual-record": ["record", "circle"], "tab": ["browser", "tap-06"],
  "transform": ["arrow-data-transfer-horizontal", "exchange-01"], "processing": ["arrow-data-transfer-horizontal", "exchange-01"],
  "wrap-text": ["text-wrap"], "expand-all": ["unfold-more", "row-insert"], "input": ["login-03", "text-indent"],
  "replay-10": ["backward-01", "rewind-01"], "forward-10": ["forward-01", "fast-forward"],
  "code-off": ["source-code-circle", "code"], "sync-disabled": ["arrow-reload-horizontal"], "sync-problem": ["arrow-reload-horizontal"],
  "progress-activity": ["loading-03", "loading-01"], "data-info-alert": ["database-setting", "alert-02"],
  "history-toggle-off": ["clock-01"], "emergency": ["first-aid-kit", "ambulance"], "123": ["numbers-01", "digit"],
};

const file = "src/lib/core/Icon/OIcon.icons.ts";
const src = fs.readFileSync(file, "utf8");
const header = `// ─────────────────────────────────────────────────────────────────────────────
// APPROVED ICON REGISTRY
//
// Icons are resolved at build time by unplugin-icons — zero runtime fetches, so the
// app stays functional in air-gapped environments.
//
// Sourced from Hugeicons (primary, thin + rounded, stroke 1.5) with Streamline-Flex
// as a gap fallback. IconName is a closed literal union derived from this registry —
// unknown names are TypeScript compile errors, not runtime errors.
// ─────────────────────────────────────────────────────────────────────────────

`;

// parse imports + registry from current file
const identMap = {};
for (const m of src.matchAll(/^import\s+(\w+)\s+from\s+"~icons\/([^/]+)\/([^"]+)";/gm))
  identMap[m[1]] = { collection: m[2], name: m[3] };
const body = src.slice(src.indexOf("iconRegistry = {"));
const keys = [];
const keyToCurrent = {};
for (const line of body.split("\n")) {
  const m = line.match(/^\s*"([^"]+)":\s*(\w+),/);
  if (!m) continue;
  if (m[1] in keyToCurrent) continue;
  keys.push(m[1]);
  keyToCurrent[m[1]] = identMap[m[2]];
}

// resolve a stem to a concrete icon name in a set
const resolve = (set, stem) => {
  if (set.has(stem)) return stem;
  for (const v of ["-01", "-02", "-03"]) if (set.has(stem + v)) return stem + v;
  const re = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d+$`);
  for (const n of set) if (re.test(n)) return n;
  return null;
};

const final = {};
const stats = { hugeicons: 0, "streamline-flex": 0, kept: 0 };
const report = [];
for (const key of keys) {
  const stems = SYN[key] || [key];
  let hit = null, col = null;
  for (const stem of stems) { const r = resolve(HUGE, stem); if (r) { hit = r; col = "hugeicons"; break; } }
  if (!hit) for (const stem of stems) { const r = resolve(FLEX, stem); if (r) { hit = r; col = "streamline-flex"; break; } }
  if (hit) { final[key] = { collection: col, name: hit }; stats[col]++; report.push(`${key}  ->  ${col}:${hit}`); }
  else { final[key] = keyToCurrent[key]; stats.kept++; report.push(`${key}  ->  KEPT ${keyToCurrent[key]?.collection}:${keyToCurrent[key]?.name}`); }
}

// emit
const prefix = { hugeicons: "Hu", "streamline-flex": "Sf", "material-symbols": "Ms", mage: "Mg", heroicons: "He" };
const pascal = (s) => s.split(/[^a-z0-9]+/i).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
const varFor = (t) => (prefix[t.collection] || "Ic") + pascal(t.name);
const uniq = new Map();
for (const key of keys) { const t = final[key]; if (t) uniq.set(`${t.collection}/${t.name}`, t); }
const importLines = [...uniq.values()].sort((a, b) => varFor(a).localeCompare(varFor(b)))
  .map((t) => `import ${varFor(t)} from "~icons/${t.collection}/${t.name}";`).join("\n");
const entryLines = keys.map((k) => `  ${JSON.stringify(k)}: ${varFor(final[k])},`).join("\n");
const out = `${header}import type { Component } from "vue";

${importLines}

export const iconRegistry = {
${entryLines}
} as const satisfies Record<string, Component>;

export type IconName = keyof typeof iconRegistry;
`;
fs.writeFileSync(file, out, "utf8");
console.log(JSON.stringify(stats, null, 2));
fs.writeFileSync("scripts/icon-map-report.txt", report.join("\n"));
console.log("kept (no hugeicons/flex match):\n" + report.filter((r) => r.includes("KEPT")).join("\n"));
