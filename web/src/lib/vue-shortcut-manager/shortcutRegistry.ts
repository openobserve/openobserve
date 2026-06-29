// Copyright 2026 OpenObserve Inc.

/**
 * Single source of truth for every keyboard shortcut in the app.
 *
 * Each entry carries:
 *  - a stable `id` — used by `useShortcuts([{ id, handler }])` to register the
 *    shortcut, by the cheatsheet to list it, and by unit / e2e tests to look it
 *    up (see `getShortcutDef`). Ids are unique across the whole registry.
 *  - the real registration key(s). Platform handling is explicit:
 *      • `key`            — same combo on every platform (e.g. "r", "/", "escape")
 *      • `keyForWindows` + `keyForMac` — platform-specific pair (Ctrl ↔ ⌘)
 *      • `keys`           — several equivalent bindings (e.g. ["j", "down"])
 *    Entries with none of these are display-only (handled by another mechanism
 *    such as the table-row keys in `OTableBodyRow` or panel-hover keys in
 *    `PanelContainer`) and only appear in the cheatsheet.
 *  - `descriptionKey` — i18n key under shortcuts.actions.*
 *  - optional `display` — cheatsheet label when it isn't derivable from the key
 *    (multi-binding rows and display-only rows).
 *
 * To add a shortcut:
 *  1. Add the i18n key to en.json under shortcuts.pages / shortcuts.actions
 *  2. Add an entry here with a unique `id`
 *  3. Register it in the component with useShortcuts([{ id, handler }])
 */

export interface ShortcutEntry {
  /** Stable, globally-unique id. */
  id: string;
  /** i18n key under shortcuts.actions.* */
  descriptionKey: string;
  /** Same combo on every platform. */
  key?: string;
  /** Platform-specific combo (Windows / Linux). Pairs with `keyForMac`. */
  keyForWindows?: string;
  /** Platform-specific combo (macOS). Pairs with `keyForWindows`. */
  keyForMac?: string;
  /** Multiple equivalent bindings (e.g. j and ArrowDown both move down). */
  keys?: string[];
  /** Cheatsheet label override — only when not derivable from the key(s). */
  display?: string;
}

export interface ShortcutGroup {
  /** i18n key under shortcuts.pages.* */
  pageKey: string;
  /** Manager scope shared by this group's registerable shortcuts (omit = global). */
  scope?: string;
  shortcuts: ShortcutEntry[];
}

export interface ShortcutModule {
  /** i18n key under shortcuts.modules.* */
  titleKey: string;
  /** pageKeys (ShortcutGroup.pageKey) grouped under this module, in display order */
  pages: string[];
}

/**
 * Groups the flat SHORTCUT_REGISTRY into modules for the cheatsheet. Each module
 * is one chip + one block in the listing; its `pages` render as sub-sections.
 */
export const SHORTCUT_MODULES: ShortcutModule[] = [
  { titleKey: "shortcuts.modules.global", pages: ["shortcuts.pages.global"] },
  { titleKey: "shortcuts.modules.logs", pages: ["shortcuts.pages.logs"] },
  {
    titleKey: "shortcuts.modules.dashboards",
    pages: [
      "shortcuts.pages.dashboardsList",
      "shortcuts.pages.dashboards",
      "shortcuts.pages.dashboardsPanel",
      "shortcuts.pages.panelEditor",
    ],
  },
  { titleKey: "shortcuts.modules.metrics", pages: ["shortcuts.pages.metrics"] },
  {
    titleKey: "shortcuts.modules.traces",
    pages: ["shortcuts.pages.traces", "shortcuts.pages.traceDetail"],
  },
  {
    titleKey: "shortcuts.modules.alerts",
    pages: [
      "shortcuts.pages.alerts",
      "shortcuts.pages.alertDestinations",
      "shortcuts.pages.alertTemplates",
    ],
  },
  { titleKey: "shortcuts.modules.streams", pages: ["shortcuts.pages.streams"] },
  { titleKey: "shortcuts.modules.pipelines", pages: ["shortcuts.pages.pipelines"] },
  { titleKey: "shortcuts.modules.functions", pages: ["shortcuts.pages.functions"] },
  { titleKey: "shortcuts.modules.reports", pages: ["shortcuts.pages.reports"] },
  {
    titleKey: "shortcuts.modules.iam",
    pages: [
      "shortcuts.pages.iamUsers",
      "shortcuts.pages.iamRoles",
      "shortcuts.pages.iamGroups",
      "shortcuts.pages.iamServiceAccounts",
      "shortcuts.pages.ingestionTokens",
    ],
  },
  {
    titleKey: "shortcuts.modules.runningQueries",
    pages: ["shortcuts.pages.runningQueries"],
  },
];

