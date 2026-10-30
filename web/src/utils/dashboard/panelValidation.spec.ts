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
  validateConditions,
  validateDashboardJson,
  validatePanel,
  validateSQLPanelFields,
} from "@/utils/dashboard/panelValidation";
import { gt } from "@/types/i18n";
import { MAX_ANNOTATION_SOURCES } from "@/utils/dashboard/annotationSources";

vi.mock("@/utils/dashboard/convertDashboardSchemaVersion", () => ({
  CURRENT_DASHBOARD_SCHEMA_VERSION: "v3",
}));

vi.mock("@/components/dashboards/addPanel/dynamicFunction/functionValidation.json", () => ({
  default: [],
}));

describe("panelValidation", () => {
  describe("validateDashboardJson", () => {
    const validDashboard = {
      dashboardId: "dash-001",
      title: "Test Dashboard",
      version: "v3",
      tabs: [
        {
          tabId: "tab-001",
          name: "Tab 1",
          panels: [
            {
              id: "panel-001",
              type: "bar",
              title: "Test Panel",
              layout: { i: "panel-001", x: 0, y: 0, w: 12, h: 6 },
            },
          ],
        },
      ],
    };

    it("returns no errors for valid dashboard", () => {
      const errors = validateDashboardJson(gt, validDashboard);
      expect(errors).toEqual([]);
    });

    it("accepts a numeric layout.i of 0", () => {
      const tabs = [
        {
          ...validDashboard.tabs[0],
          panels: [
            { ...validDashboard.tabs[0].panels[0], layout: { i: 0, x: 0, y: 0, w: 12, h: 6 } },
          ],
        },
      ];
      const errors = validateDashboardJson(gt, { ...validDashboard, tabs });
      expect(errors).toEqual([]);
    });

    it("accepts valid annotationSources and reports broken ones", () => {
      const source = {
        id: "s1",
        name: "Deploys",
        enabled: true,
        mode: "builder",
        streamType: "logs",
        stream: "k8s_events",
        title: "{service}",
      };
      expect(validateDashboardJson(gt, { ...validDashboard, annotationSources: [source] })).toEqual(
        [],
      );
      expect(
        validateDashboardJson(gt, {
          ...validDashboard,
          annotationSources: [{ ...source, mode: "sql", query: "" }],
        }),
      ).toEqual(["Annotation source 1: Enter a query"]);
      expect(validateDashboardJson(gt, { ...validDashboard, annotationSources: "x" })).toEqual([
        "annotationSources must be an array",
      ]);
    });

    it("rejects annotationSources over the cap and a duplicate id", () => {
      const source = {
        id: "s1",
        name: "Deploys",
        enabled: true,
        mode: "builder",
        streamType: "logs",
        stream: "k8s_events",
        title: "{service}",
      };
      const atCap = Array.from({ length: MAX_ANNOTATION_SOURCES }, (_, i) => ({
        ...source,
        id: `s${i}`,
        name: `Source ${i}`,
      }));
      expect(validateDashboardJson(gt, { ...validDashboard, annotationSources: atCap })).toEqual(
        [],
      );

      const overCap = [...atCap, { ...source, id: "over", name: "Over" }];
      expect(validateDashboardJson(gt, { ...validDashboard, annotationSources: overCap })).toEqual([
        `A dashboard can have at most ${MAX_ANNOTATION_SOURCES} annotation sources.`,
      ]);

      expect(
        validateDashboardJson(gt, {
          ...validDashboard,
          annotationSources: [source, { ...source, name: "Deploys again" }],
        }),
      ).toEqual(["Annotation source 2: ID s1 is used more than once"]);
    });

    it("returns error for null dashboard", () => {
      const errors = validateDashboardJson(gt, null);
      expect(errors).toContain("Dashboard JSON is empty or invalid");
    });

    it("returns error for undefined dashboard", () => {
      const errors = validateDashboardJson(gt, undefined);
      expect(errors).toContain("Dashboard JSON is empty or invalid");
    });

    it("returns error for missing dashboardId", () => {
      const errors = validateDashboardJson(gt, { ...validDashboard, dashboardId: undefined });
      expect(errors).toContain("Dashboard ID is required");
    });

    it("returns error for missing title", () => {
      const errors = validateDashboardJson(gt, { ...validDashboard, title: undefined });
      expect(errors).toContain("Dashboard title is required");
    });

    it("returns error for missing version", () => {
      const errors = validateDashboardJson(gt, { ...validDashboard, version: undefined });
      expect(errors).toContain("Dashboard version is required");
    });

    it("returns error for wrong version", () => {
      const errors = validateDashboardJson(gt, { ...validDashboard, version: "v1" });
      expect(errors.some((e) => e.includes("v3"))).toBe(true);
    });

    it("returns error for missing tabs", () => {
      const errors = validateDashboardJson(gt, { ...validDashboard, tabs: undefined });
      expect(errors).toContain("Dashboard must have at least one tab");
    });

    it("returns error for empty tabs array", () => {
      const errors = validateDashboardJson(gt, { ...validDashboard, tabs: [] });
      expect(errors).toContain("Dashboard must have at least one tab");
    });

    it("returns error for tab missing tabId", () => {
      const dashboard = {
        ...validDashboard,
        tabs: [{ name: "Tab 1", panels: [] }],
      };
      const errors = validateDashboardJson(gt, dashboard);
      expect(errors).toContain("Each tab must have a tabId");
    });

    it("returns error for tab missing name", () => {
      const dashboard = {
        ...validDashboard,
        tabs: [{ tabId: "tab-001", panels: [] }],
      };
      const errors = validateDashboardJson(gt, dashboard);
      expect(errors.some((e) => e.includes("must have a name"))).toBe(true);
    });

    it("returns error for duplicate tab IDs", () => {
      const dashboard = {
        ...validDashboard,
        tabs: [
          { tabId: "tab-001", name: "Tab 1", panels: [] },
          { tabId: "tab-001", name: "Tab 2", panels: [] },
        ],
      };
      const errors = validateDashboardJson(gt, dashboard);
      expect(errors.some((e) => e.includes("Duplicate tab ID"))).toBe(true);
    });

    it("returns error for panel missing ID", () => {
      const dashboard = {
        ...validDashboard,
        tabs: [
          {
            tabId: "tab-001",
            name: "Tab 1",
            panels: [{ layout: { i: "panel-001" } }], // no id
          },
        ],
      };
      const errors = validateDashboardJson(gt, dashboard);
      expect(errors.some((e) => e.includes("missing an ID"))).toBe(true);
    });

    it("returns error for duplicate panel IDs", () => {
      const dashboard = {
        ...validDashboard,
        tabs: [
          {
            tabId: "tab-001",
            name: "Tab 1",
            panels: [
              { id: "panel-001", layout: { i: "panel-001" } },
              { id: "panel-001", layout: { i: "panel-001" } },
            ],
          },
        ],
      };
      const errors = validateDashboardJson(gt, dashboard);
      expect(errors.some((e) => e.includes("Duplicate panel ID"))).toBe(true);
    });

    it("can return multiple errors", () => {
      const errors = validateDashboardJson(gt, {
        version: "v3",
        tabs: [{ tabId: "t1", name: "T", panels: [] }],
        // no dashboardId, no title
      });
      expect(errors.length).toBeGreaterThan(1);
    });

    it("returns error when tab panels is not an array", () => {
      const dashboard = {
        ...validDashboard,
        tabs: [{ tabId: "tab-001", name: "Tab 1", panels: null }],
      };
      const errors = validateDashboardJson(gt, dashboard);
      expect(errors.some((e) => e.includes("must have a panels array"))).toBe(true);
    });
  });

  /**
   * openobserve#2188 — a gauge panel whose fields are wrong shows a validation
   * message instead of a chart. `panelValidation.ts` has a `case "gauge"` branch
   * for exactly that, and before this block the whole suite had NO gauge case:
   * deleting either rule left every test green. The rules are asymmetric and easy
   * to get backwards — a gauge needs EXACTLY one value field, but zero OR one
   * label field — so each edge is pinned here rather than just the happy path.
   */
  describe("validateSQLPanelFields — gauge field rules", () => {
    const panel = (fields: any) => ({
      type: "gauge",
      queryType: "sql",
      queries: [{ customQuery: false, fields }],
    });
    const errorsFor = (fields: any, pageKey?: string) => {
      const errors: string[] = [];
      validateSQLPanelFields(gt, panel(fields), 0, "X", "Y", errors, true, pageKey);
      return errors;
    };
    // `type: "raw"` short-circuits the per-field aggregation-function check, which
    // this file mocks `functionValidation.json` to an empty list for — without it every
    // field would fail that check and drown out the gauge rules under test.
    const field = (alias: string) => ({
      alias,
      column: alias,
      label: alias,
      type: "raw",
      rawQuery: `count(${alias})`,
    });

    it("accepts exactly one value field and one label field", () => {
      expect(errorsFor({ x: [field("service")], y: [field("count")] })).toEqual([]);
    });

    it("accepts exactly one value field and no label field", () => {
      expect(errorsFor({ x: [], y: [field("count")] })).toEqual([]);
    });

    it("rejects a gauge with no value field", () => {
      const errors = errorsFor({ x: [field("service")], y: [] });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/value field/i);
    });

    it("rejects a gauge with more than one value field", () => {
      const errors = errorsFor({ x: [field("service")], y: [field("count"), field("total")] });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/value field/i);
    });

    it("rejects a gauge with more than one label field", () => {
      const errors = errorsFor({ x: [field("service"), field("pod")], y: [field("count")] });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/label field/i);
    });

    it("reports both rules when the value and label counts are each wrong", () => {
      const errors = errorsFor({ x: [field("service"), field("pod")], y: [] });
      expect(errors).toHaveLength(2);
    });

    it("uses the logs-page wording when validating from the logs page", () => {
      const errors = errorsFor({ x: [field("service")], y: [] }, "logs");
      expect(errors).toHaveLength(1);
      // The logs page has no X/Y axis vocabulary, so it must not borrow the
      // dashboard wording that names those axes.
      expect(errors[0]).not.toMatch(/gauge chart/i);
    });

    it("skips field validation for a custom query, which the user writes by hand", () => {
      const errors: string[] = [];
      validateSQLPanelFields(
        gt,
        {
          type: "gauge",
          queryType: "sql",
          queries: [{ customQuery: true, fields: { x: [], y: [] } }],
        },
        0,
        "X",
        "Y",
        errors,
      );
      expect(errors).toEqual([]);
    });
  });
});

