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

// Bundled Host Metrics dashboard invariants (4.1/§6) — fast mirror of the Rust serde parse oracle.

import { describe, it, expect } from "vitest";
import { gt } from "@/types/i18n";
import { getUnitOptions } from "@/composables/dashboard/useColumnFormatting";
import dashboard from "./host_metrics.dashboard.json";

// The 4.1 device-exclusion constant — ONE matcher, no spaces (the shipped bug matched nothing).
const DEVICE_EXCLUSION = "/dev/loop.*|tmpfs|nsfs|squashfs|overlay";
// The disk I/O panels carry their own loop-device exclusion (4.1 Disk tab).
const DISK_IO_EXCLUSION = "loop.*";

const TAB_IDS = ["overview", "cpu", "memory", "disk", "network"];
const PER_TAB_PANEL_COUNTS: Record<string, number> = {
  overview: 10,
  cpu: 3,
  memory: 3,
  disk: 6,
  network: 3,
};

const doc: any = dashboard;
const tabs: any[] = doc.tabs ?? [];
const allPanels: any[] = tabs.flatMap((t: any) => t.panels ?? []);
const allQueries = (panel: any): any[] => panel.queries ?? [];
const allQueryStrings: string[] = allPanels.flatMap((p) =>
  allQueries(p).map((q: any) => q.query as string),
);

// Every =~ / !~ matcher (label, operator, value) in a PromQL string.
const regexMatchers = (query: string): Array<{ label: string; op: string; value: string }> => {
  const out: Array<{ label: string; op: string; value: string }> = [];
  const re = /([a-zA-Z_][a-zA-Z0-9_]*)\s*(=~|!~)\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query)) !== null) out.push({ label: m[1], op: m[2], value: m[3] });
  return out;
};

describe("host_metrics.dashboard.json — document shape", () => {
  it("is a v8 document titled 'Host Metrics'", () => {
    expect(doc.version).toBe(8);
    // Title identity is what dedupes against the shipped gallery copy (4.1).
    expect(doc.title).toBe("Host Metrics");
  });

  it("has 5 tabs with unique tabIds", () => {
    expect(tabs.map((t) => t.tabId)).toEqual(TAB_IDS);
    expect(new Set(tabs.map((t) => t.tabId)).size).toBe(tabs.length);
  });

  it("has 25 panels total with per-tab counts 10/3/3/6/3", () => {
    expect(allPanels).toHaveLength(25);
    for (const tab of tabs) {
      expect(tab.panels, `tab ${tab.tabId}`).toHaveLength(PER_TAB_PANEL_COUNTS[tab.tabId]);
    }
  });

  it("keeps the description free of variable syntax (no $)", () => {
    expect(doc.description).not.toContain("$");
  });
});

