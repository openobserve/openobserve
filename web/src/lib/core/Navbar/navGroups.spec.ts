// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { groupNavLinks, NAV_GROUPS, NAV_SUBNAV, GATE_PREDICATES } from "./navGroups";
import type { NavGateContext } from "./ONavbar.types";
import type { NavItem, RailEntry } from "./ONavbar.types";

const link = (name: string, extra: Partial<NavItem> = {}): NavItem => ({
  title: name,
  icon: "x",
  link: `/${name}`,
  name,
  ...extra,
});

function keysOf(entries: RailEntry[]): string[] {
  return entries.map((e) => (e.type === "group" ? `group:${e.key}` : `${e.type}:${e.item.name}`));
}

/**
 * `keysOf` minus the Infra tile. Infra is `standalone` — it absorbs nothing and
 * so is emitted on EVERY rail, including the deliberately tiny fixtures below
 * that exist to pin one other group's placement. Those assertions are about
 * where Data/Reliability/Experience land relative to each other, and threading
 * a constant "linkGroup:infra" through all of them would obscure that. Infra's
 * own placement is asserted directly in its dedicated tests.
 */
function keysWithoutInfra(entries: RailEntry[]): string[] {
  return keysOf(entries).filter((k) => k !== "linkGroup:infra");
}

// Data now renders as a link+subnav group (clicking navigates to /streams).
const dataGroup = (entries: RailEntry[]) =>
  entries.find(
    (e): e is Extract<RailEntry, { type: "linkGroup" }> =>
      e.type === "linkGroup" && e.item.name === "data",
  );

// Infra is standalone — it absorbs nothing, so it appears on every rail rather
// than only when one of its members is present.
const infraGroup = (entries: RailEntry[]) =>
  entries.find(
    (e): e is Extract<RailEntry, { type: "linkGroup" }> =>
      e.type === "linkGroup" && e.item.name === "infra",
  );