describe("validateSQLPanelFields — host map field rules", () => {
  const field = (alias: string) => ({
    alias,
    column: alias,
    label: alias,
    type: "raw",
    rawQuery: `max(${alias})`,
  });
  const errorsFor = (fields: any) => {
    const errors: string[] = [];
    validateSQLPanelFields(
      gt,
      { type: "hostmap", queryType: "sql", queries: [{ customQuery: false, fields }] },
      0,
      "Entity",
      "Value",
      errors,
      true,
    );
    return errors;
  };

  it("accepts one entity, one value and up to two group fields", () => {
    expect(
      errorsFor({
        x: [field("gpu")],
        y: [field("temp")],
        breakdown: [field("rack"), field("host")],
      }),
    ).toEqual([]);
  });

  it("needs exactly one entity and one value", () => {
    expect(errorsFor({ x: [], y: [field("temp")], breakdown: [] })).toHaveLength(1);
    expect(errorsFor({ x: [field("gpu")], y: [], breakdown: [] })).toHaveLength(1);
  });

  it("rejects a third group level", () => {
    const errors = errorsFor({
      x: [field("gpu")],
      y: [field("temp")],
      breakdown: [field("dc"), field("rack"), field("host")],
    });
    expect(errors).toEqual(["Host map can group by at most 2 fields"]);
  });
});

