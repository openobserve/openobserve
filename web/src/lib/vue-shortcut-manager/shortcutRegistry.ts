// Copyright 2026 OpenObserve Inc.

export interface ShortcutEntry {
  key: string;
  /** i18n key under shortcuts.actions.* */
  descriptionKey: string;
}

export interface ShortcutGroup {
  /** i18n key under shortcuts.pages.* */
  pageKey: string;
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

/**
 * Static registry of all keyboard shortcuts shown in the cheatsheet.
 * All labels are i18n keys — the cheatsheet resolves them via useI18n().
 * Independent of the live ShortcutManager so every shortcut is always visible
 * regardless of which page is currently mounted.
 *
 * To add a new shortcut:
 *  1. Add the i18n key to en.json under shortcuts.pages / shortcuts.actions
 *  2. Add a ShortcutGroup entry here
 *  3. Register the handler in the relevant Vue component with useShortcutsWithMac()
 */
export const SHORTCUT_REGISTRY: ShortcutGroup[] = [
  // ── Global ──────────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.global",
    shortcuts: [
      { key: "shift+?",  descriptionKey: "shortcuts.actions.openCheatsheet" },
      { key: "escape",   descriptionKey: "shortcuts.actions.closeDialog" },
      { key: "ctrl+b",   descriptionKey: "shortcuts.actions.aiChatToggle" },
    ],
  },