describe("groupNavLinks", () => {
  it("preserves the input (main-branch) order", () => {
    const input = [
      link("home"),
      link("logs"),
      link("metrics"),
      link("traces"),
      link("rum"),
      link("dashboards"),
      link("alertList"),
      link("iam"),
      link("settings"),
    ];
    // Output mirrors the input order exactly (no reordering). Only alertList
    // changes shape — it collapses into the Reliability tile in its own slot —
    // and traces, which keeps its slot but gains its NAV_SUBNAV flyout. Infra
    // is the one INSERTION: it absorbs nothing, so it adds a tile rather than
    // replacing one, anchored directly after Traces.
    expect(keysOf(groupNavLinks(input))).toEqual([
      "link:home",
      "link:logs",
      "link:metrics",
      "linkGroup:traces",
      "linkGroup:infra",
      "link:rum",
      "link:dashboards",
      "linkGroup:reliability",
      "link:iam",
      "link:settings",
    ]);
  });

  it("routes every Traces flyout item through the canonical query tab", () => {
    expect(NAV_SUBNAV.traces).toEqual([
      expect.objectContaining({ name: "traces", tab: "spans", defaultForRoute: true }),
      expect.objectContaining({ name: "traces", tab: "traces" }),
      expect.objectContaining({ name: "traces", tab: "service-graph", gate: "enterprise" }),
      expect.objectContaining({ name: "traces", tab: "services-catalog" }),
    ]);
  });

  it("places the Data group right after the Reliability group it is anchored to", () => {
    const entries = groupNavLinks([
      link("home"),
      link("streams"),
      link("alertList"),
      link("incidentList"),
      link("pipeline"),
    ]);
    // alertList/incidentList collapse into Reliability; streams/pipeline into
    // Data, which follows the Reliability TILE rather than landing at the
    // streams slot it would default to.
    expect(keysWithoutInfra(entries)).toEqual([
      "link:home",
      "linkGroup:reliability",
      "linkGroup:data",
    ]);
  });

  it("falls back to default placement when the anchor group is inactive", () => {
    // No alertList → Reliability never forms, so Data cannot follow it and
    // lands at its own first absorbed item instead.
    const entries = groupNavLinks([link("home"), link("streams"), link("pipeline"), link("iam")]);
    expect(keysWithoutInfra(entries)).toEqual(["link:home", "linkGroup:data", "link:iam"]);
  });

  it("puts Data after Reliability on OSS too (no Incidents)", () => {
    const entries = groupNavLinks([
      link("home"),
      link("streams"),
      link("pipeline"),
      link("alertList"),
      link("sloList"),
    ]);
    // Same order as enterprise: the anchor no longer depends on Incidents.
    expect(keysWithoutInfra(entries)).toEqual([
      "link:home",
      "linkGroup:reliability",
      "linkGroup:data",
    ]);
  });

  it("emits the Data group in place of its first absorbed item (no Incidents)", () => {
    const entries = groupNavLinks([
      link("home"),
      link("pipeline"),
      link("dashboards"),
      link("streams"),
      link("ingestion"),
    ]);
    // Data replaces `pipeline` (first absorbed); streams/ingestion are removed;
    // `dashboards` keeps its place after it.
    expect(keysWithoutInfra(entries)).toEqual(["link:home", "linkGroup:data", "link:dashboards"]);
  });

  it("absorbs streams/pipeline/ingestion into Data", () => {
    const entries = groupNavLinks([
      link("home"),
      link("streams"),
      link("pipeline"),
      link("ingestion"),
    ]);
    expect(keysOf(entries)).not.toContain("link:streams");
    expect(keysOf(entries)).not.toContain("link:pipeline");
    expect(keysOf(entries)).not.toContain("link:ingestion");

    const data = dataGroup(entries);
    expect(data).toBeTruthy();
    // Clicking the Data tile navigates to its first item, Streams.
    expect(data?.item.link).toBe("/streams");
    // Streams + pipeline sub-pages (Stream Pipelines / Functions / Enrichment
    // Tables) + ingestion. `logstreams` is the streams route name.
    expect(data?.children.map((c) => c.name)).toEqual([
      "logstreams",
      "pipelines",
      "functionList",
      "enrichmentTables",
      "ingestion",
    ]);
  });

  it("collapses Alerts into Reliability; Reports stays a link when Dashboards is absent", () => {
    const entries = groupNavLinks([link("home"), link("alertList"), link("reports")]);
    // Destinations/Templates ride on alertList, so Alerts alone is already a
    // three-child group — it never renders as a bare link.
    expect(keysOf(entries)).toContain("linkGroup:reliability");
    // Dashboards absent → the Dashboards group has only Reports (1 child) so it
    // doesn't collapse; Reports stays a plain link.
    expect(keysOf(entries)).toContain("link:reports");
  });

  it("groups Alerts, SLOs, Incidents, Destinations and Templates under Reliability", () => {
    // MainLayout splices Incidents between Alerts and SLOs; the Reliability tile
    // takes the first absorbed slot (alertList) and the children keep the order
    // declared in NAV_GROUPS, not the rail order. Destinations and Templates
    // have no rail entry of their own — they ride on alertList.
    const entries = groupNavLinks([
      link("home"),
      link("alertList"),
      link("incidentList"),
      link("sloList"),
    ]);
    expect(keysWithoutInfra(entries)).toEqual(["link:home", "linkGroup:reliability"]);
    const reliability = entries.find(
      (e): e is Extract<RailEntry, { type: "linkGroup" }> =>
        e.type === "linkGroup" && e.item.name === "reliability",
    );
    // Clicking the tile lands on Alerts (always-present route).
    expect(reliability?.item.link).toBe("/alerts");
    expect(reliability?.children.map((c) => c.name)).toEqual([
      "alertList",
      "sloList",
      "incidentList",
      "alertDestinations",
      "alertTemplates",
      "alertSources",
    ]);
  });

  it("drops Incidents from Reliability on OSS (no incidents route)", () => {
    const entries = groupNavLinks([link("home"), link("alertList"), link("sloList")]);
    expect(keysWithoutInfra(entries)).toEqual(["link:home", "linkGroup:reliability"]);
    const reliability = entries.find(
      (e): e is Extract<RailEntry, { type: "linkGroup" }> =>
        e.type === "linkGroup" && e.item.name === "reliability",
    );
    expect(reliability?.children.map((c) => c.name)).toEqual([
      "alertList",
      "sloList",
      "alertDestinations",
      "alertTemplates",
    ]);
  });

  it("still groups Alerts with its Destinations/Templates when SLOs and Incidents are hidden", () => {
    const entries = groupNavLinks([link("home"), link("alertList")]);
    expect(keysWithoutInfra(entries)).toEqual(["link:home", "linkGroup:reliability"]);
    const reliability = entries.find(
      (e): e is Extract<RailEntry, { type: "linkGroup" }> =>
        e.type === "linkGroup" && e.item.name === "reliability",
    );
    expect(reliability?.children.map((c) => c.name)).toEqual([
      "alertList",
      "alertDestinations",
      "alertTemplates",
    ]);
  });

  it("takes Destinations/Templates away with Alerts when alertList is hidden, but keeps Alert Sources (requires incidentList)", () => {
    // Destinations/Templates carry `requires: "alertList"`, so hiding Alerts via
    // custom_hide_menus must not leave their plumbing behind in the flyout.
    // Alert Sources requires `incidentList` instead — it rides on Incidents,
    // not Alerts, so it survives here.
    const entries = groupNavLinks([link("home"), link("sloList"), link("incidentList")]);
    const reliability = entries.find(
      (e): e is Extract<RailEntry, { type: "linkGroup" }> =>
        e.type === "linkGroup" && e.item.name === "reliability",
    );
    expect(reliability?.children.map((c) => c.name)).toEqual([
      "sloList",
      "incidentList",
      "alertSources",
    ]);
  });

  it("keeps SLOs a plain link when Alerts and Incidents are hidden", () => {
    expect(keysWithoutInfra(groupNavLinks([link("home"), link("sloList")]))).toEqual([
      "link:home",
      "link:sloList",
    ]);
  });

  it("groups Incidents with Alert Sources when Incidents is the only other reliability item present", () => {
    // Alert Sources requires incidentList, so Incidents is never really
    // "alone" once Incidents is enabled — it always has Alert Sources riding
    // alongside it, and 2 children is enough to collapse into a group.
    const entries = groupNavLinks([link("home"), link("incidentList")]);
    expect(keysWithoutInfra(entries)).toEqual(["link:home", "linkGroup:reliability"]);
    const reliability = entries.find(
      (e): e is Extract<RailEntry, { type: "linkGroup" }> =>
        e.type === "linkGroup" && e.item.name === "reliability",
    );
    expect(reliability?.children.map((c) => c.name)).toEqual(["incidentList", "alertSources"]);
  });

  it("moves Reports under the Dashboards group", () => {
    const entries = groupNavLinks([
      link("home"),
      link("dashboards"),
      link("reports"),
      link("alertList"),
    ]);
    // Reports is absorbed; the Dashboards tile takes the dashboards slot.
    expect(keysWithoutInfra(entries)).toEqual([
      "link:home",
      "linkGroup:dashboards",
      "linkGroup:reliability",
    ]);
    const dash = entries.find(
      (e): e is Extract<RailEntry, { type: "linkGroup" }> =>
        e.type === "linkGroup" && e.item.name === "dashboards",
    );
    expect(dash?.item.link).toBe("/dashboards");
    expect(dash?.children.map((c) => c.name)).toEqual(["dashboards", "reports"]);
  });

  it("keeps Dashboards a plain link when Reports is absent", () => {
    const entries = groupNavLinks([link("home"), link("dashboards")]);
    expect(keysWithoutInfra(entries)).toEqual(["link:home", "link:dashboards"]);
  });

  it("groups RUM and Synthetics under the Experience tile", () => {
    const entries = groupNavLinks([
      link("home"),
      link("rum"),
      link("synthetics"),
      link("alertList"),
    ]);
    // rum/synthetics are absorbed; the Experience tile takes rum's slot.
    expect(keysWithoutInfra(entries)).toEqual([
      "link:home",
      "linkGroup:experience",
      "linkGroup:reliability",
    ]);
    const experience = entries.find(
      (e): e is Extract<RailEntry, { type: "linkGroup" }> =>
        e.type === "linkGroup" && e.item.name === "experience",
    );
    // Clicking the tile lands on RUM (always-present route).
    expect(experience?.item.link).toBe("/rum");
    // Children navigate by route name: RUM + synthetics.
    expect(experience?.children.map((c) => c.name)).toEqual(["RUM", "synthetics"]);
  });

  it("keeps RUM a plain link when Synthetics is absent", () => {
    // Synthetics is feature-gated; with only RUM present the Experience group has
    // a single child, so it doesn't collapse and RUM stays a plain link.
    const entries = groupNavLinks([link("home"), link("rum"), link("dashboards")]);
    expect(keysWithoutInfra(entries)).toEqual(["link:home", "link:rum", "link:dashboards"]);
    // No COLLAPSING group formed. Infra is excluded: it is standalone, so its
    // presence says nothing about whether Experience collapsed.
    expect(entries.some((e) => e.type === "linkGroup" && e.item.name !== "infra")).toBe(false);
  });

  it("only includes Data children whose required top-level item is present", () => {
    const entries = groupNavLinks([link("home"), link("pipeline")]);
    const data = dataGroup(entries);
    // ingestion / reports absent → only the pipeline sub-pages remain.
    expect(data?.children.map((c) => c.name)).toEqual([
      "pipelines",
      "functionList",
      "enrichmentTables",
    ]);
  });

  it("drops the Data group entirely when no data items are present", () => {
    const entries = groupNavLinks([link("home"), link("logs")]);
    expect(dataGroup(entries)).toBeUndefined();
    // Infra is the only group left standing — it is standalone, so it does not
    // depend on any data item being present.
    expect(entries.every((e) => e.type === "link" || e.item.name === "infra")).toBe(true);
  });

  it("renders AI / IAM / Management as plain links (no submenu)", () => {
    const entries = groupNavLinks([
      link("home"),
      link("aiObservability"),
      link("iam"),
      link("settings"),
    ]);
    expect(keysWithoutInfra(entries)).toEqual([
      "link:home",
      "link:aiObservability",
      "link:iam",
      "link:settings",
    ]);
    // None of THEM carry a hover submenu anymore (Infra is a group by design,
    // and is not one of the items under test here).
    expect(entries.some((e) => e.type === "linkGroup" && e.item.name !== "infra")).toBe(false);
    // Traces is still the only top-level LINK with a subnav flyout — Infra's
    // flyout comes from NAV_GROUPS, not from a top-level item.
    expect(Object.keys(NAV_SUBNAV)).toEqual(["traces"]);
  });

  it("emits Infra as a link+subnav tile carrying Database Monitoring", () => {
    const entries = groupNavLinks([link("home"), link("traces")]);
    const infra = infraGroup(entries);
    expect(infra).toBeTruthy();
    // Clicking the tile lands on Database Monitoring — Infra's only destination.
    // Under `/infra/`, not the `/traces/` prefix it shipped with: the section
    // is Infra's, and the URL now agrees with the rail. `/traces/databases`
    // still resolves via the redirect registered in router.ts.
    expect(infra?.item.link).toBe("/infra/databases");
    expect(infra?.children.map((c) => c.name)).toEqual(["dbmDatabases"]);
  });

  it("anchors Infra directly after Traces", () => {
    const entries = groupNavLinks([link("home"), link("traces"), link("rum")]);
    expect(keysOf(entries)).toEqual([
      "link:home",
      "linkGroup:traces",
      "linkGroup:infra",
      "link:rum",
    ]);
  });

  it("no longer offers Databases on the Traces flyout", () => {
    // Databases moved to Infra; Traces keeps its three trace-data views.
    expect(NAV_SUBNAV.traces.map((c) => c.name)).toEqual([
      "traces",
      "serviceGraph",
      "servicesCatalog",
    ]);
    expect(NAV_SUBNAV.traces.some((c) => c.name === "dbmDatabases")).toBe(false);
  });

  it("emits Infra even though it absorbs nothing and has a single child", () => {
    // The ≥2-children / hasAbsorbed rule that collapses the other groups would
    // silently drop Infra; `standalone` is the explicit opt-out. Without it this
    // tile never renders at all.
    const infra = NAV_GROUPS.find((g) => g.key === "infra");
    expect(infra?.standalone).toBe(true);
    expect(infra?.absorbs).toEqual([]);
    expect(infra?.children).toHaveLength(1);
    expect(infraGroup(groupNavLinks([link("home"), link("traces")]))).toBeTruthy();
  });

  it("keeps the ≥2-children rule for every group that is NOT standalone", () => {
    // The opt-out must stay narrow: relaxing the rule globally would let any
    // group degenerate into a one-item flyout once its members are hidden.
    // RUM alone (Synthetics hidden) still leaves Experience uncollapsed.
    const entries = groupNavLinks([link("home"), link("rum")]);
    expect(keysOf(entries)).toContain("link:rum");
    expect(entries.some((e) => e.type === "linkGroup" && e.item.name === "experience")).toBe(false);
    for (const g of NAV_GROUPS) {
      if (!g.standalone) expect(g.absorbs.length).toBeGreaterThan(0);
    }
  });

  it("still emits Infra when Traces is hidden (anchor absent → default placement)", () => {
    // custom_hide_menus can remove Traces. Infra absorbs nothing, so it has no
    // first-absorbed slot to fall back to and lands via the safety net — it must
    // still appear, since Database Monitoring does not depend on Traces.
    const entries = groupNavLinks([link("home"), link("logs")]);
    expect(infraGroup(entries)).toBeTruthy();
    expect(keysOf(entries)).toEqual(["link:home", "link:logs", "linkGroup:infra"]);
  });

  it("keeps Database Monitoring's gate and every activeOnRoutes entry intact after the move", () => {
    const dbm = NAV_GROUPS.find((g) => g.key === "infra")?.children.find(
      (c) => c.name === "dbmDatabases",
    );
    // The gate is the ONLY thing keeping the link out of a build with the
    // feature off (the routes are always registered), so losing it in the move
    // would expose the section everywhere.
    expect(dbm?.gate).toBe("databaseMonitoring");
    expect(dbm?.icon).toBe("database");
    expect(dbm?.titleKey).toBe("menu.databases");
    // Every DbmSectionTabs destination, so the entry stays lit across all tabs.
    expect(dbm?.activeOnRoutes).toEqual([
      "dbmQueries",
      "dbmSamples",
      "dbmQueryDetail",
      "dbmActivity",
      "dbmDeadlocks",
      "dbmBlocking",
      "dbmTableHealth",
    ]);
  });

  // The list above is only correct while it covers every tab DbmSectionTabs can
  // navigate to. Asserting the literal array pins what it IS; this pins what it
  // must CONTAIN, so adding a tab to the strip without adding it here fails
  // rather than silently unlighting Infra the moment a user opens that tab —
  // the bug `dbmSamples` was already causing before it was added.
  it("covers every DbmSectionTabs destination in activeOnRoutes", () => {
    const dbm = NAV_GROUPS.find((g) => g.key === "infra")?.children.find(
      (c) => c.name === "dbmDatabases",
    );
    // `dbmDatabases` is the entry's own `name`, so it is lit without listing.
    const tabRoutes = [
      "dbmQueries",
      "dbmSamples",
      "dbmActivity",
      "dbmDeadlocks",
      "dbmBlocking",
      "dbmTableHealth",
    ];
    for (const name of tabRoutes) {
      expect(dbm?.activeOnRoutes).toContain(name);
    }
  });

  it("keeps unknown/new items as plain links in place", () => {
    const entries = groupNavLinks([link("home"), link("somethingNew")]);
    expect(keysWithoutInfra(entries)).toEqual(["link:home", "link:somethingNew"]);
  });

  it("does not lose any non-absorbed item", () => {
    // incidentList collapses into linkGroup:reliability here (Alert Sources
    // rides alongside it, requires: incidentList, ≥2 children collapses) — it
    // surfaces as a linkGroup child, not a top-level link, so it's excluded
    // from the top-level "surfaced" set the same way absorbed items are.
    const input = [
      link("home"),
      link("logs"),
      link("rum"),
      link("aiObservability"),
      link("incidentList"),
      link("actionScripts"),
      link("iam"),
      link("settings"),
    ];
    const entries = groupNavLinks(input);
    const surfaced = entries.flatMap((e) =>
      e.type === "group" || e.type === "linkGroup" ? [] : [e.item.name],
    );
    const expectedNonCollapsed = input.map((i) => i.name).filter((n) => n !== "incidentList");
    expect(surfaced.sort()).toEqual(expectedNonCollapsed.sort());

    const reliability = entries.find(
      (e): e is Extract<RailEntry, { type: "linkGroup" }> =>
        e.type === "linkGroup" && e.item.name === "reliability",
    );
    expect(reliability?.children.map((c) => c.name)).toContain("incidentList");
  });

  it("every group's absorbs/members are internally consistent", () => {
    for (const g of NAV_GROUPS) {
      // Each child marked `requires` should require one of the absorbed names.
      for (const c of g.children) {
        if (c.requires) expect(g.absorbs).toContain(c.requires);
      }
    }
  });

  it("every subnav `gate` references a real predicate", () => {
    for (const children of Object.values(NAV_SUBNAV)) {
      for (const c of children) {
        if (c.gate) expect(GATE_PREDICATES[c.gate]).toBeTypeOf("function");
      }
    }
  });
});

