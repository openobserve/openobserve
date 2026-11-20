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

import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { I18nKey } from "@/types/i18n";
import type { NavItem, RailEntry, SubnavChild } from "./ONavbar.types";
import { NAV_GROUPS } from "./navGroups";

export type SidebarEntry = Extract<RailEntry, { type: "link" | "linkGroup" }>;

export type SidebarSectionKey = "top" | "explore" | "monitor" | "ai" | "data" | "more" | "bottom";

export interface SidebarSection {
  key: SidebarSectionKey;
  titleKey?: I18nKey;
  entries: SidebarEntry[];
}

/**
 * Section membership and order, by rail entry name (a top-level item `name` or a NAV_GROUPS `key`).
 * Absorbed names are listed too: they surface as plain links when their group does not form.
 */
const SECTION_MEMBERS: Record<Exclude<SidebarSectionKey, "more">, string[]> = {
  top: ["home"],
  explore: ["logs", "metrics", "traces", "profiles"],
  monitor: [
    "dashboards",
    "reports",
    "alertList",
    "incidentList",
    "reliability",
    "sloList",
    "downtimes",
    "onCallResponses",
    "infra",
    "experience",
    "rum",
    "synthetics",
    "productAnalytics",
  ],
  ai: ["aiObservability", "autoobserve"],
  data: ["data", "streams", "pipeline", "ingestion", "workflows"],
  bottom: ["settings", "iam", "billings"],
};

const SECTION_ORDER: SidebarSectionKey[] = [
  "top",
  "explore",
  "monitor",
  "ai",
  "data",
  "more",
  "bottom",
];

const SECTION_TITLES: Partial<Record<SidebarSectionKey, I18nKey>> = {
  explore: "components.sidebar.explore",
  monitor: "components.sidebar.monitor",
  ai: "components.sidebar.ai",
  data: "menu.data",
};

// Settings and IAM are separate bottom rows here, not one flyout tile.
const FLATTENED_GROUPS = new Set(["settings"]);

export const SIDEBAR_ICONS: Record<string, IconName> = {
  home: "home",
  logs: "search",
  metrics: "bar-chart",
  traces: "account-tree",
  profiles: "memory",
  dashboards: "dashboard",
  reports: "description",
  reliability: "shield",
  alertList: "shield-alert-outline",
  sloList: "target",
  incidentList: "notifications-active",
  infra: "dns",
  experience: "devices",
  rum: "devices",
  synthetics: "radar",
  productAnalytics: "insights",
  aiObservability: "auto-awesome",
  autoobserve: "navigation",
  data: "database",
  streams: "window",
  pipeline: "lan",
  workflows: "schema",
  ingestion: "data-plus-line",
  settings: "settings",
  iam: "manage-accounts",
  billings: "payments",
};

const SIDEBAR_ICON_OVERRIDES: Record<string, IconName> = {
  home: "sidebar-home",
  "shield-alert-outline": "sidebar-alert",
  "auto-awesome": "sidebar-ai",
  insights: "sidebar-insights",
  "data-plus-line": "sidebar-ingestion",
  "brain-circuit": "sidebar-intel",
};

export function sidebarIcon(icon: string): IconName {
  return SIDEBAR_ICON_OVERRIDES[icon] ?? (icon as IconName);
}

function sectionOf(name: string): SidebarSectionKey {
  for (const key of SECTION_ORDER) {
    if (key !== "more" && SECTION_MEMBERS[key].includes(name)) return key;
  }
  return "more";
}

function rank(name: string, section: SidebarSectionKey): number {
  if (section === "more") return 0;
  return SECTION_MEMBERS[section].indexOf(name);
}

/**
 * Buckets the rail entries (already gated by groupNavLinks) into sidebar sections. `links` is the
 * flat list the entries came from; a flattened group is replaced by its absorbed links.
 */
export function buildSidebarSections(entries: RailEntry[], links: NavItem[]): SidebarSection[] {
  const flat: SidebarEntry[] = [];
  for (const entry of entries) {
    // Pure groups (`type: "group"`) are not emitted by groupNavLinks today.
    if (entry.type === "group") continue;
    if (entry.type === "linkGroup" && FLATTENED_GROUPS.has(entry.item.name)) {
      const absorbs = NAV_GROUPS.find((g) => g.key === entry.item.name)?.absorbs ?? [];
      for (const link of links) {
        if (absorbs.includes(link.name)) flat.push({ type: "link", item: link });
      }
      continue;
    }
    flat.push(entry);
  }

  const buckets = new Map<SidebarSectionKey, SidebarEntry[]>();
  for (const entry of flat) {
    const key = sectionOf(entry.item.name);
    const list = buckets.get(key) ?? [];
    list.push(entry);
    buckets.set(key, list);
  }

  return SECTION_ORDER.flatMap((key) => {
    const list = buckets.get(key);
    if (!list?.length) return [];
    // Stable sort keeps the input order for ties (the "more" section).
    const entriesSorted = [...list].sort((a, b) => rank(a.item.name, key) - rank(b.item.name, key));
    return [{ key, titleKey: SECTION_TITLES[key], entries: entriesSorted }];
  });
}

/** A group starts open when the current route sits inside one of its children. */
export function groupContainsActive(
  children: SubnavChild[],
  filtered: SubnavChild[] | undefined,
  resolve: (children: SubnavChild[]) => SubnavChild | null,
): boolean {
  return resolve(children) !== null || resolve(filtered ?? []) !== null;
}
