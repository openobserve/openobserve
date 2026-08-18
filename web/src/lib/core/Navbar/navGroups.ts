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

import type { NavItem, RailEntry, SubnavChild, NavGateContext } from "./ONavbar.types";
import { raw, type I18nKey, type TranslateFn } from "@/types/i18n";

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
export const GATE_PREDICATES: Record<string, (c: NavGateContext) => boolean> = {
  // Settings (isEnt = enterprise only)
  enterprise: (c) => c.isEnterprise,
  enterpriseMeta: (c) => c.isEnterprise && c.isMeta,
  cloudMeta: (c) => c.isCloud && c.isMeta,
  storage: (c) => c.isEnterprise && (!c.isCloud || c.orgStorage),
  modelPricing: (c) => (c.isEnterprise || c.isCloud) && c.modelPricing,
  correlation: (c) => c.isEnterprise && c.serviceStreams,
  llmProviders: (c) => (c.isEnterprise || c.isCloud) && c.onlineEvals,
  // IAM (isEnt = enterprise OR cloud)
  cloud: (c) => c.isCloud,
  serviceAccount: (c) => c.serviceAccount,
  rbac: (c) => (c.isEnterprise || c.isCloud) && c.rbac,
  rbacMeta: (c) => (c.isEnterprise || c.isCloud) && c.rbac && c.isMeta,
  // Pipelines: the Stream Pipelines tab hides when custom_hide_menus lists
  // "pipelines" — mirrors PipelineSectionTabs.vue exactly.
  streamPipelines: (c) => !c.hiddenMenus.has("pipelines"),
  // The runtime flag is the whole gate for the MENU ENTRY, which is not
  // enterprise-only. Three of Database Monitoring's seven tabs (deadlocks,
  // blocked queries, table health) ARE enterprise-only, but they are gated
  // per-tab in DbmSectionTabs.vue and per-route in router.ts — not here. An
  // isEnterprise conjunct at this level would take the four OSS tabs down with
  // them and hide the section from a build that still serves most of it.
  databaseMonitoring: (c) => c.databaseMonitoring,
};

/**
 * Left-rail information architecture — the SINGLE place that decides what stays
 * on the rail, what becomes a flyout group, and which top-level links reveal
 * their own sub-pages on hover.
 *
 * Three shapes (see `RailEntry`):
 *   • plain link    — most items (Home, Logs, Metrics, Traces, Actions,
 *     Billings, AI, IAM, Management).
 *   • link + subnav — a tile that navigates to a main page on click AND surfaces
 *     a section nav on hover. Produced by NAV_GROUPS (Reliability → /alerts,
 *     Data → /streams, Dashboards → /dashboards, Infra → /infra/databases) and
 *     by any NAV_SUBNAV entry.
 *   • pure group    — a flyout with no page of its own (click toggles it).
 *     Supported by the renderer but not emitted by any current entry.
 *
 * The child entries below mirror each page's OWN section nav (label / icon /
 * category) so the flyout and the page's SectionRail stay identical. Children
 * navigate by route `name` and are filtered through `router.hasRoute(name)` so
 * feature-gated (enterprise / cloud / RBAC) sections never render dead links.
 *
 * To move an item, edit ONLY this file.
 */

/**
 * A rail group: a tile that gathers destinations under one label. Clicking the
 * tile navigates to `parentLink` (its first/primary destination) and hovering
 * reveals the full submenu — i.e. it renders as a link+subnav tile.
 *
 * Two shapes: a COLLAPSING group folds existing top-level tiles into itself
 * (`absorbs`), while a `standalone` group introduces a new rail section for
 * pages that never had a tile of their own.
 */
export interface NavGroupDef {
  key: string;
  /** i18n key for the group tile's label (resolved with t() at render). */
  titleKey: I18nKey;
  icon: string;
  /** Where clicking the tile navigates (its first item). */
  parentLink: string;
  children: SubnavChild[];
  /** Top-level `name`s this group replaces (removed from the rail). */
  absorbs: string[];
  /**
   * Emit the group's tile immediately AFTER this anchor — either a top-level
   * item `name` or another group's `key` (when that anchor is present/active).
   * Defaults to the position of the group's first absorbed item.
   */
  placeAfter?: string;
  pinBottom?: boolean;
  /**
   * Emit this group even though it absorbs nothing and may hold a single child.
   *
   * Normally a group must absorb ≥1 present rail item and keep ≥2 children,
   * because it EXISTS to fold items that already have their own tiles — a
   * one-item flyout would just duplicate the tile it replaced. Infra is the
   * other shape: it is a NEW rail section that introduces a home for pages
   * which never had a top-level tile, so there is nothing to absorb and, until
   * a second section lands beside Database Monitoring, nothing to fold.
   *
   * Deliberately opt-in per group rather than a relaxed global rule: the ≥2
   * rule still protects every collapsing group from degenerating into a
   * pointless flyout when its members are hidden.
   *
   * This does NOT bypass `requires` filtering — a standalone group whose
   * children all filter out still emits nothing (see `groupNavLinks`), and a
   * group whose children are all `gate`d out is dropped by ONavGroup so the
   * rail never shows a tile with an empty flyout.
   */
  standalone?: boolean;
}

