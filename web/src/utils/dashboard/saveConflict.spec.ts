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
import {
  comparePanel,
  countChanges,
  diffDashboards,
  formatClockTime,
  formatRelativeTime,
  isPanelTouched,
  mergePanelOntoLatest,
  toEpochMs,
} from "./saveConflict";

const panel = (id: string, title: string, layout = { x: 0, y: 0, w: 96, h: 18, i: 1 }) => ({
  id,
  title,
  type: "line",
  queries: [{ query: `select ${id}` }],
  layout,
});

const base = () => ({
  dashboardId: "d1",
  title: "Ops overview",
  description: "",
  tabs: [
    {
      tabId: "default",
      name: "Overview",
      panels: [
        panel("p1", "Error rate", { x: 0, y: 0, w: 96, h: 18, i: 1 }),
        panel("p2", "Latency", { x: 96, y: 0, w: 96, h: 18, i: 2 }),
      ],
    },
  ],
  variables: { showDynamicFilters: false, list: [{ name: "env", value: "prod" }] },
});

describe("diffDashboards", () => {
  it("lists panels, tabs and variables added, changed and removed by id", () => {
    const latest = base();
    latest.tabs[0].panels[1].title = "Latency p99";
    latest.tabs[0].panels.push(panel("p3", "Disk usage", { x: 0, y: 18, w: 96, h: 18, i: 3 }));
    latest.tabs.push({ tabId: "t2", name: "Database", panels: [] });
    latest.variables.list = [{ name: "region", value: "us" }];

    const { changes, changedSettings } = diffDashboards(base(), latest);

    expect(changes).toEqual(
      expect.arrayContaining([
        {
          kind: "panel",
          change: "changed",
          key: "p2",
          name: "Latency p99",
          previousName: "Latency",
        },
        { kind: "panel", change: "added", key: "p3", name: "Disk usage" },
        { kind: "tab", change: "added", key: "t2", name: "Database" },
        { kind: "variable", change: "added", key: "region", name: "region" },
        { kind: "variable", change: "removed", key: "env", name: "env" },
      ]),
    );
    expect(changes).toHaveLength(5);
    expect(changedSettings).toEqual([]);
  });

  it("does not report a tab as changed when only its panels changed", () => {
    const latest = base();
    latest.tabs[0].panels[0].title = "Errors";
    const { changes } = diffDashboards(base(), latest);
    expect(changes.map((c) => c.kind)).toEqual(["panel"]);
  });

  it("names which dashboard settings changed, ignoring server-managed fields", () => {
    const latest: any = base();
    latest.title = "Renamed";
    latest.description = "Now with SLOs";
    latest.variables.showDynamicFilters = true;
    latest.owner = "someone";
    latest.updatedAt = 123;
    const diff = diffDashboards(base(), latest);
    expect(diff.changes).toEqual([]);
    expect(diff.changedSettings).toEqual(["title", "description", "showDynamicFilters"]);

    latest.refreshInterval = "5m";
    expect(diffDashboards(base(), latest).changedSettings).toContain("other");
  });

  it("records the old name of a renamed tab", () => {
    const latest = base();
    latest.tabs[0].name = "Overview (prod)";
    expect(diffDashboards(base(), latest).changes).toEqual([
      {
        kind: "tab",
        change: "changed",
        key: "default",
        name: "Overview (prod)",
        previousName: "Overview",
      },
    ]);
  });

  it("ignores key order when comparing", () => {
    const latest: any = base();
    const p = latest.tabs[0].panels[0];
    latest.tabs[0].panels[0] = Object.fromEntries(Object.entries(p).reverse());
    expect(diffDashboards(base(), latest).changes).toEqual([]);
  });

  it("counts changes per kind and type", () => {
    const latest = base();
    latest.tabs[0].panels = [];
    const counts = countChanges(diffDashboards(base(), latest).changes);
    expect(counts.panel.removed).toBe(2);
    expect(counts.tab.changed).toBe(0);
  });
});

