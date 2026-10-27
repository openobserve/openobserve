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

import { describe, expect, it, vi } from "vitest";
import {
  HOSTMAP_MAX_CELLS,
  HOSTMAP_MIN_CELL,
  buildHostmapTree,
  capHostmapTree,
  convertHostmapData,
  dropEmptyGroupLevels,
  fitHostmapLabel,
  flattenHostmapTree,
  hostmapDrilldownSeries,
  hostmapEntityColumn,
  hostmapLabelNames,
  hostmapMappingFill,
  layoutHostmap,
  hostmapLabelSuggestions,
  markHostmapDuplicates,
  middleTruncate,
  naturalCompare,
  promqlHostmapEntities,
  reduceHostmapValues,
  sqlHostmapEntities,
  toHostmapNumber,
  type HostmapEntity,
} from "./convertHostmapData";
import { STATE_TIMELINE_ROW_ZOOM_IDS, promqlSeriesCap } from "./convertStateTimelineData";
import { createPromQLChunkProcessor } from "@/composables/dashboard/promqlChunkProcessor";

// jsdom has no token stylesheet, so each token resolves to its own name and stays distinguishable.
vi.mock("@/utils/chartTheme", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/chartTheme")>()),
  chartColor: (token: string) => token,
}));

const store = (zoConfig: any = {}) => ({
  state: {
    timezone: "UTC",
    theme: "light",
    selectedOrganization: { identifier: "default" },
    zoConfig,
  },
});

const sqlPanel = (config: any = {}, groups = 2) => ({
  id: "p1",
  type: "hostmap",
  queryType: "sql",
  config,
  queries: [
    {
      fields: {
        x: [{ alias: "x_axis_1", column: "gpu" }],
        y: [{ alias: "y_axis_1", column: "temp" }],
        breakdown: [
          { alias: "breakdown_1", column: "rack" },
          { alias: "breakdown_2", column: "host" },
        ].slice(0, groups),
      },
    },
  ],
});

const sqlRow = (gpu: string, rack: string, host: string, temp: unknown, extra: any = {}) => ({
  x_axis_1: gpu,
  breakdown_1: rack,
  breakdown_2: host,
  y_axis_1: temp,
  ...extra,
});

const promqlPanel = (config: any = {}) => ({
  id: "p2",
  type: "hostmap",
  queryType: "promql",
  config,
  queries: [{ config: {} }],
});

const series = (metric: Record<string, string>, values: [number, string][]) => ({
  metric,
  values,
});

const entity = (name: string, value: number | null, groups: string[] = []): HostmapEntity => ({
  name,
  value,
  groups,
  labels: {},
});

const cellsOf = (result: any) => result.options.series[0].data;
const namesOf = (result: any) => cellsOf(result).map((cell: any) => cell.name);

/** A fake renderItem api over a box of the given size. */
const api = (width = 800, height = 600) => ({ getWidth: () => width, getHeight: () => height });

describe("hostmap value helpers", () => {
  it("sorts names naturally", () => {
    expect(["gpu10", "gpu2", "gpu1"].sort(naturalCompare)).toEqual(["gpu1", "gpu2", "gpu10"]);
  });

  it("reads finite numbers only; NaN and Inf samples are no data", () => {
    expect(toHostmapNumber("42.5")).toBe(42.5);
    expect(toHostmapNumber(7)).toBe(7);
    expect(toHostmapNumber("NaN")).toBeNull();
    expect(toHostmapNumber("+Inf")).toBeNull();
    expect(toHostmapNumber("")).toBeNull();
    expect(toHostmapNumber(null)).toBeNull();
    expect(toHostmapNumber("up")).toBeNull();
  });

  it("reduces samples by last, avg, min and max, skipping gaps", () => {
    const values = [3, null, 9, 6];
    expect(reduceHostmapValues(values, "last")).toBe(6);
    expect(reduceHostmapValues(values, "avg")).toBe(6);
    expect(reduceHostmapValues(values, "min")).toBe(3);
    expect(reduceHostmapValues(values, "max")).toBe(9);
    expect(reduceHostmapValues([null, null], "last")).toBeNull();
    expect(reduceHostmapValues([], "avg")).toBeNull();
  });
});

