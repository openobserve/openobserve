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

import type {
  NavItem,
  RailEntry,
  SubnavChild,
  NavGateContext,
} from "./ONavbar.types";

/**
 * Visibility gates — each predicate mirrors the EXACT `visible` condition the
 * target page applies to that section (IdentityAccessManagement.vue,
 * settings/index.vue). Keeping these in sync is what guarantees the flyout never
 * offers a section the page itself hides (e.g. Nodes is enterprise-meta-only).
 *
 * NOTE: IAM treats "enterprise" as enterprise OR cloud; Settings treats it as
 * enterprise only — hence the separate `isEnterprise`/`isCloud` flags rather
 * than one combined flag.
 */
export const GATE_PREDICATES: Record<
  string,
  (c: NavGateContext) => boolean
> = {
  // Settings (isEnt = enterprise only)
  enterprise: (c) => c.isEnterprise,
  enterpriseMeta: (c) => c.isEnterprise && c.isMeta,
  cloudMeta: (c) => c.isCloud && c.isMeta,
  storage: (c) => c.isEnterprise && (!c.isCloud || c.orgStorage),
  modelPricing: (c) => c.modelPricing,
  correlation: (c) => c.isEnterprise && c.serviceStreams,
  llmProviders: (c) => (c.isEnterprise || c.isCloud) && c.onlineEvals,
  // IAM (isEnt = enterprise OR cloud)
  cloud: (c) => c.isCloud,
  serviceAccount: (c) => c.serviceAccount,
  rbac: (c) => (c.isEnterprise || c.isCloud) && c.rbac,
  rbacMeta: (c) => (c.isEnterprise || c.isCloud) && c.rbac && c.isMeta,
};

/**
 * Left-rail information architecture — the SINGLE place that decides what stays
 * on the rail, what becomes a flyout group, and which top-level links reveal
 * their own sub-pages on hover.
 *
 * Three shapes (see `RailEntry`):
 *   • plain link    — most items (Home, Logs, Metrics, Traces, RUM, Dashboards,
 *     Streams, Alerts, Incidents, Actions, Billings).
 *   • link + subnav — a top-level link that also surfaces its in-page section
 *     nav on hover (NAV_SUBNAV). Clicking goes to the main page; the flyout
 *     deep-links into a section. Used for AI / IAM / Management.
 *   • pure group    — a flyout with no page of its own (NAV_GROUPS). "Data"
 *     gathers the pipeline/ingestion/reporting items.
 *
 * The subnav entries below mirror each page's OWN section nav (label / icon /
 * category) so the flyout and the page's SectionRail stay identical. Children
 * navigate by route `name` and are filtered through `router.hasRoute(name)` so
 * feature-gated (enterprise / cloud / RBAC) sections never render dead links.
 *
 * To move an item, edit ONLY this file.
 */

/**
 * A rail group: a tile that gathers several destinations under one label. It
 * behaves like the link+subnav items (AI/IAM/Management) — clicking the tile
 * navigates to `parentLink` (its first/primary destination) and hovering reveals
 * the full submenu.
 */
export interface NavGroupDef {
  key: string;
  title: string;
  icon: string;
  /** Where clicking the tile navigates (its first item). */
  parentLink: string;
  children: SubnavChild[];
  /** Top-level `name`s this group replaces (removed from the rail). */
  absorbs: string[];
  pinBottom?: boolean;
}

export const NAV_GROUPS: NavGroupDef[] = [
  {
    key: "data",
    title: "Data",
    icon: "database",
    parentLink: "/streams",
    absorbs: ["streams", "pipeline", "ingestion"],
    children: [
      { titleKey: "menu.index", icon: "window", name: "logstreams", requires: "streams" },
      // Pipeline expands into its own tabbed sub-pages.
      { titleKey: "function.streamPipeline", icon: "lan", name: "pipelines", requires: "pipeline" },
      { titleKey: "function.header", icon: "function", name: "functionList", requires: "pipeline" },
      { titleKey: "function.enrichmentTables", icon: "dataset", name: "enrichmentTables", requires: "pipeline" },
      { titleKey: "menu.ingestion", icon: "data-plus-line", name: "ingestion", requires: "ingestion" },
    ],
  },
];