describe("validatePanel on a PromQL formula", () => {
  const run = (queries: any[]) => {
    const errors: string[] = [];
    validatePanel(
      gt,
      { data: { type: "line", queryType: "promql", queries }, layout: { currentQueryIndex: 0 } },
      errors,
      true,
      [],
      "dashboard",
      { state: { zoConfig: {} } },
      () => true,
    );
    return errors.filter((e) => e.includes("is empty"));
  };

  it("accepts a formula whose query field is empty", () => {
    expect(
      run([
        { query: "up", config: {} },
        { query: "", config: { formula: "A * 2" } },
      ]),
    ).toEqual([]);
  });

  it("flags an empty formula", () => {
    expect(
      run([
        { query: "up", config: {} },
        { query: "", config: { formula: "" } },
      ]),
    ).toHaveLength(1);
  });
});

describe("validatePanel on heatmap settings", () => {
  const numericY = { alias: "y", args: [{ type: "field", value: { field: "took" } }] };
  const run = (config: any, { queryType = "sql", customQuery = false } = {}) => {
    const errors: string[] = [];
    validatePanel(
      gt,
      {
        data: {
          type: "heatmap",
          queryType,
          config,
          queries: [{ customQuery, query: "", fields: { y: [numericY] } }],
        },
        layout: { currentQueryIndex: 0 },
        meta: {
          streamFields: { groupedFields: [{ schema: [{ name: "took", type: "Int64" }] }] },
        },
      },
      errors,
      false,
      [],
      "dashboard",
      { state: { zoConfig: {} } },
      () => true,
    );
    return errors;
  };

  it("blocks a bucket size that would leave the builder query empty", () => {
    expect(run({ heatmap_y_bucket: { mode: "size", size: 0 } })).toEqual([
      gt("dashboard.utils.heatmapYBucketSizeInvalid"),
    ]);
    expect(
      run({ heatmap_y_bucket: { mode: "size", size: 1 }, heatmap_y_min: 0, heatmap_y_max: 1e6 }),
    ).toHaveLength(1);
  });

  it("blocks inverted y and colour ranges, which the renderer would silently ignore", () => {
    expect(
      run({ heatmap_y_bucket: { mode: "log", base: 10 }, heatmap_y_min: 9, heatmap_y_max: 1 }),
    ).toEqual([gt("dashboard.utils.heatmapYRangeInverted")]);
    expect(run({ heatmap_color_min: 50, heatmap_color_max: 5 }, { queryType: "promql" })).toContain(
      gt("dashboard.utils.heatmapColorRangeInverted"),
    );
  });

  it("ignores bucket settings that do not apply to custom SQL", () => {
    expect(run({ heatmap_y_bucket: { mode: "size", size: 0 } }, { customQuery: true })).toEqual([]);
    expect(run({ heatmap_color_min: 1, heatmap_color_max: 5 })).toEqual([]);
  });
});

describe("validateConditions", () => {
  const t = gt as any;

  it("flags a filter added without a value, including inside groups", () => {
    const errors: string[] = [];
    validateConditions(
      t,
      [
        {
          filterType: "group",
          conditions: [
            {
              filterType: "condition",
              type: "condition",
              column: "level",
              operator: "=",
              value: "",
            },
            { filterType: "condition", type: "list", column: "job", values: [] },
          ],
        },
      ],
      errors,
    );
    expect(errors).toHaveLength(2);
  });

  it("accepts complete conditions", () => {
    const errors: string[] = [];
    validateConditions(
      t,
      [{ filterType: "condition", type: "condition", column: "a", operator: "Is Null" }],
      errors,
    );
    expect(errors).toHaveLength(0);
  });
});

describe("validatePanel on cartesian settings", () => {
  const run = (config: any, { type = "line", queryType = "sql" } = {}) => {
    const errors: string[] = [];
    validatePanel(
      gt,
      {
        data: {
          type,
          queryType,
          config,
          queries: [
            {
              customQuery: true,
              query: "SELECT 1",
              fields: { x: [], y: [{ alias: "y_axis_1" }, { alias: "y_axis_2" }] },
            },
          ],
        },
        layout: { currentQueryIndex: 0 },
      },
      errors,
      false,
      [],
      "dashboard",
      { state: { zoConfig: {} } },
      () => true,
    );
    return errors;
  };

  it("accepts every supported value and an empty config", () => {
    expect(run({})).toEqual([]);
    expect(
      run({
        tooltip_mode: "single",
        tooltip_sort: "asc",
        y_axis_scale: "log",
        y_axis_log_base: 2,
        line_style: "dotted",
        y_axis_hard_min: 1,
        y_axis_hard_max: 5,
        connect_nulls_threshold: 60,
        bar_radius: 4,
        mark_area: [{ axis: "y", from: "1", to: "2" }],
      }),
    ).toEqual([]);
    expect(run({ stack_mode: "percent" }, { type: "stacked" })).toEqual([]);
    expect(run({ sort_order: "desc" }, { type: "h-bar" })).toEqual([]);
    // A panel switched from a state timeline keeps its tooltip mode.
    expect(run({ tooltip_mode: "all_rows" })).toEqual([]);
  });

  it("rejects unsupported choices", () => {
    expect(run({ y_axis_scale: "sqrt", y_axis_log_base: 3 })).toEqual([
      gt("dashboard.utils.unsupportedConfigValue", { setting: "y_axis_scale", value: "sqrt" }),
      gt("dashboard.utils.unsupportedConfigValue", { setting: "y_axis_log_base", value: "3" }),
    ]);
    expect(run({ stack_mode: "fill" }, { type: "stacked" })).toHaveLength(1);
  });

  it("rejects negative sizes, inverted soft ranges and a log axis from zero", () => {
    expect(run({ bar_radius: -1 })).toEqual([
      gt("dashboard.utils.configValueNotNegative", { setting: "bar_radius" }),
    ]);
    expect(run({ y_axis_hard_min: 5, y_axis_hard_max: 1 })).toEqual([
      gt("dashboard.utils.yAxisHardRangeInverted"),
    ]);
    expect(run({ y_axis_scale: "log", y_axis_min: 0 })).toEqual([
      gt("dashboard.utils.yAxisLogMinInvalid"),
    ]);
  });

  it("checks mark areas", () => {
    expect(run({ mark_area: [{ axis: "y", from: "1" }] })).toEqual([
      gt("dashboard.utils.markAreaIncomplete", { index: 1 }),
    ]);
    expect(run({ mark_area: [{ axis: "y", from: "low", to: "2" }] })).toEqual([
      gt("dashboard.utils.markAreaNotNumeric", { index: 1 }),
    ]);
    // The x axis of an h-bar is its value axis; its y axis holds category names.
    expect(run({ mark_area: [{ axis: "y", from: "a", to: "b" }] }, { type: "h-bar" })).toEqual([]);
  });

  it("checks scatter fields against the y fields", () => {
    expect(run({ scatter_size_field: "y_axis_2" }, { type: "scatter" })).toEqual([]);
    expect(run({ scatter_color_field: "nope" }, { type: "scatter" })).toEqual([
      gt("dashboard.utils.scatterFieldUnknown", { setting: "scatter_color_field" }),
    ]);
    expect(run({ scatter_size_min: 9, scatter_size_max: 2 }, { type: "scatter" })).toEqual([
      gt("dashboard.utils.scatterSizeRangeInverted"),
    ]);
  });

  it("skips charts that do not use the settings", () => {
    expect(run({ y_axis_scale: "sqrt" }, { type: "pie" })).toEqual([]);
  });
});