describe("hostmap grouping and sorting", () => {
  const fleet = [
    entity("gpu10", 50, ["rack-2", "host-a"]),
    entity("gpu2", 90, ["rack-10", "host-b"]),
    entity("gpu1", null, ["rack-2", "host-a"]),
    entity("gpu3", 70, ["rack-2", "host-c"]),
  ];

  it("nests two group levels in natural name order", () => {
    const tree = buildHostmapTree(fleet, 2, "name", "name");
    expect(tree.children.map((g) => g.name)).toEqual(["rack-2", "rack-10"]);
    expect(tree.children[0].children.map((g) => g.name)).toEqual(["host-a", "host-c"]);
    expect(tree.children[0].children[0].cells.map((c) => c.name)).toEqual(["gpu1", "gpu10"]);
    expect(tree.children[0].children[0].path).toEqual(["rack-2", "host-a"]);
  });

  it("sorts groups by their worst (highest) value and cells by value with no data last", () => {
    const tree = buildHostmapTree(fleet, 2, "value", "value");
    expect(tree.children.map((g) => g.name)).toEqual(["rack-10", "rack-2"]);
    expect(tree.children[1].children.map((g) => g.name)).toEqual(["host-c", "host-a"]);
    expect(tree.children[1].children[1].cells.map((c) => c.name)).toEqual(["gpu10", "gpu1"]);
  });

  it("flattens in display order and caps to the first N cells, dropping emptied groups", () => {
    const tree = buildHostmapTree(fleet, 2, "name", "name");
    expect(flattenHostmapTree(tree).map((c) => c.name)).toEqual(["gpu1", "gpu10", "gpu3", "gpu2"]);
    const capped = capHostmapTree(tree, 2);
    expect(flattenHostmapTree(capped).map((c) => c.name)).toEqual(["gpu1", "gpu10"]);
    expect(capped.children.map((g) => g.name)).toEqual(["rack-2"]);
    expect(capped.children[0].children.map((g) => g.name)).toEqual(["host-a"]);
  });

  it("marks cells that share a name inside one group, not across groups", () => {
    const marked = markHostmapDuplicates([
      entity("gpu0", 1, ["host-a"]),
      entity("gpu0", 2, ["host-a"]),
      entity("gpu0", 3, ["host-b"]),
    ]);
    expect(marked.map((cell) => cell.duplicates)).toEqual([2, 2, undefined]);
  });
});