export const NAV_GROUPS: NavGroupDef[] = [
  {
    key: "reliability",
    titleKey: "menu.reliability",
    icon: "shield",
    parentLink: "/alerts",
    absorbs: ["alertList", "sloList", "incidentList"],
    children: [
      {
        titleKey: "menu.alerts",
        icon: "shield-alert-outline",
        name: "alertList",
        requires: "alertList",
      },
      // An SLO is what an SLO alert burns against, and an incident is what an
      // alert escalates into — one reliability workflow, one tile. Every child
      // carries `requires` so that hiding any of them (`custom_hide_menus`, or
      // Incidents being enterprise-gated) shrinks the group, and dropping to a
      // single survivor collapses it back to a plain link rather than leaving a
      // one-item flyout.
      { titleKey: "menu.slos", icon: "target", name: "sloList", requires: "sloList" },
      {
        titleKey: "menu.incidents",
        icon: "notifications-active",
        name: "incidentList",
        requires: "incidentList",
      },
      // Where an alert is delivered, and the message it delivers. These moved
      // out of Settings: they are alerting configuration, not deployment
      // configuration. They have no rail entry of their own, so they ride on
      // Alerts being present — hiding `alertList` via custom_hide_menus takes
      // its plumbing with it.
      {
        titleKey: "alert_destinations.header",
        icon: "location-on",
        name: "alertDestinations",
        requires: "alertList",
      },
      {
        titleKey: "alert_templates.header",
        icon: "description",
        name: "alertTemplates",
        requires: "alertList",
      },
      // Where external alerts (Grafana, Alertmanager, etc.) feed Incidents.
      // Gated on incidentList, not alertList: this only makes sense where
      // Incidents is enabled, matching the enterprise/cloud + incidents_enabled
      // visibility check it already carried as a Settings tab.
      {
        titleKey: "alert_sources.header",
        icon: "webhook",
        name: "alertSources",
        requires: "incidentList",
      },
    ],
  },
  {
    key: "data",
    titleKey: "menu.data",
    icon: "database",
    parentLink: "/streams",
    absorbs: ["streams", "pipeline", "ingestion"],
    // Data follows the Reliability tile. This is load-bearing: without it Data
    // lands at its own first absorbed item (pipeline/streams), near the TOP of
    // the rail, ahead of Experience and Dashboards.
    placeAfter: "reliability",
    children: [
      { titleKey: "menu.index", icon: "window", name: "logstreams", requires: "streams" },
      // Pipeline expands into its own tabbed sub-pages (same visibility rules).
      {
        titleKey: "function.streamPipeline",
        icon: "lan",
        name: "pipelines",
        requires: "pipeline",
        gate: "streamPipelines",
      },
      { titleKey: "function.header", icon: "function", name: "functionList", requires: "pipeline" },
      {
        titleKey: "function.enrichmentTables",
        icon: "dataset",
        name: "enrichmentTables",
        requires: "pipeline",
      },
      {
        titleKey: "menu.ingestion",
        icon: "data-plus-line",
        name: "ingestion",
        requires: "ingestion",
      },
    ],
  },
  {
    key: "dashboards",
    titleKey: "menu.dashboard",
    icon: "dashboard",
    parentLink: "/dashboards",
    absorbs: ["dashboards", "reports"],
    children: [
      { titleKey: "menu.dashboard", icon: "dashboard", name: "dashboards", requires: "dashboards" },
      { titleKey: "menu.report", icon: "description", name: "reports", requires: "reports" },
    ],
  },
  {
    key: "infra",
    titleKey: "menu.infra",
    icon: "dns",
    // The tile lands on Database Monitoring — today its only destination, and
    // the one that stays correct as the section grows, since a new Infra page
    // would be added after it rather than in front of it.
    parentLink: "/infra/databases",
    // Nothing to absorb: Infra is a NEW rail section, not a fold of existing
    // tiles. Database Monitoring only ever lived inside the Traces flyout, so
    // no top-level item disappears when Infra appears — hence `standalone`,
    // which is also what lets it render as a single-child group for now.
    absorbs: [],
    standalone: true,
    // Directly after Traces. Infra reads the same telemetry from the
    // infrastructure side that Traces reads from the request side, so the two
    // sit together; and this is where a user who knew Database Monitoring as a
    // Traces flyout child will look for it first.
    placeAfter: "traces",
    children: [
      // Moved here from the Traces flyout. The routes are always registered
      // (the guard redirects when the feature is off), so the `gate` is what
      // keeps the link out of the menu — and, because it is Infra's only child,
      // what keeps the Infra TILE off the rail entirely (ONavGroup renders
      // nothing when no child survives gating).
      //
      // ONE entry, not two: Databases and Top queries are two views of the same
      // dataset over the same scope, so they are in-page tabs (DbmSectionTabs)
      // rather than sibling destinations. Two flat rail children implied two
      // unrelated pages and made the scope look like it reset between them.
      // `activeOnRoutes` keeps this entry lit on the tab routes and on the
      // query detail page, which are not nav children of their own.
      {
        titleKey: "menu.databases",
        icon: "database",
        name: "dbmDatabases",
        gate: "databaseMonitoring",
        // EVERY in-page tab, not just the first two. Deadlocks and Blocked
        // queries are DbmSectionTabs destinations with no nav child of their
        // own, so omitting them unlit the Databases entry the moment the user
        // opened either tab — the nav said they had left the section they were
        // still standing in.
        //
        // The last three are enterprise-only and their route guards bounce an
        // OSS reader to `dbmDatabases`, so on that build these entries simply
        // never match — this list only decides WHICH ROUTE keeps the entry lit,
        // never whether a route is reachable. Keeping them unconditional keeps
        // one list for both builds; the gate lives in the route, as it does for
        // the section itself.
        activeOnRoutes: [
          "dbmQueries",
          "dbmSamples",
          "dbmQueryDetail",
          "dbmActivity",
          "dbmDeadlocks",
          "dbmBlocking",
          "dbmTableHealth",
        ],
      },
    ],
  },
  {
    key: "experience",
    titleKey: "menu.experience",
    icon: "devices",
    // RUM's route always exists; Synthetics is feature-gated, so land on RUM.
    parentLink: "/rum",
    absorbs: ["rum", "synthetics"],
    children: [
      { titleKey: "menu.rum", title: "RUM", icon: "devices", name: "RUM", requires: "rum" },
      { titleKey: "menu.synthetic", icon: "radar", name: "synthetics", requires: "synthetics" },
    ],
  },
];