describe("host_metrics.dashboard.json — panels", () => {
  it("every panel is promql with customQuery", () => {
    for (const p of allPanels) {
      expect(p.queryType, p.id).toBe("promql");
      for (const q of allQueries(p)) expect(q.customQuery, p.id).toBe(true);
    }
  });

  it("every query carries the host_name=~\"$host_name\" matcher", () => {
    for (const q of allQueryStrings) {
      expect(q).toContain('host_name=~"$host_name"');
    }
  });

  it("has no whitespace anywhere inside any =~/!~ matcher value", () => {
    // Generalized regression for the shipped `device!~"tmpfs | nsfs"` bug.
    for (const q of allQueryStrings) {
      for (const m of regexMatchers(q)) {
        expect(m.value, `${m.label}${m.op}"${m.value}" in ${q}`).not.toMatch(/\s/);
      }
    }
  });

  it("uses only the 4.1 device-exclusion constants, verbatim", () => {
    const exclusions = allQueryStrings
      .flatMap((q) => regexMatchers(q))
      .filter((m) => m.label === "device" && m.op === "!~")
      .map((m) => m.value);
    expect(exclusions.length).toBeGreaterThan(0);
    for (const value of exclusions) {
      expect([DEVICE_EXCLUSION, DISK_IO_EXCLUSION]).toContain(value);
    }
    // The filesystem exclusion (the bug fix) must actually be in use.
    expect(exclusions).toContain(DEVICE_EXCLUSION);
  });

  it("every panel has a non-null config.unit from the unit option set", () => {
    const known = new Set(
      getUnitOptions(gt)
        .map((o) => o.value)
        .filter((v): v is string => v != null),
    );
    for (const p of allPanels) {
      expect(p.config.unit, p.id).not.toBeNull();
      expect(known.has(p.config.unit), `${p.id} unit ${p.config.unit}`).toBe(true);
    }
  });

  it("every chart panel has a custom logs drilldown carrying ${host_name:singlequote}", () => {
    // Auto mode cannot carry the host from a PromQL panel (3.5) — custom only.
    const chartPanels = allPanels.filter((p) => p.type !== "metric");
    expect(chartPanels.length).toBeGreaterThan(0);
    for (const p of chartPanels) {
      const logs = (p.config.drilldown ?? []).filter((d: any) => d.type === "logs");
      expect(logs.length, p.id).toBeGreaterThan(0);
      for (const d of logs) {
        expect(d.data.logsMode, p.id).toBe("custom");
        expect(d.data.logsQuery, p.id).toContain("${host_name:singlequote}");
      }
    }
  });

  it("every layout sits inside the 192-column grid", () => {
    for (const p of allPanels) {
      expect(p.layout.x, p.id).toBeGreaterThanOrEqual(0);
      expect(p.layout.w, p.id).toBeGreaterThan(0);
      expect(p.layout.x + p.layout.w, p.id).toBeLessThanOrEqual(192);
    }
  });

  it("the Disk tab contains exactly one table panel (current filesystem % triage)", () => {
    const disk = tabs.find((t) => t.tabId === "disk");
    expect(disk.panels.filter((p: any) => p.type === "table")).toHaveLength(1);
  });

  it("exactly the four Overview by-host line panels wrap their query in topk(10, …)", () => {
    const overview = tabs.find((t) => t.tabId === "overview");
    const overviewLines = overview.panels.filter((p: any) => p.type === "line");
    expect(overviewLines).toHaveLength(4);
    for (const p of overviewLines) {
      for (const q of allQueries(p)) {
        expect(q.query, p.id).toMatch(/^topk\(10,/);
        // topk applies AFTER the matcher, so filtering still composes.
        expect(q.query, p.id).toContain('host_name=~"$host_name"');
      }
    }
    const others = allPanels.filter((p) => !overviewLines.includes(p));
    for (const p of others) {
      for (const q of allQueries(p)) expect(q.query, p.id).not.toContain("topk(");
    }
  });
});

describe("host_metrics.dashboard.json — variables", () => {
  it("declares exactly host_name, mountpoint, device as multi-select query_values with Select All", () => {
    const list = doc.variables.list;
    expect(list.map((v: any) => v.name)).toEqual(["host_name", "mountpoint", "device"]);
    for (const v of list) {
      expect(v.type, v.name).toBe("query_values");
      expect(v.multiSelect, v.name).toBe(true);
      // "all" is what makes the day-one dashboard render every host (3.3).
      expect(v.selectAllValueForMultiSelect, v.name).toBe("all");
    }
  });

  it("chains mountpoint and device to $host_name via IN filters", () => {
    const list = doc.variables.list;
    for (const name of ["mountpoint", "device"]) {
      const v = list.find((x: any) => x.name === name);
      expect(v.query_data.filter, name).toEqual([
        { name: "host_name", operator: "IN", value: "$host_name" },
      ]);
    }
    const host = list.find((x: any) => x.name === "host_name");
    expect(host.query_data.filter).toEqual([]);
  });

  it("enables the ad-hoc dynamic filters bar", () => {
    expect(doc.variables.showDynamicFilters).toBe(true);
  });
});

describe("host_metrics.dashboard.json — v8 serde-required keys", () => {
  // v8 structs have no serde defaults: one missing key rejects the whole POST (4.1).
  it("every tab carries tabId and name", () => {
    for (const t of tabs) {
      expect(typeof t.tabId).toBe("string");
      expect(typeof t.name).toBe("string");
    }
  });

  it("every panel carries id/type/title/description/config/queries and config.show_legends", () => {
    for (const p of allPanels) {
      expect(typeof p.id).toBe("string");
      expect(typeof p.type).toBe("string");
      expect(typeof p.title).toBe("string");
      expect(typeof p.description).toBe("string");
      expect(p.config, p.id).toBeTypeOf("object");
      expect(typeof p.config.show_legends, p.id).toBe("boolean");
      expect(Array.isArray(p.queries), p.id).toBe(true);
      expect(p.queries.length, p.id).toBeGreaterThan(0);
    }
  });

  it("every query carries promql_legend (string), customQuery and full fields", () => {
    for (const p of allPanels) {
      for (const q of allQueries(p)) {
        expect(typeof q.config.promql_legend, p.id).toBe("string");
        expect(typeof q.customQuery, p.id).toBe("boolean");
        expect(typeof q.fields.stream, p.id).toBe("string");
        expect(typeof q.fields.stream_type, p.id).toBe("string");
        expect(Array.isArray(q.fields.x), p.id).toBe(true);
        expect(Array.isArray(q.fields.y), p.id).toBe(true);
        expect(q.fields.filter, p.id).toBeTypeOf("object");
      }
    }
  });
});