describe("hostmap layout", () => {
  it("fits a flat fleet into the box with every cell inside it", () => {
    const tree = buildHostmapTree(
      Array.from({ length: 100 }, (_, i) => entity(`gpu${i}`, i)),
      0,
      "name",
      "name",
    );
    const layout = layoutHostmap(tree, 400, 200, "square");
    expect(layout.cells).toHaveLength(100);
    expect(layout.frames).toHaveLength(0);
    layout.cells.forEach((cell) => {
      expect(cell.x + cell.size).toBeLessThanOrEqual(400 + 1e-6);
      expect(cell.y + cell.size).toBeLessThanOrEqual(200 + 1e-6);
    });
    expect(layout.cellSize).toBeGreaterThan(15);
  });

  it("reflows when the box changes size", () => {
    const tree = buildHostmapTree(
      Array.from({ length: 64 }, (_, i) => entity(`h${i}`, i)),
      0,
      "name",
      "name",
    );
    const wide = layoutHostmap(tree, 800, 100, "square");
    const tall = layoutHostmap(tree, 100, 800, "square");
    const columns = (layout: any) => new Set(layout.cells.map((c: any) => c.x)).size;
    expect(columns(wide)).toBeGreaterThan(columns(tall));
  });

  it("frames every group and keeps hexagon rows offset", () => {
    const tree = buildHostmapTree(
      [
        ...Array.from({ length: 8 }, (_, i) => entity(`gpu${i}`, i, ["host-a"])),
        ...Array.from({ length: 8 }, (_, i) => entity(`gpu${i}`, i, ["host-b"])),
      ],
      1,
      "name",
      "name",
    );
    const layout = layoutHostmap(tree, 300, 300, "hexagon");
    expect(layout.frames.map((frame) => frame.title)).toEqual(["host-a", "host-b"]);
    const [first] = layout.cells;
    const nextRow = layout.cells.find((cell) => cell.y > first.y + 1e-6)!;
    expect(nextRow.x - first.x).toBeCloseTo(first.size / 2);
  });

  const rackFleet = Array.from({ length: 512 }, (_, i) =>
    entity(`gpu${i % 8}`, i, [`rack-${Math.floor(i / 64)}`, `host-${Math.floor(i / 8)}`]),
  );

  it("puts group blocks side by side when the box has room, instead of one per row", () => {
    const tree = buildHostmapTree(rackFleet, 2, "name", "name");
    const layout = layoutHostmap(tree, 1400, 560, "square");
    const racks = layout.frames.filter((frame) => frame.depth === 1);
    expect(layout.overflows).toBe(false);
    expect(new Set(racks.map((frame) => frame.y)).size).toBe(1);
    expect(layout.cellSize).toBeGreaterThan(20);
  });

  it("lines sibling blocks up in columns", () => {
    const tree = buildHostmapTree(rackFleet, 2, "name", "name");
    const layout = layoutHostmap(tree, 900, 700, "square");
    const racks = layout.frames.filter((frame) => frame.depth === 1);
    const rows = [...new Set(racks.map((frame) => frame.y))];
    expect(rows.length).toBeGreaterThan(1);
    const columnsOf = (y: number) => racks.filter((frame) => frame.y === y).map((frame) => frame.x);
    expect(columnsOf(rows[1])).toEqual(columnsOf(rows[0]).slice(0, columnsOf(rows[1]).length));
  });

  it("keeps every frame and cell off the panel edges", () => {
    const tree = buildHostmapTree(rackFleet, 2, "name", "name");
    for (const [width, height] of [
      [1400, 560],
      [645, 500],
      [645, 230],
    ]) {
      const layout = layoutHostmap(tree, width, height, "hexagon");
      [
        ...layout.frames,
        ...layout.cells.map((c) => ({ ...c, width: c.size, height: c.size })),
      ].forEach((box) => {
        expect(box.x).toBeGreaterThanOrEqual(4);
        expect(box.y).toBeGreaterThanOrEqual(4);
        expect(box.x + box.width).toBeLessThanOrEqual(width - 4 + 1e-6);
      });
    }
  });

  it("lays out 5,000 cells quickly", () => {
    const fleet = Array.from({ length: 5000 }, (_, i) =>
      entity(`gpu${i % 8}`, i % 100, [`rack-${Math.floor(i / 256)}`, `host-${Math.floor(i / 8)}`]),
    );
    const started = performance.now();
    const layout = layoutHostmap(buildHostmapTree(fleet, 2, "name", "name"), 1600, 900, "square");
    expect(layout.cells).toHaveLength(5000);
    expect(layout.cellSize).toBeGreaterThanOrEqual(HOSTMAP_MIN_CELL);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe("hostmapLabelSuggestions", () => {
  it("lists labels a by clause keeps first, then the other stream labels, without internal columns", () => {
    expect(
      hostmapLabelSuggestions("sum(rate(x[5m])) by (rack) + max by (rack, host) (y)", [
        "__name__",
        "_timestamp",
        "value",
        "gpu_uuid",
        "host",
        "rack",
      ]),
    ).toEqual(["rack", "host", "gpu_uuid"]);
    expect(hostmapLabelSuggestions("gpu_power_watts", ["host", "rack"])).toEqual(["host", "rack"]);
  });
});

describe("sqlHostmapEntities", () => {
  it("makes one cell per entity and group, labelled by column name", () => {
    const entities = sqlHostmapEntities(
      sqlPanel(),
      [[sqlRow("gpu1", "r1", "h1", 40, { model: "H100" }), sqlRow("gpu2", "r1", "h1", 60)]],
      store(),
    );
    expect(entities.map((e) => [e.name, e.groups, e.value])).toEqual([
      ["gpu1", ["r1", "h1"], 40],
      ["gpu2", ["r1", "h1"], 60],
    ]);
    expect(entities[0].labels).toEqual({ gpu: "gpu1", rack: "r1", host: "h1", model: "H100" });
  });

  it("reduces rows of one entity in timestamp order", () => {
    const rows = [
      sqlRow("gpu1", "r1", "h1", 30, { _timestamp: 3_000_000 }),
      sqlRow("gpu1", "r1", "h1", 10, { _timestamp: 1_000_000 }),
      sqlRow("gpu1", "r1", "h1", 20, { _timestamp: 2_000_000 }),
    ];
    const valueFor = (reduction: string) =>
      sqlHostmapEntities(sqlPanel({ hostmap_reduction: reduction }), [rows], store())[0].value;
    expect(valueFor("last")).toBe(30);
    expect(valueFor("avg")).toBe(20);
    expect(valueFor("min")).toBe(10);
    expect(valueFor("max")).toBe(30);
  });

  it("keeps a null value as a no-data cell instead of dropping it", () => {
    const entities = sqlHostmapEntities(sqlPanel(), [[sqlRow("gpu1", "r1", "h1", null)]], store());
    expect(entities).toHaveLength(1);
    expect(entities[0].value).toBeNull();
  });
});

describe("promqlHostmapEntities", () => {
  const data = [
    {
      resultType: "matrix",
      result: [
        series({ gpu: "gpu10", host: "h1", rack: "r1" }, [
          [1, "50"],
          [2, "70"],
        ]),
        series({ gpu: "gpu2", host: "h1", rack: "r1" }, [
          [1, "NaN"],
          [2, "NaN"],
        ]),
        series({ gpu: "gpu2", host: "h1", rack: "r1", instance: "b" }, [[1, "65"]]),
      ],
    },
  ];

  it("names cells by the entity label and groups them by label sets", () => {
    const entities = promqlHostmapEntities(
      promqlPanel({ hostmap_entity_label: "gpu", hostmap_group_by: ["rack", "host"] }),
      data,
      {},
      store(),
    );
    expect(entities.map((e) => [e.name, e.groups, e.value])).toEqual([
      ["gpu10", ["r1", "h1"], 70],
      ["gpu2", ["r1", "h1"], null],
      ["gpu2", ["r1", "h1"], 65],
    ]);
    expect(entities[2].labels.instance).toBe("b");
  });

  it("falls back to the legend name, and reads instant vectors", () => {
    const entities = promqlHostmapEntities(
      promqlPanel(),
      [{ result: [{ metric: { host: "h1" }, value: [1, "3"] }] }],
      {},
      store(),
    );
    expect(entities[0].name).toContain("h1");
    expect(entities[0].value).toBe(3);
  });

  it("leaves out time-shifted result slots", () => {
    const entities = promqlHostmapEntities(
      promqlPanel({ hostmap_entity_label: "gpu" }),
      [data[0], data[0]],
      { queries: [{}, { timeRangeGap: { seconds: 3600 } }] },
      store(),
    );
    expect(entities).toHaveLength(3);
  });
});

describe("convertHostmapData", () => {
  it("returns an empty series list for no result, so the panel shows No data", () => {
    expect(convertHostmapData(sqlPanel(), [[]], store()).options.series).toEqual([]);
    expect(convertHostmapData(promqlPanel(), [{ result: [] }], store()).options.series).toEqual([]);
  });

  it("orders cells by group then natural name", () => {
    const result = convertHostmapData(
      sqlPanel({}, 1),
      [[sqlRow("gpu10", "r2", "", 1), sqlRow("gpu2", "r2", "", 2), sqlRow("gpu1", "r1", "", 3)]],
      store(),
    );
    expect(namesOf(result)).toEqual(["gpu1", "gpu2", "gpu10"]);
    expect(result.options.series[1].data).toHaveLength(2);
  });

  it("colours by value mapping first, then thresholds, then the colour scale", () => {
    const result = convertHostmapData(
      sqlPanel(
        {
          decimals: 0,
          mappings: [{ type: "value", value: "1", text: "CRIT", color: "#ff0000" }],
          thresholds: {
            mode: "absolute",
            baseColor: "#00aa00",
            steps: [{ value: 80, color: "#ffaa00" }],
          },
        },
        0,
      ),
      [[sqlRow("a", "", "", 1), sqlRow("b", "", "", 90), sqlRow("c", "", "", 10)]],
      store(),
    );
    const [a, b, c] = cellsOf(result);
    expect(a.fill).toBe("#ff0000");
    expect(a.text).toBe("CRIT");
    expect(b.fill).toBe("#ffaa00");
    expect(c.fill).toBe("#00aa00");
    expect(result.options.legend.data).toEqual(["CRIT", "Below 80", "80 or more"]);
  });

  it("uses the continuous scale with a visual map legend when nothing else colours", () => {
    const result = convertHostmapData(
      sqlPanel({ unit: "percent", decimals: 0 }, 0),
      [[sqlRow("a", "", "", 0), sqlRow("b", "", "", 100)]],
      store(),
    );
    const [low, high] = cellsOf(result);
    expect(low.fill).not.toBe(high.fill);
    expect(result.options.visualMap.inRange.color).toEqual(["green", "yellow", "red"]);
    expect(result.options.visualMap.text).toEqual(["100%", "0%"]);
  });

  it("applies unit, decimals and no-value text to labels and the tooltip", () => {
    const result = convertHostmapData(
      sqlPanel({ unit: "percent", decimals: 1, no_value_replacement: "offline" }, 0),
      [[sqlRow("a", "", "", 12.345), sqlRow("b", "", "", null)]],
      store(),
    );
    const [a, b] = cellsOf(result);
    expect(a.text).toBe("12.3%");
    expect(b.fill).toBeNull();
    expect(b.text).toBe("offline");
    const tooltip = result.options.tooltip.formatter({ seriesIndex: 0, data: a });
    expect(tooltip).toContain("<strong>a</strong>");
    expect(tooltip).toContain("12.3%");
  });

  it("draws no-data cells in their own dashed style and lists them in the legend", () => {
    const result = convertHostmapData(
      sqlPanel({}, 0),
      [[sqlRow("a", "", "", 5), sqlRow("b", "", "", null)]],
      store(),
    );
    const render = result.options.series[0].renderItem;
    const noData = render({ dataIndex: 1 }, api());
    expect(noData.style.fill).toBe("--color-surface-subtle");
    expect(noData.style.lineDash).toEqual([2, 2]);
    const filled = render({ dataIndex: 0 }, api());
    expect(filled.style.fill).not.toBe("--color-surface-subtle");
    expect(result.options.legend.data).toContain("No data");
  });

  it("draws hexagons, and hides cell labels when cells are too small", () => {
    const panel = sqlPanel({ hostmap_cell_shape: "hexagon", hostmap_cell_label: "name" }, 0);
    const result = convertHostmapData(panel, [[sqlRow("a", "", "", 5)]], store());
    const big = result.options.series[0].renderItem({ dataIndex: 0 }, api(400, 300));
    expect(big.type).toBe("group");
    expect(big.children[0].type).toBe("polygon");
    expect(big.children[1].style.text).toBe("a");

    const fleet = Array.from({ length: 2000 }, (_, i) => sqlRow(`g${i}`, "", "", i));
    const crowded = convertHostmapData(panel, [fleet], store());
    expect(crowded.options.series[0].renderItem({ dataIndex: 0 }, api(300, 200)).type).toBe(
      "polygon",
    );
  });

  it("says so in the tooltip when two series share an entity name", () => {
    const result = convertHostmapData(
      promqlPanel({ hostmap_entity_label: "gpu" }),
      [
        {
          result: [
            series({ gpu: "gpu0", instance: "a" }, [[1, "1"]]),
            series({ gpu: "gpu0", instance: "b" }, [[1, "2"]]),
          ],
        },
      ],
      store(),
    );
    expect(namesOf(result)).toEqual(["gpu0", "gpu0"]);
    const tooltip = result.options.tooltip.formatter({ seriesIndex: 0, data: cellsOf(result)[0] });
    expect(tooltip).toContain("2 cells share this name");
    expect(tooltip).toContain("instance: a");
  });

  it("escapes entity names and labels in the tooltip", () => {
    const result = convertHostmapData(
      sqlPanel({}, 0),
      [[sqlRow("<img src=x>", "", "", 1)]],
      store(),
    );
    const tooltip = result.options.tooltip.formatter({ seriesIndex: 0, data: cellsOf(result)[0] });
    expect(tooltip).not.toContain("<img");
  });

  it("shows the first N cells in sort order with a Showing N of M notice above the cap", () => {
    const fleet = Array.from({ length: 30 }, (_, i) => sqlRow(`gpu${i}`, "", "", i));
    const result = convertHostmapData(
      sqlPanel({ hostmap_cell_sort: "value" }, 0),
      [fleet],
      store({ max_dashboard_hostmap_cells: 10 }),
    );
    expect(cellsOf(result)).toHaveLength(10);
    expect(namesOf(result)[0]).toBe("gpu29");
    expect(result.extras.seriesLimit).toMatchObject({ shown: 10, total: 30, cap: 10 });
    expect(result.extras.seriesLimit.displayCapMessage).toBe("Showing 10 of 30 cells.");
  });

  it("converts 5,000 cells without a notice and with a hit-testable cell per entity", () => {
    const fleet = Array.from({ length: HOSTMAP_MAX_CELLS }, (_, i) =>
      sqlRow(`gpu${i % 8}`, `rack-${Math.floor(i / 512)}`, `host-${Math.floor(i / 8)}`, i % 97),
    );
    const result = convertHostmapData(sqlPanel(), [fleet], store());
    expect(cellsOf(result)).toHaveLength(HOSTMAP_MAX_CELLS);
    expect(result.extras.seriesLimit).toBeUndefined();
    const render = result.options.series[0].renderItem;
    expect(render({ dataIndex: HOSTMAP_MAX_CELLS - 1 }, api(1600, 900))).not.toBeNull();
  });

  it("counts PromQL series the loader cut off in the notice", () => {
    const result = convertHostmapData(
      promqlPanel({ hostmap_entity_label: "gpu" }),
      [{ result: [series({ gpu: "a" }, [[1, "1"]])] }],
      store(),
      { seriesLimiting: { uniqueSeriesSeen: 7000, metricsStored: 1 } },
    );
    expect(result.extras.seriesLimit.displayCapMessage).toBe("Showing 1 of 7,000 cells.");
  });

  it("hides the legend and scale when legends are off", () => {
    const result = convertHostmapData(
      sqlPanel({ show_legends: false }, 0),
      [[sqlRow("a", "", "", 1), sqlRow("b", "", "", null)]],
      store(),
    );
    expect(result.options.legend.show).toBe(false);
    expect(result.options.visualMap).toBeUndefined();
  });
});

describe("hostmap drilldown", () => {
  it("exposes the cell name, value, group path and labels", () => {
    const result = convertHostmapData(
      sqlPanel(),
      [[sqlRow("gpu1", "r1", "h1", 42, { model: "H100" })]],
      store(),
    );
    const vars = hostmapDrilldownSeries({ data: cellsOf(result)[0] });
    expect(vars).toEqual({
      __name: "gpu1",
      __value: 42,
      __group: "r1/h1",
      labels: { gpu: "gpu1", rack: "r1", host: "h1", model: "H100" },
    });
  });

  it("names the entity column and the known labels for SQL and PromQL", () => {
    expect(hostmapEntityColumn(sqlPanel())).toBe("gpu");
    expect(hostmapEntityColumn(promqlPanel({ hostmap_entity_label: "gpu_uuid" }))).toBe("gpu_uuid");
    expect(hostmapLabelNames(sqlPanel())).toEqual(["gpu", "rack", "host"]);
    expect(
      hostmapLabelNames(promqlPanel({ hostmap_entity_label: "gpu", hostmap_group_by: ["host"] })),
    ).toEqual(["gpu", "host"]);
  });

  it("loads up to the cell cap of PromQL series for a host map", () => {
    expect(promqlSeriesCap("hostmap", {})).toBe(HOSTMAP_MAX_CELLS);
    expect(promqlSeriesCap("hostmap", { max_dashboard_hostmap_cells: 300 })).toBe(300);
    expect(promqlSeriesCap("line", {})).toBe(100);
  });
});

describe("hostmap round 1 fixes", () => {
  const panelRef = (width: number, height: number) => ({
    value: { offsetWidth: width, offsetHeight: height },
  });

  it("cuts the middle of a long name and keeps its distinguishing tail", () => {
    expect(middleTruncate("a-node05", 5)).toBe("a…e05");
    expect(middleTruncate("a-node05", 8)).toBe("a-node05");
    expect(middleTruncate("gpu-rack-a-node-01", 9)).toBe("gpu…de-01");
    expect(middleTruncate("abc", 1)).toBe("…");
  });

  it("shrinks the font a step before cutting a label", () => {
    // 8 chars at 11px need 52.8px; at 10px 48px.
    expect(fitHostmapLabel("a-node05", 50)).toEqual({ text: "a-node05", fontSize: 10 });
    expect(fitHostmapLabel("a-node05", 30).fontSize).toBe(9);
    expect(fitHostmapLabel("a-node05", 30).text).toMatch(/^a.*….*05$/);
  });

  it("titles every group frame with a fitted name and a tooltip naming its full path", () => {
    const rows = Array.from({ length: 16 }, (_, i) =>
      sqlRow(
        `gpu${i % 8}`,
        "rack-a",
        `rack-a-node-${String(Math.floor(i / 8)).padStart(2, "0")}`,
        i,
      ),
    );
    const result = convertHostmapData(sqlPanel(), [rows], store());
    const frame = result.options.series[1].renderItem({ dataIndex: 1 }, api(240, 300));
    const title = frame.children[2].style.text;
    expect(title).toMatch(/00$/);
    expect(result.options.series[1].silent).toBeUndefined();
    const tooltip = result.options.tooltip.formatter({ seriesIndex: 1, dataIndex: 1 });
    expect(tooltip).toContain("rack-a › rack-a-node-00");
    expect(tooltip).toContain("Highest: 7.00");
  });

  it("marks each group header with the colour of its highest value", () => {
    const panel = sqlPanel(
      {
        thresholds: {
          mode: "absolute",
          baseColor: "#00aa00",
          steps: [{ value: 80, color: "#ff0000" }],
        },
      },
      1,
    );
    const rows = [
      sqlRow("g1", "hot", "", 90),
      sqlRow("g2", "hot", "", 10),
      sqlRow("g3", "cool", "", 5),
    ];
    const result = convertHostmapData(panel, [rows], store());
    const render = result.options.series[1].renderItem;
    const swatches = [0, 1].map(
      (i) => render({ dataIndex: i }, api(600, 300)).children[1].style.fill,
    );
    expect(swatches).toEqual(["#00aa00", "#ff0000"]);
  });

  it("keeps every group frame at a readable cell size and scrolls a map that does not fit", () => {
    const fleet = Array.from({ length: 512 }, (_, i) =>
      entity(`gpu${i % 8}`, i, [`rack-${Math.floor(i / 64)}`, `host-${Math.floor(i / 8)}`]),
    );
    const tree = buildHostmapTree(fleet, 2, "name", "name");
    const roomy = layoutHostmap(tree, 1600, 900, "square");
    expect(roomy.overflows).toBe(false);
    expect(roomy.frames).toHaveLength(72);
    const tight = layoutHostmap(tree, 400, 160, "square");
    expect(tight.cellSize).toBe(HOSTMAP_MIN_CELL);
    expect(tight.overflows).toBe(true);
    expect(tight.frames).toHaveLength(72);
    expect(tight.contentHeight).toBeGreaterThan(160);

    const rows = fleet.map((cell) => sqlRow(cell.name, cell.groups[0], cell.groups[1], cell.value));
    const fits = convertHostmapData(sqlPanel(), [rows], store(), {}, panelRef(1600, 900));
    expect(fits.options.dataZoom).toBeUndefined();
    expect(fits.extras.rowScroll).toBeUndefined();

    const result = convertHostmapData(sqlPanel(), [rows], store(), {}, panelRef(400, 200));
    expect(result.extras.rowScroll).toBe(true);
    expect(result.extras.seriesLimit).toBeUndefined();
    expect(result.options.series[0].coordinateSystem).toBe("cartesian2d");
    expect(result.options.series[1].data).toHaveLength(72);
    expect(result.options.dataZoom.map((zoom: any) => zoom.id)).toEqual(
      STATE_TIMELINE_ROW_ZOOM_IDS,
    );
    const visible = 200 - 32 - 2;
    expect(result.options.dataZoom[0]).toMatchObject({ startValue: 0, endValue: visible });
    expect(result.options.yAxis.max).toBeGreaterThan(visible);
    // Scrolled 100 units down, the axes move every shape up by 100 pixels.
    const at = (offset: number) => ({
      ...api(400, 200),
      coord: ([x, y]: number[]) => [x, y + 2 - offset],
    });
    const top = result.options.series[0].renderItem({ dataIndex: 0 }, at(0));
    const moved = result.options.series[0].renderItem({ dataIndex: 0 }, at(100));
    expect(moved.shape.y).toBeCloseTo(top.shape.y - 100);
  });

  it("colours and labels a text value from a value mapping on the raw string", () => {
    const panel = sqlPanel(
      {
        mappings: [
          { type: "value", value: "ok", text: "OK", color: "#00aa00" },
          { type: "value", value: "degraded", text: "Degraded", color: "#ffaa00" },
        ],
      },
      0,
    );
    const result = convertHostmapData(
      panel,
      [[sqlRow("a", "", "", "ok"), sqlRow("b", "", "", "degraded"), sqlRow("c", "", "", "lost")]],
      store(),
    );
    const [a, b, c] = cellsOf(result);
    expect([a.fill, a.text]).toEqual(["#00aa00", "OK"]);
    expect([b.fill, b.text]).toEqual(["#ffaa00", "Degraded"]);
    expect(c.fill).toBeNull();
    expect(c.text).toBe("lost");
    expect(result.options.tooltip.formatter({ seriesIndex: 0, data: c })).toContain(
      "Not a number and no value mapping matches it",
    );
  });

  it("paints a mapping's pale table swatch at full strength, and a text colour alone as the fill", () => {
    expect(hostmapMappingFill({ color: "#fef2f2" })).toBe("#b91c1c");
    expect(hostmapMappingFill({ color: "#F0FDF4" })).toBe("#15803d");
    expect(hostmapMappingFill({ color: "#123456" })).toBe("#123456");
    expect(hostmapMappingFill({ textColor: "#b91c1c" })).toBe("#b91c1c");
    expect(hostmapMappingFill({ text: "OK" })).toBeNull();
    const result = convertHostmapData(
      sqlPanel(
        {
          mappings: [
            { type: "value", value: "degraded", color: "#fef2f2", textColor: "#b91c1c" },
            { type: "value", value: "ok", textColor: "#15803d" },
          ],
        },
        0,
      ),
      [[sqlRow("a", "", "", "degraded"), sqlRow("b", "", "", "ok")]],
      store(),
    );
    const [a, b] = cellsOf(result);
    expect([a.fill, b.fill]).toEqual(["#b91c1c", "#15803d"]);
    expect(a.textColor).not.toBe("#b91c1c");
    expect(result.options.series.slice(2).map((series: any) => series.itemStyle.color)).toEqual([
      "#b91c1c",
      "#15803d",
    ]);
  });

  it("says the value must be numeric or mapped when no cell can be coloured", () => {
    expect(() =>
      convertHostmapData(sqlPanel({}, 0), [[sqlRow("a", "", "", "ok")]], store()),
    ).toThrow("Value field must be numeric or mapped");
  });

  it("puts the unit on the scale, thresholds and tooltip, and colours by the value as shown", () => {
    const panel = sqlPanel(
      {
        unit: "custom",
        unit_custom: "°C",
        decimals: 0,
        thresholds: {
          mode: "absolute",
          baseColor: "#ffaa00",
          steps: [{ value: 85, color: "#ff0000" }],
        },
      },
      0,
    );
    const result = convertHostmapData(panel, [[sqlRow("a", "", "", 84.6)]], store());
    const [a] = cellsOf(result);
    expect(a.formatted).toBe("85°C");
    expect(a.fill).toBe("#ff0000");
    expect(result.options.legend.data).toEqual(["Below 85°C", "85°C or more"]);

    const scale = convertHostmapData(
      sqlPanel({ unit: "custom", unit_custom: "W", decimals: 0 }, 0),
      [[sqlRow("a", "", "", 219), sqlRow("b", "", "", 384)]],
      store(),
    );
    expect(scale.options.visualMap.text).toEqual(["384W", "219W"]);
  });

  it("skips a group level that no row fills, such as a stale breakdown", () => {
    const leveled = dropEmptyGroupLevels([entity("a", 1, ["r1", ""]), entity("b", 2, ["r2", ""])]);
    expect(leveled.map((e) => e.groups)).toEqual([["r1"], ["r2"]]);
    const result = convertHostmapData(
      sqlPanel(),
      [[{ x_axis_1: "a", breakdown_1: "r1", y_axis_1: 1 }]],
      store(),
    );
    expect(result.options.series[1].data).toHaveLength(1);
    expect(cellsOf(result)[0].groups).toEqual(["r1"]);
  });

  it("draws cell gaps with the subtle border token, so they stay quiet in dark mode", () => {
    const result = convertHostmapData(sqlPanel({}, 0), [[sqlRow("a", "", "", 1)]], store());
    expect(result.options.series[0].renderItem({ dataIndex: 0 }, api()).style.stroke).toBe(
      "--color-border-subtle",
    );
  });
});

describe("hostmap PromQL series limit", () => {
  it("loads and draws 512 series as 512 cells with no truncation notice, past the default 100", () => {
    const zoConfig = { max_dashboard_series: 100 };
    const maxSeries = promqlSeriesCap("hostmap", zoConfig);
    expect(maxSeries).toBe(HOSTMAP_MAX_CELLS);
    const processor = createPromQLChunkProcessor({ maxSeries, enableLogging: false });
    const chunk = {
      resultType: "matrix",
      result: Array.from({ length: 512 }, (_, i) =>
        series({ gpu_uuid: `GPU-${i}`, host: `h${Math.floor(i / 8)}`, rack: `r${i % 8}` }, [
          [1, String(40 + (i % 50))],
        ]),
      ),
    };
    const loaded = processor.processChunk(null, chunk);
    expect(loaded.result).toHaveLength(512);
    const stats = processor.getStats();
    const result = convertHostmapData(
      promqlPanel({ hostmap_entity_label: "gpu_uuid", hostmap_group_by: ["rack", "host"] }),
      [loaded],
      store(zoConfig),
      { seriesLimiting: { ...stats, maxSeries } },
    );
    expect(cellsOf(result)).toHaveLength(512);
    expect(result.extras.seriesLimit).toBeUndefined();
  });
});