describe("GATE_PREDICATES", () => {
  const ctx = (over: Partial<NavGateContext> = {}): NavGateContext => ({
    isEnterprise: false,
    isCloud: false,
    isMeta: false,
    rbac: false,
    serviceAccount: true,
    orgStorage: false,
    modelPricing: false,
    serviceStreams: true,
    onlineEvals: false,
    databaseMonitoring: false,
    hiddenMenus: new Set<string>(),
    ...over,
  });

  it("databaseMonitoring gates on the runtime flag ALONE — it is an OSS feature", () => {
    expect(GATE_PREDICATES.databaseMonitoring(ctx({ databaseMonitoring: true }))).toBe(true);
    // The point of the test: an OSS build with the flag on must still show it.
    expect(
      GATE_PREDICATES.databaseMonitoring(ctx({ databaseMonitoring: true, isEnterprise: false })),
    ).toBe(true);
    expect(GATE_PREDICATES.databaseMonitoring(ctx({ isEnterprise: true }))).toBe(false);
    expect(GATE_PREDICATES.databaseMonitoring(ctx())).toBe(false);
  });

  it("enterpriseMeta (e.g. Nodes) needs BOTH enterprise and meta-org", () => {
    expect(GATE_PREDICATES.enterpriseMeta(ctx({ isEnterprise: true, isMeta: true }))).toBe(true);
    expect(GATE_PREDICATES.enterpriseMeta(ctx({ isEnterprise: true }))).toBe(false);
    expect(GATE_PREDICATES.enterpriseMeta(ctx({ isMeta: true }))).toBe(false);
    // OSS non-meta (the reported "I see Nodes but the page doesn't" case) → hidden.
    expect(GATE_PREDICATES.enterpriseMeta(ctx())).toBe(false);
  });

  it("rbac (IAM Groups/Roles) accepts enterprise OR cloud, plus rbac flag", () => {
    expect(GATE_PREDICATES.rbac(ctx({ isCloud: true, rbac: true }))).toBe(true);
    expect(GATE_PREDICATES.rbac(ctx({ isEnterprise: true, rbac: true }))).toBe(true);
    expect(GATE_PREDICATES.rbac(ctx({ rbac: true }))).toBe(false);
    expect(GATE_PREDICATES.rbac(ctx({ isEnterprise: true }))).toBe(false);
  });

  it("storage is enterprise, and on cloud also requires org_storage_enabled", () => {
    expect(GATE_PREDICATES.storage(ctx({ isEnterprise: true }))).toBe(true); // self-hosted
    expect(GATE_PREDICATES.storage(ctx({ isEnterprise: true, isCloud: true }))).toBe(false);
    expect(
      GATE_PREDICATES.storage(ctx({ isEnterprise: true, isCloud: true, orgStorage: true })),
    ).toBe(true);
  });

  it("streamPipelines hides only when custom_hide_menus lists 'pipelines'", () => {
    expect(GATE_PREDICATES.streamPipelines(ctx())).toBe(true);
    expect(GATE_PREDICATES.streamPipelines(ctx({ hiddenMenus: new Set(["pipelines"]) }))).toBe(
      false,
    );
  });
});
