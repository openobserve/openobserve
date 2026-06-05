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
 */
export const SHORTCUT_REGISTRY: ShortcutGroup[] = [
  {
    pageKey: "shortcuts.pages.global",
    shortcuts: [
      { key: "shift+?", descriptionKey: "shortcuts.actions.openCheatsheet" },
      { key: "escape",  descriptionKey: "shortcuts.actions.closeDialog" },
    ],
  },
  {
    pageKey: "shortcuts.pages.logs",
    shortcuts: [
      { key: "ctrl+enter", descriptionKey: "shortcuts.actions.logsRunQuery" },
      { key: "r",          descriptionKey: "shortcuts.actions.logsRefresh" },
      { key: "h",          descriptionKey: "shortcuts.actions.logsToggleHistogram" },
      { key: "ctrl+/",     descriptionKey: "shortcuts.actions.logsToggleSidebar" },
      { key: "/",          descriptionKey: "shortcuts.actions.focusSearch" },
    ],
  },
  {
    pageKey: "shortcuts.pages.dashboardsList",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.dashboardsListAdd" },
      { key: "i", descriptionKey: "shortcuts.actions.dashboardsListImport" },
      { key: "r", descriptionKey: "shortcuts.actions.dashboardsListRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
    ],
  },
  {
    pageKey: "shortcuts.pages.dashboards",
    shortcuts: [
      { key: "e",       descriptionKey: "shortcuts.actions.dashboardAddPanel" },
      { key: "n",       descriptionKey: "shortcuts.actions.dashboardAddPanel" },
      { key: "r",       descriptionKey: "shortcuts.actions.dashboardRefresh" },
      { key: "ctrl+s",  descriptionKey: "shortcuts.actions.dashboardSave" },
      { key: "f",       descriptionKey: "shortcuts.actions.dashboardFullscreen" },
    ],
  },
  {
    pageKey: "shortcuts.pages.dashboardsPanel",
    shortcuts: [
      { key: "v",               descriptionKey: "shortcuts.actions.panelView" },
      { key: "e",               descriptionKey: "shortcuts.actions.panelEdit" },
      { key: "d",               descriptionKey: "shortcuts.actions.panelDuplicate" },
      { key: "delete / ⌫",     descriptionKey: "shortcuts.actions.panelDelete" },
    ],
  },
  {
    pageKey: "shortcuts.pages.metrics",
    shortcuts: [
      { key: "ctrl+enter", descriptionKey: "shortcuts.actions.metricsRunQuery" },
      { key: "r",          descriptionKey: "shortcuts.actions.metricsRefresh" },
    ],
  },
  {
    pageKey: "shortcuts.pages.traces",
    shortcuts: [
      { key: "ctrl+enter", descriptionKey: "shortcuts.actions.tracesSearch" },
      { key: "r",          descriptionKey: "shortcuts.actions.tracesRefresh" },
    ],
  },
  {
    pageKey: "shortcuts.pages.alerts",
    shortcuts: [
      { key: "n",      descriptionKey: "shortcuts.actions.alertsCreate" },
      { key: "r",      descriptionKey: "shortcuts.actions.alertsRefresh" },
      { key: "escape", descriptionKey: "shortcuts.actions.alertsClose" },
    ],
  },
  {
    pageKey: "shortcuts.pages.streams",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.streamsAdd" },
      { key: "r", descriptionKey: "shortcuts.actions.streamsRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
    ],
  },
  {
    pageKey: "shortcuts.pages.pipelines",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.pipelinesAdd" },
      { key: "i", descriptionKey: "shortcuts.actions.pipelinesImport" },
      { key: "r", descriptionKey: "shortcuts.actions.pipelinesRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
    ],
  },
  {
    pageKey: "shortcuts.pages.functions",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.functionsAdd" },
      { key: "r", descriptionKey: "shortcuts.actions.functionsRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
    ],
  },
  {
    pageKey: "shortcuts.pages.reports",
    shortcuts: [
      { key: "n", descriptionKey: "shortcuts.actions.reportsAdd" },
      { key: "r", descriptionKey: "shortcuts.actions.reportsRefresh" },
      { key: "/", descriptionKey: "shortcuts.actions.focusSearch" },
    ],
  },
];