describe("validatePanel on metric, gauge, pie, table, heatmap, state timeline and geomap settings", () => {
  const run = (type: string, config: any) => {
    const errors: string[] = [];
    validatePanel(
      gt,
      {
        data: {
          type,
          queryType: "sql",
          config,
          queries: [
            { customQuery: true, query: "SELECT 1", fields: { x: [], y: [{ alias: "y" }] } },
          ],
        },
        layout: { currentQueryIndex: 0 },
      },
      errors,
      false,
      [],
      "dashboard",
      { state: { zoConfig: {} } },
      () => true,
    );
    return errors;
  };

  it("accepts every supported value", () => {
    expect(
      run("metric", {
        stat_text_mode: "value_and_name",
        value_font_size: 32,
      }),
    ).toEqual([]);
    expect(run("gauge", { gauge_style: "circle", gauge_segments: 10, gauge_neutral: -5 })).toEqual(
      [],
    );
    expect(
      run("donut", {
        pie_label_content: ["name", "percent"],
        pie_other_threshold: 5,
        donut_inner_radius: 60,
        sort_order: "asc",
      }),
    ).toEqual([]);
    expect(
      run("table", { table_density: "comfortable", table_footer_calcs: ["sum", "last"] }),
    ).toEqual([]);
    expect(run("heatmap", { heatmap_cell_gap: 0, heatmap_hide_below: -1 })).toEqual([]);
    expect(run("state-timeline", { state_value_align: "center" })).toEqual([]);
    expect(run("geomap", { map_cluster: true, map_cluster_radius: 60 })).toEqual([]);
  });

  it("accepts special value mappings with a known match and rejects any other", () => {
    const mappings = (match: unknown) => [
      { type: "value", value: "1", text: "One" },
      { type: "special", match, text: "x" },
    ];
    for (const match of ["null", "nan", "empty", "true", "false"]) {
      expect(run("table", { mappings: mappings(match) })).toEqual([]);
    }
    expect(run("metric", { mappings: mappings("zero") })).toEqual([
      gt("dashboard.utils.valueMappingSpecialInvalid", { index: 2 }),
    ]);
    expect(run("table", { mappings: mappings(undefined) })).toEqual([
      gt("dashboard.utils.valueMappingSpecialInvalid", { index: 2 }),
    ]);
  });

  it("rejects unsupported choices and list entries", () => {
    expect(run("metric", { stat_text_mode: "ratio" })).toEqual([
      gt("dashboard.utils.unsupportedConfigValue", { setting: "stat_text_mode", value: "ratio" }),
    ]);
    expect(run("table", { table_footer_calcs: ["sum", "median"] })).toEqual([
      gt("dashboard.utils.unsupportedConfigValue", {
        setting: "table_footer_calcs",
        value: "median",
      }),
    ]);
    expect(run("gauge", { gauge_style: "dial" })).toHaveLength(1);
    expect(run("state-timeline", { state_value_align: "justify" })).toHaveLength(1);
    expect(run("state-timeline", { state_timeline_display: "cells" })).toEqual([]);
    expect(run("state-timeline", { state_timeline_display: "grid" })).toHaveLength(1);
  });

  it("rejects out-of-range numbers", () => {
    expect(run("gauge", { gauge_segments: 1 })).toEqual([
      gt("dashboard.utils.configValueOutOfRange", {
        setting: "gauge_segments",
        min: "2",
        max: "100",
      }),
    ]);
    expect(run("donut", { donut_inner_radius: 99 })).toHaveLength(1);
    expect(run("pie", { pie_other_threshold: -1 })).toHaveLength(1);
    expect(run("metric", { value_font_size: 0 })).toHaveLength(1);
    expect(run("geomap", { map_cluster_radius: 0 })).toHaveLength(1);
    expect(run("heatmap", { heatmap_cell_gap: -2 })).toHaveLength(1);
    expect(run("heatmap", { heatmap_hide_below: "low" })).toEqual([
      gt("dashboard.utils.configValueNotNumeric", { setting: "heatmap_hide_below" }),
    ]);
  });

  it("ignores settings of another chart type", () => {
    expect(
      run("line", { stat_text_mode: "ratio", gauge_segments: 1, table_density: "huge" }),
    ).toEqual([]);
  });
});