  // ── Logs ────────────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.logs",
    shortcuts: [
      { key: "ctrl+enter",   descriptionKey: "shortcuts.actions.logsRunQuery" },
      { key: "r",            descriptionKey: "shortcuts.actions.logsRefresh" },
      { key: "h",            descriptionKey: "shortcuts.actions.logsToggleHistogram" },
      { key: "ctrl+/",       descriptionKey: "shortcuts.actions.logsToggleSidebar" },
      { key: "ctrl+h",       descriptionKey: "shortcuts.actions.logsSearchHistory" },
      { key: "/",            descriptionKey: "shortcuts.actions.focusSearch" },
      { key: "s",            descriptionKey: "shortcuts.actions.logsSaveView" },
      { key: "ctrl+shift+d", descriptionKey: "shortcuts.actions.logsExport" },
    ],
  },

  // ── Dashboards (list) ───────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.dashboardsList",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.dashboardsListAdd" },
      { key: "i", descriptionKey: "shortcuts.actions.dashboardsListImport" },
      { key: "r", descriptionKey: "shortcuts.actions.dashboardsListRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
      { key: "e",        descriptionKey: "shortcuts.actions.dashboardRowEdit" },
      { key: "d",        descriptionKey: "shortcuts.actions.tableRowDuplicate" },
      { key: "x",        descriptionKey: "shortcuts.actions.dashboardRowExport" },
      { key: "del / ⌫", descriptionKey: "shortcuts.actions.tableRowDelete" },
    ],
  },

  // ── Dashboard view ──────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.dashboards",
    shortcuts: [
      { key: "n",      descriptionKey: "shortcuts.actions.dashboardAddPanel" },
      { key: "r",      descriptionKey: "shortcuts.actions.dashboardRefresh" },
      { key: "ctrl+s", descriptionKey: "shortcuts.actions.dashboardSave" },
      { key: "f",      descriptionKey: "shortcuts.actions.dashboardFullscreen" },
    ],
  },

  // ── Dashboard panel (hover) ─────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.dashboardsPanel",
    shortcuts: [
      { key: "v",        descriptionKey: "shortcuts.actions.panelView" },
      { key: "i",        descriptionKey: "shortcuts.actions.panelQueryInspector" },
      { key: "e",        descriptionKey: "shortcuts.actions.panelEdit" },
      { key: "d",        descriptionKey: "shortcuts.actions.panelDuplicate" },
      { key: "del / ⌫", descriptionKey: "shortcuts.actions.panelDelete" },
    ],
  },

  // ── Panel Editor ─────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.panelEditor",
    shortcuts: [
      { key: "ctrl+enter", descriptionKey: "shortcuts.actions.panelEditorRun" },
      { key: "ctrl+s",     descriptionKey: "shortcuts.actions.panelEditorSave" },
      { key: "alt+left",   descriptionKey: "shortcuts.actions.panelEditorBack" },
      { key: "i",          descriptionKey: "shortcuts.actions.panelEditorQueryInspector" },
    ],
  },

  // ── Metrics ─────────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.metrics",
    shortcuts: [
      { key: "ctrl+enter", descriptionKey: "shortcuts.actions.metricsRunQuery" },
      { key: "r",          descriptionKey: "shortcuts.actions.metricsRefresh" },
    ],
  },

  // ── Traces ──────────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.traces",
    shortcuts: [
      { key: "ctrl+enter",   descriptionKey: "shortcuts.actions.tracesSearch" },
      { key: "r",            descriptionKey: "shortcuts.actions.tracesRefresh" },
      { key: "/",            descriptionKey: "shortcuts.actions.focusSearch" },
      { key: "ctrl+shift+c", descriptionKey: "shortcuts.actions.tracesCopyUrl" },
    ],
  },

  // ── Trace Detail ─────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.traceDetail",
    shortcuts: [
      { key: "J / ↓", descriptionKey: "shortcuts.actions.traceNextSpan" },
      { key: "K / ↑", descriptionKey: "shortcuts.actions.tracePrevSpan" },
    ],
  },

  // ── Alerts ──────────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.alerts",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.alertsCreate" },
      { key: "i", descriptionKey: "shortcuts.actions.alertsImport" },
      { key: "r", descriptionKey: "shortcuts.actions.alertsRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
      { key: "e",        descriptionKey: "shortcuts.actions.tableRowEdit" },
      { key: "d",        descriptionKey: "shortcuts.actions.tableRowDuplicate" },
      { key: "p",        descriptionKey: "shortcuts.actions.tableRowPause" },
      { key: "x",        descriptionKey: "shortcuts.actions.tableRowExport" },
      { key: "del / ⌫", descriptionKey: "shortcuts.actions.tableRowDelete" },
    ],
  },

  // ── Alert Destinations ──────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.alertDestinations",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.alertDestinationsAdd" },
      { key: "r", descriptionKey: "shortcuts.actions.alertDestinationsRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
      { key: "e",        descriptionKey: "shortcuts.actions.tableRowEdit" },
      { key: "x",        descriptionKey: "shortcuts.actions.tableRowExport" },
      { key: "del / ⌫", descriptionKey: "shortcuts.actions.tableRowDelete" },
    ],
  },

  // ── Alert Templates ─────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.alertTemplates",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.alertTemplatesAdd" },
      { key: "r", descriptionKey: "shortcuts.actions.alertTemplatesRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
      { key: "e",        descriptionKey: "shortcuts.actions.tableRowEdit" },
      { key: "x",        descriptionKey: "shortcuts.actions.tableRowExport" },
      { key: "del / ⌫", descriptionKey: "shortcuts.actions.tableRowDelete" },
    ],
  },

  // ── Streams ─────────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.streams",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.streamsAdd" },
      { key: "r", descriptionKey: "shortcuts.actions.streamsRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
      { key: "e",        descriptionKey: "shortcuts.actions.tableRowEdit" },
      { key: "del / ⌫", descriptionKey: "shortcuts.actions.tableRowDelete" },
    ],
  },

  // ── Pipelines ───────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.pipelines",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.pipelinesAdd" },
      { key: "i", descriptionKey: "shortcuts.actions.pipelinesImport" },
      { key: "r", descriptionKey: "shortcuts.actions.pipelinesRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
      { key: "e",        descriptionKey: "shortcuts.actions.tableRowEdit" },
      { key: "p",        descriptionKey: "shortcuts.actions.tableRowPause" },
      { key: "x",        descriptionKey: "shortcuts.actions.tableRowExport" },
      { key: "del / ⌫", descriptionKey: "shortcuts.actions.tableRowDelete" },
    ],
  },

  // ── Functions ───────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.functions",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.functionsAdd" },
      { key: "r", descriptionKey: "shortcuts.actions.functionsRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
      { key: "e",        descriptionKey: "shortcuts.actions.tableRowEdit" },
      { key: "del / ⌫", descriptionKey: "shortcuts.actions.tableRowDelete" },
    ],
  },

  // ── Reports ─────────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.reports",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.reportsAdd" },
      { key: "r", descriptionKey: "shortcuts.actions.reportsRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
      { key: "e",        descriptionKey: "shortcuts.actions.tableRowEdit" },
      { key: "del / ⌫", descriptionKey: "shortcuts.actions.tableRowDelete" },
    ],
  },

  // ── IAM — Users ─────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.iamUsers",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.iamUsersAdd" },
      { key: "r", descriptionKey: "shortcuts.actions.iamUsersRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
      { key: "e",        descriptionKey: "shortcuts.actions.tableRowEdit" },
      { key: "del / ⌫", descriptionKey: "shortcuts.actions.tableRowDelete" },
    ],
  },

  // ── IAM — Roles ─────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.iamRoles",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.iamRolesAdd" },
      { key: "r", descriptionKey: "shortcuts.actions.iamRolesRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
      { key: "e",        descriptionKey: "shortcuts.actions.tableRowEdit" },
      { key: "del / ⌫", descriptionKey: "shortcuts.actions.tableRowDelete" },
    ],
  },

  // ── IAM — Groups ────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.iamGroups",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.iamGroupsAdd" },
      { key: "r", descriptionKey: "shortcuts.actions.iamGroupsRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
      { key: "e",        descriptionKey: "shortcuts.actions.tableRowEdit" },
      { key: "del / ⌫", descriptionKey: "shortcuts.actions.tableRowDelete" },
    ],
  },

  // ── IAM — Service Accounts ──────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.iamServiceAccounts",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.iamServiceAccountsAdd" },
      { key: "r", descriptionKey: "shortcuts.actions.iamServiceAccountsRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
      { key: "e",        descriptionKey: "shortcuts.actions.tableRowEdit" },
      { key: "del / ⌫", descriptionKey: "shortcuts.actions.tableRowDelete" },
    ],
  },

  // ── IAM — Ingestion Tokens ──────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.ingestionTokens",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.ingestionTokensAdd" },
      { key: "r", descriptionKey: "shortcuts.actions.ingestionTokensRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
      { key: "del / ⌫", descriptionKey: "shortcuts.actions.tableRowDelete" },
    ],
  },

  // ── Running Queries ─────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.runningQueries",
    shortcuts: [
      { key: "r", descriptionKey: "shortcuts.actions.runningQueriesRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
    ],
  },
];
