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

import { HOSTMAP_DEFAULT_COLOR } from "./convertHostmapData";

/** Pivot mode has its own totals and cannot transpose or add columns, so those are forced off. */
export const applyPivotConfigDefaults = (config: Record<string, any>) => {
  config.table_transpose = false;
  config.table_dynamic_columns = false;
  for (const key of [
    "table_pivot_show_row_totals",
    "table_pivot_show_col_totals",
    "table_pivot_sticky_row_totals",
    "table_pivot_sticky_col_totals",
  ]) {
    if (config[key] === undefined) config[key] = false;
  }
};

/** A legend size only applies to a plain legend on the side it grows from, so any other layout drops it. */
export const clearUnusableLegendSizes = (config: Record<string, any>) => {
  const plain = config.legends_type === "plain";
  if (config.legend_width && (!plain || config.legends_position !== "right")) {
    config.legend_width.value = null;
  }
  // A missing position is Auto, the same as null: the server drops the null.
  const heightApplies =
    plain && (config.legends_position == null || config.legends_position === "bottom");
  if (config.legend_height && !heightApplies) {
    config.legend_height.value = null;
  }
};

/** The colour config a panel without one is given when its palette picker mounts. */
export const applyColorDefault = (config: Record<string, any>, type: string) => {
  if (config.color) return;
  config.color =
    type === "hostmap"
      ? { ...HOSTMAP_DEFAULT_COLOR, fixedColor: [...HOSTMAP_DEFAULT_COLOR.fixedColor] }
      : { mode: "palette-classic-by-series", fixedColor: [], seriesBy: "last" };
};

/** The table override list OverrideConfig starts empty when it mounts for a table. */
export const applyOverrideConfigDefault = (config: Record<string, any>) => {
  if (!config.override_config) config.override_config = [];
};

/**
 * Fills, in place, the config keys the Config sidebar binds to. The server drops null fields,
 * so a saved panel comes back without them; only missing (or falsy) keys are written.
 */
export const applyConfigPanelDefaults = (
  config: Record<string, any>,
  {
    isNewPanel,
    showSymbolDefault,
    isPivotMode = false,
  }: { isNewPanel: boolean; showSymbolDefault: boolean; isPivotMode?: boolean },
) => {
  for (const key of ["legends_position", "legends_type", "chart_align", "unit", "unit_custom"]) {
    if (config[key] === undefined) config[key] = null;
  }
  if (config.label_option && config.label_option.position === undefined) {
    config.label_option.position = null;
  }

  if (!config.legend_width) config.legend_width = { value: null, unit: "px" };
  if (!config.legend_height) config.legend_height = { value: null, unit: "px" };
  if (config.legend_width.value === undefined) config.legend_width.value = null;
  if (config.legend_height.value === undefined) config.legend_height.value = null;

  if (!config.trellis) {
    config.trellis = { layout: null, num_of_columns: 1, group_by_y_axis: false };
  }

  if (!config.axis_border_show) config.axis_border_show = false;
  if (!config.top_results_others) config.top_results_others = false;

  if (!config.map_symbol_style) {
    config.map_symbol_style = {
      size: "by Value",
      size_by_value: { min: 1, max: 100 },
      size_fixed: 2,
    };
  }

  // Panels saved with a null map view or base map would throw when the Map section binds their fields.
  if (!config.map_view) config.map_view = { zoom: 1, lat: 0, lng: 0 };
  if (!config.base_map) config.base_map = { type: "osm" };

  if (!config.connect_nulls) config.connect_nulls = false;
  if (!config.no_value_replacement) config.no_value_replacement = "";
  if (!config.wrap_table_cells) config.wrap_table_cells = false;
  if (!config.table_filtering) config.table_filtering = false;
  if (!config.table_transpose) config.table_transpose = false;
  if (!config.table_dynamic_columns) config.table_dynamic_columns = false;
  if (!config.label_option) config.label_option = { position: null, rotate: 0 };

  // A new panel follows the env setting; a saved panel without the key was drawn without symbols.
  if (config.show_symbol === undefined) {
    config.show_symbol = isNewPanel ? showSymbolDefault : false;
  }

  if (!config.line_interpolation) config.line_interpolation = "smooth";
  if (!config.map_type) config.map_type = { type: "world" };
  if (!config.step_value) config.step_value = "0";
  if (!config.trellis.group_by_y_axis) config.trellis.group_by_y_axis = false;
  if (config.show_gridlines === null || config.show_gridlines === undefined) {
    config.show_gridlines = true;
  }

  if (isPivotMode) applyPivotConfigDefaults(config);
  clearUnusableLegendSizes(config);
};

/** The same defaults, read from a panel and the store the way the Config sidebar applies them. */
export const applyPanelConfigDefaults = (panel: any, store: any, isPivotMode = false) => {
  if (!panel?.config) return;
  applyConfigPanelDefaults(panel.config, {
    isNewPanel: !panel.id,
    showSymbolDefault: store?.state?.zoConfig?.dashboard_show_symbol_enabled ?? false,
    isPivotMode,
  });
};

/**
 * For comparisons only: the empty values other editor components write when they (re)mount,
 * so a server copy with null or missing ones does not look edited. Never saved.
 */
export const applyEditorMountDefaults = (panel: any) => {
  // DashboardQueryEditor's onBeforeMount turns a null VRL function into "".
  panel?.queries?.forEach((query: any) => {
    if (query && !query.vrlFunctionQuery) query.vrlFunctionQuery = "";
  });
  const config = panel?.config;
  if (!config) return;
  if (!config.drilldown) config.drilldown = [];
  if (!config.mark_line) config.mark_line = [];
  if (!config.mappings) config.mappings = [];
  applyColorDefault(config, panel.type);
  if (!config.color.colorBySeries) config.color.colorBySeries = [];
  if (panel.type === "table") applyOverrideConfigDefault(config);
};