describe("validatePanel on distribution", () => {
  const field = (alias: string) => ({
    alias,
    column: alias,
    label: alias,
    type: "raw",
    rawQuery: alias,
  });
  const run = (type: string, fields: any, config: any = {}, queryType = "sql") => {
    const errors: string[] = [];
    validatePanel(
      gt,
      {
        data: {
          type,
          queryType,
          config,
          queries: [
            {
              customQuery: queryType === "promql",
              query: "SELECT 1",
              fields: { x: [], y: [], breakdown: [], z: [], ...fields },
            },
          ],
        },
        layout: { currentQueryIndex: 0 },
      },
      errors,
      true,
      [],
      "dashboard",
      { state: { zoConfig: {} } },
      () => true,
    );
    return errors;
  };

  it("accepts y fields and a breakdown", () => {
    expect(run("distribution", { y: [field("a"), field("b")], breakdown: [field("s")] })).toEqual(
      [],
    );
  });

  it("rejects a missing y and any x field", () => {
    expect(run("distribution", { y: [] })).toHaveLength(1);
    expect(run("distribution", { x: [field("ts")], y: [field("v")] })[0]).toMatch(
      /not allowed for the distribution chart/,
    );
  });

  it("is not allowed on PromQL", () => {
    const unsupported = gt("dashboard.utils.promqlChartTypeUnsupported");
    expect(run("distribution", {}, {}, "promql")).toContain(unsupported);
  });

  it("checks the allowed values and ranges of the bucket keys", () => {
    const y = { y: [field("v")] };
    expect(
      run("distribution", y, {
        distribution_bucket_count: 20,
        distribution_bucket_size: 0.5,
        distribution_bucket_offset: -1,
      }),
    ).toEqual([]);
    expect(run("distribution", y, { distribution_bucket_count: 0 })).toHaveLength(1);
    expect(run("distribution", y, { distribution_bucket_count: 5000 })).toHaveLength(1);
    expect(run("distribution", y, { distribution_bucket_size: 0 })).toHaveLength(1);
    expect(run("distribution", y, { distribution_bucket_offset: "x" })).toHaveLength(1);
  });

  it("lists distribution as an importable panel type", () => {
    const errors = validateDashboardJson(gt, {
      dashboardId: "d",
      title: "t",
      tabs: [
        {
          tabId: "default",
          name: "Default",
          panels: [
            { type: "distribution", id: "p", title: "t", layout: { x: 0, y: 0, w: 1, h: 1 } },
          ],
        },
      ],
    });
    expect(errors.filter((error) => /unsupported|not supported/i.test(error))).toEqual([]);
  });
});
describe("validatePanel on sunburst", () => {
  const field = (alias: string) => ({
    alias,
    column: alias,
    label: alias,
    type: "raw",
    rawQuery: alias,
  });
  const run = (type: string, fields: any, config: any = {}, queryType = "sql") => {
    const errors: string[] = [];
    validatePanel(
      gt,
      {
        data: {
          type,
          queryType,
          config,
          queries: [
            {
              customQuery: queryType === "promql",
              query: "SELECT 1",
              fields: { x: [], y: [], breakdown: [], z: [], ...fields },
            },
          ],
        },
        layout: { currentQueryIndex: 0 },
      },
      errors,
      true,
      [],
      "dashboard",
      { state: { zoConfig: {} } },
      () => true,
    );
    return errors;
  };

  it("accepts one group, one size and a sub-group", () => {
    expect(
      run("sunburst", { x: [field("region")], y: [field("count")], breakdown: [field("s")] }),
    ).toEqual([]);
  });

  it("rejects a missing group", () => {
    expect(run("sunburst", { x: [], y: [field("c")] })).toHaveLength(1);
  });

  it("accepts several group rings plus a sub-group up to five levels", () => {
    const x = ["region", "service", "host", "pod"].map(field);
    expect(run("sunburst", { x, y: [field("c")], breakdown: [field("s")] })).toEqual([]);
  });

  it("rejects more than five levels across the group and sub-group fields", () => {
    const x = ["a", "b", "c", "d", "e"].map(field);
    const errors = run("sunburst", { x, y: [field("c")], breakdown: [field("s")] });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("at most 5 levels");
  });

  it("accepts a count or a sum as the size and rejects an aggregation the rings cannot add up", () => {
    const sizeError = gt("dashboard.utils.sizeMustBeCountOrSum");
    // The function list is mocked empty here, so only the size rule's own error is checked.
    const errorsWith = (functionName: string) =>
      run("sunburst", {
        x: [field("region")],
        y: [{ alias: "y_axis_1", type: "build", functionName, args: [] }],
      });
    expect(errorsWith("count")).not.toContain(sizeError);
    expect(errorsWith("sum")).not.toContain(sizeError);
    for (const fn of ["avg", "max", "count-distinct", "p95"]) {
      expect(errorsWith(fn), fn).toContain(sizeError);
    }
  });

  it("is not allowed on PromQL", () => {
    expect(run("sunburst", {}, {}, "promql")).toContain(
      gt("dashboard.utils.promqlChartTypeUnsupported"),
    );
  });

  it("is an importable panel type", () => {
    const errors = validateDashboardJson(gt, {
      dashboardId: "d",
      title: "t",
      tabs: [
        {
          tabId: "default",
          name: "Default",
          panels: [{ type: "sunburst", id: "p", title: "t", layout: { x: 0, y: 0, w: 1, h: 1 } }],
        },
      ],
    });
    expect(errors.filter((error) => /unsupported|not supported/i.test(error))).toEqual([]);
  });
});
describe("validatePanel on the alert list", () => {
  const run = (config: any = {}, queryType = "") => {
    const errors: string[] = [];
    validatePanel(
      gt,
      {
        data: {
          type: "alert-list",
          queryType,
          config,
          queries: [
            {
              query: "",
              customQuery: false,
              fields: { x: [], y: [], breakdown: [], z: [] },
            },
          ],
        },
        layout: { currentQueryIndex: 0 },
      },
      errors,
      true,
      [],
      "dashboard",
      { state: { zoConfig: {} } },
      () => true,
    );
    return errors;
  };

  it("asks nothing of an alert list, which has no query", () => {
    expect(run()).toEqual([]);
  });

  it("checks the allowed values and types of the new keys", () => {
    expect(
      run({ alert_list_sort: "time", alert_list_state: ["firing", "paused"], alert_list_max: 5 }),
    ).toEqual([]);
    expect(run({ alert_list_sort: "owner" })).toHaveLength(1);
    expect(run({ alert_list_state: ["firing", "muted"] })).toHaveLength(1);
    expect(run({ alert_list_max: 0 })).toHaveLength(1);
    expect(run({ alert_list_max: 5000 })).toHaveLength(1);
  });

  it("does not allow the alert list on PromQL", () => {
    expect(run({}, "promql")).toContain(gt("dashboard.utils.promqlChartTypeUnsupported"));
  });

  it("lists the alert list as an importable panel type", () => {
    const errors = validateDashboardJson(gt, {
      dashboardId: "d",
      title: "t",
      tabs: [
        {
          tabId: "default",
          name: "Default",
          panels: [
            {
              type: "alert-list",
              id: "p-alert-list",
              title: "t",
              layout: { x: 0, y: 0, w: 1, h: 1, i: "alert-list" },
              queries: [{ query: "SELECT 1", customQuery: true, fields: {} }],
            },
          ],
        },
      ],
    });
    expect(errors.filter((error) => /unsupported|not supported/i.test(error))).toEqual([]);
  });
});
describe("validatePanel on the flame graph", () => {
  const run = (
    type: string,
    query: Partial<{ query: string; customQuery: boolean }>,
    config: any = {},
    queryType = "sql",
  ) => {
    const errors: string[] = [];
    validatePanel(
      gt,
      {
        data: {
          type,
          queryType,
          config,
          queries: [
            {
              query: "",
              customQuery: false,
              fields: { x: [], y: [], breakdown: [], z: [] },
              ...query,
            },
          ],
        },
        layout: { currentQueryIndex: 0 },
      },
      errors,
      true,
      [],
      "dashboard",
      { state: { zoConfig: {} } },
      () => true,
    );
    return errors;
  };
  const sql = { customQuery: true, query: 'SELECT * FROM "demo_app"' };

  it("needs a query but asks for no builder fields", () => {
    expect(run("flame-graph", sql)).toEqual([]);
    const empty = gt("dashboard.utils.queryIsEmpty", { index: 1 });
    expect(run("flame-graph", { customQuery: true, query: "" })).toEqual([empty]);
  });

  it("is not allowed on PromQL", () => {
    const unsupported = gt("dashboard.utils.promqlChartTypeUnsupported");
    expect(run("flame-graph", { customQuery: true, query: "up" }, {}, "promql")).toContain(
      unsupported,
    );
  });

  it("is an importable panel type", () => {
    const errors = validateDashboardJson(gt, {
      dashboardId: "d",
      title: "t",
      tabs: [
        {
          tabId: "default",
          name: "Default",
          panels: [
            {
              type: "flame-graph",
              id: "p-flame-graph",
              title: "t",
              layout: { x: 0, y: 0, w: 1, h: 1, i: "flame-graph" },
              queries: [{ query: "SELECT 1", customQuery: true, fields: {} }],
            },
          ],
        },
      ],
    });
    expect(errors.filter((error) => /unsupported|not supported/i.test(error))).toEqual([]);
  });
});