/**
 * Top-level links that ALSO reveal their own in-page section nav on hover,
 * keyed by the top-level item's `name`.
 *
 * AI / IAM / Management are intentionally plain links (no rail submenu) — their
 * in-page SectionRail is the place to switch sections. Re-add an entry here
 * (mirroring the page's SectionRail) to restore a hover flyout.
 *
 * Traces: every flyout child targets the Traces page's existing `?tab=` views,
 * keeping one URL and one shared query/stream/time context for all four modes.
 * Service Graph carries the same enterprise gate as its in-page tab.
 */
export const NAV_SUBNAV: Record<string, SubnavChild[]> = {
  traces: [
    {
      titleKey: "traces.spansTab",
      icon: "layers",
      name: "traces",
      tab: "spans",
      defaultForRoute: true,
    },
    {
      titleKey: "menu.traces",
      icon: "account-tree",
      name: "traces",
      tab: "traces",
    },
    {
      titleKey: "menu.serviceGraph",
      icon: "share",
      name: "traces",
      tab: "service-graph",
      gate: "enterprise",
    },
    {
      titleKey: "menu.services",
      icon: "menu-book",
      name: "traces",
      tab: "services-catalog",
    },
    // Databases is NOT here — it moved to the Infra group (see NAV_GROUPS).
    // It sat on this flyout while Database Monitoring was read as a view over
    // the database spans inside these traces. It is not: it reads the database
    // server's own statistics, so it stands up without a single trace and is a
    // destination for a DBA who never opens Traces. Filing it under Traces made
    // it findable only by someone already looking at request traffic.
    //
    // Traces keeps its flyout regardless — Traces / Service Graph / Service
    // Catalog remain three views of the same trace data.
  ],
};