/**
 * Top-level links that also reveal their own in-page section nav on hover.
 * Keyed by the top-level item's `name`. Mirrors each page's SectionRail exactly
 * (see IdentityAccessManagement.vue, settings/index.vue,
 * AIObservability/Index.vue). `router.hasRoute()` filtering drops any section
 * not registered in the current build.
 */
export const NAV_SUBNAV: Record<string, SubnavChild[]> = {
  iam: [
    { category: "Access", titleKey: "iam.basicUsers", icon: "person", name: "users" },
    { category: "Access", titleKey: "iam.serviceAccounts", icon: "manage-accounts", name: "serviceAccounts", gate: "serviceAccount" },
    { category: "Access", titleKey: "iam.ingestionTokens", icon: "key", name: "ingestionTokens" },
    { category: "Access", titleKey: "iam.invitations", icon: "mail", name: "invitations", gate: "cloud" },
    { category: "Permissions", titleKey: "iam.groups", icon: "group", name: "groups", gate: "rbac" },
    { category: "Permissions", titleKey: "iam.roles", icon: "shield", name: "roles", gate: "rbac" },
    { category: "Permissions", titleKey: "iam.quota", icon: "speed", name: "quota", gate: "rbacMeta" },
    { category: "Organization", titleKey: "iam.organizations", icon: "corporate-fare", name: "organizations" },
  ],
  settings: [
    { category: "General", titleKey: "settings.generalLabel", icon: "settings", name: "general" },
    { category: "General", titleKey: "settings.orgLabel", icon: "business", name: "organization" },
    { category: "Access & Security", titleKey: "settings.cipherKeys", icon: "key", name: "cipherKeys", gate: "enterprise" },
    { category: "Access & Security", titleKey: "regex_patterns.title", icon: "pattern", name: "regexPatterns", gate: "enterprise" },
    { category: "Access & Security", titleKey: "settings.ssoDomainRestrictions", icon: "dns", name: "domainManagement", gate: "enterpriseMeta" },
    { category: "Destinations & Templates", titleKey: "alert_destinations.header", icon: "location-on", name: "alertDestinations" },
    { category: "Destinations & Templates", titleKey: "pipeline_destinations.header", icon: "person-pin-circle", name: "pipelineDestinations", gate: "enterprise" },
    { category: "Destinations & Templates", titleKey: "alert_templates.header", icon: "description", name: "alertTemplates" },
    { category: "Data & AI", titleKey: "storage_settings.tabLabel", icon: "cloud", name: "storageSettings", gate: "storage" },
    { category: "Data & AI", titleKey: "settings.llmModelPricing", icon: "paid", name: "modelPricing", gate: "modelPricing" },
    { category: "Data & AI", titleKey: "settings.correlationSettings", icon: "group-work", name: "correlationSettings", gate: "correlation" },
    { category: "Data & AI", titleKey: "llmProviders.tabLabel", icon: "smart-toy", name: "llmProviders", gate: "llmProviders" },
    { category: "Operations", titleKey: "settings.queryManagement", icon: "query-stats", name: "queryManagement", gate: "enterpriseMeta" },
    { category: "Operations", titleKey: "settings.nodes", icon: "hub", name: "nodes", gate: "enterpriseMeta" },
    { category: "Account", titleKey: "settings.license", icon: "card-membership", name: "license", gate: "enterpriseMeta" },
    { category: "Account", titleKey: "settings.organizationManagement", icon: "lan", name: "orgnizationManagement", gate: "cloudMeta" },
  ],
  aiObservability: [
    { category: "Monitor", titleKey: "aiObservability.nav.llmInsights", icon: "dashboard", name: "aiLLMInsights" },
    { category: "Monitor", titleKey: "aiObservability.nav.sessions", icon: "forum", name: "aiSessions" },
    { category: "Evaluate", titleKey: "aiObservability.nav.quality", icon: "star-rate", name: "aiEvaluations", tab: "quality" },
    { category: "Evaluate", titleKey: "aiObservability.nav.evalJobs", icon: "event", name: "aiEvaluations", tab: "jobs" },
    { category: "Evaluate", titleKey: "aiObservability.nav.scorers", icon: "rule", name: "aiEvaluations", tab: "scorers" },
    { category: "Evaluate", titleKey: "aiObservability.nav.scoreConfigs", icon: "tune", name: "aiEvaluations", tab: "scoreConfigs" },
  ],
};

