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

  // ── Table row (hover) ────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.tableRow",
    shortcuts: [
      { key: "↑ / ↓",    descriptionKey: "shortcuts.actions.tableRowNavigate" },
      { key: "enter",    descriptionKey: "shortcuts.actions.tableRowOpen" },
      { key: "e",        descriptionKey: "shortcuts.actions.tableRowEdit" },
      { key: "d",        descriptionKey: "shortcuts.actions.tableRowDuplicate" },
      { key: "i",        descriptionKey: "shortcuts.actions.tableRowInspect" },
      { key: "p",        descriptionKey: "shortcuts.actions.tableRowPause" },
      { key: "r",        descriptionKey: "shortcuts.actions.tableRowResume" },
      { key: "v",        descriptionKey: "shortcuts.actions.tableRowView" },
      { key: "x",        descriptionKey: "shortcuts.actions.tableRowExport" },
      { key: "del / ⌫", descriptionKey: "shortcuts.actions.tableRowDelete" },
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
      { key: "ctrl+shift+c", descriptionKey: "shortcuts.actions.logsCopyQuery" },
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
    ],
  },

  // ── Alert Destinations ──────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.alertDestinations",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.alertDestinationsAdd" },
      { key: "r", descriptionKey: "shortcuts.actions.alertDestinationsRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
    ],
  },

  // ── Alert Templates ─────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.alertTemplates",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.alertTemplatesAdd" },
      { key: "r", descriptionKey: "shortcuts.actions.alertTemplatesRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
    ],
  },

  // ── Streams ─────────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.streams",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.streamsAdd" },
      { key: "r", descriptionKey: "shortcuts.actions.streamsRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
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
    ],
  },

  // ── Functions ───────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.functions",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.functionsAdd" },
      { key: "r", descriptionKey: "shortcuts.actions.functionsRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
    ],
  },

  // ── Reports ─────────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.reports",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.reportsAdd" },
      { key: "r", descriptionKey: "shortcuts.actions.reportsRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
    ],
  },

  // ── IAM — Users ─────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.iamUsers",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.iamUsersAdd" },
      { key: "r", descriptionKey: "shortcuts.actions.iamUsersRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
    ],
  },

  // ── IAM — Roles ─────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.iamRoles",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.iamRolesAdd" },
      { key: "r", descriptionKey: "shortcuts.actions.iamRolesRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
    ],
  },

  // ── IAM — Groups ────────────────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.iamGroups",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.iamGroupsAdd" },
      { key: "r", descriptionKey: "shortcuts.actions.iamGroupsRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
    ],
  },

  // ── IAM — Service Accounts ──────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.iamServiceAccounts",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.iamServiceAccountsAdd" },
      { key: "r", descriptionKey: "shortcuts.actions.iamServiceAccountsRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
    ],
  },

  // ── IAM — Ingestion Tokens ──────────────────────────────────────────────
  {
    pageKey: "shortcuts.pages.ingestionTokens",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.ingestionTokensAdd" },
      { key: "r", descriptionKey: "shortcuts.actions.ingestionTokensRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
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
