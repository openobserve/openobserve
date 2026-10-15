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
import { SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
import {
  expandRepeatTabs,
  expandRepeats,
  readableTemplate,
  resolveSelectedTab,
  findRepeatVariable,
  formatRepeatTitle,
  getRepeatId,
  getRepeatSourceId,
  getRepeatableVariables,
  layoutRepeatCopies,
  needsAllValuesFetch,
  parseRepeatId,
  pinRepeatValue,
  resolveRepeatValues,
  splitRepeatTitle,
} from "./repeatByVariable";

const hostVar = (value: any, extra: Record<string, any> = {}) => ({
  name: "host",
  type: "query_values",
  scope: "global",
  multiSelect: true,
  value,
  options: [
    { label: "api", value: "api" },
    { label: "web", value: "web" },
    { label: "db", value: "db" },
  ],
  ...extra,
});

const panel = (id: string, layout: any, repeat?: any) => ({ id, layout, repeat });

describe("repeat ids", () => {
  it("builds and parses virtual ids", () => {
    const id = getRepeatId("Panel_1", "web-03");
    expect(id).toBe("Panel_1__r__web-03");
    expect(parseRepeatId(id)).toEqual({ sourceId: "Panel_1", value: "web-03" });
    expect(getRepeatSourceId(id)).toBe("Panel_1");
  });

  it("keeps a value that itself contains the separator", () => {
    expect(parseRepeatId("p1__r__a__r__b")).toEqual({ sourceId: "p1", value: "a__r__b" });
  });

  it("treats a plain id as its own source", () => {
    expect(parseRepeatId("Panel_1")).toBeNull();
    expect(getRepeatSourceId("Panel_1")).toBe("Panel_1");
  });
});

describe("eligible variables", () => {
  it("keeps only global/tab multi-select query_values and custom variables", () => {
    const list = [
      hostVar(["api"]),
      hostVar(["api"], { scope: "tabs" }),
      { name: "region", type: "custom", scope: "tabs", multiSelect: true },
      { name: "single", type: "query_values", scope: "global", multiSelect: false },
      { name: "panelVar", type: "custom", scope: "panels", multiSelect: true },
      { name: "text", type: "textbox", scope: "global", multiSelect: true },
    ];
    expect(getRepeatableVariables(list).map((v) => v.name)).toEqual(["host", "region"]);
  });

  it("prefers the tab-scoped copy of a name over the global one", () => {
    const list = [
      hostVar(["api"]),
      hostVar(["db"], { scope: "tabs" }),
      hostVar(["x"], { scope: "panels" }),
    ];
    expect(findRepeatVariable(list, "host").value).toEqual(["db"]);
  });
});

describe("resolveRepeatValues", () => {
  it("returns the selected values in order", () => {
    expect(resolveRepeatValues(hostVar(["web", "api"]))).toEqual({
      values: ["web", "api"],
      total: 2,
    });
  });

  it("expands All to the option list", () => {
    expect(resolveRepeatValues(hostVar([SELECT_ALL_VALUE]))).toEqual({
      values: ["api", "web", "db"],
      total: 3,
    });
  });

  it("caps at 50 and reports the full total", () => {
    const options = Array.from({ length: 132 }, (_, i) => ({ label: `h${i}`, value: `h${i}` }));
    const resolved = resolveRepeatValues(hostVar([SELECT_ALL_VALUE], { options }));
    expect(resolved?.values).toHaveLength(50);
    expect(resolved?.values[49]).toBe("h49");
    expect(resolved?.total).toBe(132);
  });

  it("returns null for a variable that cannot repeat", () => {
    expect(resolveRepeatValues(hostVar("api", { multiSelect: false }))).toBeNull();
    expect(resolveRepeatValues(undefined)).toBeNull();
  });

  it("returns no values for an empty selection", () => {
    expect(resolveRepeatValues(hostVar([]))).toEqual({ values: [], total: 0 });
  });
});

describe("All beyond the loaded options", () => {
  const tenOptions = Array.from({ length: 10 }, (_, i) => ({ label: `e${i}`, value: `e${i}` }));
  const endpoint = (extra: Record<string, any> = {}) =>
    hostVar([SELECT_ALL_VALUE], {
      name: "ep",
      options: tenOptions,
      query_data: { stream: "cart_api", field: "endpoint", stream_type: "logs" },
      ...extra,
    });

  it("asks for the real values when the options stop at the default limit of 10", () => {
    expect(needsAllValuesFetch(endpoint())).toBe(true);
  });

  it("does not fetch for explicit selections, custom variables or filtered queries", () => {
    expect(needsAllValuesFetch(endpoint({ value: ["e1"] }))).toBe(false);
    expect(needsAllValuesFetch(endpoint({ type: "custom" }))).toBe(false);
    expect(
      needsAllValuesFetch(
        endpoint({
          query_data: {
            stream: "s",
            field: "f",
            filter: [{ name: "a", operator: "=", value: "b" }],
          },
        }),
      ),
    ).toBe(false);
  });

  it("fetches whatever the option limit, since All covers every value", () => {
    expect(
      needsAllValuesFetch(
        endpoint({ query_data: { stream: "s", field: "f", max_record_size: 50 } }),
      ),
    ).toBe(true);
  });

  it("flags truncated options as possibly incomplete", () => {
    expect(resolveRepeatValues(endpoint())).toEqual({
      values: tenOptions.map((o) => o.value),
      total: 10,
      more: true,
    });
  });

  it("uses fetched values with their real total", () => {
    const fetched = Array.from({ length: 30 }, (_, i) => `v${i}`);
    expect(resolveRepeatValues(endpoint(), 50, { allValues: fetched })).toEqual({
      values: fetched,
      total: 30,
    });
    const many = Array.from({ length: 3472 }, (_, i) => `v${i}`);
    const resolved = resolveRepeatValues(endpoint(), 50, { allValues: many });
    expect(resolved?.values).toHaveLength(50);
    expect(resolved?.total).toBe(3472);
  });

  it("is pending while the fetch runs, not expanded from partial options", () => {
    expect(resolveRepeatValues(endpoint(), 50, { allPending: true })).toEqual({
      values: [],
      total: 0,
      pending: true,
    });
  });

  it("prefers the live options over the committed ones", () => {
    const live = [{ label: "x", value: "x" }];
    expect(
      resolveRepeatValues(hostVar([SELECT_ALL_VALUE], { options: [] }), 50, { options: live }),
    ).toEqual({
      values: ["x"],
      total: 1,
    });
  });

  it("is pending while All has no options and the variable is still loading", () => {
    const loading = endpoint({
      options: [],
      isVariablePartialLoaded: false,
      isVariableLoadingPending: true,
    });
    expect(resolveRepeatValues(loading)?.pending).toBe(true);
  });

  it("never turns an empty value into a copy", () => {
    expect(
      resolveRepeatValues(
        hostVar([SELECT_ALL_VALUE], {
          options: [
            { label: "<blank>", value: "" },
            { label: "a", value: "a" },
          ],
        }),
      )?.values,
    ).toEqual(["a"]);
    expect(resolveRepeatValues(hostVar(["", "b"]))?.values).toEqual(["b"]);
  });
});

describe("readableTemplate", () => {
  it("shows variables as placeholder names", () => {
    expect(readableTemplate("Status: $status")).toBe("Status: <status>");
    expect(readableTemplate("Trace ${trace} / {{ env }}")).toBe("Trace <trace> / <env>");
    expect(readableTemplate("Plain")).toBe("Plain");
  });
});

describe("splitRepeatTitle", () => {
  const vars = { values: [hostVar(["web"])] };

  it("separates an appended value so it can stay visible", () => {
    expect(splitRepeatTitle("CPU", vars, { variable: "host", value: "web" })).toEqual({
      title: "CPU",
      value: "web",
      rest: "",
      dash: true,
      spaced: true,
    });
  });

  it("splits a title that names the variable around its value", () => {
    expect(
      splitRepeatTitle("pt tabpanel $host in prod", vars, { variable: "host", value: "web" }),
    ).toEqual({ title: "pt tabpanel", value: "web", rest: " in prod", dash: false, spaced: true });
    expect(splitRepeatTitle("cpu_${host}", vars, { variable: "host", value: "web" })).toMatchObject(
      { title: "cpu_", value: "web", spaced: false },
    );
    expect(formatRepeatTitle("cpu_${host}", vars, { variable: "host", value: "web" })).toBe(
      "cpu_web",
    );
  });
});

describe("pinRepeatValue", () => {
  it("pins only the repeat variable and leaves panel-scoped namesakes alone", () => {
    const list = [
      hostVar(["api", "web"]),
      { name: "env", value: ["prod"], scope: "global" },
      { name: "host", value: ["x"], scope: "panels" },
    ];
    const pinned = pinRepeatValue(list, "host", "web");
    expect(pinned[0].value).toEqual(["web"]);
    expect(pinned[1]).toBe(list[1]);
    expect(pinned[2]).toBe(list[2]);
    expect(list[0].value).toEqual(["api", "web"]);
  });
});

describe("formatRepeatTitle", () => {
  it("never shows the internal placeholder for an empty selection", () => {
    expect(formatRepeatTitle("Status $status", { values: [{ name: "status", value: [] }] })).toBe(
      "Status (none)",
    );
    expect(
      formatRepeatTitle(
        "Status $status",
        { values: [{ name: "status", value: [] }] },
        null,
        "All",
        "(nothing)",
      ),
    ).toBe("Status (nothing)");
  });

  const vars = (value: any) => ({ values: [hostVar(value)] });

  it("substitutes $var and ${var}", () => {
    expect(formatRepeatTitle("CPU $host", vars(["web"]))).toBe("CPU web");
    expect(formatRepeatTitle("CPU ${host}", vars(["web"]))).toBe("CPU web");
  });

  it("suffixes the value when a repeated title has no variable", () => {
    expect(formatRepeatTitle("CPU", vars(["web"]), { variable: "host", value: "web" })).toBe(
      "CPU — web",
    );
  });

  it("does not suffix when the title already names the repeat variable", () => {
    expect(formatRepeatTitle("CPU $host", vars(["web"]), { variable: "host", value: "web" })).toBe(
      "CPU web",
    );
  });

  it("shows the All label instead of the internal sentinel", () => {
    expect(formatRepeatTitle("CPU $host", vars([SELECT_ALL_VALUE]), null, "All")).toBe("CPU All");
  });

  it("leaves a title without variables untouched", () => {
    expect(formatRepeatTitle("Requests", undefined)).toBe("Requests");
  });
});

describe("layoutRepeatCopies", () => {
  const source = { x: 40, y: 10, w: 96, h: 18 };

  it("splits the full grid width by max per row and wraps", () => {
    const layouts = layoutRepeatCopies(source, 5, "h", 4);
    expect(layouts.map((l) => [l.x, l.y, l.w])).toEqual([
      [0, 10, 48],
      [48, 10, 48],
      [96, 10, 48],
      [144, 10, 48],
      [0, 28, 48],
    ]);
  });

  it("never makes copies narrower than the count needs", () => {
    expect(layoutRepeatCopies(source, 2, "h", 4).map((l) => l.w)).toEqual([96, 96]);
  });

  it("defaults max per row to 4", () => {
    expect(layoutRepeatCopies(source, 6, "h").map((l) => l.w)[0]).toBe(48);
  });

  it("stacks vertically at the source size", () => {
    expect(layoutRepeatCopies(source, 3, "v")).toEqual([
      { x: 40, y: 10, w: 96, h: 18 },
      { x: 40, y: 28, w: 96, h: 18 },
      { x: 40, y: 46, w: 96, h: 18 },
    ]);
  });
});

describe("expandRepeats", () => {
  const values = (list: string[]) => () => ({ values: list, total: list.length });

  it("leaves panels untouched when nothing repeats", () => {
    const panels = [panel("a", { x: 0, y: 0, w: 96, h: 18 })];
    const out = expandRepeats(panels, () => null);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a");
    expect(out[0].panel).toBe(panels[0]);
    expect(out[0].repeat).toBeUndefined();
  });

  it("replaces a repeated panel with one virtual copy per value", () => {
    const src = panel("cpu", { x: 0, y: 0, w: 96, h: 18 }, { variable: "host", direction: "h" });
    const out = expandRepeats([src], values(["api", "web", "db"]));
    expect(out.map((e) => e.id)).toEqual(["cpu__r__api", "cpu__r__web", "cpu__r__db"]);
    expect(out.every((e) => e.panel === src)).toBe(true);
    expect(out[1].repeat).toEqual({
      sourceId: "cpu",
      variable: "host",
      value: "web",
      index: 1,
      count: 3,
      total: 3,
    });
  });

  it("pushes following panels below the horizontal block", () => {
    const src = panel(
      "cpu",
      { x: 0, y: 0, w: 96, h: 18 },
      { variable: "host", direction: "h", maxPerRow: 2 },
    );
    const below = panel("mem", { x: 0, y: 18, w: 192, h: 10 });
    const out = expandRepeats([src, below], values(["a", "b", "c"]));
    expect(out.find((e) => e.id === "mem")?.layout.y).toBe(36);
    expect(below.layout.y).toBe(18);
  });

  it("pushes panels in the stack's column below it and floats the other column up", () => {
    const src = panel("cpu", { x: 0, y: 0, w: 96, h: 10 }, { variable: "host", direction: "v" });
    const beside = panel("mem", { x: 96, y: 10, w: 96, h: 10 });
    const below = panel("disk", { x: 0, y: 10, w: 96, h: 10 });
    const out = expandRepeats([src, beside, below], values(["a", "b", "c"]));
    expect(out.find((e) => e.id === "cpu__r__c")?.layout).toEqual({ x: 0, y: 20, w: 96, h: 10 });
    expect(out.find((e) => e.id === "mem")?.layout.y).toBe(0);
    expect(out.find((e) => e.id === "disk")?.layout.y).toBe(30);
  });

  it("moves a panel saved beside a horizontal repeat below the whole block", () => {
    const src = panel("cpu", { x: 0, y: 0, w: 96, h: 18 }, { variable: "host", direction: "h" });
    const duplicate = panel("dup", { x: 96, y: 0, w: 96, h: 18 });
    const out = expandRepeats([src, duplicate], values(["a", "b", "c", "d"]));
    expect(out.filter((e) => e.repeat).map((e) => e.layout.y)).toEqual([0, 0, 0, 0]);
    expect(out.find((e) => e.id === "dup")?.layout).toEqual({ x: 96, y: 18, w: 96, h: 18 });
    expect(duplicate.layout.y).toBe(0);
  });

  it("packs a duplicated repeat and a plain panel without holes", () => {
    const src = panel(
      "a",
      { x: 0, y: 0, w: 96, h: 18 },
      { variable: "host", direction: "h", maxPerRow: 3 },
    );
    const plain = panel("plain", { x: 96, y: 0, w: 96, h: 18 });
    const dup = panel(
      "b",
      { x: 0, y: 18, w: 96, h: 18 },
      { variable: "host", direction: "h", maxPerRow: 3 },
    );
    const out = expandRepeats([src, plain, dup], values(["1", "2", "3", "4", "5"]));
    const at = (id: string) => out.find((e) => e.id === id)?.layout;
    expect(at("plain")).toEqual({ x: 96, y: 36, w: 96, h: 18 });
    expect([at("b__r__1")?.y, at("b__r__2")?.y, at("b__r__3")?.y]).toEqual([54, 54, 54]);
    expect([at("b__r__4")?.y, at("b__r__5")?.y]).toEqual([72, 72]);
    expect([at("b__r__4")?.x, at("b__r__5")?.x]).toEqual([0, 64]);
  });

  // Rebuilt from the tester's Ordinary tab: addPanel puts the plain panel beside the source and
  // the duplicate below both (x 0, y = max y + 20), all at the default 96 x 18.
  it("keeps the tester's duplicate layout in value order, row by row, without overlaps", () => {
    const statuses = ["error", "firing", "normal", "notify_failed", "skipped", "succeeded"];
    const config = { variable: "status", direction: "h", maxPerRow: 3 };
    const source = panel("ord", { x: 0, y: 0, w: 96, h: 18 }, config);
    const plain = panel("plain", { x: 96, y: 0, w: 96, h: 18 });
    const dup = panel("dup", { x: 0, y: 20, w: 96, h: 18 }, config);
    const out = expandRepeats([source, plain, dup], values(statuses));
    ["ord", "dup"].forEach((id) => {
      const copies = out.filter((e) => e.repeat?.sourceId === id);
      expect(copies.map((e) => e.repeat?.value)).toEqual(statuses);
      const byPosition = [...copies].sort(
        (a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x,
      );
      expect(byPosition.map((e) => e.repeat?.value)).toEqual(statuses);
      expect(copies.map((e) => [e.layout.x, e.layout.y - copies[0].layout.y])).toEqual([
        [0, 0],
        [64, 0],
        [128, 0],
        [0, 18],
        [64, 18],
        [128, 18],
      ]);
    });
    const layouts = out.map((e) => e.layout);
    layouts.forEach((a, i) =>
      layouts.slice(i + 1).forEach((b) => {
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }),
    );
    expect(out.find((e) => e.id === "plain")?.layout.y).toBe(36);
  });

  // Rebuilt from the tester's repeated tab: a 2-value repeat beside two small panels, a wide one below.
  it("fills the row under a full-width repeat instead of leaving a hole", () => {
    const repeated = panel("count", { x: 0, y: 0, w: 96, h: 18 }, { variable: "module" });
    const top = panel("top", { x: 96, y: 0, w: 48, h: 18 });
    const total = panel("total", { x: 144, y: 0, w: 48, h: 18 });
    const records = panel("records", { x: 0, y: 18, w: 96, h: 18 });
    const out = expandRepeats([repeated, top, total, records], values(["alert", "anomaly"]));
    const at = (id: string) => out.find((e) => e.id === id)?.layout;
    expect([at("count__r__alert"), at("count__r__anomaly")]).toEqual([
      { x: 0, y: 0, w: 96, h: 18 },
      { x: 96, y: 0, w: 96, h: 18 },
    ]);
    expect([at("records")?.y, at("top")?.y, at("total")?.y]).toEqual([18, 18, 18]);
  });

  // Panels exactly as saved in the layout2 tester's dashboard.json (ids, layouts, repeat config).
  describe("the layout2 tester's saved dashboard", () => {
    const noOverlap = (layouts: { x: number; y: number; w: number; h: number }[]) =>
      layouts.every((a, i) =>
        layouts
          .slice(i + 1)
          .every(
            (b) => !(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h),
          ),
      );
    const inReadingOrder = (copies: any[]) =>
      [...copies]
        .sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x)
        .map((e) => e.repeat.value);
    const repeat3 = (variable: string) => ({ direction: "h", maxPerRow: 3, variable });

    it("Default tab: both repeats in value order with no overlap, plain panel kept at its x", () => {
      const statuses = ["error", "firing", "normal", "skipped", "succeeded"];
      const out = expandRepeats(
        [
          panel("Panel_ID1961910", { x: 0, y: 0, w: 96, h: 18, i: 1 }, repeat3("status")),
          panel("Panel_ID9987110", { x: 96, y: 0, w: 96, h: 18, i: 2 }),
          panel("Panel_ID9090510", { x: 0, y: 20, w: 96, h: 18, i: 3 }, repeat3("status")),
        ],
        values(statuses),
      );
      ["Panel_ID1961910", "Panel_ID9090510"].forEach((id) => {
        const copies = out.filter((e) => e.repeat?.sourceId === id);
        expect(copies.map((e) => e.repeat?.value)).toEqual(statuses);
        expect(inReadingOrder(copies)).toEqual(statuses);
      });
      expect(noOverlap(out.map((e) => e.layout))).toBe(true);
      expect(out.find((e) => e.id === "Panel_ID9987110")?.layout).toEqual({
        x: 96,
        y: 36,
        w: 96,
        h: 18,
      });
    });

    it("repeated tab: the panel repeat by module stays in value order beside its plain panel", () => {
      const modules = ["alert", "anomaly_detection", "slo"];
      const out = expandRepeats(
        [
          panel("Panel_ID3357710", { x: 0, y: 0, w: 96, h: 18, i: 1 }, repeat3("module")),
          panel("Panel_ID5272110", { x: 96, y: 0, w: 96, h: 18, i: 2 }),
        ],
        values(modules),
      );
      const copies = out.filter((e) => e.repeat);
      expect(inReadingOrder(copies)).toEqual(modules);
      expect(copies.map((e) => e.layout.y)).toEqual([0, 0, 0]);
      expect(out.find((e) => e.id === "Panel_ID5272110")?.layout.y).toBe(18);
      expect(noOverlap(out.map((e) => e.layout))).toBe(true);
    });
  });

  it("leaves a dashboard without copies exactly as saved", () => {
    const a = panel("a", { x: 0, y: 40, w: 96, h: 18 });
    const out = expandRepeats([a], () => null);
    expect(out[0].layout).toEqual({ x: 0, y: 40, w: 96, h: 18 });
  });

  it("never overlaps two horizontal repeats saved side by side", () => {
    const first = panel("p1", { x: 0, y: 0, w: 96, h: 18 }, { variable: "host", direction: "h" });
    const second = panel("p2", { x: 96, y: 0, w: 96, h: 18 }, { variable: "host", direction: "h" });
    const out = expandRepeats([first, second], values(["a", "b", "c", "d", "e"]));
    const layouts = out.map((e) => e.layout);
    layouts.forEach((a, i) =>
      layouts.slice(i + 1).forEach((b) => {
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }),
    );
    expect(out.find((e) => e.id === "p2__r__a")?.layout.y).toBe(36);
  });

  it("does not move panels above the repeated one", () => {
    const above = panel("top", { x: 0, y: 0, w: 192, h: 5 });
    const src = panel("cpu", { x: 0, y: 5, w: 96, h: 10 }, { variable: "host", direction: "v" });
    const out = expandRepeats([above, src], values(["a", "b"]));
    expect(out[0].layout.y).toBe(0);
  });

  it("accumulates shifts from several repeated panels", () => {
    const first = panel("p1", { x: 0, y: 0, w: 96, h: 10 }, { variable: "host", direction: "v" });
    const second = panel("p2", { x: 0, y: 10, w: 96, h: 10 }, { variable: "host", direction: "v" });
    const last = panel("p3", { x: 0, y: 20, w: 96, h: 10 });
    const out = expandRepeats([first, second, last], values(["a", "b"]));
    expect(out.find((e) => e.id === "p2__r__a")?.layout.y).toBe(20);
    expect(out.find((e) => e.id === "p3")?.layout.y).toBe(40);
  });

  it("shows the source once as an empty state when no value is selected", () => {
    const src = panel("cpu", { x: 0, y: 0, w: 96, h: 10 }, { variable: "host" });
    const out = expandRepeats([src], values([]));
    expect(out.map((e) => e.id)).toEqual(["cpu"]);
    expect(out[0].emptyRepeat).toEqual({ variable: "host", pending: false });
    expect(out[0].repeat).toBeUndefined();
  });

  it("marks the empty state as loading while values are pending", () => {
    const src = panel("cpu", { x: 0, y: 0, w: 96, h: 10 }, { variable: "host" });
    const out = expandRepeats([src], () => ({ values: [], total: 0, pending: true }));
    expect(out[0].emptyRepeat).toEqual({ variable: "host", pending: true });
  });

  it("renders a panel whose variable cannot repeat as an ordinary panel", () => {
    const src = panel("cpu", { x: 0, y: 0, w: 96, h: 10 }, { variable: "host" });
    const out = expandRepeats([src], () => null);
    expect(out[0].emptyRepeat).toBeUndefined();
  });
});

describe("expandRepeatTabs", () => {
  const tabs = [
    { tabId: "svc", name: "Service", repeat: { variable: "service" } },
    { tabId: "plain", name: "Plain" },
  ];
  const resolveWith =
    (list: string[] | null, extra: Record<string, any> = {}) =>
    (tab: any) =>
      tab.repeat ? (list ? { values: list, total: list.length, ...extra } : null) : null;

  it("replaces a repeated tab, in place, with one virtual tab per value", () => {
    const out = expandRepeatTabs(tabs, resolveWith(["api", "web"]));
    expect(out.map((e) => e.tabId)).toEqual(["svc__r__api", "svc__r__web", "plain"]);
    expect(out[1].repeat).toMatchObject({
      sourceId: "svc",
      variable: "service",
      value: "web",
      index: 1,
    });
    expect(out[0].tab).toBe(tabs[0]);
  });

  it("keeps the source tab as an empty state when no value is selected", () => {
    const out = expandRepeatTabs(tabs, resolveWith([]));
    expect(out[0]).toMatchObject({
      tabId: "svc",
      emptyRepeat: { variable: "service", pending: false },
    });
  });

  it("leaves a tab whose variable cannot repeat as it is", () => {
    const out = expandRepeatTabs(tabs, resolveWith(null));
    expect(out.map((e) => e.tabId)).toEqual(["svc", "plain"]);
    expect(out[0].emptyRepeat).toBeUndefined();
  });
});

describe("resolveSelectedTab", () => {
  const svc = { tabId: "svc", repeat: { variable: "service" } };
  const plain = { tabId: "plain" };
  const copies = [
    { tabId: "svc__r__api", tab: svc },
    { tabId: "svc__r__web", tab: svc },
    { tabId: "plain", tab: plain },
  ];

  it("keeps a tab that is rendered", () => {
    expect(resolveSelectedTab("svc__r__web", copies)).toBe("svc__r__web");
    expect(resolveSelectedTab("plain", copies)).toBe("plain");
  });

  it("moves a value that is no longer selected, or the source id, to the first copy", () => {
    expect(resolveSelectedTab("svc__r__gone", copies)).toBe("svc__r__api");
    expect(resolveSelectedTab("svc", copies)).toBe("svc__r__api");
  });

  it("falls back to the source tab when nothing is selected", () => {
    const empty = [
      { tabId: "svc", tab: svc, emptyRepeat: { variable: "service", pending: false } },
    ];
    expect(resolveSelectedTab("svc__r__api", empty)).toBe("svc");
  });

  it("keeps a URL value while the tab's values are still loading", () => {
    const pending = [
      { tabId: "svc", tab: svc, emptyRepeat: { variable: "service", pending: true } },
    ];
    expect(resolveSelectedTab("svc__r__api", pending)).toBe("svc__r__api");
  });

  it("falls back to the first tab for an unknown id", () => {
    expect(resolveSelectedTab("missing", copies)).toBe("svc__r__api");
  });
});
