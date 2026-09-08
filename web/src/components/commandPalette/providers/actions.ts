// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import type { TranslateFn } from "@/types/i18n";
import type { PaletteItem } from "../types";

export interface ActionHandlers {
  toggleTheme(): void;
  openShortcuts(): void;
  openDocs(): void;
  openSlack(): void;
}

export interface ActionsProviderInput {
  t: TranslateFn;
  handlers: ActionHandlers;
  hasRoute(name: string): boolean;
  isDark: boolean;
}

const DOCS_URL = "https://openobserve.ai/docs";

/** Create verbs and utilities; rows whose route is not registered in this build are dropped. */
export function buildActionItems({
  t,
  handlers,
  hasRoute,
  isDark,
}: ActionsProviderInput): PaletteItem[] {
  const items: Array<PaletteItem & { requires?: string }> = [
    {
      id: "action:newDashboard",
      type: "action",
      label: String(t("palette.actions.newDashboard")),
      icon: "add",
      route: { name: "dashboards", query: { action: "add" } },
      requires: "dashboards",
      keywords: ["create", "dashboard"],
    },
    {
      id: "action:importDashboard",
      type: "action",
      label: String(t("dashboard.importDashboard")),
      icon: "add",
      route: { name: "importDashboard" },
      requires: "importDashboard",
      keywords: ["dashboard", "json"],
    },
    {
      id: "action:newAlert",
      type: "action",
      label: String(t("alerts.add")),
      icon: "add",
      route: { name: "alertList", query: { action: "add" } },
      requires: "alertList",
      keywords: ["create", "alert", "monitor"],
    },
    {
      id: "action:newPipeline",
      type: "action",
      label: String(t("pipeline.addPipeline")),
      icon: "add",
      route: { name: "createPipeline" },
      requires: "createPipeline",
      keywords: ["create", "pipeline", "etl"],
    },
    {
      id: "action:newFunction",
      type: "action",
      label: String(t("function.add")),
      icon: "add",
      route: { name: "functionList", query: { action: "add" } },
      requires: "functionList",
      keywords: ["create", "function", "vrl"],
    },
    {
      id: "action:toggleTheme",
      type: "action",
      label: String(t(isDark ? "palette.actions.lightMode" : "palette.actions.darkMode")),
      icon: isDark ? "light-mode" : "dark-mode",
      run: handlers.toggleTheme,
      keywords: ["theme", "dark", "light", "appearance"],
    },
    {
      id: "action:shortcuts",
      type: "action",
      label: String(t("menu.keyboardShortcuts")),
      icon: "keyboard",
      trailing: { kind: "shortcut", value: "shift+?" },
      run: handlers.openShortcuts,
      keywords: ["keys", "hotkeys", "cheatsheet"],
    },
    {
      id: "external:docs",
      type: "external",
      label: String(t("menu.docs")),
      icon: "open-in-new",
      trailing: { kind: "url", value: DOCS_URL },
      run: handlers.openDocs,
      keywords: ["documentation", "help", "manual"],
    },
    {
      id: "external:slack",
      type: "external",
      label: String(t("palette.actions.slack")),
      icon: "open-in-new",
      run: handlers.openSlack,
      keywords: ["community", "support", "chat"],
    },
  ];
  return items
    .filter((i) => !i.requires || hasRoute(i.requires))
    .map(({ requires: _requires, ...item }) => item);
}
