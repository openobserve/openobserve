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
  applyColorDefault,
  applyConfigPanelDefaults,
  applyEditorMountDefaults,
  applyPanelConfigDefaults,
  applyPivotConfigDefaults,
  clearUnusableLegendSizes,
} from "./panelConfigDefaults";
import { HOSTMAP_DEFAULT_COLOR } from "./convertHostmapData";

const store = (showSymbol?: boolean) => ({
  state: { zoConfig: { dashboard_show_symbol_enabled: showSymbol } },
});

describe("applyConfigPanelDefaults", () => {
  it("fills the keys a saved panel lost to the server's null-dropping", () => {
    const config: Record<string, any> = {
      label_option: { rotate: 0 },
      legend_width: { unit: "px" },
    };
    applyConfigPanelDefaults(config, { isNewPanel: false, showSymbolDefault: true });

    expect(config).toMatchObject({
      legends_position: null,
      legends_type: null,
      chart_align: null,
      unit: null,
      unit_custom: null,
      label_option: { position: null, rotate: 0 },
      legend_width: { value: null, unit: "px" },
      legend_height: { value: null, unit: "px" },
      table_filtering: false,
      show_symbol: false,
      show_gridlines: true,
      step_value: "0",
      trellis: { layout: null, num_of_columns: 1, group_by_y_axis: false },
    });
  });

  it("keeps values the user set", () => {
    const config: Record<string, any> = {
      legends_position: "right",
      unit: "bytes",
      show_symbol: true,
      show_gridlines: false,
      line_interpolation: "linear",
      step_value: "5",
    };
    applyConfigPanelDefaults(config, { isNewPanel: false, showSymbolDefault: false });

    expect(config).toMatchObject({
      legends_position: "right",
      unit: "bytes",
      show_symbol: true,
      show_gridlines: false,
      line_interpolation: "linear",
      step_value: "5",
    });
  });

  it("is idempotent", () => {
    const config: Record<string, any> = {};
    applyConfigPanelDefaults(config, { isNewPanel: true, showSymbolDefault: true });
    const once = JSON.parse(JSON.stringify(config));
    applyConfigPanelDefaults(config, { isNewPanel: true, showSymbolDefault: true });
    expect(config).toEqual(once);
  });
});

describe("applyEditorMountDefaults", () => {
  it("fills the empty values the query editor and config lists write on mount", () => {
    const panel: any = {
      queries: [{ vrlFunctionQuery: null }, {}],
      config: { color: { mode: "palette-classic-by-series" } },
    };
    applyEditorMountDefaults(panel);
    expect(panel.queries.map((q: any) => q.vrlFunctionQuery)).toEqual(["", ""]);
    expect(panel.config).toMatchObject({
      drilldown: [],
      mark_line: [],
      mappings: [],
      color: { colorBySeries: [] },
    });
  });

  it("keeps a VRL function and lists the user set", () => {
    const panel: any = {
      queries: [{ vrlFunctionQuery: ".x = 1" }],
      config: { drilldown: [{ name: "d" }] },
    };
    applyEditorMountDefaults(panel);
    expect(panel.queries[0].vrlFunctionQuery).toBe(".x = 1");
    expect(panel.config.drilldown).toEqual([{ name: "d" }]);
  });

  it("gives a panel without colours the picker default, and a table its override list", () => {
    const line: any = { type: "line", config: {} };
    const table: any = { type: "table", config: {} };
    applyEditorMountDefaults(line);
    applyEditorMountDefaults(table);
    expect(line.config.color).toEqual({
      mode: "palette-classic-by-series",
      fixedColor: [],
      seriesBy: "last",
      colorBySeries: [],
    });
    expect("override_config" in line.config).toBe(false);
    expect(table.config.override_config).toEqual([]);
  });
});

describe("applyPanelConfigDefaults", () => {
  it("gives a new panel the env's show-symbol default and a saved one false", () => {
    const fresh: any = { id: "", config: {} };
    const saved: any = { id: "p1", config: {} };
    applyPanelConfigDefaults(fresh, store(true));
    applyPanelConfigDefaults(saved, store(true));
    expect(fresh.config.show_symbol).toBe(true);
    expect(saved.config.show_symbol).toBe(false);
  });

  it("leaves a panel without config alone", () => {
    const panel: any = { id: "p1" };
    applyPanelConfigDefaults(panel, store());
    expect(panel).toEqual({ id: "p1" });
  });
});

describe("clearUnusableLegendSizes", () => {
  const sized = (legends_type: any, legends_position: any) => ({
    legends_type,
    legends_position,
    legend_width: { value: 200, unit: "px" },
    legend_height: { value: 80, unit: "px" },
  });

  it("keeps a width only for a plain legend on the right", () => {
    const right = sized("plain", "right");
    clearUnusableLegendSizes(right);
    expect(right.legend_width.value).toBe(200);
    expect(right.legend_height.value).toBeNull();

    const scroll = sized("scroll", "right");
    clearUnusableLegendSizes(scroll);
    expect(scroll.legend_width.value).toBeNull();
  });

  it("keeps a height for a plain legend at the bottom or on Auto, missing or null", () => {
    for (const position of ["bottom", null, undefined]) {
      const config = sized("plain", position);
      clearUnusableLegendSizes(config);
      expect(config.legend_height.value).toBe(80);
      expect(config.legend_width.value).toBeNull();
    }
  });
});

describe("applyPivotConfigDefaults", () => {
  it("turns transpose and dynamic columns off and fills missing totals, keeping set ones", () => {
    const config: Record<string, any> = {
      table_transpose: true,
      table_dynamic_columns: true,
      table_pivot_show_row_totals: true,
    };
    applyPivotConfigDefaults(config);
    expect(config).toEqual({
      table_transpose: false,
      table_dynamic_columns: false,
      table_pivot_show_row_totals: true,
      table_pivot_show_col_totals: false,
      table_pivot_sticky_row_totals: false,
      table_pivot_sticky_col_totals: false,
    });
  });
});

describe("applyColorDefault", () => {
  it("gives a host map its own scale, other panels the classic palette, and keeps a set one", () => {
    const hostmap: Record<string, any> = {};
    const line: Record<string, any> = {};
    const set: Record<string, any> = { color: { mode: "fixed" } };
    applyColorDefault(hostmap, "hostmap");
    applyColorDefault(line, "line");
    applyColorDefault(set, "line");
    expect(hostmap.color).toEqual(HOSTMAP_DEFAULT_COLOR);
    expect(hostmap.color.fixedColor).not.toBe(HOSTMAP_DEFAULT_COLOR.fixedColor);
    expect(line.color).toEqual({
      mode: "palette-classic-by-series",
      fixedColor: [],
      seriesBy: "last",
    });
    expect(set.color).toEqual({ mode: "fixed" });
  });
});