export const SHORTCUT_REGISTRY: ShortcutGroup[] = [
  // ── Global ──────────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.global",
    shortcuts: [
      { id: "openCheatsheet", key: "shift+?",                        descriptionKey: "shortcuts.actions.openCheatsheet" },
      { id: "closeDialog",    key: "escape",                         descriptionKey: "shortcuts.actions.closeDialog" },
      { id: "aiChatToggle",   keyForWindows: "ctrl+b", keyForMac: "meta+b", descriptionKey: "shortcuts.actions.aiChatToggle" },
    ],
  },

  // ── Logs ────────────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.logs",
    scope: "logs",
    shortcuts: [
      { id: "logsRunQuery",        keyForWindows: "ctrl+enter",   keyForMac: "meta+enter",   descriptionKey: "shortcuts.actions.logsRunQuery" },
      { id: "logsRefresh",         key: "r",                                                 descriptionKey: "shortcuts.actions.logsRefresh" },
      { id: "logsToggleHistogram", key: "h",                                                 descriptionKey: "shortcuts.actions.logsToggleHistogram" },
      { id: "logsToggleSidebar",   keyForWindows: "ctrl+/",       keyForMac: "meta+/",       descriptionKey: "shortcuts.actions.logsToggleSidebar" },
      { id: "logsSearchHistory",   keyForWindows: "ctrl+h",       keyForMac: "meta+h",       descriptionKey: "shortcuts.actions.logsSearchHistory" },
      { id: "logsFocusQuery",      key: "/",                                                 descriptionKey: "shortcuts.actions.focusQuery" },
      { id: "logsSaveView",        key: "s",                                                 descriptionKey: "shortcuts.actions.logsSaveView" },
      { id: "logsExport",          keyForWindows: "ctrl+shift+d", keyForMac: "meta+shift+d", descriptionKey: "shortcuts.actions.logsExport" },
    ],
  },

  // ── Dashboards (list) ───────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.dashboardsList",
    scope: "dashboards-list",
    shortcuts: [
      { id: "dashboardsListAdd",     key: "n", descriptionKey: "shortcuts.actions.dashboardsListAdd" },
      { id: "dashboardsListImport",  key: "i", descriptionKey: "shortcuts.actions.dashboardsListImport" },
      { id: "dashboardsListRefresh", key: "r", descriptionKey: "shortcuts.actions.dashboardsListRefresh" },
      { id: "dashboardsListFocusSearch", key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
      { id: "dashboardsListRowDuplicate", display: "d",        descriptionKey: "shortcuts.actions.tableRowDuplicate" },
      { id: "dashboardsListRowDelete",    display: "del / ⌫", descriptionKey: "shortcuts.actions.tableRowDelete" },
    ],
  },

  // ── Dashboard view ──────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.dashboards",
    scope: "dashboard",
    shortcuts: [
      { id: "dashboardAddPanel",   key: "n",                                          descriptionKey: "shortcuts.actions.dashboardAddPanel" },
      { id: "dashboardRefresh",    key: "r",                                          descriptionKey: "shortcuts.actions.dashboardRefresh" },
      { id: "dashboardSave",       keyForWindows: "ctrl+s", keyForMac: "meta+s",      descriptionKey: "shortcuts.actions.dashboardSave" },
      { id: "dashboardFullscreen", key: "f",                                          descriptionKey: "shortcuts.actions.dashboardFullscreen" },
      { id: "dashboardExport",     key: "x",                                          descriptionKey: "shortcuts.actions.dashboardExport" },
    ],
  },

  // ── Dashboard panel (hover — handled by PanelContainer, display-only) ────
  {
    pageKey: "shortcuts.pages.dashboardsPanel",
    shortcuts: [
      { id: "panelView",            display: "v",        descriptionKey: "shortcuts.actions.panelView" },
      { id: "panelQueryInspector",  display: "i",        descriptionKey: "shortcuts.actions.panelQueryInspector" },
      { id: "panelEdit",            display: "e",        descriptionKey: "shortcuts.actions.panelEdit" },
      { id: "panelDuplicate",       display: "d",        descriptionKey: "shortcuts.actions.panelDuplicate" },
      { id: "panelDelete",          display: "del / ⌫", descriptionKey: "shortcuts.actions.panelDelete" },
    ],
  },

  // ── Panel Editor ─────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.panelEditor",
    scope: "panel-editor",
    shortcuts: [
      { id: "panelEditorRun",            keyForWindows: "ctrl+enter", keyForMac: "meta+enter", descriptionKey: "shortcuts.actions.panelEditorRun" },
      { id: "panelEditorSave",           keyForWindows: "ctrl+s",     keyForMac: "meta+s",     descriptionKey: "shortcuts.actions.panelEditorSave" },
      { id: "panelEditorBack",           key: "alt+left",                                      descriptionKey: "shortcuts.actions.panelEditorBack" },
      { id: "panelEditorQueryInspector", key: "i",                                             descriptionKey: "shortcuts.actions.panelEditorQueryInspector" },
    ],
  },

  // ── Metrics ─────────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.metrics",
    scope: "metrics",
    shortcuts: [
      { id: "metricsRunQuery", keyForWindows: "ctrl+enter", keyForMac: "meta+enter", descriptionKey: "shortcuts.actions.metricsRunQuery" },
      { id: "metricsRefresh",  key: "r",                                              descriptionKey: "shortcuts.actions.metricsRefresh" },
    ],
  },

  // ── Traces ──────────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.traces",
    scope: "traces",
    shortcuts: [
      { id: "tracesSearch",     keyForWindows: "ctrl+enter",   keyForMac: "meta+enter",   descriptionKey: "shortcuts.actions.tracesSearch" },
      { id: "tracesRefresh",    key: "r",                                                 descriptionKey: "shortcuts.actions.tracesRefresh" },
      { id: "tracesFocusQuery", key: "/",                                                 descriptionKey: "shortcuts.actions.focusQuery" },
      { id: "tracesCopyUrl",    keyForWindows: "ctrl+shift+c", keyForMac: "meta+shift+c", descriptionKey: "shortcuts.actions.tracesCopyUrl" },
    ],
  },

  // ── Trace Detail ─────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.traceDetail",
    scope: "trace-detail",
    shortcuts: [
      { id: "traceNextSpan", keys: ["j", "down"], display: "J / ↓", descriptionKey: "shortcuts.actions.traceNextSpan" },
      { id: "tracePrevSpan", keys: ["k", "up"],   display: "K / ↑", descriptionKey: "shortcuts.actions.tracePrevSpan" },
    ],
  },

  // ── Alerts ──────────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.alerts",
    scope: "alerts",
    shortcuts: [
      { id: "alertsCreate",      key: "n", descriptionKey: "shortcuts.actions.alertsCreate" },
      { id: "alertsImport",      key: "i", descriptionKey: "shortcuts.actions.alertsImport" },
      { id: "alertsRefresh",     key: "r", descriptionKey: "shortcuts.actions.alertsRefresh" },
      { id: "alertsFocusSearch", key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
      { id: "alertsRowEdit",      display: "e",        descriptionKey: "shortcuts.actions.tableRowEdit" },
      { id: "alertsRowDuplicate", display: "d",        descriptionKey: "shortcuts.actions.tableRowDuplicate" },
      { id: "alertsRowPause",     display: "p",        descriptionKey: "shortcuts.actions.tableRowPause" },
      { id: "alertsRowExport",    display: "x",        descriptionKey: "shortcuts.actions.tableRowExport" },
      { id: "alertsRowDelete",    display: "del / ⌫", descriptionKey: "shortcuts.actions.tableRowDelete" },
    ],
  },

  // ── Alert Destinations ──────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.alertDestinations",
    scope: "alert-destinations",
    shortcuts: [
      { id: "alertDestinationsAdd",         key: "n", descriptionKey: "shortcuts.actions.alertDestinationsAdd" },
      { id: "alertDestinationsRefresh",     key: "r", descriptionKey: "shortcuts.actions.alertDestinationsRefresh" },
      { id: "alertDestinationsFocusSearch", key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
      { id: "alertDestinationsRowEdit",   display: "e",        descriptionKey: "shortcuts.actions.tableRowEdit" },
      { id: "alertDestinationsRowExport", display: "x",        descriptionKey: "shortcuts.actions.tableRowExport" },
      { id: "alertDestinationsRowDelete", display: "del / ⌫", descriptionKey: "shortcuts.actions.tableRowDelete" },
    ],
  },

  // ── Alert Templates ─────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.alertTemplates",
    scope: "alert-templates",
    shortcuts: [
      { id: "alertTemplatesAdd",         key: "n", descriptionKey: "shortcuts.actions.alertTemplatesAdd" },
      { id: "alertTemplatesRefresh",     key: "r", descriptionKey: "shortcuts.actions.alertTemplatesRefresh" },
      { id: "alertTemplatesFocusSearch", key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
      { id: "alertTemplatesRowEdit",   display: "e",        descriptionKey: "shortcuts.actions.tableRowEdit" },
      { id: "alertTemplatesRowExport", display: "x",        descriptionKey: "shortcuts.actions.tableRowExport" },
      { id: "alertTemplatesRowDelete", display: "del / ⌫", descriptionKey: "shortcuts.actions.tableRowDelete" },
    ],
  },

  // ── Streams ─────────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.streams",
    scope: "streams",
    shortcuts: [
      { id: "streamsAdd",         key: "n", descriptionKey: "shortcuts.actions.streamsAdd" },
      { id: "streamsRefresh",     key: "r", descriptionKey: "shortcuts.actions.streamsRefresh" },
      { id: "streamsFocusSearch", key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
      { id: "streamsRowDelete", display: "del / ⌫", descriptionKey: "shortcuts.actions.tableRowDelete" },
    ],
  },

  // ── Pipelines ───────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.pipelines",
    scope: "pipelines",
    shortcuts: [
      { id: "pipelinesAdd",         key: "n", descriptionKey: "shortcuts.actions.pipelinesAdd" },
      { id: "pipelinesImport",      key: "i", descriptionKey: "shortcuts.actions.pipelinesImport" },
      { id: "pipelinesRefresh",     key: "r", descriptionKey: "shortcuts.actions.pipelinesRefresh" },
      { id: "pipelinesFocusSearch", key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
      { id: "pipelinesRowEdit",   display: "e",        descriptionKey: "shortcuts.actions.tableRowEdit" },
      { id: "pipelinesRowPause",  display: "p",        descriptionKey: "shortcuts.actions.tableRowPause" },
      { id: "pipelinesRowExport", display: "x",        descriptionKey: "shortcuts.actions.tableRowExport" },
      { id: "pipelinesRowDelete", display: "del / ⌫", descriptionKey: "shortcuts.actions.tableRowDelete" },
    ],
  },

  // ── Functions ───────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.functions",
    scope: "functions",
    shortcuts: [
      { id: "functionsAdd",         key: "n", descriptionKey: "shortcuts.actions.functionsAdd" },
      { id: "functionsRefresh",     key: "r", descriptionKey: "shortcuts.actions.functionsRefresh" },
      { id: "functionsFocusSearch", key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
      { id: "functionsRowEdit",   display: "e",        descriptionKey: "shortcuts.actions.tableRowEdit" },
      { id: "functionsRowDelete", display: "del / ⌫", descriptionKey: "shortcuts.actions.tableRowDelete" },
    ],
  },

  // ── Reports ─────────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.reports",
    scope: "reports",
    shortcuts: [
      { id: "reportsAdd",         key: "n", descriptionKey: "shortcuts.actions.reportsAdd" },
      { id: "reportsRefresh",     key: "r", descriptionKey: "shortcuts.actions.reportsRefresh" },
      { id: "reportsFocusSearch", key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
      { id: "reportsRowEdit",   display: "e",        descriptionKey: "shortcuts.actions.tableRowEdit" },
      { id: "reportsRowDelete", display: "del / ⌫", descriptionKey: "shortcuts.actions.tableRowDelete" },
    ],
  },

  // ── IAM — Users ─────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.iamUsers",
    scope: "iam-users",
    shortcuts: [
      { id: "iamUsersAdd",         key: "n", descriptionKey: "shortcuts.actions.iamUsersAdd" },
      { id: "iamUsersRefresh",     key: "r", descriptionKey: "shortcuts.actions.iamUsersRefresh" },
      { id: "iamUsersFocusSearch", key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
      { id: "iamUsersRowEdit",   display: "e",        descriptionKey: "shortcuts.actions.tableRowEdit" },
      { id: "iamUsersRowDelete", display: "del / ⌫", descriptionKey: "shortcuts.actions.tableRowDelete" },
    ],
  },

  // ── IAM — Roles ─────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.iamRoles",
    scope: "iam-roles",
    shortcuts: [
      { id: "iamRolesAdd",         key: "n", descriptionKey: "shortcuts.actions.iamRolesAdd" },
      { id: "iamRolesRefresh",     key: "r", descriptionKey: "shortcuts.actions.iamRolesRefresh" },
      { id: "iamRolesFocusSearch", key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
      { id: "iamRolesRowEdit",   display: "e",        descriptionKey: "shortcuts.actions.tableRowEdit" },
      { id: "iamRolesRowDelete", display: "del / ⌫", descriptionKey: "shortcuts.actions.tableRowDelete" },
    ],
  },

  // ── IAM — Groups ────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.iamGroups",
    scope: "iam-groups",
    shortcuts: [
      { id: "iamGroupsAdd",         key: "n", descriptionKey: "shortcuts.actions.iamGroupsAdd" },
      { id: "iamGroupsRefresh",     key: "r", descriptionKey: "shortcuts.actions.iamGroupsRefresh" },
      { id: "iamGroupsFocusSearch", key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
      { id: "iamGroupsRowEdit",   display: "e",        descriptionKey: "shortcuts.actions.tableRowEdit" },
      { id: "iamGroupsRowDelete", display: "del / ⌫", descriptionKey: "shortcuts.actions.tableRowDelete" },
    ],
  },

  // ── IAM — Service Accounts ──────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.iamServiceAccounts",
    scope: "iam-service-accounts",
    shortcuts: [
      { id: "iamServiceAccountsAdd",         key: "n", descriptionKey: "shortcuts.actions.iamServiceAccountsAdd" },
      { id: "iamServiceAccountsRefresh",     key: "r", descriptionKey: "shortcuts.actions.iamServiceAccountsRefresh" },
      { id: "iamServiceAccountsFocusSearch", key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
      { id: "iamServiceAccountsRowEdit",   display: "e",        descriptionKey: "shortcuts.actions.tableRowEdit" },
      { id: "iamServiceAccountsRowDelete", display: "del / ⌫", descriptionKey: "shortcuts.actions.tableRowDelete" },
    ],
  },

  // ── IAM — Ingestion Tokens ──────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.ingestionTokens",
    scope: "ingestion-tokens",
    shortcuts: [
      { id: "ingestionTokensAdd",         key: "n", descriptionKey: "shortcuts.actions.ingestionTokensAdd" },
      { id: "ingestionTokensRefresh",     key: "r", descriptionKey: "shortcuts.actions.ingestionTokensRefresh" },
      { id: "ingestionTokensFocusSearch", key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
    ],
  },

  // ── Running Queries ─────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.runningQueries",
    scope: "running-queries",
    shortcuts: [
      { id: "runningQueriesRefresh",     key: "r", descriptionKey: "shortcuts.actions.runningQueriesRefresh" },
      { id: "runningQueriesFocusSearch", key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Flat id → definition lookup (registerable shortcuts only)
// ---------------------------------------------------------------------------

/** A registerable shortcut definition resolved from the registry by id. */
export interface ShortcutDef {
  id: string;
  scope?: string;
  descriptionKey: string;
  key?: string;
  keyForWindows?: string;
  keyForMac?: string;
  keys?: string[];
}

function isRegisterable(e: ShortcutEntry): boolean {
  return !!(e.key || e.keyForWindows || e.keyForMac || e.keys);
}

const DEFS: Map<string, ShortcutDef> = (() => {
  const map = new Map<string, ShortcutDef>();
  for (const group of SHORTCUT_REGISTRY) {
    for (const e of group.shortcuts) {
      if (map.has(e.id)) {
        console.warn(`[shortcutRegistry] Duplicate shortcut id "${e.id}".`);
      }
      if (!isRegisterable(e)) continue;
      map.set(e.id, {
        id: e.id,
        scope: group.scope,
        descriptionKey: e.descriptionKey,
        key: e.key,
        keyForWindows: e.keyForWindows,
        keyForMac: e.keyForMac,
        keys: e.keys,
      });
    }
  }
  return map;
})();

/**
 * Look up a registerable shortcut definition by id. Returns undefined for
 * unknown or display-only ids. Used by `useShortcuts([{ id, handler }])` and by
 * unit / e2e tests.
 */
export function getShortcutDef(id: string): ShortcutDef | undefined {
  return DEFS.get(id);
}

/**
 * Resolve a definition's registration key(s) for the given platform.
 *  - `keys`            → all of them (multiple equivalent bindings)
 *  - platform pair     → the combo for this platform (mac ⇒ keyForMac)
 *  - `key`             → as-is
 */
export function resolveShortcutKeys(def: ShortcutDef, mac: boolean): string[] {
  if (def.keys?.length) return def.keys;
  const platform = (mac ? def.keyForMac : def.keyForWindows) ?? def.key;
  return platform ? [platform] : [];
}