describe("validatePanel on a gauge range", () => {
  const run = (configs: any[]) => {
    const errors: string[] = [];
    validatePanel(
      gt,
      {
        data: {
          type: "gauge",
          queryType: "promql",
          queries: configs.map((config) => ({ query: "up", config })),
        },
        layout: { currentQueryIndex: 0 },
      },
      errors,
      true,
      [],
      "dashboard",
      { state: { zoConfig: {} } },
      () => true,
    );
    return errors;
  };
  const message = gt("dashboard.utils.gaugeMinBelowMax");

  it("blocks a fixed range whose min is not below its max", () => {
    expect(run([{ min: 20, max: 10 }])).toEqual([message]);
    expect(run([{ min: 0, max: 0 }])).toEqual([message]);
  });

  it("accepts a valid fixed range and any auto range", () => {
    expect(run([{ min: -50, max: 0 }])).toEqual([]);
    expect(run([{ range_mode: "auto", min: 20, max: 10 }])).toEqual([]);
  });

  it("names the query when the panel has several", () => {
    expect(
      run([
        { min: 0, max: 100 },
        { min: 5, max: 1 },
      ]),
    ).toEqual([gt("dashboard.utils.queryErrorPrefix", { index: 2, error: message })]);
  });
});

describe("validatePanel line thickness", () => {
  const run = (type: string, line_thickness: unknown) => {
    const errors: string[] = [];
    validatePanel(
      gt,
      {
        data: { type, queryType: "promql", queries: [{ query: "up" }], config: { line_thickness } },
        layout: { currentQueryIndex: 0 },
      },
      errors,
      true,
      [],
      "dashboard",
      { state: { zoConfig: {} } },
      () => true,
    );
    return errors.filter((e) => e === gt("dashboard.lineThicknessRange", { max: 10 }));
  };

  it.each([0, -1, 10.5, 500])("blocks saving a %s thickness on a line or area panel", (value) => {
    for (const type of ["line", "area", "area-stacked"]) expect(run(type, value)).toHaveLength(1);
  });

  it.each([null, undefined, 0.5, 1.5, 10])("accepts a %s thickness", (value) => {
    expect(run("line", value)).toEqual([]);
  });

  it("ignores the thickness of a chart that does not draw lines", () => {
    expect(run("bar", 0)).toEqual([]);
  });
});