describe("comparePanel", () => {
  it("shows their title against mine and whether the rest differs", () => {
    const mine = base();
    mine.tabs[0].panels[0].title = "Errors (mine)";
    const latest = base();
    latest.tabs[0].panels[0].title = "Errors (theirs)";
    latest.tabs[0].panels[0].queries = [{ query: "select theirs" }];

    expect(comparePanel(latest, mine, "p1")).toEqual({
      theirsRemoved: false,
      theirsTitle: "Errors (theirs)",
      mineTitle: "Errors (mine)",
      sameTitle: false,
      sameOtherFields: false,
    });
  });

  it("reports a panel they deleted", () => {
    const latest = base();
    latest.tabs[0].panels.shift();
    expect(comparePanel(latest, base(), "p1")).toMatchObject({
      theirsRemoved: true,
      mineTitle: "Error rate",
    });
    expect(comparePanel(latest, base(), undefined)).toBeNull();
  });
});

describe("isPanelTouched", () => {
  it("is true when they edited or removed my panel, never for their additions", () => {
    const latest = base();
    latest.tabs[0].panels[0].title = "Errors";
    const { changes } = diffDashboards(base(), latest);
    expect(isPanelTouched(changes, "p1")).toBe(true);
    expect(isPanelTouched(changes, "p2")).toBe(false);
    expect(isPanelTouched(changes, undefined)).toBe(false);
  });
});

describe("mergePanelOntoLatest", () => {
  it("replaces their copy of my panel in place and keeps their other changes", () => {
    const mine = base();
    mine.tabs[0].panels[0].queries = [{ query: "select mine" }];
    const latest = base();
    latest.tabs[0].panels.push(panel("p3", "Disk usage", { x: 0, y: 18, w: 96, h: 18, i: 3 }));
    latest.tabs[0].panels[1].title = "Latency p99";

    const merged = mergePanelOntoLatest(latest, mine, "p1", base());

    const panels = merged.tabs[0].panels;
    expect(panels.map((p: any) => p.id)).toEqual(["p1", "p2", "p3"]);
    expect(panels[0].queries[0].query).toBe("select mine");
    expect(panels[1].title).toBe("Latency p99");
    expect(latest.tabs[0].panels[0].queries[0].query).toBe("select p1");
  });

  it("moves a new panel below theirs when its slot was taken", () => {
    const mine = base();
    mine.tabs[0].panels.push(panel("pNew", "Mine", { x: 0, y: 18, w: 96, h: 18, i: 3 }));
    const latest = base();
    latest.tabs[0].panels.push(panel("p3", "Theirs", { x: 0, y: 18, w: 96, h: 18, i: 3 }));

    const merged = mergePanelOntoLatest(latest, mine, "pNew", base());
    const added = merged.tabs[0].panels.find((p: any) => p.id === "pNew");

    expect(added.layout).toMatchObject({ x: 0, y: 36, i: 4 });
  });

  it("re-adds my panel when they deleted it, and to the first tab when its tab is gone", () => {
    const mine = base();
    mine.tabs.push({ tabId: "t2", name: "Mine", panels: [panel("p9", "Moved")] });
    const latest = base();
    const merged = mergePanelOntoLatest(latest, mine, "p9", base());
    expect(merged.tabs[0].panels.map((p: any) => p.id)).toContain("p9");
  });

  it("carries my new and edited variables, but not over their edits", () => {
    const mine = base();
    mine.variables.list = [
      { name: "env", value: "staging" },
      { name: "svc", value: "api" },
    ];
    const latest = base();
    const merged = mergePanelOntoLatest(latest, mine, "p1", base());
    expect(merged.variables.list).toEqual([
      { name: "env", value: "staging" },
      { name: "svc", value: "api" },
    ]);

    latest.variables.list = [{ name: "env", value: "theirs" }];
    const kept = mergePanelOntoLatest(latest, mine, "p1", base());
    expect(kept.variables.list[0]).toEqual({ name: "env", value: "theirs" });
  });

  it("returns null when my panel is not in my version", () => {
    expect(mergePanelOntoLatest(base(), base(), "missing", base())).toBeNull();
  });
});

describe("time helpers", () => {
  it("normalises backend microseconds and ignores unset values", () => {
    expect(toEpochMs(1_700_000_000_000_000)).toBe(1_700_000_000_000);
    expect(toEpochMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toEpochMs(0)).toBeNull();
    expect(toEpochMs(undefined)).toBeNull();
  });

  it("formats a past time relative to now", () => {
    const now = Date.UTC(2026, 9, 12, 14, 6);
    expect(formatRelativeTime(now - 4 * 60_000, "en-US", now)).toBe("4 minutes ago");
    expect(formatRelativeTime(now - 2 * 3_600_000, "en-US", now)).toBe("2 hours ago");
    expect(formatRelativeTime(now, "en-US", now)).toBe("now");
  });

  it("adds the date only when the save was not today", () => {
    const now = new Date(2026, 9, 12, 14, 6).getTime();
    expect(formatClockTime(new Date(2026, 9, 12, 14, 2).getTime(), "en-US", now)).toBe("02:02 PM");
    expect(formatClockTime(new Date(2026, 9, 10, 9, 0).getTime(), "en-US", now)).toContain(
      "Oct 10, 2026",
    );
  });
});

