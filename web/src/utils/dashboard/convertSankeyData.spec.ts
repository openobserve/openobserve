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

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { convertSankeyData } from "./convertSankeyData";
import { getColorPalette, getSeriesColor } from "./colorPalette";

// Mock the convertDataIntoUnitValue module
vi.mock("./convertDataIntoUnitValue", () => ({
  formatUnitValue: vi.fn((value) => `formatted_${value}`),
  getUnitValue: vi.fn((value) => `unit_${value}`),
}));

describe("convertSankeyData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Input validation", () => {
    it("should return null options when searchQueryData is not an array", () => {
      const panelSchema = {
        queries: [
          {
            fields: {
              source: { alias: "source" },
              target: { alias: "target" },
              value: { alias: "value" },
            },
          },
        ],
      };
      const searchQueryData = null;

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result).toEqual({ options: null });
    });

    it("should return null options when searchQueryData is empty array", () => {
      const panelSchema = {
        queries: [
          {
            fields: {
              source: { alias: "source" },
              target: { alias: "target" },
              value: { alias: "value" },
            },
          },
        ],
      };
      const searchQueryData: any[] = [];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result).toEqual({ options: null });
    });

    it("should return null options when first element of searchQueryData is falsy", () => {
      const panelSchema = {
        queries: [
          {
            fields: {
              source: { alias: "source" },
              target: { alias: "target" },
              value: { alias: "value" },
            },
          },
        ],
      };
      const searchQueryData = [null];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result).toEqual({ options: null });
    });

    it("should return null options when source field is missing", () => {
      const panelSchema = {
        queries: [
          {
            fields: {
              target: { alias: "target" },
              value: { alias: "value" },
            },
          },
        ],
      };
      const searchQueryData = [{}];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result).toEqual({ options: null });
    });

    it("should return null options when target field is missing", () => {
      const panelSchema = {
        queries: [
          {
            fields: {
              source: { alias: "source" },
              value: { alias: "value" },
            },
          },
        ],
      };
      const searchQueryData = [{}];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result).toEqual({ options: null });
    });

    it("should return null options when value field is missing", () => {
      const panelSchema = {
        queries: [
          {
            fields: {
              source: { alias: "source" },
              target: { alias: "target" },
            },
          },
        ],
      };
      const searchQueryData = [{}];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result).toEqual({ options: null });
    });
  });

  describe("Data processing", () => {
    it("should process valid sankey data successfully", () => {
      const panelSchema = {
        queries: [
          {
            fields: {
              source: { alias: "source_field" },
              target: { alias: "target_field" },
              value: { alias: "value_field" },
            },
          },
        ],
        config: {
          unit: "bytes",
          unit_custom: null,
          decimals: 2,
        },
      };
      const searchQueryData = [
        [
          {
            source_field: "A",
            target_field: "B",
            value_field: 100,
          },
          {
            source_field: "B",
            target_field: "C",
            value_field: 200,
          },
        ],
      ];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result.options).not.toBeNull();
      expect(result.options.series).toHaveLength(1);
      expect(result.options.series[0].type).toBe("sankey");
      expect(result.options.series[0].data).toHaveLength(3); // A, B, C nodes
      expect(result.options.series[0].links).toHaveLength(2);

      // Check nodes
      const nodeNames = result.options.series[0].data.map((node: any) => node.name);
      expect(nodeNames).toContain("A");
      expect(nodeNames).toContain("B");
      expect(nodeNames).toContain("C");

      // Check links
      expect(result.options.series[0].links).toEqual([
        {
          source: "A",
          target: "B",
          value: 100,
          rawSource: "A",
          rawTarget: "B",
          isReturn: false,
          lineStyle: { curveness: 0.5 },
        },
        {
          source: "B",
          target: "C",
          value: 200,
          rawSource: "B",
          rawTarget: "C",
          isReturn: false,
          lineStyle: { curveness: 0.5 },
        },
      ]);
    });

    it("should filter out items with null source values", () => {
      const panelSchema = {
        queries: [
          {
            fields: {
              source: { alias: "source_field" },
              target: { alias: "target_field" },
              value: { alias: "value_field" },
            },
          },
        ],
      };
      const searchQueryData = [
        [
          {
            source_field: null,
            target_field: "B",
            value_field: 100,
          },
          {
            source_field: "A",
            target_field: "B",
            value_field: 200,
          },
        ],
      ];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result.options.series[0].links).toHaveLength(1);
      expect(result.options.series[0].links[0].source).toBe("A");
    });

    it("should filter out items with null target values", () => {
      const panelSchema = {
        queries: [
          {
            fields: {
              source: { alias: "source_field" },
              target: { alias: "target_field" },
              value: { alias: "value_field" },
            },
          },
        ],
      };
      const searchQueryData = [
        [
          {
            source_field: "A",
            target_field: null,
            value_field: 100,
          },
          {
            source_field: "A",
            target_field: "B",
            value_field: 200,
          },
        ],
      ];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result.options.series[0].links).toHaveLength(1);
      expect(result.options.series[0].links[0].target).toBe("B");
    });

    it("should filter out items with null value values", () => {
      const panelSchema = {
        queries: [
          {
            fields: {
              source: { alias: "source_field" },
              target: { alias: "target_field" },
              value: { alias: "value_field" },
            },
          },
        ],
      };
      const searchQueryData = [
        [
          {
            source_field: "A",
            target_field: "B",
            value_field: null,
          },
          {
            source_field: "A",
            target_field: "C",
            value_field: 200,
          },
        ],
      ];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result.options.series[0].links).toHaveLength(1);
      expect(result.options.series[0].links[0].value).toBe(200);
    });

    it("should skip items with an empty-string source", () => {
      const panelSchema = {
        queries: [
          {
            fields: {
              source: { alias: "source_field" },
              target: { alias: "target_field" },
              value: { alias: "value_field" },
            },
          },
        ],
      };
      const searchQueryData = [
        [
          {
            source_field: "", // Falsy but not null
            target_field: "B",
            value_field: 100,
          },
          {
            source_field: "A",
            target_field: "B",
            value_field: 200,
          },
        ],
      ];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result.options.series[0].links).toHaveLength(1);
      expect(result.options.series[0].links[0].source).toBe("A");
    });

    it("should skip items with an empty-string target", () => {
      const panelSchema = {
        queries: [
          {
            fields: {
              source: { alias: "source_field" },
              target: { alias: "target_field" },
              value: { alias: "value_field" },
            },
          },
        ],
      };
      const searchQueryData = [
        [
          {
            source_field: "A",
            target_field: "", // Falsy but not null
            value_field: 100,
          },
          {
            source_field: "A",
            target_field: "B",
            value_field: 200,
          },
        ],
      ];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result.options.series[0].links).toHaveLength(1);
      expect(result.options.series[0].links[0].target).toBe("B");
    });

    it("should skip items with a zero value", () => {
      const panelSchema = {
        queries: [
          {
            fields: {
              source: { alias: "source_field" },
              target: { alias: "target_field" },
              value: { alias: "value_field" },
            },
          },
        ],
      };
      const searchQueryData = [
        [
          {
            source_field: "A",
            target_field: "B",
            value_field: 0, // Falsy but not null
          },
          {
            source_field: "A",
            target_field: "C",
            value_field: 200,
          },
        ],
      ];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result.options.series[0].links).toHaveLength(1);
      expect(result.options.series[0].links[0].value).toBe(200);
    });
  });

  describe("Tooltip formatter", () => {
    it("should format tooltip with unit value when functions are available", () => {
      const panelSchema = {
        queries: [
          {
            fields: {
              source: { alias: "source_field" },
              target: { alias: "target_field" },
              value: { alias: "value_field" },
            },
          },
        ],
        config: {
          unit: "bytes",
          unit_custom: null,
          decimals: 2,
        },
      };
      const searchQueryData = [
        [
          {
            source_field: "A",
            target_field: "B",
            value_field: 1024,
          },
        ],
      ];

      const result = convertSankeyData(panelSchema, searchQueryData);

      // Test the tooltip formatter
      const tooltipFormatter = result.options.tooltip.formatter;
      const mockParams = {
        dataType: "node",
        name: "TestNode",
        data: { name: "TestNode", rawName: "TestNode" },
        value: 1024,
      };

      const formattedTooltip = tooltipFormatter(mockParams);

      // Since we have mocked functions at the top, they will be available
      expect(formattedTooltip).toBe("TestNode : formatted_unit_1024");
    });

    it("should escape HTML in node and link names", () => {
      const panelSchema = {
        queries: [
          {
            fields: {
              source: { alias: "source_field" },
              target: { alias: "target_field" },
              value: { alias: "value_field" },
            },
          },
        ],
        config: {},
      };
      const payload = '<img src=x onerror="alert(1)">';
      const searchQueryData = [[{ source_field: payload, target_field: "B", value_field: 1 }]];

      const result = convertSankeyData(panelSchema, searchQueryData);
      const nodeTooltip = result.options.tooltip.formatter({
        dataType: "node",
        data: result.options.series[0].data[0],
        value: 1,
      });
      const edgeTooltip = result.options.tooltip.formatter({
        dataType: "edge",
        data: result.options.series[0].links[0],
        value: 1,
      });

      for (const formattedTooltip of [nodeTooltip, edgeTooltip]) {
        expect(formattedTooltip).not.toContain("<img");
        expect(formattedTooltip).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
      }
    });

    it("should handle basic tooltip structure", () => {
      const panelSchema = {
        queries: [
          {
            fields: {
              source: { alias: "source_field" },
              target: { alias: "target_field" },
              value: { alias: "value_field" },
            },
          },
        ],
      };
      const searchQueryData = [
        [
          {
            source_field: "A",
            target_field: "B",
            value_field: 1024,
          },
        ],
      ];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result.options.tooltip).toBeDefined();
      expect(result.options.tooltip.trigger).toBe("item");
      expect(typeof result.options.tooltip.formatter).toBe("function");
    });
  });

  describe("Multiple queries", () => {
    it("should handle multiple queries with data", () => {
      const panelSchema = {
        queries: [
          {
            fields: {
              source: { alias: "source_field" },
              target: { alias: "target_field" },
              value: { alias: "value_field" },
            },
          },
          {
            fields: {
              source: { alias: "source_field" },
              target: { alias: "target_field" },
              value: { alias: "value_field" },
            },
          },
        ],
      };
      const searchQueryData = [
        [
          {
            source_field: "A",
            target_field: "B",
            value_field: 100,
          },
        ],
        [
          {
            source_field: "C",
            target_field: "D",
            value_field: 200,
          },
        ],
      ];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result.options.series[0].data).toHaveLength(4); // A, B, C, D nodes
      expect(result.options.series[0].links).toHaveLength(2);

      const nodeNames = result.options.series[0].data.map((node: any) => node.name);
      expect(nodeNames).toContain("A");
      expect(nodeNames).toContain("B");
      expect(nodeNames).toContain("C");
      expect(nodeNames).toContain("D");
    });

    it("should handle empty query data in multiple queries", () => {
      const panelSchema = {
        queries: [
          {
            fields: {
              source: { alias: "source_field" },
              target: { alias: "target_field" },
              value: { alias: "value_field" },
            },
          },
          {
            fields: {
              source: { alias: "source_field" },
              target: { alias: "target_field" },
              value: { alias: "value_field" },
            },
          },
        ],
      };
      const searchQueryData = [
        [
          {
            source_field: "A",
            target_field: "B",
            value_field: 100,
          },
        ],
        [], // Empty second query
      ];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result.options.series[0].data).toHaveLength(2); // Only A, B nodes
      expect(result.options.series[0].links).toHaveLength(1);
    });
  });

  describe("Edge cases", () => {
    it("should handle duplicate nodes correctly", () => {
      const panelSchema = {
        queries: [
          {
            fields: {
              source: { alias: "source_field" },
              target: { alias: "target_field" },
              value: { alias: "value_field" },
            },
          },
        ],
      };
      const searchQueryData = [
        [
          {
            source_field: "A",
            target_field: "B",
            value_field: 100,
          },
          {
            source_field: "A", // Duplicate source
            target_field: "C",
            value_field: 200,
          },
          {
            source_field: "B", // B appears as both source and target
            target_field: "C",
            value_field: 150,
          },
        ],
      ];

      const result = convertSankeyData(panelSchema, searchQueryData);

      // Should have unique nodes only
      expect(result.options.series[0].data).toHaveLength(3); // A, B, C (unique)
      expect(result.options.series[0].links).toHaveLength(3);

      const nodeNames = result.options.series[0].data.map((node: any) => node.name);
      expect(nodeNames).toContain("A");
      expect(nodeNames).toContain("B");
      expect(nodeNames).toContain("C");
    });

    it("should verify series configuration properties", () => {
      const panelSchema = {
        queries: [
          {
            fields: {
              source: { alias: "source_field" },
              target: { alias: "target_field" },
              value: { alias: "value_field" },
            },
          },
        ],
      };
      const searchQueryData = [
        [
          {
            source_field: "A",
            target_field: "B",
            value_field: 100,
          },
        ],
      ];

      const result = convertSankeyData(panelSchema, searchQueryData);

      expect(result.options.series[0].type).toBe("sankey");
      expect(result.options.series[0].layout).toBe("none");
      expect(result.options.series[0].emphasis.focus).toBe("adjacency");
      expect(result.options.backgroundColor).toBe("transparent");
    });
  });
  describe("Cycles and duplicate links", () => {
    const schema = (config: any = {}) => ({
      queries: [
        {
          fields: {
            source: { alias: "s" },
            target: { alias: "t" },
            value: { alias: "v" },
          },
        },
      ],
      config,
    });
    const rows = (...links: [any, any, any][]) => [links.map(([s, t, v]) => ({ s, t, v }))];
    const series = (result: any) => result.options.series[0];

    it("sums duplicate source-target pairs across rows and queries", () => {
      const panelSchema = schema();
      panelSchema.queries.push(panelSchema.queries[0]);
      const result: any = convertSankeyData(panelSchema, [
        rows(["A", "B", 10], ["A", "B", 5])[0],
        rows(["A", "B", 2])[0],
      ]);

      expect(series(result).links).toHaveLength(1);
      expect(series(result).links[0].value).toBe(17);
      expect(result.extras.sankeyNotice.returnLinks).toBe(0);
    });

    it("redirects the closing link of an A-B cycle to a return node and keeps the real names", () => {
      const result: any = convertSankeyData(schema(), rows(["A", "B", 10], ["B", "A", 4]));
      const back = series(result).links.find((link: any) => link.isReturn);
      const returnNode = series(result).data.find((node: any) => node.isReturn);

      expect(result.extras.sankeyNotice.returnLinks).toBe(1);
      expect(back).toMatchObject({ source: "B", rawSource: "B", rawTarget: "A", value: 4 });
      expect(back.target).toBe(returnNode.name);
      expect(returnNode.name).not.toBe("A");
      expect(returnNode.rawName).toBe("A");
      expect(series(result).data.filter((node: any) => node.rawName === "A")).toHaveLength(2);
    });

    it("redirects a self-loop to a return node", () => {
      const result: any = convertSankeyData(schema(), rows(["A", "A", 3], ["A", "B", 1]));
      const loop = series(result).links.find((link: any) => link.rawTarget === "A");

      expect(result.extras.sankeyNotice.returnLinks).toBe(1);
      expect(loop.isReturn).toBe(true);
      expect(loop.source).toBe("A");
      expect(loop.target).not.toBe("A");
    });

    it("starts from natural sources, so the link into the entry node is the one redirected", () => {
      const result: any = convertSankeyData(
        schema(),
        rows(["B", "C", 1], ["C", "B", 1], ["A", "B", 5]),
      );
      const back = series(result).links.filter((link: any) => link.isReturn);

      expect(back).toHaveLength(1);
      expect(back[0]).toMatchObject({ rawSource: "C", rawTarget: "B" });
    });

    it("finds cycles with no zero in-degree entry point and shares one return node per target", () => {
      const result: any = convertSankeyData(
        schema(),
        rows(["A", "B", 5], ["B", "C", 5], ["C", "A", 1], ["B", "A", 1]),
      );
      const back = series(result).links.filter((link: any) => link.isReturn);

      expect(result.extras.sankeyNotice.returnLinks).toBe(2);
      expect(back.map((link: any) => link.rawTarget)).toEqual(["A", "A"]);
      expect(new Set(back.map((link: any) => link.target)).size).toBe(1);
      expect(series(result).data.filter((node: any) => node.isReturn)).toHaveLength(1);
    });

    it("leaves an acyclic multi-stage flow unchanged", () => {
      const result: any = convertSankeyData(
        schema(),
        rows(["A", "B", 1], ["B", "C", 1], ["A", "C", 1]),
      );

      expect(result.extras.sankeyNotice.returnLinks).toBe(0);
      expect(series(result).data.map((node: any) => node.name)).toEqual(["A", "B", "C"]);
      expect(series(result).links.every((link: any) => link.source === link.rawSource)).toBe(true);
      expect(series(result).links.every((link: any) => link.target === link.rawTarget)).toBe(true);
    });

    it("keeps numeric zero names and drops non-positive or non-numeric values", () => {
      const result: any = convertSankeyData(
        schema(),
        rows([0, "B", 2], ["A", "B", -1], ["A", "C", "x"], ["A", "D", "3"]),
      );

      expect(
        series(result).links.map((link: any) => [link.source, link.target, link.value]),
      ).toEqual([
        ["0", "B", 2],
        ["A", "D", 3],
      ]);
      expect(result.extras.sankeyNotice.skippedRows).toBe(2);
    });

    it("returns null options but reports the skipped rows when no link survives", () => {
      expect(convertSankeyData(schema(), rows(["A", "B", 0], [null, "B", 1]))).toEqual({
        options: null,
        extras: { sankeyNotice: { returnLinks: 0, skippedRows: 2 } },
      });
    });

    it("gives the same layout, return links and colours whatever the row order", () => {
      const flows: [any, any, any][] = [
        ["A", "B", 10],
        ["B", "C", 10],
        ["C", "A", 5],
        ["X", "Y", 8],
        ["Y", "X", 6],
        ["P", "X", 3],
        ["Q", "Y", 2],
      ];
      const ascending = convertSankeyData(
        schema({ color: { mode: "palette-classic" } }),
        rows(...flows),
      );
      const descending = convertSankeyData(
        schema({ color: { mode: "palette-classic" } }),
        rows(...[...flows].reverse()),
      );
      const shape = (result: any) => ({
        nodes: series(result).data,
        links: series(result).links,
        notice: result.extras.sankeyNotice,
      });

      expect(shape(descending)).toEqual(shape(ascending));
      expect(
        series(ascending)
          .links.filter((link: any) => link.isReturn)
          .map((link: any) => [link.rawSource, link.rawTarget]),
      ).toEqual([
        ["C", "A"],
        ["Y", "X"],
      ]);
    });

    it("redirects the lighter link of a two-node loop, whichever row comes first", () => {
      for (const order of [
        rows(["A", "B", 4], ["B", "A", 10]),
        rows(["B", "A", 10], ["A", "B", 4]),
      ]) {
        const back = series(convertSankeyData(schema(), order)).links.filter(
          (link: any) => link.isReturn,
        );
        expect(back.map((link: any) => [link.rawSource, link.rawTarget])).toEqual([["A", "B"]]);
      }
    });

    it("produces a graph the sankey layout accepts", async () => {
      const echarts = await import("echarts");
      const result: any = convertSankeyData(
        schema(),
        rows(["A", "B", 10], ["B", "A", 4], ["B", "B", 1], ["B", "C", 3], ["C", "A", 2]),
      );
      const chart = echarts.init(null, null, {
        renderer: "svg",
        ssr: true,
        width: 400,
        height: 300,
      });

      expect(() => chart.setOption(result.options)).not.toThrow();
      chart.dispose();
    });
  });

  describe("Colours and labels", () => {
    const schema = (config: any = {}) => ({
      queries: [
        {
          fields: {
            source: { alias: "s" },
            target: { alias: "t" },
            value: { alias: "v" },
          },
        },
      ],
      config,
    });

    it("colours nodes from the panel palette by name and links by their source", () => {
      const result: any = convertSankeyData(schema(), [
        [
          { s: "A", t: "B", v: 1 },
          { s: "B", t: "A", v: 1 },
        ],
      ]);
      const palette = getColorPalette();
      const [a, b, returnA] = result.options.series[0].data;

      expect(palette).toContain(a.itemStyle.color);
      expect(a.itemStyle.color).toBe(getSeriesColor(null, "A", 0, 0, 0, ""));
      expect(b.itemStyle.color).toBe(getSeriesColor(null, "B", 0, 0, 0, ""));
      expect(returnA.itemStyle.color).toBe(a.itemStyle.color);
      expect(result.options.series[0].lineStyle.color).toBe("source");
    });

    it("assigns palette colours by first appearance in classic palette mode", () => {
      const result: any = convertSankeyData(schema({ color: { mode: "palette-classic" } }), [
        [
          { s: "X", t: "Y", v: 1 },
          { s: "Y", t: "Z", v: 1 },
        ],
      ]);
      const palette = getColorPalette();

      expect(result.options.series[0].data.map((node: any) => node.itemStyle.color)).toEqual(
        palette.slice(0, 3),
      );
    });

    it("labels nodes with their real name and the unit-formatted value", () => {
      const result: any = convertSankeyData(schema({ unit: "bytes", decimals: 1 }), [
        [
          { s: "A", t: "B", v: 4 },
          { s: "B", t: "A", v: 2 },
        ],
      ]);
      const series = result.options.series[0];
      const formatter = series.label.formatter;

      expect(formatter({ data: series.data[0], value: 4 })).toBe("A: formatted_unit_4");
      expect(formatter({ data: series.data[2], value: 2 })).toBe("A \u21a9: formatted_unit_2");
    });

    it("places sink and return node labels inside the chart", () => {
      const result: any = convertSankeyData(schema(), [
        [
          { s: "A", t: "B", v: 4 },
          { s: "B", t: "C", v: 2 },
          { s: "B", t: "A", v: 1 },
        ],
      ]);
      const labels = Object.fromEntries(
        result.options.series[0].data.map((node: any) => [
          node.isReturn ? `${node.rawName}-return` : node.name,
          node.label?.position,
        ]),
      );

      expect(labels).toEqual({ A: undefined, B: undefined, C: "left", "A-return": "left" });
    });

    it("names return links by their real endpoints in the tooltip", () => {
      const result: any = convertSankeyData(schema(), [
        [
          { s: "A", t: "B", v: 4 },
          { s: "B", t: "A", v: 2 },
        ],
      ]);
      const back = result.options.series[0].links[1];

      expect(result.options.tooltip.formatter({ dataType: "edge", data: back, value: 2 })).toBe(
        "B &gt; A \u21a9 : formatted_unit_2",
      );
    });
  });
});