describe("validatePanel scatter point size", () => {
  const run = (type: string, size: unknown) => {
    const errors: string[] = [];
    validatePanel(
      gt,
      {
        data: {
          type,
          queryType: "promql",
          config: { symbol_size: size },
          queries: [{ query: "up", config: {}, fields: { x: [], y: [], filter: {} } }],
        },
        layout: { currentQueryIndex: 0 },
      },
      errors,
      false,
      [],
      "dashboard",
      { state: { zoConfig: {} } },
      () => true,
    );
    return errors.filter((e) => e.includes(gt("dashboard.pointSize")));
  };

  it("blocks save for a size of 0 or less, or above the max", () => {
    expect(run("scatter", 0)).toHaveLength(1);
    expect(run("scatter", 5000)).toHaveLength(1);
  });

  it("accepts an unset or valid size, and ignores the key on other charts", () => {
    expect(run("scatter", null)).toEqual([]);
    expect(run("scatter", 0.5)).toEqual([]);
    expect(run("line", 0)).toEqual([]);
  });
});

describe("validatePanel bar width", () => {
  const run = (type: string, queryType: string, barWidth: unknown) => {
    const errors: string[] = [];
    validatePanel(
      gt,
      {
        data: {
          type,
          queryType,
          config: { bar_width: barWidth },
          queries: [{ query: "up", config: {}, fields: { x: [], y: [], filter: {} } }],
        },
        layout: { currentQueryIndex: 0 },
      },
      errors,
      false,
      [],
      "dashboard",
      { state: { zoConfig: {} } },
      () => true,
    );
    return errors.filter((e) => e.includes(gt("dashboard.barWidth")));
  };

  it("blocks save for an invalid width where the input is shown", () => {
    expect(run("h-bar", "sql", 0)).toHaveLength(1);
    expect(run("h-bar", "sql", 12.6)).toHaveLength(1);
    expect(run("stacked", "promql", 5000)).toHaveLength(1);
  });

  it("accepts an unset or valid width, and ignores a width the chart type does not use", () => {
    expect(run("h-bar", "sql", null)).toEqual([]);
    expect(run("h-bar", "sql", 13)).toEqual([]);
    expect(run("stacked", "sql", -3)).toEqual([]);
  });
});