// Shapes taken from a real GET /dashboards/{id} response (pt-re-own-2) and the panel editor's state.
const serverPanel = () => ({
  id: "Panel_A",
  type: "table",
  title: "pt-panel-a",
  description: "",
  config: {
    show_legends: true,
    legends_position: null,
    promql_legend: "",
    drilldown: [],
    connect_nulls: false,
    no_value_replacement: "",
  },
  queryType: "sql",
  queries: [
    {
      query: "SELECT 1 as x",
      vrlFunctionQuery: "",
      customQuery: true,
      fields: { stream: "default", stream_type: "logs", x: [], y: [], z: [], breakdown: [] },
      config: { promql_legend: "", limit: 0, time_shift: [] },
    },
  ],
  layout: { x: 0, y: 0, w: 12, h: 8, i: 1 },
  htmlContent: "",
  markdownContent: "",
  customChartContent: "",
});

const serverDashboard = () => ({
  version: 8,
  dashboardId: "ptre2own1",
  title: "pt-re-own-2",
  description: "orig desc",
  role: "",
  owner: "pt@russia.com",
  created: "2026-10-12T10:00:00Z",
  tabs: [{ tabId: "tab-one", name: "TabOne", panels: [serverPanel()] }],
  variables: { list: [], showDynamicFilters: false },
  defaultDatetimeDuration: { type: "relative", relativeTimePeriod: "15m" },
});

describe("real-shaped payloads", () => {
  it("does not report the time range when a teammate saved General settings with only a new name", () => {
    const latest: any = serverDashboard();
    latest.title = "pt-re-own-2 renamed";
    latest.defaultDatetimeDuration = {
      startTime: 1_791_790_000_000_000,
      endTime: 1_791_790_900_000_000,
      relativeTimePeriod: "15m",
      type: "relative",
    };
    expect(diffDashboards(serverDashboard(), latest).changedSettings).toEqual(["title"]);
  });

  it("still reports a real time-range change", () => {
    const relative: any = serverDashboard();
    relative.defaultDatetimeDuration = { type: "relative", relativeTimePeriod: "1h" };
    expect(diffDashboards(serverDashboard(), relative).changedSettings).toEqual([
      "defaultDatetimeDuration",
    ]);

    const absolute: any = serverDashboard();
    absolute.defaultDatetimeDuration = { type: "absolute", startTime: 1, endTime: 2 };
    expect(diffDashboards(serverDashboard(), absolute).changedSettings).toEqual([
      "defaultDatetimeDuration",
    ]);
  });

  it("treats null and missing as the same value", () => {
    const latest: any = serverDashboard();
    delete latest.tabs[0].panels[0].config.legends_position;
    expect(diffDashboards(serverDashboard(), latest).changes).toEqual([]);
  });

  it("says Same when only the title differs from the editor's copy of the panel", () => {
    const editorPanel: any = { ...serverPanel(), version: 8, customChartResult: {} };
    editorPanel.title = "pt-panel-a (mine)";
    editorPanel.config = { ...editorPanel.config, decimals: 2, legends_position: "auto" };
    const latest = serverDashboard();
    latest.tabs[0].panels[0].title = "pt-panel-a (theirs)";
    const mine: any = serverDashboard();
    mine.tabs[0].panels = [editorPanel];

    expect(comparePanel(latest, mine, "Panel_A")).toMatchObject({
      sameTitle: false,
      sameOtherFields: true,
    });
  });

  it("says Different when the query differs", () => {
    const editorPanel: any = { ...serverPanel(), version: 8 };
    editorPanel.queries = [{ ...editorPanel.queries[0], query: "SELECT 2 as x" }];
    const mine: any = serverDashboard();
    mine.tabs[0].panels = [editorPanel];
    expect(comparePanel(serverDashboard(), mine, "Panel_A")?.sameOtherFields).toBe(false);
  });
});
