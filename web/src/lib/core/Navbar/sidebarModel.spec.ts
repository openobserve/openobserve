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

import { describe, expect, it } from "vitest";
import { raw } from "@/types/i18n";
import type { NavGateContext, NavItem, RailEntry, SubnavChild } from "./ONavbar.types";
import { groupNavLinks, NAV_GROUPS, NAV_SUBNAV } from "./navGroups";
import { isGateOpen } from "./useNavGateContext";
import { resolveActiveChild, visibleNavChildren } from "./navChildren";
import { buildSidebarSections, groupContainsActive } from "./sidebarModel";

const link = (name: string, extra: Partial<NavItem> = {}): NavItem => ({
  title: raw(name),
  icon: "home",
  link: `/${name}`,
  name,
  ...extra,
});

// The full enterprise list, in the order MainLayout builds it.
const ENTERPRISE_LINKS = [
  "home",
  "logs",
  "metrics",
  "traces",
  "aiObservability",
  "profiles",
  "rum",
  "synthetics",
  "productAnalytics",
  "pipeline",
  "dashboards",
  "streams",
  "reports",
  "incidentList",
  "workflows",
  "alertList",
  "downtimes",
  "sloList",
  "ingestion",
  "autoobserve",
  "iam",
  "settings",
].map((n) => link(n));

const OSS_LINKS = [
  "home",
  "logs",
  "metrics",
  "traces",
  "rum",
  "productAnalytics",
  "dashboards",
  "streams",
  "reports",
  "alertList",
  "sloList",
  "ingestion",
  "iam",
  "settings",
].map((n) => link(n));

function layout(links: NavItem[], gateOpen: (g: string) => boolean = () => true) {
  const sections = buildSidebarSections(groupNavLinks(links, raw, gateOpen), links);
  return Object.fromEntries(sections.map((s) => [s.key, s.entries.map((e) => e.item.name)]));
}

const ctx = (over: Partial<NavGateContext> = {}): NavGateContext => ({
  isEnterprise: true,
  isCloud: false,
  isMeta: false,
  rbac: true,
  serviceAccount: true,
  orgStorage: false,
  modelPricing: false,
  serviceStreams: true,
  onlineEvals: false,
  oncallEnabled: true,
  databaseMonitoring: true,
  downtimesEnabled: true,
  alertCalibrationEnabled: true,
  fleetEnabled: true,
  hiddenMenus: new Set<string>(),
  features: {},
  ...over,
});

describe("buildSidebarSections", () => {
  it("places every enterprise entry in its section, in the agreed order", () => {
    expect(layout(ENTERPRISE_LINKS)).toEqual({
      top: ["home"],
      explore: ["logs", "metrics", "traces", "profiles"],
      monitor: ["dashboards", "reliability", "infra", "experience"],
      ai: ["aiObservability", "autoobserve"],
      data: ["data"],
      bottom: ["settings", "iam"],
    });
  });

  it("drops the AI section and its items when the edition has none", () => {
    const sections = layout(OSS_LINKS);
    expect(sections.ai).toBeUndefined();
    expect(sections.explore).toEqual(["logs", "metrics", "traces"]);
    expect(sections.monitor).toEqual(["dashboards", "reliability", "infra", "experience"]);
  });

  it("splits Settings and IAM into separate bottom rows", () => {
    const sections = buildSidebarSections(groupNavLinks(ENTERPRISE_LINKS, raw), ENTERPRISE_LINKS);
    const bottom = sections.find((s) => s.key === "bottom")!;
    expect(bottom.entries.map((e) => e.type)).toEqual(["link", "link"]);
  });

  it("keeps a lone absorbed item in the section of its group", () => {
    // Experience forms only with two children, so RUM alone stays a plain link.
    const links = ["home", "rum", "alertList", "streams", "settings"].map((n) => link(n));
    expect(layout(links)).toMatchObject({ monitor: ["reliability", "infra", "rum"] });
  });

  it("puts billing at the bottom and unknown entries in an untitled section", () => {
    const links = [...OSS_LINKS, link("billings"), link("securityOverview")];
    const sections = buildSidebarSections(groupNavLinks(links, raw), links);
    expect(sections.find((s) => s.key === "bottom")!.entries.map((e) => e.item.name)).toEqual([
      "settings",
      "iam",
      "billings",
    ]);
    const more = sections.find((s) => s.key === "more")!;
    expect(more.titleKey).toBeUndefined();
    expect(more.entries.map((e) => e.item.name)).toEqual(["securityOverview"]);
  });

  it("respects gates: a gated-off section child never forms a group", () => {
    const entries: RailEntry[] = groupNavLinks(OSS_LINKS, raw, (g) => g !== "oncall");
    const reliability = entries.find(
      (e) => e.type === "linkGroup" && e.item.name === "reliability",
    );
    expect(
      reliability?.type === "linkGroup" && reliability.children.some((c) => c.gate === "oncall"),
    ).toBe(false);
  });
});

describe("visibleNavChildren", () => {
  const traces = NAV_SUBNAV.traces;
  const hasRoute = () => true;

  it("hides a child whose gate is closed", () => {
    const oss = ctx({ isEnterprise: false });
    const names = visibleNavChildren(traces, oss, hasRoute, {}).map((c) => c.tab);
    expect(names).not.toContain("service-graph");
    expect(isGateOpen(oss, "enterprise")).toBe(false);
  });

  it("drops children named in custom_hide_menus and unregistered routes", () => {
    const data = NAV_GROUPS.find((g) => g.key === "data")!.children;
    const visible = visibleNavChildren(
      data,
      ctx({ hiddenMenus: new Set(["functionList"]) }),
      (name) => name !== "enrichmentTables",
      {},
    ).map((c) => c.name);
    expect(visible).not.toContain("functionList");
    expect(visible).not.toContain("enrichmentTables");
  });

  it("keeps a license-locked child with a lock instead of hiding it", () => {
    const locked = visibleNavChildren(
      traces,
      ctx({ features: { traces: "locked" } }),
      hasRoute,
      {},
    );
    expect(locked.length).toBeGreaterThan(0);
    expect(locked.every((c) => c.licenseLocked)).toBe(true);
  });
});

describe("active group auto-expand", () => {
  const reliability = NAV_GROUPS.find((g) => g.key === "reliability")!.children;
  const paths: Record<string, string> = { alertList: "/alerts", sloList: "/slos" };
  const resolveOn =
    (route: { name: string; path: string; query?: Record<string, string> }) =>
    (list: SubnavChild[]) =>
      resolveActiveChild(list, { query: {}, ...route }, (n) => paths[n] ?? null);

  it("opens the group that holds the current route", () => {
    expect(
      groupContainsActive(reliability, [], resolveOn({ name: "sloList", path: "/slos" })),
    ).toBe(true);
  });

  it("opens on a nested route under a child's path", () => {
    expect(
      groupContainsActive(reliability, [], resolveOn({ name: "sloDetail", path: "/slos/abc" })),
    ).toBe(true);
  });

  it("stays closed elsewhere", () => {
    expect(groupContainsActive(reliability, [], resolveOn({ name: "logs", path: "/logs" }))).toBe(
      false,
    );
  });

  it("opens Traces on its tab route", () => {
    const resolve = resolveOn({ name: "traces", path: "/traces", query: { tab: "service-graph" } });
    expect(resolve(NAV_SUBNAV.traces)?.tab).toBe("service-graph");
  });
});
