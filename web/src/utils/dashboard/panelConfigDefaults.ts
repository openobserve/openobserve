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

/**
 * Fills the config keys the Config sidebar binds to, in place. The server drops null
 * fields, so a saved panel comes back without them; this puts back the values the
 * renderer already falls back to. Only missing (or falsy) keys are written.
 */
export const applyConfigPanelDefaults = (
  config: Record<string, any>,
  { isNewPanel, showSymbolDefault }: { isNewPanel: boolean; showSymbolDefault: boolean },
) => {
  // Normalize config fields that default to null but may arrive as undefined
  // when loaded from older panels (backend omits null fields in JSON response).
  const nullableConfigKeys = [
    "legends_position",
    "legends_type",
    "chart_align",
    "unit",
    "unit_custom",
  ] as const;
  nullableConfigKeys.forEach((key) => {
    if (config[key] === undefined) {
      config[key] = null;
    }
  });
  if (config.label_option?.position === undefined) {
    if (config.label_option) {
      config.label_option.position = null;
    }
  }

  // Ensure that the nested structure is initialized
  if (!config.legend_width) {
    config.legend_width = {
      value: null,
      unit: "px",
    };
  }

  // Initialize legend height configuration
  if (!config.legend_height) {
    config.legend_height = {
      value: null,
      unit: "px",
    };
  }

  // The server drops a null value; the sidebar's legend-size clean-up writes it back as null.
  if (config.legend_width.value === undefined) config.legend_width.value = null;
  if (config.legend_height.value === undefined) config.legend_height.value = null;

  if (!config.trellis) {
    config.trellis = {
      layout: null,
      num_of_columns: 1,
      group_by_y_axis: false,
    };
  }

  if (!config.axis_border_show) {
    config.axis_border_show = false;
  }

  // by default, use top_results_others as false
  if (!config.top_results_others) {
    config.top_results_others = false;
  }

  // Ensure that the nested structure is initialized
  if (!config.map_symbol_style) {
    config.map_symbol_style = {
      size: "by Value",
      size_by_value: {
        min: 1,
        max: 100,
      },
      size_fixed: 2,
    };
  }

  // Panels saved with a null map view or base map would throw when the Map section binds their fields.
  if (!config.map_view) {
    config.map_view = { zoom: 1, lat: 0, lng: 0 };
  }
  if (!config.base_map) {
    config.base_map = { type: "osm" };
  }

  // by default, use connect_nulls as false
  if (!config.connect_nulls) {
    config.connect_nulls = false;
  }

  // by default, use no_value_replacement as empty string
  if (!config.no_value_replacement) {
    config.no_value_replacement = "";
  }

  // by default, use wrap_table_cells as false
  if (!config.wrap_table_cells) {
    config.wrap_table_cells = false;
  }

  // by default, tableFiltering is disabled
  if (!config.table_filtering) {
    config.table_filtering = false;
  }

  // by default, use table_transpose as false
  if (!config.table_transpose) {
    config.table_transpose = false;
  }

  // by default, use table_dynamic_columns  as false
  if (!config.table_dynamic_columns) {
    config.table_dynamic_columns = false;
  }

  // by default, use label_option position as null and rotate as 0
  if (!config.label_option) {
    config.label_option = {
      position: null,
      rotate: 0,
    };
  }

  // by default, use chart_align as null (auto)
  if (config.chart_align === undefined) {
    config.chart_align = null;
  }

  // A new panel follows the env setting; a saved panel without the key was drawn without symbols.
  if (config.show_symbol === undefined) {
    config.show_symbol = isNewPanel ? showSymbolDefault : false;
  }

  // by default, set line interpolation as smooth
  if (!config.line_interpolation) {
    config.line_interpolation = "smooth";
  }

  // Initialize map_type configuration
  if (!config.map_type) {
    config.map_type = { type: "world" };
  }

  // If no step value is set, set it to 0
  if (!config.step_value) {
    config.step_value = "0";
  }

  if (!config.trellis?.group_by_y_axis) {
    config.trellis.group_by_y_axis = false;
  }

  if (config.show_gridlines === null || config.show_gridlines === undefined) {
    config.show_gridlines = true;
  }
};

/** The same defaults, read from a panel and the store the way the Config sidebar applies them. */
export const applyPanelConfigDefaults = (panel: any, store: any) => {
  if (!panel?.config) return;
  applyConfigPanelDefaults(panel.config, {
    isNewPanel: !panel.id,
    showSymbolDefault: store?.state?.zoConfig?.dashboard_show_symbol_enabled ?? false,
  });
};

/**
 * For comparisons only: the other empty values editor components write when they (re)mount,
 * so a panel whose server copy has null or missing ones does not look edited. Never saved.
 */
export const applyEditorMountDefaults = (panel: any) => {
  // DashboardQueryEditor's onBeforeMount turns a null VRL function into "".
  panel?.queries?.forEach((query: any) => {
    if (query && !query.vrlFunctionQuery) query.vrlFunctionQuery = "";
  });
  const config = panel?.config;
  if (!config) return;
  // Drilldown, MarkLineConfig and ValueMapping start their lists empty when they mount.
  if (!config.drilldown) config.drilldown = [];
  if (!config.mark_line) config.mark_line = [];
  if (!config.mappings) config.mappings = [];
  // ColorBySeries does the same for its list inside an existing colour config.
  if (config.color && !config.color.colorBySeries) config.color.colorBySeries = [];
};