/**
 * Transform the flat `linksList` into rail entries, PRESERVING the input order
 * (which is the main-branch menu order — MainLayout builds it). A group's tile
 * is emitted at the position of its FIRST present absorbed item; the group's
 * other absorbed items are removed. Everything else stays exactly where it was.
 */
export function groupNavLinks(
  links: NavItem[],
  // `raw` brands the key unchanged — the identity fallback for callers with no translator.
  t: TranslateFn = raw,
): RailEntry[] {
  const presentNames = new Set(links.map((l) => l.name));

  // Activate a COLLAPSING group only when it has ≥1 present absorbed item AND
  // ≥2 children (after `requires` filtering): such a group exists to fold tiles
  // that already stand on their own, so with nothing absorbed there is no fold
  // to make, and with one child the flyout would merely duplicate its own tile.
  //
  // A `standalone` group is the other shape — a new rail section whose pages
  // never had a top-level tile (Infra). It absorbs nothing by definition and
  // may legitimately hold a single child, so it only has to keep ≥1 child.
  // `router.hasRoute`/`gate` filtering of children happens later, in the
  // component, which drops the whole tile when nothing survives.
  const groupChildren = new Map<string, SubnavChild[]>();
  const absorbedToGroup = new Map<string, NavGroupDef>();
  for (const def of NAV_GROUPS) {
    const children = def.children.filter((c) => !c.requires || presentNames.has(c.requires));
    const hasAbsorbed = def.absorbs.some((n) => presentNames.has(n));
    if (def.standalone) {
      if (children.length === 0) continue;
    } else if (children.length < 2 || !hasAbsorbed) {
      continue;
    }
    groupChildren.set(def.key, children);
    for (const n of def.absorbs) absorbedToGroup.set(n, def);
  }

  const entryFor = (item: NavItem): RailEntry => {
    const subnav = NAV_SUBNAV[item.name];
    if (subnav && subnav.length > 0) {
      return { type: "linkGroup", item, children: subnav };
    }
    return { type: "link", item };
  };

  // A group is emitted either AFTER its `placeAfter` anchor or in place of its
  // first absorbed item (default). Map anchor → group keys to emit right after
  // it. The anchor is a top-level item `name` or another group's `key`; it only
  // counts when that item is present / that group is active, so a group whose
  // anchor never materialises falls back to default placement.
  //
  // Iterate NAV_GROUPS, not the absorbed-item map: a `standalone` group absorbs
  // nothing and so never appears in that map, and `placeAfter` is the ONLY
  // placement it has — missing it here would drop it to the safety-net append at
  // the foot of the rail. The `groupChildren` guard already skips inactive
  // groups, so this is identical to the old iteration for collapsing groups.
  const anchorExists = (anchor: string) => presentNames.has(anchor) || groupChildren.has(anchor);
  const emitAfter = new Map<string, string[]>();
  for (const def of NAV_GROUPS) {
    if (!groupChildren.has(def.key)) continue;
    if (def.placeAfter && anchorExists(def.placeAfter)) {
      const list = emitAfter.get(def.placeAfter) ?? [];
      if (!list.includes(def.key)) list.push(def.key);
      emitAfter.set(def.placeAfter, list);
    }
  }

  const result: RailEntry[] = [];
  const emittedGroups = new Set<string>();
  const emitGroup = (def: NavGroupDef) => {
    if (emittedGroups.has(def.key)) return;
    emittedGroups.add(def.key);
    result.push({
      type: "linkGroup",
      item: {
        title: t(def.titleKey),
        icon: def.icon,
        link: def.parentLink,
        name: def.key,
      },
      children: groupChildren.get(def.key)!,
    });
    // Groups anchored after THIS group (e.g. Data follows Reliability).
    emitAnchored(def.key);
  };
  const emitAnchored = (anchor: string) => {
    for (const key of emitAfter.get(anchor) ?? []) {
      emitGroup(NAV_GROUPS.find((d) => d.key === key)!);
    }
  };

  for (const item of links) {
    const group = absorbedToGroup.get(item.name);
    if (group) {
      // Absorbed item — drop it. Emit the group here only when it has no
      // (present) `placeAfter` anchor (default first-absorbed placement).
      const usesPlaceAfter = group.placeAfter && anchorExists(group.placeAfter);
      if (!usesPlaceAfter) emitGroup(group);
      continue;
    }
    result.push(entryFor(item));
    emitAnchored(item.name);
  }

  // Safety net: append any active group not yet placed.
  for (const def of NAV_GROUPS) {
    if (groupChildren.has(def.key)) emitGroup(def);
  }

  return result;
}
