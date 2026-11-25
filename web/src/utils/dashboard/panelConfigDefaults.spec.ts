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
  applyConfigPanelDefaults,
  applyEditorMountDefaults,
  applyPanelConfigDefaults,
} from "./panelConfigDefaults";

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

  it("keeps a VRL function and lists the user set, and adds no colour config", () => {
    const panel: any = {
      queries: [{ vrlFunctionQuery: ".x = 1" }],
      config: { drilldown: [{ name: "d" }] },
    };
    applyEditorMountDefaults(panel);
    expect(panel.queries[0].vrlFunctionQuery).toBe(".x = 1");
    expect(panel.config.drilldown).toEqual([{ name: "d" }]);
    expect("color" in panel.config).toBe(false);
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