/**
 * Desired top-level rail order. `@<groupKey>` tokens mark where a pure group is
 * inserted. Names absent here (but present in the flat list) are appended at the
 * end so nothing silently disappears; names absorbed by a group are skipped.
 */
const RAIL_ORDER: string[] = [
  "home",
  "logs",
  "metrics",
  "traces",
  "rum",
  "aiObservability",
  "dashboards",
  "reports",
  "@data",
  "alertList",
  "incidentList",
  "actionScripts",
  "billings",
  "iam",
  "settings",
];

/** Transform the flat `linksList` into ordered rail entries. */
export function groupNavLinks(links: NavItem[]): RailEntry[] {
  const byName = new Map(links.map((l) => [l.name, l]));
  const presentNames = new Set(links.map((l) => l.name));

  const absorbed = new Set<string>();
  NAV_GROUPS.forEach((g) => g.absorbs.forEach((n) => absorbed.add(n)));

  // Pre-build group entries, dropping children whose `requires` top-level item
  // isn't present. (`router.hasRoute` gating happens later, in the component.)
  const groupByToken = new Map<string, RailEntry>();
  for (const def of NAV_GROUPS) {
    const children = def.children.filter(
      (c) => !c.requires || presentNames.has(c.requires),
    );
    if (children.length === 0) continue;
    // A group renders like a link+subnav: the tile navigates to `parentLink`
    // (its first item) and hovering reveals the children.
    groupByToken.set(`@${def.key}`, {
      type: "linkGroup",
      item: {
        title: def.title,
        icon: def.icon,
        link: def.parentLink,
        name: def.key,
      },
      children,
    });
  }

  const entryFor = (name: string): RailEntry | null => {
    const item = byName.get(name);
    if (!item) return null;
    const subnav = NAV_SUBNAV[name];
    if (subnav && subnav.length > 0) {
      return { type: "linkGroup", item, children: subnav };
    }
    return { type: "link", item };
  };

  const result: RailEntry[] = [];
  const pinned: RailEntry[] = [];
  const placedNames = new Set<string>();

  for (const token of RAIL_ORDER) {
    if (token.startsWith("@")) {
      const group = groupByToken.get(token);
      if (group) {
        (group.type === "group" && group.pinBottom ? pinned : result).push(group);
        groupByToken.delete(token);
      }
      continue;
    }
    if (absorbed.has(token) || !presentNames.has(token)) continue;
    const entry = entryFor(token);
    if (entry) {
      result.push(entry);
      placedNames.add(token);
    }
  }

  // Safety net: append any present, non-absorbed item not covered by RAIL_ORDER,
  // so a newly added menu still shows up (top-level, at the end).
  for (const item of links) {
    if (absorbed.has(item.name) || placedNames.has(item.name)) continue;
    if (RAIL_ORDER.includes(item.name)) continue;
    const entry = entryFor(item.name);
    if (entry) result.push(entry);
  }

  for (const group of groupByToken.values()) {
    (group.type === "group" && group.pinBottom ? pinned : result).push(group);
  }

  return [...result, ...pinned];
}
