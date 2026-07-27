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

// Data now renders as a link+subnav group (clicking navigates to /streams).
const dataGroup = (entries: RailEntry[]) =>
  entries.find(
    (e): e is Extract<RailEntry, { type: "linkGroup" }> =>
      e.type === "linkGroup" && e.item.name === "data",
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
    // Output mirrors the input order exactly (no reordering).
    expect(keysOf(groupNavLinks(input))).toEqual(input.map((i) => `link:${i.name}`));
  });

  it("places the Data group right after Incidents when present", () => {
    const entries = groupNavLinks([
      link("home"),
      link("streams"),
      link("alertList"),
      link("incidentList"),
      link("pipeline"),
    ]);
    // streams/pipeline are absorbed; Data is emitted after incidentList.
    expect(keysOf(entries)).toEqual([
      "link:home",
      "link:alertList",
      "link:incidentList",
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
    expect(keysOf(entries)).toEqual(["link:home", "linkGroup:data", "link:dashboards"]);
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

  it("keeps Alerts separate; Reports stays a link when Dashboards is absent", () => {
    const entries = groupNavLinks([link("home"), link("alertList"), link("reports")]);
    expect(keysOf(entries)).toContain("link:alertList");
    // Dashboards absent → the Dashboards group has only Reports (1 child) so it
    // doesn't collapse; Reports stays a plain link.
    expect(keysOf(entries)).toContain("link:reports");
    expect(entries.some((e) => e.type === "linkGroup")).toBe(false);
  });

  it("moves Reports under the Dashboards group", () => {
    const entries = groupNavLinks([
      link("home"),
      link("dashboards"),
      link("reports"),
      link("alertList"),
    ]);
    // Reports is absorbed; the Dashboards tile takes the dashboards slot.
    expect(keysOf(entries)).toEqual(["link:home", "linkGroup:dashboards", "link:alertList"]);
    const dash = entries.find(
      (e): e is Extract<RailEntry, { type: "linkGroup" }> =>
        e.type === "linkGroup" && e.item.name === "dashboards",
    );
    expect(dash?.item.link).toBe("/dashboards");
    expect(dash?.children.map((c) => c.name)).toEqual(["dashboards", "reports"]);
  });

  it("keeps Dashboards a plain link when Reports is absent", () => {
    const entries = groupNavLinks([link("home"), link("dashboards")]);
    expect(keysOf(entries)).toEqual(["link:home", "link:dashboards"]);
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
    expect(entries.every((e) => e.type === "link")).toBe(true);
  });

  it("renders AI / IAM / Management as plain links (no submenu)", () => {
    const entries = groupNavLinks([
      link("home"),
      link("aiObservability"),
      link("iam"),
      link("settings"),
    ]);
    expect(keysOf(entries)).toEqual([
      "link:home",
      "link:aiObservability",
      "link:iam",
      "link:settings",
    ]);
    // None of them carry a hover submenu anymore.
    expect(entries.some((e) => e.type === "linkGroup")).toBe(false);
    expect(NAV_SUBNAV).toEqual({});
  });

  it("keeps unknown/new items as plain links in place", () => {
    const entries = groupNavLinks([link("home"), link("somethingNew")]);
    expect(keysOf(entries)).toEqual(["link:home", "link:somethingNew"]);
  });

  it("does not lose any non-absorbed item", () => {
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
    const surfaced = entries.flatMap((e) => (e.type === "group" ? [] : [e.item.name]));
    expect(surfaced.sort()).toEqual(input.map((i) => i.name).sort());
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
    hiddenMenus: new Set<string>(),
    ...over,
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