describe("validatePanel on bar gauge", () => {
  const field = (alias: string) => ({
    alias,
    column: alias,
    label: alias,
    type: "raw",
    rawQuery: alias,
  });
  const run = (fields: any, config: any = {}, queryType = "sql") => {
    const errors: string[] = [];
    validatePanel(
      gt,
      {
        data: {
          type: "bar-gauge",
          queryType,
          config,
          queries: [
            {
              customQuery: queryType === "promql",
              query: "SELECT 1",
              fields: { x: [], y: [], breakdown: [], z: [], ...fields },
            },
          ],
        },
        layout: { currentQueryIndex: 0 },
      },
      errors,
      true,
      [],
      "dashboard",
      { state: { zoConfig: {} } },
      () => true,
    );
    return errors;
  };

  it("accepts one value with or without a label field, and rejects no value", () => {
    expect(run({ y: [field("count")] })).toEqual([]);
    expect(run({ x: [field("service")], y: [field("count")] })).toEqual([]);
    expect(run({ y: [] })).toHaveLength(1);
  });

  it("allows PromQL", () => {
    expect(run({}, {}, "promql")).not.toContain(gt("dashboard.utils.promqlChartTypeUnsupported"));
  });

  it("checks the allowed mode and orientation values", () => {
    const y = { y: [field("v")] };
    expect(run(y, { bar_gauge_mode: "lcd", bar_gauge_orientation: "vertical" })).toEqual([]);
    expect(run(y, { bar_gauge_mode: "neon" })).toHaveLength(1);
    expect(run(y, { bar_gauge_orientation: "diagonal" })).toHaveLength(1);
  });

  it("is an importable panel type", () => {
    const errors = validateDashboardJson(gt, {
      dashboardId: "d",
      title: "t",
      tabs: [
        {
          tabId: "default",
          name: "Default",
          panels: [{ type: "bar-gauge", id: "p", title: "t", layout: { x: 0, y: 0, w: 1, h: 1 } }],
        },
      ],
    });
    expect(errors.filter((error) => /unsupported|not supported/i.test(error))).toEqual([]);
  });
});
describe("validatePanel on a treemap", () => {
  const field = (alias: string) => ({
    alias,
    column: alias,
    label: alias,
    type: "raw",
    rawQuery: alias,
  });
  const run = (fields: any, queryType = "sql") => {
    const errors: string[] = [];
    validatePanel(
      gt,
      {
        data: {
          type: "treemap",
          queryType,
          config: {},
          queries: [
            {
              customQuery: queryType === "promql",
              query: "SELECT 1",
              fields: { x: [], y: [], breakdown: [], z: [], ...fields },
            },
          ],
        },
        layout: { currentQueryIndex: 0 },
      },
      errors,
      true,
      [],
      "dashboard",
      { state: { zoConfig: {} } },
      () => true,
    );
    return errors;
  };

  it("accepts one x, one y and one breakdown", () => {
    expect(run({ x: [field("service")], y: [field("count")], breakdown: [field("r")] })).toEqual(
      [],
    );
  });

  it("rejects a missing x and a second y", () => {
    expect(run({ x: [], y: [field("c"), field("d")] })).toHaveLength(2);
  });

  it("accepts several group fields as nested levels", () => {
    expect(
      run({ x: [field("region"), field("service"), field("host")], y: [field("count")] }),
    ).toEqual([]);
  });

  it("rejects more than five levels across the group fields and the sub-group", () => {
    const x = ["a", "b", "c", "d", "e"].map(field);
    expect(run({ x, y: [field("count")], breakdown: [field("f")] })).toEqual([
      gt("dashboard.utils.treemapTooManyLevels", { count: 5 }),
    ]);
  });

  it("accepts a count or sum size and rejects a size a parent tile cannot add up", () => {
    const size = (functionName: string) => ({
      ...field("y_axis_1"),
      type: "build",
      functionName,
      args: [{ type: "field", value: { field: "latency" } }],
    });
    const x = [field("region"), field("service")];
    const sizeError = gt("dashboard.utils.sizeMustBeCountOrSum");
    expect(run({ x, y: [size("count")] })).not.toContain(sizeError);
    expect(run({ x, y: [size("sum")] })).not.toContain(sizeError);
    expect(run({ x, y: [size("avg")] })).toContain(sizeError);
    expect(run({ x, y: [size("count-distinct")] })).toContain(sizeError);
  });

  it("is not supported on PromQL", () => {
    expect(run({}, "promql")).toContain(gt("dashboard.utils.promqlChartTypeUnsupported"));
  });

  it("is an importable panel type", () => {
    const errors = validateDashboardJson(gt, {
      dashboardId: "d",
      title: "t",
      tabs: [
        {
          tabId: "default",
          name: "Default",
          panels: [{ type: "treemap", id: "p", title: "t", layout: { x: 0, y: 0, w: 1, h: 1 } }],
        },
      ],
    });
    expect(errors.filter((error) => /unsupported|not supported/i.test(error))).toEqual([]);
  });
});
describe("validatePanel on funnel", () => {
  const field = (alias: string) => ({
    alias,
    column: alias,
    label: alias,
    type: "raw",
    rawQuery: alias,
  });
  const run = (type: string, fields: any, config: any = {}, queryType = "sql") => {
    const errors: string[] = [];
    validatePanel(
      gt,
      {
        data: {
          type,
          queryType,
          config,
          queries: [
            {
              customQuery: queryType === "promql",
              query: "SELECT 1",
              fields: { x: [], y: [], breakdown: [], z: [], ...fields },
            },
          ],
        },
        layout: { currentQueryIndex: 0 },
      },
      errors,
      true,
      [],
      "dashboard",
      { state: { zoConfig: {} } },
      () => true,
    );
    return errors;
  };

  it("accepts one stage field and one value field", () => {
    expect(run("funnel", { x: [field("stage")], y: [field("count")] })).toEqual([]);
  });

  it("rejects a funnel without a value field", () => {
    expect(run("funnel", { x: [field("stage")], y: [] })).toHaveLength(1);
  });

  it("does not allow a funnel on PromQL", () => {
    expect(run("funnel", {}, {}, "promql")).toContain(
      gt("dashboard.utils.promqlChartTypeUnsupported"),
    );
  });

  it("checks the allowed values of the funnel keys", () => {
    const funnel = { x: [field("stage")], y: [field("v")] };
    expect(run("funnel", funnel, { funnel_sort: "none", funnel_orient: "horizontal" })).toEqual([]);
    expect(run("funnel", funnel, { funnel_sort: "random" })).toHaveLength(1);
    expect(run("funnel", funnel, { funnel_orient: "diagonal" })).toHaveLength(1);
  });

  it("lists funnel as an importable panel type", () => {
    const errors = validateDashboardJson(gt, {
      dashboardId: "d",
      title: "t",
      tabs: [
        {
          tabId: "default",
          name: "Default",
          panels: [{ type: "funnel", id: "p", title: "t", layout: { x: 0, y: 0, w: 1, h: 1 } }],
        },
      ],
    });
    expect(errors.filter((error) => /unsupported|not supported/i.test(error))).toEqual([]);
  });
});
describe("validatePanel on node graph", () => {
  const field = (alias: string) => ({
    alias,
    column: alias,
    label: alias,
    type: "raw",
    rawQuery: alias,
  });
  const run = (fields: any, config: any = {}, queryType = "sql") => {
    const errors: string[] = [];
    validatePanel(
      gt,
      {
        data: {
          type: "node-graph",
          queryType,
          config,
          queries: [
            {
              customQuery: queryType === "promql",
              query: "SELECT 1",
              fields: { x: [], y: [], breakdown: [], z: [], ...fields },
            },
          ],
        },
        layout: { currentQueryIndex: 0 },
      },
      errors,
      true,
      [],
      "dashboard",
      { state: { zoConfig: {} } },
      () => true,
    );
    return errors;
  };
  const edges = { source: field("source"), target: field("target"), value: field("value") };

  it("accepts source, target and value fields", () => {
    expect(run(edges)).toEqual([]);
  });

  it("asks for the target and value when only the source is set", () => {
    expect(run({ source: field("source") })).toHaveLength(2);
  });

  it("is not allowed on PromQL", () => {
    expect(run({}, {}, "promql")).toContain(gt("dashboard.utils.promqlChartTypeUnsupported"));
  });

  it("checks the layout value", () => {
    expect(run(edges, { node_graph_layout: "circular" })).toEqual([]);
    expect(run(edges, { node_graph_layout: "tree" })).toHaveLength(1);
  });

  it("is an importable panel type", () => {
    const errors = validateDashboardJson(gt, {
      dashboardId: "d",
      title: "t",
      tabs: [
        {
          tabId: "default",
          name: "Default",
          panels: [{ type: "node-graph", id: "p", title: "t", layout: { x: 0, y: 0, w: 1, h: 1 } }],
        },
      ],
    });
    expect(errors.filter((error) => /unsupported|not supported/i.test(error))).toEqual([]);
  });
});
